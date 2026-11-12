import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run } from './types'

// runs-db computes its path from process.cwd() at import time, so we point cwd
// at a throwaway temp dir and import the module fresh for each test.
let tmpDir: string
let db: typeof import('./runs-db')

function run(id: number, status: Run['status'] = 'completed'): Run {
  return {
    id,
    options: { mode: 'changed', trigger: 'cron' },
    status,
    startedAt: '2026-11-12T06:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-11-12T06:10:00.000Z',
    progress: null,
    scanned: 0,
    corrupt: 0,
    error: null,
    log: [],
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runs-db-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  vi.resetModules()
  db = await import('./runs-db')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('runs-db', () => {
  it('starts empty, with run ids from 1', async () => {
    expect(await db.getRuns()).toEqual([])
    expect(await db.nextRunId()).toBe(1)
  })

  it('stores runs newest first and replaces one by id', async () => {
    await db.saveRun(run(1))
    await db.saveRun(run(2, 'running'))
    await db.saveRun(run(2, 'failed'))
    expect((await db.getRuns()).map((r) => [r.id, r.status])).toEqual([
      [2, 'failed'],
      [1, 'completed'],
    ])
    expect(await db.nextRunId()).toBe(3)
  })

  it('keeps only the newest runs', async () => {
    for (let id = 1; id <= db.MAX_RUNS + 2; id++) await db.saveRun(run(id))
    const runs = await db.getRuns()
    expect(runs).toHaveLength(db.MAX_RUNS)
    expect(runs.at(-1)?.id).toBe(3)
  })

  it('marks runs a previous process left running as interrupted', async () => {
    await db.saveRun(run(1))
    await db.saveRun(run(2, 'running'))

    expect(await db.markInterrupted()).toBe(1)
    const [interrupted, done] = await db.getRuns()
    expect(interrupted.status).toBe('interrupted')
    expect(interrupted.finishedAt).not.toBeNull()
    expect(interrupted.log.at(-1)?.message).toMatch(/^Interrupted/)
    expect(done.status).toBe('completed')
    expect(await db.markInterrupted()).toBe(0)
  })

  it('leaves no temp files behind', async () => {
    await db.saveRun(run(1))
    expect(await fs.readdir(path.join(tmpDir, 'data'))).toEqual(['runs.json'])
  })
})
