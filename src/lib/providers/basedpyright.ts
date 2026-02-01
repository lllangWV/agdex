/**
 * basedpyright documentation provider
 *
 * basedpyright is a fork of pyright with various improvements and bug fixes.
 * https://github.com/DetachHead/basedpyright
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parseBasedpyrightVersion(content: string): string | null {
  // Check for basedpyright in dependencies (various formats)
  const patterns = [
    /basedpyright\s*=\s*["']([^"']+)["']/,
    /["']basedpyright([><=!~]+[\d.]+)["']/,
    /["']basedpyright\s*([><=!~]*[\d.]+)["']/,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
      // Extract version number from constraint
      const versionMatch = match[1].match(/[\d]+\.[\d]+\.[\d]+/)
      if (versionMatch) {
        return versionMatch[0]
      }
    }
  }
  return null
}

function detectVersion(cwd: string): VersionResult {
  // Check for pyproject.toml
  const pyprojectPath = path.join(cwd, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      // Check if basedpyright is configured or listed as dependency
      if (content.includes('basedpyright')) {
        const version = parseBasedpyrightVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check if basedpyright is installed globally and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('basedpyright --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/basedpyright ([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // basedpyright not installed globally
  }

  return {
    version: null,
    error: 'Could not detect basedpyright version. Use --fw-version to specify.',
  }
}

export const basedpyrightProvider: DocProvider = {
  name: 'basedpyright',
  displayName: 'basedpyright',
  repo: 'DetachHead/basedpyright',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any basedpyright tasks. basedpyright is a fork of pyright with various improvements.',
}
