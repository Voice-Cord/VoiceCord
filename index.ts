import {
  EndBehaviorType,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioReceiveStream,
  type AudioReceiveStreamOptions,
  type VoiceConnection,
  type VoiceReceiver,
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
  type VoiceState,
} from 'discord.js';
import { getAudioDurationInSeconds } from 'get-audio-duration';
import { Transform, type TransformOptions } from 'stream';
import { FileWriter } from 'wav';

import { OpusEncoder } from '@discordjs/opus';

import 'dotenv/config';

import * as Canvas from '@napi-rs/canvas';
import * as fs from 'fs';
import * as req from 'request';
const request = req.defaults({ encoding: null });

import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
const ffmpegPath = ffmpegInstaller.path;
ffmpeg.setFfmpegPath(ffmpegPath);

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

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
  'Username + Tag | UserId | Audio Duration | Guild | Channel | Date | Recording count\n';

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
const createdThreadsByUserIds: Record<string, ThreadChannel | null> = {};
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

async function allowThreadCreationIfPremium(
  message: Message,
  buttons: ButtonBuilder[],
  usernameAndId: string
): Promise<void> {
  if (
    !message.channel.isThread() &&
    message.member !== null &&
    (await isPremiumUserOrServer(message.member))
  ) {
    buttons.push(registerCreateThreadButton(usernameAndId));
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if ((await message.fetch(true).catch()) !== null) {
      message
        .edit({
          components: [row(...buttons)],
        })
        .catch(() => {
          /* Do nothing */
        });
    }
  }
}

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
        // For some reason istextbased can sometimes be not a function, even though type defines it
        typeof _channel.isTextBased == "function" &&
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
        .catch((e) => console.trace(e));
    }

    guild.leave().catch((e) => console.trace(e));
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
      if (member.voice.deaf == false && member.id !== client.user?.id) {
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

Canvas.GlobalFonts.registerFromPath('../fonts/Comfortaa-SemiBold.ttf');

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
    console.log(
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

    message.delete().catch((e) => console.trace(e));
  });

  delete excessMessagesByUser[usernameAndId];
}

const premiumRecordTimeSecs = 3600;
const defaultRecordTimeSecs = 20;

async function isPremiumUserOrServer(member: GuildMember): Promise<{ serverPremium: boolean; userPremium: boolean; }> {
  const userId = member.id;
  const serverId = member.guild.id;

  const { data: userData } = await supabase
    .from('user-subscriptions')
    .select('user_id')
    .eq('user_id', userId);

  if (userData?.length === 0) {
    const { data: serverData } = await supabase
      .from('server-subscriptions')
      .select('server_id')
      .eq('server_id', serverId);

    if (serverData?.length === 0) {
      return { serverPremium: false, userPremium: false };
    } else {
      return { serverPremium: true, userPremium: false };
    }
  } else {
    return { serverPremium: false, userPremium: true };
  }
}

// TOOD: This is supposed to make some sort of http call and get the max recording time
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function maxRecordingTime(member: GuildMember): Promise<{ maxRecordTimeSecs: number; serverPremium: boolean; userPremium: boolean; }> {
  const { serverPremium, userPremium } = await isPremiumUserOrServer(member)
  if (serverPremium) {
    return { maxRecordTimeSecs: premiumRecordTimeSecs, serverPremium, userPremium };
  } else {
    return { maxRecordTimeSecs: defaultRecordTimeSecs, serverPremium, userPremium };
  }
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
  await fs.promises.writeFile(files.imagefileTemp, await canvas.encode('jpeg', 100));
  callback();
}

