/**
 * pi-whisper-voice
 *
 * Minimal hold-SPACE voice input for Pi using an OpenAI-compatible
 * Whisper/STT endpoint. Release SPACE to transcribe and insert the transcript
 * into the editor for review. No fallback shortcut.
 *
 * Commands:
 *   /voice — Toggle hold-to-talk voice input on/off
 *   /voice status — Show current voice/STT configuration
 *   /voice settings — Configure STT server URL, model, and token
 *   /voice-settings — Open settings directly
 */
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Key,
  decodeKittyPrintable,
  isKeyRelease,
  isKeyRepeat,
  isKittyProtocolActive,
  matchesKey,
  type AutocompleteItem,
} from "@mariozechner/pi-tui";
import {
  cleanupWav,
  detectAudioTool,
  getWavSize,
  startRecording,
  transcribeFile,
  type ActiveRecording,
} from "./recorder.js";
import {
  DEFAULT_RUNTIME_CONFIG,
  formatSettingSource,
  formatTokenValue,
  loadVoiceConfig,
  type VoiceRuntimeConfig,
} from "./config.js";
import { showVoiceSettingsPanel } from "./settings-panel.js";

// ─── Configuration ───────────────────────────────────────────────────────────

let runtimeConfig: VoiceRuntimeConfig = DEFAULT_RUNTIME_CONFIG;

type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

let voiceEnabled = true;
let voicePhase: VoicePhase = "idle";
let lastTypingTime = 0;
let currentEditor: VoiceEditor | undefined;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printableInput(data: string): string | undefined {
  // Raw terminal printable input.
  if (data.length === 1 && data.charCodeAt(0) >= 32) return data;

  // Root-exported Kitty CSI-u printable decoder.
  return decodeKittyPrintable(data);
}

function updateStatus(ctx: ExtensionContext): void {
  if (!voiceEnabled) {
    ctx.ui.setStatus("voice", undefined);
    return;
  }

  switch (voicePhase) {
    case "starting":
    case "recording":
      ctx.ui.setStatus("voice", ctx.ui.theme.fg("error", " 🎤 recording"));
      break;
    case "transcribing":
      ctx.ui.setStatus("voice", ctx.ui.theme.fg("warning", " 🎤 transcribing"));
      break;
    case "idle":
    default:
      ctx.ui.setStatus("voice", ctx.ui.theme.fg("success", " 🎤 ready"));
      break;
  }
}

function setPhase(ctx: ExtensionContext, phase: VoicePhase): void {
  voicePhase = phase;
  updateStatus(ctx);
}

function notifyError(ctx: ExtensionContext, prefix: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  ctx.ui.notify(`${prefix}: ${msg.slice(0, 220)}`, "error");
}

// ─── VoiceEditor: hold SPACE state machine ───────────────────────────────────

class VoiceEditor extends CustomEditor {
  private spaceDownAt = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private startInFlight = false;
  private releaseWhileStarting = false;
  private activeRecording: ActiveRecording | null = null;
  private disposed = false;
  private stopping = false;

  constructor(
    tui: ConstructorParameters<typeof CustomEditor>[0],
    theme: ConstructorParameters<typeof CustomEditor>[1],
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    private readonly ctx: ExtensionContext,
  ) {
    super(tui, theme, keybindings);
  }

  /** Only request release events when hold-to-talk can actually use them. */
  get wantsKeyRelease(): boolean {
    return !this.disposed && voiceEnabled && isKittyProtocolActive();
  }

