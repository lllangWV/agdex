/**
 * agdex - Embed compressed documentation indexes into local agent instruction files
 *
 * This package helps AI coding agents (Claude, Cursor, etc.) work with
 * version-matched framework documentation by embedding a compressed
 * docs index into a local agent instruction file.
 *
 * @example
 * ```ts
 * import { embed, nextjsProvider } from 'agdex'
 *
 * // Embed Next.js docs
 * const result = await embed({
 *   cwd: process.cwd(),
 *   provider: nextjsProvider,
 *   output: 'CLAUDE.local.md'
 * })
 *
 * // Or create a custom provider
 * import { createProvider, embed } from 'agdex'
 *
 * const myProvider = createProvider({
 *   name: 'my-framework',
 *   displayName: 'My Framework',
 *   repo: 'myorg/myframework',
 *   docsPath: 'docs',
 *   packageName: 'my-framework'
 * })
 *
 * await embed({
 *   cwd: process.cwd(),
 *   provider: myProvider,
 *   version: '1.0.0',
 *   output: 'CLAUDE.local.md'
 * })
 * ```
 */

// Core functions
export {
  embed,
  pullDocs,
  collectDocFiles,
  buildDocTree,
  generateIndex,
  injectIndex,
  hasExistingIndex,
  removeDocsIndex,
  getEmbeddedProviders,
  ensureGitignoreEntry,
  getGlobalCacheDir,
  getLocalCacheDir,
} from './lib/agents-md'

// Providers
export {
  nextjsProvider,
  reactProvider,
  pixiProvider,
  rattlerBuildProvider,
  tauriProvider,
  condaForgeProvider,
  bunProvider,
  tensorrtProvider,
  createProvider,
  createLocalProvider,
  createUrlProvider,
  getProvider,
  listProviders,
  isProviderAvailable,
} from './lib/providers'

// URL scraping
export { pullDocsFromUrl } from './lib/url-scraper'

// Skills functions
export {
  embedSkills,
  collectAllSkills,
  parseSkillFrontmatter,
  discoverPluginSkills,
  discoverFlatSkills,
  generateSkillsIndex,
  injectSkillsIndex,
  hasExistingSkillsIndex,
  removeSkillsIndex,
  getDefaultSkillSources,
  getEnabledPluginSources,
} from './lib/skills'

// Config
export { loadConfig, getDefaultOutput } from './lib/config'
export type { AgdexConfig } from './lib/config'

// Types
export type {
  DocProvider,
  DocFile,
  DocSection,
  VersionResult,
  PullResult,
  GitignoreStatus,
  IndexOptions,
  EmbedOptions,
  EmbedResult,
  ProviderPreset,
  UrlDocConfig,
  SkillFrontmatter,
  SkillEntry,
  SkillSource,
  SkillSourceConfig,
  SkillsEmbedOptions,
  SkillsEmbedResult,
} from './lib/types'

export type { GenericProviderOptions } from './lib/providers/generic'
