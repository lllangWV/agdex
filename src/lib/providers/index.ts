/**
 * Documentation providers
 */
export { nextjsProvider } from './nextjs'
export { reactProvider } from './react'
export { pixiProvider } from './pixi'
export { rattlerBuildProvider } from './rattler-build'
export { tauriProvider } from './tauri'
export { condaForgeProvider } from './conda-forge'
export { bunProvider } from './bun'
export { svelteProvider } from './svelte'
export { sveltekitProvider } from './sveltekit'
export { shadcnSvelteProvider } from './shadcn-svelte'
export { tailwindProvider } from './tailwind'
export { ruffProvider } from './ruff'
export { tyProvider } from './ty'
export { basedpyrightProvider } from './basedpyright'
export { convexProvider } from './convex'
export { polarsProvider } from './polars'
export { deltaRsProvider } from './delta-rs'
export { obsidianProvider } from './obsidian'
export { obsidianExcalidrawProvider } from './obsidian-excalidraw'
export { ffmpegProvider } from './ffmpeg'
export { manimProvider } from './manim'
export { cudaFeedstockProvider } from './cuda-feedstock'
export { createProvider, createLocalProvider } from './generic'
export type { GenericProviderOptions } from './generic'

import { nextjsProvider } from './nextjs'
import { reactProvider } from './react'
import { pixiProvider } from './pixi'
import { rattlerBuildProvider } from './rattler-build'
import { tauriProvider } from './tauri'
import { condaForgeProvider } from './conda-forge'
import { bunProvider } from './bun'
import { svelteProvider } from './svelte'
import { sveltekitProvider } from './sveltekit'
import { shadcnSvelteProvider } from './shadcn-svelte'
import { tailwindProvider } from './tailwind'
import { ruffProvider } from './ruff'
import { tyProvider } from './ty'
import { basedpyrightProvider } from './basedpyright'
import { convexProvider } from './convex'
import { polarsProvider } from './polars'
import { deltaRsProvider } from './delta-rs'
import { obsidianProvider } from './obsidian'
import { obsidianExcalidrawProvider } from './obsidian-excalidraw'
import { ffmpegProvider } from './ffmpeg'
import { manimProvider } from './manim'
import { cudaFeedstockProvider } from './cuda-feedstock'
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
    case 'bun':
      return bunProvider
    case 'svelte':
      return svelteProvider
    case 'sveltekit':
      return sveltekitProvider
    case 'shadcn-svelte':
      return shadcnSvelteProvider
    case 'tailwind':
      return tailwindProvider
    case 'ruff':
      return ruffProvider
    case 'ty':
      return tyProvider
    case 'basedpyright':
      return basedpyrightProvider
    case 'convex':
      return convexProvider
    case 'polars':
      return polarsProvider
    case 'delta-rs':
      return deltaRsProvider
    case 'obsidian':
      return obsidianProvider
    case 'obsidian-excalidraw':
      return obsidianExcalidrawProvider
    case 'ffmpeg':
      return ffmpegProvider
    case 'manim':
      return manimProvider
    case 'cuda-feedstock':
      return cudaFeedstockProvider
    // Add more providers as needed
    case 'vue':
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
  return ['nextjs', 'react', 'pixi', 'rattler-build', 'tauri', 'conda-forge', 'bun', 'vue', 'svelte', 'sveltekit', 'shadcn-svelte', 'astro', 'tailwind', 'ruff', 'ty', 'basedpyright', 'convex', 'polars', 'delta-rs', 'obsidian', 'obsidian-excalidraw', 'ffmpeg', 'manim', 'cuda-feedstock']
}

/**
 * Check if a provider preset is available
 */
export function isProviderAvailable(preset: ProviderPreset): boolean {
  return getProvider(preset) !== null
}
