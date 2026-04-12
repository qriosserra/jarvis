declare module 'opusscript' {
  namespace OpusScript {
    const Application: {
      VOIP: number;
      AUDIO: number;
      RESTRICTED_LOWDELAY: number;
    };
  }
  class OpusScript {
    constructor(sampleRate: number, channels: number, application: number);
    encode(pcm: Buffer, frameSize: number): Buffer;
    decode(data: Buffer): Buffer;
    setBitrate(bitrate: number): void;
    delete(): void;
  }
  export = OpusScript;
}
