import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLibrary } from './library'
import { fetchMovies } from './radarr'
import { loadState } from './state-db'
import type { MovieState, RadarrMovie } from './types'

vi.mock('./radarr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./radarr')>()),
  fetchMovies: vi.fn(),
}))
vi.mock('./state-db', () => ({ loadState: vi.fn() }))

function movie(id: number, title: string): RadarrMovie {
  return {
    id,
    title,
    year: 2000 + id,
    titleSlug: title.toLowerCase(),
    tags: [],
    movieFile: { id: id * 10, size: 100, dateAdded: 'd', path: `/movies/${title}.mkv` },
  }
}

function cached(title: string, status: MovieState['status'], extra: Partial<MovieState> = {}): MovieState {
  return {
    title,
    path: `/movies/${title}.mkv`,
    size: 100,
    dateAdded: 'd',
    status,
    scanned_at: '2026-11-03T07:06:39',
    scan_seconds: 398,
    errors: [],
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RADARR_PUBLIC_URL', 'http://malna.local:7878')
})

describe('getLibrary', () => {
  it('lists every movie file, problems first', async () => {
    vi.mocked(fetchMovies).mockResolvedValue([
      movie(1, 'Clean'),
      movie(2, 'Broken'),
      movie(3, 'New'),
      movie(4, 'Replaced'),
      { id: 5, title: 'No file', tags: [] },
    ])
    vi.mocked(loadState).mockResolvedValue({
      '10': cached('Clean', 'clean'),
      '20': cached('Broken', 'corrupt', { errors: ['bad nal'] }),
      '40': cached('Replaced', 'corrupt', { size: 1, errors: ['old'] }),
    })

    const rows = await getLibrary()

    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ['Broken', 'corrupt'],
      ['Replaced', 'changed'],
      ['New', 'unscanned'],
      ['Clean', 'clean'],
    ])
    expect(rows[0]).toMatchObject({
      key: '20',
      movieId: 2,
      year: 2002,
      errors: ['bad nal'],
      errorCount: 1,
      scanSeconds: 398,
      radarrUrl: 'http://malna.local:7878/movie/broken',
    })
    // A replaced file's old result belongs to the file it replaced.
    expect(rows[1]).toMatchObject({ errors: [], scannedAt: null, scanSeconds: null })
  })
})
