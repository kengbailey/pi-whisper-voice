# pi-whisper-voice Roadmap

Date: 2026-04-25

This document captures research and feature ideas for improving the local Pi voice input extension before publishing it publicly.

Current extension goal:

> Minimal hold-SPACE voice input for Pi using an OpenAI-compatible Whisper/STT endpoint. Hold SPACE to record, release to transcribe, insert transcript into the editor for review.

---

## Current Implementation Summary

Current behavior:

1. Hold `SPACE` to start recording after a hold threshold.
2. Release `SPACE` to stop recording.
3. Send recorded WAV to an OpenAI-compatible `/v1/audio/transcriptions` endpoint.
4. Insert transcript into the Pi editor for review/editing.
5. User manually sends when ready.

Current dependencies/assumptions:

- Requires Kitty keyboard protocol/key-release support for hold-to-talk.
- Uses `ffmpeg` for microphone recording.
- Uses a configured OpenAI-compatible STT server.
- Currently local/user-specific, not packaged for npm.

---

## Similar Existing Projects Researched

### `@codexstar/pi-listen`

Links:

- <https://github.com/codexstar69/pi-listen>
- <https://www.npmjs.com/package/@codexstar/pi-listen>

Summary:

- Hold-to-talk voice input for Pi.
- Supports hold `SPACE`.
- Supports Deepgram streaming and local/offline models.
- Supports `sox`, `ffmpeg`, and `arecord` audio capture fallback.
- Includes settings panel, onboarding, local model management, diagnostics, audio meter, pre-recording, tail recording, and transcript insertion into the editor.

Notable features:

- `/voice-settings`
- `/voice test`
- `/voice dictate`
- local/offline model catalog
- Deepgram streaming
- local OpenAI-compatible endpoint support
- device/hardware profiling
- model downloads
- pre-recording during hold threshold
- tail recording after release
- audio level/waveform feedback

Similarity to ours: **very high** for the broad voice-input concept.

Key difference:

- `pi-listen` is a full-featured voice platform.
- Our extension can remain a small adapter for existing OpenAI-compatible STT servers.

---

### `pi-extension-stt`

Links:

- <https://github.com/zerone0x/pi-stt>
- <https://www.npmjs.com/package/pi-extension-stt>

Summary:

- Local-first, privacy-first microphone STT for Pi.
- Uses Python + `faster-whisper` bridge.
- Inserts transcripts into Pi editor.
- Does not auto-send.
- Uses commands and `Ctrl+Alt+M` toggle rather than hold SPACE.

Notable features:

- `/stt-bootstrap`
- `/stt-setup`
- `/stt-status`
- `/stt-devices`
- `/stt-device`
- `/stt-prepare`
- guided dependency checks
- Python virtualenv bootstrap
- microphone device selection
- live widget/status hints
- transcript insertion without sending

Similarity to ours: **high conceptually**, different trigger/backend.

Key difference:

- `pi-extension-stt` bundles/bootstraps local `faster-whisper` workflow.
- Our extension uses an external OpenAI-compatible STT endpoint.

---

### Other Projects Noted

#### `@artale/pi-voice`

- Multi-provider STT for Pi.
- Providers: Deepgram, Groq Whisper, OpenAI Whisper.
- Commands like `/voice [seconds]`, `/voice dictate`, `/voice test`, `/voice stop`.
- More command-driven than hold-SPACE-focused.

#### `pi-voice` by `yukukotani`

- Headless daemon-style voice interface for Pi.
- Push-to-talk global hotkey.
- STT + TTS.
- Providers include local, Gemini, OpenAI, ElevenLabs.

#### `pi-voxtype`

- Bridges external `voxtype` daemon into Pi.
- Sends spoken input to active Pi session.
- Uses `Alt+Space` toggle.

---

## Positioning Recommendation

Do **not** publish this as “the first Pi voice extension.” That is already covered by existing projects.

Potential positioning:

