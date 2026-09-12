import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './process.js';

const ffmpeg = () => process.env.FFMPEG_COMMAND || 'ffmpeg';
const ffprobe = () => process.env.FFPROBE_COMMAND || 'ffprobe';

async function probeVideo(videoPath) {
  const result = await runCommand(ffprobe(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath]);
  const data = JSON.parse(result.stdout);
  const stream = data.streams?.find((item) => item.codec_type === 'video') || {};
  const audio = data.streams?.find((item) => item.codec_type === 'audio') || {};
  const duration = Number(data.format?.duration || stream.duration || 0);
  return {
    duration,
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    fps: stream.r_frame_rate || '0/1',
    videoCodec: stream.codec_name || 'unknown',
    audioCodec: audio.codec_name || 'none',
    bitrate: Number(data.format?.bit_rate || 0),
    size: Number(data.format?.size || 0)
  };
}

function parseSignalLog(text) {
  const samples = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const time = line.match(/pts_time[:=]([\d.]+)/);
    const yDiff = line.match(/(?:YDIF|YDIFF)=(-?[\d.]+)/);
    const rms = line.match(/RMS_level=(-?[\d.]+)/);
    if (time) {
      current = { time: Number(time[1]), motion: 0, audio: 0 };
      samples.push(current);
    }
    if (current && yDiff) current.motion = Number(yDiff[1]);
    if (current && rms) current.audio = Number(rms[1]);
  }
  return samples.filter((sample) => Number.isFinite(sample.time));
}

function normalize(values) {
  const finite = values.filter(Number.isFinite);
  const low = Math.min(...finite, 0);
  const high = Math.max(...finite, 1);
  return (value) => Math.max(0, Math.min(1, (value - low) / (high - low || 1)));
}

async function sampleSignals(videoPath, analysisDirectory) {
  const result = await runCommand(ffmpeg(), [
    '-hide_banner', '-loglevel', 'info', '-i', videoPath,
    '-vf', 'fps=0.5,scale=360:-2,signalstats,metadata=print',
    '-an', '-f', 'null', '-'
  ]);
  await fs.writeFile(path.join(analysisDirectory, 'signals.txt'), `${result.stdout}\n${result.stderr}`);
  return parseSignalLog(`${result.stdout}\n${result.stderr}`);
}

async function sampleAudio(videoPath, analysisDirectory) {
  const result = await runCommand(ffmpeg(), [
    '-hide_banner', '-loglevel', 'info', '-i', videoPath,
    '-vn', '-af', 'aresample=16000,astats=metadata=1:reset=1,ametadata=print',
    '-f', 'null', '-'
  ]);
  const text = `${result.stdout}\n${result.stderr}`;
  await fs.writeFile(path.join(analysisDirectory, 'audio-signals.txt'), text);
  return parseSignalLog(text);
}

function activityBuckets(duration, visual, audio) {
  const motionScore = normalize(visual.map((sample) => sample.motion));
  const audioScore = normalize(audio.map((sample) => sample.audio));
  const buckets = [];
  for (let start = 0; start < duration; start += 2) {
    const end = Math.min(duration, start + 2);
    const visuals = visual.filter((sample) => sample.time >= start && sample.time < end);
    const sounds = audio.filter((sample) => sample.time >= start && sample.time < end);
    const motion = visuals.length ? Math.max(...visuals.map((sample) => motionScore(sample.motion))) : 0;
    const audioIntensity = sounds.length ? Math.max(...sounds.map((sample) => audioScore(sample.audio))) : 0;
    buckets.push({ start, end, motion, audio: audioIntensity, activity: Math.min(1, motion * 0.75 + audioIntensity * 0.25) });
  }
  return buckets;
}

function candidateCategory(bucket) {
  if (bucket.motion > 0.8 && bucket.audio > 0.65) return 'intense gunfight';
  if (bucket.motion > 0.75) return 'fast action';
  if (bucket.audio > 0.8) return 'explosion or payoff';
  return 'gameplay moment';
}

function generateCandidates(buckets, duration) {
  const candidates = [];
  const peaks = [...buckets].sort((a, b) => b.activity - a.activity);
  for (const peak of peaks) {
    const start = Math.max(0, peak.start - 8);
    const end = Math.min(duration, Math.max(start + 15, peak.end + 16));
    const nearby = buckets.filter((bucket) => bucket.start < end && bucket.end > start);
    const activityScore = nearby.reduce((sum, bucket) => sum + bucket.activity, 0) / Math.max(1, nearby.length);
    const audioScore = nearby.reduce((sum, bucket) => sum + bucket.audio, 0) / Math.max(1, nearby.length);
    const motionScore = nearby.reduce((sum, bucket) => sum + bucket.motion, 0) / Math.max(1, nearby.length);
    const candidate = { start, end, duration: end - start, activityScore, audioScore, motionScore, category: candidateCategory(peak) };
    if (candidate.duration >= 10 && !candidates.some((other) => Math.min(end, other.end) - Math.max(start, other.start) > Math.min(candidate.duration, other.duration) * 0.5)) candidates.push(candidate);
    if (candidates.length >= 20) break;
  }
  return candidates;
}

