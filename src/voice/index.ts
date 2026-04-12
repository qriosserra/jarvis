export type {
  VadSegment,
  SpeakerUtterance,
  VoicePipelineConfig,
} from './types.js';
export { DEFAULT_VOICE_CONFIG } from './types.js';

export {
  joinAndListen,
  leaveVoice,
  getActiveConnection,
  setUtteranceHandler,
} from './connection.js';

export { SpeakerPipeline } from './audio-pipeline.js';

export type { VadProcessor, VadOptions } from './vad.js';
export { EnergyVad } from './vad.js';

export {
  isAddressedToJarvis,
  stripBotNamePrefix,
  attributeSpeaker,
  handleVoiceUtterance,
} from './speech-detect.js';

export {
  speak,
  speakAcknowledgement,
  speakWithAcknowledgement,
  destroyPlayer,
} from './playback.js';
export type { LatencyInfo, TimedResponse } from './playback.js';
