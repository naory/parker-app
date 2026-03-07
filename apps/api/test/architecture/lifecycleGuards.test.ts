import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { db } from '../../src/db'

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(fullPath)
      }
      if (entry.isFile() && fullPath.endsWith('.ts')) {
        return [fullPath]
      }
      return []
    }),
  )
  return files.flat()
}

describe('session lifecycle architecture guards', () => {
  it('db does not expose legacy endSession helper', () => {
    const dbRecord = db as Record<string, unknown>
    expect(dbRecord.endSession).toBeUndefined()
    expect('endSession' in dbRecord).toBe(false)
  })

  it('ban direct db.transitionSession outside lifecycle engine', async () => {
    const srcRoot = path.resolve(process.cwd(), 'src')
    const files = await collectTypeScriptFiles(srcRoot)
    const allowedCaller = path.normalize(path.join('services', 'sessionLifecycle.ts'))

    const offenders: string[] = []
    for (const filePath of files) {
      const normalized = path.normalize(filePath)
      if (normalized.endsWith(allowedCaller)) continue
      const content = await readFile(filePath, 'utf8')
      if (content.includes('db.transitionSession(')) {
        offenders.push(path.relative(process.cwd(), filePath))
      }
    }

    expect(offenders).toEqual([])
  })
})
