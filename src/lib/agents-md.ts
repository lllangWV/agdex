/**
 * agdex: Generate documentation index for AI coding agents.
 *
 * Downloads docs from GitHub via git sparse-checkout, builds a compact
 * index of all doc files, and injects it into a local agent instruction file.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  DocProvider,
  DocFile,
  DocSection,
  DocIndexEntry,
  PullResult,
  GitignoreStatus,
  IndexOptions,
  EmbedOptions,
  EmbedResult,
} from './types'
import { createIndexId, upsertIndexLockEntry } from './lockfile'

const START_MARKER_PREFIX = '<!-- AGENTS-MD-EMBED-START'
const END_MARKER_PREFIX = '<!-- AGENTS-MD-EMBED-END'
const MARKER_SUFFIX = ' -->'

/** Default file the full docs index is written to (progressive disclosure). */
export const DEFAULT_DOC_INDEX_FILE = 'DOCINDEX.md'

/** Markers wrapping the "## Document Indices" summary section in AGENTS.md/CLAUDE.md. */
const DOC_SUMMARY_START_MARKER = '<!-- AGENTS-MD-DOCINDEX-SUMMARY-START -->'
const DOC_SUMMARY_END_MARKER = '<!-- AGENTS-MD-DOCINDEX-SUMMARY-END -->'

function getStartMarker(providerName?: string): string {
  return providerName
    ? `${START_MARKER_PREFIX}:${providerName}${MARKER_SUFFIX}`
    : `${START_MARKER_PREFIX}${MARKER_SUFFIX}`
}

function getEndMarker(providerName?: string): string {
  return providerName
    ? `${END_MARKER_PREFIX}:${providerName}${MARKER_SUFFIX}`
    : `${END_MARKER_PREFIX}${MARKER_SUFFIX}`
}

/**
 * Pull documentation from a GitHub repository or URL
 */
export async function pullDocs(
  provider: DocProvider,
  options: { cwd: string; version?: string; docsDir?: string; onProgress?: (current: number, total: number, page: string) => void }
): Promise<PullResult> {
  // If provider has URL config, use URL-based scraping
  if (provider.urlConfig) {
    const { pullDocsFromUrl } = await import('./url-scraper')
    const docsPath = options.docsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-'))
    return pullDocsFromUrl(provider.urlConfig, docsPath, { onProgress: options.onProgress })
  }

  const { cwd, version: versionOverride, docsDir } = options

  let version: string

  if (versionOverride) {
    version = versionOverride
  } else if (provider.detectVersion) {
    const versionResult = provider.detectVersion(cwd)
    if (!versionResult.version) {
      version = provider.defaultBranch || 'main'
    } else {
      version = versionResult.version
    }
  } else {
    version = provider.defaultBranch || 'main'
  }

  const docsPath = docsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-'))
  const useTempDir = !docsDir

  try {
    if (fs.existsSync(docsPath)) {
      fs.rmSync(docsPath, { recursive: true })
    }

    // Convert version to git tag. If it looks like a branch name (doesn't start with digit or v), use as-is
    const defaultVersionToTag = (v: string) => {
      if (v.startsWith('v') || /^\d/.test(v)) {
        return v.startsWith('v') ? v : `v${v}`
      }
      return v
    }
    const tag = provider.versionToTag ? provider.versionToTag(version) : defaultVersionToTag(version)
    await cloneDocsFolder(provider.repo, provider.docsPath, tag, docsPath)

    return {
      success: true,
      docsPath,
      version,
    }
  } catch (error) {
    if (useTempDir && fs.existsSync(docsPath)) {
      fs.rmSync(docsPath, { recursive: true })
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Clone a specific folder from a GitHub repository using sparse checkout
 */
async function cloneDocsFolder(
  repo: string,
  docsFolder: string,
  tag: string,
  destDir: string
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-clone-'))

  try {
    try {
      execSync(
        `git clone --depth 1 --filter=blob:none --sparse --branch ${tag} https://github.com/${repo}.git .`,
        { cwd: tempDir, stdio: 'pipe' }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('not found') || message.includes('did not match')) {
        throw new Error(
          `Could not find documentation for tag ${tag}. This version may not exist on GitHub yet.`
        )
      }
      throw error
    }

    execSync(`git sparse-checkout set ${docsFolder}`, { cwd: tempDir, stdio: 'pipe' })

    const sourceDocsDir = path.join(tempDir, docsFolder)
    if (!fs.existsSync(sourceDocsDir)) {
      throw new Error(`${docsFolder} folder not found in cloned repository`)
    }

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true })
    }

    fs.mkdirSync(destDir, { recursive: true })
    fs.cpSync(sourceDocsDir, destDir, { recursive: true })
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true })
    }
  }
}

