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

const WEBM_FRAME_MAX_LIMIT = 32766;

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

const voiceRecorderDisplayName = "VoiceCord";
const voiceRecorderBy = "Recorded on Discord by " + voiceRecorderDisplayName;

const joinVCButtonLabel = "🔊 Join VC to record";

const recordButtonId = "record";
const sendButtonId = "send";

const voiceRecorderVoiceChannel = "Voice-Cord";

let voicesToUndeafOnceLeavingVoiceRecorderChannel = [];

const excessMessagesByUser = [];

// The values are: "usernameAndId + <buttonId>"
let usersRequestedButtons = [];

const audioReceiveStreamByUser = {};
const connectedChannelByChannelId = {};

const ffmpegJobs = [];

// The voice channels users have been in, before starting record
const recordingUsersInitialChannel = {};

const buttonIdsToFunctions = {
  [recordButtonId]: handleUserRecordStartAction,
  [sendButtonId]: tryFinishVoiceNoteOrReplyError,
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
  console.log("Bot is ready!");
  await ffmpeg.load();
});

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

function registerSendButton(usernameAndId) {
  const key = usernameAndId + sendButtonId;
  if (usersRequestedButtons.indexOf(key) === -1)
    usersRequestedButtons.push(key);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + sendButtonId)
    .setLabel("📨 Send")
    .setStyle(ButtonStyle.Success);
}

