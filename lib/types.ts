// Shared, low-dependency types safe to import from both server and client code.

export type ScanStatus = 'clean' | 'corrupt'

/**
 * The cached result of one decode check, keyed in the state file by Radarr's
 * movieFileId. The snake_case fields keep the format of the Python script this
 * app replaced, so its state file carries over as-is.
 */
export type MovieState = {
  title: string
  path: string
  size: number
  dateAdded: string
  status: ScanStatus
  scanned_at: string
  scan_seconds: number
  /** The first few lines ffmpeg complained with. */
  errors: string[]
  /** How many lines it complained with in all; absent in older entries. */
  error_count?: number
}

export type ScanState = Record<string, MovieState>

export type RadarrMovieFile = {
  id: number
  size: number
  dateAdded: string
  path: string
}

/** The subset of Radarr's movie resource this app uses. */
export type RadarrMovie = {
  id: number
  title: string
  year?: number
  titleSlug?: string
  tags: number[]
  movieFile?: RadarrMovieFile
}

/**
 * Where a movie file stands: its last scan result, or why it is due a scan
 * (never scanned, or replaced since it was).
 */
export type LibraryStatus = ScanStatus | 'unscanned' | 'changed'

export type LibraryMovie = {
  /** Radarr's movieFileId, as a string: the state file's key. */
  key: string
  movieId: number
  title: string
  year: number | null
  path: string
  size: number
  status: LibraryStatus
  scannedAt: string | null
  scanSeconds: number | null
  errors: string[]
  errorCount: number
  /** Link to the movie's page in Radarr, if RADARR_PUBLIC_URL is set. */
  radarrUrl: string | null
}

export type LibraryResponse = {
  movies: LibraryMovie[]
}

/**
 * Which files a run scans, on top of new and replaced ones (always scanned):
 * nothing else, the ones last found corrupt, or every file.
 */
export type RunMode = 'changed' | 'recheck-corrupt' | 'all'

export type RunTrigger = 'cron' | 'manual'

export type RunOptions = {
  mode: RunMode
  trigger: RunTrigger
  /** Scan only this movie file, cached or not. */
  movieFileId?: string
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export type LogLine = {
  at: string
  message: string
}

export type Run = {
  id: number
  options: RunOptions
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  /** Set while a file is being decoded. */
  progress: { index: number; total: number; title: string } | null
  scanned: number
  corrupt: number
  error: string | null
  log: LogLine[]
}

export type RunsResponse = {
  active: Run | null
  runs: Run[]
}
