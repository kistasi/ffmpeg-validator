import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Read a JSON file, treating a missing or empty one as `fallback`. */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return raw.trim() === '' ? fallback : (JSON.parse(raw) as T)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

let tmpCounter = 0

/**
 * Write a JSON file atomically: a scan runs for hours and the container can be
 * stopped at any point, which must not leave a half-written file behind. Each
 * write gets its own temp file, so two overlapping writes can't share one.
 */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
}
