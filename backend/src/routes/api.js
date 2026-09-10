import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createJob, getJob, updateJob } from '../jobs/jobManager.js';
import { downloadVideo } from '../services/downloader.js';
import { extractAudio } from '../services/audio.js';
import { transcribe } from '../services/transcription.js';
import { getSegmentsForClip, selectClips } from '../services/clipSelector.js';
import { renderClip } from '../services/renderer.js';

const router = express.Router();
const root = path.resolve(process.cwd(), '..');
const tempRoot = path.join(root, 'data', 'temp');
const outputRoot = path.join(root, 'data', 'output');
const youtubeUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;

async function processJob(job) {
  const temp = path.join(tempRoot, job.id);
  const output = path.join(outputRoot, job.id);
  await fs.mkdir(temp, { recursive: true }); await fs.mkdir(output, { recursive: true });
  try {
    updateJob(job.id, { status: 'downloading', progress: 10, message: 'Downloading video...' });
    const video = await downloadVideo(job.url, temp);
    updateJob(job.id, { status: 'extracting_audio', progress: 28, message: 'Extracting audio...' });
    const audio = await extractAudio(video, temp);
    updateJob(job.id, { status: 'transcribing', progress: 42, message: 'Transcribing audio...' });
    const transcript = await transcribe(audio, temp);
    updateJob(job.id, { status: 'finding_clips', progress: 60, message: 'Finding the best moments...' });
    const selected = await selectClips(transcript);
    const clips = [];
    for (let index = 0; index < selected.length; index += 1) {
      const clip = selected[index];
      updateJob(job.id, { status: 'rendering', progress: 65 + Math.round(index / selected.length * 30), message: `Rendering clip ${index + 1} of ${selected.length}...` });
      await renderClip(video, output, clip, getSegmentsForClip(transcript, clip), index + 1);
      clips.push({ filename: `clip${index + 1}.mp4`, score: clip.score, start: clip.start, end: clip.end, duration: clip.end - clip.start, reason: clip.reason });
    }
    updateJob(job.id, { status: 'completed', progress: 100, message: 'Finished.', clips });
  } catch (error) {
    console.error(`[${job.id}]`, error);
    updateJob(job.id, { status: 'error', progress: 0, message: 'Processing failed.', error: error.message });
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

router.post('/generate', (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!youtubeUrl.test(url)) return res.status(400).json({ error: 'Enter a valid YouTube URL.' });
  const job = createJob(url); processJob(job);
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