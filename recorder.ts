/**
 * Audio recording + STT client for Pi voice input extension.
 *
 * Uses ffmpeg to capture from the default microphone, then sends
 * the WAV to an OpenAI-compatible STT endpoint.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface RecorderConfig {
  sttBaseUrl: string;
  sttModel: string;
  sttToken: string;
  language: string;
  sampleRate: number;
}

export const DEFAULT_CONFIG: RecorderConfig = {
  sttBaseUrl: "http://192.168.8.116:8000/v1",
  sttModel: "Systran/faster-distil-whisper-large-v3",
  sttToken: "dummy",
  language: "en",
  sampleRate: 16000,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tempWavPath(): string {
  return join(
    tmpdir(),
    `pi-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    const done = (exited: boolean) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(exited);
    };
    const onExit = () => done(true);
    const onError = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function waitForFfmpegToStayAlive(child: ChildProcess, timeoutMs = 800): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    await sleep(50);
  }
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Detect whether ffmpeg is available for audio capture.
 */
export async function detectAudioTool(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err) => {
      resolve(err === null);
    });
  });
}

// ─── Recording ───────────────────────────────────────────────────────────────

export interface ActiveRecording {
  path: string;
  stop: () => Promise<void>;
}

/**
 * Start recording audio to a temp WAV file via ffmpeg.
 * Returns a handle to stop recording, or null if ffmpeg is unavailable.
 */
export async function startRecording(
  config: RecorderConfig,
): Promise<ActiveRecording | null> {
  const available = await detectAudioTool();
  if (!available) return null;

  const path = tempWavPath();
  let stderrTail = "";

  const child = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "warning",
    "-y",
    "-f", "avfoundation",
    "-i", ":0",
    "-ar", String(config.sampleRate),
    "-ac", "1",
    "-c:a", "pcm_s16le",
    path,
  ], {
    stdio: ["pipe", "ignore", "pipe"],
  });

  child.stderr?.on("data", (chunk) => {
    stderrTail += chunk.toString();
    if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
  });

  const started = await waitForFfmpegToStayAlive(child);
  if (!started) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, 1000);
    }
    await cleanupWav(path);
    const detail = stderrTail.trim();
    throw new Error(detail ? `ffmpeg failed to start: ${detail}` : "ffmpeg exited before recording started");
  }

  let stopped = false;
  return {
    path,
    async stop() {
      if (stopped) return;
      stopped = true;

      if (child.exitCode !== null || child.signalCode !== null) return;

      // Ask ffmpeg to finalize the WAV cleanly. Fall back to signals if needed.
      try {
        if (child.stdin?.writable) {
          child.stdin.write("q");
          child.stdin.end();
        }
      } catch {
        // ignore, fall through to signals
      }

      if (await waitForExit(child, 1500)) return;
      child.kill("SIGTERM");
      if (await waitForExit(child, 1500)) return;
      child.kill("SIGKILL");
      await waitForExit(child, 1000);
    },
  };
}

// ─── STT ─────────────────────────────────────────────────────────────────────

/**
 * Send a WAV file to the OpenAI-compatible STT endpoint and return the transcript.
 */
export async function transcribeFile(
  config: RecorderConfig,
  wavPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const buffer = await readFile(wavPath);

  const boundary = `----pi-voice-${Date.now()}`;
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="recording.wav"\r\n` +
    `Content-Type: audio/wav\r\n\r\n`;
  const footer =
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n${config.sttModel}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\n${config.language}\r\n` +
    `--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header, "utf-8"),
    buffer,
    Buffer.from(footer, "utf-8"),
  ]);

  const url = `${config.sttBaseUrl}/audio/transcriptions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${config.sttToken}`,
    },
    body,
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STT API ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

/** Best-effort cleanup of a temp WAV file. */
export async function cleanupWav(path: string): Promise<void> {
  try { await unlink(path); } catch { /* ignore */ }
}

/** Return the WAV size, or 0 if it does not exist. */
export async function getWavSize(path: string): Promise<number> {
  return fileSize(path);
}

// ─── Full pipeline helpers ───────────────────────────────────────────────────

/**
 * Record audio until the abort signal fires, then transcribe.
 * Kept as a helper, but the hold-to-talk editor uses start/stop directly.
 */
export async function recordAndTranscribe(
  config: RecorderConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  const recording = await startRecording(config);
  if (!recording) return null;

  let stopped = false;
  let safety: ReturnType<typeof setTimeout>;
  const stopPromise = new Promise<void>((resolve) => {
    const stop = () => {
      if (!stopped) {
        stopped = true;
        resolve();
      }
    };

    signal?.addEventListener("abort", stop, { once: true });
    safety = setTimeout(stop, 60_000);
  });

  await stopPromise;
  clearTimeout(safety!);

  await recording.stop();

  if ((await getWavSize(recording.path)) < 100) {
    await cleanupWav(recording.path);
    return "";
  }

  try {
    const text = await transcribeFile(config, recording.path);
    await cleanupWav(recording.path);
    return text || null;
  } catch (err) {
    await cleanupWav(recording.path);
    throw err;
  }
}

/** Record for a fixed duration and transcribe (manual test helper). */
export async function testRecording(
  config: RecorderConfig,
  durationSeconds: number = 3,
): Promise<string | null> {
  const available = await detectAudioTool();
  if (!available) return null;

  const path = tempWavPath();

  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", [
      "-y", "-f", "avfoundation", "-i", ":0",
      "-ar", String(config.sampleRate),
      "-ac", "1", "-c:a", "pcm_s16le",
      "-t", String(durationSeconds),
      path,
    ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (err) => err ? reject(err) : resolve());
  });

  try {
    const text = await transcribeFile(config, path);
    await cleanupWav(path);
    return text || null;
  } catch (err) {
    await cleanupWav(path);
    throw err;
  }
}
