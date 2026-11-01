import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalSummarizer } from '../src/core/summarizer';
import { VoiceOrchestrator } from '../src/core/orchestrator';

describe('Consultation Completion and End Lifecycle', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const summarizer = new ClinicalSummarizer(process.env.GEMINI_API_KEY, clinicDb);

  it('should generate an auto-summary indicating user ended the interview when userEnded is true', async () => {
    const summary = await summarizer.generateSummary({
      sessionId: 'sess_user_ended_1',
      patientId: 'pat_user_ended_1',
      patientName: 'Anuj Chavan',
      transcripts: [
        { speaker: 'Mira', text: 'Namaste Anuj ji, aapko kya takleef ho rahi hai?', timestamp: 1 },
        { speaker: 'Patient', text: 'Mujhe thoda bukhar aur sardi hai', timestamp: 2 },
      ],
      userEnded: true,
      endReason: 'User ended the interview',
    });

    expect(summary).toBeDefined();
    expect(summary.userEnded).toBe(true);
    expect(summary.chiefComplaint).toContain('User Ended Interview');
    expect(summary.doctorRecommendation).toContain('User ended the interview before scheduling an appointment');
    expect(summary.fullClinicalNote).toContain('Interview was concluded by user');
  });

  it('should generate a standard completed summary when appointment is booked and interview ends', async () => {
    const summary = await summarizer.generateSummary({
      sessionId: 'sess_apt_ended_1',
      patientId: 'pat_apt_ended_1',
      patientName: 'Anuj Chavan',
      transcripts: [
        { speaker: 'Mira', text: 'Dr. Rajesh Sharma kal 11:00 AM par uplabdh hain.', timestamp: 1 },
        { speaker: 'Patient', text: 'Haan kal 11 baje ka slot confirm kardo please', timestamp: 2 },
        { speaker: 'Mira', text: 'Aapka appointment APT-123456 confirm ho gaya hai.', timestamp: 3 },
      ],
      userEnded: false,
      endReason: 'Appointment booked',
    });

    expect(summary).toBeDefined();
    expect(summary.userEnded).toBe(false);
    expect(summary.chiefComplaint).not.toContain('User Ended Interview');
  });

  it('should support orchestrator completeConsultation with userEnded flag', async () => {
    const orchestrator = new VoiceOrchestrator(
      {} as any,
      {} as any,
      clinicDb,
      summarizer
    );
    const session = clinicDb.createSession('sess_orch_end', 'pat_orch_end', 'Anuj Chavan');

    const summary = await orchestrator.completeConsultation({
      sessionId: session.id,
      patientId: session.patientId,
      patientName: session.patientName,
      userEnded: true,
      endReason: 'User ended the interview',
    });

    expect(summary.userEnded).toBe(true);
    expect(summary.endReason).toBe('User ended the interview');
  });

  it('should update session status to USER_ENDED and store summary in database', async () => {
    const session = clinicDb.createSession('sess_status_check', 'pat_status_check', 'Anuj Chavan');
    const summary = await summarizer.generateSummary({
      sessionId: session.id,
      patientId: session.patientId,
      patientName: session.patientName,
      transcripts: [{ speaker: 'Mira', text: 'Namaste', timestamp: 1 }],
      userEnded: true,
      endReason: 'User ended the interview',
    });

    session.userEnded = true;
    session.endReason = 'User ended the interview';
    session.status = 'USER_ENDED';
    session.summary = summary;
    clinicDb.updateSession(session);

    const saved = clinicDb.getSession(session.id);
    expect(saved).toBeDefined();
    expect(saved?.status).toBe('USER_ENDED');
    expect(saved?.userEnded).toBe(true);
    expect(saved?.summary?.chiefComplaint).toContain('User Ended Interview');
  });
});
