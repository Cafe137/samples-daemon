import { mkdirSync } from 'fs'
import { loadState } from './state.js'
import { runSeed } from './seed.js'
import { processEvent } from './pipeline.js'
import { startPolling } from './indexer.js'

async function main(): Promise<void> {
    mkdirSync('audio', { recursive: true })

    const hasState = loadState()
    if (!hasState) {
        console.log('No strudel.json found — running seed.')
        try {
            await runSeed()
        } catch (err) {
            console.error('Seed failed, aborting startup:', err)
            process.exit(1)
        }
    } else {
        console.log('Loaded existing strudel.json.')
    }

    await startPolling(processEvent)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
