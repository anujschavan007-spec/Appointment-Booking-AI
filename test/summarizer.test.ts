import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalSummarizer } from '../src/core/summarizer';

describe('Automated Clinical Summarizer', () => {
  const clinicDb = new ClinicDatabase();
  const summarizer = new ClinicalSummarizer(undefined, clinicDb);

  it('should summarize a cardiac consultation session with urgent priority', async () => {
    const summary = await summarizer.generateSummary({
      sessionId: 'sess_sum_1',
      patientId: 'pat_sum_1',
      patientName: 'Pravin Ghodake',
      transcripts: [
        { speaker: 'Mira', text: 'Namaste Pravin! Aaj aapko kya takleef ho rahi hai?', timestamp: 1 },
        { speaker: 'Patient', text: 'Mujhe chest mein pain hai aur bohot ghabrahat ho rahi hai.', timestamp: 2 },
        { speaker: 'Mira', text: 'Cardiologist Dr. Priya Mehta se consult karna zaroori hai. Appointment book kar di hai.', timestamp: 3 },
      ],
    });

    expect(summary).toBeDefined();
    expect(summary.chiefComplaint).toContain('Chest');
    expect(summary.urgencyLevel).toBe('URGENT');
    expect(summary.doctorRecommendation).toContain('Dr. Priya Mehta');
    expect(summary.suspectedConditions.length).toBeGreaterThan(0);

    // Verify stored in DB
    const stored = clinicDb.getSummary(summary.id);
    expect(stored).toBeDefined();
    expect(stored?.sessionId).toBe('sess_sum_1');
  });

  it('should summarize a dermatology spot consultation with spot visual findings', async () => {
    const summary = await summarizer.generateSummary({
      sessionId: 'sess_sum_2',
      patientId: 'pat_sum_2',
      patientName: 'Anita',
      spotImageUrl: 'data:image/jpeg;base64,sample_spot_image_data',
      transcripts: [
        { speaker: 'Mira', text: 'Namaste Anita! Batayein kya problem hai?', timestamp: 1 },
        { speaker: 'Patient', text: 'Mere skin par red rash aur spot dikh raha hai.', timestamp: 2 },
        { speaker: 'Mira', text: 'Dermatologist Dr. Anita Desai kal 10:30 AM par available hain.', timestamp: 3 },
      ],
    });

    expect(summary).toBeDefined();
    expect(summary.chiefComplaint).toContain('cutaneous');
    expect(summary.spotVisualFindings).toBeDefined();
    expect(summary.doctorRecommendation).toContain('Dr. Anita Desai');
  });
});

