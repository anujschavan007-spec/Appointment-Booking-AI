import { describe, it, expect } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { VoiceReceptionistEngine } from '../src/core/voice_receptionist';
import { HinglishDateNormalizer } from '../src/core/date_normalizer';
import { EmailNotificationService } from '../src/services/email_service';

describe('Voice Receptionist & Computed Availability Engine', () => {
  it('should compute free slots from availability minus leaves minus confirmed appointments', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    // Monday is weekday 1. Dr. Sharma is available 10:00 - 18:00 (15 min slots = 32 slots)
    // 2026-11-02 is a Monday
    const slots = db.getFreeSlots('doc_sharma', '2026-11-02');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].time).toBe('10:00');
    expect(slots[0].displayTime).toBe('10:00 AM');
    expect(slots[1].time).toBe('10:15');
  });

  it('should block all slots when doctor has a leave on that date', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const dateStr = '2026-11-02';

    // Verify slots exist initially
    const initialSlots = db.getFreeSlots('doc_sharma', dateStr);
    expect(initialSlots.length).toBeGreaterThan(0);

    // Admin blocks date with leave
    db.addDoctorLeave('doc_sharma', dateStr, 'Medical conference');

    // Free slots must now be 0
    const blockedSlots = db.getFreeSlots('doc_sharma', dateStr);
    expect(blockedSlots.length).toBe(0);

    // Removing leave restores free slots
    const leaves = db.getDoctorLeaves('doc_sharma');
    db.removeDoctorLeave(leaves[0].id);
    const restoredSlots = db.getFreeSlots('doc_sharma', dateStr);
    expect(restoredSlots.length).toBe(initialSlots.length);
  });

  it('should prevent double booking and offer 2 nearest alternative slots when slot is taken', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const doctorId = 'doc_sharma';
    const dateStr = '2026-11-02';
    const slotIso = `${dateStr}T10:00:00+05:30`;

    // 1. Initial check: 10:00 should be free
    const check1 = db.checkDoctorAvailability(doctorId, dateStr, '10:00');
    expect(check1.isFree).toBe(true);
    expect(check1.nearestSlots.some((s) => s.time === '10:00')).toBe(true);

    // 2. Book 10:00 slot
    const apt = db.bookAppointmentRecord({
      doctorId,
      startAt: slotIso,
      patientName: 'Anuj Chavan',
      patientPhone: '9811223344',
      patientEmail: 'anujschavan007@gmail.com',
      reason: 'General checkup',
    });
    expect(apt.bookingCode).toMatch(/^APT-\d{6}$/);

    // 3. Second check at 10:00: should NOT be free
    const check2 = db.checkDoctorAvailability(doctorId, dateStr, '10:00');
    expect(check2.isFree).toBe(false);
    // Must offer the 2 nearest alternative slots
    expect(check2.nearestSlots.length).toBe(2);
    expect(check2.nearestSlots[0].time).toBe('10:15');
    expect(check2.nearestSlots[1].time).toBe('10:30');

    // 4. Attempting to book the same slot must throw transactional conflict error
    expect(() => {
      db.bookAppointmentRecord({
        doctorId,
        startAt: slotIso,
        patientName: 'Second Caller',
        patientPhone: '9988776655',
        patientEmail: 'second@gmail.com',
        reason: 'Emergency consultation',
      });
    }).toThrow('Slot is already booked for this doctor');
  });

  it('should validate phone number length and email format on booking', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const slotIso = '2026-11-02T11:00:00+05:30';

    // Invalid email
    expect(() => {
      db.bookAppointmentRecord({
        doctorId: 'doc_sharma',
        startAt: slotIso,
        patientName: 'Test Patient',
        patientPhone: '9811223344',
        patientEmail: 'invalid-email',
        reason: 'Checkup',
      });
    }).toThrow('Invalid email format');

    // Invalid phone (less than 10 digits)
    expect(() => {
      db.bookAppointmentRecord({
        doctorId: 'doc_sharma',
        startAt: slotIso,
        patientName: 'Test Patient',
        patientPhone: '12345',
        patientEmail: 'patient@gmail.com',
        reason: 'Checkup',
      });
    }).toThrow('Invalid phone length');
  });

  it('should execute full Asha receptionist conversation flow deterministically', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const receptionist = new VoiceReceptionistEngine(db);
    const callId = 'call_test_101';

    // Step 1: Greeting
    const turn1 = receptionist.processTurn(callId, 'Namaste Asha');
    expect(turn1.replyText).toContain('Aapko kis problem ke liye doctor se milna hai?');

    // Step 2: Reason & Doctor selection (Chest pain -> Dr. Priya Mehta / Cardiology)
    const turn2 = receptionist.processTurn(callId, 'Mere chest mein pain hai, Dr. Priya Mehta se milna hai');
    expect(turn2.state.doctorId).toBe('doc_mehta');
    expect(turn2.replyText).toContain('Dr. Priya Mehta');

    // Step 3: Date & Time (Monday 10:00 AM)
    const turn3 = receptionist.processTurn(callId, '2026-11-02 ko subah 10 baje');
    expect(turn3.state.dateStr).toBe('2026-11-02');
    expect(turn3.state.timeStr).toBe('10:00');
    expect(turn3.replyText).toContain('patient ka poora naam');

    // Step 4: Patient Name
    const turn4 = receptionist.processTurn(callId, 'Mera naam Anuj Chavan hai');
    expect(turn4.state.patientName).toBe('Anuj Chavan');
    expect(turn4.replyText).toContain('phone number');

    // Step 5: Phone Number
    const turn5 = receptionist.processTurn(callId, '9822334455');
    expect(turn5.state.patientPhone).toBe('9822334455');
    expect(turn5.replyText).toContain('email address spell karke');

    // Step 6: Email Address
    const turn6 = receptionist.processTurn(callId, 'anuj at gmail dot com');
    expect(turn6.state.patientEmail).toBe('anuj@gmail.com');
    // Step 7: Read back confirmation ("Sab sahi hai? Book kar doon?")
    expect(turn6.replyText).toContain('Sab sahi hai? Book kar doon?');
    expect(turn6.state.awaitingConfirmation).toBe(true);

    // Step 8: Caller Confirms ("Haan book kar do")
    const turn7 = receptionist.processTurn(callId, 'Haan please book kar dijiye');
    expect(turn7.toolExecuted).toBe('book_appointment');
    expect(turn7.actionTaken).toBe('TOOL_BOOK_APPOINTMENT_EXECUTED');
    expect(turn7.toolParameters?.doctorId).toBe('doc_mehta');
    expect(turn7.toolResult?.success).toBe(true);
    expect(turn7.appointment).toBeDefined();
    expect(turn7.appointment?.bookingCode).toMatch(/^APT-\d{6}$/);
    expect(turn7.replyText).toContain('confirm ho gaya hai aur confirmation email bhej diya gaya hai');
  });

  it('should immediately direct emergency cases to 112 without booking', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const receptionist = new VoiceReceptionistEngine(db);
    const turn = receptionist.processTurn('emergency_call', 'Patient behosh ho gaya hai aur severe bleeding ho rahi hai');
    expect(turn.actionTaken).toBe('EMERGENCY_DIVERTED');
    expect(turn.replyText).toContain('112 par call karein ya nazdeeki hospital jayein');
  });

  it('should support appointment cancellation and reschedule with email dispatch', () => {
    const db = new ClinicDatabase();
    db.seedTestDoctors();
    const initialIso = '2026-11-02T14:00:00+05:30';

    const booked = db.bookAppointmentRecord({
      doctorId: 'doc_sharma',
      startAt: initialIso,
      patientName: 'Karan Mehra',
      patientPhone: '9876543210',
      patientEmail: 'karan.m@gmail.com',
      reason: 'Fever follow-up',
    });

    // Reschedule to 15:00
    const newIso = '2026-11-02T15:00:00+05:30';
    const rescheduled = db.rescheduleAppointmentRecord(booked.bookingCode, newIso);
    expect(rescheduled).not.toBeNull();
    expect(rescheduled?.startAt).toBe(newIso);

    // Cancel appointment
    const cancelled = db.cancelAppointmentRecord(booked.bookingCode, 'Patient out of station');
    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe('cancelled');

    // Slot 15:00 should be free again after cancellation
    const avail = db.checkDoctorAvailability('doc_sharma', '2026-11-02', '15:00');
    expect(avail.isFree).toBe(true);
  });
});

