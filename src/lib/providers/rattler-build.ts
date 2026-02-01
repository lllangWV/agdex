/**
 * rattler-build documentation provider
 *
 * rattler-build is a tool for building conda packages from recipes.
 * https://github.com/prefix-dev/rattler-build
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(cwd: string): VersionResult {
  // Check for pixi.toml with rattler-build dependency
  const pixiTomlPath = path.join(cwd, 'pixi.toml')
  if (fs.existsSync(pixiTomlPath)) {
    try {
      const content = fs.readFileSync(pixiTomlPath, 'utf-8')
      // Look for rattler-build in dependencies
      const match = content.match(/rattler-build\s*=\s*["']([^"']+)["']/)
      if (match) {
        const versionMatch = match[1].match(/[\d]+\.[\d]+\.[\d]+/)
        if (versionMatch) {
          return { version: versionMatch[0] }
        }
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check for pyproject.toml with rattler-build
  const pyprojectPath = path.join(cwd, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      const match = content.match(/rattler-build\s*=\s*["']([^"']+)["']/)
      if (match) {
        const versionMatch = match[1].match(/[\d]+\.[\d]+\.[\d]+/)
        if (versionMatch) {
          return { version: versionMatch[0] }
        }
      }
    } catch {
      // Continue
    }
  }

  // Check if rattler-build is installed and get version
  try {
    const { execSync } = require('child_process')
    const output = execSync('rattler-build --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const versionMatch = output.match(/rattler-build ([\d]+\.[\d]+\.[\d]+)/)
    if (versionMatch) {
      return { version: versionMatch[1] }
    }
  } catch {
    // rattler-build not installed globally
  }

  return {
    version: null,
    error: 'Could not detect rattler-build version. Use --fw-version to specify.',
  }
}

export const rattlerBuildProvider: DocProvider = {
  name: 'rattler-build',
  displayName: 'rattler-build',
  repo: 'prefix-dev/rattler-build',
  docsPath: 'docs',
  extensions: ['.md'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: [
    '**/index.md',
    '**/assets/**',
    '**/stylesheets/**',
    '**/layouts/**',
    '**/overrides/**',
    '**/generator/**',
  ],
  instruction:
    'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any rattler-build tasks. rattler-build is a tool for building conda packages from recipe.yaml files.',
}
