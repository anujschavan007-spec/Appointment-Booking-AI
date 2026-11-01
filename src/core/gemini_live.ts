import { GoogleGenAI } from '@google/genai';
import { ClinicDatabase } from '../data/clinic_db';

export interface GeminiClinicalTurnOutput {
  text: string;
  toolCall?: {
    name: string;
    args: Record<string, any>;
  };
}

export class GeminiLiveService {
  private ai: GoogleGenAI | null = null;
  private isAvailable: boolean = false;
  public readonly modelName: string;
  public readonly voiceName: string;

  constructor(
    private apiKey: string | undefined,
    private clinicDb: ClinicDatabase,
    modelName?: string,
    voiceName?: string
  ) {
    this.modelName = modelName || process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
    this.voiceName = voiceName || process.env.GEMINI_VOICE_NAME || 'Kore';

    if (this.apiKey && this.apiKey.trim().length > 10 && !this.apiKey.includes('PLACEHOLDER')) {
      try {
        this.ai = new GoogleGenAI({ apiKey: this.apiKey.trim() });
        this.isAvailable = true;
      } catch (err) {
        console.warn('Gemini Live init warning:', err);
        this.isAvailable = false;
      }
    }
  }

  public get available(): boolean {
    return this.isAvailable;
  }

  public getToolsDefinition() {
    return [
      {
        functionDeclarations: [
          {
            name: 'list_doctors',
            description: 'List active clinic doctors and their medical specializations. Call ONLY when the caller explicitly asks to see/consult a doctor, asks which doctors are available, or when clinical intake questioning is complete. DO NOT call during initial symptom intake.',
            parameters: {
              type: 'OBJECT',
              properties: {
                specialization: { type: 'STRING', description: 'Medical specialty like Cardiology, Dermatology, Orthopedics, Pediatrics' },
              },
            },
          },
          {
            name: 'check_availability',
            description: 'Check if a doctor is free at a date and time. Returns free status and nearest alternative slots.',
            parameters: {
              type: 'OBJECT',
              properties: {
                doctor_id: { type: 'STRING', description: 'Doctor ID, e.g. doc_sharma, doc_mehta, doc_desai' },
                date: { type: 'STRING', description: 'Date in YYYY-MM-DD format' },
                time: { type: 'STRING', description: 'Time in HH:MM (24-hour format, optional)' },
              },
              required: ['doctor_id', 'date'],
            },
          },
          {
            name: 'book_appointment',
            description: 'Book the appointment in the clinic database strictly in the final step after the caller explicitly confirms the read-back. Triggers instant confirmation email.',
            parameters: {
              type: 'OBJECT',
              properties: {
                doctor_id: { type: 'STRING', description: 'ID of the selected doctor' },
                start_at: { type: 'STRING', description: 'Start datetime in ISO format, e.g. 2026-11-02T10:00:00+05:30' },
                patient_name: { type: 'STRING', description: 'Full name of the patient' },
                patient_phone: { type: 'STRING', description: '10-digit mobile number' },
                patient_email: { type: 'STRING', description: 'Email address of patient' },
                reason: { type: 'STRING', description: 'Clinical symptoms or reason for visit' },
              },
              required: ['doctor_id', 'start_at', 'patient_name', 'patient_phone', 'patient_email'],
            },
          },
        ],
      },
    ];
  }

  public getInfo() {
    return {
      model: this.modelName,
      fallbackModel: 'gemini-3.8-flash',
      ttsModel: 'gemini-3.8-flash-lite-tts',
      voice: this.voiceName,
      availableVoices: ['Kore', 'Zephyr', 'Aoede', 'Fenrir', 'Puck'],
      voiceCharacteristics: {
        Kore: 'Firm, empathetic, authoritative physician voice (Recommended for clinical triage)',
        Zephyr: 'Bright, warm, engaging voice',
        Aoede: 'Clear, studio-grade narration',
        Fenrir: 'Deep, resonant voice',
      },
      speechToSpeechDirect: true,
      audioInputRate: '16kHz PCM',
      audioOutputRate: '24kHz PCM / WAV',
      configured: this.isAvailable,
    };
  }

  // Direct Audio Generation (TTS) using Gemini Flash TTS models with Kore voice
  public async generateSpeechAudio(text: string): Promise<{ audioBase64: string; mimeType: string } | null> {
    if (!this.ai || !this.isAvailable) return null;

    const ttsModels = [
      'gemini-2.5-flash-preview-tts',
      'gemini-3.1-flash-tts-preview',
      'gemini-3.8-flash-lite-tts',
    ];

    for (const ttsModel of ttsModels) {
      try {
        const res = await this.ai.models.generateContent({
          model: ttsModel,
          contents: text,
          config: {
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.voiceName,
                },
              },
            },
          },
        });

