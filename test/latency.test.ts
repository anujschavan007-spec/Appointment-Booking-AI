import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';
import { GeminiLiveService } from '../src/core/gemini_live';
import { ClinicalSummarizer } from '../src/core/summarizer';
import { VoiceOrchestrator } from '../src/core/orchestrator';

describe('Strict Latency Budget (< 600ms / 800ms) for Clinical Intake', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const fastIntent = new ClinicalIntentEngine(clinicDb);
  const geminiLive = new GeminiLiveService(undefined, clinicDb);
  const summarizer = new ClinicalSummarizer(undefined, clinicDb);
  const orchestrator = new VoiceOrchestrator(fastIntent, geminiLive, clinicDb, summarizer);

  const clinicalQueries = [
    'Hello Mira namaste',
    'Chest pain aur ghabrahat ho rahi hai',
    'Mere skin par spot aur rash hai',
    'Ghutne mein swelling aur haddi mein dard hai',
    'Dr. Sharma ke paas appointment book kardo kal 4 baje',
    'Dr. Priya Mehta available hain kya kal?',
  ];

  for (const q of clinicalQueries) {
    it(`should reply to "${q}" well within 600ms limit`, async () => {
      const startTime = performance.now();
      const response = await orchestrator.processTurn({
        userText: q,
        sessionId: 'sess_lat_test',
        patientId: 'pat_lat_test',
        patientName: 'Pravin',
        vadLatencyMs: 25,
      });
      const executionTime = performance.now() - startTime;

      expect(executionTime).toBeLessThan(600);
      expect(response.latencyBreakdown.totalEndToEndMs).toBeLessThan(600);
      expect(response.text.length).toBeGreaterThan(10);
    });
  }
});
