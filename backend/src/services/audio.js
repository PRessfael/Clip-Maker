import path from 'node:path';
import { runCommand } from './process.js';

export async function extractAudio(videoPath, directory) {
  const audioPath = path.join(directory, 'audio.mp3');
  await runCommand(process.env.FFMPEG_COMMAND || 'ffmpeg', ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', audioPath]);
  return audioPath;
}