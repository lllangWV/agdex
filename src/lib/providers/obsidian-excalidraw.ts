/**
 * Obsidian Excalidraw plugin documentation provider
 *
 * A plugin to edit and view Excalidraw drawings in Obsidian.
 * https://github.com/zsviczian/obsidian-excalidraw-plugin
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(cwd: string): VersionResult {
  // Check for manifest.json (Obsidian plugin format)
  const manifestPath = path.join(cwd, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      if (manifest.id === 'obsidian-excalidraw-plugin' && manifest.version) {
        return { version: manifest.version }
      }
    } catch {
      // Continue
    }
  }

  return {
    version: null,
    error: 'Could not detect obsidian-excalidraw-plugin version. Use --fw-version to specify.',
  }
}

export const obsidianExcalidrawProvider: DocProvider = {
  name: 'obsidian-excalidraw',
  displayName: 'Obsidian Excalidraw',
  repo: 'zsviczian/obsidian-excalidraw-plugin',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  versionToTag: (version) => version,
  excludePatterns: ['**/index.md'],
  instruction: 'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any Obsidian Excalidraw plugin tasks.',
}
