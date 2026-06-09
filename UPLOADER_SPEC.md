# Sample Uploader UI — Specification

## Purpose

A single self-contained HTML file embedded as an `<iframe>` inside the Strudel fork. It guides the user through the full upload flow — no wallet, no build step, no dependencies.

---

## User flow

```
User selects audio file + enters sample name
        │
        ▼
Step 1 — Upload audio to Swarm
  POST https://bzz.limo/bzz
  Content-Type: audio/wav (or audio/mpeg, audio/ogg)
  Content-Disposition: inline; filename="<original filename>"
  Swarm-Postage-Batch-Id: 0000...000 (64 zeros)
  Body: raw audio bytes
        │
        └─▶ response JSON: { "reference": "<filePayloadHash>" }
        │
        ▼
Step 2 — Upload AddSampleEvent JSON to Swarm
  POST https://bzz.limo/bytes
  Content-Type: application/json
  Swarm-Postage-Batch-Id: 0000...000 (64 zeros)
  Body: AddSampleEvent JSON (see schema below)
        │
        └─▶ response JSON: { "reference": "<eventHash>" }
        │
        ▼
Step 3 — Broadcast on-chain via notify-pro-bono
  POST https://outbox.wtf/notify
  Content-Type: application/json
  Body: { "data": "<eventHash>" }
        │
        └─▶ response JSON: { "hash": "<txHash>" }
        │
        ▼
Show success — transaction hash + link
```

---

## AddSampleEvent schema (step 2 body)

```json
{
  "type": "add_sample",
  "signature": "unsigned",
  "sampleName": "<user-entered name>",
  "filename": "<original filename from file input>",
  "filePayloadHash": "<reference from step 1>"
}
```

`signature` is required to be a non-empty string by notify-pro-bono; it is ignored by samples-manager. Use the placeholder `"unsigned"` for now.

---

## UI

A minimal single-page form. No external CSS or JS frameworks.

### Inputs

| Field | Type | Validation |
|---|---|---|
| Audio file | `<input type="file" accept=".wav,.mp3,.ogg">` | Required; `.wav`, `.mp3`, `.ogg` only |
| Sample name | `<input type="text">` | Required; lowercase letters, digits, hyphens only (`/^[a-z0-9-]+$/`); max 32 chars |

### States

- **Idle** — form ready for input
- **Uploading audio** — progress message: `Uploading audio to Swarm…`
- **Uploading event** — progress message: `Uploading event to Swarm…`
- **Broadcasting** — progress message: `Broadcasting on-chain… (this may take ~10 s)`
- **Success** — show transaction hash with a link to `https://gnosisscan.io/tx/<hash>`
- **Error** — show a human-readable error message; re-enable the form so the user can retry

### Layout

Compact — designed for iframe embedding. No scrollbars at normal content sizes. The submit button is disabled while any step is in progress.

---

## Error handling

| Condition | Message shown |
|---|---|
| File type not accepted | `Only .wav, .mp3, and .ogg files are supported.` |
| Sample name invalid | `Sample name must be lowercase letters, digits, or hyphens only.` |
| Audio upload fails (non-2xx) | `Audio upload failed (HTTP <status>). Please try again.` |
| Event JSON upload fails (non-2xx) | `Event upload failed (HTTP <status>). Please try again.` |
| outbox.wtf 429 | `Too many submissions right now. Please wait a minute and try again.` |
| outbox.wtf 4xx | `Submission rejected: <message from response>.` |
| outbox.wtf 5xx / network error | `Broadcast failed. Please try again.` |

On any error the form is re-enabled so the user can retry without reloading the page.

---

## Implementation notes

- **Single `.html` file** — inline `<style>` and `<script>`, no external resources, no build step.
- **Vanilla JS** — `fetch`, `FileReader` (or `arrayBuffer()`), standard DOM APIs only.
- **iframe sizing** — set `box-sizing: border-box`, `margin: 0`, and a fixed or `min-height` on `<body>` so the parent can embed it at a known size.
- **CORS** — all three upstream endpoints (`bzz.limo`, `outbox.wtf`) must allow cross-origin requests from the Strudel origin. Verify before shipping; no workaround is available from a plain HTML page.

---

## Required change in samples-manager

notify-pro-bono fetches the event JSON via `GET https://bzz.limo/bytes/<hash>` (raw endpoint).
samples-manager currently fetches it via `GET <GATEWAY_URL>/bzz/<hash>/` (manifest endpoint).

Because the event JSON is uploaded via `POST /bytes` (step 2 above), the `/bzz/` fetch in samples-manager will not return the JSON — it will return Swarm manifest bytes instead.

**Fix:** in `src/pipeline.ts` (or wherever step 2 of the processing pipeline is implemented), change the fetch URL for the `AddSampleEvent` from `/bzz/<data>/` to `/bytes/<data>`.
