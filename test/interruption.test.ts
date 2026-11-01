import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';
import { GeminiLiveService } from '../src/core/gemini_live';
import { ClinicalSummarizer } from '../src/core/summarizer';
import { VoiceOrchestrator } from '../src/core/orchestrator';

describe('Interruption Handling (Barge-in / Full Duplex)', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const fastIntent = new ClinicalIntentEngine(clinicDb);
  const geminiLive = new GeminiLiveService(undefined, clinicDb);
  const summarizer = new ClinicalSummarizer(undefined, clinicDb);
  const orchestrator = new VoiceOrchestrator(fastIntent, geminiLive, clinicDb, summarizer);

  it('should track barge-in and cancel ongoing clinical turn immediately', async () => {
    expect(orchestrator.interruptions).toBe(0);

    // Start a simulated turn
    const turnPromise = orchestrator.processTurn({
      userText: 'Mujhe bukhar hai...',
      sessionId: 'sess_barge_1',
      patientId: 'pat_barge_1',
      patientName: 'Pravin',
      vadLatencyMs: 20,
    });

    // Patient interrupts before speech completes
    orchestrator.handleBargeIn();

    expect(orchestrator.interruptions).toBe(1);

    const result = await turnPromise;
    expect(result).toBeDefined();
  });

  it('should allow uninterrupted turn after previous barge-in', async () => {
    const res = await orchestrator.processTurn({
      userText: 'Dr. Sharma appointment kal book kardo',
      sessionId: 'sess_barge_2',
      patientId: 'pat_barge_2',
      patientName: 'Pravin',
      vadLatencyMs: 20,
    });
    expect(res.isComplete).toBe(true);
    expect(res.text).toContain('Dr. Rajesh Sharma');
    expect(res.text).toContain('APT-');
  });

  it('should support admin toggle for voice interruption (allowInterruption on/off)', async () => {
    // 1. Check default settings
    const getRes = await fetch('http://localhost:3000/api/admin/settings', {
      headers: { 'Cookie': 'mira_user_email=anujschavan007@gmail.com' },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(typeof getData.allowInterruption).toBe('boolean');

    // 2. Turn interruption OFF
    const disableRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ allowInterruption: false }),
    });
    expect(disableRes.status).toBe(200);
    const disableData = await disableRes.json();
    expect(disableData.success).toBe(true);
    expect(disableData.allowInterruption).toBe(false);

    // 3. Verify /api/consultation/config reflects interruption is disabled
    const configRes = await fetch('http://localhost:3000/api/consultation/config');
    expect(configRes.status).toBe(200);
    const configData = await configRes.json();
    expect(configData.allowInterruption).toBe(false);

    // 4. Turn interruption back ON
    const enableRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ allowInterruption: true }),
    });
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    expect(enableData.success).toBe(true);
    expect(enableData.allowInterruption).toBe(true);

    // 5. Verify /api/consultation/config reflects interruption is re-enabled
    const reConfigRes = await fetch('http://localhost:3000/api/consultation/config');
    const reConfigData = await reConfigRes.json();
    expect(reConfigData.allowInterruption).toBe(true);
  });
});
