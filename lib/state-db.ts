import path from 'node:path'
import { readJson, writeJson } from './json-file'
import type { ScanState } from './types'

// Lives at <project root>/data/scan-state.json, in the mounted data volume.
const STATE_PATH = path.join(process.cwd(), 'data', 'scan-state.json')

export async function loadState(): Promise<ScanState> {
  return readJson<ScanState>(STATE_PATH, {})
}

export async function saveState(state: ScanState): Promise<void> {
  await writeJson(STATE_PATH, state)
}
