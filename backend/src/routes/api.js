import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { createJob, getJob, updateJob } from '../jobs/jobManager.js';
import { downloadVideo } from '../services/downloader.js';
import { extractAudio } from '../services/audio.js';
import { transcribe } from '../services/transcription.js';
import { getSegmentsForClip, selectClips } from '../services/clipSelector.js';
import { renderClip } from '../services/renderer.js';
import { analyzeGameplay } from '../services/gameplayAnalyzer.js';

const router = express.Router();
const root = path.resolve(process.cwd(), '..');
const tempRoot = path.join(root, 'data', 'temp');
const outputRoot = path.join(root, 'data', 'output');
const uploadRoot = path.join(root, 'data', 'uploads');
const youtubeUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;
const upload = multer({
  dest: uploadRoot,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype === 'video/mp4' || path.extname(file.originalname).toLowerCase() === '.mp4')
});

async function processJob(job) {
  const temp = path.join(tempRoot, job.id);
  const output = path.join(outputRoot, job.id);
  await fs.mkdir(temp, { recursive: true }); await fs.mkdir(output, { recursive: true });
  try {
    let video;
    if (job.sourceType === 'gameplay') {
      updateJob(job.id, { status: 'inspecting', progress: 8, message: 'Inspecting gameplay video...' });
      video = path.join(temp, 'gameplay.mp4');
      await fs.rename(job.uploadPath, video);
    } else {
      updateJob(job.id, { status: 'downloading', progress: 10, message: 'Downloading video...' });
      video = await downloadVideo(job.url, temp);
    }
    updateJob(job.id, { status: 'extracting_audio', progress: 28, message: 'Extracting audio...' });
    const audio = await extractAudio(video, temp);
    updateJob(job.id, { status: 'transcribing', progress: 42, message: 'Transcribing audio...' });
    let transcript = [];
    try {
      transcript = await transcribe(audio, temp);
    } catch (error) {
      if (job.sourceType !== 'gameplay') throw error;
      console.warn(`[${job.id}] Whisper unavailable or returned no speech; continuing with visual analysis: ${error.message}`);
    }
    let selected;
    if (job.sourceType === 'gameplay') {
      updateJob(job.id, { status: 'analyzing_activity', progress: 55, message: 'Analyzing gameplay activity...' });
      const analysisDirectory = path.join(temp, 'analysis');
      await fs.mkdir(analysisDirectory, { recursive: true });
      updateJob(job.id, { status: 'evaluating_candidates', progress: 68, message: 'Evaluating gameplay candidates with AI...' });
      const analysis = await analyzeGameplay(video, analysisDirectory, transcript);
      selected = analysis.clips;
      await fs.writeFile(path.join(output, 'analysis.json'), JSON.stringify({ metadata: analysis.metadata, clips: selected }, null, 2));
    } else {
      updateJob(job.id, { status: 'finding_clips', progress: 60, message: 'Finding the best moments...' });
      selected = await selectClips(transcript);
    }
    const clips = [];
    for (let index = 0; index < selected.length; index += 1) {
      const clip = selected[index];
      updateJob(job.id, { status: 'rendering', progress: 65 + Math.round(index / selected.length * 30), message: `Rendering clip ${index + 1} of ${selected.length}...` });
      await renderClip(video, output, clip, getSegmentsForClip(transcript, clip), index + 1, job.captions);
      clips.push({ filename: `clip${index + 1}.mp4`, rank: clip.rank || index + 1, score: clip.score, start: clip.start, end: clip.end, duration: clip.end - clip.start, reason: clip.reason, category: clip.category, activityScore: clip.activityScore });
    }
    updateJob(job.id, { status: 'completed', progress: 100, message: 'Finished.', clips });
  } catch (error) {
    console.error(`[${job.id}]`, error);
    updateJob(job.id, { status: 'error', progress: 0, message: 'Processing failed.', error: error.message });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
    if (job.uploadPath) await fs.rm(job.uploadPath, { force: true });
  }
}

router.post('/generate', upload.single('video'), (req, res) => {
  const captions = req.body?.captions !== 'false';
  if (req.file) {
    const job = createJob({ sourceType: 'gameplay', uploadPath: req.file.path, originalName: req.file.originalname, captions });
    processJob(job);
    return res.status(202).json({ jobId: job.id });
  }
  const url = String(req.body?.url || '').trim();
  if (!youtubeUrl.test(url)) return res.status(400).json({ error: 'Enter a valid YouTube URL.' });
  const job = createJob({ sourceType: 'youtube', url, captions }); processJob(job);
  res.status(202).json({ jobId: job.id });
});

router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ status: job.status, progress: job.progress, message: job.message, error: job.error });
});

router.get('/clips/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ clips: job.clips.map((clip) => ({
    ...clip,
    url: `/api/download/${job.id}/${clip.filename}`,
    downloadUrl: `/api/download/${job.id}/${clip.filename}?cleanup=1`,
  })) });
});

router.get('/download/:jobId/:filename', async (req, res) => {
  const job = getJob(req.params.jobId);
  const filename = path.basename(req.params.filename);
  if (!job || !/^clip\d+\.mp4$/.test(filename)) return res.status(404).end();
  const file = path.join(outputRoot, job.id, filename);
  try {
    await fs.access(file);
    res.sendFile(file, async (error) => {
      if (error) {
        if (!res.headersSent) res.status(error.statusCode || 500).end();
        return;
      }
      if (req.query.cleanup === '1') {
        await fs.rm(file, { force: true });
        await fs.rm(path.dirname(file), { recursive: true, force: true });
      }
    });
  } catch { res.status(404).end(); }
});

export default router;