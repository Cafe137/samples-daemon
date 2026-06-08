import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { gnosis } from 'viem/chains'
import { config } from './config.js'

const CONTRACT_ADDRESS = '0x5cDb55a64D5D5d8754398448D5a0e01098a57438' as const
const DEPLOYMENT_BLOCK = 46507870n
const POLL_INTERVAL_MS = 5_000
const BLOCK_RANGE = 1000n
const LAST_BLOCK_FILE = 'last-block.txt'

const notificationEvent = parseAbiItem('event Notification(bytes32 indexed data)')

const client = createPublicClient({
    chain: gnosis,
    transport: http(config.rpcUrl),
})

function readLastBlock(): bigint {
    if (existsSync(LAST_BLOCK_FILE)) {
        return BigInt(readFileSync(LAST_BLOCK_FILE, 'utf-8').trim())
    }
    return DEPLOYMENT_BLOCK
}

function writeLastBlock(block: bigint): void {
    writeFileSync(LAST_BLOCK_FILE, block.toString())
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export async function startPolling(
    processEvent: (data: string) => Promise<void>,
): Promise<void> {
    console.log('Starting blockchain indexer...')

    while (true) {
        try {
            const fromBlock = readLastBlock()
            const latestBlock = await client.getBlockNumber()

            if (fromBlock > latestBlock) {
                await sleep(POLL_INTERVAL_MS)
                continue
            }

            const toBlock =
                fromBlock + BLOCK_RANGE - 1n < latestBlock
                    ? fromBlock + BLOCK_RANGE - 1n
                    : latestBlock

            const logs = await client.getLogs({
                address: CONTRACT_ADDRESS,
                event: notificationEvent,
                fromBlock,
                toBlock,
            })

            if (logs.length > 0) {
                console.log(
                    `Blocks ${fromBlock}–${toBlock}: ${logs.length} Notification event(s)`,
                )
            }

            for (const log of logs) {
                if (log.args.data) {
                    await processEvent(log.args.data)
                }
            }

            writeLastBlock(toBlock + 1n)
        } catch (err) {
            console.error('RPC poll error (will retry next tick):', err)
        }

        await sleep(POLL_INTERVAL_MS)
    }
}
