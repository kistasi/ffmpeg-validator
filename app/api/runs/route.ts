import { NextResponse } from 'next/server'
import { listRuns, RunInProgressError, startRun } from '@/lib/validator'
import type { RunMode, RunOptions, RunTrigger } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MODES: RunMode[] = ['changed', 'recheck-corrupt', 'all']
const TRIGGERS: RunTrigger[] = ['cron', 'manual']

export async function GET() {
  return NextResponse.json(await listRuns())
}

/**
 * Start a run. This is what cron calls, so a run already in progress answers
 * 409 (which makes `curl -f` fail and leave a line in the cron log) instead of
 * queueing a second one, as `flock -n` did for the Python script.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: unknown
    trigger?: unknown
    movieFileId?: unknown
  } | null

  const mode = body?.mode ?? 'changed'
  const trigger = body?.trigger ?? 'manual'
  const movieFileId = body?.movieFileId

  if (!MODES.includes(mode as RunMode)) {
    return NextResponse.json({ error: `\`mode\` must be one of ${MODES.join(', ')}.` }, { status: 400 })
  }
  if (!TRIGGERS.includes(trigger as RunTrigger)) {
    return NextResponse.json({ error: `\`trigger\` must be one of ${TRIGGERS.join(', ')}.` }, { status: 400 })
  }
  if (movieFileId !== undefined && !(typeof movieFileId === 'string' && /^\d+$/.test(movieFileId))) {
    return NextResponse.json({ error: '`movieFileId` must be a numeric string.' }, { status: 400 })
  }

  const options: RunOptions = { mode: mode as RunMode, trigger: trigger as RunTrigger }
  if (movieFileId !== undefined) options.movieFileId = movieFileId

  try {
    const run = await startRun(options)
    return NextResponse.json({ run }, { status: 202 })
  } catch (err) {
    if (err instanceof RunInProgressError) {
      return NextResponse.json({ error: err.message, run: err.run }, { status: 409 })
    }
    throw err
  }
}
