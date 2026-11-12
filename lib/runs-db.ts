import path from 'node:path'
import { readJson, writeJson } from './json-file'
import type { Run } from './types'

// Lives at <project root>/data/runs.json, in the mounted data volume.
const RUNS_PATH = path.join(process.cwd(), 'data', 'runs.json')

/** Daily cron runs plus manual ones: about a month of history. */
export const MAX_RUNS = 50

/** Every stored run, newest first. */
export async function getRuns(): Promise<Run[]> {
  return readJson<Run[]>(RUNS_PATH, [])
}

/** Insert or replace a run by id, keeping the newest MAX_RUNS. */
export async function saveRun(run: Run): Promise<void> {
  const others = (await getRuns()).filter((r) => r.id !== run.id)
  const runs = [run, ...others].sort((a, b) => b.id - a.id).slice(0, MAX_RUNS)
  await writeJson(RUNS_PATH, runs)
}

export async function nextRunId(): Promise<number> {
  return Math.max(0, ...(await getRuns()).map((r) => r.id)) + 1
}

/**
 * Mark runs left 'running' by a previous server process as interrupted: a
 * scan only lives as long as the process that started it, so after a restart
 * nothing is running any more, whatever the file says.
 */
export async function markInterrupted(): Promise<number> {
  const runs = await getRuns()
  const stale = runs.filter((r) => r.status === 'running')
  if (stale.length === 0) return 0

  const now = new Date().toISOString()
  for (const run of stale) {
    run.status = 'interrupted'
    run.finishedAt = now
    run.progress = null
    run.log.push({ at: now, message: 'Interrupted: the server stopped while this run was in progress.' })
  }
  await writeJson(RUNS_PATH, runs)
  return stale.length
}
