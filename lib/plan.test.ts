import { beforeEach, describe, expect, it } from 'vitest'
import { candidatesByKey, libraryStatus, pruneMissing, selectPending } from './plan'
import type { MovieState, RadarrMovie, ScanState } from './types'

const movie: RadarrMovie = {
  id: 1,
  title: 'Interstellar',
  tags: [],
  movieFile: { id: 7, size: 100, dateAdded: '2026-01-01T00:00:00Z', path: '/movies/a.mkv' },
}

let cached: MovieState

beforeEach(() => {
  cached = {
    title: 'Interstellar',
    path: '/movies/a.mkv',
    size: 100,
    dateAdded: '2026-01-01T00:00:00Z',
    status: 'clean',
    scanned_at: '2026-01-02T00:00:00',
    scan_seconds: 1,
    errors: [],
  }
})

const keys = (pending: { key: string }[]) => pending.map((c) => c.key)

describe('candidatesByKey', () => {
  it('indexes only movies with files, by movieFileId', () => {
    const result = candidatesByKey([movie, { id: 2, title: 'Missing File', tags: [] }])
    expect([...result.keys()]).toEqual(['7'])
    expect(result.get('7')?.movie.title).toBe('Interstellar')
  })
})

describe('pruneMissing', () => {
  it('drops entries whose file is gone from Radarr', () => {
    const state: ScanState = { '7': cached, '8': { ...cached, title: 'Deleted' } }
    const removed = pruneMissing(state, new Set(['7']))
    expect(Object.keys(state)).toEqual(['7'])
    expect(removed.map((e) => e.title)).toEqual(['Deleted'])
  })
})

describe('libraryStatus', () => {
  const candidate = candidatesByKey([movie]).get('7')!

  it('tells unscanned, replaced and scanned files apart', () => {
    expect(libraryStatus(candidate, undefined)).toBe('unscanned')
    expect(libraryStatus(candidate, { ...cached, size: 999 })).toBe('changed')
    expect(libraryStatus(candidate, { ...cached, dateAdded: 'later' })).toBe('changed')
    expect(libraryStatus(candidate, { ...cached, status: 'corrupt' })).toBe('corrupt')
  })
})

describe('selectPending', () => {
  const candidates = candidatesByKey([movie])

  it('skips a file matching the cache', () => {
    expect(selectPending(candidates, { '7': cached }, 'changed')).toEqual([])
  })

  it('scans a file not in the cache, or replaced since', () => {
    expect(keys(selectPending(candidates, {}, 'changed'))).toEqual(['7'])
    expect(keys(selectPending(candidates, { '7': { ...cached, size: 999 } }, 'changed'))).toEqual(['7'])
  })

  it('rescans everything in "all" mode', () => {
    expect(keys(selectPending(candidates, { '7': cached }, 'all'))).toEqual(['7'])
  })

  it('only picks corrupt entries in "recheck-corrupt" mode', () => {
    expect(selectPending(candidates, { '7': cached }, 'recheck-corrupt')).toEqual([])
    expect(keys(selectPending(candidates, { '7': { ...cached, status: 'corrupt' } }, 'recheck-corrupt'))).toEqual([
      '7',
    ])
  })
})
