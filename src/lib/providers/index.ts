/**
 * Documentation providers
 */
export { nextjsProvider } from './nextjs'
export { reactProvider } from './react'
export { pixiProvider } from './pixi'
export { rattlerBuildProvider } from './rattler-build'
export { tauriProvider } from './tauri'
export { condaForgeProvider } from './conda-forge'
export { createProvider, createLocalProvider } from './generic'
export type { GenericProviderOptions } from './generic'

import { nextjsProvider } from './nextjs'
import { reactProvider } from './react'
import { pixiProvider } from './pixi'
import { rattlerBuildProvider } from './rattler-build'
import { tauriProvider } from './tauri'
import { condaForgeProvider } from './conda-forge'
import type { DocProvider, ProviderPreset } from '../types'

/**
 * Get a built-in provider by name
 */
export function getProvider(preset: ProviderPreset): DocProvider | null {
  switch (preset) {
    case 'nextjs':
      return nextjsProvider
    case 'react':
      return reactProvider
    case 'pixi':
      return pixiProvider
    case 'rattler-build':
      return rattlerBuildProvider
    case 'tauri':
      return tauriProvider
    case 'conda-forge':
      return condaForgeProvider
    // Add more providers as needed
    case 'vue':
    case 'svelte':
    case 'astro':
      // These can be added later with proper detection
      return null
    default:
      return null
  }
}

/**
 * List all available provider presets
 */
export function listProviders(): ProviderPreset[] {
  return ['nextjs', 'react', 'pixi', 'rattler-build', 'tauri', 'conda-forge', 'vue', 'svelte', 'astro']
}

/**
 * Check if a provider preset is available
 */
export function isProviderAvailable(preset: ProviderPreset): boolean {
  return getProvider(preset) !== null
}
