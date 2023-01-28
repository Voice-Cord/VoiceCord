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
  Events,
} = require("discord.js");
const { Transform } = require("stream");
const { FileWriter } = require("wav");
const { createFFmpeg, fetchFile } = require("@ffmpeg/ffmpeg");
const wavAudioDuration = require("wav-audio-length").default;

const opus = require("@discordjs/opus");
const { OpusEncoder } = opus;

const fs = require("fs");
const ffmpeg = createFFmpeg({});
const Whammy = require("./whammy");
const Canvas = require("@napi-rs/canvas");
const Image = Canvas.Image;
const path = require("path");
const request = require("request").defaults({ encoding: null });
const sharp = require("sharp");

const telemetryFile = "telemetry/info.txt";
const telemetryTable =
  "Username and Id | Audio Duration | Guild | Channel | Date | Recording count";

const WEBM_FRAME_MAX_LIMIT = 32766;

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

const voiceRecorderDisplayName = "VoiceCord";
const voiceRecorderBy = "Recorded on Discord by " + voiceRecorderDisplayName;

const joinVCButtonLabel = "🔊 Join VC to record";

const recordButtonId = "record";
const sendButtonId = "send";
const cancelButtonId = "cancel";

const voiceRecorderVoiceChannel = "Voice-Cord";

let voicesToUndeafOnceLeavingVoiceRecorderChannel = [];

const excessMessagesByUser = [];

// The values are: "usernameAndId + <buttonId>"
let usersRequestedButtons = [];

const audioReceiveStreamByUser = {};
const connectedVoiceByChannelId = {};

const recordCommand = ".record";
const recordAlternativeCommand = ". record";

const ffmpegJobs = [];

// The voice channels users have been in, before starting record
const recordingUsersInitialChannel = {};

