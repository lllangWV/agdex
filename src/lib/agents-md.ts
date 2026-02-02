/**
 * agdex: Generate documentation index for AI coding agents.
 *
 * Downloads docs from GitHub via git sparse-checkout, builds a compact
 * index of all doc files, and injects it into CLAUDE.md or AGENTS.md.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  DocProvider,
  DocFile,
  DocSection,
  PullResult,
  GitignoreStatus,
  IndexOptions,
  EmbedOptions,
  EmbedResult,
} from './types'

const START_MARKER_PREFIX = '<!-- AGENTS-MD-EMBED-START'
const END_MARKER_PREFIX = '<!-- AGENTS-MD-EMBED-END'
const MARKER_SUFFIX = ' -->'

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
 * Pull documentation from a GitHub repository
 */
export async function pullDocs(
  provider: DocProvider,
  options: { cwd: string; version?: string; docsDir?: string }
): Promise<PullResult> {
  const { cwd, version: versionOverride, docsDir } = options

  let version: string

  if (versionOverride) {
    version = versionOverride
  } else if (provider.detectVersion) {
    const versionResult = provider.detectVersion(cwd)
    if (!versionResult.version) {
      return {
        success: false,
        error: versionResult.error || `Could not detect ${provider.displayName} version`,
      }
    }
    version = versionResult.version
  } else {
    return {
      success: false,
      error: `No version provided and ${provider.displayName} does not support auto-detection`,
    }
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
 * Generate a compressed index for AGENTS.md/CLAUDE.md
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

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n'
  return existingContent + separator + wrappedContent + '\n'
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
 * High-level function to embed documentation into AGENTS.md/CLAUDE.md
 */
export async function embed(options: EmbedOptions): Promise<EmbedResult> {
  const {
    cwd,
    provider,
    version,
    output = 'AGENTS.md',
    docsDir: customDocsDir,
    globalCache = false,
    description,
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

  const targetPath = path.join(cwd, output)

  // Track file sizes
  let sizeBefore = 0
  let isNewFile = true
  let existingContent = ''

  if (fs.existsSync(targetPath)) {
    existingContent = fs.readFileSync(targetPath, 'utf-8')
    sizeBefore = Buffer.byteLength(existingContent, 'utf-8')
    isNewFile = false
  }

  // Pull documentation
  const pullResult = await pullDocs(provider, {
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

  // Collect and build index
  const docFiles = collectDocFiles(docsPath, {
    extensions: provider.extensions,
    excludePatterns: provider.excludePatterns,
  })

  const sections = buildDocTree(docFiles)

  // Build regenerate command
  const globalFlag = globalCache ? ' --global' : ''
  const regenerateCommand = `npx agdex --provider ${provider.name} --output ${output}${globalFlag}`

  const indexContent = generateIndex({
    docsPath: docsLinkPath,
    sections,
    outputFile: output,
    providerName: provider.displayName,
    instruction: provider.instruction,
    description,
    regenerateCommand,
  })

  // Inject into target file (use provider name for unique markers)
  const newContent = injectIndex(existingContent, indexContent, provider.name)
  fs.writeFileSync(targetPath, newContent, 'utf-8')

  const sizeAfter = Buffer.byteLength(newContent, 'utf-8')

  // Update .gitignore (only for local cache, not global)
  let gitignoreUpdated = false
  if (!globalCache && !customDocsDir) {
    const gitignoreResult = ensureGitignoreEntry(cwd, '.agdex')
    gitignoreUpdated = gitignoreResult.updated
  } else if (!globalCache && customDocsDir && !path.isAbsolute(customDocsDir)) {
    const gitignoreResult = ensureGitignoreEntry(cwd, customDocsDir)
    gitignoreUpdated = gitignoreResult.updated
  }

  return {
    success: true,
    targetFile: output,
    docsPath: globalCache ? docsPath : docsDir,
    version: pullResult.version,
    sizeBefore,
    sizeAfter,
    isNewFile,
    gitignoreUpdated,
  }
}

// Re-export types
export type {
  DocProvider,
  DocFile,
  DocSection,
  PullResult,
  GitignoreStatus,
  IndexOptions,
  EmbedOptions,
  EmbedResult,
} from './types'
