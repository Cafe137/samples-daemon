import { Bee, PrivateKey } from '@ethersphere/bee-js'
import { config } from './config.js'

const CONTENT_TYPES: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
}

export function contentTypeFromExt(ext: string): string {
    return CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream'
}

const ZERO_BATCH_ID = '0'.repeat(64)

export const bee = new Bee(config.gatewayUrl, { timeout: 60_000 })

const signer = new PrivateKey(config.feedSignerKey)

export const feedWriter = bee.makeFeedWriter(config.feedTopic, signer)

export async function uploadFile(
    data: Uint8Array,
    filename: string,
    contentType: string,
): Promise<string> {
    const result = await bee.uploadFile(ZERO_BATCH_ID, data, filename, { contentType })
    return result.reference.toString()
}

export async function uploadStrudelJson(state: Record<string, string>): Promise<string> {
    const bytes = new Uint8Array(Buffer.from(JSON.stringify(state, null, 2)))
    const result = await bee.uploadFile(ZERO_BATCH_ID, bytes, 'strudel.json', {
        contentType: 'application/json',
    })
    return result.reference.toString()
}

export async function updateFeed(reference: string): Promise<void> {
    await feedWriter.uploadReference(ZERO_BATCH_ID, reference)
}

export async function createFeedManifest(): Promise<string> {
    const ownerAddress = signer.publicKey().address()
    const reference = await bee.createFeedManifest(ZERO_BATCH_ID, config.feedTopic, ownerAddress)
    return reference.toString()
}
