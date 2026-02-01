/**
 * conda-forge documentation provider
 *
 * conda-forge is a community-led collection of recipes and packages for conda.
 * https://github.com/conda-forge/conda-forge.github.io
 */
import fs from 'fs'
import path from 'path'
import type { DocProvider, VersionResult } from '../types'

function detectVersion(_cwd: string): VersionResult {
  // conda-forge docs don't have versioned releases
  // Always use main branch
  return { version: 'main' }
}

export const condaForgeProvider: DocProvider = {
  name: 'conda-forge',
  displayName: 'conda-forge',
  repo: 'conda-forge/conda-forge.github.io',
  docsPath: 'docs',
  extensions: ['.md', '.mdx'],
  detectVersion,
  // conda-forge uses branch name, not version tags
  versionToTag: (version) => version,
  excludePatterns: [
    '**/index.md',
    '**/_sidebar.js',
    '**/_sidebar.json',
    '**/_sidebar_diataxis.json',
  ],
  instruction:
    'IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any conda-forge tasks. conda-forge is a community-led collection of recipes, build infrastructure, and packages for conda.',
}
