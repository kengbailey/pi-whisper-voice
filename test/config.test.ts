import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RUNTIME_CONFIG,
  VOICE_SETTINGS_KEY,
  formatTokenValue,
  loadVoiceConfig,
  normalizeSttBaseUrl,
  normalizeSttModel,
  saveVoiceSetting,
} from "../config.js";

async function tempDirs(): Promise<{ cwd: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-whisper-voice-config-test-"));
  return {
    cwd: join(root, "project"),
    home: join(root, "home"),
  };
}

async function writeSettings(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".pi"), { recursive: true });
  await writeFile(join(path, ".pi", "settings.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

test("loadVoiceConfig uses current defaults when no settings exist", async () => {
  const { cwd, home } = await tempDirs();
  const state = await loadVoiceConfig(cwd, {}, home);

  assert.equal(state.config.sttBaseUrl, DEFAULT_RUNTIME_CONFIG.sttBaseUrl);
  assert.equal(state.config.sttModel, DEFAULT_RUNTIME_CONFIG.sttModel);
  assert.equal(state.config.sttToken, DEFAULT_RUNTIME_CONFIG.sttToken);
  assert.equal(state.sources.sttBaseUrl, "default");
  assert.equal(state.sources.sttModel, "default");
  assert.equal(state.sources.sttToken, "default");
});

test("saveVoiceSetting persists under piWhisperVoice and preserves unrelated settings", async () => {
  const { cwd, home } = await tempDirs();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({ theme: "dark" }, null, 2), "utf8");

  await saveVoiceSetting(cwd, "sttBaseUrl", " http://localhost:8000/v1/ ", "global", home);
  await saveVoiceSetting(cwd, "sttModel", " test-model ", "global", home);

  const saved = JSON.parse(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"));
  assert.equal(saved.theme, "dark");
  assert.equal(saved[VOICE_SETTINGS_KEY].version, 1);
  assert.equal(saved[VOICE_SETTINGS_KEY].sttBaseUrl, "http://localhost:8000/v1");
  assert.equal(saved[VOICE_SETTINGS_KEY].sttModel, "test-model");
});

test("project settings are ignored for safety and env overrides global settings", async () => {
  const { cwd, home } = await tempDirs();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({
    [VOICE_SETTINGS_KEY]: {
      version: 1,
      sttBaseUrl: "http://global.example/v1",
      sttModel: "global-model",
      sttToken: "global-token",
    },
  }, null, 2), "utf8");
  await writeSettings(cwd, {
    [VOICE_SETTINGS_KEY]: {
      version: 1,
      sttBaseUrl: "http://project.example/v1",
      sttModel: "project-model",
    },
  });

  const projectState = await loadVoiceConfig(cwd, {}, home);
  assert.equal(projectState.config.sttBaseUrl, "http://global.example/v1");
  assert.equal(projectState.config.sttModel, "global-model");
  assert.equal(projectState.config.sttToken, "global-token");
  assert.equal(projectState.sources.sttBaseUrl, "global");
  assert.equal(projectState.sources.sttModel, "global");
  assert.equal(projectState.sources.sttToken, "global");
  assert.equal(projectState.projectSettingsIgnored, true);

  const envState = await loadVoiceConfig(cwd, {
    PI_VOICE_STT_BASE_URL: "http://env.example/v1",
    PI_VOICE_STT_MODEL: "env-model",
    PI_VOICE_STT_TOKEN: "env-token",
  }, home);
  assert.equal(envState.config.sttBaseUrl, "http://env.example/v1");
  assert.equal(envState.config.sttModel, "env-model");
  assert.equal(envState.config.sttToken, "env-token");
  assert.equal(envState.sources.sttBaseUrl, "env");
  assert.equal(envState.sources.sttModel, "env");
  assert.equal(envState.sources.sttToken, "env");
});

test("invalid project settings JSON is ignored because voice config is global/env only", async () => {
  const { cwd, home } = await tempDirs();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });
  await writeFile(join(home, ".pi", "agent", "settings.json"), JSON.stringify({
    [VOICE_SETTINGS_KEY]: {
      version: 1,
      sttBaseUrl: "http://global.example/v1",
    },
  }, null, 2), "utf8");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "settings.json"), "{ invalid json", "utf8");

  const state = await loadVoiceConfig(cwd, {}, home);
  assert.equal(state.config.sttBaseUrl, "http://global.example/v1");
  assert.equal(state.sources.sttBaseUrl, "global");
});

test("normalizers validate configurable values", () => {
  assert.equal(normalizeSttBaseUrl(" https://example.test/v1/// "), "https://example.test/v1");
  assert.equal(normalizeSttModel(" whisper-large "), "whisper-large");
  assert.throws(() => normalizeSttBaseUrl("ftp://example.test/v1"), /http:\/\/ or https:\/\//);
  assert.throws(() => normalizeSttBaseUrl("not a url"), /valid http:\/\/ or https:\/\/ URL/);
  assert.throws(() => normalizeSttModel("   "), /Model name cannot be empty/);
});

test("formatTokenValue masks configured token values", () => {
  assert.equal(formatTokenValue("dummy", "default"), "dummy (default)");
  assert.equal(formatTokenValue("secret-token", "global"), "configured (from global)");
  assert.equal(formatTokenValue("secret-token", "env"), "configured (from env)");
});

test("saveVoiceSetting with undefined clears the field and reverts to default", async () => {
  const { cwd, home } = await tempDirs();
  await mkdir(join(home, ".pi", "agent"), { recursive: true });

  await saveVoiceSetting(cwd, "sttToken", "secret-token", "global", home);
  let state = await loadVoiceConfig(cwd, {}, home);
  assert.equal(state.config.sttToken, "secret-token");
  assert.equal(state.sources.sttToken, "global");

  await saveVoiceSetting(cwd, "sttToken", undefined, "global", home);
  const saved = JSON.parse(await readFile(join(home, ".pi", "agent", "settings.json"), "utf8"));
  assert.equal(Object.hasOwn(saved[VOICE_SETTINGS_KEY], "sttToken"), false);

  state = await loadVoiceConfig(cwd, {}, home);
  assert.equal(state.config.sttToken, DEFAULT_RUNTIME_CONFIG.sttToken);
  assert.equal(state.sources.sttToken, "default");
});