> A tiny hold-SPACE voice input extension for Pi that works with any OpenAI-compatible STT server.

Target users:

- Already run `speaches`, `faster-whisper-server`, `whisper.cpp` server, LocalAI, or another OpenAI-compatible transcription endpoint.
- Want hold-SPACE voice input in Pi.
- Do not want Deepgram/Groq/OpenAI API keys.
- Do not want model management, a daemon, or a large extension.
- Want transcripts inserted for review, not auto-sent.

---

# Improvement Backlog

## Phase 1 — Publishable Minimal Robustness

### 1. Persistent Settings — Initial pass complete

Initial support stores STT server URL, model, and token under `piWhisperVoice` in global Pi settings JSON. Environment variables override saved values; project-local voice settings are ignored for safety. Remaining settings below are candidates for future expansion.

Suggested settings:

```ts
interface VoiceInputSettings {
  version: number;
  enabled: boolean;
  sttBaseUrl: string;
  sttModel: string;
  sttToken?: string;
  language: string;
  holdThresholdMs: number;
  typingCooldownMs: number;
  sttTimeoutMs: number;
  audioTool: "auto" | "ffmpeg" | "sox" | "arecord";
  audioDevice?: string;
  insertMode: "replace-empty-append-existing" | "replace" | "append" | "cursor";
  allowRemoteEndpoint: boolean;
  scope: "global" | "project";
}
```

Commands:

```text
/voice-settings
/voice settings
/voice status
/voice endpoint <url>
/voice model <model>
/voice token <token|none>
/voice language <code>
/voice reset
```

Priority: **Very high**

---

### 2. `/voice setup`

Guided first-run setup.

Should ask for:

1. STT endpoint
2. model
3. token
4. language
5. audio tool preference
6. global vs project settings

Priority: **High**

---

### 3. `/voice doctor`

Diagnostics command.

Suggested checks:

- Pi/extension version
- Kitty keyboard protocol status
- available audio tools
- selected audio tool
- microphone capture test
- configured STT endpoint
- endpoint reachability
- model/token/language config
- settings path
- security warning for non-local endpoint

Example output:

```text
Voice doctor

Keyboard:
  Kitty protocol: yes
  Hold SPACE: available

Audio:
  sox: not found
  ffmpeg: found /opt/homebrew/bin/ffmpeg
  arecord: n/a
  selected: ffmpeg
  mic capture: ok, 64 KB WAV

STT:
  endpoint: http://localhost:8000/v1
  model: Systran/faster-distil-whisper-large-v3
  auth: token configured
  API: ok

Ready.
```

Priority: **Very high**

---

### 4. Configurable Endpoint / Model / Token / Language — Partially complete

STT server URL, model, and token now use env/global-settings fallback. Language remains fixed to English for now.

Environment variable ideas:

```text
PI_VOICE_STT_BASE_URL
PI_VOICE_STT_MODEL
PI_VOICE_STT_TOKEN
PI_VOICE_LANGUAGE
```

Resolution order:

1. environment variables
2. global settings
3. defaults

Project-local voice settings are intentionally ignored for microphone-audio safety.

Priority: **Partially complete**

---

### 5. Audio Capture Fallback Chain

Current extension only uses `ffmpeg`.

Implement fallback like `pi-listen`:

1. `sox` / `rec`
2. `ffmpeg`
3. `arecord` on Linux

Platform-specific ffmpeg inputs:

- macOS: `avfoundation`
- Linux: `pulse` or ALSA fallback
- Windows: `dshow`

Priority: **Very high**

---

### 6. Endpoint Security Warning

Microphone audio is sensitive.

For non-loopback endpoints, warn the user:

```text
Voice endpoint is not local. Audio will be sent to 192.168.8.116.
Allow? [yes/no]
```

Suggested setting:

```ts
allowRemoteEndpoint: boolean
```

Default should be `false` for public package safety.

Priority: **High**

