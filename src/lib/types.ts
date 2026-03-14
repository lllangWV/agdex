/**
 * Core types for agdex
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
 * Configuration for scraping documentation from a URL
 */
export interface UrlDocConfig {
  /** Base URL of the documentation site */
  baseUrl: string

  /** CSS selector for the main content container (default: 'main') */
  contentSelector?: string

  /** CSS selectors for elements to remove before extraction */
  removeSelectors?: string[]

  /** List of relative page paths to scrape (if not provided, will be discovered from the index page) */
  pages?: string[]

  /** Function to discover page URLs from an index page's HTML */
  discoverPages?: (html: string, baseUrl: string) => string[]

  /** Maximum number of concurrent fetches (default: 5) */
  concurrency?: number

  /** Delay between fetches in ms (default: 200) */
  fetchDelay?: number
}

/**
 * Configuration for a documentation provider
 */
export interface DocProvider {
  /** Unique identifier for this provider (e.g., 'nextjs', 'react', 'vue') */
  name: string

  /** Display name for CLI output */
  displayName: string

  /** GitHub repository in format 'owner/repo' (empty string for URL-based or local providers) */
  repo: string

  /** Path to docs folder within the repository */
  docsPath: string

  /** File extensions to include (default: ['.mdx', '.md']) */
  extensions?: string[]

  /** Function to detect version from a project directory */
  detectVersion?: (cwd: string) => VersionResult

  /** Default branch to use when version detection fails (default: 'main') */
  defaultBranch?: string

  /** Function to convert version to git tag (default: v prefix) */
  versionToTag?: (version: string) => string

  /** Files to exclude from index (glob patterns) */
  excludePatterns?: string[]

  /** Custom instruction to include in the index */
  instruction?: string

  /** URL-based documentation configuration (alternative to repo-based fetching) */
  urlConfig?: UrlDocConfig
}

/**
 * Built-in provider presets
 */
export type ProviderPreset = 'nextjs' | 'react' | 'pixi' | 'rattler-build' | 'tauri' | 'conda-forge' | 'bun' | 'vue' | 'svelte' | 'sveltekit' | 'shadcn-svelte' | 'astro' | 'tailwind' | 'ruff' | 'ty' | 'basedpyright' | 'convex' | 'polars' | 'delta-rs' | 'obsidian' | 'obsidian-excalidraw' | 'ffmpeg' | 'manim' | 'cuda-feedstock' | 'tensorrt'

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

  /** Additional user-provided description */
  description?: string

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

  /** Use global cache directory (~/.cache/agdex/) instead of local (default: true) */
  globalCache?: boolean

  /** Additional user-provided description to include in the index */
  description?: string
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
  cacheHit?: boolean
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

export type SkillSource = 'plugin' | 'user' | 'project' | 'skills-sh'

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

export interface SkillsShSearchResult {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

export interface SkillsShSearchResponse {
  query: string
  searchType: string
  skills: SkillsShSearchResult[]
  count: number
  duration_ms: number
}
