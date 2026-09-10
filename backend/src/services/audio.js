import path from 'node:path';
import { runCommand } from './process.js';

export async function extractAudio(videoPath, directory) {
  const audioPath = path.join(directory, 'audio.wav');
  await runCommand(process.env.FFMPEG_COMMAND || 'ffmpeg', ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', audioPath]);
  return audioPath;
}