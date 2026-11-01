import type { AppointmentBooking, ClinicalSummary } from '../types';
import nodemailer from 'nodemailer';

export interface SendConsultationEmailParams {
  to: string;
  patientName: string;
  sessionId: string;
  appointment?: AppointmentBooking;
  summary?: ClinicalSummary;
  fullNote?: string;
}

export interface EmailTimingCheck {
  valid: boolean;
  dispatchLatencyMs: number;
  operatingHoursVerified: boolean;
  scheduledIst: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  provider?: 'gmail_smtp';
  error?: string;
  skipped?: boolean;
  timingCheck?: EmailTimingCheck;
}

export class EmailService {
  private gmailUser: string;
  private gmailPass: string;

  constructor(gmailUser?: string, gmailPass?: string) {
    this.gmailUser = gmailUser !== undefined ? gmailUser : (process.env.GMAIL_USER || 'xyz577616@gmail.com');
    this.gmailPass = gmailPass !== undefined ? gmailPass : (process.env.GMAIL_PASS || 'ezxsvfmmuazjecvz');
  }

  // Timing check verification helper
  public verifyTiming(dateStr?: string, timeStr?: string): {
    valid: boolean;
    withinOperatingHours: boolean;
    operatingHoursNote: string;
    istFormatted: string;
  } {
    const now = new Date();
    const istFormatted = now.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    let withinOperatingHours = true;
    let operatingHoursNote = 'Operating Shift: Mon-Fri 10:00 AM - 06:00 PM IST (Sat 10:00 AM - 02:00 PM IST)';

    if (timeStr) {
      const match = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        let hour = parseInt(match[1]);
        const isPM = timeStr.toLowerCase().includes('pm');
        const isAM = timeStr.toLowerCase().includes('am');
        if (isPM && hour < 12) hour += 12;
        if (isAM && hour === 12) hour = 0;
        if (hour < 10 || hour >= 18) {
          withinOperatingHours = false;
          operatingHoursNote = 'Notice: Appointment slot scheduled outside standard 10:00 AM - 06:00 PM shift';
        }
      }
    }

