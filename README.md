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

## License

MIT
