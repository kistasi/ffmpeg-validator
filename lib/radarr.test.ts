import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureTags, fetchMovies, movieUrl, RadarrError, syncTags, TAG_CLEAN, TAG_CORRUPT } from './radarr'

const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function sent(call: number): { method: string; url: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[call]
  return {
    method: String(init?.method),
    url: String(url),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => json({}))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('RADARR_URL', 'http://radarr:7878/')
  vi.stubEnv('RADARR_API_KEY', 'xyz')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('radarr', () => {
  it('fetches movies with the API key', async () => {
    fetchMock.mockResolvedValueOnce(json([{ id: 1, title: 'Interstellar', tags: [] }]))
    expect(await fetchMovies()).toEqual([{ id: 1, title: 'Interstellar', tags: [] }])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://radarr:7878/api/v3/movie')
    expect((init?.headers as Record<string, string>)['X-Api-Key']).toBe('xyz')
  })

  it('requires the URL and API key', async () => {
    vi.stubEnv('RADARR_API_KEY', '')
    await expect(fetchMovies()).rejects.toMatchObject({ status: 500 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('raises a RadarrError on an HTTP error or a connection failure', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 401))
    await expect(fetchMovies()).rejects.toBeInstanceOf(RadarrError)

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(fetchMovies()).rejects.toThrow('Radarr connection failed: fetch failed')
  })

  it('returns existing scan tags without creating any', async () => {
    fetchMock.mockResolvedValueOnce(
      json([
        { label: 'other', id: 1 },
        { label: TAG_CLEAN, id: 2 },
        { label: TAG_CORRUPT, id: 3 },
      ])
    )
    expect(await ensureTags()).toEqual({ other: 1, [TAG_CLEAN]: 2, [TAG_CORRUPT]: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('creates the scan tags Radarr lacks', async () => {
    fetchMock.mockResolvedValueOnce(json([{ label: TAG_CLEAN, id: 2 }])).mockResolvedValueOnce(json({ id: 7 }))
    expect(await ensureTags()).toEqual({ [TAG_CLEAN]: 2, [TAG_CORRUPT]: 7 })
    expect(sent(1)).toMatchObject({ method: 'POST', body: { label: TAG_CORRUPT } })
  })

  describe('syncTags', () => {
    const tagIds = { [TAG_CLEAN]: 2, [TAG_CORRUPT]: 3 }

    it('adds the clean tag', async () => {
      expect(await syncTags(11, 'clean', tagIds, [])).toBe(true)
      expect(sent(0)).toEqual({
        method: 'PUT',
        url: 'http://radarr:7878/api/v3/movie/editor',
        body: { movieIds: [11], tags: [2], applyTags: 'add' },
      })
    })

    it('adds the corrupt tag and removes the clean one', async () => {
      expect(await syncTags(11, 'corrupt', tagIds, [2])).toBe(true)
      expect([sent(0).body, sent(1).body]).toEqual([
        { movieIds: [11], tags: [3], applyTags: 'add' },
        { movieIds: [11], tags: [2], applyTags: 'remove' },
      ])
    })

    it('does nothing when the tags already match', async () => {
      expect(await syncTags(11, 'clean', tagIds, [2, 9])).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('links to the movie only when the public URL is set', () => {
    const movie = { id: 1, title: 'Interstellar', titleSlug: 'interstellar-157336', tags: [] }
    expect(movieUrl(movie)).toBeNull()
    vi.stubEnv('RADARR_PUBLIC_URL', 'http://malna.local:7878')
    expect(movieUrl(movie)).toBe('http://malna.local:7878/movie/interstellar-157336')
  })
})