/**
 * Collect all documentation files from a directory
 */
export function collectDocFiles(
  dir: string,
  options?: { extensions?: string[]; excludePatterns?: string[] }
): DocFile[] {
  const extensions = options?.extensions || ['.mdx', '.md']
  const excludePatterns = options?.excludePatterns || []

  const files = fs.readdirSync(dir, { recursive: true }) as string[]

  return files
    .filter((f) => {
      // Check extension
      const hasValidExtension = extensions.some((ext) => f.endsWith(ext))
      if (!hasValidExtension) return false

      // Check exclusion patterns
      for (const pattern of excludePatterns) {
        // Handle **/ at start and end (e.g., **/partials/**)
        if (pattern.startsWith('**/') && pattern.endsWith('/**')) {
          const dirName = pattern.slice(3, -3) // Extract 'partials' from '**/partials/**'
          if (f.includes(`/${dirName}/`) || f.startsWith(`${dirName}/`)) return false
        }
        // Handle **/ at start only (e.g., **/index.md)
        else if (pattern.startsWith('**/')) {
          const suffix = pattern.slice(3)
          if (f.endsWith(suffix) || f === suffix) return false
        }
        // Handle wildcard at start (e.g., *.md)
        else if (pattern.startsWith('*')) {
          const suffix = pattern.slice(1)
          if (f.endsWith(suffix)) return false
        }
        // Exact match or directory match
        else if (f === pattern || f.endsWith('/' + pattern)) {
          return false
        }
      }

      // Exclude index files by default
      if (f.endsWith('/index.mdx') || f.endsWith('/index.md') || f.startsWith('index.')) {
        return false
      }

      return true
    })
    .sort()
    .map((f) => ({ relativePath: f }))
}

/**
 * Build a tree structure from documentation files
 */
export function buildDocTree(files: DocFile[]): DocSection[] {
  const sections: Map<string, DocSection> = new Map()

  for (const file of files) {
    const parts = file.relativePath.split('/')

    // Handle root-level files (no directory)
    if (parts.length === 1) {
      if (!sections.has('.')) {
        sections.set('.', {
          name: '.',
          files: [],
          subsections: [],
        })
      }
      sections.get('.')!.files.push({ relativePath: file.relativePath })
      continue
    }

    const topLevelDir = parts[0]

    if (!sections.has(topLevelDir)) {
      sections.set(topLevelDir, {
        name: topLevelDir,
        files: [],
        subsections: [],
      })
    }

    const section = sections.get(topLevelDir)!

    if (parts.length === 2) {
      section.files.push({ relativePath: file.relativePath })
    } else {
      const subsectionDir = parts[1]
      let subsection = section.subsections.find((s) => s.name === subsectionDir)

      if (!subsection) {
        subsection = { name: subsectionDir, files: [], subsections: [] }
        section.subsections.push(subsection)
      }

      if (parts.length === 3) {
        subsection.files.push({ relativePath: file.relativePath })
      } else {
        const subSubDir = parts[2]
        let subSubsection = subsection.subsections.find((s) => s.name === subSubDir)

        if (!subSubsection) {
          subSubsection = { name: subSubDir, files: [], subsections: [] }
          subsection.subsections.push(subSubsection)
        }

        subSubsection.files.push({ relativePath: file.relativePath })
      }
    }
  }

  // Sort everything
  const sortedSections = Array.from(sections.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  for (const section of sortedSections) {
    section.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    section.subsections.sort((a, b) => a.name.localeCompare(b.name))

    for (const subsection of section.subsections) {
      subsection.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      subsection.subsections.sort((a, b) => a.name.localeCompare(b.name))

      for (const subSubsection of subsection.subsections) {
        subSubsection.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      }
    }
  }

  return sortedSections
}

/**
 * Generate a compressed index for an agent instruction file.
 */
export function generateIndex(options: IndexOptions): string {
  const { docsPath, sections, outputFile, providerName, instruction, description, regenerateCommand } = options

  const parts: string[] = []

  // Header with provider name if available
  const header = providerName ? `[${providerName} Docs Index]` : '[Docs Index]'
  parts.push(header)
  parts.push(`root: ${docsPath}`)

  // Custom instruction
  if (instruction) {
    parts.push(instruction)
  }

  // Additional user-provided description
  if (description) {
    parts.push(description)
  }

  // Regeneration command
  const targetFile = outputFile || 'AGENTS.md'
  const cmd = regenerateCommand || `npx agdex --output ${targetFile}`
  parts.push(`If docs missing, run: ${cmd}`)

  // Collect all files and group by directory
  const allFiles = collectAllFilesFromSections(sections)
  const grouped = groupByDirectory(allFiles)

  for (const [dir, files] of grouped) {
    parts.push(`${dir}:{${files.join(',')}}`)
  }

  return parts.join('|')
}

function collectAllFilesFromSections(sections: DocSection[]): string[] {
  const files: string[] = []

  for (const section of sections) {
    for (const file of section.files) {
      files.push(file.relativePath)
    }
    files.push(...collectAllFilesFromSections(section.subsections))
  }

  return files
}

function groupByDirectory(files: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const filePath of files) {
    const lastSlash = filePath.lastIndexOf('/')
    const dir = lastSlash === -1 ? '.' : filePath.slice(0, lastSlash)
    const fileName = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1)

    const existing = grouped.get(dir)
    if (existing) {
      existing.push(fileName)
    } else {
      grouped.set(dir, [fileName])
    }
  }

  return grouped
}

