/**
 * MiraAI Live Sentence Accumulator & Debouncer
 * Mimics Gemini Live word-by-word streaming and sentence debouncing.
 * Prevents premature cutoff when users take a 1-second pause mid-sentence.
 */

export interface SentenceAccumulatorConfig {
  silenceDebounceMs: number; // Duration of silence to wait before finalizing (e.g. 1300ms)
  onSentenceUpdate: (fullText: string, isInterim: boolean) => void;
  onSentenceFinal: (finalText: string) => void;
}

export class SentenceAccumulator {
  private committedText: string = '';
  private interimText: string = '';
  private debounceTimer: any = null;
  private config: SentenceAccumulatorConfig;

  constructor(config?: Partial<SentenceAccumulatorConfig>) {
    this.config = {
      silenceDebounceMs: 1300, // Allows mid-sentence 1-second pause without splitting
      onSentenceUpdate: () => {},
      onSentenceFinal: () => {},
      ...config,
    };
  }

  /**
   * Process a speech recognition result chunk.
   * Both final clauses and interim words update the live sentence.
   */
  public pushChunk(text: string, isFinal: boolean): void {
    const cleaned = text.trim();
    if (!cleaned) return;

    if (isFinal) {
      // Append final clause to committed text
      if (this.committedText) {
        this.committedText += ' ' + cleaned;
      } else {
        this.committedText = cleaned;
      }
      this.interimText = '';
      this.notifyUpdate(this.committedText, false);

      // Start or reset silence debouncer
      this.restartSilenceTimer();
    } else {
      // Interim words being actively spoken
      this.interimText = cleaned;
      const combined = this.getFullText();
      this.notifyUpdate(combined, true);

      // Keep debounce timer alive while speaking
      this.clearSilenceTimer();
    }
  }

  /**
   * Get the current complete text (committed + any active interim words).
   */
  public getFullText(): string {
    if (this.committedText && this.interimText) {
      return `${this.committedText} ${this.interimText}`.trim();
    }
    return (this.committedText || this.interimText || '').trim();
  }

  /**
   * Immediately flush and finalize the accumulated sentence.
   */
  public flush(): string | null {
    this.clearSilenceTimer();
    const final = this.getFullText();
    this.committedText = '';
    this.interimText = '';

    if (final) {
      this.config.onSentenceFinal(final);
      return final;
    }
    return null;
  }

  /**
   * Reset the buffer without emitting final callback.
   */
  public reset(): void {
    this.clearSilenceTimer();
    this.committedText = '';
    this.interimText = '';
  }

  private restartSilenceTimer(): void {
    this.clearSilenceTimer();
    this.debounceTimer = setTimeout(() => {
      this.flush();
    }, this.config.silenceDebounceMs);
  }

  private clearSilenceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private notifyUpdate(text: string, isInterim: boolean): void {
    if (text) {
      this.config.onSentenceUpdate(text, isInterim);
    }
  }
}
