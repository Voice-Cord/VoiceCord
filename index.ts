import {
    EndBehaviorType,
    getVoiceConnection,
    joinVoiceChannel,
    type AudioReceiveStream,
    type AudioReceiveStreamOptions,
    type VoiceConnection,
    type VoiceReceiver
} from '@discordjs/voice';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    type ButtonInteraction,
    type ClientUser,
    type Guild,
    type GuildMember,
    type ImageURLOptions,
    type Interaction,
    type Message,
    type TextBasedChannel,
    type TextChannel,
    type ThreadChannel,
    type VoiceBasedChannel,
    type VoiceChannel,
    type VoiceState
} from 'discord.js';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import { Transform, type TransformOptions } from 'stream';
import { FileWriter } from 'wav';

import { OpusEncoder } from '@discordjs/opus';

import 'dotenv/config';

import * as Canvas from '@napi-rs/canvas';
import * as fs from 'fs';
import * as path from 'path';
import * as req from 'request';
const request = req.defaults({ encoding: null });

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
const ffmpegPath = ffmpegInstaller.path;
ffmpeg.setFfmpegPath(ffmpegPath);

class OpusDecodingStream extends Transform {
  private readonly encoder: OpusEncoder;

  public constructor(
    options: TransformOptions | undefined,
    encoder: OpusEncoder
  ) {
    super(options);
    this.encoder = encoder;
  }

  public _transform(
    data: Buffer,
    _encoding: unknown,
    callback: () => void
  ): void {
    this.push(this.encoder.decode(data));
    callback();
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
function secToHHMMSS(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(11, 19);
}

const createThreadTimeoutMs = 20000;

const telemetryFile = 'telemetry/info.txt';
const telemetryTable =
  'Username and Id | Audio Duration | Guild | Channel | Date | Recording count\n';

let recordingCount = 0;

type Files = {
  imagefileTemp: string;
  audiofileTemp: string;
  videofileFinal: string;
};

const email = 'voicecordhelp@gmail.com';
const adminInviteLink =
  'https://discord.com/api/oauth2/authorize?client_id=1068674033832427540&permissions=8&scope=bot%20applications.commands';

const voiceRecorderDisplayName = 'VoiceCord';
const voiceRecorderBy = `Recorded on Discord by ${voiceRecorderDisplayName}`;

const joinVcButtonLabel = '🔊 Join VC to record';
const recordButtonLabel = '🎙️ Record';
const sendButtonLabel = '📨 Send';
const createThreadButtonLabel = '🔄 Create Thread';
const cancelButtonLabel = '❌ Cancel';

const recordButtonId = 'record';
const sendButtonId = 'send';
const cancelButtonId = 'cancel';
const createThreadButtonId = 'create-thread';

const voiceRecorderVoiceChannel = 'Voice-Cord';
const threadName = 'Voice-Cord';

let membersToUndeafOnceLeavingVoiceRecorderChannel: GuildMember[] = [];

// The values are: "usernameAndId + <buttonId>"
let usersRequestedButtons: string[] = [];

// | undefined because eslint makes error, doesnt understand thatn array can
// return null
const maxVoiceNoteTimerByUserIds: Record<string, NodeJS.Timeout | null> = {};
const createThreadTimeoutTimerByGuildIdAndUserIds: Record<
  string,
  NodeJS.Timeout | null
> = {};

const recordStartMessageByUsersToRecordOnceEnteringVc: Record<
  string,
  Message | null
> = {};
const excessMessagesByUser: Record<string, Message[] | null> = {};
const audioReceiveStreamByUser: Record<string, AudioReceiveStream | null> = {};
const connectedVoiceByChannelId: Record<string, VoiceConnection | null> = {};
// The voice channels users have been in, before starting record
const recordingUsersInitialChannel: Record<string, VoiceBasedChannel | null> =
  {};

const helpCommand = '.voicecordhelp';
const recordCommand = '.record';
const recordAlternativeCommand = '. record';

// Buttonactions
const buttonIdsToFunctions = {
  [recordButtonId]: handleUserRecordStartInteraction,
  [sendButtonId]: tryFinishVoiceNoteOrReplyError,
  [createThreadButtonId]: createThread,
  [cancelButtonId]: cancelRecording,
};

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// eslint-disable-next-line max-statements
function leaveGuildIfNotAdmin(guild: Guild): boolean {
  if (
    guild.members.me?.permissions.has(
      PermissionsBitField.Flags.Administrator
    ) == false
  ) {
    if (client.user == null) {
      return true;
    }

    const user: ClientUser = client.user;
    const channel = guild.channels.cache.find(
      (_channel) =>
        _channel.isTextBased() &&
        _channel
          .permissionsFor(user.id)
          ?.has(PermissionsBitField.Flags.SendMessages)
    );
    if (channel != null) {
      (channel as TextBasedChannel)
        .send(
          `I have no admin rights. Use this link: ${adminInviteLink}, or contact us: \`${email}\``
        )
        .catch((e) => console.error(e));
    }

    guild.leave().catch((e) => console.error(e));
    return true;
  }
  return false;
}

client.on('guildCreate', (guild: Guild) => {
  if (!leaveGuildIfNotAdmin(guild)) {
    console.log(`Added to Guild: ${guild.name}, at: ${currentDateAndTime()}`);
  } else {
    console.log(
      `Left Guild: ${
        guild.name
      }, at: ${currentDateAndTime()}, because of no admin permissions.`
    );
  }
});

client.on('ready', () => {
  console.log('Bot loaded!');

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.guilds.cache.forEach(async (guild: Guild) => {
    leaveGuildIfNotAdmin(guild);

    const voicecordVc = await findOrCreateVoiceRecorderChannel(guild);
    voicecordVc.members.forEach((member: GuildMember): void => {
      if (member.voice.deaf == false) {
        deafenMember(member);
      }
    });
  });
});

function currentDateAndTime(): string {
  const dateOb = new Date();

  const date = `0 ${dateOb.getDate()}`.slice(-2);
  const month = `0 ${dateOb.getMonth() + 1}`.slice(-2);
  const year = dateOb.getFullYear();
  const hours = dateOb.getHours();
  const minutes = dateOb.getMinutes();
  const seconds = dateOb.getSeconds();

  return `${year} - ${month} - ${date} ${hours}:${minutes}:${seconds}`;
}

function imageBufferFromUrl(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    request.get(
      url,
      (
        _err,
        _res,
        body: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>
      ): void => {
        resolve(Buffer.from(body));
      }
    );
  });
}

