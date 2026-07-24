export const LOCAL_WAVEFORM_POINTS = 1_000;

type AudioBufferLike = {
  duration: number;
  getChannelData: (channel: number) => Float32Array;
  length: number;
  numberOfChannels: number;
};

export function createRmsWaveform(
  audioBuffer: AudioBufferLike,
  targetPoints = LOCAL_WAVEFORM_POINTS,
) {
  if (audioBuffer.length <= 0 || audioBuffer.numberOfChannels <= 0) {
    return [];
  }

  const pointCount = Math.max(
    1,
    Math.min(Math.floor(targetPoints), audioBuffer.length),
  );
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel),
  );
  const waveform: number[] = [];

  for (let point = 0; point < pointCount; point += 1) {
    const start = Math.floor((point * audioBuffer.length) / pointCount);
    const end = Math.max(
      start + 1,
      Math.floor(((point + 1) * audioBuffer.length) / pointCount),
    );
    const stride = Math.max(1, Math.ceil((end - start) / 2_048));
    let squareSum = 0;
    let sampleCount = 0;

    for (let sample = start; sample < end; sample += stride) {
      for (const channel of channels) {
        const value = channel[sample] ?? 0;
        squareSum += value * value;
        sampleCount += 1;
      }
    }

    waveform.push(sampleCount ? Math.sqrt(squareSum / sampleCount) : 0);
  }

  const ordered = [...waveform].sort((left, right) => left - right);
  const scale = ordered[Math.floor((ordered.length - 1) * 0.98)] || 1;
  return waveform.map((value) => Math.min(1, value / scale));
}

export async function generateLocalAudioWaveform(sourceUrl: string) {
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`无法读取本地音频文件（${response.status}）`);
  }

  const encodedAudio = await response.arrayBuffer();
  if (!encodedAudio.byteLength) {
    throw new Error("本地音频文件为空");
  }

  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext
      .decodeAudioData(encodedAudio)
      .catch(() => {
        throw new Error("当前音频格式无法生成本地波形");
      });
    const waveform = createRmsWaveform(audioBuffer);
    if (!waveform.length) {
      throw new Error("本地音频没有可用的采样数据");
    }

    return {
      duration: audioBuffer.duration,
      waveform,
    };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}
