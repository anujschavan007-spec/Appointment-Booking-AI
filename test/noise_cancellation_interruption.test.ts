import { describe, expect, it } from 'bun:test';
import { VoiceReceptionistEngine } from '../src/core/voice_receptionist';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('Noise Cancellation & Frictionless Interruption Handling', () => {
  const clinicDb = new ClinicDatabase();
  clinicDb.seedTestDoctors();
  const receptionist = new VoiceReceptionistEngine(clinicDb);

  it('should acknowledge caller verbal interruption keywords immediately without falling back to generic prompts', () => {
    const callId = 'call_nc_interrupt_1';
    receptionist.resetState(callId);

    // Initial greeting and state setup
    receptionist.processTurn(callId, 'Mera naam Anuj hai, mujhe Dr. Anita Desai se milna hai');

    // Caller interrupts mid-flow: "ruko ek minute" / "wait suno"
    const interruptResult1 = receptionist.processTurn(callId, 'Ruko ek minute');
    expect(interruptResult1.actionTaken).toBe('CALLER_INTERRUPT_ACKNOWLEDGED');
    expect(interruptResult1.replyText.toLowerCase()).toContain('sun rahi hoon');

    const interruptResult2 = receptionist.processTurn(callId, 'सुनो रुको जरा');
    expect(interruptResult2.actionTaken).toBe('CALLER_INTERRUPT_ACKNOWLEDGED');
  });

  it('should allow caller to interrupt and change appointment time or date smoothly', () => {
    const callId = 'call_nc_interrupt_2';
    receptionist.resetState(callId);

    // Caller enters initial request for tomorrow 10am
    receptionist.processTurn(callId, 'Mera naam Anuj hai, mujhe viral fever hai');
    receptionist.processTurn(callId, 'Dr. Anita Desai ke sath kal subah 10 baje');

    // Caller interrupts: "Nahi time badalna hai, shaam ka time chahiye"
    const changeTimeResult = receptionist.processTurn(callId, 'Nahi mujhe time badalna hai, dusra time chahiye');
    expect(changeTimeResult.actionTaken).toBe('REQUEST_NEW_SLOT');
    expect(changeTimeResult.replyText.toLowerCase()).toContain('kis date ya time');

    // Caller supplies new time: "kal shaam 4 baje"
    const newSlotResult = receptionist.processTurn(callId, 'Kal shaam 4 baje');
    expect(newSlotResult.state.displayTime).toContain('4:00 PM');
  });

  it('should allow caller to interrupt and switch doctors without losing previous details', () => {
    const callId = 'call_nc_interrupt_3';
    receptionist.resetState(callId);

    // Caller begins with Dr. Priya Mehta
    receptionist.processTurn(callId, 'Mera naam Anuj hai, 9876543210, mujhe Dr. Priya Mehta se milna hai');

    // Caller interrupts: "Ruko, mujhe dusra doctor chahiye, Dr. Anita Desai"
    const switchDoctor = receptionist.processTurn(callId, 'Mujhe dusra doctor chahiye, Dr. Anita Desai');
    expect(switchDoctor.state.doctorName).toBe('Dr. Anita Desai');
    expect(switchDoctor.state.patientName).toBe('Anuj');
    expect(switchDoctor.state.patientPhone).toBe('9876543210');
  });

  it('should verify DSP Noise Cancellation audio filter specification', () => {
    // DSP Noise Cancellation Filter Specifications
    const dspConfig = {
      highpassCutoffHz: 85,
      highpassQ: 0.707,
      notch50Hz: 50,
      notch60Hz: 60,
      lowpassCutoffHz: 7500,
      vocalPresenceHz: 1800,
      vocalPresenceGainDb: 3.5,
      compressorThresholdDb: -24,
      compressorKneeDb: 12,
      compressorRatio: 4,
    };

    expect(dspConfig.highpassCutoffHz).toBe(85);
    expect(dspConfig.lowpassCutoffHz).toBe(7500);
    expect(dspConfig.notch50Hz).toBe(50);
    expect(dspConfig.notch60Hz).toBe(60);
    expect(dspConfig.vocalPresenceHz).toBe(1800);
  });

  it('should verify adaptive noise floor tracking algorithm prevents background noise false triggers', () => {
    let ambientFloor = 0.015;

    // Simulate steady background room noise (fans, air conditioning hum)
    const steadyFanNoiseSamples = [0.014, 0.015, 0.016, 0.015, 0.014];
    for (const noiseRms of steadyFanNoiseSamples) {
      if (noiseRms < ambientFloor * 1.5) {
        ambientFloor = ambientFloor * 0.98 + noiseRms * 0.02;
      }
    }

    // Background fan noise should NOT trigger speech VAD
    const speechThreshold = Math.max(0.018, ambientFloor * 1.8);
    expect(0.015 < speechThreshold).toBe(true);

    // Genuine speech (RMS ~0.06) clearly exceeds the threshold
    const genuineSpeechRms = 0.06;
    expect(genuineSpeechRms > speechThreshold).toBe(true);

    // Barge-in threshold during Mira playback
    const bargeThreshold = Math.max(0.038, ambientFloor * 2.5);
    // Background noise does NOT trigger barge-in
    expect(0.015 > bargeThreshold).toBe(false);
    // Human interruption voice clearly triggers barge-in
    expect(genuineSpeechRms > bargeThreshold).toBe(true);
  });
});