function fontFile(name: string): string {
  return (__filename = path.join(__dirname, '..', 'fonts', name));
}

Canvas.GlobalFonts.registerFromPath(fontFile('Comfortaa-SemiBold.ttf'));

function markExcessMessage(usernameAndId: string, message: Message): void {
  const messages: Message[] | null = excessMessagesByUser[usernameAndId];
  if (messages == null) {
    excessMessagesByUser[usernameAndId] = [message];
  } else {
    messages.push(message);
  }
}

// eslint-disable-next-line capitalized-comments
// function _removeButtonFromMessage(message: Message, buttonId: number): void {
//   const buttonRow: ActionRow<MessageActionRowComponent>[] = [];

//   message?.components?.forEach(
//     (actionRow: ActionRow<MessageActionRowComponent>): void => {
//       actionRow?.components?.forEach((button: any): void => {
//         if (button.data.custom_id !== buttonId) buttonRow.push(button);
//       });
//     }
//   );

//   message.edit({ components: [row(buttonRow)] });
// }

function tryClearExcessMessages(usernameAndId: string): void {
  const messages = excessMessagesByUser[usernameAndId];

  if (messages == null) {
    console.error(
      `Tried to delete messages from user: "${usernameAndId}", when there we none registered`
    );
    return;
  }

  messages.forEach((message: Message) => {
    /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-plus-operands */
    message.components.forEach((actionRow: any) => {
      actionRow.components?.forEach((button: any) => {
        if (
          button.data.custom_id !== null &&
          button.style !== ButtonStyle.Link
        ) {
          const index = usersRequestedButtons.indexOf(
            usernameAndId + button.data.custom_id
          );
          usersRequestedButtons.slice(index, 1);
        }
      });
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/restrict-plus-operands */
    });

    void message.delete().catch((e) => console.error(e));
  });

  delete excessMessagesByUser[usernameAndId];
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const MAX_RECORD_TIME_SECS = 3600;

// TOOD: This is supposed to make some sort of http call and get the max recording time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function maxRecordingTimeForUserInGuild(_member: GuildMember): number {
  return MAX_RECORD_TIME_SECS;
}

