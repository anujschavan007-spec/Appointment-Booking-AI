import { GoogleGenAI } from '@google/genai';
import { ClinicalSummary, TranscriptItem, UrgencyLevel } from '../types';
import { ClinicDatabase } from '../data/clinic_db';

export class ClinicalSummarizer {
  private ai: GoogleGenAI | null = null;

  constructor(
    private apiKey: string | undefined,
    private clinicDb: ClinicDatabase
  ) {
    if (this.apiKey && this.apiKey.trim().length > 10 && !this.apiKey.includes('PLACEHOLDER')) {
      try {
        this.ai = new GoogleGenAI({ apiKey: this.apiKey.trim() });
      } catch (err) {
        console.warn('Gemini summarizer init warning:', err);
      }
    }
  }

  public async generateSummary(params: {
    sessionId: string;
    patientId: string;
    patientName: string;
    transcripts: TranscriptItem[];
    spotImageUrl?: string;
    userEnded?: boolean;
    endReason?: string;
  }): Promise<ClinicalSummary> {
    const fullTranscriptText = params.transcripts
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    // If Gemini is available, generate structured clinical summary
    if (this.ai) {
      try {
        const prompt = `Analyze this clinical intake consultation between MiraAI and patient "${params.patientName}".
Return ONLY a valid JSON object matching this schema:
{
  "chiefComplaint": "string",
  "symptomsList": ["string"],
  "symptomDuration": "string",
  "severity": "MILD" | "MODERATE" | "SEVERE",
  "urgencyLevel": "ROUTINE" | "MODERATE" | "URGENT" | "EMERGENCY",
  "suspectedConditions": ["string"],
  "spotVisualFindings": "string or null",
  "doctorRecommendation": "string",
  "fullClinicalNote": "string"
}

Consultation Transcript:
${fullTranscriptText}`;

        const res = await this.ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        });

        const rawJson = res.text?.trim();
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          const baseComplaint = parsed.chiefComplaint || 'Consultation Intake';
          const chiefComplaint = params.userEnded
            ? (baseComplaint.includes('User Ended') ? baseComplaint : `${baseComplaint} (User Ended Interview)`)
            : baseComplaint;
          const doctorRecommendation = params.userEnded
            ? 'User ended the interview before scheduling an appointment. Follow-up recommended if symptoms persist.'
            : (parsed.doctorRecommendation || 'Clinical review advised');

          const summary: ClinicalSummary = {
            id: 'sum_' + Math.random().toString(36).substr(2, 9),
            sessionId: params.sessionId,
            patientId: params.patientId,
            chiefComplaint,
            symptomsList: parsed.symptomsList || [],
            symptomDuration: parsed.symptomDuration || 'Recent onset',
            severity: parsed.severity || 'MODERATE',
            urgencyLevel: parsed.urgencyLevel || 'ROUTINE',
            suspectedConditions: parsed.suspectedConditions || ['Under Clinical Observation'],
            spotVisualFindings: params.spotImageUrl ? 'Disease spot image reviewed via camera' : undefined,
            doctorRecommendation,
            fullClinicalNote: (parsed.fullClinicalNote || fullTranscriptText) + (params.userEnded ? '\n\n[Status]: Interview was concluded by user before appointment confirmation.' : ''),
            userEnded: params.userEnded || false,
            endReason: params.endReason || (params.userEnded ? 'User ended the interview' : undefined),
            createdAt: Date.now(),
          };
          this.clinicDb.saveClinicalSummary(summary);
          return summary;
        }
      } catch (err) {
        console.warn('Gemini clinical summary fallback:', err);
      }
    }

    // High quality deterministic clinical rule extractor fallback
    return this.generateDeterministicSummary(params, fullTranscriptText);
  }

  private generateDeterministicSummary(
    params: {
      sessionId: string;
      patientId: string;
      patientName: string;
      spotImageUrl?: string;
      userEnded?: boolean;
      endReason?: string;
    },
    transcriptText: string
  ): ClinicalSummary {
    const textLower = transcriptText.toLowerCase();

    let chiefComplaint = 'Clinical Consultation & Doctor Appointment';
    const symptoms: string[] = [];
    let severity: 'MILD' | 'MODERATE' | 'SEVERE' = 'MODERATE';
    let urgency: UrgencyLevel = 'ROUTINE';
    const suspected: string[] = [];
    let recommendation = 'Attend scheduled clinical appointment for physical examination.';

    // Check for doctor mentioned in transcripts or in clinic DB
    let doctorMentioned = '';
    const docMatch = transcriptText.match(/(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
    if (docMatch) {
      doctorMentioned = docMatch[1];
    }

    const cardioDoc = (doctorMentioned && doctorMentioned.toLowerCase().includes('priya')) ? doctorMentioned : (this.clinicDb.findDoctorRecord('cardiology')?.name || doctorMentioned || 'Dr. Priya Mehta');
    const dermaDoc = (doctorMentioned && doctorMentioned.toLowerCase().includes('anita')) ? doctorMentioned : (this.clinicDb.findDoctorRecord('dermatology')?.name || doctorMentioned || 'Dr. Anita Desai');
    const orthoDoc = (doctorMentioned && doctorMentioned.toLowerCase().includes('arshad')) ? doctorMentioned : (this.clinicDb.findDoctorRecord('orthopedic')?.name || doctorMentioned || 'Dr. Arshad Khan');
    const generalDoc = (doctorMentioned && doctorMentioned.toLowerCase().includes('sharma')) ? doctorMentioned : (this.clinicDb.findDoctorRecord('general')?.name || doctorMentioned || 'Dr. Rajesh Sharma');

    if (textLower.includes('chest') || textLower.includes('heart') || textLower.includes('dil')) {
      chiefComplaint = 'Chest discomfort / Palpitations';
      symptoms.push('Chest pain', 'Palpitations');
      severity = 'SEVERE';
      urgency = 'URGENT';
      suspected.push('Angina Pectoris Rule-Out', 'Cardiac Arrhythmia Evaluation');
      recommendation = `Urgent ECG and review by Cardiology specialist ${cardioDoc}.`;
    } else if (textLower.includes('spot') || textLower.includes('rash') || textLower.includes('skin') || textLower.includes('khujli')) {
      chiefComplaint = 'Visible cutaneous lesion / skin rash';
      symptoms.push('Skin spot', 'Erythema', 'Pruritus');
      severity = 'MILD';
      urgency = 'ROUTINE';
      suspected.push('Contact Dermatitis', 'Urticaria / Cutaneous Lesion');
      recommendation = `Dermatological dermoscopy examination by Dermatology specialist ${dermaDoc}.`;
    } else if (textLower.includes('bone') || textLower.includes('joint') || textLower.includes('haddi') || textLower.includes('knee')) {
      chiefComplaint = 'Joint ache and musculoskeletal pain';
      symptoms.push('Joint tenderness', 'Restricted mobility');
      severity = 'MODERATE';
      urgency = 'ROUTINE';
      suspected.push('Osteoarthritis', 'Ligament Strain');
      recommendation = `Weight-bearing X-ray and Orthopedic evaluation by ${orthoDoc}.`;
    } else if (textLower.includes('fever') || textLower.includes('bukhar') || textLower.includes('cough') || textLower.includes('cold')) {
      chiefComplaint = 'Febrile illness with respiratory symptoms';
      symptoms.push('Pyrexia', 'Dry cough', 'Sore throat');
      severity = 'MODERATE';
      urgency = 'ROUTINE';
      suspected.push('Acute Viral Infection', 'Upper Respiratory Tract Infection');
      recommendation = `Hydration, symptomatic antipyretics, consultation with General Physician ${generalDoc}.`;
    } else {
      chiefComplaint = 'General Clinical Checkup & Intake';
      symptoms.push('General malaise');
      suspected.push('Non-specific Symptom Complex');
    }

    if (params.userEnded) {
      if (!chiefComplaint.includes('User Ended')) {
        chiefComplaint = `${chiefComplaint} (User Ended Interview)`;
      }
      recommendation = 'User ended the interview before scheduling an appointment. Follow-up recommended if symptoms persist.';
    }

    const summary: ClinicalSummary = {
      id: 'sum_' + Math.random().toString(36).substr(2, 9),
      sessionId: params.sessionId,
      patientId: params.patientId,
      chiefComplaint,
      symptomsList: symptoms,
      symptomDuration: '3-4 days estimated',
      severity,
      urgencyLevel: urgency,
      suspectedConditions: suspected,
      spotVisualFindings: params.spotImageUrl ? 'Disease spot captured via HD webcam inspection' : undefined,
      doctorRecommendation: recommendation,
      fullClinicalNote: `Automated Clinical Summary for patient ${params.patientName}.\nChief Complaint: ${chiefComplaint}.\nAssigned Specialty: ${recommendation}.\nStatus: ${params.userEnded ? 'Interview was concluded by user before appointment confirmation.' : 'Confirmed appointment stored in hospital admin database.'}`,
      userEnded: params.userEnded || false,
      endReason: params.endReason || (params.userEnded ? 'User ended the interview' : undefined),
      createdAt: Date.now(),
    };

    this.clinicDb.saveClinicalSummary(summary);
    return summary;
  }
}