function registerRecordButton(usernameAndId) {
  const key = usernameAndId + recordButtonId;
  if (usersRequestedButtons.indexOf(key) === -1)
    usersRequestedButtons.push(key);

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

async function generateWebPFromRecording(user, files, callback) {
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
  const avt_h = 128; // Img height
  const avt_w = 128; // Img width
  const avt_x = cnt_m + avt_ml; // Img x
  const avt_y = mid_y - avt_h / 2; // Img y

  const nme_col = "#f6f6f6"; // Name color
  const nme_s = (avt_h / 2.7) * fnt_s; // Name size
  const nme_ml = 60; // Name margin left
  const nme_x = avt_ml + avt_w + nme_ml; // Name x
  const nme_y = avt_y + nme_s; // Name y

  const dte_col = "#5f6166"; // Date size
  const dte_s = 30 * fnt_s; // Date size
  const dte_mr = 200; // Date margin right
  const dte_mt = 10; // Date margin right
  const dte_x = cnt_x + cnt_w - dte_mr; // Date x
  const dte_y = avt_y + dte_s + dte_mt; // Date y

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

  const addDate = function () {
    const time = currentTimeFormatted();
    ctx.fillStyle = dte_col;
    ctx.font = font(dte_s);
    ctx.fillText(time, dte_x, dte_y);
  };

  // "by" refers to the text, which is something like "This was recorded by .."
  const addBytext = function () {
    ctx.fillStyle = by_col;
    ctx.font = font(by_s);
    ctx.fillText(voiceRecorderBy, by_x, by_y);
  };

  const add_Avatar_Username_Date_Length_Bytext = function () {
    ctx.drawImage(avatar, avt_x, avt_y, avt_h, avt_w);
    addUsername();
    addDate();
    addBytext();

    createWebPFileFromCanvas(canvas, files, callback);
  };

  const avatar = new Image();
  avatar.onload = add_Avatar_Username_Date_Length_Bytext;
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
  if (interaction.member.voice) {
    interaction.member.voice.setChannel(
      recordingUsersInitialChannel[usernameAndId]
    );
  }
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
  console.log(`✅ Written video ${files.videofileTemp}`);

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
  const filename = `recordings/${date}-${username}`;
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

function stopRecording(audioReceiveStream, usernameAndId) {
  audioReceiveStream.destroy();
  delete audioReceiveStreamByUser[usernameAndId];
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
  audioReceiveStream.on("finish", async (interaction) => {
    fileWriter.end();
    tryClearExcessMessages(usernameAndId);

    const audioDuration = await getAudioDuration(files);
    console.log(`ℹ️ Audio duration: ${audioDuration}`);

    if (audioDuration < 0.01) {
      console.log(`❌ Recording is too short: ${files.audiofileTemp}`);
      interaction.reply({
        content: "You have to say something, to send a voice note!",
        ephemeral: true,
      });
      cleanupFiles(files);

      return;
    }

    interaction.deferUpdate();

    generateWebPFromRecording(
      member,
      files,
      async (webpDataUrlContainerObj) => {
        createAndSendVideo(
          interaction,
          webpDataUrlContainerObj,
          usernameAndId,
          audioDuration,
          files,
          () => cleanupFiles(files)
        );

        stopRecording(audioReceiveStream, usernameAndId);
      }
    );
  });

  audioReceiveStream.on("error", () => {
    abortRecording(files, audioReceiveStream, usernameAndId, fileWriter);
  });

  audioReceiveStreamByUser[usernameAndId] = audioReceiveStream;
}

function abortRecording(files, audioReceiveStream, usernameAndId, fileWriter) {
  fileWriter.end();
  cleanupFiles(files);
  stopRecording(audioReceiveStream, usernameAndId);
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
    const channel = await message.guild.channels.create({
      name: voiceRecorderVoiceChannel,
      type: ChannelType.GuildVoice,
    });
    return getInviteLink(channel);
  }
}

function startRecordingUser(interaction, usernameAndId) {
  const channel = interaction.member.voice.channel;
  const userId = interaction.user.id;

  const connectionChannel = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    selfDeaf: false,
    selfMute: true,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  connectedChannelByChannelId[channel.id] = connectionChannel;

  const receiver = connectionChannel.receiver;
  startVoiceNoteRecording(receiver, userId, interaction);

  usersRequestedButtons = [];
  tryClearExcessMessages(usernameAndId);

  interaction.deferReply();
  interaction.deleteReply();

  interaction.message.edit({
    content: interaction.member.displayName + " is recording!",
    components: [row(registerSendButton(usernameAndId))],
  });
  markExcessMessage(usernameAndId, interaction.message);
}

function moveUserToVoiceCordVCIfNeeded(message, usernameAndId) {
  const voice = message.member.voice;
  const recorderChannel = findVoiceRecorderChannel(message.guild);
  recordingUsersInitialChannel[usernameAndId] = voice.channel;
  if (voice.channel.id === recorderChannel.id) return Promise.resolve();
  else return voice.setChannel(recorderChannel);
}

function handleUserRecordStartAction(interaction, usernameAndId) {
  if (!interaction.member.voice.channel) {
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
  if (message.member.voice.channel) {
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
  const members = message.mentions.members;
  return (
    members.size === 1 && members.find((member) => member.id === client.user.id)
  );
}

client.on("messageCreate", (message) => {
  const contentLowerCase = message.content.toLowerCase();
  if (
    contentLowerCase == ".record" ||
    contentLowerCase == ". record" ||
    wasOnlyBotMentioned(message)
  ) {
    ignoreOrRespondToRecordCommand(message);
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

function abortRecordingAndLeaveVoiceChannel(
  userOldVoiceState,
  botConnectedChannel
) {
  botConnectedChannel.disconnect();
  const usernameAndId = findUsernameAndId(userOldVoiceState.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  tryClearExcessMessages(usernameAndId);

  if (audioReceiveStream) {
    audioReceiveStream.emit("error");
    delete audioReceiveStreamByUser[usernameAndId];

    if (Object.keys(audioReceiveStreamByUser).length === 0);
    getVoiceConnection(userOldVoiceState.guild?.id).disconnect();
  }
}

function didRecordingUserLeaveChannelAndNowEmpty(oldState, newState) {
  const channelTheBotIsIn = connectedChannelByChannelId[oldState.channelId];

  //TODO: Also if check if user exists in recording users dictinoary
  const hasElseThanBotChangedVoiceState = oldState.id !== client.user.id;
  const hasChangedChannel = oldState.channelId !== newState.channelId;
  const nooneRecording = oldState.channel?.members.size === 1; //Check for one, because if user leaves, bot has still not yet left
  const hasEveryRecordingUserLeftChannelWithBot =
    hasChangedChannel &&
    channelTheBotIsIn &&
    hasElseThanBotChangedVoiceState &&
    nooneRecording;

  return { hasEveryRecordingUserLeftChannelWithBot, channelTheBotIsIn };
}

function didMoveIntoVoiceRecorderChannel(oldState, newState) {
  const voiceRecorderChannelId = findVoiceRecorderChannel(newState.guild).id;
  if (
    oldState.channelId !== voiceRecorderChannelId &&
    newState.channelId === voiceRecorderChannelId
  ) {
    return true;
  } else {
    return false;
  }
}

function didMoveOutOfVoiceRecorderChannel(oldState, newState) {
  const voiceRecorderChannelId = findVoiceRecorderChannel(newState.guild).id;
  if (
    oldState.channelId === voiceRecorderChannelId &&
    newState.channelId !== voiceRecorderChannelId
  ) {
    return true;
  } else {
    return false;
  }
}

function isVoiceDeafened(voiceState) {
  return voiceState.member.voice.deaf;
}

function shouldUndeafVoice(voiceState) {
  return voicesToUndeafOnceLeavingVoiceRecorderChannel.includes(
    voiceState.member.id
  );
}

client.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.member.id !== client.user.id) {
    if (
      didMoveIntoVoiceRecorderChannel(oldState, newState) &&
      !isVoiceDeafened(oldState)
    ) {
      voicesToUndeafOnceLeavingVoiceRecorderChannel.push(newState.member.id);
      newState.member.voice.setDeaf(true);
    } else if (
      didMoveOutOfVoiceRecorderChannel(oldState, newState) &&
      shouldUndeafVoice(oldState)
    ) {
      voicesToUndeafOnceLeavingVoiceRecorderChannel =
        voicesToUndeafOnceLeavingVoiceRecorderChannel.filter(
          (id) => id !== newState.member.id
        );
      oldState.member.voice.setDeaf(false);
    }
  }

  //TODO: hasEVERYrecordinguserleftchannelwithbot - test if there is no recording user inside vc anymore
  const { hasEveryRecordingUserLeftChannelWithBot, channelTheBotIsIn } =
    didRecordingUserLeaveChannelAndNowEmpty(oldState, newState);

  if (hasEveryRecordingUserLeftChannelWithBot) {
    abortRecordingAndLeaveVoiceChannel(oldState, channelTheBotIsIn);
  }
});

client.login(process.env.TOKEN);
