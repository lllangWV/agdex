/**
 * delta-rs documentation provider
 *
 * delta-rs is a native Rust implementation of Delta Lake with Python bindings.
 * https://github.com/delta-io/delta-rs
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parseDeltaLakeVersion(content: string): string | null {
  // Check for deltalake in dependencies (various formats)
  const patterns = [
    /deltalake\s*=\s*["']([^"']+)["']/,
    /["']deltalake([><=!~]+[\d.]+)["']/,
    /["']deltalake\s*([><=!~]*[\d.]+)["']/,
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
  const match = content.match(/deltalake[><=!~]*([\d]+\.[\d]+\.[\d]+)/)
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
      if (content.includes('deltalake')) {
        const version = parseDeltaLakeVersion(content)
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
      if (content.includes('deltalake')) {
        const version = parseRequirementsVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check if deltalake is installed and get version via pip
  try {
    const { execSync } = require('child_process')
    const output = execSync('pip show deltalake', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/Version:\s*([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // deltalake not installed
  }

  return {
    version: null,
    error: 'Could not detect deltalake version. Use --fw-version to specify.',
  }
}

export const deltaRsProvider: DocProvider = {
  name: 'delta-rs',
  displayName: 'delta-rs',
  repo: 'delta-io/delta-rs',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => `python-v${version}`,
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/javascripts/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any delta-rs/deltalake tasks. delta-rs is a native Rust implementation of Delta Lake.',
}
