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
const mono = { fontFamily: 'var(--font-geist-mono), monospace', fontSize: { xs: '0.72rem', sm: '0.8rem' } } as const
// On a phone the table keeps only movie + rescan; the rest moves under the title.
const wideOnly = { display: { xs: 'none', sm: 'table-cell' } } as const

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
      sx={{
        ...mono,
        m: 0,
        p: { xs: 1, sm: 1.5 },
        bgcolor: 'background.default',
        borderRadius: 1,
        overflow: 'auto',
        maxHeight: { xs: '50vh', sm: 400 },
      }}
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
    <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 4 } }}>
      <Typography variant="h5" component="h1" color="primary" sx={{ mb: { xs: 2, sm: 3 }, fontWeight: 'bold' }}>
        FFmpeg Validator
      </Typography>

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: 'wrap', mb: 3, '& > .MuiButton-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } } }}
      >
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
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 4, borderColor: 'info.main' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 2 }}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' }, mb: 1.5 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                Run #{active.id}: {runLabel(active, movies)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
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
        <Typography variant="h6" component="h2" color="primary" sx={{ flex: { xs: 1, sm: 'none' } }}>
          Library
        </Typography>
        {!libraryLoading && !libraryError && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: { xs: '1 0 100%', sm: 1 }, order: { xs: 1, sm: 0 } }}
          >
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
                <TableCell sx={{ ...narrow, ...wideOnly }}>Status</TableCell>
                <TableCell>Movie</TableCell>
                <TableCell sx={{ ...narrow, ...wideOnly }}>Size</TableCell>
                <TableCell sx={{ ...narrow, ...wideOnly }}>Scanned</TableCell>
                <TableCell sx={{ ...narrow, ...wideOnly }}>Took</TableCell>
                <TableCell sx={narrow} />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((m) => {
                const status = LIBRARY_STATUS[m.status]
                const scanning = active?.progress?.title === m.title
                return (
                  <TableRow key={m.key} hover>
                    <TableCell sx={{ ...narrow, ...wideOnly, color: status.tone, fontWeight: 500 }}>
                      {scanning ? 'Scanning…' : status.label}
                    </TableCell>
                    <TableCell sx={{ wordBreak: 'break-word', pr: { xs: 0, sm: 2 } }}>
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
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ display: { xs: 'block', sm: 'none' }, mt: 0.25 }}
                      >
                        <Box component="span" sx={{ color: status.tone, fontWeight: 500 }}>
                          {scanning ? 'Scanning…' : status.label}
                        </Box>
                        {' · '}
                        {formatBytes(m.size)}
                        {m.scannedAt && ` · ${formatDateTime(m.scannedAt)}`}
                        {m.scanSeconds !== null && ` · took ${formatDuration(m.scanSeconds)}`}
                      </Typography>
                      {m.errors.length > 0 && (
                        <Box sx={{ ...mono, color: 'error.light', mt: 0.5, overflowWrap: 'anywhere' }}>
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
                    <TableCell sx={{ ...narrow, ...wideOnly }}>{formatBytes(m.size)}</TableCell>
                    <TableCell sx={{ ...narrow, ...wideOnly }}>
                      {m.scannedAt ? formatDateTime(m.scannedAt) : '—'}
                    </TableCell>
                    <TableCell sx={{ ...narrow, ...wideOnly }}>
                      {m.scanSeconds !== null ? formatDuration(m.scanSeconds) : '—'}
                    </TableCell>
                    <TableCell sx={{ ...narrow, px: { xs: 0.5, sm: 2 } }}>
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
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: { xs: 1.5, sm: 2 } }}>
                <Box
                  sx={{
                    display: 'grid',
                    width: '100%',
                    alignItems: 'center',
                    columnGap: 1.5,
                    rowGap: 0.5,
                    gridTemplateColumns: { xs: 'auto 1fr auto', sm: '36px auto 1fr auto 90px' },
                    gridTemplateAreas: {
                      xs: '"id label status" ". when when" ". stats stats"',
                      sm: '"id when label stats status"',
                    },
                  }}
                >
                  <Typography sx={{ gridArea: 'id', color: 'text.disabled' }}>#{run.id}</Typography>
                  <Stack direction="row" spacing={1} sx={{ gridArea: 'when', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ minWidth: { sm: 150 }, color: { xs: 'text.secondary', sm: 'text.primary' } }}>
                      {formatDateTime(run.startedAt)}
                    </Typography>
                    <Chip label={run.options.trigger} size="small" variant="outlined" />
                  </Stack>
                  <Typography variant="body2" sx={{ gridArea: 'label', minWidth: 0, overflowWrap: 'anywhere' }}>
                    {runLabel(run, movies)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ gridArea: 'stats' }}>
                    {run.scanned} scanned
                    {run.corrupt > 0 && (
                      <Box component="span" sx={{ color: 'error.main' }}>
                        {' '}
                        · {run.corrupt} corrupt
                      </Box>
                    )}
                    {run.finishedAt && ` · ${formatDuration(secondsBetween(run.startedAt, run.finishedAt))}`}
                  </Typography>
                  <Typography variant="body2" sx={{ gridArea: 'status', color: status.tone, fontWeight: 500 }}>
                    {status.label}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ px: { xs: 1, sm: 2 } }}>
                <RunLog run={run} />
              </AccordionDetails>
            </Accordion>
          )
        })
      )}
    </Container>
  )
}
