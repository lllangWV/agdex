import fs from 'fs'
import path from 'path'
import { getDefaultOutput } from './config'
import {
  type IndexLockEntry,
  type IndexLockfile,
  readIndexLockfile,
  resolveStoredPath,
} from './lockfile'

const DOCS_MARKER_REGEX = /<!-- AGENTS-MD-EMBED-START:(\S+?) -->/g
const SKILLS_START_MARKER = '<!-- AGENTS-MD-SKILLS-START -->'

/**
 * File the full docs indices live in under the progressive-disclosure strategy.
 * Kept in sync with DEFAULT_DOC_INDEX_FILE in agents-md.ts.
 */
const DOC_INDEX_FILE = 'DOCINDEX.md'

/**
 * Read the docs marker names present in DOCINDEX.md. Under progressive
 * disclosure the full per-provider index blocks live here rather than inline
 * in the agent instruction file.
 */
export function readDocIndexMarkers(cwd: string): Set<string> {
  const docIndexPath = path.join(cwd, DOC_INDEX_FILE)
  const names = new Set<string>()
  if (!fs.existsSync(docIndexPath)) return names

  const content = fs.readFileSync(docIndexPath, 'utf-8')
  const regex = new RegExp(DOCS_MARKER_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    names.add(match[1])
  }
  return names
}

export type IndexHealth =
  | 'ok'
  | 'missing-target'
  | 'missing-marker'
  | 'missing-cache'
  | 'stale-lockfile-entry'
  | 'untracked-marker'
  | 'needs-migration'

export interface EmbeddedMarker {
  kind: 'docs' | 'skills'
  marker: string
  targetFile: string
}

export interface IndexStatus {
  id: string
  kind: 'docs' | 'skills'
  health: IndexHealth
  targetFile: string
  marker: string
  cachePath?: string
  source?: IndexLockEntry['source']
  command?: string
  suggestedAction: string
  lockfileEntry?: IndexLockEntry
}

export interface StatusReport {
  cwd: string
  lockfilePath: string
  scannedFiles: string[]
  indexes: IndexStatus[]
}

export interface StatusOptions {
  cwd: string
  targetFile?: string
}

export function getDefaultStatusTargets(cwd: string): string[] {
  const targets = [
    getDefaultOutput(cwd),
    'AGENTS.md',
    'AGENTS.local.md',
    'CLAUDE.md',
    'CLAUDE.local.md',
  ]

  return [...new Set(targets)]
}

export function readEmbeddedMarkers(cwd: string, targetFile: string): EmbeddedMarker[] {
  const targetPath = path.join(cwd, targetFile)
  if (!fs.existsSync(targetPath)) return []

  const content = fs.readFileSync(targetPath, 'utf-8')
  const markers: EmbeddedMarker[] = []
  let match: RegExpExecArray | null

  while ((match = DOCS_MARKER_REGEX.exec(content)) !== null) {
    markers.push({ kind: 'docs', marker: match[1], targetFile })
  }

  if (content.includes(SKILLS_START_MARKER)) {
    markers.push({ kind: 'skills', marker: 'skills', targetFile })
  }

  return markers
}

