import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanCancelledError, ScanError, scanFile } from './ffmpeg'

// A real child process stands in for ffmpeg, so exit codes, signals and
// stderr streaming behave as they would in production.
let tmpDir: string

async function fakeFfmpeg(script: string): Promise<void> {
  const file = path.join(tmpDir, 'ffmpeg')
  await fs.writeFile(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  vi.stubEnv('FFMPEG_PATH', file)
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('scanFile', () => {
  it('passes the file to a decode-only run', async () => {
    await fakeFfmpeg('echo "$@" > "$(dirname "$0")/args"')
    const result = await scanFile('/movies/a b.mkv')

    expect(result).toMatchObject({ errors: [], errorCount: 0 })
    expect((await fs.readFile(path.join(tmpDir, 'args'), 'utf8')).trim()).toBe(
      '-nostdin -v error -i /movies/a b.mkv -f null -'
    )
  })

  it('collects the non-blank stderr lines', async () => {
    await fakeFfmpeg('printf "corrupt frame\\n\\n  \\nbad nal\\n" >&2')
    expect(await scanFile('/a.mkv')).toMatchObject({ errors: ['corrupt frame', 'bad nal'], errorCount: 2 })
  })

  it('keeps only the first few lines but counts them all', async () => {
    await fakeFfmpeg('for i in $(seq 1 500); do echo "error $i" >&2; done')
    const result = await scanFile('/a.mkv')
    expect(result.errors).toEqual(['error 1', 'error 2', 'error 3', 'error 4', 'error 5'])
    expect(result.errorCount).toBe(500)
  })

  it('reports a silent ffmpeg failure', async () => {
    await fakeFfmpeg('exit 1')
    expect(await scanFile('/a.mkv')).toMatchObject({ errors: ['ffmpeg exited with status 1'], errorCount: 1 })
  })

  it('raises a ScanError when ffmpeg cannot be run at all', async () => {
    vi.stubEnv('FFMPEG_PATH', path.join(tmpDir, 'missing'))
    await expect(scanFile('/a.mkv')).rejects.toBeInstanceOf(ScanError)
  })

  it('raises a ScanError when something else kills ffmpeg', async () => {
    await fakeFfmpeg('kill -9 $$')
    await expect(scanFile('/a.mkv')).rejects.toThrow('ffmpeg was killed by SIGKILL.')
  })

  it('counts a timeout as an error in the file', async () => {
    await fakeFfmpeg('exec sleep 10')
    const result = await scanFile('/a.mkv', undefined, 100)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]).toMatch(/^ffmpeg timed out after/)
  })

  it('stops ffmpeg and records nothing when cancelled', async () => {
    await fakeFfmpeg('exec sleep 10')
    const controller = new AbortController()
    const scan = scanFile('/a.mkv', controller.signal)
    setTimeout(() => controller.abort(), 50)
    await expect(scan).rejects.toBeInstanceOf(ScanCancelledError)
  })
})
