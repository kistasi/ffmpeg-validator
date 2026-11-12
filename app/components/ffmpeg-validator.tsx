'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryMovie, LibraryResponse, Run, RunMode, RunsResponse } from '@/lib/types'
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatTime,
  LIBRARY_STATUS,
  RUN_MODE,
  RUN_STATUS,
  secondsBetween,
} from '@/lib/format'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import StopIcon from '@mui/icons-material/Stop'

// Collapse a column to its content, for the narrow status/number columns.
const narrow = { width: '1px', whiteSpace: 'nowrap' } as const
const mono = { fontFamily: 'var(--font-geist-mono), monospace', fontSize: '0.8rem' } as const

// Fast while a scan is going so progress stays live; slow otherwise, only to
// notice the run cron starts at 07:00.
const ACTIVE_POLL_MS = 3_000
const IDLE_POLL_MS = 30_000

type Filter = 'problems' | 'all'

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`)
  return data as T
}

function runLabel(run: Run, movies: LibraryMovie[]): string {
  if (run.options.movieFileId === undefined) return RUN_MODE[run.options.mode]
  const movie = movies.find((m) => m.key === run.options.movieFileId)
  return `Rescan ${movie?.title ?? `file #${run.options.movieFileId}`}`
}

function RunLog({ run }: { run: Run }) {
  return (
    <Box
      component="pre"
      sx={{ ...mono, m: 0, p: 1.5, bgcolor: 'background.default', borderRadius: 1, overflowX: 'auto', maxHeight: 400 }}
    >
      {run.log.map((line) => `${formatTime(line.at)}  ${line.message}`).join('\n') || 'No output yet.'}
    </Box>
  )
}

export default function FfmpegValidator() {
  const [movies, setMovies] = useState<LibraryMovie[]>([])
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [runs, setRuns] = useState<Run[]>([])
  const [active, setActive] = useState<Run | null>(null)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('problems')
  const [starting, setStarting] = useState(false)

  const loadLibrary = useCallback(async () => {
    try {
      const data = await getJson<LibraryResponse>('/api/library')
      setMovies(data.movies)
      setLibraryError(null)
    } catch (err) {
      setLibraryError((err as Error).message)
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const data = await getJson<RunsResponse>('/api/runs')
      setRuns(data.runs)
      setActive(data.active)
      setRunsError(null)
    } catch (err) {
      setRunsError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    // Loading on mount is exactly what these effects are for; the setState
    // calls happen after the fetch resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLibrary()
    void loadRuns()
  }, [loadLibrary, loadRuns])

  const activeId = active?.id ?? null
  useEffect(() => {
    const timer = setInterval(() => void loadRuns(), activeId === null ? IDLE_POLL_MS : ACTIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [activeId, loadRuns])

  // Results land in the library as each file finishes; refresh it when a run
  // ends, and whenever another file has been scanned.
  const scanned = active?.scanned ?? null
  const previous = useRef<{ id: number | null; scanned: number | null }>({ id: null, scanned: null })
  useEffect(() => {
    const prev = previous.current
    previous.current = { id: activeId, scanned }
    if ((prev.id !== null && prev.id !== activeId) || (activeId !== null && scanned !== prev.scanned && prev.scanned !== null)) {
      void loadLibrary()
    }
  }, [activeId, scanned, loadLibrary])

  const start = async (body: { mode: RunMode; movieFileId?: string }) => {
    setStarting(true)
    try {
      await getJson('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, trigger: 'manual' }),
      })
    } catch (err) {
      window.alert((err as Error).message)
    } finally {
      await loadRuns()
      setStarting(false)
    }
  }

  const rescanAll = () => {
    const minutes = movies.reduce((sum, m) => sum + (m.scanSeconds ?? 0), 0) / 60
    const estimate = minutes > 0 ? ` The last full pass took about ${formatDuration(minutes * 60)}.` : ''
    if (window.confirm(`Rescan all ${movies.length} files?${estimate}`)) void start({ mode: 'all' })
  }

  const stop = async () => {
    if (!window.confirm('Stop the running scan? The file being scanned keeps its previous result.')) return
    try {
      await getJson('/api/runs/active', { method: 'DELETE' })
    } catch (err) {
      window.alert((err as Error).message)
    }
    await loadRuns()
  }

  const counts = {
    clean: movies.filter((m) => m.status === 'clean').length,
    corrupt: movies.filter((m) => m.status === 'corrupt').length,
    pending: movies.filter((m) => m.status === 'unscanned' || m.status === 'changed').length,
  }
  const shown = filter === 'all' ? movies : movies.filter((m) => m.status !== 'clean')
  const busy = active !== null || starting
  const lastRun = runs.find((r) => r.status !== 'running')

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 4 } }}>
      <Typography variant="h5" component="h1" color="primary" sx={{ mb: 3, fontWeight: 'bold' }}>
        FFmpeg Validator
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 3 }}>
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          disabled={busy}
          onClick={() => start({ mode: 'changed' })}
        >
          Scan new &amp; replaced
        </Button>
        <Button variant="outlined" disabled={busy || counts.corrupt === 0} onClick={() => start({ mode: 'recheck-corrupt' })}>
          Recheck corrupt
        </Button>
        <Button variant="outlined" color="warning" disabled={busy || movies.length === 0} onClick={rescanAll}>
          Rescan all
        </Button>
      </Stack>

      {runsError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {runsError}
        </Alert>
      )}

      {active ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 4, borderColor: 'info.main' }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                Run #{active.id}: {runLabel(active, movies)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {active.progress
                  ? `Scanning ${active.progress.index} of ${active.progress.total}: ${active.progress.title}`
                  : 'Preparing…'}
                {' · started '}
                {formatDateTime(active.startedAt)}
              </Typography>
            </Box>
            <Button color="error" variant="outlined" startIcon={<StopIcon />} onClick={stop}>
              Stop
            </Button>
          </Stack>
          <LinearProgress
            variant={active.progress ? 'determinate' : 'indeterminate'}
            value={active.progress ? ((active.progress.index - 1) / active.progress.total) * 100 : undefined}
            sx={{ mb: 1.5 }}
          />
          <RunLog run={active} />
        </Paper>
      ) : (
        lastRun && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last run #{lastRun.id} {RUN_STATUS[lastRun.status].label.toLowerCase()}{' '}
            {lastRun.finishedAt ? formatDateTime(lastRun.finishedAt) : ''}
            {lastRun.error ? `: ${lastRun.error}` : ''}
          </Typography>
        )
      )}

      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
        <Typography variant="h6" component="h2" color="primary">
          Library
        </Typography>
        {!libraryLoading && !libraryError && (
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {movies.length} files · {counts.clean} clean ·{' '}
            <Box component="span" sx={{ color: counts.corrupt ? 'error.main' : undefined }}>
              {counts.corrupt} corrupt
            </Box>{' '}
            · {counts.pending} waiting for a scan
          </Typography>
        )}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_event, value: Filter | null) => value && setFilter(value)}
        >
          <ToggleButton value="problems">Needs attention</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {libraryLoading ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
          <CircularProgress size={20} />
          <span>Fetching library…</span>
        </Stack>
      ) : libraryError ? (
        <Alert severity="error">{libraryError}</Alert>
      ) : shown.length === 0 ? (
        <Typography color="text.secondary">
          {movies.length === 0 ? 'Radarr has no movie files.' : 'Every file is clean.'}
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={narrow}>Status</TableCell>
                <TableCell>Movie</TableCell>
                <TableCell sx={narrow}>Size</TableCell>
                <TableCell sx={narrow}>Scanned</TableCell>
                <TableCell sx={narrow}>Took</TableCell>
                <TableCell sx={narrow} />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((m) => {
                const status = LIBRARY_STATUS[m.status]
                const scanning = active?.progress?.title === m.title
                return (
                  <TableRow key={m.key} hover>
                    <TableCell sx={{ ...narrow, color: status.tone, fontWeight: 500 }}>
                      {scanning ? 'Scanning…' : status.label}
                    </TableCell>
                    <TableCell sx={{ wordBreak: 'break-word' }}>
                      {m.radarrUrl ? (
                        <Link href={m.radarrUrl} target="_blank" rel="noopener">
                          {m.title}
                        </Link>
                      ) : (
                        m.title
                      )}
                      {m.year !== null && (
                        <Typography component="span" variant="body2" color="text.secondary">
                          {' '}
                          ({m.year})
                        </Typography>
                      )}
                      {m.errors.length > 0 && (
                        <Box sx={{ ...mono, color: 'error.light', mt: 0.5 }}>
                          {m.errors.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                          {m.errorCount > m.errors.length && (
                            <Box sx={{ color: 'text.secondary' }}>
                              …and {m.errorCount - m.errors.length} more line(s)
                            </Box>
                          )}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={narrow}>{formatBytes(m.size)}</TableCell>
                    <TableCell sx={narrow}>{m.scannedAt ? formatDateTime(m.scannedAt) : '—'}</TableCell>
                    <TableCell sx={narrow}>{m.scanSeconds !== null ? formatDuration(m.scanSeconds) : '—'}</TableCell>
                    <TableCell sx={narrow}>
                      <Tooltip title="Rescan this file">
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`Rescan ${m.title}`}
                            disabled={busy}
                            onClick={() => start({ mode: 'changed', movieFileId: m.key })}
                          >
                            <RefreshIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="h6" component="h2" color="primary" sx={{ mt: 5, mb: 1.5 }}>
        Runs
      </Typography>
      {runs.length === 0 ? (
        <Typography color="text.secondary">No runs yet.</Typography>
      ) : (
        runs.map((run) => {
          const status = RUN_STATUS[run.status]
          return (
            <Accordion key={run.id} disableGutters variant="outlined" slotProps={{ transition: { unmountOnExit: true } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                  <Typography sx={{ color: 'text.disabled', minWidth: 36 }}>#{run.id}</Typography>
                  <Typography sx={{ minWidth: 150 }}>{formatDateTime(run.startedAt)}</Typography>
                  <Chip label={run.options.trigger} size="small" variant="outlined" />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {runLabel(run, movies)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {run.scanned} scanned
                    {run.corrupt > 0 && (
                      <Box component="span" sx={{ color: 'error.main' }}>
                        {' '}
                        · {run.corrupt} corrupt
                      </Box>
                    )}
                    {run.finishedAt && ` · ${formatDuration(secondsBetween(run.startedAt, run.finishedAt))}`}
                  </Typography>
                  <Typography variant="body2" sx={{ color: status.tone, fontWeight: 500, minWidth: 90 }}>
                    {status.label}
                  </Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <RunLog run={run} />
              </AccordionDetails>
            </Accordion>
          )
        })
      )}
    </Container>
  )
}
