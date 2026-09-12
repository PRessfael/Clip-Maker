import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './process.js';

function assTime(seconds) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = (seconds % 60).toFixed(2).padStart(5, '0'); return `${h}:${String(m).padStart(2, '0')}:${s}`; }
function escapeAss(text) { return text.replace(/[{}]/g, '').replace(/\\/g, '\\\\').replace(/\n/g, '\\N'); }
async function writeCaptions(file, segments, clipStart, clipEnd) {
  const events = segments.map((segment) => {
    const start = Math.max(0, segment.start - clipStart);
    const end = Math.min(clipEnd - clipStart, segment.end - clipStart);
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${escapeAss(segment.text)}`;
  }).join('\n');
  const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,260,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
  await fs.writeFile(file, ass);
}

export async function renderClip(videoPath, outputDirectory, clip, segments, index, captions = true) {
  const subtitlePath = path.join(outputDirectory, `captions-${index}.ass`);
  const outputPath = path.join(outputDirectory, `clip${index}.mp4`);
  if (captions) await writeCaptions(subtitlePath, segments, clip.start, clip.end);
  const filter = `crop='if(gt(iw/ih,9/16),ih*9/16,iw)':'if(gt(iw/ih,9/16),ih,iw*16/9)',scale=1080:1920:flags=lanczos${captions ? `,subtitles=captions-${index}.ass` : ''}`;
  try {
    await runCommand(process.env.FFMPEG_COMMAND || 'ffmpeg', ['-y', '-ss', String(clip.start), '-i', videoPath, '-t', String(clip.end - clip.start), '-vf', filter, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath], { cwd: outputDirectory });
  } finally {
    await fs.rm(subtitlePath, { force: true });
  }
  return outputPath;
}