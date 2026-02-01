/**
 * ty documentation provider
 *
 * ty is an extremely fast Python type checker.
 * https://github.com/astral-sh/ty
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parseTyVersion(content: string): string | null {
  // Check for ty in dependencies (various formats)
  // e.g., ty = ">=0.1.0" or "ty>=0.1.0" or ty = "0.1.0"
  const patterns = [
    /\bty\s*=\s*["']([^"']+)["']/,
    /["']ty([><=!~]+[\d.]+)["']/,
    /["']ty\s*([><=!~]*[\d.]+)["']/,
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
      // Check if ty is configured or listed as dependency
      if (content.includes('[tool.ty]') || /["']ty[>=<]/.test(content) || /\bty\s*=/.test(content)) {
        const version = parseTyVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check if ty is installed globally and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('ty --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/ty ([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // ty not installed globally
  }

  return {
    version: null,
    error: 'Could not detect ty version. Use --fw-version to specify.',
  }
}

export const tyProvider: DocProvider = {
  name: 'ty',
  displayName: 'ty',
  repo: 'astral-sh/ty',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  // ty uses plain version tags without 'v' prefix (like ruff)
  versionToTag: (version) => version.replace(/^v/, ''),
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ty tasks. ty is an extremely fast Python type checker from Astral.',
}
