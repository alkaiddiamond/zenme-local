import { describe, expect, it } from "vitest";

import { createRmsWaveform } from "./local-audio-waveform";

function createAudioBuffer(channels: number[][]) {
  return {
    duration: channels[0].length / 10,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
    length: channels[0].length,
    numberOfChannels: channels.length,
  };
}

describe("local audio waveform", () => {
  it("creates a normalized RMS envelope across the complete audio", () => {
    const samples = Array.from(
      { length: 1_000 },
      (_, index) => (index + 1) / 1_000,
    );
    const waveform = createRmsWaveform(
      createAudioBuffer([samples, samples.map((value) => value / 2)]),
      100,
    );

    expect(waveform).toHaveLength(100);
    expect(waveform[0]).toBeLessThan(waveform[50]);
    expect(waveform.at(-1)).toBe(1);
  });

  it("handles silent and empty audio without invalid values", () => {
    expect(createRmsWaveform(createAudioBuffer([Array(100).fill(0)]), 10))
      .toEqual(Array(10).fill(0));
    expect(
      createRmsWaveform({
        duration: 0,
        getChannelData: () => new Float32Array(),
        length: 0,
        numberOfChannels: 0,
      }),
    ).toEqual([]);
  });
});
