# Issues

## Bugs

### 1. `seed.ts:31` — `sampleName` broken for uppercase-extension files

```typescript
const ext = path.extname(file).toLowerCase()   // ".wav" for "kick.WAV"
const sampleName = path.basename(file, ext)     // path.basename("kick.WAV", ".wav") → "kick.WAV" not "kick"
```

`path.basename` does a case-sensitive suffix match. If a file has a `.WAV`, `.MP3`, or `.OGG` extension, the lowercase `ext` won't strip it, and the sample name will include the uppercase extension.

---

### 2. `pipeline.ts:35–42` — JSON parse errors are retried, spec says they shouldn't be

`withRetry` wraps the entire `fetchJson` call including `res.json()`. If the Swarm content exists but isn't valid JSON, the parse fails on every attempt and is retried 3× needlessly. The spec says: "JSON parse error on AddSampleEvent → Log and skip — not retried."

---

### 3. `.env.example:2` — Default `GATEWAY_URL` doesn't support uploads

`GATEWAY_URL=https://bzz.limo` is a public read-only gateway. The `Bee` client uses this URL for all `uploadFile` calls, which require a writable Bee node (e.g. `http://localhost:1633`). The example will cause all uploads to fail. The spec description says "used for both uploads (Bee node) and fetches/output URLs (e.g. `https://bzz.limo`)" — the parenthetical "Bee node" hints at this, but the example gives a read-only URL.

---

## Spec inconsistencies

### 4. `postageBatchId` in pipeline step 7 vs `ZERO_BATCH_ID` everywhere else

Pipeline step 7 reads `bee.uploadFile(postageBatchId, audioBytes, ...)` while step 9 explicitly says `ZERO_BATCH_ID`. The Swarm integration section only defines `ZERO_BATCH_ID`. It's ambiguous whether audio uploads should use a different postage batch or if `postageBatchId` is informal naming for `ZERO_BATCH_ID`. The implementation uses `ZERO_BATCH_ID` for both.

---

### 5. `swarm.ts:21` — `(bee as any)` cast on `makeFeedWriter` is unnecessary

```typescript
export const feedWriter = (bee as any).makeFeedWriter(config.feedTopic, signer)
```

The bee-js v12.2.1 types declare `makeFeedWriter(topic: Topic | Uint8Array | string, signer?: PrivateKey | ...)` — exactly matching this call. The `as any` is not needed and will mask type errors from future bee-js API changes.

---

## Unclear / missing

### 6. Self-heal only triggers on the next event — no proactive retry

If the strudel.json upload or feed update fails and no new events arrive, the feed is permanently stale. There is no periodic re-upload. This is per-spec, but is a silent operational gap if events stop or are infrequent.

---

### 7. `filePayloadHash` is not validated

The spec defines it as "64 hex chars — Swarm hash of audio file" but the code doesn't check length or character set. A malformed hash will hit Swarm, get a 404, retry 3×, and be logged — correct per the error table, but a format check would give a clearer error earlier.

---

### 8. Seed uploads have no retry — asymmetry with the processing pipeline is undocumented

The processing pipeline wraps all network steps in `withRetry`. Seed uploads are bare calls with no retry. The spec says "if any upload fails, abort startup" without mentioning retry, so the asymmetry is likely intentional, but it is not documented anywhere.
