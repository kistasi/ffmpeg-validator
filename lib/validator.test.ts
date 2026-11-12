import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MovieState, RadarrMovie, Run, ScanState } from './types'

vi.mock('./radarr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./radarr')>()),
  fetchMovies: vi.fn(),
  fetchTags: vi.fn(),
  ensureTags: vi.fn(),
  syncTags: vi.fn(),
}))
vi.mock('./ffmpeg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ffmpeg')>()),
  scanFile: vi.fn(),
}))

// The state files live under process.cwd(), so each test gets a temp dir as
// cwd and fresh modules. The movie files are real (empty) files in it, since
// the validator skips files it cannot read.
let tmpDir: string
let validator: typeof import('./validator')
let radarr: typeof import('./radarr')
let ffmpeg: typeof import('./ffmpeg')

const TAG_IDS = { 'ffmpeg-valid': 2, 'ffmpeg-corrupt': 3 }

function movie(id: number, title: string, tags: number[] = []): RadarrMovie {
  return {
    id,
    title,
    tags,
    movieFile: { id: id * 10, size: 100, dateAdded: '2026-01-01T00:00:00Z', path: path.join(tmpDir, `${title}.mkv`) },
  }
}

function cachedFor(m: RadarrMovie, status: MovieState['status']): MovieState {
  return {
    title: m.title,
    path: m.movieFile!.path,
    size: m.movieFile!.size,
    dateAdded: m.movieFile!.dateAdded,
    status,
    scanned_at: '2026-01-02T00:00:00',
    scan_seconds: 300,
    errors: status === 'corrupt' ? ['bad nal'] : [],
  }
}

async function writeState(state: ScanState) {
  await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'data', 'scan-state.json'), JSON.stringify(state))
}

async function readState(): Promise<ScanState> {
  const { readJson } = await import('./json-file')
  return readJson<ScanState>(path.join(tmpDir, 'data', 'scan-state.json'), {})
}

async function finished(): Promise<Run> {
  await vi.waitFor(async () => expect((await validator.listRuns()).active).toBeNull())
  return (await validator.listRuns()).runs[0]
}

const messages = (run: Run) => run.log.map((l) => l.message)

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'validator-'))
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
  delete (globalThis as { __ffmpegValidator?: unknown }).__ffmpegValidator
  vi.resetModules()
  radarr = await import('./radarr')
  ffmpeg = await import('./ffmpeg')
  validator = await import('./validator')

  vi.clearAllMocks()
  vi.mocked(radarr.ensureTags).mockResolvedValue(TAG_IDS)
  vi.mocked(radarr.fetchTags).mockResolvedValue([])
  vi.mocked(radarr.syncTags).mockResolvedValue(true)
  vi.mocked(ffmpeg.scanFile).mockResolvedValue({ errors: [], errorCount: 0, seconds: 12.4 })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function library(...movies: RadarrMovie[]) {
  vi.mocked(radarr.fetchMovies).mockResolvedValue(movies)
  for (const m of movies) await fs.writeFile(m.movieFile!.path, '')
}

