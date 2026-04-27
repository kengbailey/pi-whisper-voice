# AGENTS.md

Guidance for coding agents working on `pi-whisper-voice`.

## Project context

`pi-whisper-voice` is a Pi extension that adds hold-to-talk voice input backed by an OpenAI-compatible Whisper/STT server.

Current user flow:

1. Hold `SPACE` to record.
2. Release `SPACE` to stop recording.
3. The extension transcribes the WAV with the configured STT endpoint.
4. The transcript is inserted into Pi's editor for review/editing.
5. The user manually sends the message.

Important behavior:

- Do **not** auto-send transcripts.
- Hold `SPACE` is the only recording trigger.
- Do **not** reintroduce the old `Ctrl+Shift+V` fallback shortcut.
- Do **not** reintroduce `/voice-test` as an active command unless explicitly requested.
- Language is currently fixed to English (`en`).
- `ffmpeg` is currently the only active audio capture implementation.
- Footer states are intentionally simple:
  - `🎤 ready`
  - `🎤 recording`
  - `🎤 transcribing`

## Release context

Published package:

- npm: `pi-whisper-voice`
- GitHub: `https://github.com/kengbailey/pi-whisper-voice`

Released versions:

- `0.1.0`: first public npm/GitHub release.
- `0.2.0`: added persistent settings and `/voice-settings` UI.

Install command:

```bash
pi install npm:pi-whisper-voice
```

Temporary run command:

```bash
pi -e npm:pi-whisper-voice
```

Release automation:

- Normal pushes/PRs run CI only.
- npm publish and GitHub Release creation happen from `v*` tag pushes.
- Do **not** manually create a GitHub Release before pushing a tag; the workflow creates it after npm publish succeeds.
- For the next release, merge approved PRs to `main`, then run from `main`:

```bash
npm version <next-version>
git push origin main --tags
```

## Branch and review workflow

Do not commit feature work directly to `main`.

For new work:

1. Create a feature branch from `main`.
2. Commit the change on that branch.
3. Push the branch.
4. Open a PR for human review.

Suggested branch names:

- `feature/<short-description>` for user-facing features.
- `fix/<short-description>` for bug fixes.
- `docs/<short-description>` for documentation-only changes.
- `chore/<short-description>` for maintenance.

Keep PRs focused and reviewable. Avoid mixing unrelated feature, formatting, and release changes.

## Repository conventions

### TypeScript and module style

- Source files are TypeScript and loaded directly by Pi via `jiti`; there is no build step for runtime.
- Package type is ESM (`"type": "module"`).
- Use `.js` extensions in local TypeScript imports, for example:

```ts
import { transcribeFile } from "./recorder.js";
```

- Keep runtime files listed in `package.json` `files` so npm packages include them.

### Pi extension API

- `CustomEditor` must be imported from `@mariozechner/pi-coding-agent`.
- TUI key helpers such as `Key`, `matchesKey`, `isKeyRelease`, `isKeyRepeat`, `isKittyProtocolActive`, and `decodeKittyPrintable` come from `@mariozechner/pi-tui`.
- Do not import `decodePrintableKey` from the `@mariozechner/pi-tui` root; it is not root-exported.
- When using `DynamicBorder` in extension UI, pass an explicit color function.

### Settings conventions

Settings added in `0.2.0` live under `piWhisperVoice` in global Pi settings:

```json
{
  "piWhisperVoice": {
    "version": 1,
    "sttBaseUrl": "http://localhost:8000/v1",
    "sttModel": "Systran/faster-distil-whisper-large-v3",
    "sttToken": "dummy"
  }
}
```

Resolution order:

1. Environment variables.
2. Global Pi settings (`~/.pi/agent/settings.json`).
3. Defaults.

Environment variables:

```text
PI_VOICE_STT_BASE_URL
PI_VOICE_STT_MODEL
PI_VOICE_STT_TOKEN
```

Security convention:

- Project-local voice settings are intentionally ignored.
- Do not allow repo-local `.pi/settings.json` to redirect microphone audio or provide a token.
- Never display the full token in status or settings UI.
- Token values may be saved in global Pi settings as plaintext; prefer env vars for sensitive tokens.

### Settings UI conventions

- Primary command: `/voice-settings`.
- Aliases/subcommands:
  - `/voice settings`
  - `/voice config`
- Status command: `/voice status`.
- Settings UI uses `SettingsList` inside an overlay.
- The current settings panel has a full green border using Pi theme `success`.
- Keep the settings panel focused on the current user-controlled variables unless asked otherwise:
  - STT server URL
  - model name
  - token
- Do not add timeout as a user-facing setting unless explicitly requested.

### Recorder/STT conventions

- STT endpoint shape is OpenAI-compatible:

```http
POST <sttBaseUrl>/audio/transcriptions
Authorization: Bearer <sttToken>
Content-Type: multipart/form-data
```

- Multipart fields currently include:
  - `file`
  - `model`
  - `language`
- Keep temporary WAV cleanup best-effort and idempotent.
- Long-running `ffmpeg` recording should use `spawn()`, not `execFile()`.
- Stop `ffmpeg` cleanly with `q`, then fall back to `SIGTERM`/`SIGKILL` if needed.

### UX conventions

- Preserve normal typing behavior.
- Key-release events must be consumed before reaching `super.handleInput()` to avoid duplicate characters.
- `wantsKeyRelease` should remain dynamic and only true when voice is enabled and Kitty protocol is active.
- Without Kitty key-release support, hold-to-talk should not break normal SPACE typing.
- Transcripts should be inserted into the editor for user review, never submitted automatically.

## Validation

Before pushing a branch, run:

```bash
npm run check
npm test
```

For release readiness, run:

```bash
npm run ci
```

`npm run ci` performs:

1. Typecheck.
2. Tests.
3. `npm pack --dry-run`.

If behavior touches Pi interactive loading, also smoke-test with:

```bash
pi -p "hello"
```

If the change affects TUI behavior, manually inspect it in Pi interactive mode.

## Current important commands

```text
/voice
/voice status
/voice settings
/voice config
/voice-settings
```

`/voice` with no args toggles voice input on/off.

## Current important files

- `index.ts`: Pi extension entry point, custom editor, hold-to-talk state machine, commands.
- `recorder.ts`: audio capture and OpenAI-compatible transcription client.
- `config.ts`: settings loading, normalization, env/global/default resolution, atomic settings writes.
- `settings-panel.ts`: `/voice-settings` overlay UI.
- `test/config.test.ts`: settings/config tests.
- `test/recorder.test.ts`: recorder/STT request tests.
- `test/import.test.ts`: import/export smoke tests.
- `README.md`: user-facing docs.
- `ROADMAP.md`: backlog and future improvements.
