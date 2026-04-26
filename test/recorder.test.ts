import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupWav,
  getWavSize,
  transcribeFile,
  type RecorderConfig,
} from "../recorder.js";

const TEST_CONFIG: RecorderConfig = {
  sttBaseUrl: "http://127.0.0.1:8000/v1",
  sttModel: "test-whisper-model",
  sttToken: "test-token",
  language: "en",
  sampleRate: 16000,
};

async function createTempWav(bytes = "fake wav bytes"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-whisper-voice-test-"));
  const file = join(dir, "sample.wav");
  await writeFile(file, bytes);
  return file;
}

test("getWavSize returns 0 for missing files", async () => {
  const missing = join(tmpdir(), `pi-whisper-voice-missing-${Date.now()}-${Math.random()}.wav`);
  assert.equal(await getWavSize(missing), 0);
});

test("cleanupWav is idempotent", async () => {
  const wav = await createTempWav();
  assert.ok((await getWavSize(wav)) > 0);
  await cleanupWav(wav);
  assert.equal(await getWavSize(wav), 0);
  await cleanupWav(wav);
  assert.equal(await getWavSize(wav), 0);
});

test("transcribeFile sends OpenAI-compatible multipart request", async () => {
  const wav = await createTempWav("RIFF....WAVEfmt fake-audio");
  const originalFetch = globalThis.fetch;
  let capturedUrl: string | URL | Request | undefined;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify({ text: " hello world " }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const text = await transcribeFile(TEST_CONFIG, wav);
    assert.equal(text, "hello world");

    assert.equal(String(capturedUrl), "http://127.0.0.1:8000/v1/audio/transcriptions");
    assert.equal(capturedInit?.method, "POST");

    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-token");
    assert.match(headers["Content-Type"], /^multipart\/form-data; boundary=/);

    const body = Buffer.isBuffer(capturedInit?.body)
      ? capturedInit.body.toString("utf8")
      : Buffer.from(capturedInit?.body as ArrayBuffer).toString("utf8");

    assert.match(body, /name="file"; filename="recording\.wav"/);
    assert.match(body, /Content-Type: audio\/wav/);
    assert.match(body, /name="model"\r\n\r\ntest-whisper-model/);
    assert.match(body, /name="language"\r\n\r\nen/);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupWav(wav);
  }
});

test("transcribeFile throws useful errors for failed STT responses", async () => {
  const wav = await createTempWav("RIFF....WAVEfmt fake-audio");
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response("bad request from server", { status: 400 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => transcribeFile(TEST_CONFIG, wav),
      /STT API 400: bad request from server/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanupWav(wav);
  }
});
