import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { uploadFile, uploadStrudelJson, updateFeed, contentTypeFromExt } from './swarm.js'
import { config } from './config.js'
import { setState, persistState, deleteStateFile } from './state.js'
import type { State } from './state.js'

const SEED_DIR = 'seed'
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg'])

export async function runSeed(): Promise<void> {
    if (!existsSync(SEED_DIR)) {
        throw new Error('seed/ directory is required for first-run seed but was not found')
    }

    const files = await readdir(SEED_DIR)
    const audioFiles = files.filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))

    if (audioFiles.length === 0) {
        throw new Error('seed/ directory contains no .wav/.mp3/.ogg files')
    }

    console.log(`Seeding ${audioFiles.length} file(s) from ${SEED_DIR}/...`)

    const newState: State = {}

    try {
        for (const originalFile of audioFiles) {
            const file = originalFile.toLowerCase()
            const ext = path.extname(file)
            const sampleName = path.basename(file, ext)
            const contentType = contentTypeFromExt(ext)
            const bytes = new Uint8Array(await readFile(path.join(SEED_DIR, originalFile)))

            console.log(`  Uploading ${file}...`)
            const ref = await uploadFile(bytes, file, contentType)
            newState[sampleName] = `${config.gatewayUrl}/bzz/${ref}/`
            console.log(`  ${file} → ${ref}`)
        }

        console.log('Uploading strudel.json...')
        const strudelRef = await uploadStrudelJson(newState)
        console.log(`strudel.json → ${strudelRef}`)

        console.log('Writing feed...')
        await updateFeed(strudelRef)

        setState(newState)
        persistState()
        console.log('Seed complete.')
    } catch (err) {
        deleteStateFile()
        throw err
    }
}