async function findOrCreateVoiceRecorderChannel(
  guild: Guild
): Promise<VoiceChannel> {
  let foundChannel = guild.channels.cache.find(
    (channel) => channel.name === voiceRecorderVoiceChannel
  );

  if (foundChannel == null) {
    foundChannel = await createVoiceRecorderChannel(guild);
  }

  return foundChannel as VoiceChannel;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(...components: any): any {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return new ActionRowBuilder().addComponents(...components);
}

async function createJoinVcButton(guild: Guild): Promise<ButtonBuilder> {
  return new ButtonBuilder()
    .setLabel(joinVcButtonLabel)
    .setStyle(ButtonStyle.Link)
    .setURL(await generateInviteLinkToVoiceCordChannel(guild));
}

function registerButton(usernameAndId: string, buttonId: string): void {
  const key = usernameAndId + buttonId;
  if (usersRequestedButtons.includes(key)) {
    usersRequestedButtons.push(key);
  }
}

function registerCancelButton(usernameAndId: string): ButtonBuilder {
  registerButton(usernameAndId, cancelButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + cancelButtonId)
    .setLabel(cancelButtonLabel)
    .setStyle(ButtonStyle.Secondary);
}

function registerCreateThreadButton(usernameAndId: string): ButtonBuilder {
  registerButton(usernameAndId, createThreadButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + createThreadButtonId)
    .setLabel(createThreadButtonLabel)
    .setStyle(ButtonStyle.Secondary);
}

function registerSendButton(usernameAndId: string): ButtonBuilder {
  registerButton(usernameAndId, sendButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + sendButtonId)
    .setLabel(sendButtonLabel)
    .setStyle(ButtonStyle.Success);
}

function registerRecordButton(usernameAndId: string): ButtonBuilder {
  registerButton(usernameAndId, recordButtonId);

  return new ButtonBuilder()
    .setCustomId(usernameAndId + recordButtonId)
    .setLabel(recordButtonLabel)
    .setStyle(ButtonStyle.Danger);
}

async function createImageFileFromCanvas(
  canvas: Canvas.Canvas,
  files: { imagefileTemp: fs.PathLike | fs.promises.FileHandle },
  callback: () => void
): Promise<void> {
  // Sharp converts lossless webp format to lossy format
  await fs.promises.writeFile(files.imagefileTemp, await canvas.encode('jpeg'));
  callback();
}

// eslint-disable-next-line max-lines-per-function, max-statements
async function generateImageFromRecording(
  member: GuildMember,
  files: Files,
  audioDuration: number,
  callback: () => void
): Promise<void> {
  const username = member.displayName;

  /* eslint-disable @typescript-eslint/naming-convention */
  const cnv_s = { x: 826, y: 280 }; // Canvas size
  const cnv_col = '#5865f2'; // Canvas color
  const canvas = Canvas.createCanvas(cnv_s.x, cnv_s.y);

  const fnt_s = 1; // Font size, this value is multiplied with every text size
  const mid_y = cnv_s.y / 2; // Vertical middle

  const cnt_col = '#36393f'; // Avatar container color
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

  const nme_col = '#f6f6f6'; // Name color
  const nme_s = (avt_h / 3.4) * fnt_s; // Name size
  const nme_ml = 60; // Name margin left
  const nme_x = avt_ml + avt_w + nme_ml; // Name x
  const nme_y = avt_y + nme_s; // Name y

  const dur_col = '#5f6166'; // Dur size
  const dur_s = 30 * fnt_s; // Dur size
  const dur_mr = 150; // Dur margin right
  const dur_mt = 10; // Dur margin right
  const dur_x = cnt_x + cnt_w - dur_mr; // Dur x
  const dur_y = avt_y + dur_s + dur_mt; // Dur y

  // "by" refers to the text, which is something like "This was recorded by .."
  const by_col = '#5b5251'; // By color
  const by_s = 20 * fnt_s; // By size
  const by_mt = 10 + by_s; // By top margin
  const by_y = avt_y + avt_h + by_mt; // By y
  const by_x = avt_x; // By x
  /* eslint-enable @typescript-eslint/naming-convention */

  const ctx = canvas.getContext('2d');

  function font(size: number): string {
    return `demi ${size}px Comfortaa`;
  }

  function addBackgroundAndAvatarContainer(): void {
    ctx.fillStyle = cnv_col;
    ctx.fillRect(0, 0, cnv_s.x, cnv_s.y);

    ctx.fillStyle = cnt_col;
    ctx.roundRect(cnt_x, cnt_y, cnt_w, cnt_h, cnt_br);
    ctx.fill();
  }

  addBackgroundAndAvatarContainer();

  function addUsername(): void {
    ctx.fillStyle = nme_col;
    ctx.font = font(nme_s);
    ctx.fillText(username, nme_x, nme_y);
  }

  function addDuration(): void {
    ctx.fillStyle = dur_col;
    ctx.font = font(dur_s);
    ctx.fillText(secToHHMMSS(audioDuration), dur_x, dur_y);
  }

  // "by" refers to the text, which is something like "This was recorded by .."
  function addBytext(): void {
    ctx.fillStyle = by_col;
    ctx.font = font(by_s);
    ctx.fillText(voiceRecorderBy, by_x, by_y);
  }

  function addAvatarUsernameDurationLengthBytext(): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    ctx.drawImage(avatar, avt_x, avt_y, avt_h, avt_w);
    addUsername();
    addDuration();
    addBytext();

    createImageFileFromCanvas(canvas, files, callback).catch((e) =>
      console.error(e)
    );
  }

  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions*/
  const avatar: any = new Canvas.Image();
  avatar.onload = addAvatarUsernameDurationLengthBytext;
  avatar.onerror = (err: any): void => console.error(err);
  avatar.src = <Buffer>await imageBufferFromUrl(
    member.displayAvatarURL(<ImageURLOptions>{
      format: 'jpg',
      dynamic: true,
      size: 64,
    })
  );
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions */
}

