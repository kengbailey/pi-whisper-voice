# pi-whisper-voice

Minimal hold-SPACE voice input for [Pi](https://pi.dev/) using an OpenAI-compatible Whisper/STT endpoint.

Hold `SPACE` to record, release to transcribe, and the transcript is inserted into Pi's editor for review. It does **not** auto-send the message; edit the text and submit manually when ready.

## Features

- Hold `SPACE` push-to-talk inside Pi
- Local microphone capture via `ffmpeg`
- OpenAI-compatible STT endpoint: `POST /v1/audio/transcriptions`
- Transcript inserted into the editor for review/editing
- Persistent footer state: `🎤 ready`, `🎤 recording`, `🎤 transcribing`
- No cloud-provider lock-in
- No fallback shortcut or global daemon

## Current requirements

- Pi coding agent
- A terminal/session with Kitty keyboard protocol key-release support
- `ffmpeg` installed and microphone permission granted
- An OpenAI-compatible transcription server

Example STT endpoint shape:

```http
POST http://localhost:8000/v1/audio/transcriptions
Authorization: Bearer dummy
Content-Type: multipart/form-data
```

Response:

```json
{ "text": "transcribed text" }
```

## Install from GitHub

After this repository is pushed, install with:

```bash
pi install git:github.com/kengbailey/pi-whisper-voice
```

Or test without installing:

```bash
pi -e git:github.com/kengbailey/pi-whisper-voice
```

## Local development install

This repository can also be loaded directly from disk:

```bash
pi -e /path/to/pi-whisper-voice
```

For global auto-discovery during local development, place it at:

```text
~/.pi/agent/extensions/pi-whisper-voice/
```

## Usage

Start Pi. If the terminal supports Kitty keyboard protocol, the footer should show:

```text
🎤 ready
```

Then:

1. Hold `SPACE` until recording starts.
2. Speak.
3. Release `SPACE`.
4. Wait for `🎤 transcribing` to finish.
5. Review/edit the transcript inserted in the editor.
6. Send manually when ready.

Toggle voice input:

```text
/voice
```

## Current defaults

These are currently hard-coded and will become settings in a future release:

```ts
sttBaseUrl: "http://192.168.8.116:8000/v1"
sttModel: "Systran/faster-distil-whisper-large-v3"
sttToken: "dummy"
language: "en"
sampleRate: 16000
holdThresholdMs: 1200
typingCooldownMs: 400
sttTimeoutMs: 120000
```

## Limitations

This is intentionally small right now.

Known limitations:

- macOS-oriented `ffmpeg` capture path today
- no settings panel yet
- no `/voice doctor` diagnostics yet
- no audio tool fallback yet (`sox`, `arecord` planned)
- no microphone device picker yet
- no pre-record/tail-record buffer yet
- no npm release yet

See [`ROADMAP.md`](./ROADMAP.md) for the upgrade backlog.

## Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run check
npm test
npm run ci
```

The test suite avoids real microphone/STT dependencies. Hardware and local STT server behavior should be validated manually.

## Security note

Microphone audio is sent to the configured STT endpoint. Prefer localhost/private trusted endpoints, and review your configuration before recording sensitive content.

## License

MIT