// eslint-disable-next-line max-lines-per-function, max-statements
async function generateImageFromRecording(
  member: GuildMember,
  files: Files,
  audioDuration: number,
  userPremium: boolean,
  callback: () => void
): Promise<void> {
  const username = member.displayName;

  /* eslint-disable @typescript-eslint/naming-convention */
  const cnv_s = { x: 412, y: 130 }; // Canvas size
  const cnv_col = userPremium ? '#6397F7' : '#5865f2'; // Canvas color
  const canvas = Canvas.createCanvas(cnv_s.x, cnv_s.y);

  const fnt_s = 1; // Font size, this value is multiplied with every text size
  const mid_y = cnv_s.y / 2; // Vertical middle

  const cnt_col = '#36393f'; // Avatar container color
  const cnt_m = 15; // Avatar container margin
  const cnt_br = 10; // Avatar container border-radius
  const cnt_x = cnt_m; // Avatar container x
  const cnt_y = cnt_m; // Avatar container y
  const cnt_w = cnv_s.x - cnt_m * 2; // Avatar container width
  const cnt_h = cnv_s.y - cnt_m * 2; // Avatar container height

  const avt_ml = 20; // Avatar left margin
  const avt_h = 64; // Avatar height
  const avt_w = 64; // Avatar width
  const avt_x = cnt_m + avt_ml; // Avatar x
  const avt_y = mid_y - avt_h / 2; // Avatar y

  const nme_col = userPremium ? '#FFEFBB' : '#f6f6f6'; // Name color
  let nme_s = (avt_h / 3.4) * fnt_s; // Name size
  const nme_ml = 30; // Name margin left
  const nme_x = avt_ml + avt_w + nme_ml; // Name x
  const nme_y = avt_y + nme_s; // Name y

  const dur_col = userPremium ? '#FFF5AD' : '#5f6166'; // Dur size
  const dur_s = 15 * fnt_s; // Dur size
  const dur_mr = 75; // Dur margin right
  const dur_x = cnt_x + cnt_w - dur_mr; // Dur x
  const dur_y = nme_y; // Dur y

  // "by" refers to the text, which is something like "This was recorded by .."
  const by_col = '#5b5251'; // By color
  const by_s = 9 * fnt_s; // By size
  const by_mt = 4 + by_s; // By top margin
  const by_y = avt_y + avt_h + by_mt; // By y
  const by_x = avt_x; // By x
  /* eslint-enable @typescript-eslint/naming-convention */

  const nameMinimzeThresh = 16;
  const nameMinimizePerChar = 0.6;
  // When name clips over other elements
  if (username.length > nameMinimzeThresh) {
    nme_s -= (username.length - nameMinimzeThresh) * nameMinimizePerChar;
  }

  const ctx = canvas.getContext('2d');

  function font(size: number): string {
    return `demi ${size}px Comfortaa`;
  }

  function addBackgroundAndAvatarContainer(): void {
    ctx.fillStyle = cnv_col;
    ctx.fillRect(0, 0, cnv_s.x, cnv_s.y);

    ctx.fillStyle = cnt_col;
    if(userPremium) {
      ctx.shadowColor = '#162238';
      ctx.shadowBlur = 20;
      const gradient = ctx.createRadialGradient(cnt_x, cnt_y, 100, cnt_x + cnt_w, cnt_y + cnt_h, 100)
      gradient.addColorStop(0, '#2D3954')
      gradient.addColorStop(1, '#2D5B5D')
      ctx.fillStyle = gradient;
    }
    ctx.roundRect(cnt_x, cnt_y, cnt_w, cnt_h, cnt_br);
    ctx.fill();
    ctx.shadowBlur = 0
  }

  addBackgroundAndAvatarContainer();

  function addUsername(): void {
    ctx.font = font(nme_s);
    if(userPremium) {
      const gradient = ctx.createRadialGradient(nme_x, nme_y, 50, cnt_x + cnt_w / 2, cnt_y + cnt_h / 2, 50)
      gradient.addColorStop(0, '#546BBC')
      gradient.addColorStop(1, '#8AF7D5')
      ctx.fillStyle = gradient;
    }
    else ctx.fillStyle = nme_col;
    ctx.fillText(username, nme_x, nme_y);
    ctx.shadowBlur = 0
  }

  function addPremium(): void {
    if(!userPremium) return;
    ctx.shadowColor = '#A8B6D6'
    ctx.shadowBlur = 3
    ctx.fillStyle = '#FFF5AD';
    ctx.font = font(nme_s - 6);
    ctx.fillText("PREMIUM", cnt_x + cnt_w - 82, avt_y + avt_h + 4);
    ctx.shadowBlur = 0
  }

  function addDuration(): void {
    if(userPremium) { ctx.shadowColor = '#A8B6D6'; ctx.shadowBlur = 2; }
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
    if(userPremium) { ctx.shadowColor = '#232428'; ctx.shadowBlur = 30 }
    ctx.drawImage(avatar, avt_x, avt_y, avt_h, avt_w);
    ctx.shadowBlur = 0
    addUsername();
    addDuration();
    addBytext();
    addPremium();

    createImageFileFromCanvas(canvas, files, callback).catch((e) =>
      console.trace(e)
    );
  }

  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions*/
  const avatar: any = new Canvas.Image();
  avatar.onload = addAvatarUsernameDurationLengthBytext;
  avatar.onerror = (err: any): void => console.trace(err);
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

function errorReply(interaction: ButtonInteraction, content: string): void {
  interaction
    .reply({
      content,
      ephemeral: true,
    })
    .catch((e) => console.trace(e));
}

// eslint-disable-next-line complexity
function tryFinishVoiceNoteOrReplyError(
  interaction: ButtonInteraction,
  usernameAndId: string
): boolean {
  const audioReceiveStream = audioReceiveStreamByUser[usernameAndId];
  const member: GuildMember = interaction.member as GuildMember;

  if (member.voice.channel == null && audioReceiveStream == null) {
    errorReply(
      interaction,
      `❌ Join the \`${voiceRecorderVoiceChannel}\` VC, and record with \`${recordCommand}\` before sending!`
    );
  } else if (member.voice.selfMute == true && audioReceiveStream == null) {
    errorReply(interaction, `❌ Unmute yourself, then record before sending!`);
  } else if (member.voice.selfMute == true) {
    errorReply(interaction, `❌ Unmute yourself, talk, then send!`);
  } else if (member.voice.serverMute == true) {
    errorReply(interaction, `❌ You can't record when you are server muted!`);
  } else if (audioReceiveStream == null) {
    errorReply(
      interaction,
      `❌ Record with \`${recordCommand}\` before sending!`
    );
  } else {
    finishVoiceNote(audioReceiveStream, usernameAndId, interaction);
    return true;
  }

  return false;
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
    .outputOptions(['-vcodec mpeg4'])
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
        .catch((e) => console.trace(e));
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
      .catch(() => resolve(0));
  });
}

