import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FfmpegValidator from './ffmpeg-validator'
import type { LibraryMovie, Run, RunsResponse } from '@/lib/types'

function libraryMovie(key: string, title: string, extra: Partial<LibraryMovie>): LibraryMovie {
  return {
    key,
    movieId: Number(key),
    title,
    year: 2014,
    path: `/movies/${title}.mkv`,
    size: 4 * 1024 ** 3,
    status: 'clean',
    scannedAt: '2026-11-03T07:06:39',
    scanSeconds: 398,
    errors: [],
    errorCount: 0,
    radarrUrl: null,
    ...extra,
  }
}

const movies: LibraryMovie[] = [
  libraryMovie('20', 'Still Alice', { status: 'corrupt', errors: ['bad nal', 'corrupt frame'], errorCount: 40 }),
  libraryMovie('30', 'Onibaba', { status: 'unscanned', scannedAt: null, scanSeconds: null }),
  libraryMovie('10', 'Interstellar', {}),
]

const finishedRun: Run = {
  id: 7,
  options: { mode: 'changed', trigger: 'cron' },
  status: 'completed',
  startedAt: '2026-11-12T06:00:00.000Z',
  finishedAt: '2026-11-12T06:10:30.000Z',
  progress: null,
  scanned: 2,
  corrupt: 1,
  error: null,
  log: [{ at: '2026-11-12T06:10:30.000Z', message: 'Done. 1 corrupt file(s) known: Still Alice' }],
}

const activeRun: Run = {
  ...finishedRun,
  id: 8,
  options: { mode: 'changed', trigger: 'manual' },
  status: 'running',
  finishedAt: null,
  progress: { index: 1, total: 2, title: 'Onibaba' },
  scanned: 0,
  corrupt: 0,
  log: [{ at: '2026-11-12T06:00:01.000Z', message: '[1/2] scanning Onibaba ...' }],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

const fetchMock = vi.fn<typeof fetch>()
let runs: RunsResponse

beforeEach(() => {
  runs = { active: null, runs: [finishedRun] }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url, init) => {
    if (url === '/api/library') return json({ movies })
    if (url === '/api/runs' && init?.method === 'POST') {
      runs = { active: activeRun, runs: [activeRun, finishedRun] }
      return json({ run: activeRun }, 202)
    }
    if (url === '/api/runs') return json(runs)
    if (url === '/api/runs/active') return json({ ok: true })
    return json({ error: 'unexpected' }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function posts() {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/runs' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

describe('FfmpegValidator', () => {
  it('shows the files that need attention, with their errors', async () => {
    render(<FfmpegValidator />)

    expect(await screen.findByText('Still Alice')).toBeInTheDocument()
    expect(screen.getByText('bad nal')).toBeInTheDocument()
    expect(screen.getByText('…and 38 more line(s)')).toBeInTheDocument()
    // Once in the status column and once in the line under the title that
    // replaces it on phones; CSS shows one or the other.
    expect(within(screen.getByRole('row', { name: /Onibaba/ })).getAllByText('Not scanned')).toHaveLength(2)
    expect(screen.queryByText('Interstellar')).not.toBeInTheDocument()
    expect(screen.getByText(/3 files · 1 clean ·/)).toBeInTheDocument()
  })

  it('shows every file under "All"', async () => {
    const user = userEvent.setup()
    render(<FfmpegValidator />)
    await screen.findByText('Still Alice')

    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Interstellar')).toBeInTheDocument()
  })

  it('shows the run history with its log', async () => {
    const user = userEvent.setup()
    render(<FfmpegValidator />)

    await user.click(await screen.findByText('#7'))
    expect(await screen.findByText(/Done\. 1 corrupt file\(s\) known: Still Alice/)).toBeInTheDocument()
    expect(screen.getByText('cron')).toBeInTheDocument()
    expect(screen.getByText(/2 scanned/)).toBeInTheDocument()
  })

  it('starts a scan and shows its progress', async () => {
    const user = userEvent.setup()
    render(<FfmpegValidator />)
    await screen.findByText('Still Alice')

    await user.click(screen.getByRole('button', { name: 'Scan new & replaced' }))

    expect(await screen.findByText(/Scanning 1 of 2: Onibaba/)).toBeInTheDocument()
    expect(posts()).toEqual([{ mode: 'changed', trigger: 'manual' }])
    expect(screen.getByRole('button', { name: 'Scan new & replaced' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rescan Still Alice' })).toBeDisabled()
  })

  it('rescans a single file', async () => {
    const user = userEvent.setup()
    render(<FfmpegValidator />)
    await screen.findByText('Still Alice')

    await user.click(screen.getByRole('button', { name: 'Rescan Still Alice' }))
    await waitFor(() => expect(posts()).toEqual([{ mode: 'changed', movieFileId: '20', trigger: 'manual' }]))
  })

  it('asks before rescanning everything', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    render(<FfmpegValidator />)
    await screen.findByText('Still Alice')

    await user.click(screen.getByRole('button', { name: 'Rescan all' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Rescan all 3 files\?/))
    expect(posts()).toEqual([])
  })

  it('stops the active run', async () => {
    runs = { active: activeRun, runs: [activeRun, finishedRun] }
    const user = userEvent.setup()
    render(<FfmpegValidator />)

    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/runs/active' && init?.method === 'DELETE')).toBe(
        true
      )
    )
  })

  it('shows a Radarr error', async () => {
    fetchMock.mockImplementation(async (url) =>
      url === '/api/library' ? json({ error: 'Radarr returned HTTP 401.' }, 502) : json({ active: null, runs: [] })
    )
    render(<FfmpegValidator />)
    expect(await screen.findByText('Radarr returned HTTP 401.')).toBeInTheDocument()
  })
})
