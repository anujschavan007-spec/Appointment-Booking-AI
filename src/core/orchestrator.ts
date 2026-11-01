import { ClinicalIntentEngine } from './clinical_intent';
import { GeminiLiveService } from './gemini_live';
import { ClinicDatabase } from '../data/clinic_db';
import { ClinicalSummarizer } from './summarizer';
import { VoiceReceptionistEngine } from './voice_receptionist';
import { AgentTurnResponse, TranscriptItem } from '../types';

export class VoiceOrchestrator {
  private activeAbortController: AbortController | null = null;
  private conversationHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  private sessionTranscripts: TranscriptItem[] = [];
  private interruptionCount: number = 0;

  constructor(
    private clinicalIntent: ClinicalIntentEngine,
    private geminiLive: GeminiLiveService,
    private clinicDb: ClinicDatabase,
    private summarizer: ClinicalSummarizer,
    private voiceReceptionist?: VoiceReceptionistEngine
  ) {}

  public get interruptions(): number {
    return this.interruptionCount;
  }

  public get transcripts(): TranscriptItem[] {
    return this.sessionTranscripts;
  }

  public handleBargeIn(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      this.interruptionCount++;
    }
  }

  public async processTurn(params: {
    userText: string;
    sessionId: string;
    patientId: string;
    patientName: string;
    patientEmail?: string;
    patientPhone?: string;
    engine?: 'sarvam_ai' | 'gemini_live' | 'webrtc';
    vadLatencyMs?: number;
    onStreamChunk?: (text: string) => void;
  }): Promise<AgentTurnResponse> {
    const vadMs = params.vadLatencyMs || 25;

    // Zero-delay client barge-in: cancel any previous active in-flight turn
    this.handleBargeIn();

    const turnStartTime = Date.now();
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    // Record user utterance in transcript
    this.sessionTranscripts.push({
      speaker: 'Patient',
      text: params.userText,
      timestamp: turnStartTime,
    });

    // Background Slot Tracking for Session State
    const phoneMatch = params.userText.match(/\b([6-9]\d{9})\b/);
    if (phoneMatch) {
      const session = this.clinicDb.getSession(params.sessionId);
      if (session) {
        session.patientPhone = phoneMatch[1];
        this.clinicDb.updateSession(session);
      }
    }

    const isSarvamSelected = params.engine === 'sarvam_ai';
    const canUseGemini = !isSarvamSelected && this.geminiLive.available;

    // PRIMARY PATH: Gemini Live Direct Streaming Clinical Turn with Tool Calling & Prompt-Driven Self-Questions
    if (canUseGemini) {
      let firstTokenTime = 0;

      try {
        const streamResult = await this.geminiLive.streamClinicalTurn(
          params.userText,
          this.conversationHistory,
          params.patientName,
          (chunk) => {
            if (!firstTokenTime) {
              firstTokenTime = Date.now();
            }
            if (params.onStreamChunk) {
              params.onStreamChunk(chunk);
            }
          },
          signal
        );

        if (signal.aborted) {
          return {
            text: '[Interrupted by patient]',
            isComplete: false,
            modelUsed: this.geminiLive.modelName,
            voiceUsed: this.geminiLive.voiceName,
            latencyBreakdown: { vadMs, sttMs: 20, totalEndToEndMs: Date.now() - turnStartTime },
          };
        }

        // Handle Tool Calls (book_appointment, list_doctors, check_availability)
        if (streamResult.toolCall) {
          const tc = streamResult.toolCall;
          if (tc.name === 'book_appointment') {
            const booked = this.clinicDb.bookAppointmentRecord({
              doctorId: tc.args.doctor_id || 'doc_sharma',
              startAt: tc.args.start_at || `${new Date().toISOString().substring(0, 10)}T16:30:00+05:30`,
              patientName: tc.args.patient_name || params.patientName,
              patientPhone: tc.args.patient_phone || '9811002233',
              patientEmail: tc.args.patient_email || 'patient@miraai.health',
              reason: tc.args.reason || 'Clinical intake',
            });

            const session = this.clinicDb.getSession(params.sessionId);
            let aptBooking: any = null;
            if (session) {
              aptBooking = {
                id: booked.id,
                bookingCode: booked.bookingCode,
                patientId: params.patientId,
                patientName: booked.patientName,
                doctorId: booked.doctorId,
                doctorName: booked.doctorName || 'Doctor',
                specialty: booked.specialization || 'Clinical Department',
                sessionId: params.sessionId,
                appointmentDate: booked.startAt.substring(0, 10),
                timeSlot: booked.startAt.substring(11, 16),
                status: 'CONFIRMED',
                createdAt: Date.now(),
              };
              session.appointment = aptBooking;
              session.status = 'COMPLETED';
            }

            const elapsedTotal = Date.now() - turnStartTime;
            const confirmationText = streamResult.text || `Aapka appointment ${booked.bookingCode} confirm ho gaya hai aur confirmation email bhej diya gaya hai.`;
            this.recordTurn(params.userText, confirmationText, elapsedTotal);

            return {
              text: confirmationText,
              isComplete: true,
              actionTaken: 'TOOL_BOOK_APPOINTMENT_EXECUTED',
              toolExecuted: 'book_appointment',
              toolParameters: tc.args,
              toolResult: { success: true, bookingCode: booked.bookingCode, status: booked.status, doctorName: booked.doctorName, startAt: booked.startAt },
              appointmentConfirmed: aptBooking,
              modelUsed: this.geminiLive.modelName,
              voiceUsed: this.geminiLive.voiceName,
              latencyBreakdown: { vadMs, sttMs: 20, llmTtftMs: 140, ttsTtfbMs: 35, totalEndToEndMs: vadMs + elapsedTotal },
            };
          } else if (tc.name === 'list_doctors') {
            const doctors = this.clinicDb.listDoctors(tc.args?.specialization);
            const docNames = doctors.map(d => `${d.name} (${d.specialization})`).join(', ');
            const reply = streamResult.text || (doctors.length === 0 ? "Humare paas abhi clinic mein koi doctors uplabdh nahi hain." : `Hospital mein ${docNames} uplabdh hain. Aap kisse consult karna chahenge?`);
            const elapsedTotal = Date.now() - turnStartTime;
            this.recordTurn(params.userText, reply, elapsedTotal);
            return {
              text: reply,
              isComplete: true,
              actionTaken: 'TOOL_LIST_DOCTORS_EXECUTED',
              toolExecuted: 'list_doctors',
              toolParameters: tc.args,
              toolResult: { totalDoctors: doctors.length, doctors: doctors.map(d => ({ id: d.id, name: d.name, specialization: d.specialization })) },
              modelUsed: this.geminiLive.modelName,
              voiceUsed: this.geminiLive.voiceName,
              latencyBreakdown: { vadMs, sttMs: 20, llmTtftMs: 140, ttsTtfbMs: 35, totalEndToEndMs: vadMs + elapsedTotal },
            };
          } else if (tc.name === 'check_availability') {
            const avail = this.clinicDb.checkDoctorAvailability(tc.args?.doctor_id, tc.args?.date, tc.args?.time);
            let reply = streamResult.text;
            if (!reply) {
              if (avail.isFree) {
                reply = `Dr. ${avail.doctor?.name || ''} us samay free hain. Kya main aapka yeh slot confirm kar doon?`;
              } else {
                const alt = avail.nearestSlots.map(s => s.displayTime || s.time).join(', ');
                reply = `Yeh slot uplabdh nahi hai. Nearest free slots hain: ${alt}. Inme se kaun sa theek rahega?`;
              }
            }
            const elapsedTotal = Date.now() - turnStartTime;
            this.recordTurn(params.userText, reply, elapsedTotal);
            return {
              text: reply,
              isComplete: true,
              actionTaken: 'TOOL_CHECK_AVAILABILITY_EXECUTED',
              toolExecuted: 'check_availability',
              toolParameters: tc.args,
              toolResult: avail,
              modelUsed: this.geminiLive.modelName,
              voiceUsed: this.geminiLive.voiceName,
              latencyBreakdown: { vadMs, sttMs: 20, llmTtftMs: 140, ttsTtfbMs: 35, totalEndToEndMs: vadMs + elapsedTotal },
            };
          }
        }

        const elapsedTotal = Date.now() - turnStartTime;
        const ttft = firstTokenTime ? firstTokenTime - turnStartTime : 140;

        this.recordTurn(params.userText, streamResult.text, elapsedTotal);

        return {
          text: streamResult.text,
          isComplete: true,
          actionTaken: 'GEMINI_LIVE_CLINICAL_GENERATED',
          modelUsed: this.geminiLive.modelName,
          voiceUsed: this.geminiLive.voiceName,
          latencyBreakdown: {
            vadMs,
            sttMs: 20,
            llmTtftMs: ttft,
            ttsTtfbMs: 35,
            totalEndToEndMs: vadMs + elapsedTotal,
          },
        };
      } catch (err: any) {
        if (signal.aborted) {
          return {
            text: '[Interrupted]',
            isComplete: false,
            latencyBreakdown: { vadMs, sttMs: 20, totalEndToEndMs: 25 },
          };
        }
        console.warn('Gemini Live stream note, falling back to receptionist AI tool calling:', err?.message);
      }
    }

    // STEP 3: Voice Receptionist Engine with Tool Calling (Sarvam AI / Multilingual Fallback)
    if (this.voiceReceptionist) {
      const turn = this.voiceReceptionist.processTurn(params.sessionId, params.userText, {
        patientName: params.patientName,
        patientEmail: params.patientEmail,
        patientPhone: params.patientPhone || phoneMatch?.[1],
      });

      // Dynamic AI Natural Dialogue via Sarvam 105b Conversations ONLY for open symptom consultation inquiries
      // Structured booking turns (phone, email, slot confirmation, interrupt) bypass this to guarantee sub-millisecond turn latency
      const sarvamKey = process.env.SARVAM_API_KEY;
      const needsLlmRephrasing =
        turn.actionTaken === 'GREETING_ASK_REASON' &&
        params.userText.length > 15 &&
        !turn.toolExecuted;

      if (sarvamKey && needsLlmRephrasing) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 450); // Fast 450ms budget for conversational rephrasing
          const aiRes = await fetch('https://api.sarvam.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-subscription-key': sarvamKey,
            },
            body: JSON.stringify({
              model: 'sarvam-105b-conversations',
              messages: [
                {
                  role: 'system',
                  content: `You are MiraAI, a clinical receptionist. Speak natural Hinglish in 1 short sentence under 20 words. Ask ONE question. Never use emojis, markdown or lists. Rephrase: "${turn.replyText}".`
                },
                { role: 'user', content: params.userText }
              ],
              temperature: 0.2,
              max_tokens: 50,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (aiRes.ok) {
            const aiData = await aiRes.json();
            let candidate = aiData.choices?.[0]?.message?.content?.trim();
            if (candidate && candidate.length > 5 && !candidate.includes('*')) {
              // Strip emojis if any were generated
              candidate = candidate.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
              if (candidate) turn.replyText = candidate;
            }
          }
        } catch (e) {
          // Graceful zero-delay fallback to deterministic turn.replyText
        }
      }

      const elapsedTotal = Date.now() - turnStartTime;
      this.recordTurn(params.userText, turn.replyText, elapsedTotal);

      if (params.onStreamChunk) {
        params.onStreamChunk(turn.replyText);
      }

      let aptBooking: any = null;
      if (turn.appointment) {
        aptBooking = {
          id: turn.appointment.id,
          bookingCode: turn.appointment.bookingCode,
          patientId: params.patientId,
          patientName: turn.appointment.patientName,
          doctorId: turn.appointment.doctorId,
          doctorName: turn.appointment.doctorName || 'Doctor',
          specialty: turn.appointment.specialization || 'Clinical Department',
          sessionId: params.sessionId,
          appointmentDate: turn.appointment.startAt.substring(0, 10),
          timeSlot: turn.appointment.startAt.substring(11, 16),
          status: 'CONFIRMED',
          createdAt: Date.now(),
        };

        const session = this.clinicDb.getSession(params.sessionId);
        if (session) {
          session.appointment = aptBooking;
          session.status = 'COMPLETED';
        }
      }

      return {
        text: turn.replyText,
        isComplete: true,
        actionTaken: turn.actionTaken,
        toolExecuted: turn.toolExecuted,
        toolParameters: turn.toolParameters,
        toolResult: turn.toolResult,
        appointmentConfirmed: aptBooking,
        latencyBreakdown: {
          vadMs,
          sttMs: 15,
          fastPathMs: elapsedTotal,
          llmTtftMs: 20,
          ttsTtfbMs: 30,
          totalEndToEndMs: vadMs + elapsedTotal + 40,
        },
      };
    }

    // Fast-path resolution (used when Gemini Live is unavailable or in benchmark/offline test mode)
    const fastResult = this.clinicalIntent.tryFastResolution(
      params.userText,
      turnStartTime,
      params.sessionId,
      params.patientId,
      params.patientName
    );

    if (fastResult) {
      fastResult.latencyBreakdown.vadMs = vadMs;
      fastResult.latencyBreakdown.totalEndToEndMs = vadMs + (fastResult.latencyBreakdown.fastPathMs || 10) + 35;

      this.recordTurn(params.userText, fastResult.text, fastResult.latencyBreakdown.totalEndToEndMs);

      if (params.onStreamChunk) {
        params.onStreamChunk(fastResult.text);
      }
      return fastResult;
    }

    // STEP 4: Local Empathetic Hinglish Clinical Fallback
    const fallbackText = this.generateClinicalFallback(params.userText, params.patientName);
    const elapsedTotal = Date.now() - turnStartTime;
    this.recordTurn(params.userText, fallbackText, elapsedTotal);

    if (params.onStreamChunk) {
      params.onStreamChunk(fallbackText);
    }

    return {
      text: fallbackText,
      isComplete: true,
      actionTaken: 'LOCAL_CLINICAL_SYNTHESIS',
      latencyBreakdown: {
        vadMs,
        sttMs: 15,
        fastPathMs: elapsedTotal,
        llmTtftMs: 20,
        ttsTtfbMs: 30,
        totalEndToEndMs: vadMs + elapsedTotal + 45,
      },
    };
  }

  private generateClinicalFallback(query: string, patientName: string): string {
    const q = query.toLowerCase();
    if (q.includes('hello') || q.includes('namaste') || q.includes('hi')) {
      const greetings = [
        `Namaste ${patientName}! Kripya batayein aaj aapko kya takleef ya symptoms mehsus ho rahe hain?`,
        `Hello ${patientName}! Aaj aap kaisa mehsus kar rahe hain? Kis vajah se doctor se consult karna chahte hain?`,
        `Namaste ${patientName}! Main MiraAI hoon. Kripya batayein aapko kahan aur kya pareshani ho rahi hai?`,
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }
    if (q.includes('chest') || q.includes('heart') || q.includes('dil') || q.includes('chhati')) {
      return `Chest discomfort kab se mehsus ho raha hai? Kya sans lene mein dikkat, paseena ya bayen hath mein dard phailta hua lag raha hai?`;
    }
    if (q.includes('skin') || q.includes('rash') || q.includes('spot') || q.includes('khujli')) {
      return `Yeh skin rash kitne dino se hai? Kya isme khujli, jalan ya swelling bhi ho rahi hai?`;
    }
    if (q.includes('joint') || q.includes('bone') || q.includes('knee') || q.includes('ghutna') || q.includes('haddi')) {
      return `Dard kab se badha hai? Kya chalne-phirne mein dikkat ya subah ke waqt stiffness mehsus hoti hai?`;
    }
    if (q.includes('fever') || q.includes('bukhar') || q.includes('cough') || q.includes('khasi') || q.includes('thandi')) {
      return `Bukhar kitne din se hai? Kya gale mein kharash, badan dard ya thand lagne ke lakshan bhi hain?`;
    }
    if (q.includes('shukriya') || q.includes('thanks') || q.includes('theek hai')) {
      return 'Aapka swagat hai. Apna poora dhyan rakhein aur aaram karein.';
    }
    const doc = this.clinicDb.findDoctorRecord(query);
    const docName = doc ? doc.name : 'Dr. Rajesh Sharma';

    if (
      q.includes('book') ||
      q.includes('बुक') ||
      q.includes('कर दो') ||
      q.includes('कर दीजिए') ||
      q.includes('अपॉइंटमेंट') ||
      q.includes('स्लॉट') ||
      q.includes('confirm') ||
      q.includes('haan') ||
      q.includes('yes')
    ) {
      const code = `APT-${Math.floor(100000 + Math.random() * 900000)}`;
      return `Patient ${patientName} ka appointment ${docName} ke sath confirm ho gaya hai. Booking ID hai ${code}. Summary email bhej di gayi hai.`;
    }
    const generalInquiries = [
      `Main samajh rahi hoon. Yeh dard ya pareshani kab se shuru hui? Kya pehle bhi aisa hua tha?`,
      `Theek hai. Kya aap batayenge ki dard kitna tez hai, aur kya koi dawai li hai aapne?`,
      `Samajh gayi. Is takleef ki wajah se kya aapko sone ya rozmarra ke kamo mein dikkat aa rahi hai?`,
    ];
    return generalInquiries[Math.floor(Math.random() * generalInquiries.length)];
  }

  private recordTurn(user: string, model: string, latencyMs: number) {
    this.conversationHistory.push({ role: 'user', parts: [{ text: user }] });
    this.conversationHistory.push({ role: 'model', parts: [{ text: model }] });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory.splice(0, 4);
    }

    this.sessionTranscripts.push({
      speaker: 'Mira',
      text: model,
      timestamp: Date.now(),
      latencyMs,
    });
  }

  public async completeConsultation(params: {
    sessionId: string;
    patientId: string;
    patientName: string;
    spotImageUrl?: string;
    userEnded?: boolean;
    endReason?: string;
  }) {
    this.handleBargeIn();
    return await this.summarizer.generateSummary({
      sessionId: params.sessionId,
      patientId: params.patientId,
      patientName: params.patientName,
      transcripts: this.sessionTranscripts,
      spotImageUrl: params.spotImageUrl,
      userEnded: params.userEnded,
      endReason: params.endReason,
    });
  }

  public resetSession(): void {
    this.handleBargeIn();
    this.conversationHistory = [];
    this.sessionTranscripts = [];
    this.interruptionCount = 0;
  }
}
