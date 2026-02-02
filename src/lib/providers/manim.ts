/**
 * Manim documentation provider
 *
 * Manim is a community-maintained Python library for creating
 * mathematical animations.
 * https://github.com/ManimCommunity/manim
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

/**
 * Parse version from pyproject.toml dependencies
 */
function parseManimVersion(content: string): string | null {
  const patterns = [
    /manim\s*=\s*["']([^"']+)["']/,
    /["']manim([><=!~]+[\d.]+)["']/,
    /["']manim\s*([><=!~]*[\d.]+)["']/,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match) {
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
  const match = content.match(/manim[><=!~]*([\d]+\.[\d]+\.[\d]+)/)
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
      if (content.includes('manim')) {
        const version = parseManimVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check for requirements.txt
  const requirementsPath = path.join(cwd, 'requirements.txt')
  if (fs.existsSync(requirementsPath)) {
    try {
      const content = fs.readFileSync(requirementsPath, 'utf-8')
      if (content.includes('manim')) {
        const version = parseRequirementsVersion(content)
        if (version) {
          return { version }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check if manim is installed via pip
  try {
    const { execSync } = require('child_process')
    const output = execSync('pip show manim', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const versionMatch = output.match(/Version:\s*([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // manim not installed
  }

  return {
    version: null,
    error: 'Could not detect manim version. Use --fw-version to specify.',
  }
}

export const manimProvider: DocProvider = {
  name: 'manim',
  displayName: 'Manim',
  repo: 'ManimCommunity/manim',
  docsPath: 'docs',
  extensions: ['.md', '.rst', '.py'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: [
    '**/index.md',
    '**/conf.py',
    '**/Makefile',
    '**/_static/**',
    '**/_templates/**',
  ],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Manim tasks. Manim is a Python library for mathematical animations.',
}