function cleanupFiles(files: Files): void {
  // fs.unlink(files.imagefileTemp, () => { /* Do nothing */ });
  // fs.unlink(files.audiofileTemp, () => { /* Do nothing */ });
  // fs.unlink(files.videofileFinal, () => { /* Do nothing */ });
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
        console.trace(err);
        return;
      } else {
        console.log(`✅ ${telemetryFile} created!`);
      }
    }

    const listItem = ` ${usernameAndId} | ${
      interaction.member?.user.id as string
    }s | ${audioDuration}s | ${interaction.guild?.name as string} | ${
      (interaction.channel as TextChannel).name
    } | ${currentDateAndTime()} | ${recordingCount}\n`;
    fs.appendFile(telemetryFile, listItem, (err2) => {
      if (err2) {
        console.trace(err2);
      }
    });
  });
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
  let writeFinished = false;

  let userPremium = false;
  let maxRecordTimeSecs = premiumRecordTimeSecs;

  maxRecordingTime(member).then(({ maxRecordTimeSecs: _maxRecordTimeSecs, userPremium: _userPremium }) => {
    console.log(`User: "${member.id}", Record limit: "${maxRecordTimeSecs}s"`);
    maxRecordTimeSecs = _maxRecordTimeSecs
    userPremium = _userPremium
  }).catch((e) => console.trace(e));

  fileWriter.on('data', () => {
    // https://social.msdn.microsoft.com/Forums/windows/en-US/5a92be69-3b4e-4d92-b1d2-141ef0a50c91/how-to-calculate-duration-of-wave-file-from-its-size?forum=winforms
    // time = FileLength / (Sample Rate * Channels * Bits per sample /8)
    const length = fileWriter.file.bytesWritten / (16000 * 1 * 16/8)

    if(length > maxRecordTimeSecs) {
      recordStartMessage
        .edit(
          `<@${member.id}> limit reached ${maxRecordTimeSecs}s. Upgrade at https://voicecord.app/upgrade`
        )
        .catch((e) => console.trace(e));
      fileWriter.end(() => { writeFinished = true; });
    }
  });

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
            reply = '❌ Unmute yourself first!';
          } else {
            reply = '❌ Say something, to send it!';
          }

          msgOrInteraction
            .reply({
              content: reply,
              ephemeral: true,
            })
            .catch((e) => console.trace(e));
          abortRecording(files, audioReceiveStream, usernameAndId);

          tryClearExcessMessages(usernameAndId);

          return;
        }

        if ('deferUpdate' in msgOrInteraction) {
          msgOrInteraction.deferUpdate().catch((e) => console.trace(e));
        }

        generateImageFromRecording(member, files, audioDuration, userPremium, () => {
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
        }).catch((e) => console.trace(e));
      }

      if (!writeFinished) {
        fileWriter.end(() => {
          handleAudio().catch((e) => console.trace(e));
          writeFinished = true;
        });
      } else {
        handleAudio().catch((e) => console.trace(e));
        writeFinished = true;
      }
    }
  );

  // This event gets emitted by us
  audioReceiveStream.on('abort_recording', () => {
    if (!writeFinished) {
      fileWriter.end(() => {
        abortRecording(files, audioReceiveStream, usernameAndId)
        writeFinished = true;
      });
    } else {
      abortRecording(files, audioReceiveStream, usernameAndId);
      writeFinished = true;
    }
  });

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

  allowThreadCreationIfPremium(message, buttons, usernameAndId).catch((e) =>
    console.trace(e)
  );

  const newContent = message.content.includes('is recording')
    ? message.content
    : `${name} is recording!`;

  message
    .edit({
      content: newContent,
      components: [row(...buttons)],
    })
    .catch((e) => console.trace(e));
}

