import { promises as fs } from 'fs'
import { dirname } from 'path'

/**
 * Move a file to `dest` such that `dest` never appears partially written.
 * Fast path: rename (atomic, same filesystem). Cross-device fallback: copy to a
 * temporary sibling of `dest`, then atomically rename into place, then remove
 * the source. This preserves crash-safety at the destination.
 */
export async function moveAtomic(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest)
    return
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'EXDEV') throw err
  }
  const part = dest + '.part-' + Date.now()
  await fs.mkdir(dirname(dest), { recursive: true })
  await fs.copyFile(src, part)
  await fs.rename(part, dest)
  await fs.rm(src, { force: true })
}
