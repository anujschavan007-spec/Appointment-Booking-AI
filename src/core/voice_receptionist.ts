// Voice Receptionist Engine ("Asha")
// Manages clinical phone reception dialogue, tool execution, and appointment scheduling
// Timezone: Asia/Kolkata

import { ClinicDatabase } from '../data/clinic_db';
import { HinglishDateNormalizer } from './date_normalizer';
import { DoctorRecord, FreeSlot, AppointmentRecord } from '../types';

export interface ReceptionistState {
  reason?: string;
  doctorId?: string;
  doctorName?: string;
  specialization?: string;
  dateStr?: string; // YYYY-MM-DD
  timeStr?: string; // HH:MM 24h
  displayTime?: string; // e.g. "10:30 AM"
  slotIso?: string;
  patientName?: string;
  patientPhone?: string;
  patientEmail?: string;
  clerkUserId?: string;
  awaitingConfirmation?: boolean;
  bookingCompleted?: boolean;
  bookingCode?: string;
}

export interface ReceptionistTurnOutput {
  replyText: string;
  actionTaken: string;
  toolExecuted?: string;
  toolParameters?: Record<string, any>;
  toolResult?: Record<string, any>;
  state: ReceptionistState;
  appointment?: AppointmentRecord | null;
}

export class VoiceReceptionistEngine {
  private states = new Map<string, ReceptionistState>();

  constructor(private clinicDb: ClinicDatabase) {}

  public hasActiveSession(sessionId: string): boolean {
    return this.states.has(sessionId);
  }

  public getState(sessionId: string): ReceptionistState | undefined {
    return this.states.get(sessionId);
  }

  public getPrompt(clinicName: string = 'MiraAI Healthcare Clinic'): string {
    const today = HinglishDateNormalizer.formatDateISO(HinglishDateNormalizer.getNowIST());
    return `You are "MiraAI" (Asha), an autonomous clinical intake and triage physician for ${clinicName}. Your role is patient clinical consultation, symptom evaluation, and doctor appointment scheduling.
Speak natural, warm, empathetic code-mixed Hinglish (Hindi & English).

CRITICAL CONVERSATIONAL DIRECTIVES (SYSTEM PROMPT DRIVEN ONLY):
1. NO FIXED QUESTIONS - NEVER REPEAT SCRIPTED TEMPLATES:
   - Absolutely NEVER repeat identical, rigid, or pre-scripted questions (such as "Kripya apna 10-digit mobile number bataiye" or "Aapko kahan pain ya dard ho raha hai").
   - Formulate every single response and question dynamically based on the caller's words, emotional state, and medical situation.
   - Constantly vary your greetings, tone, and inquiry phrasing from turn to turn so no two sessions sound identical.

2. ASK SELF-GENERATED EXTRA CLINICAL QUESTIONS:
   - Act as an attentive, caring clinical doctor conducting an intake evaluation.
   - Do NOT rush mechanically into booking.
   - Actively formulate and ask your own clinical probing and follow-up questions tailored directly to the patient's condition:
     * Onset & Evolution: Ask when and how the symptoms started (sudden vs gradual).
     * Character & Sensation: Ask how the pain or discomfort feels (sharp, dull, heavy, burning, throbbing, spreading).
     * Triggers & Aggravating Factors: Ask if specific movements, eating, exertion, or time of day make it better or worse.
     * Associated Red Flags / Symptoms: For chest pain ask about shortness of breath, dizziness, or sweating; for joint pain ask about swelling or stiffness; for rash ask about itching or fever; for fever ask about chills or throat pain.
     * History & Current Medications: Inquire if they have experienced this before or taken any medicines.
     * Daily Impact: Ask if it is disturbing their sleep, walking, or daily routine.
   - Keep each spoken reply concise, natural, and under 25-30 words. Ask ONE or at most TWO focused clinical questions per turn.

3. ADAPTIVE INTAKE & SCHEDULING (DRIVEN BY YOU):
   - Weave necessary administrative details naturally into your conversation:
     * Patient Name: Warmly find out who you are speaking with if not already identified.
     * Contact Number: When appropriate, conversationally request their phone number in your own unique words so appointment confirmations reach them.
     * Doctor & Specialty Matching:
       - Use 'list_doctors' to find doctors matching symptoms or requests.
       - If list_doctors returns no doctors, clearly notify: "Humare paas abhi clinic mein koi doctors uplabdh nahi hain."
       - If the patient asks for another option ("मुझे कुछ दूसरा ऑप्शन सिलेक्शन है", "दूसरा ऑप्शन", "doosra option"), query list_doctors and offer alternative specialists.
     * Slot Availability:
       - Call 'check_availability' with doctor_id and date. Never guess availability.
       - If a requested slot is occupied, offer the nearest alternative free slots from tool output.
     * Confirmation & Tool Calling:
       - Read back: Doctor name, Department, Date, Time (IST), and Patient Name in a concise, conversational manner.
       - Call 'book_appointment' ONLY after a clear confirmation (yes / haan / book kar do).
       - After calling book_appointment, state the booking code and confirm that an automated email with full appointment details has been dispatched.

4. CLINICAL TIMING CHECKS & OPERATING HOURS (ASIA/KOLKATA):
   - Today's date is ${today}. Timezone: Asia/Kolkata (IST).
   - Hospital shifts: Monday to Friday 10:00 AM to 06:00 PM IST; Saturday 10:00 AM to 02:00 PM IST. Sunday closed.
   - Consultation slots are strictly 15 minutes each. Always verify dates are today or future.

5. EMERGENCY PROTOCOL:
   - If severe emergency symptoms appear (radiating chest pain, severe dyspnea, sudden stroke signs), immediately advise caller to dial 112 and visit the emergency room.

6. SPOKEN CONVERSATIONAL TONE:
   - Keep replies spoken, reassuring, and under 25-30 words. Never use lists, markdown, asterisks, or emojis.`;
  }

