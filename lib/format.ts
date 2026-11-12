import type { LibraryStatus, RunMode, RunStatus } from './types'

/** Colors as MUI palette paths. */
export type Tone = 'text.secondary' | 'success.main' | 'info.main' | 'warning.main' | 'error.main'

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

/** A compact duration: 45s, 8m 12s, 1h 05m. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/**
 * Seconds between two timestamps. The Python script this app replaced stored
 * local time without an offset; both forms parse as the viewer's local time,
 * which is the server's too.
 */
export function secondsBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('en-GB')
}

export const LIBRARY_STATUS: Record<LibraryStatus, { label: string; tone: Tone }> = {
  clean: { label: 'Clean', tone: 'success.main' },
  corrupt: { label: 'Corrupt', tone: 'error.main' },
  unscanned: { label: 'Not scanned', tone: 'warning.main' },
  changed: { label: 'Replaced', tone: 'warning.main' },
}

export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'info.main' },
  completed: { label: 'Completed', tone: 'success.main' },
  failed: { label: 'Failed', tone: 'error.main' },
  cancelled: { label: 'Cancelled', tone: 'text.secondary' },
  interrupted: { label: 'Interrupted', tone: 'warning.main' },
}

export const RUN_MODE: Record<RunMode, string> = {
  changed: 'New & replaced',
  'recheck-corrupt': 'Recheck corrupt',
  all: 'Rescan all',
}
