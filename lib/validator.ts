import { constants, promises as fs } from 'node:fs'
import { ScanCancelledError, scanFile } from './ffmpeg'
import { candidatesByKey, type Candidate, pruneMissing, selectPending } from './plan'
import { ensureTags, fetchMovies, fetchTags, syncTags, TAG_CLEAN, TAG_CORRUPT } from './radarr'
import { getRuns, markInterrupted, nextRunId, saveRun } from './runs-db'
import { loadState, saveState } from './state-db'
import type { Run, RunOptions, RunsResponse, ScanState } from './types'

/** Raised when a run is requested while another is still going. */
export class RunInProgressError extends Error {
  run: Run
  constructor(run: Run) {
    super(`Run #${run.id} is still in progress.`)
    this.name = 'RunInProgressError'
    this.run = run
  }
}

type Runner = {
  active: Run | null
  controller: AbortController | null
  ready: Promise<void> | null
}

// Kept on globalThis rather than in module scope: Next.js may load this module
// once per route bundle, and the one-run-at-a-time lock (and the Stop button)
// only work if every route sees the same active run.
const holder = globalThis as typeof globalThis & { __ffmpegValidator?: Runner }

function runner(): Runner {
  holder.__ffmpegValidator ??= { active: null, controller: null, ready: null }
  return holder.__ffmpegValidator
}

/** Once per server process, before anything reads or starts runs. */
async function ready(): Promise<void> {
  const r = runner()
  r.ready ??= markInterrupted().then(
    () => undefined,
    (err) => {
      r.ready = null
      throw err
    }
  )
  await r.ready
}

const now = () => new Date().toISOString()

export async function listRuns(): Promise<RunsResponse> {
  await ready()
  const { active } = runner()
  // The in-memory copy of the active run is fresher than the file.
  const runs = (await getRuns()).map((run) => (run.id === active?.id ? active : run))
  if (active && !runs.some((run) => run.id === active.id)) runs.unshift(active)
  return { active, runs }
}

/**
 * Start a run in the background and return it right away: a scan takes hours,
 * far longer than any caller (cron's curl included) should wait.
 */
export async function startRun(options: RunOptions): Promise<Run> {
  await ready()
  const r = runner()
  if (r.active) throw new RunInProgressError(r.active)

  // Claim the slot before the first await, so two requests can't both start.
  const controller = new AbortController()
  const run: Run = {
    id: 0,
    options,
    status: 'running',
    startedAt: now(),
    finishedAt: null,
    progress: null,
    scanned: 0,
    corrupt: 0,
    error: null,
    log: [],
  }
  r.active = run
  r.controller = controller

  try {
    run.id = await nextRunId()
    await saveRun(run)
  } catch (err) {
    r.active = null
    r.controller = null
    throw err
  }

  void execute(run, controller.signal).finally(() => {
    r.active = null
    r.controller = null
  })
  return run
}

/** Ask the active run to stop. Returns whether there was one. */
export function cancelRun(): boolean {
  const { controller } = runner()
  if (!controller) return false
  controller.abort()
  return true
}

async function readable(file: string): Promise<boolean> {
  try {
    await fs.access(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Tag movies that are not being rescanned from their cached result. Runs
 * before the scans, while the tags from the startup listing are still fresh,
 * so no extra request per movie is needed.
 */
async function reconcileTags(
  candidates: Map<string, Candidate>,
  state: ScanState,
  skip: Set<string>,
  tagIds: Record<string, number>
): Promise<number> {
  let retagged = 0
  for (const [key, candidate] of candidates) {
    if (skip.has(key) || !state[key]) continue
    if (await syncTags(candidate.movie.id, state[key].status, tagIds, candidate.movie.tags ?? [])) {
      retagged++
    }
  }
  return retagged
}

async function execute(run: Run, signal: AbortSignal): Promise<void> {
  const log = async (message: string) => {
    run.log.push({ at: now(), message })
    await saveRun(run)
  }

  try {
    const { mode, movieFileId } = run.options
    const movies = await fetchMovies()
    const state = await loadState()
    const candidates = candidatesByKey(movies)

    const removed = pruneMissing(state, new Set(candidates.keys()))
    if (removed.length > 0) {
      await saveState(state)
      await log(
        `Removed ${removed.length} movie(s) no longer in Radarr: ${removed.map((e) => e.title).join(', ')}`
      )
    }

    let pending: Candidate[]
    if (movieFileId !== undefined) {
      const candidate = candidates.get(movieFileId)
      if (!candidate) throw new Error(`Movie file ${movieFileId} is no longer in Radarr.`)
      pending = [candidate]
    } else {
      pending = selectPending(candidates, state, mode)
    }
    await log(
      `${movies.length} movies in Radarr, ${candidates.size} have files, ${pending.length} to scan ` +
        `(${candidates.size - pending.length} not rescanned)`
    )

    const tagIds = await ensureTags()
    const retagged = await reconcileTags(candidates, state, new Set(pending.map((c) => c.key)), tagIds)
    if (retagged > 0) await log(`Tagged ${retagged} previously scanned movie(s) from cached results`)

    for (const [i, candidate] of pending.entries()) {
      if (signal.aborted) break
      const { movie, movieFile } = candidate
      run.progress = { index: i + 1, total: pending.length, title: movie.title }
      await log(`[${i + 1}/${pending.length}] scanning ${movie.title} ...`)

      // A file that isn't there says nothing about its integrity. This is also
      // what an unmounted drive looks like, which must not turn the whole
      // library corrupt.
      if (!(await readable(movieFile.path))) {
        await log(`  skipped: ${movieFile.path} is not readable (is the drive mounted?)`)
        continue
      }

      let result
      try {
        result = await scanFile(movieFile.path, signal)
      } catch (err) {
        if (err instanceof ScanCancelledError) break
        throw err
      }

      const seconds = Math.round(result.seconds)
      const status = result.errorCount > 0 ? 'corrupt' : 'clean'
      state[candidate.key] = {
        title: movie.title,
        path: movieFile.path,
        size: movieFile.size,
        dateAdded: movieFile.dateAdded,
        status,
        scanned_at: now(),
        scan_seconds: seconds,
        errors: result.errors,
        error_count: result.errorCount,
      }
      await saveState(state)
      run.scanned++
      if (status === 'corrupt') run.corrupt++
      await log(status === 'corrupt' ? `  CORRUPT: ${result.errorCount} error lines (${seconds}s)` : `  clean (${seconds}s)`)

      // Read the tags back: a long scan leaves the startup listing stale.
      if (await syncTags(movie.id, status, tagIds, await fetchTags(movie.id))) {
        await log(`  tagged ${status === 'corrupt' ? TAG_CORRUPT : TAG_CLEAN}`)
      }
    }

    run.progress = null
    if (signal.aborted) {
      run.status = 'cancelled'
      await log('Cancelled; the file being scanned keeps its previous result.')
    } else {
      const corrupt = Object.values(state).filter((e) => e.status === 'corrupt').map((e) => e.title)
      run.status = 'completed'
      await log(`Done. ${corrupt.length} corrupt file(s) known: ${corrupt.join(', ') || 'none'}`)
    }
  } catch (err) {
    run.status = 'failed'
    run.progress = null
    run.error = (err as Error).message
    await log(`Aborting: ${run.error}`).catch(() => undefined)
  } finally {
    run.finishedAt = now()
    await saveRun(run).catch((err) => console.error('Could not save run', run.id, err))
  }
}
