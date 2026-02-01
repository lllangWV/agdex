/**
 * Ruff documentation provider
 *
 * Ruff is an extremely fast Python linter and formatter.
 * https://github.com/astral-sh/ruff
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parseRuffVersion(content: string): string | null {
  // Check for ruff in dependencies (various formats)
  // e.g., ruff = ">=0.8.0" or "ruff>=0.8.0" or ruff = "0.8.0"
  const patterns = [
    /ruff\s*=\s*["']([^"']+)["']/,
    /["']ruff([><=!~]+[\d.]+)["']/,
    /["']ruff\s*([><=!~]*[\d.]+)["']/,
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
      // Check if ruff is configured or listed as dependency
      if (content.includes('ruff')) {
        const version = parseRuffVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check for ruff.toml (indicates ruff is used but no version)
  const ruffTomlPath = path.join(cwd, 'ruff.toml')
  if (fs.existsSync(ruffTomlPath)) {
    // ruff.toml doesn't contain version, try global
  }

  // Check if ruff is installed globally and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('ruff --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/ruff ([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // ruff not installed globally
  }

  return {
    version: null,
    error: 'Could not detect ruff version. Use --fw-version to specify.',
  }
}

export const ruffProvider: DocProvider = {
  name: 'ruff',
  displayName: 'Ruff',
  repo: 'astral-sh/ruff',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  // Ruff uses plain version tags without 'v' prefix
  versionToTag: (version) => version.replace(/^v/, ''),
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Ruff tasks. Ruff is an extremely fast Python linter and formatter.',
}
