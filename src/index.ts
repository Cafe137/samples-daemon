import { mkdirSync, readdirSync } from 'fs'
import { config } from './config.js'
import { countSamples, getState, loadState } from './state.js'
import { runSeed } from './seed.js'
import { processEvent } from './pipeline.js'
import { startPolling } from './indexer.js'
import { createFeedManifest, downloadFeedState } from './swarm.js'
import { fail, serveKpis, set } from './eye.js'
import { kpis, report } from './kpis.js'

const _log = console.log.bind(console)
const _error = console.error.bind(console)
console.log = (...args: unknown[]) => _log(new Date().toISOString(), ...args)
console.error = (...args: unknown[]) => _error(new Date().toISOString(), ...args)

function findNewestSample(): void {
    let newest = 0
    let name = ''
    for (const file of readdirSync('audio')) {
        const dash = file.lastIndexOf('-')
        const dot = file.lastIndexOf('.')
        const millis = Number(file.slice(dash + 1, dot > dash ? dot : file.length))
        if (millis > newest) {
            newest = millis
            name = file.slice(0, dash)
        }
    }
    if (newest === 0) return
    set(kpis.lastSampleAt, Math.floor(newest / 1000))
    set(kpis.lastSample, name)
}

async function readPublishedFeed(): Promise<void> {
    try {
        const feed = await downloadFeedState()
        set(kpis.feedReference, feed.reference)
        set(kpis.feedSamples, countSamples(feed.state))
    } catch (err) {
        set(kpis.feedSamples, null)
        fail(kpis.feedError, err, 'read published feed')
        console.error('Failed to read published feed:', err)
    }
}

async function main(): Promise<void> {
    mkdirSync('audio', { recursive: true })

    const feedManifest = await createFeedManifest()
    console.log('Feed manifest address:', feedManifest)

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

    set(kpis.samples, countSamples(getState()))
    findNewestSample()
    await readPublishedFeed()
    serveKpis(report, config.eyePort, config.eyeToken)

    await startPolling(processEvent)
}

main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
})
