-- MiraAI Supabase PostgreSQL Schema
-- Single Source of Truth for MiraAI Clinical Voice Receptionist & Hospital System
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/rsyeuofxjijiqnjzxsdz/sql/new

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles Table (Synced directly from Clerk verified sessions)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  full_name TEXT,
  email TEXT NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  phone TEXT,
  phone_verified BOOLEAN DEFAULT FALSE,
  role TEXT DEFAULT 'patient' CHECK (role IN ('patient', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Doctors Table (Created strictly from Admin Panel; starts with 0 doctors)
CREATE TABLE IF NOT EXISTS public.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  specialization TEXT NOT NULL,
  department TEXT NOT NULL,
  languages TEXT[] DEFAULT ARRAY['Hindi', 'English'],
  phone TEXT,
  email TEXT,
  consultation_fee NUMERIC DEFAULT 500,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Doctor Availability Table (Weekly working schedule)
CREATE TABLE IF NOT EXISTS public.doctor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE,
  weekday INT NOT NULL CHECK (weekday >= 0 AND weekday <= 6), -- 0=Sun, 1=Mon, ..., 6=Sat
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_duration_minutes INT DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Doctor Leaves Table (Blocked days & holidays)
CREATE TABLE IF NOT EXISTS public.doctor_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Appointments Table (Atomic booking ledger)
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT UNIQUE NOT NULL,
  clerk_user_id TEXT REFERENCES public.profiles(clerk_user_id) ON DELETE SET NULL,
  doctor_id UUID REFERENCES public.doctors(id) ON DELETE RESTRICT,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  patient_phone TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Anti-Double Booking Unique Index: Enforces at DB level that no doctor can be double-booked
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_doctor_slot
ON public.appointments (doctor_id, start_at)
WHERE status = 'confirmed';

-- High performance lookup indexes
CREATE INDEX IF NOT EXISTS idx_appointments_clerk_user ON public.appointments(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON public.appointments(doctor_id, start_at, status);
CREATE INDEX IF NOT EXISTS idx_availability_lookup ON public.doctor_availability(doctor_id, weekday);
CREATE INDEX IF NOT EXISTS idx_leaves_lookup ON public.doctor_leaves(doctor_id, leave_date);

-- 6. Consultations Table (Transcripts, Clinical Summaries & Visual Spot)
CREATE TABLE IF NOT EXISTS public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  clerk_user_id TEXT,
  patient_name TEXT,
  disease_spot_image_url TEXT,
  session_duration_seconds INT DEFAULT 0,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB,
  urgency TEXT DEFAULT 'ROUTINE',
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED', 'INTERRUPTED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consultations_clerk_user ON public.consultations(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_consultations_appointment ON public.consultations(appointment_id);

-- 7. Email Logs Table (Resend / Gmail SMTP delivery auditor)
CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL, -- 'delivered', 'failed', 'retrying'
  provider TEXT NOT NULL, -- 'resend', 'gmail_smtp'
  provider_id TEXT,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_appointment ON public.email_logs(appointment_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON public.email_logs(to_email);

-- 8. Call Metrics Table (Per-turn latency measurements)
CREATE TABLE IF NOT EXISTS public.call_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID REFERENCES public.consultations(id) ON DELETE CASCADE,
  vad_ms NUMERIC,
  stt_ms NUMERIC,
  llm_ttft_ms NUMERIC,
  tts_ttfb_ms NUMERIC,
  total_latency_ms NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow public/authenticated read on active doctors and availability
CREATE POLICY "Public read active doctors" ON public.doctors
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Public read doctor availability" ON public.doctor_availability
  FOR SELECT USING (TRUE);

CREATE POLICY "Public read doctor leaves" ON public.doctor_leaves
  FOR SELECT USING (TRUE);

-- Patients can only read their own profile, appointments, and consultations
CREATE POLICY "Patients read own profile" ON public.profiles
  FOR SELECT USING (auth.jwt() ->> 'sub' = clerk_user_id);

CREATE POLICY "Patients read own appointments" ON public.appointments
  FOR SELECT USING (auth.jwt() ->> 'sub' = clerk_user_id);

CREATE POLICY "Patients read own consultations" ON public.consultations
  FOR SELECT USING (auth.jwt() ->> 'sub' = clerk_user_id);

-- Admins can perform full read/write across all records
CREATE POLICY "Admins full access profiles" ON public.profiles
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins full access doctors" ON public.doctors
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins full access appointments" ON public.appointments
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins full access consultations" ON public.consultations
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

CREATE POLICY "Admins full access email_logs" ON public.email_logs
  FOR ALL USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
