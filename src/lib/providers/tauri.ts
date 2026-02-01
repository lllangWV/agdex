/**
 * Tauri documentation provider
 *
 * Tauri is a framework for building tiny, fast binaries for desktop and mobile.
 * https://github.com/tauri-apps/tauri-docs
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(cwd: string): VersionResult {
  // Check package.json for @tauri-apps/cli or @tauri-apps/api
  const packageJsonPath = path.join(cwd, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      // Check for Tauri v2 packages
      const tauriApi = deps['@tauri-apps/api']
      const tauriCli = deps['@tauri-apps/cli']

      if (tauriApi || tauriCli) {
        const version = tauriApi || tauriCli
        const versionMatch = version.match(/(\d+)\./)
        if (versionMatch) {
          const major = parseInt(versionMatch[1])
          // Return branch name based on major version
          return { version: major >= 2 ? 'v2' : 'v1' }
        }
        return { version: 'v2' } // Default to v2
      }
    } catch {
      // Continue to try other methods
    }
  }

  // Check for tauri.conf.json (indicates Tauri project)
  const tauriConfPath = path.join(cwd, 'src-tauri', 'tauri.conf.json')
  if (fs.existsSync(tauriConfPath)) {
    return { version: 'v2' } // Default to latest docs
  }

  // Check Cargo.toml for tauri dependency
  const cargoTomlPath = path.join(cwd, 'src-tauri', 'Cargo.toml')
  if (fs.existsSync(cargoTomlPath)) {
    try {
      const content = fs.readFileSync(cargoTomlPath, 'utf-8')
      const match = content.match(/tauri\s*=\s*.*?"(\d+)\./)
      if (match) {
        const major = parseInt(match[1])
        return { version: major >= 2 ? 'v2' : 'v1' }
      }
      return { version: 'v2' }
    } catch {
      // Continue
    }
  }

  return {
    version: null,
    error: 'Could not detect Tauri version. Use --fw-version to specify (v1 or v2).',
  }
}

export const tauriProvider: DocProvider = {
  name: 'tauri',
  displayName: 'Tauri',
  repo: 'tauri-apps/tauri-docs',
  docsPath: 'src/content/docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  // Tauri docs use branch names, not version tags
  versionToTag: (version) => version,
  excludePatterns: [
    '**/index.mdx',
    '**/index.md',
    '**/_fragments/**',
    '**/_it/**',
    // Exclude i18n folders (non-English)
    '**/es/**',
    '**/fr/**',
    '**/it/**',
    '**/ja/**',
    '**/ko/**',
    '**/zh-cn/**',
    // Exclude special files
    '**/404.md',
    '**/rss.mdx',
  ],
  instruction:
    'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Tauri tasks. Tauri is a framework for building desktop and mobile apps with web frontends.',
}
