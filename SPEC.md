# Samples Manager — Specification

## Overview

Samples Manager is a Node.js service that maintains a Swarm feed resolving to a `strudel.json` file — the central sound bank for a community-extended fork of Strudel. Users submit new samples by emitting on-chain events; this service detects those events, retrieves and re-uploads the audio to Swarm ("restamping"), then updates the sound bank manifest.

---

## High-level flow

```
Gnosis chain
  └─ Notification(bytes32 data)
        │
        ▼
  data = Swarm hash of AddSampleEvent JSON
        │
        ▼
  Fetch AddSampleEvent from Swarm gateway (/bzz/<hash>/)
        │
        ▼
  Fetch audio from Swarm gateway (/bzz/<filePayloadHash>/)
        │
        ▼
  Save audio to local disk (audio/<sampleName>-<millis>.<ext>)
        │
        ▼
  Re-upload audio to Swarm via bee-js as a file (preserves filename and content-type)
        │
        ▼
  Commit entry to in-memory state + persist local strudel.json
        │
        ▼
  Upload updated strudel.json to Swarm
  Update feed to new strudel.json reference
```

---

## Environment configuration

All configuration comes from a `.env` file (or environment variables):

| Variable           | Required | Default                        | Description                                |
|--------------------|----------|--------------------------------|--------------------------------------------|
| `RPC_URL`          | No       | `https://rpc.gnosischain.com`  | Gnosis chain RPC endpoint                  |
| `BEE_URL`          | Yes      | —                              | Bee node URL for uploads (e.g. `http://localhost:1633`) |
| `GATEWAY_URL`      | No       | `https://bzz.limo`             | Swarm gateway for fetches and output URLs  |
| `POSTAGE_BATCH_ID` | Yes      | —                              | Swarm postage stamp batch ID for uploads   |
| `FEED_SIGNER_KEY`  | Yes      | —                              | Private key (hex) used to sign feed updates — `0x` prefix optional |
| `FEED_TOPIC`       | Yes      | —                              | Feed topic string                          |

---

## Data formats

### `AddSampleEvent` (fetched from Swarm)

```typescript
interface AddSampleEvent {
    type: 'add_sample'
    signature: string        // ignored for now
    sampleName: string       // e.g. "kick", "snare"
    filename: string         // e.g. "kick.wav", "snare.wav"
    filePayloadHash: string  // 64 hex chars — Swarm hash of audio file
}
```

Only events with `type === 'add_sample'` are processed. Others are logged and skipped.

### `strudel.json`

```json
{
    "kick": "https://bzz.limo/bzz/<reference>/",
    "snare": "https://bzz.limo/bzz/<reference>/"
}
```

All entries are absolute URLs: `<GATEWAY_URL>/bzz/<reference>/`. The app owns the entire file from first creation — there is no `_base` field or pre-existing content.

---

## Blockchain indexer

- **Chain:** Gnosis
- **Contract:** `0x5cDb55a64D5D5d8754398448D5a0e01098a57438`
- **Event ABI:** `event Notification(bytes32 indexed data)`
- **Start block:** `46507870` (deployment block, used only when `last-block.txt` is absent)
- **Poll interval:** 5 seconds
- **Block range per poll:** 1000 blocks

### Block persistence

- `last-block.txt` stores the next block to process (a single integer, no newline required)
- Written **after** a block range is successfully processed (not before)
- On startup: read from file if present, otherwise use deployment block

---

## Cold-start / seed

On startup, before beginning the polling loop, the service loads its local `strudel.json` state file if present. If the file is absent (first run), the service performs a one-time seed:

1. Read all audio files from the `seed/` directory (`.wav`, `.mp3`, `.ogg`)
2. Upload every file via `bee.uploadFile(postageBatchId, fileBytes, filename, { contentType })` — content type derived from extension. If any upload fails, abort startup entirely
3. Build an initial state object with one entry per file: `sampleName` (filename without extension) → `<GATEWAY_URL>/bzz/<reference>/`
4. Upload `strudel.json` to Swarm via `bee.uploadFile(postageBatchId, jsonBytes, 'strudel.json', { contentType: 'application/json' })`. If this fails, abort startup
5. Write the feed once via `feedWriter.upload(postageBatchId, strudelJsonReference)`. If this fails, abort startup
6. Persist state to local `strudel.json` — only reached if all of the above succeeded

Seeding is all-or-nothing: the local `strudel.json` is written only after every upload and the feed write have succeeded. If any step fails, ensure no local `strudel.json` exists before exiting — so the next startup re-enters the full seed.

