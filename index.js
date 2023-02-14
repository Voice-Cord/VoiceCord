// TODO:
// Clean up all commands and messages that were sent.
// Clean up saved video and audio files from system.
// Improve usabilty by improving the look of everything.
// FUTURE:
// Instead of using the saved frame, generate a webp frame, with information of recorded user and stuff

const {
  EndBehaviorType,
  getVoiceConnection,
  joinVoiceChannel,
} = require("@discordjs/voice");
const {
  ChannelType,
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");
const { Transform } = require("stream");
const { FileWriter } = require("wav");
const { getAudioDurationInSeconds } = require("get-audio-duration");

const opus = require("@discordjs/opus");
const { OpusEncoder } = opus;

const fs = require("fs");
const Canvas = require("@napi-rs/canvas");
const CanvasImage = Canvas.Image;
const path = require("path");
const request = require("request").defaults({ encoding: null });

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const maxVoiceNoteTimerByUserIds = {};
const createThreadTimeoutTimerByGuildIdAndUserIds = {};

const createThreadTimeoutMs = 20000;

const recordStartMessageByUsersToRecordOnceEnteringVC = {};

const telemetryFile = "telemetry/info.txt";
const telemetryTable =
  "Username and Id | Audio Duration | Guild | Channel | Date | Recording count\n";

let recordingCount = 0;

require("dotenv/config");

class OpusDecodingStream extends Transform {
  encoder;

  constructor(options, encoder) {
    super(options);
    this.encoder = encoder;
  }

  _transform(data, _encoding, callback) {
    this.push(this.encoder.decode(data));
    callback();
  }
}

function secToHHMMSS(seconds) {
  return new Date(seconds * 1000).toISOString().slice(11, 19);
}

const email = "voicecordhelp@gmail.com";
const adminInviteLink =
  "https://discord.com/api/oauth2/authorize?client_id=1068674033832427540&permissions=8&scope=bot%20applications.commands";

const voiceRecorderDisplayName = "VoiceCord";
const voiceRecorderBy = "Recorded on Discord by " + voiceRecorderDisplayName;

const joinVCButtonLabel = "🔊 Join VC to record";
const recordButtonLabel = "🎙️ Record";
const sendButtonLabel = "📨 Send";
const createThreadButtonLabel = "🔄 Create Thread";
const cancelButtonLabel = "❌ Cancel";

const recordButtonId = "record";
const sendButtonId = "send";
const cancelButtonId = "cancel";
const createThreadButtonId = "create-thread";

const voiceRecorderVoiceChannel = "Voice-Cord";
const threadName = "Voice-Cord";

let membersToUndeafOnceLeavingVoiceRecorderChannel = [];

const excessMessagesByUser = [];

// The values are: "usernameAndId + <buttonId>"
let usersRequestedButtons = [];

const audioReceiveStreamByUser = {};
const connectedVoiceByChannelId = {};

const helpCommand = ".voicecordhelp";
const recordCommand = ".record";
const recordAlternativeCommand = ". record";

// The voice channels users have been in, before starting record
const recordingUsersInitialChannel = {};

// buttonactions
const buttonIdsToFunctions = {
  [recordButtonId]: handleUserRecordStartInteraction,
  [sendButtonId]: tryFinishVoiceNoteOrReplyError,
  [createThreadButtonId]: createThread,
  [cancelButtonId]: cancelRecording,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

function leaveGuildIfNotAdmin(guild) {
  if (
    !guild.members.me.permissions.has(PermissionsBitField.Flags.Administrator)
  ) {
    const channel = guild.channels.cache.find(
      (channel) =>
        channel.isTextBased() &&
        channel
          .permissionsFor(client.user.id)
          .has(PermissionsBitField.Flags.SendMessages)
    );
    if (channel) {
      channel.send(
        `I have no admin rights. Use this link: ${adminInviteLink}, or contact us: \`${email}\``
      );
    }

    console.log(
      `Left Guild: ${
        guild.name
      }, at: ${currentDateAndTime()}, because of no admin permissions.`
    );

    guild.leave();
    return true;
  }
  return false;
}

client.on("guildCreate", (guild) => {
  if (!leaveGuildIfNotAdmin(guild));
  console.log(`Added to Guild: ${guild.name}, at: ${currentDateAndTime()}`);
});

client.on("ready", () => {
  console.log("Bot loaded!");

  client?.guilds?.cache.forEach(async (guild) => {
    leaveGuildIfNotAdmin(guild);

    const voicecordVC = await findOrCreateVoiceRecorderChannel(guild);
    voicecordVC?.members?.forEach((member) => {
      if (!isVoiceDeafened(member?.voice)) {
        deafenMember(member);
      }
    });
  });
});

function currentDateAndTime() {
  const date_ob = new Date();

  const date = ("0" + date_ob.getDate()).slice(-2);
  const month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
  const year = date_ob.getFullYear();
  const hours = date_ob.getHours();
  const minutes = date_ob.getMinutes();
  const seconds = date_ob.getSeconds();

  return (
    year +
    "-" +
    month +
    "-" +
    date +
    " " +
    hours +
    ":" +
    minutes +
    ":" +
    seconds
  );
}

function currentTimeFormatted() {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
}

function imageBufferFromUrl(url) {
  return new Promise((resolve, _reject) => {
    request.get(url, (_err, _res, body) => {
      resolve(Buffer.from(body));
    });
  });
}

function fontFile(name) {
  return (filePath = path.join(__dirname, "..", "fonts", name));
}

Canvas.GlobalFonts.registerFromPath(fontFile("Comfortaa-SemiBold.ttf"));

function markExcessMessage(usernameAndId, message) {
  const value = excessMessagesByUser[usernameAndId];
  if (!value) {
    excessMessagesByUser[usernameAndId] = [message];
  } else {
    excessMessagesByUser[usernameAndId].push(message);
  }
}

function _removeButtonFromMessage(message, buttonId) {
  const buttonRow = [];

  message?.components?.forEach((actionRow) => {
    actionRow?.components?.forEach((button) => {
      if (button.data.custom_id !== buttonId) buttonRow.push(button);
    });
  });

  message.edit({ components: [row(buttonRow)] });
}

function tryClearExcessMessages(usernameAndId) {
  const messages = excessMessagesByUser[usernameAndId];
  if (messages) {
    messages.forEach((message) => {
      message.components?.forEach((actionRow) => {
        actionRow.components?.forEach((button) => {
          if (
            button.data.custom_id !== undefined &&
            button.style !== ButtonStyle.Link
          ) {
            const index = usersRequestedButtons.indexOf(
              usernameAndId + button.data.custom_id
            );
            usersRequestedButtons.slice(index, 1);
          }
        });
      });

      message.delete();
    });

    delete excessMessagesByUser[usernameAndId];
  }
}

const MAX_RECORD_TIME_SECS = 3600;

//TOOD: This is supposed to make some sort of http call and get the max recording time
function maxRecordingTimeForUserInGuild(_member) {
  return MAX_RECORD_TIME_SECS;
}

async function findOrCreateVoiceRecorderChannel(guild) {
  let foundChannel = await guild?.channels.cache.find(
    (channel) => channel.name === voiceRecorderVoiceChannel
  );

  if (!foundChannel) {
    foundChannel = await createVoiceRecorderChannel(guild);
  }

  return foundChannel;
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

async function createJoinVcButton(guild) {
  return new ButtonBuilder()
    .setLabel(joinVCButtonLabel)
    .setStyle(ButtonStyle.Link)
    .setURL(await generateInviteLinkToVoiceCordChannel(guild));
}

function registerButton(usernameAndId, buttonId) {
  const key = usernameAndId + buttonId;
  if (usersRequestedButtons.indexOf(key) === -1)
    usersRequestedButtons.push(key);
}

function registerCancelButton(usernameAndId) {
  registerButton(usernameAndId, cancelButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + cancelButtonId)
    .setLabel(cancelButtonLabel)
    .setStyle(ButtonStyle.Secondary);
}

function registerCreateThreadButton(usernameAndId) {
  registerButton(usernameAndId, createThreadButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + createThreadButtonId)
    .setLabel(createThreadButtonLabel)
    .setStyle(ButtonStyle.Secondary);
}

function registerSendButton(usernameAndId) {
  registerButton(usernameAndId, sendButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + sendButtonId)
    .setLabel(sendButtonLabel)
    .setStyle(ButtonStyle.Success);
}

function registerRecordButton(usernameAndId) {
  registerButton(usernameAndId, recordButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + recordButtonId)
    .setLabel(recordButtonLabel)
    .setStyle(ButtonStyle.Danger);
}

async function createImageFileFromCanvas(canvas, files, callback) {
  // Sharp converts lossless webp format to lossy format
  await fs.promises.writeFile(files.imagefileTemp, await canvas.encode("jpeg"));
  callback();
}

async function generateImageFromRecording(
  user,
  files,
  audioDuration,
  callback
) {
  const username = user.displayName;

  const cnv_s = { x: 826, y: 280 }; // Canvas size
  const cnv_col = "#5865f2"; // Canvas color
  const canvas = Canvas.createCanvas(cnv_s.x, cnv_s.y);

  const fnt_s = 1; // Font size, this value is multiplied with every text size
  const mid_y = cnv_s.y / 2; // Vertical middle

  const cnt_col = "#36393f"; // Avatar container color
  const cnt_m = 30; // Avatar container margin
  const cnt_br = 20; // Avatar container border-radius
  const cnt_x = cnt_m; // Avatar container x
  const cnt_y = cnt_m; // Avatar container y
  const cnt_w = cnv_s.x - cnt_m * 2; // Avatar container width
  const cnt_h = cnv_s.y - cnt_m * 2; // Avatar container height

  const avt_ml = 50; // Avatar left margin
  const avt_h = 128; // Avatar height
  const avt_w = 128; // Avatar width
  const avt_x = cnt_m + avt_ml; // Avatar x
  const avt_y = mid_y - avt_h / 2; // Avatar y

  const nme_col = "#f6f6f6"; // Name color
  const nme_s = (avt_h / 3.4) * fnt_s; // Name size
  const nme_ml = 60; // Name margin left
  const nme_x = avt_ml + avt_w + nme_ml; // Name x
  const nme_y = avt_y + nme_s; // Name y

  const dur_col = "#5f6166"; // Dur size
  const dur_s = 30 * fnt_s; // Dur size
  const dur_mr = 150; // Dur margin right
  const dur_mt = 10; // Dur margin right
  const dur_x = cnt_x + cnt_w - dur_mr; // Dur x
  const dur_y = avt_y + dur_s + dur_mt; // Dur y

  // "by" refers to the text, which is something like "This was recorded by .."
  const by_col = "#5b5251"; // By color
  const by_s = 20 * fnt_s; // By size
  const by_mt = 10 + by_s; // By top margin
  const by_y = avt_y + avt_h + by_mt; // By y
  const by_x = avt_x; // By x

  const ctx = canvas.getContext("2d");

  const font = function (size) {
    return `demi ${size}px Comfortaa`;
  };

  const addBackgroundAndAvatarContainer = function () {
    ctx.fillStyle = cnv_col;
    ctx.fillRect(0, 0, cnv_s.x, cnv_s.y);

    ctx.fillStyle = cnt_col;
    ctx.roundRect(cnt_x, cnt_y, cnt_w, cnt_h, cnt_br);
    ctx.fill();
  };

  addBackgroundAndAvatarContainer();

  const addUsername = function () {
    ctx.fillStyle = nme_col;
    ctx.font = font(nme_s);
    ctx.fillText(username, nme_x, nme_y);
  };

  const addDuration = function () {
    ctx.fillStyle = dur_col;
    ctx.font = font(dur_s);
    ctx.fillText(secToHHMMSS(audioDuration), dur_x, dur_y);
  };

  // "by" refers to the text, which is something like "This was recorded by .."
  const addBytext = function () {
    ctx.fillStyle = by_col;
    ctx.font = font(by_s);
    ctx.fillText(voiceRecorderBy, by_x, by_y);
  };

  const add_Avatar_Username_Duration_Length_Bytext = function () {
    ctx.drawImage(avatar, avt_x, avt_y, avt_h, avt_w);
    addUsername();
    addDuration();
    addBytext();

    createImageFileFromCanvas(canvas, files, callback);
  };

  const avatar = new CanvasImage();
  avatar.onload = add_Avatar_Username_Duration_Length_Bytext;
  avatar.onerror = (err) => console.log(err);
  avatar.src = await imageBufferFromUrl(
    user.displayAvatarURL({
      format: "jpg",
      dynamic: true,
      size: 64,
    })
  );
}

function findUsernameAndId(userId) {
  const user = client.users.cache.get(userId);
  if (user) return user.tag;
  else console.log(`User: "${user}" not found.`);
}

function finishVoiceNote(audioReceiveStream, usernameAndId, interaction) {
  moveToInitialVCIfNeeded(usernameAndId, interaction.member);
  //TODO only disconnect when is empty
  getVoiceConnection(interaction.guildId).disconnect();
  audioReceiveStream.emit("finish_recording", interaction);

  delete audioReceiveStreamByUser[usernameAndId];
  delete recordingUsersInitialChannel[usernameAndId];
}

function tryFinishVoiceNoteOrReplyError(interaction, usernameAndId) {
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  if (!audioReceiveStream) {
    interaction.reply({
      content: `❌ Record with \`${recordButtonLabel}\` before sending! 🎙️`,
      ephemeral: true,
    });
    return false;
  } else {
    finishVoiceNote(audioReceiveStream, usernameAndId, interaction);
    return true;
  }
}

function createAndSendVideo(
  interactionOrMessage,
  usernameAndId,
  files,
  sendCallback
) {
  ffmpeg()
    .addInput(files.imagefileTemp)
    .addInput(files.audiofileTemp)
    .output(files.videofileFinal)
    .outputOptions(["-c:v libx264", "-crf 0", "-c:a aac"])
    .on("end", () => {
      console.log(`✅ Combined video and audio ${files.videofileFinal}`);

      let channel;

      if (interactionOrMessage.channel.isThread()) {
        channel = interactionOrMessage.channel.parent;
      } else {
        channel = interactionOrMessage.channel;
        tryClearExcessMessages(usernameAndId);
      }

      channel
        .send({
          files: [files.videofileFinal],
        })
        .then(() => {
          console.log(`✅ Sent video ${files.videofileFinal}`);
          sendCallback();
        });
    })
    .run();
}

function generateFileNames(username) {
  const date = Date.now();
  const filename = `recordings/${date}_${username}`;
  const imagefileTemp = filename + `.jpeg`;
  const audiofileTemp = filename + `.wav`;
  const videofileFinal = filename + `.mp4`;

  return { imagefileTemp, audiofileTemp, videofileFinal };
}

function prepareRecording(audiofileTemp) {
  const encoder = new OpusEncoder(16000, 1);
  const fileWriter = new FileWriter(audiofileTemp, {
    channels: 1,
    sampleRate: 16000,
  });
  const stopRecordingManually = {
    end: {
      behavior: EndBehaviorType.Manual,
    },
  };
  const decodingStream = new OpusDecodingStream({}, encoder);

  return { fileWriter, stopRecordingManually, decodingStream };
}

function getAudioDuration(files) {
  return new Promise((resolve, reject) =>
    getAudioDurationInSeconds(files.audiofileTemp)
      .then(resolve)
      .catch(() => {})
  );
}

function cleanupFiles(files) {
  fs.unlink(files.imagefileTemp, () => {});
  fs.unlink(files.audiofileTemp, () => {});
  fs.unlink(files.videofileFinal, () => {});
}

function clearAudioReceiveStream(audioReceiveStream, usernameAndId) {
  audioReceiveStream.destroy();
  delete audioReceiveStreamByUser[usernameAndId];
}

function appendInfoToTelemetryFile(interaction, usernameAndId, audioDuration) {
  fs.writeFile(telemetryFile, telemetryTable, { flag: "wx" }, (err) => {
    if (err) {
      if (err.code !== "EEXIST") {
        console.log(err);
        return;
      } else {
        console.log(`✅ ${telemetryFile} created!`);
      }
    }

    const listItem = `${usernameAndId} | ${audioDuration}s | ${
      interaction?.guild?.name
    } | ${
      interaction?.channel?.name
    } | ${currentDateAndTime()} | ${recordingCount}\n`;
    fs.appendFile(telemetryFile, listItem, function (err) {
      if (err) console.log(err);
    });
  });
}

function tryStopMaxVoiceRecordingTimeIfNeeded(userId) {
  const timer = maxVoiceNoteTimerByUserIds[userId];
  if (timer) {
    clearTimeout(timer);
    delete maxVoiceNoteTimerByUserIds[userId];
    return true;
  } else {
    return false;
  }
}

function startVoiceNoteRecording(
  receiver,
  userId,
  usernameAndId,
  member,
  recordStartMessage
) {
  const files = generateFileNames(usernameAndId);
  const { fileWriter, stopRecordingManually, decodingStream } =
    prepareRecording(files.audiofileTemp);
  const audioReceiveStream = receiver.subscribe(userId, stopRecordingManually);

  fileWriter.on("error", () => {});

  audioReceiveStream.pipe(decodingStream).pipe(fileWriter);

  //This event gets emitted by us
  audioReceiveStream.on("finish_recording", (interaction) => {
    clearAudioReceiveStream(audioReceiveStream, usernameAndId);

    const handleAudio = async () => {
      const audioDuration = await getAudioDuration(files);
      console.log(`ℹ️ Audio duration: ${audioDuration}`);

      if (audioDuration < 0.01) {
        console.log(`❌ Recording is too short: ${files.audiofileTemp}`);

        let reply;
        if (interaction.member.voice.selfMute) reply = "Unmute yourself first!";
        else reply = "Say something, to send it!";

        interaction.reply({
          content: reply,
          ephemeral: true,
        });
        abortRecording(files, audioReceiveStream, usernameAndId);

        tryClearExcessMessages(usernameAndId);

        return;
      }

      if (typeof interaction.deferUpdate === "function")
        interaction.deferUpdate();

      generateImageFromRecording(member, files, audioDuration, () => {
        createAndSendVideo(interaction, usernameAndId, files, () =>
          cleanupFiles(files)
        );

        recordingCount += 1;
        console.log("ℹ️ Recordings sent: " + recordingCount);
        appendInfoToTelemetryFile(interaction, usernameAndId, audioDuration);

        clearAudioReceiveStream(audioReceiveStream, usernameAndId);
      });
    };

    const stoppedTimer = tryStopMaxVoiceRecordingTimeIfNeeded(userId);
    if (stoppedTimer) {
      fileWriter.end(() => handleAudio());
    } else handleAudio();
  });

  //This event gets emitted by us
  audioReceiveStream.on("abort_recording", (userId) => {
    const stoppedTimer = tryStopMaxVoiceRecordingTimeIfNeeded(userId);

    if (stoppedTimer) {
      fileWriter.end(() =>
        abortRecording(files, audioReceiveStream, usernameAndId)
      );
    } else {
      abortRecording(files, audioReceiveStream, usernameAndId);
    }
  });

  const maxRecordTimeSecs = maxRecordingTimeForUserInGuild(member);
  maxVoiceNoteTimerByUserIds[member.id] = setTimeout(() => {
    recordStartMessage
      .reply(
        `<@${member.id}> You have reached your max recording time of: ${maxRecordTimeSecs} seconds. \n You can still send or cancel.`
      )
      .then((message) => markExcessMessage(usernameAndId, message));
    fileWriter.end();

    clearTimeout(maxVoiceNoteTimerByUserIds[member.id]);
    delete maxVoiceNoteTimerByUserIds[member.id];
  }, maxRecordTimeSecs * 1000);

  audioReceiveStreamByUser[usernameAndId] = audioReceiveStream;
}

function abortRecording(files, audioReceiveStream, usernameAndId) {
  cleanupFiles(files);
  clearAudioReceiveStream(audioReceiveStream, usernameAndId);
  console.log(`❌ Aborted recording of ${files.audiofileTemp}`);
}

function createVoiceRecorderChannel(guild) {
  return guild.channels.create({
    name: voiceRecorderVoiceChannel,
    type: ChannelType.GuildVoice,
  });
}

async function generateInviteLinkToVoiceCordChannel(guild) {
  const getInviteLink = async (voiceCordChannel) => {
    const invite = await voiceCordChannel.createInvite();
    const link = `https://discord.gg/${invite.code}`;
    return link;
  };

  const voiceRecorderChannel = await findOrCreateVoiceRecorderChannel(guild);
  if (voiceRecorderChannel) return getInviteLink(voiceRecorderChannel);
  else {
    const channel = await createVoiceRecorderChannel(guild);
    return getInviteLink(channel);
  }
}

function editRecordingStartMessageToRecording(message, name, usernameAndId) {
  const buttons = [
    registerSendButton(usernameAndId),
    registerCancelButton(usernameAndId),
  ];

  if (!message.channel.isThread())
    buttons.push(registerCreateThreadButton(usernameAndId));

  message.edit({
    content: name + " is recording!",
    components: [row(...buttons)],
  });
}

function startRecordingUser(
  member,
  usernameAndId,
  recordStartMessage,
  isThread
) {
  const channel = member?.voice.channel;
  const memberId = member.id;

  const voiceConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    selfDeaf: false,
    selfMute: true,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  connectedVoiceByChannelId[channel.id] = voiceConnection;

  const receiver = voiceConnection.receiver;
  startVoiceNoteRecording(
    receiver,
    memberId,
    usernameAndId,
    member,
    recordStartMessage
  );

  usersRequestedButtons = [];
  tryClearExcessMessages(usernameAndId);

  if (!isThread) {
    editRecordingStartMessageToRecording(
      recordStartMessage,
      member.displayName,
      usernameAndId
    );

    markExcessMessage(usernameAndId, recordStartMessage);
  }
}

async function moveUserToVoiceCordVCIfNeeded(member, usernameAndId) {
  const voice = member?.voice;
  const recorderChannel = await findOrCreateVoiceRecorderChannel(member.guild);
  recordingUsersInitialChannel[usernameAndId] = voice.channel;
  if (voice.channelId === recorderChannel.id) return Promise.resolve();
  else return voice.setChannel(recorderChannel);
}

function moveUserIfNeededAndRecord(
  member,
  usernameAndId,
  recordStartMessage,
  isThread
) {
  console.log(
    `ℹ️ Started recording user: "${usernameAndId}", at: "${currentDateAndTime()}"`
  );

  moveUserToVoiceCordVCIfNeeded(member, usernameAndId).then(() => {
    startRecordingUser(member, usernameAndId, recordStartMessage, isThread);
  });
}

function handleUserRecordStartInteraction(interaction, usernameAndId) {
  if (!interaction.member?.voice?.channel) {
    interaction.reply({
      content: `❌\n Join \`${voiceRecorderVoiceChannel}\` VC first!\nTip: Use the \`${joinVCButtonLabel}\` button`,
      ephemeral: true,
    });

    return false;
  } else if (interaction.member?.voice?.selfMute) {
    interaction.reply({
      content: "❌ Unmute yourself first!",
      ephemeral: true,
    });
  } else if (audioReceiveStreamByUser[usernameAndId]) {
    interaction.reply({
      content: "❌ You are already recording!",
      ephemeral: true,
    });
  } else {
    interaction.deferReply();
    interaction.deleteReply();

    moveUserIfNeededAndRecord(
      interaction.member,
      usernameAndId,
      interaction.message,
      interaction.message.channel.isThread()
    );
    return true;
  }
}

async function respondRecordCommand(message, usernameAndId) {
  const channel = message.channel;
  const guild = message.guild;
  const member = message.member;

  message.delete();

  if (member?.voice.channel) {
    channel
      .send(member.displayName + " is recording!")
      .then((recordStartMessage) => {
        moveUserIfNeededAndRecord(
          member,
          usernameAndId,
          recordStartMessage,
          false
        );
      });
  } else {
    const buttons = [await createJoinVcButton(guild)];

    if (!message.channel.isThread())
      buttons.push(registerCreateThreadButton(usernameAndId));

    channel
      .send({
        content: member.displayName + " wants to record!",
        components: [row(buttons)],
      })
      .then((recordStartMessage) => {
        recordStartMessageByUsersToRecordOnceEnteringVC[usernameAndId] =
          recordStartMessage;
      });
  }
}

function ignoreOrRespondToRecordCommand(message) {
  const usernameAndId = findUsernameAndId(message.author.id);
  if (!audioReceiveStreamByUser[usernameAndId]) {
    tryClearExcessMessages(usernameAndId);
    respondRecordCommand(message, usernameAndId);
  }
}

function wasOnlyBotMentioned(message) {
  return "<@" + client.user.id + ">" === message.content;
}

client.on("messageCreate", (message) => {
  const contentLowerCase = message.content.toLowerCase();

  if (
    contentLowerCase === recordCommand ||
    contentLowerCase === recordAlternativeCommand ||
    wasOnlyBotMentioned(message)
  ) {
    ignoreOrRespondToRecordCommand(message);
  } else if (contentLowerCase === helpCommand) {
    message.reply(`Record by typing \`${recordCommand}\``);
  } else if (message.content.length > 1000 && Math.random() < 0.5) {
    message.reply(
      `Tired of sending long messages? Try VoiceCord by typing \`${recordCommand}\``
    );
  }
});

client.on("interactionCreate", (interaction) => {
  if (!interaction.isButton()) return;

  const usernameAndId = findUsernameAndId(interaction.member.id);
  if (interaction.customId.includes(usernameAndId)) {
    const buttonTypeId = interaction.customId.substring(
      usernameAndId.length,
      interaction.customId.length
    );
    if (buttonIdsToFunctions[buttonTypeId](interaction, usernameAndId)) {
      const indexToRemove = usersRequestedButtons.indexOf(
        usernameAndId + interaction.customId
      );
      usersRequestedButtons.splice(indexToRemove, 1);
    }
  } else {
    interaction.reply({
      content: `Type \`${recordCommand}\`, and try again!`,
      ephemeral: true,
    });
  }
});

function leaveVoiceChannelIfNotRecording() {
  if (Object.keys(audioReceiveStreamByUser).length === 0) {
    client?.voice.disconnect();
  }
}

function abortRecordingAndLeaveVoiceChannelIfNotRecording(member, botVoice) {
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  tryClearExcessMessages(usernameAndId);

  if (audioReceiveStream) {
    audioReceiveStream.emit("abort_recording", member.id);

    leaveVoiceChannelIfNotRecording(botVoice);
  }
}

function didRecordingUserLeaveChannelAndNowEmpty(oldState, newState) {
  const botVoice = connectedVoiceByChannelId[oldState.channelId];

  const hasElseThanBotChangedVoiceState = oldState.id !== client.user.id;
  const hasChangedChannel = oldState.channelId !== newState.channelId;
  const hasRecordingUserLeftChannelWithBot =
    hasChangedChannel && botVoice && hasElseThanBotChangedVoiceState;

  return { hasRecordingUserLeftChannelWithBot, botVoice };
}

async function didMoveIntoVoiceRecorderChannel(oldState, newState) {
  const voiceRecorderChannelId = (
    await findOrCreateVoiceRecorderChannel(newState.guild)
  )?.id;

  return (
    oldState.channelId !== voiceRecorderChannelId &&
    newState.channelId === voiceRecorderChannelId
  );
}

function isVoiceDeafened(voiceState) {
  return voiceState.member?.voice.deaf;
}

async function shouldUndeafVoice(voiceState) {
  const voiceRecorderChannelId = (
    await findOrCreateVoiceRecorderChannel(voiceState.guild)
  )?.id;

  return (
    membersToUndeafOnceLeavingVoiceRecorderChannel.find(
      (member) => member.id === voiceState.member.id
    ) &&
    voiceState.channelId !== voiceRecorderChannelId &&
    voiceState.channelId
  );
}

function undeafenMember(member) {
  const voice = member?.voice;
  membersToUndeafOnceLeavingVoiceRecorderChannel =
    membersToUndeafOnceLeavingVoiceRecorderChannel.filter(
      (mem) => mem.id !== member.id
    );
  voice.setDeaf(false);
}

function moveToInitialVCIfNeeded(usernameAndId, member) {
  if (member?.voice) {
    member?.voice.setChannel(recordingUsersInitialChannel[usernameAndId]);
  }
}

async function createThread(interaction, usernameAndId) {
  const guildAndUserId = interaction.guild.id + interaction.user.id;
  if (createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId]) {
    interaction.reply({
      content: "Hold on there partner! Creating threads too fast ⚡️🏃🏻💨 kek",
      ephemeral: true,
    });
    return;
  }

  createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId] = setTimeout(
    () => {
      delete createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId];
    },
    createThreadTimeoutMs
  );

  interaction.message.edit({
    components: [],
  });

  const newThreadName = threadName + ` ${usernameAndId}`;
  interaction.channel?.threads?.cache
    ?.find((thread) => thread.name === newThreadName)
    ?.delete();

  const thread = await interaction.message.startThread({
    name: newThreadName,
  });

  const buttons = [
    registerRecordButton(usernameAndId),
    registerSendButton(usernameAndId),
    registerCancelButton(usernameAndId),
  ];

  if (!interaction.member?.voice?.channel) {
    buttons.splice(0, 0, await createJoinVcButton(interaction.guild));
  }

  thread.send({
    content: "Record multiple voice notes here!",
    components: [row(buttons)],
  });
  //TODO: archive the newly created thread
  // .then(() => thread.setArchived(true));
}

