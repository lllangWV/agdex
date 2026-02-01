/**
 * Generic documentation provider factory
 * Use this to create custom providers for any GitHub repository
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

export interface GenericProviderOptions {
  /** Unique identifier for this provider */
  name: string

  /** Display name for CLI output */
  displayName: string

  /** GitHub repository in format 'owner/repo' */
  repo: string

  /** Path to docs folder within the repository */
  docsPath: string

  /** File extensions to include (default: ['.mdx', '.md']) */
  extensions?: string[]

  /** Package name to detect version from (if applicable) */
  packageName?: string

  /** Function to convert version to git tag */
  versionToTag?: (version: string) => string

  /** Files to exclude from index (glob patterns) */
  excludePatterns?: string[]

  /** Custom instruction to include in the index */
  instruction?: string
}

/**
 * Create a generic documentation provider from options
 */
export function createProvider(options: GenericProviderOptions): DocProvider {
  const {
    name,
    displayName,
    repo,
    docsPath,
    extensions = ['.mdx', '.md'],
    packageName,
    versionToTag = (v) => (v.startsWith('v') ? v : `v${v}`),
    excludePatterns = ['**/index.mdx', '**/index.md'],
    instruction,
  } = options

  const detectVersion = packageName
    ? (cwd: string): VersionResult => {
        const packageJsonPath = path.join(cwd, 'package.json')

        if (!fs.existsSync(packageJsonPath)) {
          return {
            version: null,
            error: 'No package.json found in the current directory',
          }
        }

        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
          const dependencies = packageJson.dependencies || {}
          const devDependencies = packageJson.devDependencies || {}
          const version = dependencies[packageName] || devDependencies[packageName]

          if (version) {
            const cleanVersion = version.replace(/^[\^~>=<]+/, '')
            return { version: cleanVersion }
          }

          return {
            version: null,
            error: `${displayName} (${packageName}) is not installed in this project.`,
          }
        } catch (err) {
          return {
            version: null,
            error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
    : undefined

  return {
    name,
    displayName,
    repo,
    docsPath,
    extensions,
    detectVersion,
    versionToTag,
    excludePatterns,
    instruction:
      instruction ||
      `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${displayName} tasks.`,
  }
}

/**
 * Create a provider from a local documentation directory (no GitHub)
 */
export function createLocalProvider(options: {
  name: string
  displayName: string
  localPath: string
  extensions?: string[]
  excludePatterns?: string[]
  instruction?: string
}): DocProvider {
  return {
    name: options.name,
    displayName: options.displayName,
    repo: '', // Empty repo means local-only
    docsPath: options.localPath,
    extensions: options.extensions || ['.mdx', '.md'],
    excludePatterns: options.excludePatterns || ['**/index.mdx', '**/index.md'],
    instruction:
      options.instruction ||
      `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${options.displayName} tasks.`,
  }
}
