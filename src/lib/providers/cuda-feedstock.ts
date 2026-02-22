/**
 * conda-forge cuda-feedstock documentation provider
 */
import type { DocProvider, VersionResult } from '../types'

function detectVersion(_cwd: string): VersionResult {
  return { version: 'main' }
}

export const cudaFeedstockProvider: DocProvider = {
  name: 'cuda-feedstock',
  displayName: 'CUDA Feedstock',
  repo: 'conda-forge/cuda-feedstock',
  docsPath: 'recipe',
  extensions: ['.md', '.yaml'],
  detectVersion,
  versionToTag: (version) => version,
  excludePatterns: [],
  instruction: 'This should be used when building and running CUDA packages with rattler-build, conda-forge, pixi.',
}
