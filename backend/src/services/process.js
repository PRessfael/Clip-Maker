import { spawn } from 'node:child_process';

import path from 'node:path';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        const tool = path.basename(command);
        reject(new Error(`Required tool "${tool}" was not found. Install it and add it to PATH, or set the matching command in backend/.env.`));
        return;
      }
      reject(Object.assign(error, { command, stderr }));
    });
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-1200)}`)));
  });
}