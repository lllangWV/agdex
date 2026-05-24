import fs from 'fs'
import path from 'path'

export const LOCKFILE_SCHEMA_VERSION = 1
export const LOCKFILE_RELATIVE_PATH = path.join('.agdex', 'agdex.lock')

export type IndexSourceType =
  | 'builtin-provider'
  | 'github-docs'
  | 'local-docs'
  | 'url-docs'
  | 'skills-local'
  | 'skills-sh'

export interface IndexLockSource {
  type: IndexSourceType
  name: string
  displayName?: string
  repo?: string
  docsPath?: string
  url?: string
  version?: string
  versionMode?: 'auto' | 'pinned' | 'default-branch' | 'unknown'
}

export interface IndexLockEntry {
  id: string
  kind: 'docs' | 'skills'
  source: IndexLockSource
  targetFile: string
  marker: string
  cachePath: string
  command?: string
  updatedAt: string
}

export interface IndexLockfile {
  schemaVersion: number
  indexes: IndexLockEntry[]
}

export function getLockfilePath(cwd: string): string {
  return path.join(cwd, LOCKFILE_RELATIVE_PATH)
}

export function createIndexId(kind: 'docs' | 'skills', sourceName: string, targetFile: string): string {
  return `${kind}:${sourceName}:${normalizeRelativePath(targetFile)}`
}

export function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export function toStoredPath(cwd: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return normalizeRelativePath(filePath)
  }

  const relative = path.relative(cwd, filePath)
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return normalizeRelativePath(relative)
  }

  return filePath
}

export function resolveStoredPath(cwd: string, storedPath: string): string {
  return path.isAbsolute(storedPath) ? storedPath : path.join(cwd, storedPath)
}

export function readIndexLockfile(cwd: string): IndexLockfile {
  const lockfilePath = getLockfilePath(cwd)
  if (!fs.existsSync(lockfilePath)) {
    return { schemaVersion: LOCKFILE_SCHEMA_VERSION, indexes: [] }
  }

  const parsed = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8')) as Partial<IndexLockfile>
  return {
    schemaVersion: parsed.schemaVersion || LOCKFILE_SCHEMA_VERSION,
    indexes: Array.isArray(parsed.indexes) ? parsed.indexes : [],
  }
}

export function writeIndexLockfile(cwd: string, lockfile: IndexLockfile): void {
  const lockfilePath = getLockfilePath(cwd)
  fs.mkdirSync(path.dirname(lockfilePath), { recursive: true })
  const normalized: IndexLockfile = {
    schemaVersion: LOCKFILE_SCHEMA_VERSION,
    indexes: [...lockfile.indexes].sort((a, b) => a.id.localeCompare(b.id)),
  }
  fs.writeFileSync(lockfilePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
}

export function upsertIndexLockEntry(cwd: string, entry: Omit<IndexLockEntry, 'updatedAt'>): IndexLockEntry {
  const lockfile = readIndexLockfile(cwd)
  const nextEntry: IndexLockEntry = {
    ...entry,
    targetFile: normalizeRelativePath(entry.targetFile),
    cachePath: toStoredPath(cwd, entry.cachePath),
    updatedAt: new Date().toISOString(),
  }
  const existingIndex = lockfile.indexes.findIndex((candidate) => candidate.id === nextEntry.id)

  if (existingIndex === -1) {
    lockfile.indexes.push(nextEntry)
  } else {
    lockfile.indexes[existingIndex] = nextEntry
  }

  writeIndexLockfile(cwd, lockfile)
  return nextEntry
}
