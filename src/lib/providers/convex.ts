/**
 * Convex documentation provider
 *
 * Convex is a backend platform for web applications.
 * https://github.com/get-convex/convex-backend
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
    const convexVersion = dependencies.convex || devDependencies.convex

    if (convexVersion) {
      const cleanVersion = convexVersion.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    return {
      version: null,
      error: 'Convex is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const convexProvider: DocProvider = {
  name: 'convex',
  displayName: 'Convex',
  repo: 'get-convex/convex-backend',
  docsPath: 'npm-packages/docs/docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => `precompiled-${version}`,
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Convex tasks. Convex is a backend platform for web applications.',
}
