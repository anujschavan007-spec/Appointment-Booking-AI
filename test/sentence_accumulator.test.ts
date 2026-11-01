import { describe, expect, it } from 'bun:test';
import { SentenceAccumulator } from '../src/core/sentence_accumulator';

describe('SentenceAccumulator (Gemini Live Word & Sentence Updates)', () => {
  it('should stream interim words live as they are spoken', () => {
    const updates: { text: string; isInterim: boolean }[] = [];
    const accumulator = new SentenceAccumulator({
      silenceDebounceMs: 1300,
      onSentenceUpdate: (text, isInterim) => {
        updates.push({ text, isInterim });
      },
    });

    accumulator.pushChunk('Mera', false);
    accumulator.pushChunk('Mera naam', false);
    accumulator.pushChunk('Mera naam Anuj', false);

    expect(updates.length).toBe(3);
    expect(updates[0]).toEqual({ text: 'Mera', isInterim: true });
    expect(updates[1]).toEqual({ text: 'Mera naam', isInterim: true });
    expect(updates[2]).toEqual({ text: 'Mera naam Anuj', isInterim: true });
  });

  it('should not cut off or finalize when taking a 1-second break mid-sentence', async () => {
    let finalizedSentence: string | null = null;
    const updates: string[] = [];

    const accumulator = new SentenceAccumulator({
      silenceDebounceMs: 1200,
      onSentenceUpdate: (text) => {
        updates.push(text);
      },
      onSentenceFinal: (finalText) => {
        finalizedSentence = finalText;
      },
    });

    // User speaks first half: "Mera naam Anuj"
    accumulator.pushChunk('Mera naam Anuj', true);
    expect(finalizedSentence).toBeNull();
    expect(accumulator.getFullText()).toBe('Mera naam Anuj');

    // User takes a 1-second pause (1000ms < 1200ms debounce threshold)
    await new Promise((r) => setTimeout(r, 950));
    expect(finalizedSentence).toBeNull();

    // User continues speaking: "Chavan hai"
    accumulator.pushChunk('Chavan hai', true);
    expect(finalizedSentence).toBeNull();
    expect(accumulator.getFullText()).toBe('Mera naam Anuj Chavan hai');

    // Wait for full silence window to elapse (1250ms)
    await new Promise((r) => setTimeout(r, 1250));
    expect(finalizedSentence).toBe('Mera naam Anuj Chavan hai');
  });

  it('should support Devanagari Hindi appointment sentence continuation over pause', async () => {
    let finalizedSentence: string | null = null;

    const accumulator = new SentenceAccumulator({
      silenceDebounceMs: 500,
      onSentenceFinal: (finalText) => {
        finalizedSentence = finalText;
      },
    });

    // Clause 1: "आप मेरा"
    accumulator.pushChunk('आप मेरा', true);
    await new Promise((r) => setTimeout(r, 300)); // 300ms pause < 500ms
    expect(finalizedSentence).toBeNull();

    // Clause 2: "अपॉइंटमेंट स्लॉट"
    accumulator.pushChunk('अपॉइंटमेंट स्लॉट', true);
    await new Promise((r) => setTimeout(r, 300)); // 300ms pause
    expect(finalizedSentence).toBeNull();

    // Clause 3: "बुक कर दो"
    accumulator.pushChunk('बुक कर दो', true);
    expect(accumulator.getFullText()).toBe('आप मेरा अपॉइंटमेंट स्लॉट बुक कर दो');

    // Silence expires
    await new Promise((r) => setTimeout(r, 550));
    expect(finalizedSentence).toBe('आप मेरा अपॉइंटमेंट स्लॉट बुक कर दो');
  });

  it('should immediately flush full sentence when flush() is invoked', () => {
    let finalizedSentence: string | null = null;
    const accumulator = new SentenceAccumulator({
      silenceDebounceMs: 2000,
      onSentenceFinal: (finalText) => {
        finalizedSentence = finalText;
      },
    });

    accumulator.pushChunk('Emergency chest pain consultation', true);
    expect(finalizedSentence).toBeNull();

    const result = accumulator.flush();
    expect(result).toBe('Emergency chest pain consultation');
    expect(finalizedSentence).toBe('Emergency chest pain consultation');
    expect(accumulator.getFullText()).toBe('');
  });
});