  public getToolsDefinition() {
    return [
      {
        name: 'list_doctors',
        description: 'List active doctors, optionally by specialization',
        parameters: { specialization: 'string (optional)' },
      },
      {
        name: 'check_availability',
        description: 'Check if a doctor is free at a time; returns free flag and up to 3 nearest slots',
        parameters: {
          doctor_id: 'string',
          date: 'YYYY-MM-DD',
          time: 'HH:MM (24h, optional)',
        },
      },
      {
        name: 'book_appointment',
        description: 'Book after the caller confirmed. Triggers confirmation email.',
        parameters: {
          doctor_id: 'string',
          start_at: 'ISO datetime',
          patient_name: 'string',
          patient_phone: 'string',
          patient_email: 'string',
          reason: 'string',
        },
      },
    ];
  }

  public getState(callId: string): ReceptionistState {
    if (!this.states.has(callId)) {
      this.states.set(callId, {});
    }
    return this.states.get(callId)!;
  }

  public resetState(callId: string): void {
    this.states.delete(callId);
  }

  // Tool execution handlers
  public executeListDoctors(specialization?: string): DoctorRecord[] {
    const all = this.clinicDb.getAllDoctorRecords(true);
    if (!specialization) return all;
    const clean = specialization.toLowerCase().trim();
    return all.filter((d) => d.specialization.toLowerCase().includes(clean) || d.name.toLowerCase().includes(clean));
  }

  public executeCheckAvailability(
    doctorId: string,
    dateStr: string,
    time24?: string
  ): { isFree: boolean; nearestSlots: FreeSlot[]; doctor: DoctorRecord | null } {
    return this.clinicDb.checkDoctorAvailability(doctorId, dateStr, time24);
  }

  public executeBookAppointment(params: {
    doctorId: string;
    startAt: string;
    patientName: string;
    patientPhone: string;
    patientEmail: string;
    reason: string;
  }): AppointmentRecord {
    return this.clinicDb.bookAppointmentRecord(params);
  }