async function rankCandidates(candidates, transcript) {
  const evidence = candidates.map((candidate, index) => ({
    candidateId: index + 1,
    ...candidate,
    transcript: transcript.filter((segment) => segment.end > candidate.start && segment.start < candidate.end).map((segment) => ({ start: segment.start, end: segment.end, text: segment.text }))
  }));
  const prompt = `You rank Call of Duty Modern Warfare campaign gameplay clips for short-form video. Return ONLY JSON: {"clips":[{"candidateId":1,"score":94,"hook":9,"action":10,"satisfaction":9,"standalone":9,"visualPotential":9,"reason":"...","category":"multi-kill"}]}. Prefer satisfying gunplay, rapid eliminations, standout weapons, killstreaks, fast action, clutch moments and clear visual payoffs. Gameplay visuals and activity matter more than dialogue. A silent action sequence can beat a talking segment. Do not invent candidate IDs or timestamps. Rank distinct clips only. Suggested weights: action 30%, visualPotential 25%, standalone 15%, satisfaction 15%, hook 10%, transcript/audio evidence 5%.\n${JSON.stringify(evidence)}`;
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'llama3.2', prompt, stream: false, format: 'json' }),
    signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS || 90000))
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const body = await response.json();
  try { return JSON.parse(body.response); } catch { throw new Error('Ollama returned invalid gameplay clip JSON.'); }
}

function distinctClips(clips) {
  const result = [];
  for (const clip of [...clips].sort((a, b) => b.score - a.score)) {
    if (!result.some((other) => Math.min(clip.end, other.end) - Math.max(clip.start, other.start) > Math.min(clip.end - clip.start, other.end - other.start) * 0.35)) result.push(clip);
    if (result.length === 8) break;
  }
  return result.map((clip, index) => ({ ...clip, rank: index + 1 }));
}

export async function analyzeGameplay(videoPath, analysisDirectory, transcript = []) {
  const metadata = await probeVideo(videoPath);
  if (!metadata.duration) throw new Error('Could not determine gameplay video duration.');
  const [visual, audio] = await Promise.all([sampleSignals(videoPath, analysisDirectory), sampleAudio(videoPath, analysisDirectory)]);
  const activity = activityBuckets(metadata.duration, visual, audio);
  await fs.writeFile(path.join(analysisDirectory, 'metadata.json'), JSON.stringify({ ...metadata, activity }, null, 2));
  const candidates = generateCandidates(activity, metadata.duration);
  if (!candidates.length) throw new Error('No gameplay activity candidates were found.');
  let ranked;
  try { ranked = await rankCandidates(candidates, transcript); } catch (error) {
    console.warn('Gameplay ranking fallback:', error.message);
    ranked = { clips: candidates.slice(0, 8).map((candidate, index) => ({ candidateId: index + 1, score: Math.round(55 + candidate.activityScore * 35), reason: 'High combined visual activity and gameplay audio signal.', category: candidate.category })) };
  }
  let clips = distinctClips((ranked.clips || []).map((clip) => {
    const candidate = candidates[Number(clip.candidateId) - 1];
    if (!candidate) return null;
    return { ...candidate, score: Math.max(0, Math.min(100, Number(clip.score) || 0)), reason: String(clip.reason || 'Strong gameplay moment.'), category: String(clip.category || candidate.category) };
  }).filter(Boolean));
  if (clips.length < 8) {
    clips = distinctClips([
      ...clips,
      ...candidates.map((candidate, index) => ({
        ...candidate,
        score: Math.round(55 + candidate.activityScore * 35 - index * 0.01),
        reason: 'Supplemental distinct gameplay moment selected from activity candidates.'
      }))
    ]);
  }
  if (!clips.length) {
    clips = distinctClips(candidates.slice(0, 8).map((candidate) => ({ ...candidate, score: Math.round(55 + candidate.activityScore * 35), reason: 'High combined visual activity and gameplay audio signal.' })));
  }
  if (!clips.length) throw new Error('Gameplay AI returned no usable candidates.');
  return { metadata, clips };
}