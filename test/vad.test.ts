import { describe, expect, it } from 'bun:test';
import { VoiceActivityDetector } from '../src/core/vad';

describe('VoiceActivityDetector (VAD & Endpointing)', () => {
  it('should detect silence when RMS is below threshold', () => {
    const vad = new VoiceActivityDetector({ energyThreshold: 0.02 });
    const silentFrame = new Float32Array(320); // 20ms of silence
    silentFrame.fill(0.001);

    const result = vad.processFloat32Frame(silentFrame);
    expect(result.hasSpeech).toBe(false);
    expect(result.speechStarted).toBe(false);
  });

  it('should detect speech onset when RMS exceeds threshold', () => {
    const vad = new VoiceActivityDetector({ energyThreshold: 0.02 });
    const speechFrame = new Float32Array(320);
    // Fill with simulated audio wave
    for (let i = 0; i < speechFrame.length; i++) {
      speechFrame[i] = 0.08 * Math.sin(i * 0.1);
    }

    const result = vad.processFloat32Frame(speechFrame);
    expect(result.hasSpeech).toBe(true);
    expect(result.speechStarted).toBe(true);
  });

  it('should trigger speech end after silence duration reaches threshold', async () => {
    const vad = new VoiceActivityDetector({
      energyThreshold: 0.02,
      silenceThresholdMs: 50,
      minSpeechDurationMs: 20,
    });

    const speechFrame = new Float32Array(320);
    for (let i = 0; i < speechFrame.length; i++) {
      speechFrame[i] = 0.09 * Math.sin(i * 0.1);
    }

    // Start speech
    vad.processFloat32Frame(speechFrame);

    // Wait 30ms with speech continuation
    await new Promise((r) => setTimeout(r, 30));
    vad.processFloat32Frame(speechFrame);

    // Now send silence for > 60ms
    const silentFrame = new Float32Array(320);
    silentFrame.fill(0.0001);

    await new Promise((r) => setTimeout(r, 65));
    const finalResult = vad.processFloat32Frame(silentFrame);

    expect(finalResult.speechEnded).toBe(true);
  });
});

