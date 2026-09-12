# AI YouTube Clip Generator

Turn long-form YouTube videos into captioned vertical clips locally. This React and Node.js app downloads a video, transcribes it with Whisper, uses a local Ollama model to identify strong moments, and renders 9:16 MP4 clips with FFmpeg. No video or transcript data is sent to a hosted AI service by the app.

## What you need

These are the required local tools:

- Node.js 20 or newer: install from [nodejs.org](https://nodejs.org/).
- **yt-dlp, Deno, and FFmpeg**: install with `winget install --id yt-dlp.yt-dlp -e`, then restart the terminal. Verify with `yt-dlp --version`, `deno --version`, and `ffmpeg -version`.
- **Whisper**: the setup below downloads the official whisper.cpp Windows x64 build and `ggml-base.en.bin` into `tools/whisper` and `models`.
- **Ollama**: install from [ollama.com](https://ollama.com), start the Ollama app or service, then download the default model with `ollama pull llama3.2`. Verify with `ollama list`.

Whisper can also be installed separately. Set `WHISPER_COMMAND` and `WHISPER_MODEL` to full paths in `backend/.env` if you do not use the bundled setup. The same `.env` file supports custom paths for yt-dlp, Deno, and FFmpeg.

For videos that return YouTube HTTP 403, set `YOUTUBE_COOKIES_FROM_BROWSER=brave` (or `chrome`, `edge`, or `firefox`) in `backend/.env`, then restart the backend. yt-dlp will use that browser's local YouTube cookies; close the browser first if cookie access is blocked.

If yt-dlp cannot copy Brave's cookie database, close every Brave window and retry. The app also automatically retries without cookies when the cookie database is locked.

## Install and run

From this folder:

```powershell
Copy-Item backend/.env.example backend/.env
npm install
npm run install:all
npm run dev
```

To install the bundled local Whisper files manually from PowerShell:

```powershell
New-Item -ItemType Directory -Force tools/whisper, models
Invoke-WebRequest https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-bin-x64.zip -OutFile "$env:TEMP/whisper.zip"
Expand-Archive "$env:TEMP/whisper.zip" -DestinationPath tools/whisper -Force
Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true" -OutFile models/ggml-base.en.bin
```

Open `http://localhost:5173`. The API listens only on `127.0.0.1:3001`.

## Analyze authorized gameplay

Use the **Select local gameplay video** control in the app to upload an authorized campaign MP4. The upload is written to disk with a 4 GB limit; the original file is never loaded into memory or sent to Ollama. FFprobe reads metadata, then FFmpeg samples low-resolution video and mono audio signals to build activity candidates. Whisper is supporting evidence only, and Ollama receives candidate timestamps, scores, and transcript snippets rather than video data. The top distinct candidates are rendered as 9:16 clips with the original gameplay audio.

Compact analysis metadata and ranked results are kept in `data/output/<jobId>/analysis.json`. Temporary sampled signals and uploaded copies are removed after processing.

The Whisper command-line output format differs between builds. This app supports the JSON formats emitted by current whisper.cpp builds (`--output-json`); if your build uses a different flag, adapt `backend/src/services/transcription.js`.

## Troubleshooting

- A missing executable produces a readable job error; verify it from PowerShell with `where.exe yt-dlp`, `where.exe ffmpeg`, and `where.exe whisper-cli`.
- After installing yt-dlp with WinGet, start a new terminal before running `npm run dev` so the updated PATH is inherited by Node.js.
- If clip selection fails, start Ollama and verify the model with `ollama list`.
- YouTube downloads can fail for unavailable, age-restricted, or login-required videos. Use a public video URL and update yt-dlp.
- HTTP 403 and unavailable-format responses trigger an alternate IPv4/embedded-client download using a progressive MP4 format. If both attempts fail, configure `YOUTUBE_COOKIES_FROM_BROWSER` as described above.
- Generated clips are kept in `data/output/<jobId>` until their Download MP4 link finishes. Previewing a clip does not delete it. Temporary source files are deleted after every job, including failed jobs.
- To remove output from jobs created before automatic cleanup was added, run `Remove-Item data/output/* -Recurse -Force` from the project folder. This deletes generated clips but not the Whisper model or other tools.