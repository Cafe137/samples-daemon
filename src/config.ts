import 'dotenv/config'

function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required env var: ${name}`)
    return value
}

export const config = {
    rpcUrl: process.env.RPC_URL || 'https://rpc.gnosischain.com',
    gatewayUrl: required('GATEWAY_URL'),
    feedSignerKey: required('FEED_SIGNER_KEY'),
    feedTopic: required('FEED_TOPIC'),
}