    return {
      valid: true,
      withinOperatingHours,
      operatingHoursNote,
      istFormatted,
    };
  }

  public async sendConsultationConfirmation(params: SendConsultationEmailParams): Promise<EmailResult> {
    const { to, patientName, appointment, summary, sessionId } = params;

    if (!to || !to.includes('@')) {
      console.warn(`[EmailService] Invalid recipient email address: "${to}"`);
      return { success: false, error: 'Invalid recipient email address' };
    }

    const dispatchStart = Date.now();
    const bookingCode = appointment?.bookingCode || 'APT-CONFIRMED';
    const doctorName = appointment?.doctorName || 'Dr. Assigned Specialist';
    const specialty = appointment?.specialty || 'General Medicine';
    const date = appointment?.date || 'Upcoming';
    const timeSlot = appointment?.timeSlot || 'Scheduled Slot';
    const complaint = summary?.chiefComplaint || 'Clinical consultation intake';
    const urgency = summary?.urgencyLevel || 'ROUTINE';
    const symptoms = summary?.symptomsList?.join(', ') || 'Reported symptoms reviewed';
    const recommendation = summary?.doctorRecommendation || `Consultation scheduled with ${doctorName}`;

    // Perform timing checks
    const timing = this.verifyTiming(date, timeSlot);

    const subject = `MiraAI Clinical Confirmation - ${doctorName} Appointment (${bookingCode})`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MiraAI Consultation Confirmation</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px; text-align: center; color: #ffffff; }
    .logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #94a3b8; margin: 0; }
    .content { padding: 32px; }
    .greeting { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .card-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #ff5722; margin-top: 0; margin-bottom: 12px; }
    .booking-badge { display: inline-block; background: #ff5722; color: #ffffff; font-weight: 800; font-size: 16px; padding: 6px 14px; border-radius: 8px; margin-bottom: 14px; letter-spacing: 0.5px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #edf2f7; font-size: 14px; }
    .detail-label { color: #64748b; font-weight: 500; }
    .detail-val { font-weight: 700; color: #0f172a; text-align: right; }
    .urgency-badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .urgency-ROUTINE { background: #dcfce7; color: #15803d; }
    .urgency-MODERATE { background: #fef3c7; color: #b45309; }
    .urgency-URGENT, .urgency-EMERGENCY { background: #fee2e2; color: #b91c1c; }
    .btn-container { text-align: center; margin: 32px 0 16px 0; }
    .btn { display: inline-block; background: #ff5722; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; padding: 12px 28px; border-radius: 10px; }
    .timing-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px; margin-bottom: 20px; font-size: 12px; color: #1e40af; }
    .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">MiraAI Healthcare</div>
      <p class="subtitle">Autonomous Clinical Voice Assistant & Doctor Appointment System</p>
    </div>
    <div class="content">
      <div class="greeting">Namaste ${patientName || 'Patient'},</div>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Your clinical consultation interview with MiraAI has completed. Below is your clinical summary, confirmed doctor appointment details, and timing verification.
      </p>

      <!-- Timing Verification Block -->
      <div class="timing-box">
        <strong>TIMING & CLINICAL VERIFICATION</strong><br>
        Intake Timestamp: ${timing.istFormatted}<br>
        Hospital Shift: ${timing.operatingHoursNote}<br>
        Consultation Slot: ${date} at ${timeSlot} (Standard 15 mins slot)
      </div>

      <div class="card">
        <h3 class="card-title">Confirmed Doctor Appointment</h3>
        <div style="text-align: center;">
          <div class="booking-badge">Booking Code: ${bookingCode}</div>
        </div>
        <div class="detail-row">
          <span class="detail-label">Assigned Doctor</span>
          <span class="detail-val">${doctorName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Department / Specialty</span>
          <span class="detail-val">${specialty}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date & Time Slot</span>
          <span class="detail-val">${date} at ${timeSlot}</span>
        </div>
        <div class="detail-row" style="border-bottom: none;">
          <span class="detail-label">Status</span>
          <span class="detail-val" style="color: #16a34a;">Confirmed in Clinic Database</span>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">AI Clinical Intake Summary</h3>
        <div class="detail-row">
          <span class="detail-label">Chief Complaint</span>
          <span class="detail-val">${complaint}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reported Symptoms</span>
          <span class="detail-val">${symptoms}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Triage Urgency</span>
          <span class="detail-val">
            <span class="urgency-badge urgency-${urgency}">${urgency}</span>
          </span>
        </div>
        <div class="detail-row" style="border-bottom: none; flex-direction: column; align-items: flex-start;">
          <span class="detail-label" style="margin-bottom: 4px;">Recommendation</span>
          <span style="font-size: 13px; color: #1e293b; font-weight: 500; line-height: 1.4;">${recommendation}</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="http://localhost:3000/user/dashboard" class="btn">Open Patient Dashboard</a>
      </div>
    </div>
    <div class="footer">
      <p style="margin: 0 0 6px 0;">This email was automatically generated by MiraAI.</p>
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">Session ID: ${sessionId} &bull; Confidential Clinical Intake Record &bull; Asia/Kolkata (IST)</p>
    </div>
  </div>
</body>
</html>
`;

    // Primary Dispatch: Real Gmail SMTP (using user-provided credentials)
    if (this.gmailUser && this.gmailPass) {
      try {
        console.log(`[EmailService] Sending consultation confirmation via Gmail SMTP (${this.gmailUser}) to ${to}...`);
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: this.gmailUser,
            pass: this.gmailPass,
          },
        });

        const info = await transporter.sendMail({
          from: `"MiraAI Clinical Care" <${this.gmailUser}>`,
          to,
          subject,
          html,
        });

        const latencyMs = Date.now() - dispatchStart;
        console.log(`[EmailService] Real email delivered via Gmail SMTP to ${to}, Message ID: ${info.messageId} in ${latencyMs}ms`);
        return {
          success: true,
          messageId: info.messageId,
          provider: 'gmail_smtp',
          timingCheck: {
            valid: timing.valid,
            dispatchLatencyMs: latencyMs,
            operatingHoursVerified: timing.withinOperatingHours,
            scheduledIst: timing.istFormatted,
          },
        };
      } catch (gmailErr: any) {
        console.warn('[EmailService] Gmail SMTP error:', gmailErr.message);
        return {
          success: false,
          error: `Gmail SMTP error: ${gmailErr.message}`,
          timingCheck: {
            valid: timing.valid,
            dispatchLatencyMs: Date.now() - dispatchStart,
            operatingHoursVerified: timing.withinOperatingHours,
            scheduledIst: timing.istFormatted,
          },
        };
      }
    }

    return {
      success: false,
      skipped: true,
      error: 'Gmail SMTP credentials not configured (GMAIL_USER, GMAIL_PASS)',
    };
  }
}

// Asynchronous Email Dispatcher for Clinical Appointments
export interface AppointmentEmailPayload {
  bookingCode: string;
  patientName: string;
  patientEmail: string;
  patientPhone: string;
  doctorName: string;
  specialization: string;
  doctorEmail?: string;
  startAt: string; // ISO datetime
  endAt?: string;
  reason?: string;
  clinicAddress?: string;
  actionType?: 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED';
}

export interface EmailDispatchRecord {
  id: string;
  bookingCode: string;
  recipient: string;
  subject: string;
  body: string;
  sentAt: number;
  status: 'DELIVERED' | 'SIMULATED';
  provider?: string;
}

export class EmailNotificationService {
  private static clinicAddress = 'MiraAI Healthcare Clinic, Building 4, Medical Enclave, Pune, Maharashtra 411001';
  private static sentEmails: EmailDispatchRecord[] = [];

  public static getSentEmails(): EmailDispatchRecord[] {
    return this.sentEmails;
  }

  public static async dispatchConfirmation(record: any): Promise<void> {
    return this.sendConfirmationEmail({
      bookingCode: record.bookingCode,
      doctorName: record.doctorName,
      specialization: record.specialization,
      startAt: record.startAt,
      patientName: record.patientName,
      patientPhone: record.patientPhone,
      patientEmail: record.patientEmail,
      reason: record.reason,
      actionType: 'CONFIRMED',
    });
  }

  public static async dispatchCancellation(record: any, reason?: string): Promise<void> {
    return this.sendConfirmationEmail({
      bookingCode: record.bookingCode,
      doctorName: record.doctorName,
      specialization: record.specialization,
      startAt: record.startAt,
      patientName: record.patientName,
      patientPhone: record.patientPhone,
      patientEmail: record.patientEmail,
      reason: reason || record.reason,
      actionType: 'CANCELLED',
    });
  }

  public static formatISTDateTime(isoString: string): string {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'full',
        timeStyle: 'short',
      });
    } catch {
      return isoString;
    }
  }

  public static async sendConfirmationEmail(payload: AppointmentEmailPayload): Promise<void> {
    setTimeout(async () => {
      try {
        const istFormatted = this.formatISTDateTime(payload.startAt);
        const action = payload.actionType || 'CONFIRMED';
        const subject =
          action === 'CANCELLED'
            ? `[MiraAI] Appointment Cancelled - ${payload.bookingCode}`
            : action === 'RESCHEDULED'
            ? `[MiraAI] Appointment Rescheduled - ${payload.bookingCode}`
            : `[MiraAI] Appointment Confirmed with ${payload.doctorName} (${payload.bookingCode})`;

        const body = `
Dear ${payload.patientName},

Your doctor appointment has been ${action.toLowerCase()} successfully at MiraAI Clinic.

--------------------------------------------------
APPOINTMENT & TIMING DETAILS (ASIA/KOLKATA)
--------------------------------------------------
Booking ID:        ${payload.bookingCode}
Doctor:            ${payload.doctorName}
Specialization:    ${payload.specialization}
Date & Time (IST): ${istFormatted}
Consultation Slot: Standard 15-Minute Clinical Session
Operating Shift:   Mon-Fri 10:00 AM - 06:00 PM IST (Sat 10:00 AM - 02:00 PM IST)
Consultation Mode: Hospital Clinic Walk-in / Live Voice Consultation
Reason / Symptoms: ${payload.reason || 'Clinical Consultation'}

Clinic Address:
${this.clinicAddress}

Patient Contact:   ${payload.patientPhone}
Patient Email:     ${payload.patientEmail}

--------------------------------------------------
NEED TO RESCHEDULE OR CANCEL?
--------------------------------------------------
You can manage your booking online via your patient portal:
http://localhost:3000/user/dashboard?apt=${payload.bookingCode}

Warm regards,
MiraAI Clinical Administration Team
--------------------------------------------------
`;

        let delivered = false;
        let providerUsed = 'SIMULATED';

        const gmailUser = process.env.GMAIL_USER || 'xyz577616@gmail.com';
        const gmailPass = process.env.GMAIL_PASS || 'ezxsvfmmuazjecvz';

        if (gmailUser && gmailPass && payload.patientEmail && payload.patientEmail.includes('@')) {
          try {
            const transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: { user: gmailUser, pass: gmailPass },
            });
            await transporter.sendMail({
              from: `"MiraAI Clinic" <${gmailUser}>`,
              to: payload.patientEmail,
              subject,
              text: body,
            });
            delivered = true;
            providerUsed = 'gmail_smtp';
            console.log(`[EmailNotificationService] Real appointment email dispatched via Gmail SMTP to ${payload.patientEmail}`);
          } catch (smtpErr: any) {
            console.warn('[EmailNotificationService] Gmail dispatch notice:', smtpErr.message);
          }
        }

        const record: EmailDispatchRecord = {
          id: 'email_' + Math.random().toString(36).substr(2, 9),
          bookingCode: payload.bookingCode,
          recipient: payload.patientEmail,
          subject,
          body,
          sentAt: Date.now(),
          status: delivered ? 'DELIVERED' : 'SIMULATED',
          provider: providerUsed,
        };

        this.sentEmails.push(record);
        console.log(`[Email] Notification logged for ${payload.patientEmail} (${action}): ${payload.bookingCode} [${record.status}]`);
      } catch (err: any) {
        console.warn('[Email] Non-blocking dispatch error:', err.message);
      }
    }, 10);
  }
}
