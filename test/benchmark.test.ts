import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';
import { GeminiLiveService } from '../src/core/gemini_live';
import { ClinicalSummarizer } from '../src/core/summarizer';
import { VoiceOrchestrator } from '../src/core/orchestrator';

describe('Clinical Consultation Benchmark (Voice Calls & Latency)', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const fastIntent = new ClinicalIntentEngine(clinicDb);
  const geminiLive = new GeminiLiveService(undefined, clinicDb);
  const summarizer = new ClinicalSummarizer(undefined, clinicDb);
  const orchestrator = new VoiceOrchestrator(fastIntent, geminiLive, clinicDb, summarizer);

  const testCalls = [
    {
      id: 'CLINIC-01',
      utterance: 'Hello Mira namaste',
      expectedKeyword: 'MiraAI',
    },
    {
      id: 'CLINIC-02',
      utterance: 'Mujhe kal se chest pain aur heart palpitations ho rahe hain',
      expectedKeyword: 'Dr. Priya Mehta',
    },
    {
      id: 'CLINIC-03',
      utterance: 'Mere skin par red rash aur spot nikal aaya hai',
      expectedKeyword: 'Dr. Anita Desai',
    },
    {
      id: 'CLINIC-04',
      utterance: 'Ghutne mein bohot dard hai aur haddi mein swelling hai',
      expectedKeyword: 'Dr. Arshad Khan',
    },
    {
      id: 'CLINIC-05',
      utterance: 'Bachhe ko tez bukhar hai pediatric doctor se milna hai',
      expectedKeyword: 'Dr. Sunita Verma',
    },
    {
      id: 'CLINIC-06',
      utterance: 'Severe migraine aur sir dard ho raha hai',
      expectedKeyword: 'Dr. Vikram Rao',
    },
    {
      id: 'CLINIC-07',
      utterance: 'Dr. Sharma General Physician ke paas appointment book kardo kal 04:30 PM',
      expectedKeyword: 'APT-',
    },
    {
      id: 'CLINIC-08',
      utterance: 'Wait wait interrupt that, Dr. Mehta Cardiologist ka slot confirm karo',
      expectedKeyword: 'Dr. Priya Mehta',
      isInterruption: true,
    },
  ];

  it('should achieve 100% completion rate and < 600ms latency across all calls', async () => {
    let completed = 0;
    const latencies: number[] = [];

    for (const call of testCalls) {
      if (call.isInterruption) {
        orchestrator.handleBargeIn();
      }

      const t0 = performance.now();
      const res = await orchestrator.processTurn({
        userText: call.utterance,
        sessionId: 'sess_bench_' + call.id,
        patientId: 'pat_bench_01',
        patientName: 'Pravin',
        vadLatencyMs: 25,
      });
      const latencyMs = performance.now() - t0;
      latencies.push(latencyMs);

      const isPass = res.text.toLowerCase().includes(call.expectedKeyword.toLowerCase());
      if (!isPass) {
        console.log(`BENCHMARK CALL FAILED: ${call.id} -> Utterance: "${call.utterance}" | Received: "${res.text}" | Expected: "${call.expectedKeyword}"`);
      }
      if (isPass) completed++;
      expect(isPass).toBe(true);
      expect(latencyMs).toBeLessThan(600);
    }

    expect(completed).toBe(testCalls.length);
    console.log(`\n=== CLINICAL INTAKE BENCHMARK ===`);
    console.log(`Calls Completed: ${completed}/${testCalls.length} (100%)`);
    console.log(`Max Latency: ${Math.round(Math.max(...latencies))} ms (< 600ms target)`);
    console.log(`Avg Latency: ${Math.round(latencies.reduce((a, b) => a + b) / latencies.length)} ms`);
    console.log(`=================================\n`);
  });
});
