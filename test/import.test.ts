import test from "node:test";
import assert from "node:assert/strict";

test("extension module exports a default factory", async () => {
  const mod = await import("../index.js");
  assert.equal(typeof mod.default, "function");
});

test("recorder module exports public helpers", async () => {
  const mod = await import("../recorder.js");
  assert.equal(typeof mod.DEFAULT_CONFIG, "object");
  assert.equal(typeof mod.detectAudioTool, "function");
  assert.equal(typeof mod.startRecording, "function");
  assert.equal(typeof mod.transcribeFile, "function");
  assert.equal(typeof mod.cleanupWav, "function");
  assert.equal(typeof mod.getWavSize, "function");
});
