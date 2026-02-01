/**
 * Bun documentation provider
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(cwd: string): VersionResult {
  // Check if bun.lockb exists (indicates project uses bun)
  const bunLockPath = path.join(cwd, 'bun.lockb')
  const hasBunLock = fs.existsSync(bunLockPath)

  // Also check for bunfig.toml
  const bunfigPath = path.join(cwd, 'bunfig.toml')
  const hasBunfig = fs.existsSync(bunfigPath)

  if (!hasBunLock && !hasBunfig) {
    return {
      version: null,
      error: 'No bun.lockb or bunfig.toml found in the current directory',
    }
  }

  // Try to get bun version from CLI
  try {
    const output = execSync('bun --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // bun CLI not available, but project uses bun
  }

  return {
    version: null,
    error: 'Bun project detected but could not determine version. Please specify with --fw-version.',
  }
}

export const bunProvider: DocProvider = {
  name: 'bun',
  displayName: 'Bun',
  repo: 'oven-sh/bun',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => `bun-v${version}`,
  excludePatterns: ['**/README.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Bun tasks.',
}
