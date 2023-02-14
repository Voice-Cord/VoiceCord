import { describe, expect, test } from "@jest/globals";
import { VoiceState } from "discord.js";
import { mockDeep } from "jest-mock-extended";
import * as app from "..";
// import { client } from "..";

describe("IndexTS", () => {
  test("Given recorded, When leaving voice channel, Should delete users thread", () => {
    const newState = mockDeep<VoiceState>();
    app.client.emit("voiceStateUpdate", mockDeep<VoiceState>(), newState);

    expect(thread.delete).toHaveBeenCalledWith();
  });
});