// buttonactions
const buttonIdsToFunctions = {
  [recordButtonId]: handleUserRecordStartAction,
  [sendButtonId]: tryFinishVoiceNoteOrReplyError,
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

client.on("ready", async () => {
  console.log("Bot loaded!");
  await ffmpeg.load();
  console.log("FFmpeg loaded!");
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

function tryClearExcessMessages(usernameAndId) {
  const messages = excessMessagesByUser[usernameAndId];
  if (messages) {
    messages.forEach((message) => {
      message.components?.forEach((actionRow) => {
        actionRow.components?.forEach((button) => {
          if (
            button.custom_id !== undefined &&
            button.style !== ButtonStyle.Link
          )
            usersRequestedButtons.pop(usernameAndId + button.custom_id);
        });
      });

      message.delete();
    });

    delete excessMessagesByUser[usernameAndId];
  }
}

function findVoiceRecorderChannel(guild) {
  return guild.channels.cache.find(
    (channel) => channel.name === voiceRecorderVoiceChannel
  );
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
    .setLabel("❌ Cancel")
    .setStyle(ButtonStyle.Secondary);
}

function registerSendButton(usernameAndId) {
  registerButton(usernameAndId, sendButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + sendButtonId)
    .setLabel("📨 Send")
    .setStyle(ButtonStyle.Success);
}

function registerRecordButton(usernameAndId) {
  registerButton(usernameAndId, recordButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + recordButtonId)
    .setLabel("🎙️ Record")
    .setStyle(ButtonStyle.Danger);
}

async function createWebPFileFromCanvas(canvas, files, callback) {
  // Sharp converts lossless webp format to lossy format
  sharp(await canvas.encode("webp"))
    .toFormat(sharp.format.webp)
    .webp({ quality: 80, lossless: false })
    .toBuffer((_e, webpBuffer) => {
      const webpFrameBase64 = webpBuffer.toString("base64");

      fs.writeFile(files.webpfileTemp, webpFrameBase64, "base64", () => {
        const dataUrlContainer = {
          toDataURL(_imageType, _quality) {
            return "data:image/webp;base64," + webpFrameBase64;
          },
        };

        callback(dataUrlContainer);
      });
    });
}

async function generateWebPFromRecording(user, files, audioDuration, callback) {
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

    createWebPFileFromCanvas(canvas, files, callback);
  };

  const avatar = new Image();
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
  audioReceiveStream.emit("finish", interaction);

  delete audioReceiveStreamByUser[usernameAndId];
  delete recordingUsersInitialChannel[usernameAndId];
}

function tryFinishVoiceNoteOrReplyError(interaction, usernameAndId) {
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  if (!audioReceiveStream) {
    interaction.reply({
      content: "❌ You have to record first! 🎙️",
      ephemeral: true,
    });
    return false;
  } else {
    finishVoiceNote(audioReceiveStream, usernameAndId, interaction);
    return true;
  }
}

async function createAndSendVideo(
  interaction,
  webpDataUrlContainerObj,
  usernameAndId,
  audioDuration,
  files,
  sendCallback
) {
  const video = new Whammy.Video();

  // Have to add 2 frames, so it can be played and seeked on mobile
  video.add(webpDataUrlContainerObj, 30);

  // This is necessary, as one can only add a frame to webm with the max length of 32766 ms.
  const addCalculatedFrameLengths = () => {
    const audioDurationMs = audioDuration * 1000;
    const frames = audioDurationMs / WEBM_FRAME_MAX_LIMIT;

    let curFrameEndMs = 0;
    let curTimeToAdd = 0;

    for (let i = 0; i < frames; i++) {
      if (curFrameEndMs + WEBM_FRAME_MAX_LIMIT > audioDurationMs) {
        curTimeToAdd = audioDurationMs - curFrameEndMs;
      } else {
        curTimeToAdd = WEBM_FRAME_MAX_LIMIT;
        curFrameEndMs += WEBM_FRAME_MAX_LIMIT;
      }

      video.add(webpDataUrlContainerObj, curTimeToAdd);
    }
  };

  addCalculatedFrameLengths();

  const webmBlobArray = video.compile(true);

  fs.writeFileSync(files.videofileTemp, Buffer.from(webmBlobArray));
  console.log(
    `✅ Written video ${files.videofileTemp}, in guild: "` +
      interaction.guild.name +
      `", in channel: "` +
      interaction?.channel?.name +
      `"`
  );

  const combineAudioVideoAndSend = async () => {
    ffmpeg.FS(
      "writeFile",
      "video_t.webm",
      await fetchFile(files.videofileTemp)
    );
    ffmpeg.FS("writeFile", "audio.wav", await fetchFile(files.audiofileTemp));
    await ffmpeg.run(
      "-i",
      "video_t.webm",
      "-i",
      "audio.wav",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "video.mp4"
    );
    await fs.promises.writeFile(
      files.videofileFinal,
      ffmpeg.FS("readFile", "video.mp4")
    );
    console.log(`✅ Combined video and audio ${files.videofileFinal}`);

    interaction.channel
      .send({
        files: [files.videofileFinal],
      })
      .then(() => {
        console.log(`✅ Sent video ${files.videofileFinal}`);
        tryClearExcessMessages(usernameAndId);
        sendCallback();
      });
  };

  ffmpegJobs.push(combineAudioVideoAndSend);

  if (ffmpegJobs.length === 1) {
    await ffmpegJobs[0]();

    // If there has been another ffmpeg request in the meantime, execute them.
    while (ffmpegJobs.length > 1) {
      const job = ffmpegJobs.pop();
      job();
    }

    ffmpegJobs.pop();
  }
}

function generateFileNames(username) {
  const date = currentTimeFormatted().replace(":", "_");
  const filename = `recordings/${date}__${username}`;
  const webpfileTemp = `frames/${username}`;
  const audiofileTemp = filename + `.wav`;
  const videofileTemp = filename + `_t.webm`;
  const videofileFinal = filename + `.mp4`;

  return { audiofileTemp, videofileTemp, videofileFinal, webpfileTemp };
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
  return new Promise((resolve, reject) => {
    fs.readFile(files.audiofileTemp, "binary", (err, content) => {
      if (err) {
        reject(err);
        console.log(err);
        console.log(
          `❌ File "${files.audiofileTemp}" doesn't have audio length`
        );
        return;
      }

      const buffer = Buffer.from(content, "binary");
      const audioDuration = wavAudioDuration(buffer);
      resolve(audioDuration);
    });
  });
}

function cleanupFiles(files) {
  fs.unlink(files.webpfileTemp, () => {});
  fs.unlink(files.audiofileTemp, () => {});
  fs.unlink(files.videofileTemp, () => {});
  fs.unlink(files.videofileFinal, () => {});
}

function clearAudioReceiveStream(audioReceiveStream, usernameAndId) {
  audioReceiveStream.destroy();
  delete audioReceiveStreamByUser[usernameAndId];
}

function appendInfoToTelemetryFile(interaction, usernameAndId, audioDuration) {
  fs.writeFile(telemetryFile, telemetryTable, { flag: "wx" }, function (err) {
    if (err) {
      if (err.code !== "EEXIST") {
        console.log(err);
        return;
      } else {
        console.log(`✅ ${telemetryFile} created!`);
      }
    }

    const listItem = `\n${usernameAndId} | ${audioDuration}s | ${interaction?.guild?.name} | ${interaction?.channel?.name} | ${currentDateAndTime} | ${recordingCount}`;
    fs.appendFile(telemetryFile, listItem, function (err) {
      if (err) console.log(err);
    });
  });
}

function startVoiceNoteRecording(receiver, userId, interaction) {
  const usernameAndId = findUsernameAndId(userId);
  const files = generateFileNames(usernameAndId);
  const member = interaction.member;
  const { fileWriter, stopRecordingManually, decodingStream } =
    prepareRecording(files.audiofileTemp);
  const audioReceiveStream = receiver.subscribe(userId, stopRecordingManually);

  audioReceiveStream.pipe(decodingStream).pipe(fileWriter);

  //Finish is invoked by our code when voice note send action is made by user
  audioReceiveStream.on("finish", (interaction) => {
    fileWriter.end(async () => {
      tryClearExcessMessages(usernameAndId);

      const audioDuration = await getAudioDuration(files);
      console.log(`ℹ️ Audio duration: ${audioDuration}`);

      if (audioDuration < 0.01) {
        console.log(`❌ Recording is too short: ${files.audiofileTemp}`);
        interaction.reply({
          content: "You have to say something, to send a voice note!",
          ephemeral: true,
        });
        abortRecording(files, audioReceiveStream, usernameAndId);

        return;
      }

      interaction.deferUpdate();

      generateWebPFromRecording(
        member,
        files,
        audioDuration,
        (webpDataUrlContainerObj) => {
          createAndSendVideo(
            interaction,
            webpDataUrlContainerObj,
            usernameAndId,
            audioDuration,
            files,
            () => cleanupFiles(files)
          );

          recordingCount += 1;
          console.log("ℹ️ Recordings sent: " + recordingCount);
          appendInfoToTelemetryFile(interaction, usernameAndId, audioDuration);

          clearAudioReceiveStream(audioReceiveStream, usernameAndId);
        }
      );
    });
  });

  //This event gets emitted by us
  audioReceiveStream.on("error", () => {
    fileWriter.end(() =>
      abortRecording(files, audioReceiveStream, usernameAndId)
    );
  });

  audioReceiveStreamByUser[usernameAndId] = audioReceiveStream;
}

function abortRecording(files, audioReceiveStream, usernameAndId) {
  cleanupFiles(files);
  clearAudioReceiveStream(audioReceiveStream, usernameAndId);
  console.log(`❌ Aborted recording of ${files.audiofileTemp}`);
}

async function generateInviteLinkToVoiceCordChannel(guild) {
  const getInviteLink = async (voiceCordChannel) => {
    const invite = await voiceCordChannel.createInvite();
    const link = `https://discord.gg/${invite.code}`;
    return link;
  };

  const voiceRecorderChannel = findVoiceRecorderChannel(guild);
  if (voiceRecorderChannel) return getInviteLink(voiceRecorderChannel);
  else {
    const channel = await guild.channels.create({
      name: voiceRecorderVoiceChannel,
      type: ChannelType.GuildVoice,
    });
    return getInviteLink(channel);
  }
}

function startRecordingUser(interaction, usernameAndId) {
  const channel = interaction.member?.voice.channel;
  const userId = interaction.user.id;

  const voiceConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    selfDeaf: false,
    selfMute: true,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  connectedVoiceByChannelId[channel.id] = voiceConnection;

  const receiver = voiceConnection.receiver;
  startVoiceNoteRecording(receiver, userId, interaction);

  usersRequestedButtons = [];
  tryClearExcessMessages(usernameAndId);

  interaction.deferReply();
  interaction.deleteReply();

  interaction.message.edit({
    content: interaction.member.displayName + " is recording!",
    components: [
      row(
        registerSendButton(usernameAndId),
        registerCancelButton(usernameAndId)
      ),
    ],
  });

  markExcessMessage(usernameAndId, interaction.message);
}

function moveUserToVoiceCordVCIfNeeded(message, usernameAndId) {
  const voice = message.member?.voice;
  const recorderChannel = findVoiceRecorderChannel(message.guild);
  recordingUsersInitialChannel[usernameAndId] = voice.channel;
  if (voice.channelId === recorderChannel.id) return Promise.resolve();
  else return voice.setChannel(recorderChannel);
}

function handleUserRecordStartAction(interaction, usernameAndId) {
  if (!interaction.member?.voice?.channel) {
    interaction.reply({
      content: `❌\nYou first have to join the \`${voiceRecorderVoiceChannel}\` VC!\nPro Tip: Use the button that says \`${joinVCButtonLabel}\``,
      ephemeral: true,
    });

    return false;
  } else {
    moveUserToVoiceCordVCIfNeeded(interaction, usernameAndId).then(() => {
      startRecordingUser(interaction, usernameAndId);
    });

    return true;
  }
}

async function respondRecordCommandWithButtons(message, usernameAndId) {
  const channel = message.channel;

  let components;
  if (message.member?.voice.channel) {
    components = row(registerRecordButton(usernameAndId));
  } else {
    components = row(
      await createJoinVcButton(message.guild),
      registerRecordButton(usernameAndId)
    );
  }

  message.delete();

  channel.send({
    content: message.member.displayName + " wants to record!",
    components: [components],
  });
}

function ignoreOrRespondToRecordCommand(message) {
  const usernameAndId = findUsernameAndId(message.author.id);
  if (!audioReceiveStreamByUser[usernameAndId]) {
    tryClearExcessMessages(usernameAndId);
    respondRecordCommandWithButtons(message, usernameAndId);
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
  } else if (message.content.length > 1000 && Math.random() < 0.5) {
    message.reply(
      `Tired of sending long messages? Try VoiceCord by typing \`${recordCommand}\``
    );
  }
});

client.on("interactionCreate", (interaction) => {
  if (!interaction.isButton()) return;

  const usernameAndId = findUsernameAndId(interaction.user.id);
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
      content: "Type `.record` into chat, and try that again!",
      ephemeral: true,
    });
  }
});

