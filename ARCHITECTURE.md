# System Architecture

## Overview

Two services collaborate to let users add audio samples to a community sound bank without needing a wallet or gas.

- **notify-pro-bono** — a funded HTTP relay that accepts a Swarm hash and broadcasts it on-chain
- **samples-manager** — a blockchain listener that processes on-chain events and maintains the `strudel.json` sound bank

---

## End-to-end flow

```
User
  │
  ├─1─▶ Upload audio file to Swarm via bzz.limo
  │       └─ receives filePayloadHash (64 hex chars)
  │
  ├─2─▶ Construct AddSampleEvent JSON, upload to Swarm via bzz.limo
  │       └─ receives eventHash (64 hex chars)
  │
  └─3─▶ POST https://outbox.wtf/notify  { "data": "<eventHash>" }
            │
            ├─ notify-pro-bono validates content at bzz.limo/bytes/<eventHash>
            │   (must be JSON object with non-empty "signature" and "type" fields)
            │
            └─ calls notify(bytes32) on Gnosis contract — pays gas on user's behalf
                        │
                        ▼
              Notification(bytes32 data) event emitted on Gnosis Chain
                        │
                        ▼
              samples-manager polls for event (every 5 s)
                        │
                        ├─ fetches AddSampleEvent JSON from bzz.limo/bzz/<eventHash>/
                        ├─ validates type === 'add_sample'
                        ├─ fetches audio from bzz.limo/bzz/<filePayloadHash>/
                        ├─ re-uploads audio to Swarm (restamping)
                        ├─ adds entry to strudel.json
                        ├─ uploads updated strudel.json to Swarm
                        └─ updates Swarm feed to new strudel.json reference
```

---

## Shared contract

Both services target the same contract on Gnosis Chain:

- **Address:** `0x5cDb55a64D5D5d8754398448D5a0e01098a57438`
- **Deployment block:** `46507870`
- **Interface:** `event Notification(bytes32 indexed data)` / `function notify(bytes32 data)`

---

## AddSampleEvent schema

The JSON uploaded to Swarm (step 2) must conform to:

```ts
{
  type: 'add_sample'       // required by samples-manager
  signature: string        // required (non-empty) by notify-pro-bono; ignored by samples-manager
  sampleName: string       // e.g. "kick" — becomes the key in strudel.json
  filename: string         // e.g. "kick.wav" — used to derive content-type
  filePayloadHash: string  // 64 hex chars — Swarm hash of the audio file
}
```

---

## Division of responsibility

| Concern | notify-pro-bono | samples-manager |
|---|---|---|
| Gas / wallet | Owns a funded wallet, pays gas | None |
| Content validation | Checks `signature` + `type` exist | Full schema validation |
| Spam / rate limiting | 10 req/min global sliding window | Deduplicates by `sampleName` |
| Swarm interaction | Fetches via `/bytes/<hash>` (raw) | Fetches via `/bzz/<hash>/` (manifest), uploads via bee-js |
| Chain interaction | Writes (`notify`) | Reads (`Notification` events) |

---

## Key design properties

- **Walletless UX** — users need only an HTTP client; notify-pro-bono absorbs all on-chain costs.
- **Decoupled by the chain** — the two services share no runtime dependency; the blockchain event is the only handoff.
- **Domain logic stays in samples-manager** — notify-pro-bono has no knowledge of `AddSampleEvent`; it validates only the minimum required to prevent trivially invalid broadcasts.
- **Self-healing state** — samples-manager commits audio to local state as soon as it is safely on Swarm, before updating the feed. A failed feed update is automatically recovered when the next event arrives.
