# Issues

## Bugs

### 1. `seed.ts:31` — `sampleName` broken for uppercase-extension files

```typescript
const ext = path.extname(file).toLowerCase()   // ".wav" for "kick.WAV"
const sampleName = path.basename(file, ext)     // path.basename("kick.WAV", ".wav") → "kick.WAV" not "kick"
```

`path.basename` does a case-sensitive suffix match. If a file has a `.WAV`, `.MP3`, or `.OGG` extension, the lowercase `ext` won't strip it, and the sample name will include the uppercase extension.

**Fix:** Lowercase the filename before calling `path.extname` and `path.basename`, so all processing is case-insensitive from the start.

---

### 2. `pipeline.ts:35–42` — JSON parse errors are retried, spec says they shouldn't be

`withRetry` wraps the entire `fetchJson` call including `res.json()`. If the Swarm content exists but isn't valid JSON, the parse fails on every attempt and is retried 3× needlessly. The spec says: "JSON parse error on AddSampleEvent → Log and skip — not retried."

**Fix:** Move the HTTP fetch into `withRetry` and parse JSON outside it. Catch `SyntaxError` separately and return early without retrying.

---

## Spec inconsistencies

### 3. `postageBatchId` in pipeline step 7 vs `ZERO_BATCH_ID` everywhere else

Pipeline step 7 reads `bee.uploadFile(postageBatchId, audioBytes, ...)` while step 9 explicitly says `ZERO_BATCH_ID`. The Swarm integration section only defines `ZERO_BATCH_ID`.

**Fix:** Update SPEC.md step 7 to use `ZERO_BATCH_ID` consistently.

---

### 4. `swarm.ts:21` — `(bee as any)` cast on `makeFeedWriter` is unnecessary

```typescript
export const feedWriter = (bee as any).makeFeedWriter(config.feedTopic, signer)
```

The bee-js v12.2.1 types declare `makeFeedWriter(topic: Topic | Uint8Array | string, signer?: PrivateKey | ...)` — exactly matching this call. The `as any` is not needed and will mask type errors from future bee-js API changes.

**Fix:** Remove the cast.

---

## Unclear / missing

### 5. Self-heal only triggers on the next event — no proactive retry

If the strudel.json upload or feed update fails and no new events arrive, the feed is permanently stale. There is no periodic re-upload.

**Decision:** Acceptable limitation.

---

### 6. `filePayloadHash` is not validated

The spec defines it as "64 hex chars — Swarm hash of audio file" but the code doesn't check length or character set. A malformed hash will hit Swarm, get a 404, retry 3×, and be logged — correct per the error table, but a format check would give a clearer error earlier.

**Fix:** Validate that `filePayloadHash` is exactly 64 lowercase hex characters before attempting to fetch. Log and skip if invalid.

---

### 7. Seed uploads have no retry — asymmetry with the processing pipeline is undocumented

The processing pipeline wraps all network steps in `withRetry`. Seed uploads are bare calls with no retry.

**Decision:** Intentional — no retry needed for seed.