function abortRecordingAndLeaveVoiceChannelIfEmpty(member, botVoice) {
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  tryClearExcessMessages(usernameAndId);

  if (audioReceiveStream) {
    audioReceiveStream.emit("error");

    if (Object.keys(audioReceiveStreamByUser).length === 0) {
      botVoice.disconnect();
    }
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

function didMoveIntoVoiceRecorderChannel(oldState, newState) {
  const voiceRecorderChannelId = findVoiceRecorderChannel(newState.guild)?.id;
  if (
    oldState.channelId !== voiceRecorderChannelId &&
    newState.channelId === voiceRecorderChannelId
  ) {
    return true;
  } else {
    return false;
  }
}

function isVoiceDeafened(voiceState) {
  return voiceState.member?.voice.deaf;
}

function shouldUndeafVoice(voiceState) {
  const voiceRecorderChannelId = findVoiceRecorderChannel(voiceState.guild)?.id;

  return (
    voicesToUndeafOnceLeavingVoiceRecorderChannel.includes(
      voiceState.member.id
    ) &&
    voiceState.channelId !== voiceRecorderChannelId &&
    voiceState.channelId
  );
}

function undeafenUser(memberId, voice) {
  voicesToUndeafOnceLeavingVoiceRecorderChannel =
    voicesToUndeafOnceLeavingVoiceRecorderChannel.filter(
      (id) => id !== memberId
    );
  voice.setDeaf(false);
}

function moveToInitialVCIfNeeded(usernameAndId, member) {
  if (member?.voice) {
    member?.voice.setChannel(recordingUsersInitialChannel[usernameAndId]);
  }
}

function cancelRecording(interaction, _usernameAndId) {
  const member = interaction.member;
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];
  audioReceiveStream.emit("error");

  if (member?.voice) {
    moveToInitialVCIfNeeded(usernameAndId, member);
  }

  const channelTheBotIsIn = connectedVoiceByChannelId[member?.voice?.channelId];
  if (channelTheBotIsIn) {
    abortRecordingAndLeaveVoiceChannelIfEmpty(member, channelTheBotIsIn);
  }

  return true;
}

client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.member.id === client.user.id) return;

  if (
    didMoveIntoVoiceRecorderChannel(oldState, newState) &&
    !isVoiceDeafened(oldState)
  ) {
    voicesToUndeafOnceLeavingVoiceRecorderChannel.push(newState.member.id);
    newState.setDeaf(true);
  } else if (shouldUndeafVoice(newState)) {
    undeafenUser(newState.member.id, newState);
  }

  const { hasRecordingUserLeftChannelWithBot, botVoice } =
    didRecordingUserLeaveChannelAndNowEmpty(oldState, newState);

  //TODO also abort recording, if user left and there are still some left
  //Because we want to stop a recording of a user, even if others are recording
  if (hasRecordingUserLeftChannelWithBot) {
    abortRecordingAndLeaveVoiceChannelIfEmpty(oldState.member, botVoice);
  }
});

client.login(process.env.TOKEN);