export function createStatusReport(options: StatusOptions): StatusReport {
  const { cwd } = options
  const lockfile = readIndexLockfile(cwd)
  const scannedFiles = options.targetFile
    ? [options.targetFile]
    : getScannedFiles(cwd, lockfile)

  const markers = scannedFiles.flatMap((targetFile) => readEmbeddedMarkers(cwd, targetFile))
  // Under progressive disclosure the docs marker blocks live in DOCINDEX.md
  // rather than inline in the agent file, so check there too.
  const docIndexMarkers = readDocIndexMarkers(cwd)
  const indexes: IndexStatus[] = []
  const seenMarkers = new Set<string>()
  const trackedDocsMarkers = new Set<string>()

  for (const entry of lockfile.indexes) {
    if (options.targetFile && entry.targetFile !== options.targetFile) continue

    const markerKey = getMarkerKey(entry.kind, entry.marker, entry.targetFile)
    const markerInFile = markers.find(
      (candidate) =>
        candidate.kind === entry.kind &&
        candidate.marker === entry.marker &&
        candidate.targetFile === entry.targetFile
    )
    // Docs markers are considered present if they exist inline (legacy) or in
    // the shared DOCINDEX.md (progressive disclosure).
    const hasMarker =
      entry.kind === 'docs'
        ? Boolean(markerInFile) || docIndexMarkers.has(entry.marker)
        : Boolean(markerInFile)
    if (markerInFile) seenMarkers.add(markerKey)
    if (entry.kind === 'docs') trackedDocsMarkers.add(entry.marker)

    indexes.push(analyzeLockfileEntry(cwd, entry, hasMarker))
  }

  for (const marker of markers) {
    const markerKey = getMarkerKey(marker.kind, marker.marker, marker.targetFile)
    if (seenMarkers.has(markerKey)) continue

    indexes.push({
      id: `untracked:${marker.kind}:${marker.marker}:${marker.targetFile}`,
      kind: marker.kind,
      health: 'untracked-marker',
      targetFile: marker.targetFile,
      marker: marker.marker,
      suggestedAction: 'Run `agdex migrate` or rerun the embed command to create a lockfile entry.',
    })
  }

  // Surface docs indices that exist in DOCINDEX.md but have no lockfile entry.
  for (const name of docIndexMarkers) {
    if (trackedDocsMarkers.has(name)) continue

    indexes.push({
      id: `untracked:docs:${name}:${DOC_INDEX_FILE}`,
      kind: 'docs',
      health: 'untracked-marker',
      targetFile: DOC_INDEX_FILE,
      marker: name,
      suggestedAction: 'Run `agdex migrate` or rerun the embed command to create a lockfile entry.',
    })
  }

  return {
    cwd,
    lockfilePath: path.join(cwd, '.agdex', 'agdex.lock'),
    scannedFiles,
    indexes: indexes.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

function getScannedFiles(cwd: string, lockfile: IndexLockfile): string[] {
  const targets = [
    ...lockfile.indexes.map((entry) => entry.targetFile),
    ...getDefaultStatusTargets(cwd),
  ]
  return [...new Set(targets)].filter((target) => fs.existsSync(path.join(cwd, target)))
}

function analyzeLockfileEntry(cwd: string, entry: IndexLockEntry, hasMarker: boolean): IndexStatus {
  const targetExists = fs.existsSync(path.join(cwd, entry.targetFile))
  const cachePath = resolveStoredPath(cwd, entry.cachePath)
  const cacheExists = fs.existsSync(cachePath)

  let health: IndexHealth = 'ok'
  let suggestedAction = 'No action needed.'

  if (!targetExists) {
    health = 'missing-target'
    suggestedAction = 'Rerun the original embed command or remove this stale lockfile entry.'
  } else if (!hasMarker) {
    health = 'missing-marker'
    suggestedAction = 'Run `agdex refresh --repair` or rerun the original embed command.'
  } else if (!cacheExists) {
    health = 'missing-cache'
    suggestedAction = 'Run `agdex refresh` to rebuild the documentation cache.'
  } else if (entry.kind === 'docs' && !hasReadableCache(cachePath)) {
    health = 'stale-lockfile-entry'
    suggestedAction = 'Run `agdex refresh --force` or remove this stale lockfile entry.'
  }

  return {
    id: entry.id,
    kind: entry.kind,
    health,
    targetFile: entry.targetFile,
    marker: entry.marker,
    cachePath: entry.cachePath,
    source: entry.source,
    command: entry.command,
    suggestedAction,
    lockfileEntry: entry,
  }
}

function hasReadableCache(cachePath: string): boolean {
  try {
    return fs.readdirSync(cachePath).length > 0
  } catch {
    return false
  }
}

function getMarkerKey(kind: 'docs' | 'skills', marker: string, targetFile: string): string {
  return `${kind}:${marker}:${targetFile}`
}
