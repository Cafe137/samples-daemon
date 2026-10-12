import { addKpi, createReport, fail, increment } from './eye.js'

export const report = createReport('livecoding/samples-daemon')

export const kpis = {
    lastSampleAt: addKpi(report, 'lastSampleAt', 'Last sample', 'time'),
    lastSample: addKpi(report, 'lastSample', 'Newest', 'text'),
    samples: addKpi(report, 'samples', 'Samples', 'count'),
    feedSamples: addKpi(report, 'feedSamples', 'Published', 'count'),
    lastBlock: addKpi(report, 'lastBlock', 'Last block', 'block'),
    feedPublishedAt: addKpi(report, 'feedPublishedAt', 'Feed written', 'time'),
    feedReference: addKpi(report, 'feedReference', 'Feed ref', 'text'),
    eventsAccepted: addKpi(report, 'eventsAccepted', 'Accepted', 'count'),
    eventsForeign: addKpi(report, 'eventsForeign', 'Foreign', 'count'),
    eventsFailed: addKpi(report, 'eventsFailed', 'Failed', 'count'),
    eventError: addKpi(report, 'eventError', 'Event error', 'error'),
    feedFailures: addKpi(report, 'feedFailures', 'Feed failures', 'count'),
    feedError: addKpi(report, 'feedError', 'Feed error', 'error'),
    pollError: addKpi(report, 'pollError', 'Poll error', 'error'),
}

export function rejectEvent(swarmHash: string, error: unknown): void {
    increment(kpis.eventsFailed)
    fail(kpis.eventError, error, swarmHash)
}

export function failFeed(error: unknown): void {
    increment(kpis.feedFailures)
    fail(kpis.feedError, error)
}
