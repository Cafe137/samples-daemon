export async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn()
        } catch (err) {
            lastError = err
            if (attempt < maxAttempts) {
                const delay = 1000 * Math.pow(2, attempt - 1)
                console.error(`[retry] ${label} — attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, err)
                await new Promise(resolve => setTimeout(resolve, delay))
            }
        }
    }
    throw lastError
}