function findUsernameAndId(userId: string): string {
  const user = client.users.cache.get(userId);
  if (user) {
    return user.tag;
  } else {
    console.log(`Tried to find user of id: "${userId}", not found.`);
    return '';
  }
}

function finishVoiceNote(
  audioReceiveStream: AudioReceiveStream,
  usernameAndId: string,
  interaction: ButtonInteraction
): void {
  moveToInitialVcIfNeeded(usernameAndId, interaction.member as GuildMember);
  // TODO only disconnect when is empty
  getVoiceConnection(interaction.guildId!)!.disconnect();
  audioReceiveStream.emit('finish_recording', interaction);

  delete audioReceiveStreamByUser[usernameAndId];
  delete recordingUsersInitialChannel[usernameAndId];
}

function tryFinishVoiceNoteOrReplyError(
  interaction: ButtonInteraction,
  usernameAndId: string
): boolean {
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  if (audioReceiveStream == null) {
    interaction
      .reply({
        content: `❌ Record with \`${recordButtonLabel}\` before sending! 🎙️`,
        ephemeral: true,
      })
      .catch((e) => console.error(e));
    return false;
  } else {
    finishVoiceNote(audioReceiveStream, usernameAndId, interaction);
    return true;
  }
}

function createAndSendVideo(
  interactionOrMessage: ButtonInteraction | Message,
  usernameAndId: string,
  files: Files,
  sendCallback: () => void
): void {
  ffmpeg()
    .addInput(files.imagefileTemp)
    .addInput(files.audiofileTemp)
    .output(files.videofileFinal)
    .outputOptions(['-c:v libx264', '-crf 0', '-c:a aac'])
    .on('end', () => {
      console.log(`✅ Combined video and audio ${files.videofileFinal}`);

      let channel: TextChannel;

      if (interactionOrMessage.channel?.isThread() == true) {
        channel = (interactionOrMessage.channel as ThreadChannel)
          .parent as TextChannel;
      } else {
        channel = interactionOrMessage.channel as TextChannel;
        tryClearExcessMessages(usernameAndId);
      }

      channel
        .send({
          files: [files.videofileFinal],
        })
        .then(() => {
          console.log(`✅ Sent video ${files.videofileFinal}`);
          sendCallback();
        })
        .catch((e) => console.error(e));
    })
    .run();
}

function generateFileNames(username: string): Files {
  const date = Date.now();
  const filename = `recordings/${date}_${username}`;
  const imagefileTemp = `${filename}.jpeg`;
  const audiofileTemp = `${filename}.wav`;
  const videofileFinal = `${filename}.mp4`;

  const files: Files = { imagefileTemp, audiofileTemp, videofileFinal };
  return files;
}

function prepareRecording(audiofileTemp: string): {
  fileWriter: FileWriter;
  stopRecordingManually: AudioReceiveStreamOptions;
  decodingStream: OpusDecodingStream;
} {
  const encoder = new OpusEncoder(16000, 1);
  const fileWriter = new FileWriter(audiofileTemp, {
    channels: 1,
    sampleRate: 16000,
  });
  const stopRecordingManually: AudioReceiveStreamOptions = {
    end: {
      behavior: EndBehaviorType.Manual,
    },
  };
  const decodingStream: OpusDecodingStream = new OpusDecodingStream(
    {},
    encoder
  );

  return { fileWriter, stopRecordingManually, decodingStream };
}

function getAudioDuration(files: Files): Promise<number> {
  return new Promise((resolve) => {
    getAudioDurationInSeconds(files.audiofileTemp)
      .then(resolve)
      .catch((e) => console.error(e));
  });
}

function cleanupFiles(files: Files): void {
  fs.unlink(files.imagefileTemp, () => {
    /* Do nothing */
  });
  fs.unlink(files.audiofileTemp, () => {
    /* Do nothing */
  });
  fs.unlink(files.videofileFinal, () => {
    /* Do nothing */
  });
}

function clearAudioReceiveStream(
  audioReceiveStream: AudioReceiveStream,
  usernameAndId: string
): void {
  audioReceiveStream.destroy();
  delete audioReceiveStreamByUser[usernameAndId];
}

