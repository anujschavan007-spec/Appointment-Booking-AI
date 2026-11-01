export interface VadConfig {
  sampleRate: number;
  frameSizeMs: number;
  energyThreshold: number; // RMS threshold
  silenceThresholdMs: number; // Max silence before turn end
  minSpeechDurationMs: number;
}

export class VoiceActivityDetector {
  private config: VadConfig;
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private lastSpeechTime: number = 0;
  private silenceDurationMs: number = 0;

  constructor(customConfig?: Partial<VadConfig>) {
    this.config = {
      sampleRate: 16000,
      frameSizeMs: 20, // 20ms frames
      energyThreshold: 0.015, // Baseline RMS for active speech
      silenceThresholdMs: 220, // Ultra-fast endpointing (220ms vs typical 800ms)
      minSpeechDurationMs: 100,
      ...customConfig,
    };
  }

  /**
   * Process raw 16-bit PCM or Float32 audio samples
   */
  public processFloat32Frame(samples: Float32Array): {
    hasSpeech: boolean;
    speechStarted: boolean;
    speechEnded: boolean;
    rms: number;
  } {
    // Calculate RMS energy
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const now = Date.now();

    let speechStarted = false;
    let speechEnded = false;

    if (rms >= this.config.energyThreshold) {
      this.lastSpeechTime = now;
      if (!this.isSpeaking) {
        this.speechStartTime = now;
        this.isSpeaking = true;
        speechStarted = true;
      }
    } else {
      if (this.isSpeaking) {
        const silence = now - this.lastSpeechTime;
        if (silence >= this.config.silenceThresholdMs) {
          const totalDuration = this.lastSpeechTime - this.speechStartTime;
          if (totalDuration >= this.config.minSpeechDurationMs) {
            speechEnded = true;
          }
          this.isSpeaking = false;
        }
      }
    }

    return {
      hasSpeech: rms >= this.config.energyThreshold,
      speechStarted,
      speechEnded,
      rms,
    };
  }

  public reset(): void {
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
  }
}

