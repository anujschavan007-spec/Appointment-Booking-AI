import { describe, it, expect, beforeEach } from 'bun:test';
import { VoiceReceptionistEngine } from '../src/core/voice_receptionist';
import { ClinicDatabase } from '../src/data/clinic_db';
import { VoiceOrchestrator } from '../src/core/orchestrator';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';
import { GeminiLiveService } from '../src/core/gemini_live';
import { ClinicalSummarizer } from '../src/core/summarizer';

describe('AI Tool Calling in Appointment Booking Workflow', () => {
  let db: ClinicDatabase;
  let receptionist: VoiceReceptionistEngine;
  let orchestrator: VoiceOrchestrator;
  const testSessionId = 'test_tool_session_' + Date.now();

  beforeEach(() => {
    db = new ClinicDatabase();
    db.seedTestDoctors();
    receptionist = new VoiceReceptionistEngine(db);
    const intent = new ClinicalIntentEngine(db);
    const gemini = new GeminiLiveService();
    const summarizer = new ClinicalSummarizer();
    orchestrator = new VoiceOrchestrator(intent, gemini, db, summarizer, receptionist);
  });

  it('should not call book_appointment tool during initial reason and doctor selection', () => {
    const turn1 = receptionist.processTurn(testSessionId + '_pre', 'Namaste Asha, mujhe doctor se milna hai');
    expect(turn1.toolExecuted).not.toBe('book_appointment');
    expect(turn1.appointment).toBeUndefined();

    const turn2 = receptionist.processTurn(testSessionId + '_pre', 'Dr. Priya Mehta ke sath milna hai');
    expect(turn2.toolExecuted).not.toBe('book_appointment');
    expect(turn2.appointment).toBeUndefined();
  });

  it('should execute check_availability tool when verifying doctor slots', () => {
    const sId = testSessionId + '_avail';
    receptionist.processTurn(sId, 'Chest discomfort for 2 days, Dr. Priya Mehta');

    // Query date and time: check_availability should be called
    const turn = receptionist.processTurn(sId, '2026-11-20 ko subah 10:00 baje');
    expect(turn.state.doctorId).toBe('doc_mehta');
    expect(turn.state.dateStr).toBe('2026-11-20');
    expect(turn.state.timeStr).toBe('10:00');
    expect(turn.toolExecuted).not.toBe('book_appointment');
  });

  it('should execute book_appointment tool only in the last step after explicit confirmation', () => {
    const sId = testSessionId + '_full_flow';
    // Step 1: Greeting
    const step1 = receptionist.processTurn(sId, 'Namaste Asha');
    expect(step1.replyText).toContain('Aapko kis problem ke liye doctor se milna hai?');
    expect(step1.toolExecuted).not.toBe('book_appointment');

    // Step 2: Reason & Doctor
    const step2 = receptionist.processTurn(sId, 'Mere chest mein pain hai, Dr. Priya Mehta se milna hai');
    expect(step2.state.doctorId).toBe('doc_mehta');
    expect(step2.toolExecuted).not.toBe('book_appointment');

    // Step 3: Date & Time
    const step3 = receptionist.processTurn(sId, '2026-11-23 ko subah 10:00 baje');
    expect(step3.state.dateStr).toBe('2026-11-23');
    expect(step3.state.timeStr).toBe('10:00');
    expect(step3.toolExecuted).not.toBe('book_appointment');
    expect(step3.replyText).toContain('patient ka poora naam');

    // Step 4: Patient Name
    const step4 = receptionist.processTurn(sId, 'Mera naam Anuj Chavan hai');
    expect(step4.state.patientName).toBe('Anuj Chavan');
    expect(step4.replyText).toContain('phone number');
    expect(step4.toolExecuted).not.toBe('book_appointment');

    // Step 5: Phone Number
    const step5 = receptionist.processTurn(sId, 'Mera phone 9820011223');
    expect(step5.state.patientPhone).toBe('9820011223');
    expect(step5.replyText).toContain('email address spell karke');
    expect(step5.toolExecuted).not.toBe('book_appointment');

    // Step 6: Email Address -> Enters Read-Back for Confirmation
    const step6 = receptionist.processTurn(sId, 'anujchavan007@gmail.com');
    expect(step6.state.patientEmail).toBe('anujchavan007@gmail.com');
    expect(step6.state.awaitingConfirmation).toBe(true);
    expect(step6.toolExecuted).not.toBe('book_appointment');
    expect(step6.replyText).toContain('Sab sahi hai? Book kar doon?');

    // Step 7 (Final Step): Explicit User Confirmation -> Triggers book_appointment tool execution!
    const step7 = receptionist.processTurn(sId, 'Haan sab sahi hai, book kar do');
    expect(step7.actionTaken).toBe('TOOL_BOOK_APPOINTMENT_EXECUTED');
    expect(step7.toolExecuted).toBe('book_appointment');
    expect(step7.toolParameters).toBeDefined();
    expect(step7.toolParameters?.doctorId).toBe('doc_mehta');
    expect(step7.toolParameters?.patientName).toBe('Anuj Chavan');
    expect(step7.toolParameters?.patientPhone).toBe('9820011223');
    expect(step7.toolParameters?.patientEmail).toBe('anujchavan007@gmail.com');

    expect(step7.toolResult).toBeDefined();
    expect(step7.toolResult?.success).toBe(true);
    expect(step7.toolResult?.bookingCode).toMatch(/^APT-\d{6}$/);

    expect(step7.appointment).toBeDefined();
    expect(step7.appointment?.status).toBe('confirmed');
    expect(step7.replyText).toContain('confirm ho gaya hai aur confirmation email bhej diya gaya hai');
  });

  it('should enforce anti-double-booking in book_appointment tool execution', () => {
    // First booking
    const booking1 = receptionist.executeBookAppointment({
      doctorId: 'doc_sharma',
      startAt: '2026-11-28T11:00:00+05:30',
      patientName: 'Sameer Patel',
      patientPhone: '9822334455',
      patientEmail: 'sameer@test.com',
      reason: 'General checkup',
    });
    expect(booking1.bookingCode).toMatch(/^APT-\d{6}$/);

    // Second booking for identical doctor and slot must throw slot error
    expect(() => {
      receptionist.executeBookAppointment({
        doctorId: 'doc_sharma',
        startAt: '2026-11-28T11:00:00+05:30',
        patientName: 'Rohan Verma',
        patientPhone: '9877665544',
        patientEmail: 'rohan@test.com',
        reason: 'Fever consultation',
      });
    }).toThrow('Slot is already booked for this doctor');
  });

  it('should route through VoiceOrchestrator and return toolExecuted and toolResult on final turn', async () => {
    const sId = 'orch_tool_session_' + Date.now();
    // Warm up the receptionist state via orchestrator
    const t1 = await orchestrator.processTurn({
      sessionId: sId,
      patientId: 'patient_orch_1',
      patientName: '',
      userText: 'Dr. Priya Mehta se milna hai 2026-11-30 11:00 baje chest pain ke liye',
    });
    expect(t1.actionTaken).toBe('ASK_PATIENT_NAME');

    const t2 = await orchestrator.processTurn({
      sessionId: sId,
      patientId: 'patient_orch_1',
      patientName: 'Anuj Chavan',
      userText: 'Mera naam Anuj Chavan hai',
    });
    expect(t2.actionTaken).toBe('ASK_PHONE_NUMBER');

    const t3 = await orchestrator.processTurn({
      sessionId: sId,
      patientId: 'patient_orch_1',
      patientName: 'Anuj Chavan',
      userText: 'Mera phone 9811223344',
    });
    expect(t3.actionTaken).toBe('ASK_EMAIL_ADDRESS');

    const t4 = await orchestrator.processTurn({
      sessionId: sId,
      patientId: 'patient_orch_1',
      patientName: 'Anuj Chavan',
      userText: 'anujchavan007@gmail.com',
    });
    expect(t4.actionTaken).toBe('READ_BACK_FOR_CONFIRMATION');

    // Final confirmation turn
    const finalTurn = await orchestrator.processTurn({
      sessionId: sId,
      patientId: 'patient_orch_1',
      patientName: 'Anuj Chavan',
      userText: 'Haan bilkul sahi hai, confirm book kardo',
    });

    expect(finalTurn.toolExecuted).toBe('book_appointment');
    expect(finalTurn.toolResult).toBeDefined();
    expect(finalTurn.toolResult?.success).toBe(true);
    expect(finalTurn.appointmentConfirmed).toBeDefined();
    expect(finalTurn.appointmentConfirmed?.bookingCode).toMatch(/^APT-\d{6}$/);
    expect(finalTurn.appointmentConfirmed?.status).toBe('CONFIRMED');
  });
});
