import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type RecorderConfig } from "./recorder.js";

export const VOICE_SETTINGS_KEY = "piWhisperVoice";
export const VOICE_SETTINGS_VERSION = 1;

export type VoiceSettingField = "sttBaseUrl" | "sttModel" | "sttToken";
export type VoiceSettingSource = "env" | "global" | "default";
export type VoiceSettingsScope = "global";

export interface VoiceSettings {
  version?: number;
  sttBaseUrl?: string;
  sttModel?: string;
  sttToken?: string;
}

export interface VoiceRuntimeConfig extends RecorderConfig {
  holdThresholdMs: number;
  typingCooldownMs: number;
  sttTimeoutMs: number;
  minUsefulWavBytes: number;
}

export interface VoiceSettingsPaths {
  global: string;
  project: string;
}

export interface VoiceConfigState {
  config: VoiceRuntimeConfig;
  sources: Record<VoiceSettingField, VoiceSettingSource>;
  paths: VoiceSettingsPaths;
  globalSettings: VoiceSettings;
  projectSettings: VoiceSettings;
  projectSettingsIgnored: true;
}

export const DEFAULT_RUNTIME_CONFIG: VoiceRuntimeConfig = {
  ...DEFAULT_CONFIG,
  holdThresholdMs: 1200,
  typingCooldownMs: 400,
  sttTimeoutMs: 120_000,
  minUsefulWavBytes: 100,
};

interface SettingsFile {
  [VOICE_SETTINGS_KEY]?: VoiceSettings;
  [key: string]: unknown;
}

const ENV_BY_FIELD: Record<VoiceSettingField, string> = {
  sttBaseUrl: "PI_VOICE_STT_BASE_URL",
  sttModel: "PI_VOICE_STT_MODEL",
  sttToken: "PI_VOICE_STT_TOKEN",
};

export function getVoiceSettingsPaths(cwd: string, home = homedir()): VoiceSettingsPaths {
  return {
    global: join(home, ".pi", "agent", "settings.json"),
    project: join(cwd, ".pi", "settings.json"),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonFile(path: string): Promise<SettingsFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }

  const parsed = JSON.parse(text) as unknown;
  if (!isObject(parsed)) throw new Error(`${path} must contain a JSON object`);
  return parsed as SettingsFile;
}

function readVoiceSettings(file: SettingsFile): VoiceSettings {
  const raw = file[VOICE_SETTINGS_KEY];
  if (!isObject(raw)) return {};

  const settings: VoiceSettings = {};
  if (typeof raw.version === "number") settings.version = raw.version;
  if (typeof raw.sttBaseUrl === "string") settings.sttBaseUrl = raw.sttBaseUrl;
  if (typeof raw.sttModel === "string") settings.sttModel = raw.sttModel;
  if (typeof raw.sttToken === "string") settings.sttToken = raw.sttToken;
  return settings;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSttBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (normalized.length === 0) throw new Error("Server URL cannot be empty");

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Server URL must be a valid http:// or https:// URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must use http:// or https://");
  }

  return normalized;
}

export function normalizeSttModel(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("Model name cannot be empty");
  return normalized;
}

export function normalizeSttToken(value: string): string {
  return value.trim();
}

function normalizeField(field: VoiceSettingField, value: string): string {
  switch (field) {
    case "sttBaseUrl": return normalizeSttBaseUrl(value);
    case "sttModel": return normalizeSttModel(value);
    case "sttToken": return normalizeSttToken(value);
  }
}

function resolveField(
  field: VoiceSettingField,
  defaultValue: string,
  globalSettings: VoiceSettings,
  env: NodeJS.ProcessEnv,
): { value: string; source: VoiceSettingSource } {
  const fromEnv = envValue(env, ENV_BY_FIELD[field]);
  if (fromEnv !== undefined) return { value: normalizeField(field, fromEnv), source: "env" };

  const fromGlobal = globalSettings[field];
  if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0) {
    return { value: normalizeField(field, fromGlobal), source: "global" };
  }

  return { value: normalizeField(field, defaultValue), source: "default" };
}

export async function loadVoiceConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): Promise<VoiceConfigState> {
  const paths = getVoiceSettingsPaths(cwd, home);
  const globalFile = await readJsonFile(paths.global);
  const globalSettings = readVoiceSettings(globalFile);
  const projectSettings: VoiceSettings = {};

  const sttBaseUrl = resolveField("sttBaseUrl", DEFAULT_RUNTIME_CONFIG.sttBaseUrl, globalSettings, env);
  const sttModel = resolveField("sttModel", DEFAULT_RUNTIME_CONFIG.sttModel, globalSettings, env);
  const sttToken = resolveField("sttToken", DEFAULT_RUNTIME_CONFIG.sttToken, globalSettings, env);

  return {
    config: {
      ...DEFAULT_RUNTIME_CONFIG,
      sttBaseUrl: sttBaseUrl.value,
      sttModel: sttModel.value,
      sttToken: sttToken.value,
    },
    sources: {
      sttBaseUrl: sttBaseUrl.source,
      sttModel: sttModel.source,
      sttToken: sttToken.source,
    },
    paths,
    globalSettings,
    projectSettings,
    projectSettingsIgnored: true,
  };
}

export async function saveVoiceSetting(
  cwd: string,
  field: VoiceSettingField,
  value: string | undefined,
  scope: VoiceSettingsScope = "global",
  home = homedir(),
): Promise<void> {
  const paths = getVoiceSettingsPaths(cwd, home);
  const path = paths[scope];
  const file = await readJsonFile(path);
  const current = readVoiceSettings(file);
  const next: VoiceSettings = {
    ...current,
    version: VOICE_SETTINGS_VERSION,
  };

  if (value === undefined) {
    delete next[field];
  } else {
    next[field] = normalizeField(field, value);
  }

  file[VOICE_SETTINGS_KEY] = next;
  await mkdir(dirname(path), { recursive: true });

  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  } catch (err) {
    try { await unlink(tmpPath); } catch { /* ignore cleanup */ }
    throw err;
  }
}

export function formatSettingSource(source: VoiceSettingSource): string {
  return source === "default" ? "default" : `from ${source}`;
}

export function formatTokenValue(token: string, source: VoiceSettingSource): string {
  if (token.trim().length === 0) return `unset (${formatSettingSource(source)})`;
  if (token === "dummy") return `dummy (${formatSettingSource(source)})`;
  return `configured (${formatSettingSource(source)})`;
}
