/**
 * Pixi documentation provider
 *
 * Pixi is a fast, cross-platform package manager built on the conda ecosystem.
 * https://github.com/prefix-dev/pixi
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse TOML-like file to extract version
 * This is a simple parser for pixi.toml version field
 */
function parsePixiVersion(content: string): string | null {
  // Look for [workspace] or root level requires-pixi
  const requiresPixiMatch = content.match(/requires-pixi\s*=\s*["']([^"']+)["']/)
  if (requiresPixiMatch) {
    // Extract version from semver constraint like ">=0.63.0"
    const versionMatch = requiresPixiMatch[1].match(/[\d]+\.[\d]+\.[\d]+/)
    if (versionMatch) {
      return versionMatch[0]
    }
  }
  return null
}

function detectVersion(cwd: string): VersionResult {
  // Check for pixi.toml
  const pixiTomlPath = path.join(cwd, 'pixi.toml')
  if (fs.existsSync(pixiTomlPath)) {
    try {
      const content = fs.readFileSync(pixiTomlPath, 'utf-8')
      const version = parsePixiVersion(content)
      if (version) {
        return { version }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check for pyproject.toml with pixi config
  const pyprojectPath = path.join(cwd, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      if (content.includes('[tool.pixi')) {
        const version = parsePixiVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check if pixi is installed globally and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('pixi --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/pixi ([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // pixi not installed globally
  }

  return {
    version: null,
    error: 'Could not detect pixi version. Use --fw-version to specify.',
  }
}

export const pixiProvider: DocProvider = {
  name: 'pixi',
  displayName: 'Pixi',
  repo: 'prefix-dev/pixi',
  docsPath: 'docs',
  extensions: ['.md'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: [
    '**/index.md',
    '**/__README.md',
    '**/partials/**',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
    '**/overrides/**',
    '**/layouts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any pixi tasks. Pixi is a cross-platform package manager for conda environments.',
}
