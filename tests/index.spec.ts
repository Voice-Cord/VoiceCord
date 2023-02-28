import { describe, test } from '@jest/globals';
import { ButtonInteraction, Message, type VoiceState } from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import * as app from '..';

describe('IndexTS', () => {
  test('Given recorded, When leaving voice channel, Should delete users thread', () => {
    record();
    const newState = mockDeep<VoiceState>();
    app.client.emit('voiceStateUpdate', mockDeep<VoiceState>(), newState);

    // expect(thread.delete).toHaveBeenCalledWith();
  });

  function record(): Message {
    const message = mockDeep<Message>();
    message.content = '.record';
    message.app.client.emit('messageCreate', message);

    const interaction = mockDeep<ButtonInteraction>();
    app.client.emit('interactionCreate', interaction);

    return message;
  }
});