  handleInput(data: string): void {
    if (this.disposed) return;

    // Release events are never text input. If they reach us, consume them.
    // This is the main duplicate-character guard.
    if (isKeyRelease(data)) {
      if (voiceEnabled && isKittyProtocolActive() && matchesKey(data, Key.space)) {
        this.onSpaceRelease();
      }
      return;
    }

    if (!voiceEnabled) {
      super.handleInput(data);
      return;
    }

    const printable = printableInput(data);
    if (printable && printable !== " ") {
      lastTypingTime = Date.now();
    }

    // Without Kitty key releases, true hold-to-talk is not safe. Leave all input
    // untouched so normal SPACE typing never breaks.
    if (!isKittyProtocolActive()) {
      super.handleInput(data);
      return;
    }

    const isSpace = matchesKey(data, Key.space);

    // Ignore SPACE repeats while a hold/recording is active. Kitty flag 2 should
    // mark repeats as :2 events; if not, the active hold guard below still helps.
    if (isKeyRepeat(data)) {
      if (isSpace && this.isHoldingStartingOrRecording()) return;
      super.handleInput(data);
      return;
    }

    if (isSpace) {
      this.onSpacePress(data);
      return;
    }

    // If another key arrives while a SPACE tap is pending, commit the pending
    // SPACE as ordinary input first, then process this key normally.
    if (this.spaceDownAt > 0 && !this.startInFlight && !this.activeRecording) {
      this.cancelPendingSpace();
      super.handleInput(" ");
    }

    super.handleInput(data);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHoldTimer();
    this.spaceDownAt = 0;
    this.releaseWhileStarting = false;
    this.startInFlight = false;

    const recording = this.activeRecording;
    this.activeRecording = null;
    if (recording) {
      void recording.stop().finally(() => {
        void cleanupWav(recording.path);
      });
    }
  }

  private onSpacePress(data: string): void {
    // During active capture, only release matters. During STT, let the user type.
    if (voicePhase === "starting" || voicePhase === "recording" || this.startInFlight || this.activeRecording) return;
    if (voicePhase === "transcribing" || this.stopping) {
      super.handleInput(data);
      return;
    }

    // Already tracking a SPACE press.
    if (this.spaceDownAt > 0) return;

    const now = Date.now();

    // Preserve normal typing: a SPACE immediately after regular text is normal
    // input, not a voice gesture.
    if (now - lastTypingTime < runtimeConfig.typingCooldownMs) {
      super.handleInput(data);
      return;
    }

    this.spaceDownAt = now;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = undefined;
      if (!this.disposed && this.spaceDownAt > 0) {
        void this.beginRecording();
      }
    }, runtimeConfig.holdThresholdMs);
  }

  private onSpaceRelease(): void {
    if (this.disposed) return;

    if (this.spaceDownAt <= 0 && !this.startInFlight && !this.activeRecording) {
      return;
    }

    const heldMs = this.spaceDownAt > 0 ? Date.now() - this.spaceDownAt : 0;
    this.spaceDownAt = 0;
    this.clearHoldTimer();

    // Released before threshold: ordinary single SPACE tap.
    if (!this.startInFlight && !this.activeRecording && heldMs < runtimeConfig.holdThresholdMs) {
      super.handleInput(" ");
      return;
    }

    // ffmpeg is still starting; stop immediately once the handle exists.
    if (this.startInFlight && !this.activeRecording) {
      this.releaseWhileStarting = true;
      return;
    }

    if (this.activeRecording) {
      void this.stopTranscribeToEditor();
    }
  }

  private async beginRecording(): Promise<void> {
    if (this.disposed || this.startInFlight || this.activeRecording || voicePhase !== "idle") return;

    this.startInFlight = true;
    this.releaseWhileStarting = false;
    setPhase(this.ctx, "starting");

    try {
      const recording = await startRecording(runtimeConfig);
      this.startInFlight = false;

      if (this.disposed) {
        if (recording) {
          await recording.stop();
          await cleanupWav(recording.path);
        }
        return;
      }

      if (!recording) {
        this.resetHoldState();
        setPhase(this.ctx, "idle");
        this.ctx.ui.notify("Voice: ffmpeg not found (brew install ffmpeg)", "error");
        return;
      }

      this.activeRecording = recording;
      setPhase(this.ctx, "recording");

      // User released SPACE during ffmpeg startup.
      if (this.releaseWhileStarting || this.spaceDownAt === 0) {
        this.releaseWhileStarting = false;
        await this.stopTranscribeToEditor();
      }
    } catch (err) {
      this.startInFlight = false;
      this.resetHoldState();
      if (!this.disposed) {
        setPhase(this.ctx, "idle");
        notifyError(this.ctx, "Voice start error", err);
      }
    }
  }

  private async stopTranscribeToEditor(): Promise<void> {
    if (this.disposed || this.stopping) return;

    const recording = this.activeRecording;
    if (!recording) return;

    this.stopping = true;
    this.activeRecording = null;
    this.startInFlight = false;
    this.releaseWhileStarting = false;
    this.spaceDownAt = 0;
    this.clearHoldTimer();

    setPhase(this.ctx, "transcribing");

    let needsCleanup = true;
    try {
      await recording.stop();

      const size = await getWavSize(recording.path);
      if (size < runtimeConfig.minUsefulWavBytes) {
        this.ctx.ui.notify("Voice: recording was empty", "warning");
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), runtimeConfig.sttTimeoutMs);
      let text: string;
      try {
        text = await transcribeFile(runtimeConfig, recording.path, controller.signal);
      } finally {
        clearTimeout(timeout);
      }

      await cleanupWav(recording.path);
      needsCleanup = false;

      const transcript = text.trim();
      if (!transcript) {
        this.ctx.ui.notify("Voice: no speech detected", "warning");
        return;
      }

      if (!this.disposed) {
        this.insertTranscriptForReview(transcript);
        this.ctx.ui.notify("Voice: transcript inserted for review", "info");
      }
    } catch (err) {
      if (!this.disposed) notifyError(this.ctx, "Voice", err);
    } finally {
      if (needsCleanup) {
        await cleanupWav(recording.path);
      }
      this.stopping = false;
      if (!this.disposed) {
        setPhase(this.ctx, "idle");
      }
    }
  }

  private insertTranscriptForReview(transcript: string): void {
    const existing = this.getText();
    if (existing.trim().length === 0) {
      this.setText(transcript);
    } else {
      this.setText(`${existing.trimEnd()}\n${transcript}`);
    }
    this.tui.requestRender();
  }

  private isHoldingStartingOrRecording(): boolean {
    return this.spaceDownAt > 0 || this.startInFlight || this.activeRecording !== null;
  }

  private cancelPendingSpace(): void {
    this.spaceDownAt = 0;
    this.clearHoldTimer();
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  }

  private resetHoldState(): void {
    this.spaceDownAt = 0;
    this.releaseWhileStarting = false;
    this.clearHoldTimer();
  }
}

