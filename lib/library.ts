import { candidatesByKey, libraryStatus } from './plan'
import { fetchMovies, movieUrl } from './radarr'
import { loadState } from './state-db'
import type { LibraryMovie, LibraryStatus } from './types'

// Problems first: those are what this page is for.
const STATUS_ORDER: Record<LibraryStatus, number> = { corrupt: 0, changed: 1, unscanned: 2, clean: 3 }

/** Every movie file in Radarr, with what is known about its integrity. */
export async function getLibrary(): Promise<LibraryMovie[]> {
  const [movies, state] = await Promise.all([fetchMovies(), loadState()])

  const rows = [...candidatesByKey(movies).values()].map(({ key, movie, movieFile }): LibraryMovie => {
    const status = libraryStatus({ key, movie, movieFile }, state[key])
    // A changed file's cached result belongs to the file it replaced.
    const cached = status === 'clean' || status === 'corrupt' ? state[key] : undefined
    return {
      key,
      movieId: movie.id,
      title: movie.title,
      year: movie.year ?? null,
      path: movieFile.path,
      size: movieFile.size,
      status,
      scannedAt: cached?.scanned_at ?? null,
      scanSeconds: cached?.scan_seconds ?? null,
      errors: cached?.errors ?? [],
      errorCount: cached ? (cached.error_count ?? cached.errors.length) : 0,
      radarrUrl: movieUrl(movie),
    }
  })

  return rows.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title)
  )
}