If the local `strudel.json` file exists, the seed step is skipped and the state is loaded from it.

---

## Processing pipeline (per `Notification` event)

Events are processed **strictly sequentially** — the next event is not started until the current one completes or is skipped.

Network steps retry up to **3 times** with exponential backoff before giving up.

**Self-healing:** local state is committed as soon as audio is safely on Swarm (step 8), before the strudel.json upload and feed update. If either of those later steps fails, the entry is already in local state. The next event processed will upload a strudel.json that includes all previously committed entries, and update the feed — automatically catching up any missed updates without manual intervention.

1. Extract `data` from the event — this is a `bytes32` value treated as a Swarm hash; strip the `0x` prefix before use in URLs
2. Fetch `<GATEWAY_URL>/bzz/<data>/` — parse response body as JSON → `AddSampleEvent`
3. Validate `type === 'add_sample'`; skip with a warning if not
4. Check that `sampleName` does not already exist in the in-memory state; if it does, log a warning and skip — do not overwrite
5. Fetch `<GATEWAY_URL>/bzz/<filePayloadHash>/` — audio file
6. Derive file extension from `filename` field (e.g. `.wav`, `.mp3`, `.ogg`); save audio file to `audio/<sampleName>-<unixMillis>.<ext>` — timestamped filename ensures uniqueness across retries
7. Upload audio to Swarm via `bee.uploadFile(postageBatchId, audioBytes, filename, { contentType })` — `audioBytes` are the bytes already in memory from step 5; content type derived from extension (`.wav` → `audio/wav`, `.mp3` → `audio/mpeg`, `.ogg` → `audio/ogg`); returns a reference. If all retries fail: log error and skip remaining steps — file remains on disk for manual recovery
8. Add entry to in-memory state: `state[sampleName] = "<GATEWAY_URL>/bzz/<reference>/"` and persist to local `strudel.json` — audio is on Swarm at this point, so it is safe to commit
9. Upload `strudel.json` to Swarm via `bee.uploadFile(postageBatchId, jsonBytes, 'strudel.json', { contentType: 'application/json' })`. If all retries fail: log and skip remaining steps — local state is already updated and will be included in the next event's upload
10. Update feed via `feedWriter.upload(postageBatchId, newStrudelJsonReference)`. If all retries fail: log — local state is already updated and the feed will be brought current on the next successful update

---

## Swarm integration

Library: `@ethersphere/bee-js` v12.2.1

```typescript
import { Bee, PrivateKey } from '@ethersphere/bee-js'

const bee = new Bee(process.env.BEE_URL)

// FEED_SIGNER_KEY accepted with or without 0x prefix
const signer = new PrivateKey(process.env.FEED_SIGNER_KEY)

// Feed writer (no reader needed — state is maintained locally)
const feedWriter = bee.makeFeedWriter(FEED_TOPIC, signer)
```

All gateway fetches (steps 2 and 5 in the processing pipeline) use plain `fetch()` against `GATEWAY_URL` via the `/bzz/` endpoint — not the Bee node — to avoid depending on the local node having the data.

---

## Error handling

| Failure scenario                        | Behaviour                                               |
|-----------------------------------------|---------------------------------------------------------|
| Swarm fetch fails (network/404)         | Retry up to 3×, then log and skip event                 |
| Audio upload to Swarm fails             | Retry up to 3×, then log and skip remaining steps — `audio/<sampleName>-<millis>.<ext>` remains on disk for manual recovery |
| strudel.json upload fails               | Retry up to 3×, then log and skip remaining steps — local state already committed, self-heals on next event |
| Feed update fails                       | Retry up to 3×, then log — local state already committed, feed self-heals on next successful update |
| JSON parse error on `AddSampleEvent`    | Log and skip — not retried                              |
| Unknown event type (not `add_sample`)   | Log and skip — not retried                              |
| Duplicate `sampleName` in strudel.json  | Log and skip — not retried                              |
| RPC poll error                          | Log, do not advance `last-block.txt`, retry next tick   |
| Seed upload fails                       | Log and abort startup — do not begin polling            |

---

## Dependencies

- `viem` — Gnosis chain RPC / event polling
- `@ethersphere/bee-js` v12.2.1 — Swarm uploads and feed management
- `dotenv` — `.env` loading

---

## Non-goals (out of scope)

- Signature verification on `AddSampleEvent`
- Any HTTP API or UI
- Docker / process supervision (run manually in a `screen` session)