/**
 * Check if content has an existing embedded index for a specific provider
 * If no provider specified, checks for any index
 */
export function hasExistingIndex(content: string, providerName?: string): boolean {
  if (providerName) {
    return content.includes(getStartMarker(providerName))
  }
  // Check for any index (with or without provider name)
  return content.includes(START_MARKER_PREFIX)
}

/**
 * Get all embedded provider names from content
 * Returns an array of provider name strings found in AGENTS-MD-EMBED-START markers
 */
export function getEmbeddedProviders(content: string): string[] {
  const providers: string[] = []
  const regex = /<!-- AGENTS-MD-EMBED-START:(\S+?) -->/g
  let match
  while ((match = regex.exec(content)) !== null) {
    providers.push(match[1])
  }
  return providers
}

/**
 * Remove the docs index from content
 * If providerName specified, only removes that provider's index
 * If no providerName, removes all indexes
 * Returns the content with the index removed, or unchanged if no index exists
 */
export function removeDocsIndex(content: string, providerName?: string): string {
  if (!hasExistingIndex(content, providerName)) {
    return content
  }

  let result = content

  if (providerName) {
    // Remove specific provider's index
    const startMarker = getStartMarker(providerName)
    const endMarker = getEndMarker(providerName)
    const startIdx = result.indexOf(startMarker)
    const endIdx = result.indexOf(endMarker) + endMarker.length

    if (startIdx !== -1 && endIdx > startIdx) {
      result = result.slice(0, startIdx) + result.slice(endIdx)
    }
  } else {
    // Remove all indexes (find all start markers and remove their blocks)
    let startIdx: number
    while ((startIdx = result.indexOf(START_MARKER_PREFIX)) !== -1) {
      // Find the end of this start marker line
      const startMarkerEnd = result.indexOf(MARKER_SUFFIX, startIdx) + MARKER_SUFFIX.length
      // Extract provider name if present
      const startMarkerContent = result.slice(startIdx, startMarkerEnd)
      const providerMatch = startMarkerContent.match(/:([^-\s]+)/)
      const provider = providerMatch ? providerMatch[1] : undefined

      const endMarker = getEndMarker(provider)
      const endIdx = result.indexOf(endMarker)

      if (endIdx !== -1) {
        result = result.slice(0, startIdx) + result.slice(endIdx + endMarker.length)
      } else {
        // Malformed - just remove the start marker to prevent infinite loop
        result = result.slice(0, startIdx) + result.slice(startMarkerEnd)
      }
    }
  }

  // Clean up multiple consecutive newlines (more than 2)
  result = result.replace(/\n{3,}/g, '\n\n')

  // Trim trailing whitespace but keep one newline at end if file had content
  result = result.trimEnd()
  if (result.length > 0) {
    result += '\n'
  }

  return result
}

