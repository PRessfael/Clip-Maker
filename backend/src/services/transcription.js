import path from 'node:path';
import { runCommand } from './process.js';

function seconds(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '0').replace(',', '.');
  if (!text.includes(':')) return Number(text);
  const [hours, minutes, rawSeconds] = text.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(rawSeconds);
}

export async function transcribe(audioPath, directory) {
  const command = process.env.WHISPER_COMMAND || 'whisper-cli';
  const outputBase = path.join(directory, 'transcript');
  const args = ['-m', process.env.WHISPER_MODEL || 'models/ggml-base.en.bin', '-f', audioPath, '--output-json', '--output-file', outputBase];
  const result = await runCommand(command, args);
  const jsonPath = `${outputBase}.json`;
  let data;
  try { data = JSON.parse(await (await import('node:fs/promises')).readFile(jsonPath, 'utf8')); }
  catch { data = JSON.parse(result.stdout); }
  const segments = (data.transcription || data.segments || []).map((segment) => ({
    start: seconds(segment.timestamps?.from ?? segment.start ?? 0),
    end: seconds(segment.timestamps?.to ?? segment.end ?? 0),
    text: String(segment.text || '').trim()
  })).filter((segment) => segment.text && segment.end > segment.start);
  if (!segments.length) throw new Error('Whisper returned no speech segments.');
  return segments;
}