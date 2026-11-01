import { describe, it, expect, beforeEach } from 'bun:test';
import { VoiceReceptionistEngine } from '../src/core/voice_receptionist';
import { ClinicDatabase } from '../src/data/clinic_db';
import { HinglishDateNormalizer } from '../src/core/date_normalizer';

describe('Hindi Doctor Matching and Patient Portal Visibility', () => {
  let db: ClinicDatabase;
  let receptionist: VoiceReceptionistEngine;
  const testSessionId = 'test_hindi_doctor_' + Date.now();

  beforeEach(() => {
    db = new ClinicDatabase();
    db.seedTestDoctors();
    receptionist = new VoiceReceptionistEngine(db);
  });

  it('HinglishDateNormalizer should not return a date when no date is in the utterance', () => {
    const parsed = HinglishDateNormalizer.parse('मुझे डॉक्टर अनीता देसाई से मिलना है।');
    expect(parsed.date).toBeUndefined();
  });

  it('HinglishDateNormalizer should return a date when kal or parso or specific date is in the utterance', () => {
    const parsedKal = HinglishDateNormalizer.parse('kal shaam 4 baje');
    expect(parsedKal.date).toBeDefined();
    expect(parsedKal.time).toBe('16:00');

    const parsedParso = HinglishDateNormalizer.parse('parso subah 10 baje');
    expect(parsedParso.date).toBeDefined();
    expect(parsedParso.time).toBe('10:00');
  });

  it('should capture Dr. Anita Desai from Hindi text and ask for date/time without looping list_doctors', () => {
    const sId = testSessionId + '_desai';
    const turn1 = receptionist.processTurn(sId, 'मुझे डॉक्टर अनीता देसाई से मिलना है।');
    expect(turn1.state.doctorId).toBe('doc_desai');
    expect(turn1.state.doctorName).toBe('Dr. Anita Desai');
    expect(turn1.toolExecuted).not.toBe('list_doctors');
    expect(turn1.actionTaken).toBe('ASK_DATE_TIME');
    expect(turn1.replyText).toContain('Dr. Anita Desai');
    expect(turn1.replyText).toContain('kab aana chahte hain');
  });

  it('should offer alternative doctors when user asks for doosra option', () => {
    const sId = testSessionId + '_doosra';
    receptionist.processTurn(sId, 'मुझे डॉक्टर अनीता देसाई से मिलना है।');
    const turn2 = receptionist.processTurn(sId, 'मुझे कुछ दूसरा ऑप्शन सिलेक्शन है।');
    expect(turn2.actionTaken).toBe('OFFER_ALTERNATIVE_DOCTORS');
    expect(turn2.replyText).toContain('Dr. Priya Mehta');
    expect(turn2.replyText).toContain('Dr. Rajesh Sharma');
    expect(turn2.state.doctorId).toBeUndefined();
  });

  it('should have seedStandardDoctors populating all 6 clinic doctors on clinicDb', () => {
    const freshDb = new ClinicDatabase();
    freshDb.seedStandardDoctors();
    const doctors = freshDb.getAllDoctorRecords(true);
    expect(doctors.length).toBeGreaterThanOrEqual(6);
    expect(freshDb.findDoctorRecord('Dr. Anita Desai')).toBeDefined();
    expect(freshDb.findDoctorRecord('Dr. Priya Mehta')).toBeDefined();
    expect(freshDb.findDoctorRecord('Dr. Rajesh Sharma')).toBeDefined();
    expect(freshDb.findDoctorRecord('डॉक्टर अनीता देसाई')).toBeDefined();
  });

  it('clinicDb.listDoctors should filter by specialization or doctor query cleanly', () => {
    const freshDb = new ClinicDatabase();
    freshDb.seedStandardDoctors();
    const cardio = freshDb.listDoctors('Cardiology');
    expect(cardio.length).toBe(1);
    expect(cardio[0].name).toBe('Dr. Priya Mehta');

    const desai = freshDb.listDoctors('मुझे डॉक्टर अनीता देसाई से मिलना है।');
    expect(desai.length).toBe(1);
    expect(desai[0].name).toBe('Dr. Anita Desai');
  });

  it('should correctly retrieve booked appointments for patient portal by clerkUserId, email, or patientName', () => {
    const appointmentAnuj = db.bookAppointmentRecord({
      doctorId: 'doc_mehta',
      startAt: '2026-11-02T14:00:00+05:30',
      patientName: 'Anuj Chavan',
      patientPhone: '9820011223',
      patientEmail: 'anujschavan007@gmail.com',
      reason: 'Chest pain and palpitations',
      clerkUserId: 'user_anuj_clerk_id_999',
    });

    const appointmentOther = db.bookAppointmentRecord({
      doctorId: 'doc_sharma',
      startAt: '2026-11-02T16:00:00+05:30',
      patientName: 'Other Person',
      patientPhone: '9988776655',
      patientEmail: 'other@example.com',
      reason: 'Routine checkup',
      clerkUserId: 'user_other_456',
    });

    expect(appointmentAnuj).toBeDefined();
    expect(appointmentOther).toBeDefined();

    // Query 1: By clerkUserId
    const resByClerk = db.getAllAppointmentRecords({ clerkUserId: 'user_anuj_clerk_id_999' });
    expect(resByClerk.length).toBe(1);
    expect(resByClerk[0].bookingCode).toBe(appointmentAnuj.bookingCode);

    // Query 2: By email
    const resByEmail = db.getAllAppointmentRecords({ email: 'anujschavan007@gmail.com' });
    expect(resByEmail.length).toBe(1);
    expect(resByEmail[0].bookingCode).toBe(appointmentAnuj.bookingCode);

    // Query 3: Multi-attribute lookup as used by /api/user/profile
    const resCombined = db.getAllAppointmentRecords({
      clerkUserId: 'user_anuj_clerk_id_999',
      email: 'anujschavan007@gmail.com',
      patientName: 'Anuj Chavan',
    });
    expect(resCombined.length).toBe(1);
    expect(resCombined[0].doctorName).toBe('Dr. Priya Mehta');
  });
});
