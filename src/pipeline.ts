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

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    return res.text()
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
    let eventText: string
    try {
        eventText = await withRetry(
            `fetch event ${swarmHash}`,
            () => fetchText(`${config.gatewayUrl}/bzz/${swarmHash}/`),
        )
    } catch (err) {
        console.error(`[${swarmHash}] Failed to fetch event:`, err)
        return
    }

    let event: AddSampleEvent
    try {
        event = JSON.parse(eventText) as AddSampleEvent
    } catch (err) {
        console.error(`[${swarmHash}] Invalid JSON in event, skipping:`, err)
        return
    }

    // Step 3: validate type
    if (event.type !== 'add_sample') {
        console.warn(`[${swarmHash}] Unknown event type "${event.type}", skipping`)
        return
    }

    // Step 4: validate filePayloadHash
    if (!/^[0-9a-f]{64}$/.test(event.filePayloadHash)) {
        console.warn(`[${swarmHash}] Invalid filePayloadHash "${event.filePayloadHash}", skipping`)
        return
    }

    // Step 5: duplicate check
    if (hasEntry(event.sampleName)) {
        console.warn(`[${swarmHash}] Sample "${event.sampleName}" already exists, skipping`)
        return
    }

    console.log(`Processing sample "${event.sampleName}" (${event.filename})...`)

    // Step 6: fetch audio bytes
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

    // Step 7: save audio to disk
    const ext = path.extname(event.filename)
    const localFilename = `${event.sampleName}-${Date.now()}${ext}`
    await writeFile(path.join('audio', localFilename), audioBytes)

    // Step 8: upload audio to Swarm
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

    // Step 9: commit to local state
    const audioUrl = `/bzz/${audioRef}/`
    addEntry(event.sampleName, audioUrl)
    console.log(`[${event.sampleName}] Committed to local state → ${audioUrl}`)

    // Step 10: upload strudel.json
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

    // Step 11: update feed
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
