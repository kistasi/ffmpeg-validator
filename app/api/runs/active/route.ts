import { NextResponse } from 'next/server'
import { cancelRun } from '@/lib/validator'

export const dynamic = 'force-dynamic'

/** Stop the active run; the file being decoded keeps its previous result. */
export async function DELETE() {
  if (!cancelRun()) {
    return NextResponse.json({ error: 'No run is in progress.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