// ─── Extension registration ──────────────────────────────────────────────────

function installVoiceEditor(ctx: ExtensionContext): void {
  currentEditor?.dispose();
  currentEditor = undefined;

  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    currentEditor = new VoiceEditor(tui, theme, keybindings, ctx);
    return currentEditor;
  });
}

function uninstallVoiceEditor(ctx: ExtensionContext): void {
  currentEditor?.dispose();
  currentEditor = undefined;
  voicePhase = "idle";
  lastTypingTime = 0;
  ctx.ui.setEditorComponent(undefined);
}

function notifyVoiceReady(ctx: ExtensionContext): void {
  const kitty = isKittyProtocolActive();
  ctx.ui.notify(
    kitty
      ? [
        "Voice ready — hold SPACE to record",
        "Settings: /voice-settings",
      ].join("\n")
      : [
        "Voice loaded, but hold-to-talk needs Kitty keyboard protocol/key releases",
        "Settings: /voice-settings",
      ].join("\n"),
    kitty ? "info" : "warning",
  );
}

async function reloadRuntimeConfig(ctx: ExtensionContext): Promise<void> {
  try {
    runtimeConfig = (await loadVoiceConfig(ctx.cwd)).config;
  } catch (err) {
    runtimeConfig = DEFAULT_RUNTIME_CONFIG;
    notifyError(ctx, "Voice settings", err);
  }
}

async function openVoiceSettings(ctx: ExtensionContext): Promise<void> {
  if (voicePhase !== "idle") {
    ctx.ui.notify("Voice is busy — wait for recording/transcription to finish", "warning");
    return;
  }

  try {
    await showVoiceSettingsPanel(ctx, (state) => {
      runtimeConfig = state.config;
    });
  } catch (err) {
    notifyError(ctx, "Voice settings", err);
  }
}

