/**
 * Polars documentation provider
 *
 * Polars is a blazingly fast DataFrame library for Python and Rust.
 * https://github.com/pola-rs/polars
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parsePolarsVersion(content: string): string | null {
  // Check for polars in dependencies (various formats)
  const patterns = [
    /polars\s*=\s*["']([^"']+)["']/,
    /["']polars([><=!~]+[\d.]+)["']/,
    /["']polars\s*([><=!~]*[\d.]+)["']/,
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

/**
 * Parse version from requirements.txt
 */
function parseRequirementsVersion(content: string): string | null {
  const match = content.match(/polars[><=!~]*([\d]+\.[\d]+\.[\d]+)/)
  if (match) {
    return match[1]
  }
  return null
}

function detectVersion(cwd: string): VersionResult {
  // Check for pyproject.toml
  const pyprojectPath = path.join(cwd, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      if (content.includes('polars')) {
        const version = parsePolarsVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check for requirements.txt
  const requirementsPath = path.join(cwd, 'requirements.txt')
  if (fs.existsSync(requirementsPath)) {
    try {
      const content = fs.readFileSync(requirementsPath, 'utf-8')
      if (content.includes('polars')) {
        const version = parseRequirementsVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check if polars is installed and get version via pip
  try {
    const { execSync } = require('child_process')
    const output = execSync('pip show polars', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/Version:\s*([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // polars not installed
  }

  return {
    version: null,
    error: 'Could not detect polars version. Use --fw-version to specify.',
  }
}

export const polarsProvider: DocProvider = {
  name: 'polars',
  displayName: 'Polars',
  repo: 'pola-rs/polars',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => `py-${version}`,
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Polars tasks. Polars is a blazingly fast DataFrame library.',
}