function appendInfoToTelemetryFile(
  interaction: ButtonInteraction | Message,
  usernameAndId: string,
  audioDuration: number
): void {
  fs.writeFile(telemetryFile, telemetryTable, { flag: 'wx' }, (err) => {
    if (err) {
      if (err.code !== 'EEXIST') {
        console.error(err);
        return;
      } else {
        console.log(`✅ ${telemetryFile} created!`);
      }
    }

    const listItem = `${usernameAndId} | ${audioDuration}s | ${
      interaction.guild?.name as string
    } | ${
      (interaction.channel as TextChannel).name
    } | ${currentDateAndTime()} | ${recordingCount}\n`;
    fs.appendFile(telemetryFile, listItem, (err2) => {
      if (err2) {
        console.error(err2);
      }
    });
  });
}

function tryStopMaxVoiceRecordingTimeIfNeeded(userId: string): boolean {
  const timer = maxVoiceNoteTimerByUserIds[userId];
  if (timer != null) {
    clearTimeout(timer);
    delete maxVoiceNoteTimerByUserIds.userId;
    return true;
  } else {
    return false;
  }
}

// eslint-disable-next-line max-lines-per-function
function startVoiceNoteRecording(
  receiver: VoiceReceiver,
  userId: string,
  usernameAndId: string,
  member: GuildMember,
  recordStartMessage: Message
): void {
  const files = generateFileNames(usernameAndId);
  const { fileWriter, stopRecordingManually, decodingStream } =
    prepareRecording(files.audiofileTemp);
  const audioReceiveStream = receiver.subscribe(userId, stopRecordingManually);

  fileWriter.on('error', () => {
    /* Do nothing */
  });

  audioReceiveStream.pipe(decodingStream).pipe(fileWriter);

  // This event gets emitted by us
  audioReceiveStream.on(
    'finish_recording',
    (msgOrInteraction: ButtonInteraction | Message) => {
      clearAudioReceiveStream(audioReceiveStream, usernameAndId);

      async function handleAudio(): Promise<void> {
        const audioDuration: number = await getAudioDuration(files);
        console.log(`ℹ️ Audio duration: ${audioDuration}`);

        if (audioDuration < 0.01) {
          console.log(`❌ Recording is too short: ${files.audiofileTemp}`);

          let reply = '';
          if ((msgOrInteraction.member as GuildMember).voice.selfMute == true) {
            reply = 'Unmute yourself first!';
          } else {
            reply = 'Say something, to send it!';
          }

          msgOrInteraction
            .reply({
              content: reply,
              ephemeral: true,
            })
            .catch((e) => console.error(e));
          abortRecording(files, audioReceiveStream, usernameAndId);

          tryClearExcessMessages(usernameAndId);

          return;
        }

        if ('deferUpdate' in msgOrInteraction) {
          msgOrInteraction.deferUpdate().catch((e) => console.error(e));
        }

        generateImageFromRecording(member, files, audioDuration, () => {
          createAndSendVideo(msgOrInteraction, usernameAndId, files, () =>
            cleanupFiles(files)
          );

          recordingCount += 1;
          console.log(`ℹ️ Recordings sent: ${recordingCount}`);
          appendInfoToTelemetryFile(
            msgOrInteraction,
            usernameAndId,
            audioDuration
          );

          clearAudioReceiveStream(audioReceiveStream, usernameAndId);
        }).catch((e) => console.error(e));
      }

      const stoppedTimer = tryStopMaxVoiceRecordingTimeIfNeeded(userId);
      if (stoppedTimer) {
        fileWriter.end(() => {
          void handleAudio().catch((e) => console.error(e));
        });
      } else {
        handleAudio().catch((e) => console.error(e));
      }
    }
  );

  // This event gets emitted by us
  audioReceiveStream.on('abort_recording', (abortedUserId: string) => {
    const stoppedTimer = tryStopMaxVoiceRecordingTimeIfNeeded(abortedUserId);

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
      .then((message) => markExcessMessage(usernameAndId, message))
      .catch((e) => console.error(e));
    fileWriter.end();

    const timer = maxVoiceNoteTimerByUserIds[member.id];
    if (timer != null) {
      clearTimeout(timer);
    } else {
      console.error(
        `Tried clearing timeout from user "${member.id}" when it returned null`
      );
    }
    delete maxVoiceNoteTimerByUserIds[member.id];
  }, maxRecordTimeSecs * 1000);

  audioReceiveStreamByUser[usernameAndId] = audioReceiveStream;
}

function abortRecording(
  files: Files,
  audioReceiveStream: AudioReceiveStream,
  usernameAndId: string
): void {
  cleanupFiles(files);
  clearAudioReceiveStream(audioReceiveStream, usernameAndId);
  console.log(`❌ Aborted recording of ${files.audiofileTemp}`);
}

function createVoiceRecorderChannel(guild: Guild): Promise<VoiceChannel> {
  return guild.channels.create({
    name: voiceRecorderVoiceChannel,
    type: ChannelType.GuildVoice,
  });
}

