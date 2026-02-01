/**
 * Svelte documentation provider
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
    const svelteVersion = dependencies.svelte || devDependencies.svelte

    if (svelteVersion) {
      const cleanVersion = svelteVersion.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    return {
      version: null,
      error: 'Svelte is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const svelteProvider: DocProvider = {
  name: 'svelte',
  displayName: 'Svelte',
  repo: 'sveltejs/svelte',
  docsPath: 'documentation/docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  // Svelte 5+ uses svelte@X.Y.Z tags, earlier versions use vX.Y.Z
  versionToTag: (version) => {
    const major = parseInt(version.split('.')[0], 10)
    if (major >= 5) {
      return `svelte@${version}`
    }
    return version.startsWith('v') ? version : `v${version}`
  },
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Svelte tasks.',
}
