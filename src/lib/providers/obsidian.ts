/**
 * Obsidian developer documentation provider
 *
 * Obsidian is a note-taking app with a powerful plugin system.
 * https://github.com/obsidianmd/obsidian-developer-docs
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(cwd: string): VersionResult {
  const packageJsonPath = path.join(cwd, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return {
      version: null,
      error: 'No package.json found in the current directory',
    }
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
    const dependencies = packageJson.dependencies || {}
    const devDependencies = packageJson.devDependencies || {}
    const obsidianVersion = dependencies.obsidian || devDependencies.obsidian

    if (obsidianVersion) {
      const cleanVersion = obsidianVersion.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    return {
      version: null,
      error: 'Obsidian is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const obsidianProvider: DocProvider = {
  name: 'obsidian',
  displayName: 'Obsidian',
  repo: 'obsidianmd/obsidian-developer-docs',
  docsPath: 'en',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Obsidian plugin development tasks.',
}
