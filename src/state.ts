import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'

const STATE_FILE = 'strudel.json'

export const DEFAULT_BASE = 'https://bzz.limo'

export type State = Record<string, string>

let state: State = {}

export function loadState(): boolean {
    if (existsSync(STATE_FILE)) {
        state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
        return true
    }
    return false
}

export function getState(): State {
    return state
}

export function setState(newState: State): void {
    state = newState
}

export function hasEntry(sampleName: string): boolean {
    return sampleName in state
}

export function addEntry(sampleName: string, url: string): void {
    state[sampleName] = url
    persistState()
}

export function persistState(): void {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

export function deleteStateFile(): void {
    if (existsSync(STATE_FILE)) {
        unlinkSync(STATE_FILE)
    }
}