async function showVoiceStatus(ctx: ExtensionContext): Promise<void> {
  let state;
  try {
    state = await loadVoiceConfig(ctx.cwd);
    runtimeConfig = state.config;
  } catch (err) {
    notifyError(ctx, "Voice status", err);
    return;
  }

  const lines = [
    "Voice status:",
    "",
    `  enabled:       ${voiceEnabled ? "yes" : "no"}`,
    `  state:         ${voicePhase === "idle" ? "ready" : voicePhase}`,
    `  server:        ${state.config.sttBaseUrl} (${formatSettingSource(state.sources.sttBaseUrl)})`,
    `  model:         ${state.config.sttModel} (${formatSettingSource(state.sources.sttModel)})`,
    `  token:         ${formatTokenValue(state.config.sttToken, state.sources.sttToken)}`,
    `  settings:      /voice-settings`,
  ];

  ctx.ui.notify(lines.join("\n"), "info");
}

const VOICE_ARGUMENTS: AutocompleteItem[] = [
  { value: "settings", label: "settings", description: "Configure STT server URL, model, and token" },
  { value: "status", label: "status", description: "Show current voice/STT configuration" },
  { value: "config", label: "config", description: "Alias for settings" },
];

function getVoiceArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const query = prefix.trimStart().toLowerCase();
  const matches = VOICE_ARGUMENTS.filter((item) => item.value.startsWith(query));
  return matches.length > 0 ? matches : null;
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("voice", {
    description: "Toggle hold-SPACE voice input on/off; use /voice settings to configure STT",
    getArgumentCompletions: getVoiceArgumentCompletions,
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Voice requires interactive mode", "error");
        return;
      }

      const command = args.trim().toLowerCase();

      if (command === "settings" || command === "config") {
        await openVoiceSettings(ctx);
        return;
      }

      if (command === "status" || command === "info") {
        await showVoiceStatus(ctx);
        return;
      }

      if (command.length > 0) {
        ctx.ui.notify("Usage: /voice, /voice status, or /voice settings", "warning");
        return;
      }

      if (voicePhase !== "idle") {
        ctx.ui.notify("Voice is busy — wait for recording/transcription to finish", "warning");
        return;
      }

      if (voiceEnabled) {
        voiceEnabled = false;
        uninstallVoiceEditor(ctx);
        updateStatus(ctx);
        ctx.ui.notify("Voice input disabled", "warning");
        return;
      }

      const available = await detectAudioTool();
      if (!available) {
        ctx.ui.notify("Voice: ffmpeg not found (brew install ffmpeg)", "error");
        return;
      }

      voiceEnabled = true;
      voicePhase = "idle";
      installVoiceEditor(ctx);
      updateStatus(ctx);
      setTimeout(() => {
        updateStatus(ctx);
        notifyVoiceReady(ctx);
      }, 300);
    },
  });

  pi.registerCommand("voice-settings", {
    description: "Configure pi-whisper-voice STT server URL, model, and token",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Voice settings require interactive mode", "error");
        return;
      }
      await openVoiceSettings(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    voicePhase = "idle";
    lastTypingTime = 0;
    currentEditor = undefined;
    await reloadRuntimeConfig(ctx);

    const available = await detectAudioTool();
    if (!available) {
      voiceEnabled = false;
      ctx.ui.notify("Voice: ffmpeg not found (brew install ffmpeg)", "warning");
    }

    if (voiceEnabled) {
      installVoiceEditor(ctx);
    }

    updateStatus(ctx);

    if (voiceEnabled) {
      // Kitty detection can complete shortly after startup in some terminals.
      setTimeout(() => {
        updateStatus(ctx);
        notifyVoiceReady(ctx);
      }, 300);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    uninstallVoiceEditor(ctx);
    ctx.ui.setStatus("voice", undefined);
  });
}
