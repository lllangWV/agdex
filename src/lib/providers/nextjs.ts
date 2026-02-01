/**
 * Next.js documentation provider
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectWorkspace(cwd: string): {
  isMonorepo: boolean
  type: string | null
  packages: string[]
} {
  const packageJsonPath = path.join(cwd, 'package.json')

  // Check pnpm workspaces
  const pnpmWorkspacePath = path.join(cwd, 'pnpm-workspace.yaml')
  if (fs.existsSync(pnpmWorkspacePath)) {
    const packages = parsePnpmWorkspace(pnpmWorkspacePath)
    if (packages.length > 0) {
      return { isMonorepo: true, type: 'pnpm', packages }
    }
  }

  // Check npm/yarn workspaces
  if (fs.existsSync(packageJsonPath)) {
    const packages = parsePackageJsonWorkspaces(packageJsonPath)
    if (packages.length > 0) {
      return { isMonorepo: true, type: 'npm', packages }
    }
  }

  return { isMonorepo: false, type: null, packages: [] }
}

function parsePnpmWorkspace(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const packages: string[] = []
    let inPackages = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'packages:') {
        inPackages = true
        continue
      }
      if (inPackages) {
        if (trimmed && !trimmed.startsWith('-') && !trimmed.startsWith('#')) {
          break
        }
        const match = trimmed.match(/^-\s*['"]?([^'"]+)['"]?$/)
        if (match) {
          packages.push(match[1])
        }
      }
    }
    return packages
  } catch {
    return []
  }
}

function parsePackageJsonWorkspaces(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const pkg = JSON.parse(content)

    if (Array.isArray(pkg.workspaces)) {
      return pkg.workspaces
    }
    if (pkg.workspaces?.packages && Array.isArray(pkg.workspaces.packages)) {
      return pkg.workspaces.packages
    }
    return []
  } catch {
    return []
  }
}

function expandWorkspacePatterns(cwd: string, patterns: string[]): string[] {
  const packagePaths: string[] = []

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue

    if (pattern.includes('*')) {
      const basePath = path.join(cwd, pattern.replace('/*', '').replace('/**', ''))
      if (fs.existsSync(basePath)) {
        try {
          const entries = fs.readdirSync(basePath)
          for (const entry of entries) {
            const fullPath = path.join(basePath, entry)
            if (fs.statSync(fullPath).isDirectory()) {
              packagePaths.push(fullPath)
            }
          }
        } catch {
          // Permission denied
        }
      }
    } else {
      const fullPath = path.join(cwd, pattern)
      if (fs.existsSync(fullPath)) {
        packagePaths.push(fullPath)
      }
    }
  }

  return [...new Set(packagePaths)]
}

function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!match) return [0, 0, 0]
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
  }

  const [aMajor, aMinor, aPatch] = parseVersion(a)
  const [bMajor, bMinor, bPatch] = parseVersion(b)

  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}

function findNextjsInWorkspace(cwd: string, patterns: string[]): string | null {
  const packagePaths = expandWorkspacePatterns(cwd, patterns)
  const versions: string[] = []

  for (const pkgPath of packagePaths) {
    const packageJsonPath = path.join(pkgPath, 'package.json')
    if (!fs.existsSync(packageJsonPath)) continue

    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const nextVersion = pkg.dependencies?.next || pkg.devDependencies?.next

      if (nextVersion) {
        versions.push(nextVersion.replace(/^[\^~>=<]+/, ''))
      }
    } catch {
      // Skip invalid package.json
    }
  }

  if (versions.length === 0) return null
  if (versions.length === 1) return versions[0]

  return versions.reduce((highest, current) => {
    return compareVersions(current, highest) > 0 ? current : highest
  })
}

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
    const nextVersion = dependencies.next || devDependencies.next

    if (nextVersion) {
      const cleanVersion = nextVersion.replace(/^[\^~>=<]+/, '')
      return { version: cleanVersion }
    }

    // Check for monorepo workspace
    const workspace = detectWorkspace(cwd)
    if (workspace.isMonorepo && workspace.packages.length > 0) {
      const highestVersion = findNextjsInWorkspace(cwd, workspace.packages)
      if (highestVersion) {
        return { version: highestVersion }
      }
      return {
        version: null,
        error: `No Next.js found in ${workspace.type} workspace packages.`,
      }
    }

    return {
      version: null,
      error: 'Next.js is not installed in this project.',
    }
  } catch (err) {
    return {
      version: null,
      error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export const nextjsProvider: DocProvider = {
  name: 'nextjs',
  displayName: 'Next.js',
  repo: 'vercel/next.js',
  docsPath: 'docs',
  extensions: ['.mdx', '.md'],
  detectVersion,
  versionToTag: (version) => (version.startsWith('v') ? version : `v${version}`),
  excludePatterns: ['**/index.mdx', '**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Next.js tasks.',
}