---

### 7. `/voice test`

Record a short test clip, transcribe it, and show/insert the result without sending.

Behavior:

```text
/voice test
```

- record 3 seconds
- send to STT
- show transcript in notification or insert into editor
- report failures clearly

Priority: **High**

---

### 8. Package as Installable Pi Extension

Convert from local folder to npm package.

Suggested package structure:

```text
package.json
README.md
LICENSE
src/index.ts
src/recorder.ts
src/config.ts
src/settings-panel.ts
src/audio-tools.ts
dist/...
```

`package.json` should include:

```json
{
  "name": "pi-openai-voice",
  "type": "module",
  "keywords": [
    "pi-package",
    "pi-extension",
    "voice",
    "speech-to-text",
    "stt",
    "openai-compatible",
    "whisper",
    "hold-to-talk"
  ],
  "pi": {
    "extensions": ["./dist/index.js"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*"
  }
}
```

Priority: **Required before publishing**

---

## Phase 2 — UX and Settings Polish

### 9. `/voice-settings` Panel

Add an interactive settings panel.

Suggested sections:

1. STT Endpoint
   - base URL
   - model
   - token
   - language
   - timeout

2. Recording
   - audio tool
   - microphone/device
   - hold threshold
   - typing cooldown

3. Behavior
   - insert mode
   - enabled/disabled
   - settings scope

4. Diagnostics
   - audio tools
   - mic test
   - endpoint test
   - current config path

Priority: **High**

---

### 10. Microphone Device Selection

Add commands:

```text
/voice devices
/voice device
/voice device default
/voice device <id-or-name>
```

Tool/platform handling:

- ffmpeg macOS: list `avfoundation` devices
- ffmpeg Windows: list `dshow` devices
- Linux: `arecord -l`, Pulse/PipeWire source detection
- sox: default input unless advanced handling is added

Priority: **High**

---

### 11. Insert Mode Options

Current behavior:

- empty editor → set transcript
- non-empty editor → append on a new line

Add configurable modes:

```text
replace
append-newline
append-space
insert-at-cursor
```

Commands:

```text
/voice insert-mode cursor
/voice insert-mode append
/voice insert-mode replace
```

Priority: **Medium-high**

---

### 12. Transcript History

Add recent transcript history.

Commands:

```text
/voice history
/voice history 5
/voice repeat
```

Useful if the user clears the input or wants to reuse a prior transcript.

Priority: **Low-medium**

---

### 13. Better Status States

Current statuses:

```text
🎤 ready
🎤 recording
🎤 transcribing
```

Potential additional states:

```text
🎤 setup needed
🎤 no mic
🎤 no kitty
🎤 endpoint error
🎤 disabled
```

Priority: **Medium**

---

## Phase 3 — Recording Quality

### 14. Pre-record During Hold Threshold

Current extension waits until the hold threshold passes before recording starts.

Problem:

- If the user starts speaking immediately, first words can be clipped.

Improvement:

- Start recording immediately on SPACE press.
- If released before threshold, discard audio and insert normal space.
- If threshold passes, keep recording and include the pre-recorded audio.

This is how `pi-listen` avoids missing the first word.

Priority: **High**

---

### 15. Tail Recording After Release

Keep recording briefly after SPACE release to avoid clipping the final word.

Suggested default:

```text
300–700ms
```

`pi-listen` uses a longer tail; ours can stay shorter for lower latency.

Priority: **Medium-high**

---

### 16. Audio Level Meter

Show live mic activity while recording.

Possible footer:

```text
🎤 recording ▂▄▆█
```

Possible above-editor widget:

```text
Voice recording... level: ███░░░░░
Release SPACE to transcribe.
```

Easier if recording is switched to raw PCM capture.

Priority: **Medium**

---

### 17. In-memory PCM Capture

Instead of writing temp WAV files during recording:

1. capture raw PCM into memory
2. wrap PCM into WAV bytes after stop
3. send buffer directly to STT endpoint

