/**
 * shadcn-svelte documentation provider
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
    const version = dependencies['shadcn-svelte'] || devDependencies['shadcn-svelte']

    if (version) {
      const cleanVersion = version.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    return {
      version: null,
      error: 'shadcn-svelte is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const shadcnSvelteProvider: DocProvider = {
  name: 'shadcn-svelte',
  displayName: 'shadcn-svelte',
  repo: 'huntabyte/shadcn-svelte',
  docsPath: 'docs/content',
  extensions: ['.md'],
  detectVersion,
  versionToTag: (version) => `shadcn-svelte@${version}`,
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any shadcn-svelte tasks.',
}