async function generateInviteLinkToVoiceCordChannel(
  guild: Guild
): Promise<string> {
  async function getInviteLink(
    voiceCordChannel: VoiceChannel
  ): Promise<string> {
    const invite = await voiceCordChannel.createInvite();
    const link = `https://discord.gg/${invite.code}`;
    return link;
  }

  const voiceRecorderChannel = await findOrCreateVoiceRecorderChannel(guild);
  return getInviteLink(voiceRecorderChannel);
}

function editRecordingStartMessageToRecording(
  message: Message,
  name: string,
  usernameAndId: string
): void {
  const buttons = [
    registerSendButton(usernameAndId),
    registerCancelButton(usernameAndId),
  ];

  if (!message.channel.isThread()) {
    buttons.push(registerCreateThreadButton(usernameAndId));
  }

  message
    .edit({
      content: `${name} is recording!`,
      components: [row(...buttons)],
    })
    .catch((e) => console.error(e));
}

function startRecordingUser(
  member: GuildMember,
  usernameAndId: string,
  recordStartMessage: Message,
  isThread: boolean
): void {
  const channel = member.voice.channel as VoiceChannel;
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

async function moveUserToVoiceCordVcIfNeeded(
  member: GuildMember,
  usernameAndId: string
): Promise<void> {
  const voice = member.voice;
  const recorderChannel = await findOrCreateVoiceRecorderChannel(member.guild);
  if (voice.channel != null) {
    recordingUsersInitialChannel[usernameAndId] = voice.channel!;
    if (voice.channelId !== recorderChannel.id) {
      voice.setChannel(recorderChannel).catch((e) => console.error(e));
    }
  } else {
    console.error('Channel is null');
  }
}

function moveUserIfNeededAndRecord(
  member: GuildMember,
  usernameAndId: string,
  recordStartMessage: Message,
  isThread: boolean
): void {
  console.log(
    `ℹ️ Started recording user: "${usernameAndId}", at: "${currentDateAndTime()}"`
  );

  moveUserToVoiceCordVcIfNeeded(member, usernameAndId)
    .then(() => {
      startRecordingUser(member, usernameAndId, recordStartMessage, isThread);
    })
    .catch((e) => console.error(e));
}

function handleUserRecordStartInteraction(
  interaction: ButtonInteraction,
  usernameAndId: string
): boolean {
  const member = interaction.member as GuildMember;
  if (member.voice.channel) {
    interaction
      .reply({
        content: `❌\n Join \`${voiceRecorderVoiceChannel}\` VC first!\nTip: Use the \`${joinVcButtonLabel}\` button`,
        ephemeral: true,
      })
      .catch((e) => console.error(e));

    return false;
  } else if (member.voice.selfMute != false) {
    interaction
      .reply({
        content: '❌ Unmute yourself first!',
        ephemeral: true,
      })
      .catch((e) => console.error(e));
  } else if (audioReceiveStreamByUser[usernameAndId] != null) {
    interaction
      .reply({
        content: '❌ You are already recording!',
        ephemeral: true,
      })
      .catch((e) => console.error(e));
  } else {
    interaction.deferReply().catch((e) => console.error(e));
    interaction.deleteReply().catch((e) => console.error(e));

    moveUserIfNeededAndRecord(
      member,
      usernameAndId,
      interaction.message,
      interaction.message.channel.isThread()
    );
    return true;
  }

  return false;
}

async function respondRecordCommand(
  message: Message,
  usernameAndId: string
): Promise<void> {
  const channel = message.channel;
  const guild = message.guild!;
  const member = message.member!;

  message.delete().catch((e) => console.error(e));

  if (member.voice.channel) {
    channel
      .send(`${member.displayName} is recording!`)
      .then((recordStartMessage: Message) => {
        moveUserIfNeededAndRecord(
          member,
          usernameAndId,
          recordStartMessage,
          false
        );
      })
      .catch((e) => console.error(e));
  } else {
    const buttons = [await createJoinVcButton(guild)];

    if (!message.channel.isThread()) {
      buttons.push(registerCreateThreadButton(usernameAndId));
    }

    channel
      .send({
        content: `${member.displayName} wants to record!`,
        components: [row(buttons)],
      })
      .then((recordStartMessage: Message) => {
        recordStartMessageByUsersToRecordOnceEnteringVc[usernameAndId] =
          recordStartMessage;
      })
      .catch((e) => console.error(e));
  }
}

function ignoreOrRespondToRecordCommand(message: Message): void {
  const usernameAndId = findUsernameAndId(message.author.id);
  if (audioReceiveStreamByUser[usernameAndId] == null) {
    tryClearExcessMessages(usernameAndId);
    respondRecordCommand(message, usernameAndId).catch((e) => console.error(e));
  }
}

function wasOnlyBotMentioned(message: Message): boolean {
  return `<@${client.user!.id}>` === message.content;
}

// eslint-disable-next-line complexity
client.on('messageCreate', (message: Message) => {
  const contentLowerCase = message.content.toLowerCase();

  if (
    contentLowerCase === recordCommand ||
    contentLowerCase === recordAlternativeCommand ||
    wasOnlyBotMentioned(message)
  ) {
    ignoreOrRespondToRecordCommand(message);
  } else if (contentLowerCase === helpCommand) {
    message
      .reply(`Record by typing \`${recordCommand}\``)
      .catch((e) => console.error(e));
  } else if (message.content.length > 1000 && Math.random() < 0.5) {
    message
      .reply(
        `Tired of sending long messages? Try VoiceCord by typing \`${recordCommand}\``
      )
      .catch((e) => console.error(e));
  }
});

client.on('interactionCreate', (interaction: Interaction) => {
  if (!interaction.isButton()) {
    return;
  }

  const member = interaction.member as GuildMember;
  const usernameAndId = findUsernameAndId(member.id);
  if (interaction.customId.includes(usernameAndId)) {
    const buttonTypeId = interaction.customId.substring(
      usernameAndId.length,
      interaction.customId.length
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const func = buttonIdsToFunctions[buttonTypeId];
    if (func != null) {
      // eslint-disable-next-line max-depth, @typescript-eslint/no-unsafe-call
      if (func(interaction, usernameAndId) == true) {
        const indexToRemove = usersRequestedButtons.indexOf(
          usernameAndId + interaction.customId
        );
        usersRequestedButtons.splice(indexToRemove, 1);
      }
    }
  } else {
    interaction
      .reply({
        content: `Type \`${recordCommand}\`, and try again!`,
        ephemeral: true,
      })
      .catch((e) => console.error(e));
  }
});

function leaveVoiceChannelIfNotRecording(guildId: string): void {
  if (Object.keys(audioReceiveStreamByUser).length === 0) {
    getVoiceConnection(guildId)?.disconnect();
  }
}

function abortRecordingAndLeaveVoiceChannelIfNotRecording(
  member: GuildMember
): void {
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  tryClearExcessMessages(usernameAndId);

  if (audioReceiveStream != null) {
    audioReceiveStream.emit('abort_recording', member.id);

    leaveVoiceChannelIfNotRecording(member.guild.id);
  }
}

function didRecordingUserLeaveChannelAndNowEmpty(
  oldState: VoiceState,
  newState: VoiceState
): { hasRecordingUserLeftChannelWithBot: boolean } {
  const botVoice: VoiceConnection | null =
    connectedVoiceByChannelId[oldState.channelId!];

  if (botVoice == null) {
    console.error(
      'Tries to access connected voice from bot, when it does not exist'
    );
  }

  const hasElseThanBotChangedVoiceState = oldState.id !== client.user?.id;
  const hasChangedChannel = oldState.channelId !== newState.channelId;
  const hasRecordingUserLeftChannelWithBot: boolean | null =
    hasChangedChannel && botVoice && hasElseThanBotChangedVoiceState;

  return {
    hasRecordingUserLeftChannelWithBot:
      hasRecordingUserLeftChannelWithBot as boolean,
  };
}

async function didMoveIntoVoiceRecorderChannel(
  oldState: VoiceState,
  newState: VoiceState
): Promise<boolean> {
  const voiceRecorderChannelId = (
    await findOrCreateVoiceRecorderChannel(newState.guild)
  ).id;

  return (
    oldState.channelId !== voiceRecorderChannelId &&
    newState.channelId === voiceRecorderChannelId
  );
}

async function shouldUndeafVoice(voiceState: VoiceState): Promise<unknown> {
  const voiceRecorderChannelId = (
    await findOrCreateVoiceRecorderChannel(voiceState.guild)
  ).id;

  return (
    membersToUndeafOnceLeavingVoiceRecorderChannel.find(
      (member) => member.id === voiceState.member?.id
    ) &&
    voiceState.channelId !== voiceRecorderChannelId &&
    voiceState.channelId
  );
}

function undeafenMember(member: GuildMember): void {
  const voice = member.voice;
  membersToUndeafOnceLeavingVoiceRecorderChannel =
    membersToUndeafOnceLeavingVoiceRecorderChannel.filter(
      (mem) => mem.id !== member.id
    );
  voice.setDeaf(false).catch((e) => console.error(e));
}

function moveToInitialVcIfNeeded(
  usernameAndId: string,
  member: GuildMember
): void {
  if (member.voice.channel != null) {
    member.voice
      .setChannel(recordingUsersInitialChannel[usernameAndId])
      .catch((e) => console.error(e));
  }
}

async function createThread(
  interaction: ButtonInteraction,
  usernameAndId: string
): Promise<void> {
  if (interaction.guild?.id == null) {
    console.error('Tried to user interaction guild id when it was null');
    return;
  }

  const guildAndUserId = `${interaction.guild.id}${interaction.user.id}`;
  if (createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId] != null) {
    interaction
      .reply({
        content: 'Hold on there partner! Creating threads too fast ⚡️🏃🏻💨',
        ephemeral: true,
      })
      .catch((e) => console.error(e));
    return;
  }

  createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId] = setTimeout(
    () => {
      delete createThreadTimeoutTimerByGuildIdAndUserIds.guildAndUserId;
    },
    createThreadTimeoutMs
  );

  interaction.message
    .edit({
      components: [],
    })
    .catch((e) => console.error(e));

  const newThreadName = `${threadName} ${usernameAndId}`;
  (interaction.channel as TextChannel).threads.cache
    .find((thread) => thread.name === newThreadName)
    ?.delete()
    .catch((e) => console.error(e));

  const thread = await interaction.message.startThread({
    name: newThreadName,
  });

  const buttons = [
    registerRecordButton(usernameAndId),
    registerSendButton(usernameAndId),
    registerCancelButton(usernameAndId),
  ];

  if (!(interaction.member as GuildMember).voice.channel) {
    buttons.splice(0, 0, await createJoinVcButton(interaction.guild));
  }

  thread
    .send({
      content: 'Record multiple voice notes here!',
      components: [row(buttons)],
    })
    .catch((e) => console.error(e));
  // TODO: archive the newly created thread
  // .then(() => thread.setArchived(true));
}

