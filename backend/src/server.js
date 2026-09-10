import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import api from './routes/api.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const app = express();
app.use(cors()); app.use(express.json({ limit: '32kb' })); app.use('/api', api);
app.get('/health', (_req, res) => res.json({ ok: true }));
const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => console.log(`AI Clip Generator API listening on http://localhost:${port}`));