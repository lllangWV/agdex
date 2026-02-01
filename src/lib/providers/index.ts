/**
 * Documentation providers
 */
export { nextjsProvider } from './nextjs'
export { reactProvider } from './react'
export { pixiProvider } from './pixi'
export { createProvider, createLocalProvider } from './generic'
export type { GenericProviderOptions } from './generic'

import { nextjsProvider } from './nextjs'
import { reactProvider } from './react'
import { pixiProvider } from './pixi'
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
  return ['nextjs', 'react', 'pixi', 'vue', 'svelte', 'astro']
}

/**
 * Check if a provider preset is available
 */
export function isProviderAvailable(preset: ProviderPreset): boolean {
  return getProvider(preset) !== null
}
