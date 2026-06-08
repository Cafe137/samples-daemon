import { writeFile } from 'fs/promises'
import path from 'path'
import { withRetry } from './retry.js'
import { config } from './config.js'
import { hasEntry, addEntry, getState } from './state.js'
import { uploadFile, uploadStrudelJson, updateFeed, contentTypeFromExt } from './swarm.js'

interface AddSampleEvent {
    type: string
    signature: string
    sampleName: string
    filename: string
    filePayloadHash: string
}

async function fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    return res.json()
}

async function fetchBytes(url: string): Promise<Uint8Array> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    return new Uint8Array(await res.arrayBuffer())
}

export async function processEvent(rawData: string): Promise<void> {
    // Step 1: strip 0x prefix
    const swarmHash = rawData.startsWith('0x') ? rawData.slice(2) : rawData

    // Step 2: fetch AddSampleEvent
    let event: AddSampleEvent
    try {
        event = await withRetry(
            `fetch event ${swarmHash}`,
            () => fetchJson(`${config.gatewayUrl}/bzz/${swarmHash}/`),
        ) as AddSampleEvent
    } catch (err) {
        console.error(`[${swarmHash}] Failed to fetch event JSON:`, err)
        return
    }

    // Step 3: validate type
    if (event.type !== 'add_sample') {
        console.warn(`[${swarmHash}] Unknown event type "${event.type}", skipping`)
        return
    }

    // Step 4: duplicate check
    if (hasEntry(event.sampleName)) {
        console.warn(`[${swarmHash}] Sample "${event.sampleName}" already exists, skipping`)
        return
    }

    console.log(`Processing sample "${event.sampleName}" (${event.filename})...`)

    // Step 5: fetch audio bytes
    let audioBytes: Uint8Array
    try {
        audioBytes = await withRetry(
            `fetch audio ${event.sampleName}`,
            () => fetchBytes(`${config.gatewayUrl}/bzz/${event.filePayloadHash}/`),
        )
    } catch (err) {
        console.error(`[${event.sampleName}] Failed to fetch audio:`, err)
        return
    }

    // Step 6: save audio to disk
    const ext = path.extname(event.filename)
    const localFilename = `${event.sampleName}-${Date.now()}${ext}`
    await writeFile(path.join('audio', localFilename), audioBytes)

    // Step 7: upload audio to Swarm
    const contentType = contentTypeFromExt(ext)
    let audioRef: string
    try {
        audioRef = await withRetry(
            `upload audio ${event.sampleName}`,
            () => uploadFile(audioBytes, event.filename, contentType),
        )
    } catch (err) {
        console.error(`[${event.sampleName}] Failed to upload audio to Swarm:`, err)
        return
    }

    // Step 8: commit to local state
    const audioUrl = `${config.gatewayUrl}/bzz/${audioRef}/`
    addEntry(event.sampleName, audioUrl)
    console.log(`[${event.sampleName}] Committed to local state → ${audioUrl}`)

    // Step 9: upload strudel.json
    let strudelRef: string
    try {
        strudelRef = await withRetry(
            `upload strudel.json (after ${event.sampleName})`,
            () => uploadStrudelJson(getState()),
        )
    } catch (err) {
        console.error(`[${event.sampleName}] Failed to upload strudel.json — will self-heal on next event:`, err)
        return
    }

    // Step 10: update feed
    try {
        await withRetry(
            `update feed (after ${event.sampleName})`,
            () => updateFeed(strudelRef),
        )
        console.log(`[${event.sampleName}] Feed updated → ${strudelRef}`)
    } catch (err) {
        console.error(`[${event.sampleName}] Failed to update feed — will self-heal on next event:`, err)
    }
}
