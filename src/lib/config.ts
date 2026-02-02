/**
 * Configuration loading for agdex
 *
 * Supports configuration from:
 * 1. .agdexrc.json (takes priority)
 * 2. "agdex" field in package.json
 */
import fs from 'fs'
import path from 'path'

export interface AgdexConfig {
  /** Default output file (AGENTS.md or CLAUDE.md) */
  output?: string
}

const DEFAULT_CONFIG: AgdexConfig = {
  output: 'CLAUDE.md',
}

/**
 * Load configuration from .agdexrc.json or package.json
 */
export function loadConfig(cwd: string = process.cwd()): AgdexConfig {
  // Try .agdexrc.json first (takes priority)
  const rcPath = path.join(cwd, '.agdexrc.json')
  if (fs.existsSync(rcPath)) {
    try {
      const content = fs.readFileSync(rcPath, 'utf-8')
      const config = JSON.parse(content) as AgdexConfig
      return { ...DEFAULT_CONFIG, ...config }
    } catch {
      // Invalid JSON, fall through to package.json
    }
  }

  // Try package.json "agdex" field
  const packageJsonPath = path.join(cwd, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const packageJson = JSON.parse(content)
      if (packageJson.agdex && typeof packageJson.agdex === 'object') {
        return { ...DEFAULT_CONFIG, ...packageJson.agdex }
      }
    } catch {
      // Invalid JSON or no agdex field
    }
  }

  return DEFAULT_CONFIG
}

/**
 * Get the default output file from config
 */
export function getDefaultOutput(cwd: string = process.cwd()): string {
  const config = loadConfig(cwd)
  return config.output || 'AGENTS.md'
}