/**
 * Wrap content with markers
 */
function wrapWithMarkers(content: string, providerName?: string): string {
  const startMarker = getStartMarker(providerName)
  const endMarker = getEndMarker(providerName)
  return `${startMarker}\n${content}\n${endMarker}`
}

/**
 * Inject index into AGENTS.md/CLAUDE.md content
 * If providerName specified, only replaces that provider's index (or appends if not present)
 */
export function injectIndex(existingContent: string, indexContent: string, providerName?: string): string {
  const wrappedContent = wrapWithMarkers(indexContent, providerName)

  if (hasExistingIndex(existingContent, providerName)) {
    const startMarker = getStartMarker(providerName)
    const endMarker = getEndMarker(providerName)
    const startIdx = existingContent.indexOf(startMarker)
    const endIdx = existingContent.indexOf(endMarker) + endMarker.length

    return (
      existingContent.slice(0, startIdx) +
      wrappedContent +
      existingContent.slice(endIdx)
    )
  }

  if (existingContent.length === 0) {
    return wrappedContent + '\n'
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n'
  return existingContent + separator + wrappedContent + '\n'
}

/**
 * Parse the documentation indices present in a DOCINDEX.md file.
 *
 * Each index is wrapped in AGENTS-MD-EMBED-START/END markers and begins with a
 * `[<displayName> Docs Index]` header. Returns the marker name plus a readable
 * display name for each index, in document order.
 */
export function getDocIndexEntries(content: string): DocIndexEntry[] {
  const entries: DocIndexEntry[] = []
  const regex = /<!-- AGENTS-MD-EMBED-START:(\S+?) -->\r?\n([\s\S]*?)<!-- AGENTS-MD-EMBED-END:\1 -->/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const block = match[2]
    const headerMatch = block.match(/\[(.+?)\]/)
    let displayName = name
    if (headerMatch) {
      const parsed = headerMatch[1].replace(/\s*Docs Index$/, '').trim()
      displayName = parsed || name
    }
    entries.push({ name, displayName })
  }

  return entries
}

/**
 * Generate the progressive-disclosure summary section that lives in
 * AGENTS.md/CLAUDE.md. It points agents at the full index file and lists the
 * documentation indices currently available there.
 */
export function generateDocIndexSummary(
  entries: DocIndexEntry[],
  docIndexFile: string = DEFAULT_DOC_INDEX_FILE
): string {
  const lines = [
    '## Document Indices',
    '',
    `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any of the docs found in ${docIndexFile} .`,
    '',
  ]

  if (entries.length === 0) {
    lines.push('_No documentation indices available yet._')
  } else {
    for (const entry of entries) {
      lines.push(`- ${entry.displayName} (\`${entry.name}\`)`)
    }
  }

  return lines.join('\n')
}

/**
 * Check whether content already contains the Document Indices summary section
 */
export function hasDocIndexSummary(content: string): boolean {
  return content.includes(DOC_SUMMARY_START_MARKER)
}

/**
 * Inject (or replace) the Document Indices summary section in AGENTS.md/CLAUDE.md
 */
