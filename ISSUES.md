# Issues

## Bugs

### 1. `pipeline.ts:87` — `writeFile` unhandled, breaks block tracking

```ts
await writeFile(path.join('audio', localFilename), audioBytes)
```

No try/catch around this line. If it throws (disk full, permission denied), the exception propagates out of `processEvent` and is caught by `indexer.ts:74` as a generic "RPC poll error". This prevents `writeLastBlock` from being called, so the entire block range is reprocessed on the next tick. The event could then be reprocessed before the disk issue is resolved, potentially uploading duplicate audio to Swarm. The spec's error table doesn't address disk write failure at all.

### 2. `seed.ts:30–37` — lowercased filenames uploaded but spec doesn't say to

```ts
const file = originalFile.toLowerCase()
...
const ref = await uploadFile(bytes, file, contentType)
```

The seed lowercases the filename before uploading and derives `sampleName` from the lowercased stem. The processing pipeline (`pipeline.ts:95`) uploads with `event.filename` (original case). These are inconsistent. If a seed file is `Kick.WAV` it gets sampleName `kick` and is uploaded as `kick.wav`; meanwhile a future on-chain event could submit `Kick.WAV` with sampleName `Kick`, which wouldn't be detected as a duplicate and would create a parallel `Kick` entry. The spec doesn't mention lowercasing in the seed step.

---

## Inconsistencies vs. the Spec

### 3. `.env.example:2` — `GATEWAY_URL` set to a read-only public gateway

```
GATEWAY_URL=https://bzz.limo
```

The spec says this URL is used for **both uploads (Bee node) and fetches**. `bzz.limo` is a public read-only gateway — uploads via `bee.uploadFile` against it will fail. The example should point to a local/writable Bee node (e.g. `http://localhost:1633`), not a read-only CDN.

### 4. `seed.ts:49` — in-memory state set before file is persisted

```ts
setState(newState)
persistState()
```

If `persistState()` throws, in-memory state is already set to `newState` but `deleteStateFile()` is called in the catch. The next startup will re-enter seed because the file is gone — correct per spec. But the ordering is fragile: the spec says "Persist state to local strudel.json — only reached if all of the above succeeded", implying the file write is the final confirmation. Flipping to persist-then-setState would be safer.

---

## Spec Gaps / Unclear Parts

### 5. Spec is silent on disk write failure in step 7

The error table covers Swarm fetch/upload failures, JSON errors, duplicates, and RPC errors — but not a local disk write failure. It's unclear whether a disk write failure should be treated as a fatal abort or a skippable error (leaving no local file but still uploading to Swarm).

### 6. `indexer.ts:68` — silently drops events where `log.args.data` is falsy

```ts
if (log.args.data) {
    await processEvent(log.args.data)
}
```

If `log.args.data` is `undefined` or `null` (e.g. ABI parse oddity), the event is silently dropped with no log. At minimum a warning log would be useful.

### 7. Stale feed if no new events arrive

The spec says (pipeline step 11): "the feed will be brought current on the next successful update." There is no proactive or periodic catch-up. If a strudel.json upload or feed update fails and no new `Notification` events ever arrive, the feed stays stale indefinitely. The spec acknowledges this ("There is no proactive or periodic retry") but it is an important operational consideration.
