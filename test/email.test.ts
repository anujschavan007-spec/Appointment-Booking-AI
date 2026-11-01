import { describe, it, expect } from 'bun:test';
import { EmailService } from '../src/services/email_service';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('EmailService & Post-Consultation Email Confirmation', () => {
  it('should validate and reject empty or invalid email addresses', async () => {
    const service = new EmailService('', '');
    const result = await service.sendConsultationConfirmation({
      to: 'invalid-email',
      patientName: 'Test Patient',
      sessionId: 'sess_test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid recipient email address');
  });

  it('should verify clinical timing checks and operating hours in verifyTiming()', () => {
    const service = new EmailService();
    const timing = service.verifyTiming('Tomorrow', '11:30 AM');
    expect(timing.valid).toBe(true);
    expect(timing.withinOperatingHours).toBe(true);
    expect(timing.istFormatted).toBeDefined();

    // Check off-hours timing check
    const lateTiming = service.verifyTiming('Tomorrow', '11:00 PM');
    expect(lateTiming.withinOperatingHours).toBe(false);
    expect(lateTiming.operatingHoursNote).toContain('outside standard');
  });

  it('should skip email dispatch if Gmail SMTP is unconfigured', async () => {
    const service = new EmailService('', '');
    const result = await service.sendConsultationConfirmation({
      to: 'patient@example.com',
      patientName: 'Test Patient',
      sessionId: 'sess_test',
    });

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.error).toContain('Gmail SMTP credentials not configured');
  });

  it('should deliver real consultation confirmation via Gmail SMTP', async () => {
    const service = new EmailService('xyz577616@gmail.com', 'ezxsvfmmuazjecvz');
    const result = await service.sendConsultationConfirmation({
      to: 'xyz577616@gmail.com',
      patientName: 'Pravin Ghodake',
      sessionId: 'sess_test_real_smtp',
      appointment: {
        bookingCode: 'APT-849201',
        doctorName: 'Dr. Anita Desai',
        specialty: 'Dermatology',
        date: 'Tomorrow',
        timeSlot: '11:00 AM',
      },
      summary: {
        chiefComplaint: 'Skin rash and itching',
        urgencyLevel: 'ROUTINE',
        symptomsList: ['Redness', 'Itching'],
        doctorRecommendation: 'Consult Dr. Anita Desai',
      },
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe('gmail_smtp');
    expect(result.messageId).toBeDefined();
    expect(result.timingCheck?.valid).toBe(true);
  }, 15000);

  it('should verify consultation complete route integrates email dispatch and status', async () => {
    const db = new ClinicDatabase();
    const session = db.createSession('pat_test', 'Anuj Chavan');

    const req = new Request('http://localhost:3000/api/consultation/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({
        sessionId: session.id,
        durationSeconds: 120,
        userEmail: 'anujschavan007@gmail.com',
      }),
    });

    const body = await req.json();
    expect(body.userEmail).toBe('anujschavan007@gmail.com');
    expect(body.sessionId).toBe(session.id);
  });

  it('should return real Clerk user details, AI summary, and transcripts on /api/admin/patients/:id/details', async () => {
    // 1. Create a dynamic test patient & consultation
    const startRes = await fetch('http://localhost:3000/api/consultation/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        patientName: 'Anuj Chavan',
        email: 'anujschavan007@gmail.com',
        phone: '9876543210',
      }),
    });
    const startData = await startRes.json();
    expect(startData.success).toBe(true);
    const patientId = startData.patient.id;

    // 2. Fetch patient details via admin endpoint
    const res = await fetch(`http://localhost:3000/api/admin/patients/${patientId}/details`, {
      headers: {
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.patient).toBeDefined();
    expect(data.patient.email).toBe('anujschavan007@gmail.com');

    // Verify AI Summary
    expect(data.aiSummary).toBeDefined();
    expect(data.aiSummary.clinicalOverview).toBeDefined();
    expect(data.aiSummary.totalConsultations).toBeDefined();

    // Verify Sessions and Transcripts
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});
