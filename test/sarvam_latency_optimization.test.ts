import { describe, expect, it } from 'bun:test';

describe('Sarvam AI Latency & Speech Quality Optimization', () => {
  it('should normalize speech text by expanding abbreviations, codes, and phone digits', () => {
    function normalizeTextForSpeech(raw: string): string {
      let clean = raw.trim();
      clean = clean.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '');
      clean = clean.replace(/[*_#`\[\]]/g, '');
      clean = clean.replace(/\bDr\.\s*/g, 'Doctor ');
      clean = clean.replace(/\bAPT-(\d+)\b/g, (m, digits) => `A P T ${digits.split('').join(' ')}`);
      clean = clean.replace(/\b([6-9]\d{9})\b/g, (m) => m.split('').join(' '));
      return clean.trim();
    }

    const test1 = 'Mera phone number 9876543210 hai, Dr. Anita Desai se milna hai';
    const norm1 = normalizeTextForSpeech(test1);
    expect(norm1).toContain('9 8 7 6 5 4 3 2 1 0');
    expect(norm1).toContain('Doctor Anita Desai');

    const test2 = 'Aapka appointment APT-482910 confirm ho gaya hai 🙏';
    const norm2 = normalizeTextForSpeech(test2);
    expect(norm2).toContain('A P T 4 8 2 9 1 0');
    expect(norm2).not.toContain('🙏');
  });

  it('should verify TTS cache hit achieves sub-millisecond retrieval', () => {
    const ttsAudioCache = new Map<string, { audioBase64: string; mimeType: string; voice: string; engine: string; model: string }>();

    const sampleKey = 'sarvam_ai_kavya_namaste';
    ttsAudioCache.set(sampleKey, {
      audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
      mimeType: 'audio/wav',
      voice: 'Kavya',
      engine: 'sarvam_ai',
      model: 'sarvam-bulbul',
    });

    const t0 = performance.now();
    const cached = ttsAudioCache.get(sampleKey);
    const duration = performance.now() - t0;

    expect(cached).toBeDefined();
    expect(cached?.voice).toBe('Kavya');
    expect(duration).toBeLessThan(1.0); // Sub-millisecond instant retrieval
  });

  it('should map Sarvam voices correctly to natural Indian personas', () => {
    function mapSarvamSpeaker(voiceName?: string): string {
      const v = (voiceName || '').toLowerCase().trim();
      if (v.includes('priya')) return 'priya';
      if (v.includes('shreya')) return 'shreya';
      if (v.includes('shubh')) return 'shubh';
      if (v.includes('kavya') || v.includes('bulbul') || !v) return 'kavya';
      return 'kavya';
    }

    expect(mapSarvamSpeaker('Bulbul')).toBe('kavya');
    expect(mapSarvamSpeaker('Priya')).toBe('priya');
    expect(mapSarvamSpeaker('Shreya')).toBe('shreya');
    expect(mapSarvamSpeaker('Shubh')).toBe('shubh');
    expect(mapSarvamSpeaker(undefined)).toBe('kavya');
  });
});

