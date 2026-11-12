import { NextResponse } from 'next/server'
import { getLibrary } from '@/lib/library'
import { RadarrError } from '@/lib/radarr'

// Live data from Radarr, so it must run per-request.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ movies: await getLibrary() })
  } catch (err) {
    if (err instanceof RadarrError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    throw err
  }
}
