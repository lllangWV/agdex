/**
 * SvelteKit documentation provider
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
    const kitVersion = dependencies['@sveltejs/kit'] || devDependencies['@sveltejs/kit']

    if (kitVersion) {
      const cleanVersion = kitVersion.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    return {
      version: null,
      error: '@sveltejs/kit is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const sveltekitProvider: DocProvider = {
  name: 'sveltekit',
  displayName: 'SvelteKit',
  repo: 'sveltejs/kit',
  docsPath: 'documentation/docs',
  extensions: ['.md'],
  detectVersion,
  versionToTag: (version) => `@sveltejs/kit@${version}`,
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any SvelteKit tasks.',
}
