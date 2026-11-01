export type UrgencyLevel = 'ROUTINE' | 'MODERATE' | 'URGENT' | 'EMERGENCY';
export type AppointmentStatus = 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
export type ConsultationStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'INTERRUPTED' | 'USER_ENDED';

export interface DoctorRecord {
  id: string;
  name: string;
  specialization: string;
  languages: string[];
  phone: string;
  email: string;
  consultationMinutes: number;
  active: boolean;
  department?: string;
  consultationFee?: number;
}

export interface DoctorAvailability {
  id: string;
  doctorId: string;
  weekday: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // HH:MM (24h) e.g. "09:00"
  endTime: string; // HH:MM (24h) e.g. "17:00"
}

export interface DoctorLeave {
  id: string;
  doctorId: string;
  date: string; // YYYY-MM-DD
  reason: string;
}

export interface AppointmentRecord {
  id: string;
  bookingCode: string;
  doctorId: string;
  doctorName?: string;
  specialization?: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string;
  reason: string;
  startAt: string; // ISO datetime
  endAt: string; // ISO datetime
  status: 'confirmed' | 'cancelled' | 'completed';
  createdAt: string;
}

export interface FreeSlot {
  time: string; // HH:MM 24h e.g. "10:00"
  displayTime: string; // e.g. "10:00 AM"
  isoString: string;
}

export interface DoctorInfo {
  id: string;
  name: string;
  specialty: string;
  department: string;
  availableDays: string[];
  slots: string[];
  consultationFee: number;
  isActive: boolean;
}

export interface PatientProfile {
  id: string;
  clerkUserId: string;
  fullName: string;
  email: string;
  phone: string;
  createdAt: number;
}

export interface TranscriptItem {
  speaker: 'Mira' | 'Patient';
  text: string;
  timestamp: number;
  latencyMs?: number;
}

export interface ClinicalSummary {
  id: string;
  sessionId: string;
  patientId: string;
  chiefComplaint: string;
  symptomsList: string[];
  symptomDuration: string;
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  urgencyLevel: UrgencyLevel;
  suspectedConditions: string[];
  spotVisualFindings?: string;
  doctorRecommendation: string;
  fullClinicalNote: string;
  userEnded?: boolean;
  endReason?: string;
  createdAt: number;
}

export interface AppointmentBooking {
  id: string;
  bookingCode: string; // e.g. APT-782910
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  sessionId: string;
  appointmentDate: string;
  timeSlot: string;
  status: AppointmentStatus;
  createdAt: number;
}

export interface ConsultationSession {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  painAndDisease?: string;
  clinicalStage?: 'NAME' | 'PHONE' | 'SYMPTOMS' | 'APPOINTMENT' | 'COMPLETE';
  doctorAssignedId?: string;
  doctorAssignedName?: string;
  diseaseSpotImageUrl?: string;
  sessionDurationSeconds: number;
  conversationTranscript: TranscriptItem[];
  consentGiven: boolean;
  consentTimestamp: number;
  status: ConsultationStatus;
  summary?: ClinicalSummary;
  appointment?: AppointmentBooking;
  modelUsed?: string;
  voiceUsed?: string;
  userEnded?: boolean;
  endReason?: string;
  createdAt: number;
}

export interface LatencyBreakdown {
  vadMs: number;
  sttMs: number;
  fastPathMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
  totalEndToEndMs: number;
}

export interface AgentTurnResponse {
  text: string;
  audioChunkBase64?: string;
  latencyBreakdown: LatencyBreakdown;
  isComplete: boolean;
  actionTaken?: string;
  modelUsed?: string;
  voiceUsed?: string;
  appointmentConfirmed?: AppointmentBooking;
  toolExecuted?: string;
  toolParameters?: Record<string, any>;
  toolResult?: Record<string, any>;
  extractedSlots?: {
    patientName?: string;
    phoneNumber?: string;
    painAndDisease?: string;
    doctorSpecialty?: string;
    doctorName?: string;
    date?: string;
    timeSlot?: string;
    symptoms?: string[];
  };
}
