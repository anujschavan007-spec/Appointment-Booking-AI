import { describe, it, expect, beforeAll } from 'bun:test';

describe('Doctor Scheduling & Receptionist REST API Endpoints', () => {
  const BASE_URL = 'http://localhost:3000';

  beforeAll(async () => {
    await fetch(`${BASE_URL}/api/admin/staff`, {
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
  });

  it('should list active doctors on GET /api/doctors', async () => {
    const res = await fetch(`${BASE_URL}/api/doctors`);
    expect(res.status).toBe(200);
    const docs = await res.json();
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs.some((d: any) => d.id === 'doc_sharma')).toBe(true);
  });

  it('should return computed free slots on GET /api/doctors/:id/free-slots', async () => {
    const res = await fetch(`${BASE_URL}/api/doctors/doc_sharma/free-slots?date=2026-11-16`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.doctorId).toBe('doc_sharma');
    expect(data.totalFreeSlots).toBeGreaterThan(0);
    expect(data.slots[0].time).toBe('10:00');
  });

  it('should execute check_availability tool endpoint on POST /api/appointments/check-availability', async () => {
    const res = await fetch(`${BASE_URL}/api/appointments/check-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: 'doc_sharma',
        date: '2026-11-16',
        time: '10:00',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.isFree).toBe(true);
    expect(data.nearestSlots.length).toBeGreaterThan(0);
  });

  it('should book appointment transactional on POST /api/appointments/book', async () => {
    const res = await fetch(`${BASE_URL}/api/appointments/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: 'doc_sharma',
        start_at: '2026-11-16T10:00:00+05:30',
        patient_name: 'Anuj Chavan',
        patient_phone: '9811223344',
        patient_email: 'anujschavan007@gmail.com',
        reason: 'General consultation',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.appointment.bookingCode).toMatch(/^APT-\d{6}$/);

    // Immediate second booking must fail with anti-double booking error
    const res2 = await fetch(`${BASE_URL}/api/appointments/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: 'doc_sharma',
        start_at: '2026-11-16T10:00:00+05:30',
        patient_name: 'Second Caller',
        patient_phone: '9988776655',
        patient_email: 'second@gmail.com',
      }),
    });
    expect(res2.status).toBe(400);
    const err = await res2.json();
    expect(err.error).toContain('Slot is already booked');

    // Clean up test booking to maintain test idempotency
    await fetch(`${BASE_URL}/api/appointments/${data.appointment.bookingCode}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Test cleanup' }),
    });
  });

  it('should return CSV on GET /api/appointments/export-csv', async () => {
    const res = await fetch(`${BASE_URL}/api/appointments/export-csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain('Booking ID,Doctor Name,Specialization');
  });

  it('should return Asha prompt and tools on GET /api/receptionist/config', async () => {
    const res = await fetch(`${BASE_URL}/api/receptionist/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.prompt).toContain('Asha');
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.some((t: any) => t.name === 'check_availability')).toBe(true);
  });
});