Benefits:

- simpler cleanup
- easier audio meter
- easier pre-roll/tail recording
- fewer temp-file edge cases

Priority: **Medium**

---

## Phase 4 — Optional Backend Expansion

### 18. Document Popular OpenAI-compatible STT Servers

Instead of bundling local models, document server setup recipes.

Potential docs:

- `speaches`
- `faster-whisper-server`
- `whisper.cpp` server
- `LocalAI`
- other OpenAI-compatible `/v1/audio/transcriptions` servers

Example:

```text
/voice endpoint http://localhost:8000/v1
/voice model Systran/faster-distil-whisper-large-v3
```

Priority: **High for publication**

---

### 19. Better OpenAI-compatible Endpoint Compatibility

Support more endpoint variants:

- `/v1/audio/transcriptions`
- `/audio/transcriptions`
- `/inference` for whisper.cpp-style APIs

Response parsing:

- `{ "text": "..." }`
- `{ "transcript": "..." }`
- plain text response

Suggested setting:

```ts
sttApiStyle: "openai" | "whispercpp" | "auto"
```

Priority: **Medium-high**

---

### 20. Optional Local Backend

Possible future backend choices:

#### Option A — external OpenAI-compatible only

Keep the current niche.

Pros:

- simple
- no heavyweight dependencies
- easy to maintain

Cons:

- requires user to run an STT server

#### Option B — Python `faster-whisper` bridge

Similar to `pi-extension-stt`.

Pros:

- fully local
- no external server

Cons:

- Python environment complexity
- model download/support burden

#### Option C — `sherpa-onnx-node`

Similar to `pi-listen`.

Pros:

- Node-native-ish
- offline models

Cons:

- native dependency/model management complexity

Recommendation:

> Keep ours external OpenAI-compatible only for the first public release.

Priority: **Low for now**

---

# Testing and Release Quality

## 21. Unit Tests

Suggested test coverage:

- config load/save
- endpoint URL validation
- loopback vs remote endpoint detection
- multipart STT request body generation
- audio tool detection with mocked PATH
- state machine:
  - short SPACE tap inserts one space
  - hold SPACE starts recording
  - release before ffmpeg startup completes
  - transcript inserted, not sent
  - disabled mode does not duplicate characters

Priority: **High**

---

## 22. CI

GitHub Actions:

```yaml
npm test
npm run typecheck
npm pack --dry-run
```

No real microphone tests needed in CI; use unit tests/mocks.

Priority: **Medium-high**

---

## 23. README

README should clearly explain:

- what the extension does
- what it does not do
- why it exists despite `pi-listen`
- quickstart
- endpoint examples
- commands
- settings
- security warning
- troubleshooting

Suggested tagline:

> Minimal hold-SPACE voice input for Pi using any OpenAI-compatible STT endpoint.

Priority: **Required before publishing**

---

# Recommended Implementation Order

## Short list

1. Persistent settings
2. Configurable endpoint/model/token/language
3. `/voice status`
4. `/voice doctor`
5. `/voice setup`
6. Audio fallback chain: `sox` → `ffmpeg` → `arecord`
7. Endpoint security warning for non-local URLs
8. `/voice test`
9. Microphone device listing/selection
10. npm package structure + README

## Later polish

11. `/voice-settings` interactive panel
12. insert-mode options
13. transcript history
14. pre-record during hold threshold
15. tail recording
16. audio level meter
17. in-memory PCM capture
18. endpoint compatibility fallback paths

---

# Strategic Note

There is already a strong, full-featured Pi voice extension in `@codexstar/pi-listen`.

This extension should avoid trying to become a second `pi-listen`. The best niche is:

> Tiny, dependable hold-SPACE voice input for users who already run their own OpenAI-compatible STT server.

That positioning makes the package easier to explain, easier to maintain, and still useful to people running local inference infrastructure.