export function injectDocIndexSummary(existingContent: string, summaryContent: string): string {
  const wrappedContent = `${DOC_SUMMARY_START_MARKER}\n${summaryContent}\n${DOC_SUMMARY_END_MARKER}`

  if (hasDocIndexSummary(existingContent)) {
    const startIdx = existingContent.indexOf(DOC_SUMMARY_START_MARKER)
    const endIdx = existingContent.indexOf(DOC_SUMMARY_END_MARKER) + DOC_SUMMARY_END_MARKER.length

    return (
      existingContent.slice(0, startIdx) +
      wrappedContent +
      existingContent.slice(endIdx)
    )
  }

  if (existingContent.length === 0) {
    return wrappedContent + '\n'
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n'
  return existingContent + separator + wrappedContent + '\n'
}

/**
 * Remove the Document Indices summary section from content
 */
export function removeDocIndexSummary(content: string): string {
  if (!hasDocIndexSummary(content)) {
    return content
  }

  const startIdx = content.indexOf(DOC_SUMMARY_START_MARKER)
  const endIdx = content.indexOf(DOC_SUMMARY_END_MARKER) + DOC_SUMMARY_END_MARKER.length

  let result = content.slice(0, startIdx) + content.slice(endIdx)
  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.trimEnd()
  if (result.length > 0) {
    result += '\n'
  }

  return result
}

export interface ApplyDocIndexResult {
  docIndexFile: string
  docIndexPath: string
  agentFile: string
  agentPath: string
  isNewAgentFile: boolean
  agentSizeBefore: number
  agentSizeAfter: number
  docIndexSizeBefore: number
  docIndexSizeAfter: number
  entries: DocIndexEntry[]
}

/**
 * Apply a generated index using the progressive-disclosure strategy:
 *   1. Write/replace the full index block in DOCINDEX.md (keyed by providerName)
 *   2. Refresh the "## Document Indices" summary section in the agent file
 *      (AGENTS.md/CLAUDE.md) so it lists every index currently in DOCINDEX.md.
 */
export function applyDocIndex(options: {
  cwd: string
  agentFile: string
  providerName: string
  indexContent: string
  docIndexFile?: string
}): ApplyDocIndexResult {
  const { cwd, agentFile, providerName, indexContent } = options
  const docIndexFile = options.docIndexFile || DEFAULT_DOC_INDEX_FILE
  const docIndexPath = path.join(cwd, docIndexFile)
  const agentPath = path.join(cwd, agentFile)

  // 1. Update DOCINDEX.md
  let docIndexContent = ''
  let docIndexSizeBefore = 0
  if (fs.existsSync(docIndexPath)) {
    docIndexContent = fs.readFileSync(docIndexPath, 'utf-8')
    docIndexSizeBefore = Buffer.byteLength(docIndexContent, 'utf-8')
  }

  const newDocIndexContent = injectIndex(docIndexContent, indexContent, providerName)
  fs.writeFileSync(docIndexPath, newDocIndexContent, 'utf-8')
  const docIndexSizeAfter = Buffer.byteLength(newDocIndexContent, 'utf-8')

  // 2. Refresh the summary section in the agent file
  let agentContent = ''
  let agentSizeBefore = 0
  let isNewAgentFile = true
  if (fs.existsSync(agentPath)) {
    agentContent = fs.readFileSync(agentPath, 'utf-8')
    agentSizeBefore = Buffer.byteLength(agentContent, 'utf-8')
    isNewAgentFile = false
  }

  const entries = getDocIndexEntries(newDocIndexContent)
  const summary = generateDocIndexSummary(entries, docIndexFile)
  const newAgentContent = injectDocIndexSummary(agentContent, summary)
  fs.writeFileSync(agentPath, newAgentContent, 'utf-8')
  const agentSizeAfter = Buffer.byteLength(newAgentContent, 'utf-8')

  return {
    docIndexFile,
    docIndexPath,
    agentFile,
    agentPath,
    isNewAgentFile,
    agentSizeBefore,
    agentSizeAfter,
    docIndexSizeBefore,
    docIndexSizeAfter,
    entries,
  }
}

export interface RemoveDocIndexResult {
  removed: boolean
  removedProviders: string[]
  docIndexFile: string
  docIndexDeleted: boolean
  agentFile: string
  agentSizeBefore: number
  agentSizeAfter: number
  docIndexSizeBefore: number
  docIndexSizeAfter: number
}

/**
 * Remove one (or all) documentation indices from DOCINDEX.md and refresh the
 * summary section in the agent file. If no indices remain, DOCINDEX.md is
 * deleted and the summary section is removed from the agent file.
 */
export function removeDocIndexEntry(options: {
  cwd: string
  agentFile: string
  providerName?: string
  docIndexFile?: string
}): RemoveDocIndexResult {
  const { cwd, agentFile, providerName } = options
  const docIndexFile = options.docIndexFile || DEFAULT_DOC_INDEX_FILE
  const docIndexPath = path.join(cwd, docIndexFile)
  const agentPath = path.join(cwd, agentFile)

  const base: RemoveDocIndexResult = {
    removed: false,
    removedProviders: [],
    docIndexFile,
    docIndexDeleted: false,
    agentFile,
    agentSizeBefore: 0,
    agentSizeAfter: 0,
    docIndexSizeBefore: 0,
    docIndexSizeAfter: 0,
  }

  if (!fs.existsSync(docIndexPath)) {
    return base
  }

  const docIndexContent = fs.readFileSync(docIndexPath, 'utf-8')
  base.docIndexSizeBefore = Buffer.byteLength(docIndexContent, 'utf-8')

  if (!hasExistingIndex(docIndexContent, providerName)) {
    base.docIndexSizeAfter = base.docIndexSizeBefore
    return base
  }

  // Track which providers are being removed for reporting
  const before = getEmbeddedProviders(docIndexContent)
  const newDocIndexContent = removeDocsIndex(docIndexContent, providerName)
  const after = getEmbeddedProviders(newDocIndexContent)
  base.removedProviders = before.filter((p) => !after.includes(p))
  base.removed = true

  const remainingEntries = getDocIndexEntries(newDocIndexContent)

  // Update the agent file's summary section
  let agentContent = ''
  if (fs.existsSync(agentPath)) {
    agentContent = fs.readFileSync(agentPath, 'utf-8')
    base.agentSizeBefore = Buffer.byteLength(agentContent, 'utf-8')
  }

  if (remainingEntries.length === 0) {
    // Nothing left: drop DOCINDEX.md entirely and remove the summary section
    fs.rmSync(docIndexPath)
    base.docIndexDeleted = true
    base.docIndexSizeAfter = 0

    const newAgentContent = removeDocIndexSummary(agentContent)
    if (fs.existsSync(agentPath)) {
      fs.writeFileSync(agentPath, newAgentContent, 'utf-8')
    }
    base.agentSizeAfter = Buffer.byteLength(newAgentContent, 'utf-8')
  } else {
    fs.writeFileSync(docIndexPath, newDocIndexContent, 'utf-8')
    base.docIndexSizeAfter = Buffer.byteLength(newDocIndexContent, 'utf-8')

    const summary = generateDocIndexSummary(remainingEntries, docIndexFile)
    const newAgentContent = injectDocIndexSummary(agentContent, summary)
    if (fs.existsSync(agentPath) || newAgentContent.length > 0) {
      fs.writeFileSync(agentPath, newAgentContent, 'utf-8')
    }
    base.agentSizeAfter = Buffer.byteLength(newAgentContent, 'utf-8')
  }

  return base
}

/**
 * Ensure .gitignore has entry for docs directory
 */
export function ensureGitignoreEntry(cwd: string, docsDir: string): GitignoreStatus {
  const gitignorePath = path.join(cwd, '.gitignore')
  const entry = docsDir.endsWith('/') ? docsDir : `${docsDir}/`
  const entryRegex = new RegExp(`^\\s*${docsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/.*)?$`)

  let content = ''
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8')
  }

  const hasEntry = content.split(/\r?\n/).some((line) => entryRegex.test(line))

  if (hasEntry) {
    return { path: gitignorePath, updated: false, alreadyPresent: true }
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n')
  const header = content.includes('# agdex') ? '' : '# agdex\n'
  const newContent = content + (needsNewline ? '\n' : '') + header + `${entry}\n`

  fs.writeFileSync(gitignorePath, newContent, 'utf-8')

  return { path: gitignorePath, updated: true, alreadyPresent: false }
}

/**
 * Get the global cache directory path
 */
export function getGlobalCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'agdex')
}

