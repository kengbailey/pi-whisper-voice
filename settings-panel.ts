import {
  DynamicBorder,
  getSettingsListTheme,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Input,
  SettingsList,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
  type SettingItem,
} from "@mariozechner/pi-tui";
import {
  formatSettingSource,
  formatTokenValue,
  loadVoiceConfig,
  saveVoiceSetting,
  type VoiceConfigState,
  type VoiceSettingField,
} from "./config.js";

type Theme = ExtensionContext["ui"]["theme"];

type SaveHandler = (rawValue: string) => Promise<string>;

class SettingInput implements Component, Focusable {
  private readonly input = new Input();
  private error: string | undefined;
  private saving = false;

  focused = false;

  constructor(
    private readonly title: string,
    private readonly description: string,
    initialValue: string,
    private readonly theme: Theme,
    private readonly onSave: SaveHandler,
    private readonly onCancel: () => void,
    private readonly requestRender: () => void,
  ) {
    this.input.setValue(initialValue);
    this.input.onEscape = this.onCancel;
    this.input.onSubmit = (value) => {
      void this.submit(value);
    };
  }

  handleInput(data: string): void {
    // Always delegate so Esc can bail out of a slow save.
    this.input.handleInput(data);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    this.input.focused = this.focused;

    const lines = [
      this.theme.fg("accent", this.theme.bold(this.title)),
      "",
      this.theme.fg("muted", this.description),
      "",
      ...this.input.render(Math.max(1, width)),
      "",
      this.theme.fg("dim", this.saving ? "  Saving…" : "  Enter to save · Esc to go back"),
    ];

    if (this.error) {
      lines.splice(4, 0, this.theme.fg("error", `  ${this.error}`), "");
    }

    return lines;
  }

  private async submit(value: string): Promise<void> {
    if (this.saving) return;
    this.error = undefined;
    this.saving = true;
    this.requestRender();

    try {
      await this.onSave(value);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
      this.requestRender();
    }
  }
}

function valueWithSource(value: string, source: string): string {
  return `${value} (${source})`;
}

function displayValue(field: VoiceSettingField, state: VoiceConfigState): string {
  const source = formatSettingSource(state.sources[field]);
  switch (field) {
    case "sttBaseUrl": return valueWithSource(state.config.sttBaseUrl, source);
    case "sttModel": return valueWithSource(state.config.sttModel, source);
    case "sttToken": return formatTokenValue(state.config.sttToken, state.sources.sttToken);
  }
}

function inputInitialValue(field: VoiceSettingField, state: VoiceConfigState): string {
  switch (field) {
    case "sttBaseUrl": return state.config.sttBaseUrl;
    case "sttModel": return state.config.sttModel;
    case "sttToken": return "";
  }
}

function inputDescription(field: VoiceSettingField, state: VoiceConfigState): string {
  switch (field) {
    case "sttBaseUrl":
      return `OpenAI-compatible STT base URL. Current value is ${formatSettingSource(state.sources.sttBaseUrl)}.`;
    case "sttModel":
      return `Model name sent in the transcription request. Current value is ${formatSettingSource(state.sources.sttModel)}.`;
    case "sttToken":
      return `Enter a new token. Leave blank to keep the current token. Type "none" to clear the saved token. Current value is ${formatSettingSource(state.sources.sttToken)}.`;
  }
}

function fieldLabel(field: VoiceSettingField): string {
  switch (field) {
    case "sttBaseUrl": return "Server URL";
    case "sttModel": return "Model";
    case "sttToken": return "Token";
  }
}

export async function showVoiceSettingsPanel(
  ctx: ExtensionContext,
  onConfigChanged: (state: VoiceConfigState) => void,
): Promise<void> {
  let state = await loadVoiceConfig(ctx.cwd);

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let settingsList: SettingsList;
    const borderColor = (s: string) => theme.fg("success", s);
    const topBorder = new DynamicBorder(borderColor);
    const bottomBorder = new DynamicBorder(borderColor);

    const wrapBorderLine = (line: string, width: number): string => {
      const innerWidth = Math.max(1, width - 4);
      const clipped = truncateToWidth(line, innerWidth, "");
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
      return `${borderColor("│")} ${clipped}${padding} ${borderColor("│")}`;
    };

    const saveField = async (field: VoiceSettingField, rawValue: string): Promise<string> => {
      const trimmed = rawValue.trim();
      const effectiveSource = state.sources[field];

      if (field === "sttToken" && trimmed.length === 0) {
        ctx.ui.notify("Voice token unchanged", "info");
        return displayValue(field, state);
      }

      const value = field === "sttToken" && trimmed.toLowerCase() === "none"
        ? undefined
        : rawValue;

      await saveVoiceSetting(ctx.cwd, field, value, "global");
      state = await loadVoiceConfig(ctx.cwd);
      onConfigChanged(state);

      for (const item of items) {
        item.description = inputDescription(item.id as VoiceSettingField, state);
      }

      if (effectiveSource === "env" || state.sources[field] === "env") {
        ctx.ui.notify("Saved to global settings, but an environment variable still overrides this value", "warning");
      } else {
        ctx.ui.notify("Voice setting saved", "info");
      }

      return displayValue(field, state);
    };

    const itemFor = (field: VoiceSettingField): SettingItem => ({
      id: field,
      label: fieldLabel(field),
      description: inputDescription(field, state),
      currentValue: displayValue(field, state),
      submenu: (_currentValue, closeSubmenu) => new SettingInput(
        fieldLabel(field),
        inputDescription(field, state),
        inputInitialValue(field, state),
        theme,
        async (rawValue) => {
          const newDisplayValue = await saveField(field, rawValue);
          closeSubmenu(newDisplayValue);
          return newDisplayValue;
        },
        () => closeSubmenu(),
        () => tui.requestRender(),
      ),
    });

    const items: SettingItem[] = [
      itemFor("sttBaseUrl"),
      itemFor("sttModel"),
      itemFor("sttToken"),
    ];

    settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 10),
      getSettingsListTheme(),
      () => {
        // Values are saved by the submenu before it closes.
      },
      () => done(undefined),
      { enableSearch: false },
    );

    return {
      render(width: number): string[] {
        const innerWidth = Math.max(1, width - 4);
        const content = [
          theme.fg("accent", theme.bold("Voice Settings")),
          "",
          ...settingsList.render(innerWidth),
          "",
          theme.fg("dim", "  Values are saved to ~/.pi/agent/settings.json"),
          theme.fg("dim", "  Env vars override saved settings; project settings are ignored for safety."),
        ];

        return [
          ...topBorder.render(width),
          ...content.map((line) => wrapBorderLine(line, width)),
          ...bottomBorder.render(width),
        ];
      },
      invalidate(): void {
        topBorder.invalidate();
        bottomBorder.invalidate();
        settingsList.invalidate();
      },
      handleInput(data: string): void {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      width: "70%",
      minWidth: 44,
      maxHeight: "80%",
      anchor: "center",
    },
  });
}