        const part = res.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          return {
            audioBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'audio/wav',
          };
        }
      } catch (err: any) {
        console.warn(`[Gemini TTS: ${ttsModel}] Warning:`, err?.message?.substring(0, 80));
      }
    }
    return null;
  }

  // Streaming Turn Generation using Gemini with Real Tool Calling and Dynamic Self-Question Flow
  public async streamClinicalTurn(
    userPrompt: string,
    history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
    patientName: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal
  ): Promise<GeminiClinicalTurnOutput> {
    if (!this.ai || !this.isAvailable) {
      throw new Error('Gemini Live client not configured');
    }

    const systemPrompt = `You are MiraAI, an autonomous clinical intake and triage physician speaking with voice "${this.voiceName}".
Current Patient Name on record: "${patientName || 'Unknown'}".
Language: Fluent, empathetic code-mixed Hinglish (natural spoken blend of everyday Hindi & English).

CRITICAL DIRECTIVES FOR DYNAMIC FLOW (PROMPT-DRIVEN ONLY):
1. NO FIXED QUESTIONS - NEVER REPEAT CANNED OR SCRIPTED STRINGS:
   - Absolutely NEVER repeat identical, rigid, or pre-scripted phrases (such as "Kripya apna 10-digit mobile number bataiye" or "Aapko kahan pain ya dard ho raha hai").
   - Every single question and response must be uniquely and organically generated by you based on what the patient just said.
   - Constantly vary your tone, greetings, and inquiry phrasing from turn to turn so no two sessions or turns ever sound identical.

2. ASK SELF-GENERATED EXTRA CLINICAL QUESTIONS:
   - Act as a real, attentive clinical doctor conducting a medical evaluation.
   - Do NOT rush mechanically into booking.
   - Actively formulate and ask your own clinical probing and follow-up questions tailored directly to the patient's condition:
     * Onset & Evolution: Ask when and how the symptoms started (sudden vs gradual).
     * Character & Sensation: Ask how the pain or discomfort feels (sharp, dull, heavy, burning, throbbing, spreading).
     * Triggers & Aggravating Factors: Ask if specific movements, eating, exertion, or time of day make it better or worse.
     * Associated Red Flags / Symptoms: For chest pain ask about shortness of breath, dizziness, or sweating; for joint pain ask about swelling or stiffness; for rash ask about itching or fever; for fever ask about chills or throat pain.
     * History & Current Medications: Inquire if they have experienced this before or taken any medicines.
     * Daily Impact: Ask if it is disturbing their sleep, walking, or daily routine.
   - Keep each spoken reply concise, natural, and under 25-30 words. Ask ONE or at most TWO focused clinical questions per turn.

3. ADAPTIVE HOSPITAL INTAKE & SCHEDULING (AUTONOMOUS):
   - Naturally integrate required administrative elements into your conversational inquiry:
     * Patient Name: Warmly find out who you are speaking with if not already identified.
     * Mobile Number: When the moment is right, conversationally request their phone number in your own unique words so appointment confirmations reach them.
     * Doctor & Specialty Matching:
       - Use the 'list_doctors' tool to check clinic doctors and their specialties.
       - If no doctors are currently in the database, gently inform the patient that consultations are temporarily closed.
       - If the patient requests another option or doctor, call 'list_doctors' and suggest alternatives.
     * Availability Checks:
       - Call 'check_availability' to check open slots. Never invent times or dates.
       - If a requested time is unavailable, offer the alternative slots returned by the tool.
     * Confirmation & Tool Calling:
       - Summarize the proposed appointment (doctor, department, date, time IST, patient name) in natural conversational terms.
       - When the patient clearly agrees or confirms, IMMEDIATELY call the 'book_appointment' tool.
       - Never invent booking codes; the tool handles registration and triggers email delivery.
       - Conclude by stating the confirmed booking code and letting them know details were sent to their email.

4. SAFETY & EMERGENCY RED FLAGS:
   - If severe red flags appear (acute crushing chest pain, severe dyspnea, sudden weakness/stroke signs), immediately tell them to dial 112 or visit the nearest emergency room without delay.

5. SPOKEN CONVERSATIONAL STYLE:
   - Speak warmly and reassuringly as a physician.
   - NEVER use markdown, bullet points, asterisks, or emojis. Every word is spoken aloud to the patient.`;

    const candidateModels = [
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      process.env.GEMINI_MODEL,
      'gemini-3.8-flash',
    ].filter(Boolean) as string[];

    let lastError: any = null;
    for (const modelCandidate of candidateModels) {
      try {
        const responseStream = await this.ai.models.generateContentStream({
          model: modelCandidate,
          contents: [
            ...history,
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.25,
            maxOutputTokens: 150,
            tools: this.getToolsDefinition() as any,
          },
        });

        let fullText = '';
        let toolCall: { name: string; args: Record<string, any> } | undefined;

        for await (const chunk of responseStream) {
          if (signal?.aborted) {
            break;
          }

          // Check if Gemini invoked a tool call
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            const fc = chunk.functionCalls[0];
            toolCall = {
              name: fc.name,
              args: (fc.args || {}) as Record<string, any>,
            };
          }

          const text = chunk.text;
          if (text) {
            fullText += text;
            onChunk(text);
          }
        }

        return { text: fullText, toolCall };
      } catch (err: any) {
        lastError = err;
        console.warn(`[Gemini] Model ${modelCandidate} failed: ${err?.message}, trying next candidate...`);
      }
    }

    if (signal?.aborted) {
      return { text: '' };
    }
    throw lastError || new Error('All Gemini model candidates exhausted');
  }
}