describe('validator', () => {
  it('scans new files, records and tags the result', async () => {
    const corrupt = movie(1, 'Still Alice')
    const clean = movie(2, 'Inland Empire')
    await library(corrupt, clean)
    vi.mocked(ffmpeg.scanFile).mockImplementation(async (file) =>
      file === corrupt.movieFile!.path
        ? { errors: ['bad nal', 'corrupt frame'], errorCount: 40, seconds: 473 }
        : { errors: [], errorCount: 0, seconds: 631 }
    )

    const started = await validator.startRun({ mode: 'changed', trigger: 'cron' })
    expect(started).toMatchObject({ id: 1, status: 'running' })
    const run = await finished()

    expect(run).toMatchObject({ id: 1, status: 'completed', scanned: 2, corrupt: 1, progress: null })
    expect(run.finishedAt).not.toBeNull()
    expect(messages(run)).toContain('  CORRUPT: 40 error lines (473s)')
    expect(messages(run).at(-1)).toBe('Done. 1 corrupt file(s) known: Still Alice')

    const state = await readState()
    expect(state['10']).toMatchObject({ status: 'corrupt', errors: ['bad nal', 'corrupt frame'], error_count: 40 })
    expect(state['20']).toMatchObject({ status: 'clean', scan_seconds: 631 })
    expect(vi.mocked(radarr.syncTags).mock.calls).toEqual([
      [1, 'corrupt', TAG_IDS, []],
      [2, 'clean', TAG_IDS, []],
    ])
  })

  it('retags cached files without rescanning them, and prunes removed ones', async () => {
    const kept = movie(1, 'Onibaba', [2])
    await library(kept)
    await writeState({ '10': cachedFor(kept, 'clean'), '99': cachedFor(movie(9, 'Gone'), 'clean') })
    vi.mocked(radarr.syncTags).mockResolvedValue(false)

    await validator.startRun({ mode: 'changed', trigger: 'manual' })
    const run = await finished()

    expect(ffmpeg.scanFile).not.toHaveBeenCalled()
    expect(radarr.syncTags).toHaveBeenCalledWith(1, 'clean', TAG_IDS, [2])
    expect(Object.keys(await readState())).toEqual(['10'])
    expect(messages(run)[0]).toBe('Removed 1 movie(s) no longer in Radarr: Gone')
  })

  it('rescans only the requested file, even when it is cached', async () => {
    const a = movie(1, 'A')
    const b = movie(2, 'B')
    await library(a, b)
    await writeState({ '10': cachedFor(a, 'corrupt'), '20': cachedFor(b, 'clean') })

    await validator.startRun({ mode: 'changed', trigger: 'manual', movieFileId: '10' })
    await finished()

    expect(vi.mocked(ffmpeg.scanFile).mock.calls.map(([file]) => file)).toEqual([a.movieFile!.path])
    expect((await readState())['10'].status).toBe('clean')
  })

  it('skips a file it cannot read instead of tagging it corrupt', async () => {
    const m = movie(1, 'Unmounted')
    vi.mocked(radarr.fetchMovies).mockResolvedValue([m])

    await validator.startRun({ mode: 'changed', trigger: 'cron' })
    const run = await finished()

    expect(run).toMatchObject({ status: 'completed', scanned: 0 })
    expect(messages(run).some((msg) => msg.includes('is not readable (is the drive mounted?)'))).toBe(true)
    expect(ffmpeg.scanFile).not.toHaveBeenCalled()
    expect(radarr.syncTags).not.toHaveBeenCalled()
  })

  it('aborts the run when ffmpeg cannot run, without recording anything', async () => {
    await library(movie(1, 'A'), movie(2, 'B'))
    vi.mocked(ffmpeg.scanFile).mockRejectedValue(new ffmpeg.ScanError('Could not run ffmpeg: spawn ffmpeg ENOENT'))

    await validator.startRun({ mode: 'changed', trigger: 'cron' })
    const run = await finished()

    expect(run).toMatchObject({ status: 'failed', error: 'Could not run ffmpeg: spawn ffmpeg ENOENT' })
    expect(ffmpeg.scanFile).toHaveBeenCalledTimes(1)
    expect(radarr.syncTags).not.toHaveBeenCalled()
    expect(await readState()).toEqual({})
  })

  it('records a Radarr failure as a failed run', async () => {
    vi.mocked(radarr.fetchMovies).mockRejectedValue(new radarr.RadarrError('Radarr returned HTTP 401.'))
    await validator.startRun({ mode: 'changed', trigger: 'cron' })
    expect(await finished()).toMatchObject({ status: 'failed', error: 'Radarr returned HTTP 401.' })
  })

  it('runs one at a time, and stops on cancel without recording the file', async () => {
    await library(movie(1, 'A'), movie(2, 'B'))
    vi.mocked(ffmpeg.scanFile).mockImplementation(
      (_file, signal) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new ffmpeg.ScanCancelledError()))
        )
    )

    await validator.startRun({ mode: 'changed', trigger: 'manual' })
    await expect(validator.startRun({ mode: 'all', trigger: 'cron' })).rejects.toBeInstanceOf(
      validator.RunInProgressError
    )
    await vi.waitFor(() => expect(ffmpeg.scanFile).toHaveBeenCalled())
    expect((await validator.listRuns()).active?.progress).toEqual({ index: 1, total: 2, title: 'A' })

    expect(validator.cancelRun()).toBe(true)
    const run = await finished()

    expect(run).toMatchObject({ status: 'cancelled', scanned: 0 })
    expect(ffmpeg.scanFile).toHaveBeenCalledTimes(1)
    expect(await readState()).toEqual({})
    expect(validator.cancelRun()).toBe(false)
  })

  it('marks a run left over from a previous process as interrupted', async () => {
    await fs.mkdir(path.join(tmpDir, 'data'), { recursive: true })
    const stale: Run = {
      id: 4,
      options: { mode: 'changed', trigger: 'cron' },
      status: 'running',
      startedAt: '2026-11-12T06:00:00.000Z',
      finishedAt: null,
      progress: { index: 1, total: 3, title: 'A' },
      scanned: 0,
      corrupt: 0,
      error: null,
      log: [],
    }
    await fs.writeFile(path.join(tmpDir, 'data', 'runs.json'), JSON.stringify([stale]))

    const { active, runs } = await validator.listRuns()
    expect(active).toBeNull()
    expect(runs[0]).toMatchObject({ id: 4, status: 'interrupted', progress: null })
  })
})
