import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { getLibrary } from '@/lib/library'
import { RadarrError } from '@/lib/radarr'

vi.mock('@/lib/library', () => ({ getLibrary: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/library', () => {
  it('returns the library', async () => {
    vi.mocked(getLibrary).mockResolvedValue([])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ movies: [] })
  })

  it('maps a Radarr failure to its status', async () => {
    vi.mocked(getLibrary).mockRejectedValue(new RadarrError('Radarr returned HTTP 401.'))
    const res = await GET()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Radarr returned HTTP 401.' })
  })
})
