import crypto from 'node:crypto';

const jobs = new Map();

export function createJob(url) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = { id, url, status: 'waiting', progress: 0, message: 'Queued for processing', clips: [], error: null };
  jobs.set(id, job);
  return job;
}

export function getJob(id) { return jobs.get(id); }

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
  return job;
}