function startRecordingUser(
  member: GuildMember,
  usernameAndId: string,
  recordStartMessage: Message,
  isThread: boolean,
  recorderChannel: VoiceChannel
): void {
  const memberId = member.id;

  const voiceConnection = joinVoiceChannel({
    channelId: recorderChannel.id,
    guildId: recorderChannel.guild.id,
    selfDeaf: false,
    selfMute: true,
    adapterCreator: recorderChannel.guild.voiceAdapterCreator,
  });

  const myVoice =
    recordStartMessage.guild?.members.me?.voice ??
    recorderChannel.guild.members.me?.voice;
  if (myVoice?.serverDeaf == true) {
    myVoice.setDeaf(false).catch((e) => console.trace(e));
  }

  connectedVoiceByChannelId[recorderChannel.id] = voiceConnection;

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
): Promise<VoiceChannel> {
  const voice = member.voice;
  const recorderChannel = await findOrCreateVoiceRecorderChannel(member.guild);
  if (voice.channel != null) {
    recordingUsersInitialChannel[usernameAndId] = voice.channel!;
    if (voice.channelId !== recorderChannel.id) {
      voice.setChannel(recorderChannel).catch((e) => console.trace(e));
    }
    return recorderChannel;
  } else {
    console.trace('Channel is null');
    return recorderChannel;
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
    .then((recorderChannel: VoiceChannel) => {
      startRecordingUser(
        member,
        usernameAndId,
        recordStartMessage,
        isThread,
        recorderChannel
      );
    })
    .catch((e) => console.trace(e));
}

function deferDeleteReply(interaction: ButtonInteraction): void {
  interaction
    .deferReply()
    .then(() => {
      interaction.deleteReply().catch((e) => console.trace(e));
    })
    .catch((e) => console.trace(e));
}

function handleUserRecordStartInteraction(
  interaction: ButtonInteraction,
  usernameAndId: string
): boolean {
  const member = interaction.member as GuildMember;

  if (member.voice.channel == null) {
    errorReply(
      interaction,
      `❌ Join \`${voiceRecorderVoiceChannel}\` VC first!\nTip: Use the \`${joinVcButtonLabel}\` button`
    );
  } else if (member.voice.selfMute != false) {
    errorReply(interaction, '❌ Unmute yourself first!');
  } else if (audioReceiveStreamByUser[usernameAndId] != null) {
    errorReply(interaction, '❌ You are already recording!');
  } else {
    deferDeleteReply(interaction);

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

  message.delete().catch((e) => console.trace(e));

  if (member.voice.channel) {
    const text =
      member.voice.selfMute == true
        ? `(Unmute yourself!) ${member.displayName} is recording!`
        : `${member.displayName} is recording!`;
    channel
      .send(text)
      .then((recordStartMessage: Message) => {
        moveUserIfNeededAndRecord(
          member,
          usernameAndId,
          recordStartMessage,
          false
        );
      })
      .catch((e) => console.trace(e));
  } else {
    const buttons = [await createJoinVcButton(guild)];

    allowThreadCreationIfPremium(message, buttons, usernameAndId).catch((e) =>
      console.log(e)
    );

    channel
      .send({
        content: `${member.displayName} wants to record!`,
        components: [row(buttons)],
      })
      .then((recordStartMessage: Message) => {
        recordStartMessageByUsersToRecordOnceEnteringVc[usernameAndId] =
          recordStartMessage;
      })
      .catch((e) => console.trace(e));
  }
}

function ignoreOrRespondToRecordCommand(message: Message): void {
  const usernameAndId = findUsernameAndId(message.author.id);
  if (audioReceiveStreamByUser[usernameAndId] == null) {
    tryClearExcessMessages(usernameAndId);
    respondRecordCommand(message, usernameAndId).catch((e) => console.trace(e));
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
      .catch((e) => console.trace(e));
  } else if (message.content.length > 1000 && Math.random() < 0.5) {
    message
      .reply(
        `Tired of sending long messages? Try VoiceCord by typing \`${recordCommand}\``
      )
      .catch((e) => console.trace(e));
  }
});

client.on('interactionCreate', (interaction: Interaction) => {
  if (!interaction.isButton()) {
    return;
  }

  const member = interaction.member as GuildMember;
  const usernameAndId = findUsernameAndId(member.id);
  if (interaction.customId.includes(usernameAndId)) {
    const buttonTypeId: string = interaction.customId.substring(
      usernameAndId.length,
      interaction.customId.length
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const func = (buttonIdsToFunctions as any)[buttonTypeId];
    // ^^ Above line: Have to cast to any to satisfy typesciprt transpiler on the server for some reason
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
      .catch((e) => console.trace(e));
  }
});

function leaveVoiceChannelIfNotRecording(guildId: string): void {
  if (Object.keys(audioReceiveStreamByUser).length === 0) {
    getVoiceConnection(guildId)?.disconnect();
  }
}

function didRecordingUserLeaveChannelAndNowEmpty(
  oldState: VoiceState,
  newState: VoiceState
): { hasRecordingUserLeftChannelWithBot: boolean } {
  const botVoice: VoiceConnection | null =
    connectedVoiceByChannelId[oldState.channelId!];

  const hasElseThanBotChangedVoiceState = oldState.id !== client.user?.id;
  const hasChangedChannel = oldState.channelId !== newState.channelId;
  const hasRecordingUserLeftChannelWithBot: boolean | null =
    hasChangedChannel && botVoice && hasElseThanBotChangedVoiceState;

  return {
    hasRecordingUserLeftChannelWithBot:
      hasRecordingUserLeftChannelWithBot as boolean,
  };
}

function didMoveIntoVoiceRecorderChannel(
  oldState: VoiceState,
  newState: VoiceState,
  voiceCordChannelid: string
): boolean {
  return (
    oldState.channelId !== voiceCordChannelid &&
    newState.channelId === voiceCordChannelid
  );
}

function didMoveOutOfVoiceRecorderChannel(
  oldState: VoiceState,
  newState: VoiceState,
  voiceCordChannelid: string
): boolean {
  return (
    oldState.channelId === voiceCordChannelid &&
    newState.channelId !== voiceCordChannelid
  );
}

async function shouldUndeafVoice(
  voiceState: VoiceState
): Promise<boolean | undefined> {
  const voiceRecorderChannelId = (
    await findOrCreateVoiceRecorderChannel(voiceState.guild)
  ).id;

  return (
    membersToUndeafOnceLeavingVoiceRecorderChannel.find(
      (member) => member.id === voiceState.member?.id
    ) &&
    voiceState.channelId != null &&
    voiceState.channelId !== voiceRecorderChannelId
  );
}

function undeafenMember(member: GuildMember): void {
  const voice = member.voice;
  membersToUndeafOnceLeavingVoiceRecorderChannel =
    membersToUndeafOnceLeavingVoiceRecorderChannel.filter(
      (mem) => mem.id !== member.id
    );
  if(voice.channel != null)
    voice.setDeaf(false).catch((e) => console.trace(e));
}

function moveToInitialVcIfNeeded(
  usernameAndId: string,
  member: GuildMember
): void {
  if (member.voice.channel != null) {
    member.voice
      .setChannel(recordingUsersInitialChannel[usernameAndId])
      .catch((e) => console.trace(e));
  }
}

// eslint-disable-next-line max-statements
async function createThread(
  interaction: ButtonInteraction,
  usernameAndId: string
): Promise<void> {
  if (interaction.guild?.id == null) {
    console.trace('Tried to access user interaction guild id when it was null');
    return;
  }

  const userId = interaction.user.id;

  const guildAndUserId = `${interaction.guild.id}${userId}`;
  if (createThreadTimeoutTimerByGuildIdAndUserIds[guildAndUserId] != null) {
    interaction
      .reply({
        content: 'Hold on there partner! Creating threads too fast ⚡️🏃🏻💨',
        ephemeral: true,
      })
      .catch((e) => console.trace(e));
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
    .catch((e) => console.trace(e));

  const newThreadName = `${threadName} ${usernameAndId}`;
  (interaction.channel as TextChannel).threads.cache
    .find((thread) => thread.name === newThreadName)
    ?.delete()
    .catch((e) => console.trace(e));

  const thread = await interaction.message.startThread({
    name: newThreadName,
  });

  createdThreadsByUserIds[userId] = thread;

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
    .catch((e) => console.trace(e));
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
    errorReply(interaction, '❌ Cannot cancel when not recording');
    return;
  }

  deferDeleteReply(interaction);

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
  member.voice.setDeaf(true).catch((e) => console.trace(e));
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

    if ((await shouldUndeafVoice(newState)) == true && newState.deaf == true) {
      undeafenMember(newState.member);
    } else {
      const voiceCordChannelId = (
        await findOrCreateVoiceRecorderChannel(newState.guild)
      ).id;
      if (
        didMoveIntoVoiceRecorderChannel(oldState, newState, voiceCordChannelId)
      ) {
        if (oldState.deaf == false) {
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
        }
      } else if (
        didMoveOutOfVoiceRecorderChannel(oldState, newState, voiceCordChannelId)
      ) {
        const thread = createdThreadsByUserIds[newState.id];
        if (thread != null) {
          thread.delete().catch((e) => console.log(e));
          delete createdThreadsByUserIds[newState.id];
        }
      }

      const undeafenedInVoiceCordVc =
        newState.channelId === voiceCordChannelId &&
        oldState.deaf == true &&
        newState.deaf == false;

      if (undeafenedInVoiceCordVc) {
        deafenMember(newState.member);
      }
    }

    const { hasRecordingUserLeftChannelWithBot } =
      didRecordingUserLeaveChannelAndNowEmpty(oldState, newState);

    // TODO also abort recording, if user left and there are still some left
    // Because we want to stop a recording of a user, even if others are recording
    if (hasRecordingUserLeftChannelWithBot) {
      leaveVoiceChannelIfNotRecording(oldState.guild.id);
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
