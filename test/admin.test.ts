import { describe, expect, it } from 'bun:test';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('Admin Panel APIs and Data Schema', () => {
  const clinicDb = new ClinicDatabase();

  it('should start with zero doctors and zero appointments on a fresh database', () => {
    const freshDb = new ClinicDatabase();
    expect(freshDb.getAllDoctors().length).toBe(0);
    expect(freshDb.getAllAppointments().length).toBe(0);
    expect(freshDb.getAllSessions().length).toBe(0);
    expect(freshDb.getAllPatients().length).toBe(0);
  });

  it('should allow admin to add a doctor and verify in roster', () => {
    const freshDb = new ClinicDatabase();
    const doc = freshDb.createDoctorRecord({
      id: 'doc_sharma',
      name: 'Dr. Rajesh Sharma',
      specialization: 'General Medicine',
      languages: ['Hindi', 'English'],
      phone: '+91 9811002233',
      email: 'dr.sharma@miraai.health',
      consultationMinutes: 15,
      active: true,
      department: 'General Medicine',
      consultationFee: 500,
    });
    expect(doc.id).toBe('doc_sharma');
    expect(freshDb.getAllDoctors().length).toBe(1);
    expect(freshDb.getDoctor('doc_sharma')?.name).toBe('Dr. Rajesh Sharma');
  });

  it('should book confirmed appointments with valid booking codes', () => {
    const freshDb = new ClinicDatabase();
    freshDb.createDoctorRecord({
      id: 'doc_sharma',
      name: 'Dr. Rajesh Sharma',
      specialization: 'General Medicine',
      languages: ['Hindi', 'English'],
      phone: '+91 9811002233',
      email: 'dr.sharma@miraai.health',
      consultationMinutes: 15,
      active: true,
      department: 'General Medicine',
      consultationFee: 500,
    });

    const apt = freshDb.bookAppointmentRecord({
      doctorId: 'doc_sharma',
      startAt: '2026-11-02T10:00:00+05:30',
      patientName: 'Anuj Chavan',
      patientPhone: '9811002233',
      patientEmail: 'anuj@miraai.care',
      reason: 'General consultation',
    });

    expect(apt.bookingCode).toMatch(/^APT-[0-9]+/);
    expect(apt.status).toBe('confirmed');
    expect(freshDb.getAllAppointments().length).toBe(1);
  });

  it('should get and switch active AI Engine via admin settings API', async () => {
    // 1. Get current settings
    const getRes = await fetch('http://localhost:3000/api/admin/settings', {
      headers: { 'Cookie': 'mira_user_email=anujschavan007@gmail.com' },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.availableEngines.length).toBe(3);
    const engineIds = getData.availableEngines.map((e: any) => e.id);
    expect(engineIds).toContain('webrtc');
    expect(engineIds).toContain('gemini_live');
    expect(engineIds).toContain('sarvam_ai');

    // 2. Switch to Sarvam AI
    const switchSarvamRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ activeAiEngine: 'sarvam_ai' }),
    });
    expect(switchSarvamRes.status).toBe(200);
    const sarvamData = await switchSarvamRes.json();
    expect(sarvamData.success).toBe(true);
    expect(sarvamData.activeAiEngine).toBe('sarvam_ai');

    // 3. Switch to WebRTC
    const switchWebRtcRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ activeAiEngine: 'webrtc' }),
    });
    expect(switchWebRtcRes.status).toBe(200);
    const webrtcData = await switchWebRtcRes.json();
    expect(webrtcData.success).toBe(true);
    expect(webrtcData.activeAiEngine).toBe('webrtc');

    // 4. Switch back to Gemini Live
    const switchGeminiRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ activeAiEngine: 'gemini_live' }),
    });
    expect(switchGeminiRes.status).toBe(200);
    const geminiData = await switchGeminiRes.json();
    expect(geminiData.success).toBe(true);
    expect(geminiData.activeAiEngine).toBe('gemini_live');

    // 5. Reject invalid engine
    const invalidRes = await fetch('http://localhost:3000/api/admin/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({ activeAiEngine: 'unknown_engine' }),
    });
    expect(invalidRes.status).toBe(400);
  });

  it('should support full doctor availability and leave management APIs', async () => {
    // 0. Ensure doc_sharma exists in roster
    await fetch('http://localhost:3000/api/admin/staff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'mira_user_email=anujschavan007@gmail.com',
      },
      body: JSON.stringify({
        id: 'doc_sharma',
        name: 'Dr. Rajesh Sharma',
        specialty: 'General Physician',
        department: 'General Medicine',
        availableDays: ['Monday', 'Tuesday', 'Wednesday'],
        slots: ['10:00', '11:00', '14:00'],
      }),
    });

    // 1. Get weekly availability for Dr. Sharma
    const availRes = await fetch('http://localhost:3000/api/doctors/doc_sharma/availability');
    expect(availRes.status).toBe(200);
    const availList = await availRes.json();
    expect(Array.isArray(availList)).toBe(true);
    expect(availList.length).toBeGreaterThan(0);

    // 2. Add a blocked leave on 2026-11-09
    const leaveDate = '2026-11-09';
    const addLeaveRes = await fetch('http://localhost:3000/api/doctors/doc_sharma/leaves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: leaveDate, reason: 'Conference Leave' }),
    });
    expect(addLeaveRes.status).toBe(200);
    const leaveData = await addLeaveRes.json();
    expect(leaveData.success).toBe(true);
    expect(leaveData.leave.date).toBe(leaveDate);

    // 3. Verify get_free_slots on blocked date returns 0 slots
    const slotsRes = await fetch(`http://localhost:3000/api/doctors/doc_sharma/free-slots?date=${leaveDate}`);
    expect(slotsRes.status).toBe(200);
    const slotsData = await slotsRes.json();
    expect(slotsData.totalFreeSlots).toBe(0);

    // 4. Delete the blocked leave
    const delRes = await fetch(`http://localhost:3000/api/doctors/doc_sharma/leaves/${leaveData.leave.id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // 5. Verify slots are restored
    const restoredRes = await fetch(`http://localhost:3000/api/doctors/doc_sharma/free-slots?date=${leaveDate}`);
    const restoredData = await restoredRes.json();
    expect(restoredData.totalFreeSlots).toBeGreaterThan(0);
  });
});