  // Main turn processing
  public processTurn(
    callId: string,
    callerUtterance: string,
    context?: { patientName?: string; patientEmail?: string; patientPhone?: string; clerkUserId?: string }
  ): ReceptionistTurnOutput {
    const state = this.getState(callId);
    if (context?.patientName && (!state.patientName || state.patientName === 'Patient')) {
      state.patientName = context.patientName;
    }
    if (context?.patientEmail && (!state.patientEmail || state.patientEmail === 'patient@miraai.health')) {
      state.patientEmail = context.patientEmail;
    }
    if (context?.patientPhone && (!state.patientPhone || state.patientPhone === '9876543210')) {
      state.patientPhone = context.patientPhone;
    }
    if (context?.clerkUserId && !state.clerkUserId) {
      state.clerkUserId = context.clerkUserId;
    }
    const text = callerUtterance.trim().toLowerCase();

    // 0. EMERGENCY CHECK
    if (
      text.includes('emergency') ||
      text.includes('heart attack') ||
      text.includes('behosh') ||
      text.includes('unconscious') ||
      text.includes('severe bleeding') ||
      text.includes('saas nahi aa rahi') ||
      text.includes('accident')
    ) {
      return {
        replyText: 'Yeh emergency lag rahi hai. Kripya turant 112 par call karein ya nazdeeki hospital jayein.',
        actionTaken: 'EMERGENCY_DIVERTED',
        state,
      };
    }

    // 0. NON-MEDICAL BOOKING CHECK
    if (
      text.includes('railway') ||
      text.includes('train ticket') ||
      text.includes('flight') ||
      text.includes('movie') ||
      text.includes('cricket score') ||
      text.includes('weather') ||
      text.includes('dawai likh do') ||
      text.includes('konsi dawa lu')
    ) {
      return {
        replyText: 'Main sirf doctor appointments book kar sakti hoon. Kripya appointment ke baare mein batayein.',
        actionTaken: 'NON_BOOKING_DIVERTED',
        state,
      };
    }

    // 0. CALLER INTERRUPTION / PAUSE CHECK
    // e.g. "ruko", "wait", "suno", "stop", "ek minute", "ek second", "pause", "hold on", "ठहरो", "सुनो", "रुको"
    const isDevanagariInterrupt =
      text.includes('रुको') ||
      text.includes('सुनो') ||
      text.includes('ठहरो') ||
      text.includes('रुकिए');

    const isAsciiInterrupt =
      /^(ruko|rukiye|wait|suno|stop|ek minute|ek second|pause|hold on)\b/i.test(text);

    const isInterruptKeyword =
      (isDevanagariInterrupt || isAsciiInterrupt) &&
      !text.includes('pain') &&
      !text.includes('dard') &&
      !text.includes('fever') &&
      !text.includes('kal') &&
      !text.includes('parso') &&
      !text.includes('@');

    if (isInterruptKeyword) {
      state.awaitingConfirmation = false;
      return {
        replyText: 'Haan ji, main sun rahi hoon. Boliye, aap kya badalna chahte hain?',
        actionTaken: 'CALLER_INTERRUPT_ACKNOWLEDGED',
        state,
      };
    }

    // 0. DETAIL CHANGE REQUEST DURING INTERRUPTION
    // e.g. "time change karna hai", "dusra time chahiye", "date change", "change time"
    if (
      (text.includes('change') && (text.includes('time') || text.includes('date') || text.includes('slot'))) ||
      text.includes('time badal') ||
      text.includes('date badal') ||
      text.includes('dusra time') ||
      text.includes('doosra time') ||
      text.includes('dusri date') ||
      text.includes('doosri date')
    ) {
      delete state.timeStr;
      delete state.displayTime;
      delete state.slotIso;
      state.awaitingConfirmation = false;
      return {
        replyText: 'Zaroor. Aap kis date ya time par slot chahte hain? Kal ya parso ka preferred time bataiye.',
        actionTaken: 'REQUEST_NEW_SLOT',
        state,
      };
    }

    // 0. ANOTHER DOCTOR / OPTION REQUEST
    // e.g. "मुझे कुछ दूसरा ऑप्शन सिलेक्शन है", "दूसरा ऑप्शन", "doosra option", "koi aur doctor", "other doctor"
    if (
      text.includes('दूसरा ऑप्शन') ||
      text.includes('दूसरा डॉक्टर') ||
      text.includes('doosra option') ||
      text.includes('dusra option') ||
      text.includes('another option') ||
      text.includes('other doctor') ||
      text.includes('koi aur doctor') ||
      text.includes('change doctor') ||
      (text.includes('दूसरा') && text.includes('ऑप्शन')) ||
      (text.includes('other') && text.includes('option'))
    ) {
      delete state.doctorId;
      delete state.doctorName;
      delete state.specialization;
      delete state.dateStr;
      delete state.timeStr;
      state.awaitingConfirmation = false;
      const activeDocs = this.clinicDb.getAllDoctorRecords(true);
      if (activeDocs.length === 0) {
        return {
          replyText: 'Maaf kijiye, humare clinic mein abhi koi doctors uplabdh nahi hain. Kripya baad mein sampark karein.',
          actionTaken: 'NO_DOCTORS_AVAILABLE',
          state,
        };
      }
      const docListText = activeDocs.map(d => `${d.specialization ? d.specialization + ' mein ' : ''}${d.name}`).join(', ');
      return {
        replyText: `Zaroor! Humare paas ${docListText} uplabdh hain. Aap inme se kisse milna chahenge?`,
        actionTaken: 'OFFER_ALTERNATIVE_DOCTORS',
        state,
      };
    }

    // ENTITY EXTRACTION PASS ACROSS UTTERANCE (Natural Language & Hindi Devanagari)

    const lowerUtterance = callerUtterance.toLowerCase();

    // A. Patient Name Extraction
    const nameMatch =
      callerUtterance.match(/(?:mera naam|my name is|naam hai|i am|this is|my name|naam)\s+([a-zA-Z\s]{2,30})/i) ||
      callerUtterance.match(/(?:मेरा नाम|नाम है|मैं हूँ|मैं|माय|माई|मेरा)\s+([\u0900-\u097F\s]{2,30})/i);

    if (nameMatch) {
      const extracted = nameMatch[1].replace(/(hai|ji|sir|here|bol raha hoon|है|जी|हूँ)/gi, '').trim();
      if (extracted.length >= 2 && !/^(asha|mira|doctor|dr)$/i.test(extracted)) state.patientName = extracted;
    } else if (
      !state.patientName &&
      !lowerUtterance.includes('dr') &&
      !lowerUtterance.includes('doctor') &&
      !lowerUtterance.includes('डॉक्टर') &&
      !lowerUtterance.includes('slot') &&
      !lowerUtterance.includes('स्लॉट') &&
      !lowerUtterance.includes('pain') &&
      !lowerUtterance.includes('dard') &&
      !lowerUtterance.includes('दर्द') &&
      !lowerUtterance.includes('hello') &&
      !lowerUtterance.includes('namaste') &&
      !lowerUtterance.includes('asha') &&
      !lowerUtterance.includes('mira') &&
      callerUtterance.split(' ').length <= 3 &&
      !/\d/.test(callerUtterance)
    ) {
      const cleanedName = callerUtterance.replace(/^(my|mera|name|naam|is|माय|माई|मेरा)\s+/i, '').trim();
      if (cleanedName.length >= 2 && !/^(asha|mira|doctor|dr)$/i.test(cleanedName)) state.patientName = cleanedName;
    }

    // B. Phone Number Extraction (10 digits starting with 6-9, or explicitly labeled as phone/mobile)
    const phoneMatch =
      callerUtterance.match(/\b([6-9]\d{9})\b/) ||
      callerUtterance.match(/(?:phone|mobile|number|no|फोन|मोबाइल|नंबर)\s*[:\s]*(\d{10})/i);
    if (phoneMatch) {
      state.patientPhone = phoneMatch[1];
    }

    // C. Doctor Match Extraction
    const docMatch = this.clinicDb.findDoctorRecord(callerUtterance);
    if (docMatch) {
      state.doctorId = docMatch.id;
      state.doctorName = docMatch.name;
      state.specialization = docMatch.specialization;
    }

    // D. Reason / Symptoms Extraction
    if (!state.reason) {
      const symptomWords = ['pain', 'dard', 'fever', 'bukhar', 'rash', 'spot', 'chest', 'cough', 'swelling', 'fracture', 'दर्द', 'छाती', 'बुखार', 'चकत्ते', 'दाने'];
      const hasSymptom = symptomWords.some((w) => text.includes(w));
      if (hasSymptom) {
        state.reason = callerUtterance;
      }
    }

    // E. Date and Time Extraction
    const normalized = HinglishDateNormalizer.parse(callerUtterance);
    if (normalized.date) {
      state.dateStr = normalized.date;
    }
    if (normalized.time) {
      state.timeStr = normalized.time;
      state.displayTime = normalized.displayTime;
    }

    // F. Email Extraction
    const emailMatch = callerUtterance.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      state.patientEmail = emailMatch[1].toLowerCase();
    } else if (text.includes('at') && text.includes('dot') && text.includes('com')) {
      const reconstructed = text.replace(/\s+at\s+/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+/g, '');
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reconstructed)) {
        state.patientEmail = reconstructed;
      }
    }

    // DIRECT / EXPLICIT APPOINTMENT BOOKING OR CONFIRMATION
    // e.g. "Haan kal 11 baje ka slot confirm kardo please", "Dr. Sharma ke sath kal 04:30 PM ka slot book kardo please", "Haan book kar dijiye"
    const isExplicitBooking =
      text.includes('book') ||
      text.includes('confirm') ||
      text.includes('kardo') ||
      text.includes('karna hai') ||
      text.includes('theek hai slot') ||
      text.includes('yes please') ||
      text.includes('haan book') ||
      text.includes('बुक') ||
      text.includes('अपॉइंटमेंट') ||
      text.includes('अपॉइन्टमेंट') ||
      text.includes('कर दो') ||
      text.includes('कर दीजिए') ||
      text.includes('स्लॉट') ||
      text.includes('कन्फर्म') ||
      (text.includes('हाँ') && (text.includes('स्लॉट') || text.includes('कर दो') || text.includes('बुक') || text.includes('कन्फर्म') || text.includes('दीजिए'))) ||
      (text.includes('haan') && (text.includes('slot') || text.includes('baje') || text.includes('confirm') || text.includes('book') || text.includes('dijiye')));

    const isNo =
      text.includes('nahi') ||
      text.includes('no') ||
      text.includes('change') ||
      text.includes('badalna') ||
      text.includes('galat');

    if (state.awaitingConfirmation && isNo) {
      state.awaitingConfirmation = false;
      return {
        replyText: 'Aap konsi detail badalna chahte hain? Doctor, date ya time batayein.',
        actionTaken: 'CONFIRMATION_REJECTED',
        state,
      };
    }

    if ((isExplicitBooking || state.awaitingConfirmation) && !state.bookingCompleted) {
      // 1. Resolve Doctor
      if (!state.doctorId) {
        if (state.reason) {
          const docForReason = this.clinicDb.findDoctorRecord(state.reason);
          if (docForReason) {
            state.doctorId = docForReason.id;
            state.doctorName = docForReason.name;
            state.specialization = docForReason.specialization;
          }
        }
        if (!state.doctorId) {
          const docMatch = this.clinicDb.findDoctorRecord(callerUtterance);
          if (docMatch) {
            state.doctorId = docMatch.id;
            state.doctorName = docMatch.name;
            state.specialization = docMatch.specialization;
          } else {
            const allDocs = this.clinicDb.getAllDoctorRecords(true);
            if (allDocs.length > 0) {
              state.doctorId = allDocs[0].id;
              state.doctorName = allDocs[0].name;
              state.specialization = allDocs[0].specialization;
            }
          }
        }
      }

      // 2. Resolve Date & Time
      if (!state.dateStr) {
        const tomorrow = new Date(Date.now() + 86400000);
        state.dateStr = HinglishDateNormalizer.formatDateISO(tomorrow);
      }
      if (!state.timeStr) {
        state.timeStr = '11:00';
        state.displayTime = '11:00 AM';
      }

      // 3. Resolve Patient Credentials
      if (!state.patientName) {
        state.patientName = context?.patientName || 'Patient';
      }
      if (!state.patientPhone) {
        state.patientPhone = context?.patientPhone || '9876543210';
      }
      if (!state.patientEmail) {
        state.patientEmail = context?.patientEmail || 'patient@miraai.health';
      }

      // 4. Verify Slot Availability
      if (!state.slotIso && state.doctorId && state.dateStr) {
        const avail = this.executeCheckAvailability(state.doctorId, state.dateStr, state.timeStr);
        if (avail.isFree && avail.nearestSlots.length > 0) {
          state.slotIso = avail.nearestSlots[0].isoString;
          state.timeStr = avail.nearestSlots[0].time;
          state.displayTime = avail.nearestSlots[0].displayTime;
        } else if (avail.nearestSlots.length > 0) {
          state.slotIso = avail.nearestSlots[0].isoString;
          state.timeStr = avail.nearestSlots[0].time;
          state.displayTime = avail.nearestSlots[0].displayTime;
        } else {
          state.slotIso = `${state.dateStr}T${state.timeStr}:00+05:30`;
        }
      }

      if (state.doctorId) {
        try {
          const bookingParams = {
            doctorId: state.doctorId,
            startAt: state.slotIso || `${state.dateStr}T${state.timeStr}:00+05:30`,
            patientName: state.patientName || 'Patient',
            patientPhone: state.patientPhone || '9876543210',
            patientEmail: state.patientEmail || 'patient@miraai.health',
            reason: state.reason || 'Doctor consultation',
            clerkUserId: state.clerkUserId || context?.clerkUserId,
          };
          const appointment = this.executeBookAppointment(bookingParams);

          state.bookingCompleted = true;
          state.awaitingConfirmation = false;
          state.bookingCode = appointment.bookingCode;

          return {
            replyText: `Aapka appointment ${appointment.bookingCode} confirm ho gaya hai aur confirmation email bhej diya gaya hai.`,
            actionTaken: 'TOOL_BOOK_APPOINTMENT_EXECUTED',
            toolExecuted: 'book_appointment',
            toolParameters: bookingParams,
            toolResult: {
              success: true,
              bookingCode: appointment.bookingCode,
              status: appointment.status,
              doctorName: appointment.doctorName,
              startAt: appointment.startAt,
            },
            appointment,
            state,
          };
        } catch (err: any) {
          return {
            replyText: `Booking error: ${err.message}`,
            actionTaken: 'BOOKING_FAILED',
            state,
          };
        }
      }
    }

    // CONVERSATION STATE MACHINE - STEP SEQUENCING

    // 1. GREETING & PATIENT NAME CHECK
    const isGreeting =
      /^(hello|hi|hey|namaste|namaskar|good morning|good afternoon)\b/i.test(text) &&
      !text.includes('pain') &&
      !text.includes('dard') &&
      !text.includes('chest') &&
      !text.includes('doctor') &&
      !text.includes('डॉक्टर') &&
      !text.includes('dr');

    if (isGreeting && !state.patientName && !state.reason && !state.doctorId) {
      return {
        replyText: 'Namaste! Main MiraAI hoon, aapki clinical assistant. Kripya apna poora naam batayein, ya batayein Aapko kis problem ke liye doctor se milna hai?',
        actionTaken: 'GREETING_ASK_REASON',
        state,
      };
    }

    // 2. REASON / DOCTOR MATCHING
    if (!state.doctorId) {
      if (state.reason) {
        const docForReason = this.clinicDb.findDoctorRecord(state.reason);
        if (docForReason) {
          state.doctorId = docForReason.id;
          state.doctorName = docForReason.name;
          state.specialization = docForReason.specialization;
        }
      }

      if (!state.doctorId) {
        const docs = this.executeListDoctors();
        if (docs.length === 1) {
          state.doctorId = docs[0].id;
          state.doctorName = docs[0].name;
          state.specialization = docs[0].specialization;
          return {
            replyText: `Aap ${docs[0].name} ke liye kab aana chahte hain? Kal ya parso ka preferred time bataiye.`,
            actionTaken: 'ASK_DATE_TIME',
            state,
          };
        }
        const docNames = docs.map((d) => d.name).join(', ');
        return {
          replyText: `Humare paas ${docNames} uplabdh hain. Aap kis doctor se milna chahte hain?`,
          actionTaken: 'LIST_DOCTORS_CALLED',
          toolExecuted: 'list_doctors',
          toolParameters: { specialization: 'General Consultation' },
          toolResult: { totalDoctors: docs.length, doctors: docs.map((d) => ({ id: d.id, name: d.name, specialization: d.specialization })) },
          state,
        };
      }
    }

    // 3. DATE AND TIME VERIFICATION
    if (!state.dateStr || !state.timeStr) {
      return {
        replyText: `Aap ${state.doctorName} ke liye kab aana chahte hain? Kal ya parso ka preferred time bataiye.`,
        actionTaken: 'ASK_DATE_TIME',
        state,
      };
    }

    // Verify Slot Availability if not yet verified
    if (!state.slotIso) {
      const avail = this.executeCheckAvailability(state.doctorId, state.dateStr, state.timeStr);
      if (avail.isFree && avail.nearestSlots.length > 0) {
        const chosenSlot = avail.nearestSlots[0];
        state.timeStr = chosenSlot.time;
        state.displayTime = chosenSlot.displayTime;
        state.slotIso = chosenSlot.isoString;
      } else {
        if (avail.nearestSlots.length >= 2) {
          const alt1 = avail.nearestSlots[0].displayTime;
          const alt2 = avail.nearestSlots[1].displayTime;
          return {
            replyText: `Yeh slot uplabdh nahi hai. Kya aapko ${alt1} ya ${alt2} ka slot theek rahega?`,
            actionTaken: 'OFFER_ALTERNATIVE_SLOTS',
            toolExecuted: 'check_availability',
            toolParameters: { doctor_id: state.doctorId, date: state.dateStr, time: state.timeStr },
            toolResult: { isFree: false, nearestSlots: avail.nearestSlots.slice(0, 2) },
            state,
          };
        } else if (avail.nearestSlots.length === 1) {
          const alt1 = avail.nearestSlots[0].displayTime;
          return {
            replyText: `Yeh slot uplabdh nahi hai. ${alt1} ka slot free hai, kya yeh theek rahega?`,
            actionTaken: 'OFFER_ALTERNATIVE_SLOTS',
            toolExecuted: 'check_availability',
            toolParameters: { doctor_id: state.doctorId, date: state.dateStr, time: state.timeStr },
            toolResult: { isFree: false, nearestSlots: avail.nearestSlots },
            state,
          };
        } else {
          return {
            replyText: `${state.doctorName} iss din uplabdh nahi hain. Kripya koi doosra din batayein.`,
            actionTaken: 'NO_SLOTS_AVAILABLE',
            toolExecuted: 'check_availability',
            toolParameters: { doctor_id: state.doctorId, date: state.dateStr, time: state.timeStr },
            toolResult: { isFree: false, nearestSlots: [] },
            state,
          };
        }
      }
    }

    // 4. PATIENT NAME CHECK
    if (!state.patientName) {
      return {
        replyText: 'Kripya patient ka poora naam batayein?',
        actionTaken: 'ASK_PATIENT_NAME',
        state,
      };
    }

    // 5. PHONE NUMBER CHECK
    if (!state.patientPhone) {
      return {
        replyText: 'Kripya apna 10 digit ka phone number batayein?',
        actionTaken: 'ASK_PHONE_NUMBER',
        state,
      };
    }

    // 6. EMAIL ADDRESS CHECK
    if (!state.patientEmail) {
      return {
        replyText: 'Confirmation email ke liye apna email address spell karke bata dijiye?',
        actionTaken: 'ASK_EMAIL_ADDRESS',
        state,
      };
    }

    // 7. READ-BACK & ASK FOR CONFIRMATION
    if (!state.awaitingConfirmation && !state.bookingCompleted) {
      state.awaitingConfirmation = true;
      return {
        replyText: `${state.doctorName} ke sath ${state.dateStr} ko ${state.displayTime || state.timeStr}, ${state.patientName} ke liye. Sab sahi hai? Book kar doon?`,
        actionTaken: 'READ_BACK_FOR_CONFIRMATION',
        state,
      };
    }

    // 8. CLEAR YES CONFIRMATION & CALL book_appointment
    if (state.awaitingConfirmation && !state.bookingCompleted) {
      const isYes =
        text.includes('haan') ||
        text.includes('yes') ||
        text.includes('theek hai') ||
        text.includes('kar do') ||
        text.includes('kar doon') ||
        text.includes('book kar do') ||
        text.includes('confirm') ||
        text.includes('sahi hai') ||
        text.includes('हां') ||
        text.includes('बुक');

      const isNo =
        text.includes('nahi') ||
        text.includes('no') ||
        text.includes('change') ||
        text.includes('badalna') ||
        text.includes('galat');

      if (isNo) {
        state.awaitingConfirmation = false;
        return {
          replyText: 'Aap konsi detail badalna chahte hain? Doctor, date ya time batayein.',
          actionTaken: 'CONFIRMATION_REJECTED',
          state,
        };
      }

      if (isYes) {
        try {
          const bookingParams = {
            doctorId: state.doctorId!,
            startAt: state.slotIso || `${state.dateStr}T${state.timeStr}:00+05:30`,
            patientName: state.patientName!,
            patientPhone: state.patientPhone!,
            patientEmail: state.patientEmail!,
            reason: state.reason || 'Doctor consultation',
            clerkUserId: state.clerkUserId || context?.clerkUserId,
          };
          const appointment = this.executeBookAppointment(bookingParams);

          state.bookingCompleted = true;
          state.awaitingConfirmation = false;
          state.bookingCode = appointment.bookingCode;

          // "After booking, say the confirmation in one sentence and mention an email has been sent."
          return {
            replyText: `Aapka appointment ${appointment.bookingCode} confirm ho gaya hai aur confirmation email bhej diya gaya hai.`,
            actionTaken: 'TOOL_BOOK_APPOINTMENT_EXECUTED',
            toolExecuted: 'book_appointment',
            toolParameters: bookingParams,
            toolResult: {
              success: true,
              bookingCode: appointment.bookingCode,
              status: appointment.status,
              doctorName: appointment.doctorName,
              startAt: appointment.startAt,
              patientEmail: appointment.patientEmail,
            },
            appointment,
            state,
          };
        } catch (err: any) {
          return {
            replyText: `Slot book karne mein samasya aayi: ${err.message}. Kripya doosra slot chunein.`,
            actionTaken: 'BOOKING_FAILED',
            toolExecuted: 'book_appointment',
            toolResult: { success: false, error: err.message },
            state,
          };
        }
      }

      // If neither clear yes nor no, re-ask gently
      return {
        replyText: 'Kya main aapka appointment confirm kar doon? Haan ya na batayein.',
        actionTaken: 'AWAITING_CLEAR_CONFIRMATION',
        state,
      };
    }

    // If booking already done
    return {
      replyText: `Aapka appointment ${state.bookingCode} already confirm ho chuka hai. Kya aapko aur koi sahayata chahiye?`,
      actionTaken: 'ALREADY_BOOKED',
      state,
    };
  }
}