function cancelRecording(interaction, _usernameAndId) {
  const member = interaction.member;
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  if (!audioReceiveStream) {
    interaction.reply({
      content: "Cannot cancel when not recording",
      ephemeral: true,
    });
    return;
  }

  interaction.deferReply();
  interaction.deleteReply();

  audioReceiveStream.emit("abort_recording", interaction.member.id);

  if (member?.voice) {
    moveToInitialVCIfNeeded(usernameAndId, member);
  }

  const channelTheBotIsIn = connectedVoiceByChannelId[member?.voice?.channelId];
  if (channelTheBotIsIn) {
    tryClearExcessMessages(usernameAndId);
    leaveVoiceChannelIfNotRecording();
  }

  return true;
}

function deafenMember(member) {
  membersToUndeafOnceLeavingVoiceRecorderChannel.push(member);
  member?.voice.setDeaf(true);
}

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member.id === client.user.id) return;

  if ((await shouldUndeafVoice(newState)) && oldState.deaf) {
    undeafenMember(newState.member);
  } else if (await didMoveIntoVoiceRecorderChannel(oldState, newState)) {
    if (!oldState.deaf) {
      deafenMember(newState.member);
    }

    const usernameAndId = findUsernameAndId(newState.member.id);
    const recordStartMessage =
      recordStartMessageByUsersToRecordOnceEnteringVC[usernameAndId];
    if (recordStartMessage) {
      moveUserIfNeededAndRecord(
        newState.member,
        usernameAndId,
        recordStartMessage,
        recordStartMessage.hasThread
      );
      delete recordStartMessageByUsersToRecordOnceEnteringVC[usernameAndId];
    }
  }

  const { hasRecordingUserLeftChannelWithBot, botVoice } =
    didRecordingUserLeaveChannelAndNowEmpty(oldState, newState);

  //TODO also abort recording, if user left and there are still some left
  //Because we want to stop a recording of a user, even if others are recording
  if (hasRecordingUserLeftChannelWithBot) {
    abortRecordingAndLeaveVoiceChannelIfNotRecording(oldState.member, botVoice);
  }
});

//Called when stopping PM2 linux *ONLY*, or node.js (NOT NODEMON)
process.on(`SIGINT`, () => {
  membersToUndeafOnceLeavingVoiceRecorderChannel.forEach((member) => {
    undeafenMember(member);
  });
});

client.login(process.env.TOKEN);
