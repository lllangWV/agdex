/**
 * agentsmd-embed - Embed compressed documentation indexes into AGENTS.md/CLAUDE.md
 *
 * This package helps AI coding agents (Claude, Cursor, etc.) work with
 * version-matched framework documentation by embedding a compressed
 * docs index directly into your project's AGENTS.md or CLAUDE.md file.
 *
 * @example
 * ```ts
 * import { embed, nextjsProvider } from 'agentsmd-embed'
 *
 * // Embed Next.js docs
 * const result = await embed({
 *   cwd: process.cwd(),
 *   provider: nextjsProvider,
 *   output: 'AGENTS.md'
 * })
 *
 * // Or create a custom provider
 * import { createProvider, embed } from 'agentsmd-embed'
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
 *   output: 'CLAUDE.md'
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
  ensureGitignoreEntry,
} from './lib/agents-md'

// Providers
export {
  nextjsProvider,
  reactProvider,
  pixiProvider,
  rattlerBuildProvider,
  tauriProvider,
  condaForgeProvider,
  createProvider,
  createLocalProvider,
  getProvider,
  listProviders,
  isProviderAvailable,
} from './lib/providers'

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
} from './lib/types'

export type { GenericProviderOptions } from './lib/providers/generic'
