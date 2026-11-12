import type { RadarrMovie, ScanStatus } from './types'

export const TAG_CLEAN = 'ffmpeg-valid'
export const TAG_CORRUPT = 'ffmpeg-corrupt'

const HTTP_TIMEOUT_MS = 30_000

/** Error carrying an HTTP status, so route handlers can respond appropriately. */
export class RadarrError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'RadarrError'
    this.status = status
  }
}

function config(): { url: string; apiKey: string } {
  const url = process.env.RADARR_URL
  const apiKey = process.env.RADARR_API_KEY
  if (!url || !apiKey) {
    throw new RadarrError('RADARR_URL and RADARR_API_KEY must be configured on the server.', 500)
  }
  return { url: url.replace(/\/+$/, ''), apiKey }
}

async function radarr<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, apiKey } = config()

  let res: Response
  try {
    res = await fetch(`${url}/api/v3/${path}`, {
      method,
      headers: {
        'X-Api-Key': apiKey,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (err) {
    throw new RadarrError(`Radarr connection failed: ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new RadarrError(`Radarr returned HTTP ${res.status} for ${method} ${path}.`)
  }
  return (await res.json().catch(() => null)) as T
}

export async function fetchMovies(): Promise<RadarrMovie[]> {
  return radarr<RadarrMovie[]>('GET', 'movie')
}

/** The tags a movie carries right now, for after a scan has left a listing stale. */
export async function fetchTags(movieId: number): Promise<number[]> {
  return (await radarr<RadarrMovie>('GET', `movie/${movieId}`)).tags
}

/** Return {label: id} for the scan tags, creating the ones Radarr lacks. */
export async function ensureTags(): Promise<Record<string, number>> {
  const tags = await radarr<{ id: number; label: string }[]>('GET', 'tag')
  const ids = Object.fromEntries(tags.map((t) => [t.label, t.id]))

  for (const label of [TAG_CLEAN, TAG_CORRUPT]) {
    if (!(label in ids)) {
      ids[label] = (await radarr<{ id: number }>('POST', 'tag', { label })).id
    }
  }
  return ids
}

async function editTag(movieId: number, tagId: number, applyTags: 'add' | 'remove') {
  await radarr('PUT', 'movie/editor', { movieIds: [movieId], tags: [tagId], applyTags })
}

/**
 * Tag the movie with its scan result and drop the opposite tag. Returns
 * whether Radarr needed an update; `currentTags` is what the caller believes
 * the movie carries.
 */
export async function syncTags(
  movieId: number,
  status: ScanStatus,
  tagIds: Record<string, number>,
  currentTags: number[]
): Promise<boolean> {
  const wanted = tagIds[status === 'corrupt' ? TAG_CORRUPT : TAG_CLEAN]
  const unwanted = tagIds[status === 'corrupt' ? TAG_CLEAN : TAG_CORRUPT]
  let changed = false

  if (!currentTags.includes(wanted)) {
    await editTag(movieId, wanted, 'add')
    changed = true
  }
  if (currentTags.includes(unwanted)) {
    await editTag(movieId, unwanted, 'remove')
    changed = true
  }
  return changed
}

/** Where a person can open the movie in Radarr, if the public URL is known. */
export function movieUrl(movie: RadarrMovie): string | null {
  const base = process.env.RADARR_PUBLIC_URL
  if (!base || !movie.titleSlug) return null
  return `${base.replace(/\/+$/, '')}/movie/${movie.titleSlug}`
}
