import { spawn } from 'node:child_process'

// A single decode pass runs for minutes, not hours; anything past this is stuck.
// Without a cap a hung ffmpeg would keep the run going and block every later one.
export const SCAN_TIMEOUT_MS = 6 * 60 * 60 * 1000

/** How many of ffmpeg's complaints are kept; a broken file can produce thousands. */
export const MAX_ERROR_LINES = 5

export type ScanResult = {
  /** The first MAX_ERROR_LINES lines ffmpeg complained with. */
  errors: string[]
  /** How many lines it complained with in all. */
  errorCount: number
  seconds: number
}

/**
 * The decode check could not be run at all (ffmpeg missing, killed from
 * outside). Such a failure says nothing about the file, so it must abort the
 * run rather than get the file tagged corrupt.
 */
export class ScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanError'
  }
}

/** The scan was cancelled; its file has no result. */
export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled.')
    this.name = 'ScanCancelledError'
  }
}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

/** Decode the file to nowhere and collect whatever ffmpeg complains about. */
export function scanFile(file: string, signal?: AbortSignal, timeoutMs = SCAN_TIMEOUT_MS): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ScanCancelledError())
      return
    }

    const start = performance.now()
    const child = spawn(ffmpegPath(), ['-nostdin', '-v', 'error', '-i', file, '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    const errors: string[] = []
    let errorCount = 0
    let pending = ''
    const take = (line: string) => {
      if (!line.trim()) return
      errorCount++
      if (errors.length < MAX_ERROR_LINES) errors.push(line.trimEnd())
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      lines.forEach(take)
    })

    let timedOut = false
    let cancelled = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    const onAbort = () => {
      cancelled = true
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    child.on('error', (err) => {
      settle(() => reject(new ScanError(`Could not run ffmpeg: ${err.message}`)))
    })

    child.on('close', (code, killedBy) => {
      take(pending)
      const seconds = (performance.now() - start) / 1000
      settle(() => {
        if (cancelled) return reject(new ScanCancelledError())
        if (timedOut) {
          return resolve({ errors: [`ffmpeg timed out after ${Math.round(seconds)}s`], errorCount: 1, seconds })
        }
        // Killed by something other than us: the OOM killer, say. That is
        // about the machine, not the file.
        if (killedBy) return reject(new ScanError(`ffmpeg was killed by ${killedBy}.`))
        if (code !== 0 && errorCount === 0) {
          return resolve({ errors: [`ffmpeg exited with status ${code}`], errorCount: 1, seconds })
        }
        resolve({ errors, errorCount, seconds })
      })
    })
  })
}