function cancelRecording(
  interaction: ButtonInteraction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _usernameAndId: string
): true | undefined {
  const member = interaction.member as GuildMember;
  const usernameAndId = findUsernameAndId(member.id);
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];

  if (audioReceiveStream == null) {
    interaction
      .reply({
        content: 'Cannot cancel when not recording',
        ephemeral: true,
      })
      .catch((e) => console.error(e));
    return;
  }

  interaction.deferReply().catch((e) => console.error(e));
  interaction.deleteReply().catch((e) => console.error(e));

  audioReceiveStream.emit('abort_recording', member.id);

  if (member.voice.channel != null) {
    moveToInitialVcIfNeeded(usernameAndId, member);
  }

  const channelTheBotIsIn = connectedVoiceByChannelId[member.voice.channelId!];
  if (channelTheBotIsIn != null) {
    tryClearExcessMessages(usernameAndId);
    if (interaction.guild?.id != null) {
      leaveVoiceChannelIfNotRecording(interaction.guild.id);
    }
  }

  return true;
}

function deafenMember(member: GuildMember): void {
  membersToUndeafOnceLeavingVoiceRecorderChannel.push(member);
  void member.voice.setDeaf(true);
}

client.on(
  'voiceStateUpdate',
  // eslint-disable-next-line complexity, max-statements
  async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
    if (newState.member?.id === client.user?.id) {
      return;
    }
    if (newState.member == null) {
      return;
    }
    if (oldState.member == null) {
      return;
    }

    if (
      (await shouldUndeafVoice(newState)) != false &&
      oldState.deaf != false
    ) {
      undeafenMember(newState.member);
    } else if (await didMoveIntoVoiceRecorderChannel(oldState, newState)) {
      if (oldState.deaf != false) {
        deafenMember(newState.member);
      }

      const usernameAndId = findUsernameAndId(newState.member.id);
      const recordStartMessage =
        recordStartMessageByUsersToRecordOnceEnteringVc[usernameAndId];
      if (recordStartMessage != null) {
        moveUserIfNeededAndRecord(
          newState.member,
          usernameAndId,
          recordStartMessage,
          recordStartMessage.hasThread
        );
        delete recordStartMessageByUsersToRecordOnceEnteringVc[usernameAndId];
      } else {
        console.error(
          'Tried to user record start message from user when it was null'
        );
      }
    }

    const { hasRecordingUserLeftChannelWithBot } =
      didRecordingUserLeaveChannelAndNowEmpty(oldState, newState);

    // TODO also abort recording, if user left and there are still some left
    // Because we want to stop a recording of a user, even if others are recording
    if (hasRecordingUserLeftChannelWithBot) {
      abortRecordingAndLeaveVoiceChannelIfNotRecording(oldState.member);
    }
  }
);

// Called when stopping PM2 linux *ONLY*, or node.js (NOT NODEMON)
process.on(`SIGINT`, () => {
  membersToUndeafOnceLeavingVoiceRecorderChannel.forEach((member) => {
    undeafenMember(member);
  });
});

client.login(process.env.TOKEN).catch((e) => console.log(e));
