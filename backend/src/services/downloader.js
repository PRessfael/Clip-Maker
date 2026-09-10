import path from 'node:path';
import { runCommand } from './process.js';

function commonArgs(deno, output, url, useCookies = true) {
  const args = ['--js-runtimes', `deno:${deno}`, '--no-playlist', '-o', output];
  if (useCookies && process.env.YOUTUBE_COOKIES_FROM_BROWSER) args.push('--cookies-from-browser', process.env.YOUTUBE_COOKIES_FROM_BROWSER);
  args.push(url);
  return args;
}

export async function downloadVideo(url, directory) {
  const output = path.join(directory, 'video.%(ext)s');
  const deno = process.env.DENO_COMMAND || 'deno';
  const command = process.env.YTDLP_COMMAND || 'yt-dlp';
  try {
    await runCommand(command, [...commonArgs(deno, output, url).slice(0, -1), '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', url]);
  } catch (error) {
    const retryable = error.message.includes('403') || error.message.includes('Requested format is not available') || error.message.includes('Only images are available');
    const cookieCopyFailed = error.message.includes('Could not copy Chrome cookie database');
    if (!retryable && !cookieCopyFailed) throw error;
    await runCommand(command, [...commonArgs(deno, output, url, false).slice(0, -1), '--force-ipv4', '--extractor-args', 'youtube:player_client=web_embedded', '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', url]);
  }
  return path.join(directory, 'video.mp4');
}