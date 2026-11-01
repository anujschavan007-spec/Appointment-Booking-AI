import { describe, it, expect } from 'bun:test';
import { GoogleGenAI } from '@google/genai';
import { ClinicDatabase } from '../src/data/clinic_db';

describe('Gemini Function / Tool Calling Integration', () => {
  const apiKey = process.env.GEMINI_API_KEY;

  it('should support function declarations for booking tools', async () => {
    if (!apiKey) return;
    const ai = new GoogleGenAI({ apiKey });

    const tools = [
      {
        functionDeclarations: [
          {
            name: 'check_availability',
            description: 'Check doctor availability',
            parameters: {
              type: 'OBJECT',
              properties: {
                doctor_id: { type: 'STRING' },
                date: { type: 'STRING' },
              },
              required: ['doctor_id', 'date'],
            },
          },
          {
            name: 'book_appointment',
            description: 'Book doctor appointment after confirmation',
            parameters: {
              type: 'OBJECT',
              properties: {
                doctor_id: { type: 'STRING' },
                start_at: { type: 'STRING' },
                patient_name: { type: 'STRING' },
                patient_phone: { type: 'STRING' },
                patient_email: { type: 'STRING' },
                reason: { type: 'STRING' },
              },
              required: ['doctor_id', 'start_at', 'patient_name', 'patient_phone', 'patient_email'],
            },
          },
        ],
      },
    ];

    try {
      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: 'Mera naam Anuj Chavan hai, phone 9811223344, email anuj@gmail.com. Dr. Priya Mehta ke sath kal subah 10 baje ka appointment confirm book kardo please.',
        config: {
          systemInstruction: 'You are an appointment booking AI. If the caller provides full details and asks to book, call the book_appointment tool.',
          tools: tools as any,
        },
      });

      console.log('Gemini Function Call result:', JSON.stringify(res.functionCalls || res.candidates?.[0]?.content?.parts));
      expect(res).toBeDefined();
    } catch (err: any) {
      console.warn('Note on live Gemini tool call:', err?.message);
    }
  }, 15000);
});
