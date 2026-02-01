/**
 * Core types for agentsmd-embed
 */

export interface DocFile {
  relativePath: string
}

export interface DocSection {
  name: string
  files: DocFile[]
  subsections: DocSection[]
}

export interface VersionResult {
  version: string | null
  error?: string
}

export interface PullResult {
  success: boolean
  docsPath?: string
  version?: string
  error?: string
}

export interface GitignoreStatus {
  path: string
  updated: boolean
  alreadyPresent: boolean
}

/**
 * Configuration for a documentation provider
 */
export interface DocProvider {
  /** Unique identifier for this provider (e.g., 'nextjs', 'react', 'vue') */
  name: string

  /** Display name for CLI output */
  displayName: string

  /** GitHub repository in format 'owner/repo' */
  repo: string

  /** Path to docs folder within the repository */
  docsPath: string

  /** File extensions to include (default: ['.mdx', '.md']) */
  extensions?: string[]

  /** Function to detect version from a project directory */
  detectVersion?: (cwd: string) => VersionResult

  /** Function to convert version to git tag (default: v prefix) */
  versionToTag?: (version: string) => string

  /** Files to exclude from index (glob patterns) */
  excludePatterns?: string[]

  /** Custom instruction to include in the index */
  instruction?: string
}

/**
 * Built-in provider presets
 */
export type ProviderPreset = 'nextjs' | 'react' | 'pixi' | 'rattler-build' | 'tauri' | 'conda-forge' | 'vue' | 'svelte' | 'astro'

export interface IndexOptions {
  /** Path where docs are stored */
  docsPath: string

  /** Sections of documentation */
  sections: DocSection[]

  /** Target output file name */
  outputFile?: string

  /** Provider name for the instruction */
  providerName?: string

  /** Custom instruction to include */
  instruction?: string

  /** Command to regenerate the docs */
  regenerateCommand?: string
}

export interface EmbedOptions {
  /** Working directory */
  cwd: string

  /** Documentation provider configuration */
  provider: DocProvider

  /** Override version detection */
  version?: string

  /** Target file (CLAUDE.md, AGENTS.md, etc.) */
  output?: string

  /** Directory name for downloaded docs */
  docsDir?: string
}

export interface EmbedResult {
  success: boolean
  targetFile?: string
  docsPath?: string
  version?: string
  sizeBefore?: number
  sizeAfter?: number
  isNewFile?: boolean
  gitignoreUpdated?: boolean
  error?: string
}

// Skills types

export interface SkillFrontmatter {
  name: string
  description: string
}

export interface SkillEntry {
  name: string
  description: string
  skillMdPath: string
  siblingFiles: string[]
  source: SkillSource
  pluginName?: string
}

export type SkillSource = 'plugin' | 'user' | 'project'

export interface SkillSourceConfig {
  type: SkillSource
  path: string
  label: string
}

export interface SkillsEmbedOptions {
  cwd: string
  sources: SkillSourceConfig[]
  output?: string
}

export interface SkillsEmbedResult {
  success: boolean
  targetFile?: string
  skillCount?: number
  sizeBefore?: number
  sizeAfter?: number
  isNewFile?: boolean
  error?: string
  sourceBreakdown?: Record<SkillSource, number>
}
