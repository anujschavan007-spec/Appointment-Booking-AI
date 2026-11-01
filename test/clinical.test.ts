import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';
import { ClinicalIntentEngine } from '../src/core/clinical_intent';

describe('Clinical Intake & Doctor Appointment Matching', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const engine = new ClinicalIntentEngine(clinicDb);

  it('should match chest pain to Cardiologist Dr. Priya Mehta', () => {
    const start = Date.now();
    const query = 'Mujhe kal se chest pain aur thodi ghabrahat ho rahi hai';
    const res = engine.tryFastResolution(query, start, 'sess_test_1', 'pat_1', 'Pravin');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('CARDIOLOGY_TRIAGE');
    expect(res?.text).toContain('Dr. Priya Mehta');
    expect(res?.text).toContain('Cardiologist');
  });

  it('should match visible skin spot or rash to Dermatologist Dr. Anita Desai', () => {
    const start = Date.now();
    const query = 'Mere skin par red spot aur rash aa gaya hai';
    const res = engine.tryFastResolution(query, start, 'sess_test_2', 'pat_1', 'Pravin');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('DERMATOLOGY_SPOT_MATCHED');
    expect(res?.text).toContain('Dr. Anita Desai');
    expect(res?.text).toContain('Dermatologist');
  });

  it('should match joint/bone ache to Orthopedic Dr. Arshad Khan', () => {
    const start = Date.now();
    const query = 'Ghutne mein bohot dard hai aur haddi mein swelling hai';
    const res = engine.tryFastResolution(query, start, 'sess_test_3', 'pat_1', 'Pravin');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('ORTHOPEDIC_TRIAGE');
    expect(res?.text).toContain('Dr. Arshad Khan');
    expect(res?.text).toContain('Orthopedic');
  });

  it('should book appointment and generate confirmed booking code in clinic database', () => {
    const start = Date.now();
    const query = 'Dr. Sharma ke sath kal 04:30 PM ka slot book kardo please';
    const res = engine.tryFastResolution(query, start, 'sess_test_4', 'pat_1', 'Pravin');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('APPOINTMENT_CONFIRMED');
    expect(res?.text).toContain('APT-');
    expect(res?.text).toContain('Pravin');
    expect(res?.text).toContain('confirm ho gaya hai');

    // Verify appointment in DB
    const appointments = clinicDb.getAllAppointments();
    const created = appointments.find((a) => a.patientName === 'Pravin' && a.appointmentDate === 'Tomorrow');
    expect(created).toBeDefined();
    expect(created?.status).toBe('CONFIRMED');
  });

  it('should capture patient name and ask for phone number', () => {
    const start = Date.now();
    const query = 'Mera naam Anuj Chavan hai';
    const res = engine.tryFastResolution(query, start, 'sess_test_5', 'pat_5', 'Anonymous');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('PATIENT_NAME_CAPTURED');
    expect(res?.text).toContain('Anuj Chavan');
    expect(res?.text).toContain('phone number');
    expect(res?.modelUsed).toBe('gemini-3.8-live');
    expect(res?.voiceUsed).toBe('Kore');
  });

  it('should capture phone number and ask for pain and disease symptoms', () => {
    const start = Date.now();
    const query = 'Mera phone number 9876543210 hai';
    const res = engine.tryFastResolution(query, start, 'sess_test_6', 'pat_5', 'Anuj Chavan');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('PHONE_NUMBER_CAPTURED');
    expect(res?.text).toContain('9876543210');
    expect(res?.text).toContain('pain');
    expect(res?.text).toContain('bimari ya symptoms');
  });

  it('should provide complete appointment details including doctor, date, time and booking code', () => {
    const start = Date.now();
    const query = 'Haan kal Dr. Priya Mehta ke sath 11:00 AM ka slot confirm kardo please';
    const res = engine.tryFastResolution(query, start, 'sess_test_7', 'pat_5', 'Anuj Chavan');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('APPOINTMENT_CONFIRMED');
    expect(res?.text).toContain('Dr. Priya Mehta');
    expect(res?.text).toContain('Booking ID');
    expect(res?.text).toContain('APT-');
    expect(res?.appointmentConfirmed).toBeDefined();
    expect(res?.appointmentConfirmed?.bookingCode).toMatch(/^APT-\d+/);
  });

  it('should confirm appointment from Devanagari Hindi query matching user screenshot', () => {
    const start = Date.now();
    const query = 'आप मेरा अपॉइंटमेंट स्लॉट बुक कर दो';
    const res = engine.tryFastResolution(query, start, 'sess_test_hindi_1', 'pat_hindi', 'Anuj Chavan');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('APPOINTMENT_CONFIRMED');
    expect(res?.text).toContain('Anuj Chavan');
    expect(res?.text).toContain('Booking ID');
    expect(res?.text).toContain('APT-');
    expect(res?.appointmentConfirmed).toBeDefined();
  });

  it('should confirm appointment from phonetic Hinglish query matching user screenshot', () => {
    const start = Date.now();
    const query = 'एस यू कैन बुक एन अपॉइंटमेंट का में';
    const res = engine.tryFastResolution(query, start, 'sess_test_hindi_2', 'pat_hindi', 'Anuj Chavan');

    expect(res).not.toBeNull();
    expect(res?.actionTaken).toBe('APPOINTMENT_CONFIRMED');
    expect(res?.appointmentConfirmed).toBeDefined();
  });
});

