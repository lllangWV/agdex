import { describe, expect, it } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { injectIndex } from '../agents-md'
import { createStatusReport } from '../index-maintenance'
import {
  createIndexId,
  readIndexLockfile,
  upsertIndexLockEntry,
} from '../lockfile'

describe('index maintenance', () => {
  it('round-trips lockfile entries with stable ids and relative local cache paths', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-lock-test-'))
    const cacheDir = path.join(tempDir, '.agdex', 'nextjs')
    fs.mkdirSync(cacheDir, { recursive: true })

    try {
      const entry = upsertIndexLockEntry(tempDir, {
        id: createIndexId('docs', 'nextjs', 'AGENTS.md'),
        kind: 'docs',
        source: {
          type: 'builtin-provider',
          name: 'nextjs',
          displayName: 'Next.js',
          repo: 'vercel/next.js',
          docsPath: 'docs',
          version: '15.0.0',
          versionMode: 'pinned',
        },
        targetFile: 'AGENTS.md',
        marker: 'nextjs',
        cachePath: cacheDir,
        command: 'npx agdex --provider nextjs --output AGENTS.md',
      })

      const lockfile = readIndexLockfile(tempDir)

      expect(entry.id).toBe('docs:nextjs:AGENTS.md')
      expect(lockfile.schemaVersion).toBe(1)
      expect(lockfile.indexes).toHaveLength(1)
      expect(lockfile.indexes[0].cachePath).toBe('.agdex/nextjs')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports ok for lockfile entries with target markers and cache', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-status-test-'))
    const cacheDir = path.join(tempDir, '.agdex', 'nextjs')
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'guide.md'), '# Guide')
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      injectIndex('# Project\n', '[Next.js Docs Index]|root: ./.agdex/nextjs|docs:{guide.md}', 'nextjs')
    )

    try {
      upsertIndexLockEntry(tempDir, {
        id: createIndexId('docs', 'nextjs', 'AGENTS.md'),
        kind: 'docs',
        source: { type: 'builtin-provider', name: 'nextjs', displayName: 'Next.js' },
        targetFile: 'AGENTS.md',
        marker: 'nextjs',
        cachePath: cacheDir,
      })

      const report = createStatusReport({ cwd: tempDir })

      expect(report.scannedFiles).toContain('AGENTS.md')
      expect(report.indexes).toHaveLength(1)
      expect(report.indexes[0].health).toBe('ok')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('reports missing cache and untracked markers', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-status-test-'))
    fs.writeFileSync(
      path.join(tempDir, 'AGENTS.md'),
      injectIndex('# Project\n', '[Next.js Docs Index]|root: ./.agdex/nextjs|docs:{guide.md}', 'nextjs')
    )

    try {
      upsertIndexLockEntry(tempDir, {
        id: createIndexId('docs', 'react', 'AGENTS.md'),
        kind: 'docs',
        source: { type: 'builtin-provider', name: 'react', displayName: 'React' },
        targetFile: 'AGENTS.md',
        marker: 'react',
        cachePath: '.agdex/react',
      })

      const report = createStatusReport({ cwd: tempDir })

      expect(report.indexes.map((index) => index.health).sort()).toEqual([
        'missing-marker',
        'untracked-marker',
      ])
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
