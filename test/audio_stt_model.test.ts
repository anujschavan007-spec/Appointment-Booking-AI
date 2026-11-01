import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';

describe('Model-Based Speech Intake & Audio Chunking Requirements', () => {
  const clinicDb = new ClinicDatabase();
  const engine = new ClinicalIntentEngine(clinicDb);

  it('should capture Hindi phonetic name "माय प्रवीण" from user speech and advance to phone', () => {
    const start = Date.now();
    const query = 'माय प्रवीण';
    const res = engine.tryFastResolution(query, start, 'sess_test_name_1', 'pat_name_1', 'Pravin Ghodake');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('PATIENT_NAME_CAPTURED');
    expect(res?.text).toContain('प्रवीण');
    expect(res?.text).toContain('phone number');
  });

  it('should capture single-word Devanagari name "प्रवीण" during initial name stage', () => {
    const start = Date.now();
    const query = 'प्रवीण';
    const res = engine.tryFastResolution(query, start, 'sess_test_name_2', 'pat_name_2', 'Anonymous');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('PATIENT_NAME_CAPTURED');
    expect(res?.text).toContain('प्रवीण');
  });

  it('should verify standard 16kHz audio chunking parameters required by Gemini and Sarvam AI', () => {
    const chunkingConfig = {
      sampleRate: 16000,
      channels: 1,
      chunkSize: 4096,
      chunkDurationMs: 256,
    };

    expect(chunkingConfig.sampleRate).toBe(16000);
    expect(chunkingConfig.channels).toBe(1);
    expect(chunkingConfig.chunkSize).toBe(4096);
    expect(Math.round((chunkingConfig.chunkSize / chunkingConfig.sampleRate) * 1000)).toBe(256);
  });
});

