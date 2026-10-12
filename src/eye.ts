import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

export type KpiKind = 'count' | 'number' | 'time' | 'block' | 'text' | 'error'

export interface Kpi {
    key: string
    label: string
    kind: KpiKind
    value: number | string | null
    unit?: string
    at: number | null
}

export interface KpiReport {
    version: 1
    component: string
    now: number
    startedAt: number
    kpis: Kpi[]
}

const MAX_TEXT_LENGTH = 200

export function seconds(): number {
    return Math.floor(Date.now() / 1000)
}

export function createReport(component: string): KpiReport {
    const now = seconds()
    return { version: 1, component, now, startedAt: now, kpis: [] }
}

export function addKpi(report: KpiReport, key: string, label: string, kind: KpiKind, unit?: string): Kpi {
    const kpi: Kpi = { key, label, kind, value: kind === 'count' ? 0 : null, at: null }
    if (unit) kpi.unit = unit
    report.kpis.push(kpi)
    return kpi
}

export function set(kpi: Kpi, value: number | string | null): void {
    if (kpi.value === value) return
    kpi.value = value
    kpi.at = seconds()
}

export function increment(kpi: Kpi, amount = 1): void {
    kpi.value = (kpi.value as number) + amount
    kpi.at = seconds()
}

export function fail(kpi: Kpi, error: unknown, context?: string): void {
    const e = error as { shortMessage?: unknown; message?: unknown } | null
    const message =
        typeof e?.shortMessage === 'string' ? e.shortMessage : typeof e?.message === 'string' ? e.message : String(error)
    const text = context ? `${context}: ${message}` : message
    kpi.value = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
    kpi.at = seconds()
}

export function eventType(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) return null
    const type = (value as { type?: unknown }).type
    return typeof type === 'string' ? type : null
}

export function serveKpis(report: KpiReport, port: number | null, token: string | null): void {
    if (!port || !token) {
        console.log('EYE_PORT or EYE_TOKEN not set, KPI endpoint disabled')
        return
    }
    const expected = Buffer.from(`Bearer ${token}`)
    createServer((req, res) => {
        const given = Buffer.from(req.headers.authorization ?? '')
        if (req.method !== 'GET' || req.url !== '/kpis' || given.length !== expected.length || !timingSafeEqual(given, expected)) {
            res.writeHead(401).end()
            return
        }
        report.now = seconds()
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(report))
    }).listen(port, '0.0.0.0', () => console.log(`KPI endpoint listening on 0.0.0.0:${port}`))
}
