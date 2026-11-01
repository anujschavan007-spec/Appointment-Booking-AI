import { describe, it, expect, beforeEach } from 'bun:test';
import { VoiceReceptionistEngine } from '../src/core/voice_receptionist';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('Voice Receptionist AI Flow & Hindi Devanagari Matching', () => {
  let db: ClinicDatabase;
  let receptionist: VoiceReceptionistEngine;

  beforeEach(() => {
    db = new ClinicDatabase();
    db.seedTestDoctors();
    receptionist = new VoiceReceptionistEngine(db);
  });

  it('should match Hindi Devanagari doctor selection without looping in list_doctors', () => {
    const sId = 'sess_hindi_doc_' + Date.now();
    // User directly requests Dr. Anita Desai in Hindi
    const turn1 = receptionist.processTurn(sId, 'मुझे डॉक्टर अनीता देसाई से मिलना है।');

    expect(turn1.state.doctorId).toBe('doc_desai');
    expect(turn1.state.doctorName).toBe('Dr. Anita Desai');
    expect(turn1.toolExecuted).not.toBe('list_doctors');
    expect(turn1.replyText).toContain('Dr. Anita Desai');
    expect(turn1.replyText).toContain('preferred time bataiye');
  });

  it('should handle another option request and provide available specialist alternatives', () => {
    const sId = 'sess_alt_doc_' + Date.now();
    // Select Dr. Anita Desai first
    receptionist.processTurn(sId, 'Dr. Anita Desai dermatology');

    // Caller says they want another option
    const turn2 = receptionist.processTurn(sId, 'मुझे कुछ दूसरा ऑप्शन सिलेक्शन है।');
    expect(turn2.actionTaken).toBe('OFFER_ALTERNATIVE_DOCTORS');
    expect(turn2.replyText).toContain('Dr. Priya Mehta');
    expect(turn2.replyText).toContain('Dr. Rajesh Sharma');
    expect(turn2.state.doctorId).toBeUndefined();
  });

  it('should collect patient details and symptoms before asking about doctor and booking', () => {
    const sId = 'sess_patient_first_' + Date.now();
    // Step 1: Greeting
    const step1 = receptionist.processTurn(sId, 'Namaste Mira');
    expect(step1.replyText).toContain('apna poora naam batayein');

    // Step 2: Patient Name
    const step2 = receptionist.processTurn(sId, 'Mera naam Pravin Ghodake hai');
    expect(step2.state.patientName).toBe('Pravin Ghodake');

    // Step 3: Symptoms and Doctor Selection in Hindi
    const step3 = receptionist.processTurn(sId, 'Mujhe skin par rash aur spot hai, Dr. Anita Desai se milna hai');
    expect(step3.state.doctorId).toBe('doc_desai');
    expect(step3.state.doctorName).toBe('Dr. Anita Desai');
  });
});
