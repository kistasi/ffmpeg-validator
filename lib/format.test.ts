import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, secondsBetween } from './format'

describe('format', () => {
  it('formats sizes', () => {
    expect(formatBytes(7499695781)).toBe('7.0 GB')
    expect(formatBytes(700 * 1024 ** 2)).toBe('700 MB')
  })

  it('formats durations', () => {
    expect(formatDuration(45.4)).toBe('45s')
    expect(formatDuration(492)).toBe('8m 12s')
    expect(formatDuration(3900)).toBe('1h 05m')
  })

  it('measures time between timestamps', () => {
    expect(secondsBetween('2026-11-12T06:00:00.000Z', '2026-11-12T06:10:30.000Z')).toBe(630)
  })
})
