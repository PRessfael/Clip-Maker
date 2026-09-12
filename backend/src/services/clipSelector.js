function candidatesFromTranscript(segments) {
  const candidates = [];
  for (let start = 0; start < segments.length; start += 2) {
    let end = start;
    while (end < segments.length && segments[end].end - segments[start].start < 90) end += 1;
    if (end > start && segments[end - 1].end - segments[start].start >= 20) {
      candidates.push({ start: segments[start].start, end: segments[end - 1].end, text: segments.slice(start, end).map((s) => s.text).join(' ') });
    }
  }
  if (candidates.length <= 80) return candidates;
  const sampled = [];
  const stride = (candidates.length - 1) / 79;
  for (let index = 0; index < 80; index += 1) sampled.push(candidates[Math.round(index * stride)]);
  return sampled;
}

function timestamp(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').replace(',', '.');
  if (!text.includes(':')) return Number(text);
  const [hours, minutes, seconds] = text.split(':');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

async function askOllama(candidates) {
  const prompt = `Select the best distinct short-form clips from these timestamped candidates. Return ONLY JSON in the shape {"clips":[{"start":number,"end":number,"score":number,"reason":string}]}. Pick up to 5, score 0-100, prefer complete, self-contained, surprising or useful moments. Copy start and end EXACTLY from candidate ranges. Do not invent timestamps. The transcript may describe only dialogue, so prefer moments with a clear setup and payoff.\n${JSON.stringify(candidates)}`;
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'llama3.2', prompt, stream: false, format: 'json' }),
    signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS || 90000))
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const body = await response.json();
  try { return JSON.parse(body.response); } catch { throw new Error('Ollama returned invalid clip JSON.'); }
}

export async function selectClips(segments) {
  const candidates = candidatesFromTranscript(segments);
  if (!candidates.length) throw new Error('No 20-90 second clip candidates were found.');
  let result;
  try {
    result = await askOllama(candidates);
  } catch (error) {
    console.warn('Transcript clip ranking fallback:', error.message);
    result = { clips: [] };
  }
  const valid = (Array.isArray(result.clips) ? result.clips : []).map((clip) => ({
    start: timestamp(clip.start), end: timestamp(clip.end), score: Number(clip.score), reason: String(clip.reason || 'Selected as a strong short-form moment.')
  })).filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end) && Number.isFinite(clip.score) && clip.end > clip.start && clip.end - clip.start >= 15 && clip.end - clip.start <= 100).map((clip) => ({ ...clip, score: Math.max(0, Math.min(100, clip.score)) }));
  valid.sort((a, b) => b.score - a.score);
  const distinct = [];
  for (const clip of valid) {
    if (!distinct.some((other) => Math.min(clip.end, other.end) - Math.max(clip.start, other.start) > Math.min(clip.end - clip.start, other.end - other.start) * 0.35)) distinct.push(clip);
    if (distinct.length === 5) break;
  }
  for (let index = 0; distinct.length < 5 && index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (distinct.some((other) => Math.min(candidate.end, other.end) - Math.max(candidate.start, other.start) > Math.min(candidate.end - candidate.start, other.end - other.start) * 0.35)) continue;
    distinct.push({
      ...candidate,
      score: Math.max(55, 70 - distinct.length * 5),
      reason: 'Supplemental distinct moment selected from the source candidates.'
    });
  }
  if (!distinct.length) {
    const fallbackCandidates = candidatesFromTranscript(segments);
    const fallbackIndexes = fallbackCandidates.length <= 3 ? fallbackCandidates.map((_candidate, index) => index) : [0, Math.floor(fallbackCandidates.length / 2), fallbackCandidates.length - 1];
    return fallbackIndexes.map((candidateIndex, index) => ({
      ...fallbackCandidates[candidateIndex],
      score: Math.max(55, 70 - index * 5),
      reason: 'Selected from a complete transcript segment because the AI response did not contain usable timestamps.'
    }));
  }
  return distinct;
}

export function getSegmentsForClip(segments, clip) { return segments.filter((segment) => segment.end > clip.start && segment.start < clip.end); }