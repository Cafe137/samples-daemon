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
| `GATEWAY_URL`      | Yes      | —                              | Swarm gateway URL — used for both uploads (Bee node) and fetches/output URLs (e.g. `https://bzz.limo`) |
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
    "_base": "https://bzz.limo",
    "kick": "/bzz/<reference>/",
    "snare": "/bzz/<reference>/"
}
```

`_base` is always set to `https://bzz.limo`. Sample entries are relative paths under that base. The app owns the entire file from first creation.

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

## Startup initialisation

On every startup, before the cold-start/seed step, the service calls `bee.createFeedManifest(ZERO_BATCH_ID, FEED_TOPIC, ownerAddress)` where `ownerAddress` is derived from the feed signer key (`signer.publicKey().address()`). The returned reference is printed to stdout:

```
Feed manifest address: <reference>
```

This manifest is a stable Swarm content-addressed chunk that resolves to the latest feed update, allowing anyone to fetch the current `strudel.json` via `GET /bzz/<feed-manifest-hash>/`. The manifest hash is deterministic for a given topic and owner — calling `createFeedManifest` multiple times is idempotent (the hash does not change). If the call fails, the error propagates and startup aborts.

---

## Cold-start / seed

On startup, before beginning the polling loop, the service loads its local `strudel.json` state file if present. If the file is absent (first run), the service performs a one-time seed. If the `seed/` directory does not exist, or exists but contains no `.wav`/`.mp3`/`.ogg` files, abort startup entirely.

1. Read all audio files from the `seed/` directory (`.wav`, `.mp3`, `.ogg`)
2. Upload every file via `bee.uploadFile(ZERO_BATCH_ID, fileBytes, filename, { contentType })` — content type derived from extension. If any upload fails, abort startup entirely
3. Build an initial state object with `_base` set to `https://bzz.limo` and one entry per file: `sampleName` (filename without extension) → `/bzz/<reference>/`
4. Upload `strudel.json` to Swarm via `bee.uploadFile(ZERO_BATCH_ID, jsonBytes, 'strudel.json', { contentType: 'application/json' })`. If this fails, abort startup
5. Write the feed once via `feedWriter.upload(ZERO_BATCH_ID, strudelJsonReference)`. If this fails, abort startup
6. Persist state to local `strudel.json` — only reached if all of the above succeeded

Seeding is all-or-nothing: the local `strudel.json` is written only after every upload and the feed write have succeeded. If any step fails, ensure no local `strudel.json` exists before exiting — so the next startup re-enters the full seed. Seed uploads are not retried; any failure aborts immediately.

If the local `strudel.json` file exists, the seed step is skipped and the state is loaded from it.

---

## Processing pipeline (per `Notification` event)

Events are processed **strictly sequentially** — the next event is not started until the current one completes or is skipped.

Network steps retry up to **3 times** with exponential backoff before giving up.

**Self-healing:** local state is committed as soon as audio is safely on Swarm (step 9), before the strudel.json upload and feed update. If either of those later steps fails, the entry is already in local state. The next event processed will upload a strudel.json that includes all previously committed entries, and update the feed — automatically catching up any missed updates without manual intervention. There is no proactive or periodic retry; the feed is only brought current when the next event arrives.

1. Extract `data` from the event — this is a `bytes32` value treated as a Swarm hash; strip the `0x` prefix before use in URLs
2. Fetch `<GATEWAY_URL>/bzz/<data>/` — parse response body as JSON → `AddSampleEvent`
3. Validate `type === 'add_sample'`; skip with a warning if not
4. Validate that `filePayloadHash` is exactly 64 lowercase hex characters; if not, log a warning and skip
5. Check that `sampleName` does not already exist in the in-memory state; if it does, log a warning and skip — do not overwrite
6. Fetch `<GATEWAY_URL>/bzz/<filePayloadHash>/` — audio file
7. Derive file extension from `filename` field (e.g. `.wav`, `.mp3`, `.ogg`); save audio file to `audio/<sampleName>-<unixMillis>.<ext>` — timestamped filename ensures uniqueness across retries
8. Upload audio to Swarm via `bee.uploadFile(ZERO_BATCH_ID, audioBytes, filename, { contentType })` — `audioBytes` are the bytes already in memory from step 6; content type derived from extension (`.wav` → `audio/wav`, `.mp3` → `audio/mpeg`, `.ogg` → `audio/ogg`); returns a reference. If all retries fail: log error and skip remaining steps — file remains on disk for manual recovery
9. Add entry to in-memory state: `state[sampleName] = "/bzz/<reference>/"` and persist to local `strudel.json` — audio is on Swarm at this point, so it is safe to commit
10. Upload `strudel.json` to Swarm via `bee.uploadFile(ZERO_BATCH_ID, jsonBytes, 'strudel.json', { contentType: 'application/json' })`. If all retries fail: log and skip remaining steps — local state is already updated and will be included in the next event's upload
11. Update feed via `feedWriter.upload(ZERO_BATCH_ID, newStrudelJsonReference)`. If all retries fail: log — local state is already updated and the feed will be brought current on the next successful update

---

## Swarm integration

Library: `@ethersphere/bee-js` v12.2.1

```typescript
import { Bee, PrivateKey } from '@ethersphere/bee-js'

const bee = new Bee(process.env.GATEWAY_URL)

// FEED_SIGNER_KEY accepted with or without 0x prefix
const signer = new PrivateKey(process.env.FEED_SIGNER_KEY)

// Feed writer (no reader needed — state is maintained locally)
const feedWriter = bee.makeFeedWriter(FEED_TOPIC, signer)

// Use uploadReference (not the deprecated upload) to write a Swarm reference into the feed

// Postage batch ID is not required when uploading via a gateway
const ZERO_BATCH_ID = '0'.repeat(64)
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
| Invalid `filePayloadHash` (not 64 hex)  | Log and skip — not retried                              |
| Duplicate `sampleName` in strudel.json  | Log and skip — not retried                              |
| RPC poll error                          | Log, do not advance `last-block.txt`, retry next tick   |
| `seed/` directory absent or empty at startup | Log and abort startup — do not begin polling       |
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
