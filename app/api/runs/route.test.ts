import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'
import { DELETE } from './active/route'
import { cancelRun, listRuns, RunInProgressError, startRun } from '@/lib/validator'
import type { Run } from '@/lib/types'

vi.mock('@/lib/validator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/validator')>()),
  listRuns: vi.fn(),
  startRun: vi.fn(),
  cancelRun: vi.fn(),
}))

const run: Run = {
  id: 3,
  options: { mode: 'changed', trigger: 'cron' },
  status: 'running',
  startedAt: '2026-11-12T06:00:00.000Z',
  finishedAt: null,
  progress: null,
  scanned: 0,
  corrupt: 0,
  error: null,
  log: [],
}

function post(body?: unknown) {
  return POST(
    new Request('http://localhost/api/runs', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(startRun).mockResolvedValue(run)
})

describe('/api/runs', () => {
  it('lists runs', async () => {
    vi.mocked(listRuns).mockResolvedValue({ active: run, runs: [run] })
    expect(await (await GET()).json()).toEqual({ active: run, runs: [run] })
  })

  it('starts a manual run of new and replaced files by default', async () => {
    const res = await post()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ run })
    expect(startRun).toHaveBeenCalledWith({ mode: 'changed', trigger: 'manual' })
  })

  it('passes the mode, trigger and file through', async () => {
    await post({ mode: 'recheck-corrupt', trigger: 'cron' })
    await post({ mode: 'changed', movieFileId: '42' })
    expect(vi.mocked(startRun).mock.calls).toEqual([
      [{ mode: 'recheck-corrupt', trigger: 'cron' }],
      [{ mode: 'changed', trigger: 'manual', movieFileId: '42' }],
    ])
  })

  it('rejects bad input', async () => {
    expect((await post({ mode: 'everything' })).status).toBe(400)
    expect((await post({ trigger: 'webhook' })).status).toBe(400)
    expect((await post({ movieFileId: 42 })).status).toBe(400)
    expect((await post({ movieFileId: '../x' })).status).toBe(400)
    expect(startRun).not.toHaveBeenCalled()
  })

  it('answers 409 while another run is in progress', async () => {
    vi.mocked(startRun).mockRejectedValue(new RunInProgressError(run))
    const res = await post({ trigger: 'cron' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Run #3 is still in progress.', run })
  })

  it('cancels the active run, or says there is none', async () => {
    vi.mocked(cancelRun).mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect((await DELETE()).status).toBe(200)
    expect((await DELETE()).status).toBe(404)
  })
})
