import type { LibraryStatus, MovieState, RadarrMovie, RadarrMovieFile, RunMode, ScanState } from './types'

/** A movie that has a file, keyed by the movieFileId the state file uses. */
export type Candidate = {
  key: string
  movie: RadarrMovie
  movieFile: RadarrMovieFile
}

/** Index every movie that has a file by its movieFileId. */
export function candidatesByKey(movies: RadarrMovie[]): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>()
  for (const movie of movies) {
    if (!movie.movieFile) continue
    const key = String(movie.movieFile.id)
    candidates.set(key, { key, movie, movieFile: movie.movieFile })
  }
  return candidates
}

/** Drop entries whose movie file is gone from Radarr, returning the dropped ones. */
export function pruneMissing(state: ScanState, currentKeys: Set<string>): MovieState[] {
  const removed: MovieState[] = []
  for (const key of Object.keys(state)) {
    if (!currentKeys.has(key)) {
      removed.push(state[key])
      delete state[key]
    }
  }
  return removed
}

/**
 * Where a file stands against the cache. A file Radarr replaced keeps its
 * movieFileId only sometimes, so size and dateAdded are compared too.
 */
export function libraryStatus(candidate: Candidate, cached: MovieState | undefined): LibraryStatus {
  if (!cached) return 'unscanned'
  const { size, dateAdded } = candidate.movieFile
  if (cached.size !== size || cached.dateAdded !== dateAdded) return 'changed'
  return cached.status
}

export function needsScan(candidate: Candidate, cached: MovieState | undefined, mode: RunMode): boolean {
  if (mode === 'all') return true
  const status = libraryStatus(candidate, cached)
  if (status === 'unscanned' || status === 'changed') return true
  return mode === 'recheck-corrupt' && status === 'corrupt'
}

export function selectPending(candidates: Map<string, Candidate>, state: ScanState, mode: RunMode): Candidate[] {
  return [...candidates.values()].filter((c) => needsScan(c, state[c.key], mode))
}
