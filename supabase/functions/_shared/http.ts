// fetch with a timeout, retries, and a speed limit. The NHL and ESPN APIs are
// unofficial: they occasionally drop a request or answer 5xx for a moment,
// and they answer 429 (too many requests) to a burst.

export class HttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string) {
    super(`${status} from ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export type FetchOptions = {
  timeoutMs?: number
  retries?: number
  /** Swapped out in tests, which also skips the speed limit. */
  fetch?: typeof fetch
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Says who's asking. ESPN answers 403 to the Edge Function runtime's default
// User-Agent (Deno/x.y), and naming the app is the polite thing to do anyway.
const USER_AGENT = 'InigoInsuranceFantasy/1.0 (private fantasy hockey league)'

// ---------------------------------------------------------------------------
// Speed limit: per host, a few requests at a time and a gap between starts.
// ---------------------------------------------------------------------------

const MAX_AT_ONCE = 3
const GAP_MS = 150

type Lane = { running: number; nextStart: number; waiting: (() => void)[] }
const lanes = new Map<string, Lane>()

async function takeTurn(host: string): Promise<() => void> {
  let lane = lanes.get(host)
  if (!lane) lanes.set(host, (lane = { running: 0, nextStart: 0, waiting: [] }))
  const current = lane

  if (current.running >= MAX_AT_ONCE) {
    await new Promise<void>((resolve) => current.waiting.push(resolve))
  }
  current.running++

  const start = Math.max(Date.now(), current.nextStart)
  current.nextStart = start + GAP_MS
  if (start > Date.now()) await wait(start - Date.now())

  return () => {
    current.running--
    current.waiting.shift()?.()
  }
}

// How long to back off after a failed attempt. A 429 needs a real pause.
function backoff(attempt: number, status: number | null, retryAfter: string | null) {
  const asked = Number(retryAfter)
  if (status === 429) {
    if (Number.isFinite(asked) && asked > 0) return Math.min(asked * 1000, 30_000)
    return 2000 * 2 ** attempt
  }
  return 400 * (attempt + 1)
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 10_000 } = options
  const limited = options.fetch === undefined
  const doFetch = options.fetch ?? fetch
  const retries = options.retries ?? 3
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const release = limited ? await takeTurn(new URL(url).host) : () => {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let pause = backoff(attempt, null, null)

    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      })
      if (response.ok) return (await response.json()) as T

      lastError = new HttpError(response.status, url)
      // A 4xx (other than rate limiting) won't get better by asking again.
      if (response.status < 500 && response.status !== 429) break
      pause = backoff(attempt, response.status, response.headers.get('Retry-After'))
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
      release()
    }

    if (attempt < retries) await wait(pause)
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Request failed: ${url}`)
}

/** Runs tasks a few at a time, keeping results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
