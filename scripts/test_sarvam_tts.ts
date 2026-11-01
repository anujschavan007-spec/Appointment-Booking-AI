import { SarvamAIClient } from 'sarvamai';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    console.error('Error: SARVAM_API_KEY not found in environment.');
    process.exit(1);
  }

  const client = new SarvamAIClient({ apiKey });

  const sampleText = 'Namaste! Main MiraAI hoon, Sarvam AI powered clinical assistant. Kripya apna poora naam batayein?';
  const startTime = Date.now();

  console.log('Sending Text-to-Speech conversion request to Sarvam AI (Bulbul)...');
  console.log(`Input Text: "${sampleText}"`);
  console.log('Language Code: hi-IN');

  const response = await client.textToSpeech.convert({
    text: sampleText,
    language_code: 'hi-IN',
  });

  const durationMs = Date.now() - startTime;

  if (!response.audios || response.audios.length === 0) {
    console.error('Error: No audio chunks returned from Sarvam AI.');
    process.exit(1);
  }

  // Combine audio chunks and write to file
  const audioBuffer = Buffer.from(response.audios[0], 'base64');
  const outputPath = join(process.cwd(), 'sarvam_sample.wav');
  writeFileSync(outputPath, audioBuffer);

  console.log('Sarvam AI Text-to-Speech call successful:');
  console.log(`- Status: 200 OK`);
  console.log(`- Request Duration: ${durationMs}ms`);
  console.log(`- Audio Chunks Received: ${response.audios.length}`);
  console.log(`- Audio File Size: ${audioBuffer.length} bytes`);
  console.log(`- Saved Output Audio: ${outputPath}`);
}

main().catch((err) => {
  console.error('Sarvam AI API call failed:', err.message || err);
  process.exit(1);
});

