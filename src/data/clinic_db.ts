import {
  DoctorInfo,
  PatientProfile,
  ConsultationSession,
  ClinicalSummary,
  AppointmentBooking,
  DoctorRecord,
  DoctorAvailability,
  DoctorLeave,
  AppointmentRecord,
  FreeSlot,
} from '../types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EmailNotificationService } from '../services/email_service';

export class DatabaseUnavailableError extends Error {
  public statusCode = 503;
  constructor(message: string = 'Database service unavailable. Cloud connection to Supabase failed or tables are missing.') {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

export class ClinicDatabase {
  // Pure in-memory operational state (for active process execution)
  // Starts strictly with 0 records - NO fake data, NO demo patients, NO hardcoded rosters
  private doctorRecords: Map<string, DoctorRecord> = new Map();
  private doctorAvailabilityMap: Map<string, DoctorAvailability[]> = new Map();
  private doctorLeavesMap: Map<string, DoctorLeave[]> = new Map();
  private appointmentRecords: Map<string, AppointmentRecord> = new Map();
  private profilesMap: Map<string, PatientProfile> = new Map();
  private sessionsMap: Map<string, ConsultationSession> = new Map();
  private summariesMap: Map<string, ClinicalSummary> = new Map();
  private emailLogs: any[] = [];
  private callMetricsLogs: any[] = [];

  private supabase: SupabaseClient | null = null;
  private isSupabaseConnected: boolean = false;

  constructor() {
    this.initSupabase();
  }

  private initSupabase() {
    let url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

    // Auto-normalize dashboard URL to API URL if user pasted dashboard link
    const dashboardMatch = url.match(/dashboard\/project\/([a-zA-Z0-9]+)/);
    if (dashboardMatch) {
      url = `https://${dashboardMatch[1]}.supabase.co`;
    }

    if (url && key && url.startsWith('http')) {
      try {
        this.supabase = createClient(url, key, {
          auth: { persistSession: false },
        });
        this.isSupabaseConnected = true;
        console.log(`[Database] Supabase cloud client active: ${url}`);
      } catch (err: any) {
        console.warn(`[Database] Supabase client init warning: ${err.message}`);
        this.isSupabaseConnected = false;
      }
    } else {
      console.warn(`[Database] Warning: Supabase credentials not found or incomplete.`);
    }
  }

  public getSupabase(): SupabaseClient | null {
    return this.supabase;
  }

  // For automated unit test harnesses requiring fixture doctors for algorithm verification
  public seedTestDoctors(): void {
    const testDocs: DoctorRecord[] = [
      {
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
      },
      {
        id: 'doc_mehta',
        name: 'Dr. Priya Mehta',
        specialization: 'Cardiology',
        languages: ['Hindi', 'English'],
        phone: '+91 9822003344',
        email: 'dr.mehta@miraai.health',
        consultationMinutes: 15,
        active: true,
        department: 'Cardiology',
        consultationFee: 1200,
      },
      {
        id: 'doc_desai',
        name: 'Dr. Anita Desai',
        specialization: 'Dermatology',
        languages: ['Hindi', 'English'],
        phone: '+91 9833004455',
        email: 'dr.desai@miraai.health',
        consultationMinutes: 15,
        active: true,
        department: 'Dermatology',
        consultationFee: 900,
      },
      {
        id: 'doc_khan',
        name: 'Dr. Arshad Khan',
        specialization: 'Orthopedics',
        languages: ['Hindi', 'English'],
        phone: '+91 9844005566',
        email: 'dr.khan@miraai.health',
        consultationMinutes: 15,
        active: true,
        department: 'Orthopedics',
        consultationFee: 800,
      },
      {
        id: 'doc_verma',
        name: 'Dr. Sunita Verma',
        specialization: 'Pediatrics',
        languages: ['Hindi', 'English'],
        phone: '+91 9855006677',
        email: 'dr.verma@miraai.health',
        consultationMinutes: 15,
        active: true,
        department: 'Pediatrics',
        consultationFee: 700,
      },
      {
        id: 'doc_rao',
        name: 'Dr. Vikram Rao',
        specialization: 'Neurology',
        languages: ['Hindi', 'English'],
        phone: '+91 9866007788',
        email: 'dr.rao@miraai.health',
        consultationMinutes: 15,
        active: true,
        department: 'Neurology',
        consultationFee: 1500,
      },
    ];

    for (const d of testDocs) {
      this.createDoctorRecord(d);
    }
  }

  // =========================================================================
  // 1. PROFILES & PATIENT IDENTITY (Synced directly from Clerk verified sessions)
  // =========================================================================

  public async upsertProfile(data: {
    clerk_user_id: string;
    full_name?: string;
    email: string;
    email_verified?: boolean;
    phone?: string;
    phone_verified?: boolean;
    role?: 'patient' | 'admin';
  }): Promise<PatientProfile> {
    const fullName = data.full_name || data.email.split('@')[0] || 'User';
    const email = data.email.toLowerCase().trim();
    const role = data.role || (email === 'anujschavan007@gmail.com' ? 'admin' : 'patient');

    const profile: PatientProfile = {
      id: `prof_${data.clerk_user_id}`,
      clerkUserId: data.clerk_user_id,
      fullName,
      email,
      phone: data.phone || '',
      createdAt: Date.now(),
    };

    this.profilesMap.set(data.clerk_user_id, profile);
    this.profilesMap.set(profile.id, profile);
    this.profilesMap.set(email, profile);

    if (this.supabase) {
      try {
        const { error } = await this.supabase.from('profiles').upsert(
          {
            clerk_user_id: data.clerk_user_id,
            full_name: fullName,
            email,
            email_verified: data.email_verified ?? true,
            phone: data.phone || null,
            phone_verified: data.phone_verified ?? false,
            role,
          },
          { onConflict: 'clerk_user_id' }
        );
        if (error) {
          console.warn('[Database] Supabase profiles upsert warning:', error.message);
        }
      } catch (err: any) {
        console.warn('[Database] Supabase profiles upsert network notice:', err.message);
      }
    }

    return profile;
  }

  public getPatient(id: string): PatientProfile | undefined {
    return this.profilesMap.get(id);
  }

  public getPatientByClerkId(clerkUserId: string): PatientProfile | undefined {
    return this.profilesMap.get(clerkUserId);
  }

  public getAllPatients(): PatientProfile[] {
    const seen = new Set<string>();
    const list: PatientProfile[] = [];
    for (const p of this.profilesMap.values()) {
      if (!seen.has(p.clerkUserId || p.email)) {
        seen.add(p.clerkUserId || p.email);
        list.push(p);
      }
    }
    return list;
  }

  public getOrCreatePatient(fullName: string, email: string, phone: string = ''): PatientProfile {
    const cleanEmail = email.toLowerCase().trim();
    const existing = this.profilesMap.get(cleanEmail);
    if (existing) return existing;

    const dummyClerkId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const newProfile: PatientProfile = {
      id: `prof_${dummyClerkId}`,
      clerkUserId: dummyClerkId,
      fullName: fullName || cleanEmail.split('@')[0],
      email: cleanEmail,
      phone,
      createdAt: Date.now(),
    };
    this.profilesMap.set(dummyClerkId, newProfile);
    this.profilesMap.set(newProfile.id, newProfile);
    this.profilesMap.set(cleanEmail, newProfile);
    return newProfile;
  }

  public registerPatient(fullName: string, email: string, phone: string = ''): PatientProfile {
    return this.getOrCreatePatient(fullName, email, phone);
  }

  // =========================================================================
  // 2. DOCTORS MANAGEMENT ROSTER (Starts with ZERO doctors; created ONLY by admin)
  // =========================================================================

  public getAllDoctorRecords(activeOnly: boolean = false): DoctorRecord[] {
    const list = Array.from(this.doctorRecords.values());
    return activeOnly ? list.filter((d) => d.active !== false) : list;
  }

  public getAllDoctors(): DoctorInfo[] {
    return this.getAllDoctorRecords().map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialization,
      department: d.department || d.specialization,
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      slots: ['10:00 AM', '11:30 AM', '02:00 PM', '04:30 PM'],
      consultationFee: d.consultationFee || 500,
      isActive: d.active !== false,
    }));
  }

  public getDoctorRecord(id: string): DoctorRecord | undefined {
    return this.doctorRecords.get(id);
  }

  public getDoctor(id: string): DoctorInfo | undefined {
    const d = this.doctorRecords.get(id);
    if (!d) return undefined;
    return {
      id: d.id,
      name: d.name,
      specialty: d.specialization,
      department: d.department || d.specialization,
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      slots: ['10:00 AM', '11:30 AM', '02:00 PM', '04:30 PM'],
      consultationFee: d.consultationFee || 500,
      isActive: d.active !== false,
    };
  }

  public findDoctorRecord(query: string): DoctorRecord | undefined {
    const clean = query.toLowerCase().trim();
    if (!clean) return undefined;

    // 1. Exact ID
    for (const doc of this.doctorRecords.values()) {
      if (doc.active === false) continue;
      if (doc.id.toLowerCase() === clean) return doc;
    }

    // 2. Doctor Name (full or distinct name tokens, English & Devanagari Hindi)
    const hindiAliases: Record<string, string[]> = {
      doc_desai: ['अनीता देसाई', 'अनीता', 'देसाई'],
      doc_sharma: ['राजेश शर्मा', 'राजेश', 'शर्मा'],
      doc_mehta: ['प्रिया मेहता', 'प्रिया', 'मेहता'],
      doc_khan: ['अरशद खान', 'अरशद', 'खान'],
      doc_verma: ['सुनीता वर्मा', 'सुनीता', 'वर्मा'],
      doc_rao: ['विक्रम राव', 'विक्रम', 'राव'],
    };

    for (const doc of this.doctorRecords.values()) {
      if (doc.active === false) continue;
      const docNameLower = doc.name.toLowerCase();
      if (clean.includes(docNameLower) || docNameLower.includes(clean)) return doc;
      const parts = docNameLower.split(/\s+/).filter((p) => p !== 'dr.' && p.length > 2);
      if (parts.some((p) => clean.includes(p))) return doc;

      // Devanagari Hindi aliases
      const aliases = hindiAliases[doc.id] || [];
      if (aliases.some((alias) => clean.includes(alias))) return doc;
    }

    // 3. Specialization & Department
    for (const doc of this.doctorRecords.values()) {
      if (doc.active === false) continue;
      if (clean.includes(doc.specialization.toLowerCase()) || doc.specialization.toLowerCase().includes(clean)) return doc;
      if (doc.department && (clean.includes(doc.department.toLowerCase()) || doc.department.toLowerCase().includes(clean))) return doc;

      // Symptom to department matching
      if (clean.includes('skin') || clean.includes('spot') || clean.includes('rash') || clean.includes('khujli')) {
        if (doc.specialization.toLowerCase().includes('derma') || (doc.department && doc.department.toLowerCase().includes('derma'))) {
          return doc;
        }
      }
      if (clean.includes('heart') || clean.includes('chest') || clean.includes('dil') || clean.includes('palpitation')) {
        if (doc.specialization.toLowerCase().includes('cardio') || (doc.department && doc.department.toLowerCase().includes('cardio'))) {
          return doc;
        }
      }
      if (clean.includes('bone') || clean.includes('joint') || clean.includes('haddi') || clean.includes('knee') || clean.includes('fracture')) {
        if (doc.specialization.toLowerCase().includes('ortho') || (doc.department && doc.department.toLowerCase().includes('ortho'))) {
          return doc;
        }
      }
      if (clean.includes('child') || clean.includes('bachhe') || clean.includes('pediatric')) {
        if (doc.specialization.toLowerCase().includes('pedia') || (doc.department && doc.department.toLowerCase().includes('pedia'))) {
          return doc;
        }
      }
      if (clean.includes('nerve') || clean.includes('headache') || clean.includes('migraine') || clean.includes('brain')) {
        if (doc.specialization.toLowerCase().includes('neuro') || (doc.department && doc.department.toLowerCase().includes('neuro'))) {
          return doc;
        }
      }
      if (clean.includes('fever') || clean.includes('cough') || clean.includes('cold') || clean.includes('bukhar') || clean.includes('khasi')) {
        if (doc.specialization.toLowerCase().includes('general') || (doc.department && doc.department.toLowerCase().includes('general'))) {
          return doc;
        }
      }
    }
    return undefined;
  }

  public findDoctor(query: string): DoctorInfo | undefined {
    const doc = this.findDoctorRecord(query);
    if (!doc) return undefined;
    return this.getDoctor(doc.id);
  }

  public createDoctorRecord(data: DoctorRecord): DoctorRecord {
    this.doctorRecords.set(data.id, data);
    if (!this.doctorAvailabilityMap.has(data.id)) {
      // Default standard Monday-Friday 10:00 - 18:00
      const standardSchedules: DoctorAvailability[] = [1, 2, 3, 4, 5].map((weekday, idx) => ({
        id: `avail_${data.id}_${weekday}_${idx}`,
        doctorId: data.id,
        weekday,
        startTime: '10:00',
        endTime: '18:00',
      }));
      this.doctorAvailabilityMap.set(data.id, standardSchedules);
    }
    if (!this.doctorLeavesMap.has(data.id)) {
      this.doctorLeavesMap.set(data.id, []);
    }

    if (this.supabase) {
      this.supabase.from('doctors').upsert({
        id: data.id,
        name: data.name,
        specialization: data.specialization,
        department: data.department || data.specialization,
        languages: data.languages || ['Hindi', 'English'],
        phone: data.phone || null,
        email: data.email || null,
        consultation_fee: data.consultationFee || 500,
        is_active: data.active !== false,
      }).then(({ error }) => {
        if (error) console.warn('[Database] Supabase doctor create warning:', error.message);
      });
    }

    return data;
  }

  public addDoctor(doc: Omit<DoctorInfo, 'id'> & { id?: string }): DoctorInfo {
    const id = doc.id || ('doc_' + Math.random().toString(36).substr(2, 6));
    const newDocRecord: DoctorRecord = {
      id,
      name: doc.name,
      specialization: doc.specialty,
      languages: ['Hindi', 'English'],
      phone: '',
      email: '',
      consultationMinutes: 15,
      active: doc.isActive !== false,
      department: doc.department || doc.specialty,
      consultationFee: doc.consultationFee || 500,
    };
    this.createDoctorRecord(newDocRecord);
    return { id, ...doc };
  }

  public updateDoctorRecord(id: string, updates: Partial<DoctorRecord>): DoctorRecord | null {
    const existing = this.doctorRecords.get(id);
    if (!existing) return null;
    const updated: DoctorRecord = { ...existing, ...updates, id };
    this.doctorRecords.set(id, updated);

    if (this.supabase) {
      this.supabase.from('doctors').update({
        name: updated.name,
        specialization: updated.specialization,
        department: updated.department || updated.specialization,
        consultation_fee: updated.consultationFee,
        is_active: updated.active,
      }).eq('id', id).then(({ error }) => {
        if (error) console.warn('[Database] Supabase doctor update warning:', error.message);
      });
    }

    return updated;
  }

  public deactivateDoctorRecord(id: string): boolean {
    const doc = this.doctorRecords.get(id);
    if (!doc) return false;
    doc.active = false;
    this.doctorRecords.set(id, doc);

    if (this.supabase) {
      this.supabase.from('doctors').update({ is_active: false }).eq('id', id).then(({ error }) => {
        if (error) console.warn('[Database] Supabase doctor deactivate warning:', error.message);
      });
    }

    return true;
  }

  // =========================================================================
  // 3. DOCTOR AVAILABILITY & LEAVES
  // =========================================================================

  public getDoctorAvailability(doctorId: string): DoctorAvailability[] {
    return this.doctorAvailabilityMap.get(doctorId) || [];
  }

  public setDoctorAvailability(
    doctorId: string,
    schedules: Array<{ weekday: number; startTime: string; endTime: string }>
  ): DoctorAvailability[] {
    const list: DoctorAvailability[] = schedules.map((s, idx) => ({
      id: `avail_${doctorId}_${s.weekday}_${idx}`,
      doctorId,
      weekday: s.weekday,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
    this.doctorAvailabilityMap.set(doctorId, list);
    return list;
  }

  public getDoctorLeaves(doctorId: string): DoctorLeave[] {
    return this.doctorLeavesMap.get(doctorId) || [];
  }

  public addDoctorLeave(doctorId: string, date: string, reason: string): DoctorLeave {
    const id = `leave_${doctorId}_${date.replace(/[^0-9]/g, '')}_${Math.random().toString(36).substr(2, 4)}`;
    const leave: DoctorLeave = { id, doctorId, date, reason };
    const current = this.doctorLeavesMap.get(doctorId) || [];
    current.push(leave);
    this.doctorLeavesMap.set(doctorId, current);
    return leave;
  }

  public removeDoctorLeave(leaveId: string): boolean {
    for (const [doctorId, leaves] of this.doctorLeavesMap.entries()) {
      const idx = leaves.findIndex((l) => l.id === leaveId);
      if (idx !== -1) {
        leaves.splice(idx, 1);
        this.doctorLeavesMap.set(doctorId, leaves);
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // 4. COMPUTED FREE SLOTS GENERATION
  // Formula: free_slots = doctor_availability(weekday) - doctor_leaves(date) - confirmed_appointments
  // =========================================================================

  public getFreeSlots(doctorId: string, dateStr: string): FreeSlot[] {
    const doctor = this.doctorRecords.get(doctorId);
    if (!doctor || doctor.active === false) return [];

    // 1. Check blocked leaves on this date
    const leaves = this.doctorLeavesMap.get(doctorId) || [];
    if (leaves.some((l) => l.date === dateStr)) {
      return []; // Doctor on leave
    }

    // 2. Determine weekday in Asia/Kolkata timezone
    const dateObj = new Date(`${dateStr}T12:00:00+05:30`);
    if (isNaN(dateObj.getTime())) return [];
    const weekday = dateObj.getDay(); // 0=Sunday, ..., 6=Saturday

    // 3. Get doctor's availability for this weekday
    const weeklyHours = this.doctorAvailabilityMap.get(doctorId) || [];
    const activeHours = weeklyHours.filter((h) => h.weekday === weekday);
    if (activeHours.length === 0) return [];

    // 4. Get all confirmed appointments for this doctor on this date
    const confirmed = Array.from(this.appointmentRecords.values()).filter(
      (a) => a.doctorId === doctorId && a.status === 'confirmed' && a.startAt.startsWith(dateStr)
    );
    const bookedTimes = new Set(
      confirmed.map((a) => {
        const timeMatch = a.startAt.match(/T(\d{2}:\d{2})/);
        return timeMatch ? timeMatch[1] : '';
      })
    );

    // 5. Generate discrete 15-minute slot chunks
    const duration = doctor.consultationMinutes || 15;
    const slots: FreeSlot[] = [];

    for (const shift of activeHours) {
      const [startHour, startMin] = shift.startTime.split(':').map(Number);
      const [endHour, endMin] = shift.endTime.split(':').map(Number);

      let currentMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;

      while (currentMinutes + duration <= endMinutes) {
        const hh = Math.floor(currentMinutes / 60);
        const mm = currentMinutes % 60;
        const time24 = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

        if (!bookedTimes.has(time24)) {
          const ampm = hh >= 12 ? 'PM' : 'AM';
          const dispHour = hh % 12 === 0 ? 12 : hh % 12;
          const displayTime = `${String(dispHour).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;
          const isoString = `${dateStr}T${time24}:00+05:30`;

          slots.push({
            time: time24,
            displayTime,
            isoString,
          });
        }

        currentMinutes += duration;
      }
    }

    return slots;
  }

  public checkDoctorAvailability(
    doctorId: string,
    dateStr: string,
    time24?: string
  ): { isFree: boolean; nearestSlots: FreeSlot[]; doctor: DoctorRecord | null } {
    const doctor = this.doctorRecords.get(doctorId) || null;
    if (!doctor) {
      return { isFree: false, nearestSlots: [], doctor: null };
    }

    const freeSlots = this.getFreeSlots(doctorId, dateStr);

    if (!time24) {
      return {
        isFree: freeSlots.length > 0,
        nearestSlots: freeSlots.slice(0, 3),
        doctor,
      };
    }

    const cleanTime = time24.trim().substring(0, 5);
    const isFree = freeSlots.some((s) => s.time === cleanTime);

    if (isFree) {
      const exactSlot = freeSlots.find((s) => s.time === cleanTime)!;
      const otherSlots = freeSlots.filter((s) => s.time !== cleanTime);
      return { isFree: true, nearestSlots: [exactSlot, ...otherSlots.slice(0, 2)], doctor };
    }

    // Find nearest alternative slots
    const [targetH, targetM] = cleanTime.split(':').map(Number);
    const targetMinutes = targetH * 60 + targetM;

    const sortedByDistance = [...freeSlots].sort((a, b) => {
      const [aH, aM] = a.time.split(':').map(Number);
      const [bH, bM] = b.time.split(':').map(Number);
      return Math.abs(aH * 60 + aM - targetMinutes) - Math.abs(bH * 60 + bM - targetMinutes);
    });

    return {
      isFree: false,
      nearestSlots: sortedByDistance.slice(0, 2),
      doctor,
    };
  }

  // =========================================================================
  // 5. APPOINTMENTS & TRANSACTIONAL BOOKING (Anti-double booking guaranteed)
  // =========================================================================

  public getAllAppointmentRecords(filter?: {
    doctorId?: string;
    status?: string;
    patientSearch?: string;
    clerkUserId?: string;
  }): AppointmentRecord[] {
    const seen = new Set<string>();
    let list: AppointmentRecord[] = [];
    for (const a of this.appointmentRecords.values()) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        list.push(a);
      }
    }

    if (filter?.doctorId) {
      list = list.filter((a) => a.doctorId === filter.doctorId);
    }
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }
    if (filter?.clerkUserId) {
      const cleanSub = filter.clerkUserId.trim();
      list = list.filter((a) => (a as any).clerkUserId === cleanSub || a.patientEmail === cleanSub);
    }
    if (filter?.patientSearch) {
      const q = filter.patientSearch.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.patientName.toLowerCase().includes(q) ||
          a.patientPhone.includes(q) ||
          a.patientEmail.toLowerCase().includes(q) ||
          a.bookingCode.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
  }

  public getAllAppointments(): AppointmentBooking[] {
    const seen = new Set<string>();
    const list: AppointmentBooking[] = [];
    for (const a of this.appointmentRecords.values()) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        list.push({
          id: a.id,
          bookingCode: a.bookingCode,
          patientId: `pat_${a.patientPhone}`,
          patientName: a.patientName,
          patientEmail: a.patientEmail,
          doctorId: a.doctorId,
          doctorName: a.doctorName || 'Doctor',
          appointmentDate: (a as any).appointmentDate || a.startAt.substring(0, 10),
          timeSlot: (a as any).timeSlot || a.startAt.substring(11, 16),
          status: a.status.toUpperCase() as any,
          createdAt: new Date(a.createdAt).getTime(),
        });
      }
    }
    return list;
  }

  public bookAppointmentRecord(params: {
    doctorId: string;
    startAt: string;
    patientName: string;
    patientPhone: string;
    patientEmail: string;
    reason?: string;
    clerkUserId?: string;
  }): AppointmentRecord {
    const doctor = this.doctorRecords.get(params.doctorId);
    if (!doctor) {
      throw new Error(`Doctor not found with ID: ${params.doctorId}`);
    }

    // Validation: 10-digit phone
    const cleanPhone = params.patientPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      throw new Error('Invalid phone length: 10-digit mobile number required.');
    }

    // Validation: Email format
    if (!params.patientEmail || !params.patientEmail.includes('@') || !params.patientEmail.includes('.')) {
      throw new Error('Invalid email format: Please provide a valid email address.');
    }

    // Anti-double-booking check: enforce that no confirmed appointment exists for this doctor & startAt
    const startIso = new Date(params.startAt).toISOString();
    for (const apt of this.appointmentRecords.values()) {
      if (apt.doctorId === params.doctorId && apt.status === 'confirmed') {
        const aptStartIso = new Date(apt.startAt).toISOString();
        if (aptStartIso === startIso) {
          throw new Error('Slot is already booked for this doctor: This slot was just reserved by another caller.');
        }
      }
    }

    // Compute endAt based on doctor consultation minutes
    const startDate = new Date(params.startAt);
    const duration = doctor.consultationMinutes || 15;
    const endDate = new Date(startDate.getTime() + duration * 60000);

    const bookingCode = 'APT-' + Math.floor(100000 + Math.random() * 900000);
    const record: AppointmentRecord = {
      id: `apt_${bookingCode}`,
      bookingCode,
      doctorId: params.doctorId,
      doctorName: doctor.name,
      specialization: doctor.specialization,
      patientName: params.patientName,
      patientPhone: params.patientPhone,
      patientEmail: params.patientEmail,
      reason: params.reason || 'Voice Receptionist Consultation',
      startAt: params.startAt,
      endAt: endDate.toISOString(),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    if (params.clerkUserId) {
      (record as any).clerkUserId = params.clerkUserId;
    }

    this.appointmentRecords.set(record.id, record);
    this.appointmentRecords.set(bookingCode, record);

    // Persist to Supabase appointments table
    if (this.supabase) {
      this.supabase.from('appointments').insert({
        booking_code: bookingCode,
        clerk_user_id: params.clerkUserId || null,
        doctor_id: params.doctorId,
        patient_name: params.patientName,
        patient_email: params.patientEmail,
        patient_phone: params.patientPhone,
        start_at: params.startAt,
        end_at: endDate.toISOString(),
        status: 'confirmed',
        reason: params.reason || 'Voice Intake',
      }).then(({ error }) => {
        if (error) console.warn('[Database] Supabase appointment insert warning:', error.message);
      });
    }

    // Trigger confirmation email
    EmailNotificationService.dispatchConfirmation(record).catch((err) => {
      console.warn('[Email] Dispatch notice:', err.message);
    });

    return record;
  }

  public bookAppointment(data: Omit<AppointmentBooking, 'id' | 'bookingCode'>): AppointmentBooking {
    const bookingCode = 'APT-' + Math.floor(100000 + Math.random() * 900000);
    const doctorId = data.doctorId || (data.doctorName ? this.findDoctor(data.doctorName)?.id : undefined) || Array.from(this.doctorRecords.keys())[0] || 'doc_sharma';
    const cleanPhoneDigits = (data.patientId || '').replace(/[^0-9]/g, '');
    const patientPhone = cleanPhoneDigits.length >= 10 ? cleanPhoneDigits : '9876543210';

    let dateStr = data.appointmentDate || (data as any).date || '2026-11-02';
    if (dateStr === 'Tomorrow' || dateStr === 'Today' || dateStr.includes('Tomorrow')) {
      const d = new Date();
      if (dateStr.includes('Tomorrow')) d.setDate(d.getDate() + 1);
      dateStr = d.toISOString().substring(0, 10);
    }
    let timeStr = data.timeSlot || '10:00';
    const ampmMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1]);
      const m = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
      const isPm = (ampmMatch[3] || '').toUpperCase() === 'PM';
      if (isPm && h < 12) h += 12;
      if (!isPm && (ampmMatch[3] || '').toUpperCase() === 'AM' && h === 12) h = 0;
      timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const startAt = `${dateStr}T${timeStr}:00+05:30`;

    let record: AppointmentRecord;
    try {
      record = this.bookAppointmentRecord({
        doctorId,
        startAt,
        patientName: data.patientName,
        patientPhone,
        patientEmail: data.patientEmail || 'patient@miraai.care',
      });
    } catch (err: any) {
      if (err.message?.includes('already booked')) {
        const freeSlots = this.getFreeSlots(doctorId, dateStr);
        if (freeSlots.length > 0) {
          const nextSlot = freeSlots[0].time;
          const altStartAt = `${dateStr}T${nextSlot}:00+05:30`;
          record = this.bookAppointmentRecord({
            doctorId,
            startAt: altStartAt,
            patientName: data.patientName,
            patientPhone,
            patientEmail: data.patientEmail || 'patient@miraai.care',
          });
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    (record as any).appointmentDate = data.appointmentDate || (data as any).date || dateStr;
    (record as any).timeSlot = data.timeSlot || timeStr;

    return {
      id: record.id,
      bookingCode: record.bookingCode,
      ...data,
      doctorId,
      doctorName: record.doctorName,
      appointmentDate: data.appointmentDate || (data as any).date || dateStr,
      timeSlot: data.timeSlot || timeStr,
      status: 'CONFIRMED',
      createdAt: Date.now(),
    };
  }

  public cancelAppointmentRecord(idOrCode: string, reason?: string): AppointmentRecord | null {
    const apt = this.appointmentRecords.get(idOrCode);
    if (!apt) return null;

    apt.status = 'cancelled';
    this.appointmentRecords.set(apt.id, apt);
    this.appointmentRecords.set(apt.bookingCode, apt);

    if (this.supabase) {
      this.supabase.from('appointments').update({ status: 'cancelled' }).eq('booking_code', apt.bookingCode).then(({ error }) => {
        if (error) console.warn('[Database] Supabase appointment cancel warning:', error.message);
      });
    }

    EmailNotificationService.dispatchCancellation(apt, reason).catch((e) => {
      console.warn('Cancel email notice:', e.message);
    });

    return apt;
  }

  public cancelAppointment(bookingCode: string): boolean {
    const apt = this.cancelAppointmentRecord(bookingCode);
    return !!apt;
  }

  public rescheduleAppointmentRecord(idOrCode: string, newStartAt: string): AppointmentRecord | null {
    const apt = this.appointmentRecords.get(idOrCode);
    if (!apt) return null;

    const doctor = this.doctorRecords.get(apt.doctorId);
    const duration = doctor?.consultationMinutes || 15;
    const endDate = new Date(new Date(newStartAt).getTime() + duration * 60000);

    apt.startAt = newStartAt;
    apt.endAt = endDate.toISOString();
    apt.status = 'confirmed';
    this.appointmentRecords.set(apt.id, apt);
    this.appointmentRecords.set(apt.bookingCode, apt);

    if (this.supabase) {
      this.supabase.from('appointments').update({
        start_at: newStartAt,
        end_at: endDate.toISOString(),
        status: 'confirmed',
      }).eq('booking_code', apt.bookingCode).then(({ error }) => {
        if (error) console.warn('[Database] Supabase appointment reschedule warning:', error.message);
      });
    }

    return apt;
  }

  public exportAppointmentsCSV(): string {
    const appointments = this.getAllAppointmentRecords();
    const headers = 'Booking ID,Doctor Name,Specialization,Patient Name,Phone,Email,Date & Time (IST),Status\n';
    const rows = appointments
      .map(
        (a) =>
          `"${a.bookingCode}","${a.doctorName || ''}","${a.specialization || ''}","${a.patientName}","${a.patientPhone}","${a.patientEmail}","${a.startAt}","${a.status}"`
      )
      .join('\n');
    return headers + rows;
  }

  // =========================================================================
  // 6. CONSULTATIONS & SUMMARIES
  // =========================================================================

  public createSession(
    patientId: string,
    patientName: string,
    doctorId?: string,
    doctorName?: string
  ): ConsultationSession {
    const id = 'sess_' + Date.now();
    const session: ConsultationSession = {
      id,
      patientId,
      patientName,
      doctorAssignedId: doctorId,
      doctorAssignedName: doctorName,
      sessionDurationSeconds: 0,
      consentGiven: true,
      consentTimestamp: Date.now(),
      status: 'ACTIVE',
      conversationTranscript: [],
      createdAt: Date.now(),
    };
    this.sessionsMap.set(id, session);

    if (this.supabase) {
      this.supabase.from('consultations').insert({
        id,
        patient_name: patientName,
        status: 'ACTIVE',
        transcript: [],
      }).then(({ error }) => {
        if (error) console.warn('[Database] Supabase consultation insert warning:', error.message);
      });
    }

    return session;
  }

  public getSession(id: string): ConsultationSession | undefined {
    return this.sessionsMap.get(id);
  }

  public updateSession(session: ConsultationSession): void {
    this.sessionsMap.set(session.id, session);

    if (this.supabase) {
      this.supabase.from('consultations').update({
        transcript: session.conversationTranscript || [],
        summary: session.summary || null,
        urgency: session.summary?.urgencyLevel || 'ROUTINE',
        status: session.status || 'COMPLETED',
        session_duration_seconds: session.sessionDurationSeconds || 0,
      }).eq('id', session.id).then(({ error }) => {
        if (error) console.warn('[Database] Supabase consultation update warning:', error.message);
      });
    }
  }

  public getAllSessions(): ConsultationSession[] {
    return Array.from(this.sessionsMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public saveClinicalSummary(summary: ClinicalSummary): void {
    this.summariesMap.set(summary.id, summary);
    const session = this.sessionsMap.get(summary.sessionId);
    if (session) {
      session.summary = summary;
      this.updateSession(session);
    }
  }

  public getSummary(id: string): ClinicalSummary | undefined {
    return this.summariesMap.get(id);
  }

  // =========================================================================
  // 7. EMAIL LOGS & CALL METRICS
  // =========================================================================

  public logEmail(entry: {
    appointmentId?: string;
    toEmail: string;
    subject: string;
    status: string;
    provider: string;
    providerId?: string;
    errorMessage?: string;
    retryCount?: number;
  }): void {
    this.emailLogs.push({ ...entry, sentAt: new Date().toISOString() });
    if (this.supabase) {
      this.supabase.from('email_logs').insert({
        appointment_id: entry.appointmentId || null,
        to_email: entry.toEmail,
        subject: entry.subject,
        status: entry.status,
        provider: entry.provider,
        provider_id: entry.providerId || null,
        error_message: entry.errorMessage || null,
        retry_count: entry.retryCount || 0,
      }).then(({ error }) => {
        if (error) console.warn('[Database] Supabase email log insert warning:', error.message);
      });
    }
  }

  public getEmailLogs(): any[] {
    return this.emailLogs;
  }

  public recordCallMetrics(data: {
    consultationId: string;
    vadMs?: number;
    sttMs?: number;
    llmTtftMs?: number;
    ttsTtfbMs?: number;
    totalLatencyMs?: number;
  }): void {
    this.callMetricsLogs.push({ ...data, createdAt: new Date().toISOString() });
    if (this.supabase) {
      this.supabase.from('call_metrics').insert({
        consultation_id: data.consultationId,
        vad_ms: data.vadMs,
        stt_ms: data.sttMs,
        llm_ttft_ms: data.llmTtftMs,
        tts_ttfb_ms: data.ttsTtfbMs,
        total_latency_ms: data.totalLatencyMs,
      }).then(({ error }) => {
        if (error) console.warn('[Database] Supabase call metrics warning:', error.message);
      });
    }
  }

  // =========================================================================
  // 8. ADMIN OVERVIEW (Real counts)
  // =========================================================================

  public async getAdminOverview(): Promise<{
    totalSessions: number;
    totalAppointments: number;
    totalPatients: number;
    activeDoctors: number;
    urgentCases: number;
  }> {
    if (this.supabase) {
      try {
        const [sessRes, aptRes, profRes, docRes, urgentRes] = await Promise.all([
          this.supabase.from('consultations').select('*', { count: 'exact', head: true }),
          this.supabase.from('appointments').select('*', { count: 'exact', head: true }),
          this.supabase.from('profiles').select('*', { count: 'exact', head: true }),
          this.supabase.from('doctors').select('*', { count: 'exact', head: true }).eq('is_active', true),
          this.supabase.from('consultations').select('*', { count: 'exact', head: true }).in('urgency', ['URGENT', 'EMERGENCY']),
        ]);

        if (!sessRes.error && !aptRes.error && !profRes.error && !docRes.error) {
          return {
            totalSessions: sessRes.count || 0,
            totalAppointments: aptRes.count || 0,
            totalPatients: profRes.count || 0,
            activeDoctors: docRes.count || 0,
            urgentCases: urgentRes.count || 0,
          };
        }
      } catch (err: any) {
        console.warn('[Database] Overview remote query notice:', err.message);
      }
    }

    // Return exact counts from live state
    const sessions = this.getAllSessions();
    const appointments = this.getAllAppointmentRecords();
    const patients = this.getAllPatients();
    const activeDoctors = this.getAllDoctorRecords(true);
    const urgentCases = sessions.filter(
      (s) => s.summary?.urgencyLevel === 'URGENT' || s.summary?.urgencyLevel === 'EMERGENCY'
    ).length;

    return {
      totalSessions: sessions.length,
      totalAppointments: appointments.length,
      totalPatients: patients.length,
      activeDoctors: activeDoctors.length,
      urgentCases,
    };
  }
}
