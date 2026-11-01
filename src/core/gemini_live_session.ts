import { ClinicDatabase } from '../data/clinic_db';

export class GeminiLiveDirectSession {
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private isSetupComplete: boolean = false;
  private apiKey: string;
  public readonly voiceName: string;
  public readonly modelName: string;

  public onAudioChunk?: (pcm24Base64: string) => void;
  public onTurnComplete?: () => void;
  public onError?: (err: any) => void;

  constructor(
    apiKey: string | undefined,
    voiceName?: string,
    modelName?: string
  ) {
    this.apiKey = (apiKey || process.env.GEMINI_API_KEY || '').trim();
    this.voiceName = voiceName || 'Kore';
    this.modelName = modelName || 'models/gemini-3.8-live';
  }

  public async connect(): Promise<boolean> {
    if (!this.apiKey || this.apiKey.length < 10) {
      console.warn('[GeminiLiveDirect] No valid GEMINI_API_KEY found');
      return false;
    }

    return new Promise((resolve) => {
      try {
        const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          // Send initial direct Speech-to-Speech setup with prebuilt Kore voice
          const setupMsg = {
            setup: {
              model: this.modelName,
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: this.voiceName,
                    },
                  },
                },
              },
              systemInstruction: {
                parts: [
                  {
                    text: `You are MiraAI, an autonomous clinical intake and triage physician powered by Gemini 3.8 Live direct Speech-to-Speech with the prebuilt voice ${this.voiceName}.
Converse empathetically in natural code-mixed Hinglish.

CRITICAL DIRECTIVES:
1. NO FIXED QUESTIONS: Never repeat identical or scripted template sentences. Formulate every response and question dynamically based on the caller's words.
2. ASK SELF-GENERATED EXTRA QUESTIONS: Proactively ask your own intelligent clinical follow-up questions tailored to their symptoms (onset, sensation, severity, triggers, associated issues, sleep/walking impact).
3. AUTONOMOUS INTAKE & MATCHING: Smoothly and conversationally gather necessary details (name, contact phone, symptom description, preferred time) in unique phrasing each time.
4. HOSPITAL TIMING PROTOCOL (ASIA/KOLKATA): Operating shifts Monday to Friday 10:00 AM - 06:00 PM IST; Saturday 10:00 AM - 02:00 PM IST. 15-minute consultation slots.
5. Keep spoken replies concise, natural, and under 25 words. Never use markdown, bullet points, or emojis.`,
                  },
                ],
              },
            },
          };
          this.ws?.send(JSON.stringify(setupMsg));
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.setupComplete) {
              this.isSetupComplete = true;
              resolve(true);
            }

            if (data.serverContent?.modelTurn?.parts) {
              for (const part of data.serverContent.modelTurn.parts) {
                if (part.inlineData?.data && this.onAudioChunk) {
                  this.onAudioChunk(part.inlineData.data);
                }
              }
            }

            if (data.serverContent?.turnComplete && this.onTurnComplete) {
              this.onTurnComplete();
            }
          } catch (e) {
            console.warn('[GeminiLiveDirect] Message error:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.warn('[GeminiLiveDirect] WebSocket error:', err);
          this.isConnected = false;
          resolve(false);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.isSetupComplete = false;
        };

        // Safety timeout
        setTimeout(() => {
          if (!this.isSetupComplete) {
            resolve(this.isConnected);
          }
        }, 4000);
      } catch (err) {
        console.warn('[GeminiLiveDirect] Connection exception:', err);
        resolve(false);
      }
    });
  }

  // Direct Audio Input: Streams raw 16kHz PCM chunks straight into Gemini 3.8 Live (Direct STT)
  public sendRealtimeAudio(pcm16Base64: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: pcm16Base64,
              },
            ],
          },
        })
      );
    } catch (e) {
      console.warn('[GeminiLiveDirect] sendRealtimeAudio error:', e);
    }
  }

  // Direct User Turn: Sends user text/utterance into Gemini 3.8 Live
  public sendTurn(userText: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: userText }],
              },
            ],
            turnComplete: true,
          },
        })
      );
    } catch (e) {
      console.warn('[GeminiLiveDirect] sendTurn error:', e);
    }
  }

  // Instant sub-10ms Barge-In interruption
  public interrupt(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(
        JSON.stringify({
          clientContent: {
            turns: [],
            turnComplete: true,
          },
        })
      );
    } catch (e) {
      console.warn('[GeminiLiveDirect] interrupt error:', e);
    }
  }

  public close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isSetupComplete = false;
  }
}