/**
 * Get the local cache directory path
 */
export function getLocalCacheDir(cwd: string): string {
  return path.join(cwd, '.agdex')
}

/**
 * High-level function to embed documentation into an agent instruction file.
 */
export async function embed(options: EmbedOptions): Promise<EmbedResult> {
  const {
    cwd,
    provider,
    version,
    versionMode,
    output = 'CLAUDE.local.md',
    docsDir: customDocsDir,
    globalCache = false,
    description,
    docIndexFile = DEFAULT_DOC_INDEX_FILE,
  } = options

  // Determine the docs directory
  let docsPath: string
  let docsLinkPath: string
  let docsDir: string

  if (customDocsDir) {
    // Custom directory specified
    docsDir = customDocsDir
    docsPath = path.isAbsolute(customDocsDir) ? customDocsDir : path.join(cwd, customDocsDir)
    docsLinkPath = path.isAbsolute(customDocsDir) ? customDocsDir : `./${customDocsDir}`
  } else if (globalCache) {
    // Global cache: ~/.cache/agdex/{provider}
    const cacheBase = getGlobalCacheDir()
    docsDir = path.join(cacheBase, provider.name)
    docsPath = docsDir
    docsLinkPath = docsPath // Use absolute path for global cache
  } else {
    // Local cache: .agdex/{provider}
    docsDir = `.agdex/${provider.name}`
    docsPath = path.join(cwd, docsDir)
    docsLinkPath = `./${docsDir}`
  }

  // Check if docs are already available in the cache
  const cacheHit = fs.existsSync(docsPath) && fs.readdirSync(docsPath).length > 0

  let pullResult: PullResult

  if (cacheHit) {
    // Use cached docs, resolve version for metadata
    let resolvedVersion = version
    if (!resolvedVersion && provider.detectVersion) {
      const detected = provider.detectVersion(cwd)
      resolvedVersion = detected.version || undefined
    }
    pullResult = {
      success: true,
      docsPath,
      version: resolvedVersion,
    }
  } else {
    // Pull documentation
    pullResult = await pullDocs(provider, {
      cwd,
      version,
      docsDir: docsPath,
    })

    if (!pullResult.success) {
      return {
        success: false,
        error: pullResult.error,
      }
    }
  }

  // Collect and build index
  const docFiles = collectDocFiles(docsPath, {
    extensions: provider.extensions,
    excludePatterns: provider.excludePatterns,
  })

  const sections = buildDocTree(docFiles)

  // Build regenerate command
  const cacheFlag = globalCache ? ' --global' : ''
  const regenerateCommand = `npx agdex --provider ${provider.name} --output ${output}${cacheFlag}`

  const indexContent = generateIndex({
    docsPath: docsLinkPath,
    sections,
    outputFile: output,
    providerName: provider.displayName,
    instruction: provider.instruction,
    description,
    regenerateCommand,
  })

  // Progressive disclosure: write the full index to DOCINDEX.md and refresh
  // the "## Document Indices" summary section in the agent file.
  const applied = applyDocIndex({
    cwd,
    agentFile: output,
    providerName: provider.name,
    indexContent,
    docIndexFile,
  })

  // Update .gitignore (only for local cache, not global)
  let gitignoreUpdated = false
  if (!globalCache && !customDocsDir) {
    const gitignoreResult = ensureGitignoreEntry(cwd, '.agdex')
    gitignoreUpdated = gitignoreResult.updated
  } else if (!globalCache && customDocsDir && !path.isAbsolute(customDocsDir)) {
    const gitignoreResult = ensureGitignoreEntry(cwd, customDocsDir)
    gitignoreUpdated = gitignoreResult.updated
  }

  upsertIndexLockEntry(cwd, {
    id: createIndexId('docs', provider.name, output),
    kind: 'docs',
    source: {
      type: provider.urlConfig
        ? 'url-docs'
        : provider.name === 'custom'
          ? 'github-docs'
          : 'builtin-provider',
      name: provider.name,
      displayName: provider.displayName,
      repo: provider.repo || undefined,
      docsPath: provider.docsPath || undefined,
      url: provider.urlConfig?.baseUrl,
      version: pullResult.version,
      versionMode: versionMode || (version ? 'pinned' : pullResult.version ? 'auto' : 'unknown'),
    },
    targetFile: output,
    marker: provider.name,
    cachePath: docsPath,
    command: regenerateCommand,
  })

  return {
    success: true,
    targetFile: output,
    docsPath: globalCache ? docsPath : docsDir,
    version: pullResult.version,
    sizeBefore: applied.agentSizeBefore,
    sizeAfter: applied.agentSizeAfter,
    isNewFile: applied.isNewAgentFile,
    gitignoreUpdated,
    cacheHit,
    docIndexFile: applied.docIndexFile,
    docIndexSizeBefore: applied.docIndexSizeBefore,
    docIndexSizeAfter: applied.docIndexSizeAfter,
  }
}

// Re-export types
export type {
  DocProvider,
  DocFile,
  DocSection,
  DocIndexEntry,
  PullResult,
  GitignoreStatus,
  IndexOptions,
  EmbedOptions,
  EmbedResult,
} from './types'
