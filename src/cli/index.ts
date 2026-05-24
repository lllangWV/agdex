#!/usr/bin/env node
/**
 * CLI for agdex
 */
import { Command } from 'commander'
import prompts from 'prompts'
import pc from 'picocolors'
import { configurableMultiselect } from './configurable-select'
import {
  embed,
  pullDocs,
  collectDocFiles,
  buildDocTree,
  generateIndex,
  injectIndex,
  ensureGitignoreEntry,
  hasExistingIndex,
  removeDocsIndex,
  getEmbeddedProviders,
} from '../lib/agents-md'
import {
  embedSkills,
  collectAllSkills,
  getDefaultSkillSources,
  hasExistingSkillsIndex,
  removeSkillsIndex,
  discoverSkillsShRepo,
  generateSkillsIndex,
  injectSkillsIndex,
  fetchSkillsShSearch,
} from '../lib/skills'
import os from 'os'
import type { SkillSourceConfig, SkillSource } from '../lib/types'
import {
  getProvider,
  listProviders,
  isProviderAvailable,
  createProvider,
  nextjsProvider,
  pixiProvider,
  rattlerBuildProvider,
  tauriProvider,
  bunProvider,
  svelteProvider,
  tailwindProvider,
  ruffProvider,
  tyProvider,
  basedpyrightProvider,
  convexProvider,
  polarsProvider,
  deltaRsProvider,
  obsidianProvider,
  obsidianExcalidrawProvider,
  ffmpegProvider,
  manimProvider,
} from '../lib/providers'
import type { DocProvider, ProviderPreset } from '../lib/types'
import { getDefaultOutput } from '../lib/config'
import { createStatusReport, type IndexStatus } from '../lib/index-maintenance'
import {
  createIndexId,
  readIndexLockfile,
  upsertIndexLockEntry,
} from '../lib/lockfile'
import fs from 'fs'
import path from 'path'

const program = new Command()

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

function onCancel() {
  console.log(pc.yellow('\nCancelled.'))
  process.exit(0)
}

interface EmbedCommandOptions {
  provider?: string
  fwVersion?: string
  output?: string
  repo?: string
  docsPath?: string
  global?: boolean
  local?: boolean
  description?: string
  url?: string
}

function resolveGlobalCacheOption(options: { global?: boolean; local?: boolean }): boolean {
  if (options.global && options.local) {
    console.error(pc.red('Choose either --global or --local, not both.'))
    process.exit(1)
  }

  return options.global ? true : false
}

async function runEmbed(options: EmbedCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const globalCache = resolveGlobalCacheOption(options)

  // Delegate to URL scraper if --url is provided
  if (options.url) {
    await runUrl(options.url, {
      output: options.output,
      name: options.description,
      global: globalCache,
    })
    return
  }

  let provider: DocProvider
  let version: string | undefined = options.fwVersion
  let output: string

  // Determine provider
  if (options.repo && options.docsPath) {
    // Custom provider from CLI flags
    provider = createProvider({
      name: 'custom',
      displayName: 'Custom',
      repo: options.repo,
      docsPath: options.docsPath,
    })
  } else if (options.provider) {
    const preset = options.provider as ProviderPreset
    const builtIn = getProvider(preset)
    if (!builtIn) {
      console.error(
        pc.red(`Unknown provider: ${options.provider}. Available: ${listProviders().join(', ')}`)
      )
      process.exit(1)
    }
    provider = builtIn
  } else if (options.output && !options.fwVersion) {
    // No provider specified, try to auto-detect
    const detected = autoDetectProvider(cwd)
    if (detected) {
      provider = detected.provider
      version = detected.version || undefined
    } else {
      // Fall through to interactive mode
      const result = await promptForOptions(cwd)
      provider = result.provider
      version = result.version
      output = result.output
      await executeEmbed(cwd, provider, version, output, globalCache, result.description, version ? 'auto' : 'unknown')
      return
    }
  } else {
    // Interactive mode
    const result = await promptForOptions(cwd)
    provider = result.provider
    version = result.version
    output = result.output
    await executeEmbed(cwd, provider, version, output, globalCache, result.description, version ? 'auto' : 'unknown')
    return
  }

  // Determine output file
  output = options.output || getDefaultOutput()

  // Version validation (URL-based providers don't need version detection)
  if (!version && !provider.detectVersion && !provider.urlConfig) {
    console.error(
      pc.red(
        `Provider ${provider.displayName} requires --version flag since auto-detection is not supported.`
      )
    )
    process.exit(1)
  }

  await executeEmbed(
    cwd,
    provider,
    version,
    output,
    globalCache,
    options.description,
    options.fwVersion ? 'pinned' : version ? 'auto' : 'unknown'
  )
}

async function executeEmbed(
  cwd: string,
  provider: DocProvider,
  version: string | undefined,
  output: string,
  globalCache?: boolean,
  description?: string,
  versionMode?: 'auto' | 'pinned' | 'default-branch' | 'unknown'
): Promise<void> {
  // Detect version if needed
  let resolvedVersion = version
  let usingDefaultBranch = false
  if (!resolvedVersion && provider.urlConfig) {
    // URL-based providers always use 'latest'
    resolvedVersion = 'latest'
    usingDefaultBranch = true
  } else if (!resolvedVersion && provider.detectVersion) {
    const detected = provider.detectVersion(cwd)
    if (!detected.version) {
      const fallbackBranch = provider.defaultBranch || 'main'
      console.log(
        pc.yellow(`\n⚠ ${detected.error || `Could not detect ${provider.displayName} version`}`)
      )
      console.log(pc.yellow(`  Using latest documentation from '${fallbackBranch}' branch.\n`))
      resolvedVersion = fallbackBranch
      usingDefaultBranch = true
      versionMode = versionMode || 'default-branch'
    } else {
      resolvedVersion = detected.version
      versionMode = versionMode || 'auto'
    }
  }

  const versionLabel = usingDefaultBranch ? 'latest' : resolvedVersion!
  console.log(
    `\nEmbedding ${pc.cyan(provider.displayName)} ${pc.cyan(versionLabel)} documentation...`
  )

  const result = await embed({
    cwd,
    provider,
    version: resolvedVersion,
    versionMode,
    output,
    globalCache,
    description,
  })

  if (!result.success) {
    console.error(pc.red(`Failed: ${result.error}`))
    process.exit(1)
  }

  if (result.cacheHit) {
    console.log(`${pc.green('✓')} Using cached docs from ${pc.bold(result.docsPath!)}`)
  } else {
    console.log(`${pc.green('✓')} Downloaded docs to ${pc.bold(result.docsPath!)}`)
  }

  const action = result.isNewFile ? 'Created' : 'Updated'
  const sizeInfo = result.isNewFile
    ? formatSize(result.sizeAfter!)
    : `${formatSize(result.sizeBefore!)} → ${formatSize(result.sizeAfter!)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(result.targetFile!)} (${sizeInfo})`)

  if (result.gitignoreUpdated) {
    console.log(`${pc.green('✓')} Added ${pc.bold('.agdex')} to .gitignore`)
  }

  console.log('')
}

function autoDetectProvider(
  cwd: string
): { provider: DocProvider; version: string | null } | null {
  // Try each built-in provider
  const providers: DocProvider[] = [nextjsProvider, pixiProvider, rattlerBuildProvider, tauriProvider, bunProvider, svelteProvider, tailwindProvider, ruffProvider, tyProvider, basedpyrightProvider, convexProvider, polarsProvider, deltaRsProvider, obsidianProvider, obsidianExcalidrawProvider, ffmpegProvider, manimProvider]

  for (const provider of providers) {
    if (provider.detectVersion) {
      const result = provider.detectVersion(cwd)
      if (result.version) {
        return { provider, version: result.version }
      }
    }
  }

  return null
}

/**
 * Parse a GitHub URL or owner/repo string into a normalized owner/repo format
 */
function parseGitHubInput(input: string): { repo: string; path?: string; branch?: string } | null {
  input = input.trim()

  // Handle owner/repo format directly
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input)) {
    return { repo: input }
  }

  // Handle full GitHub URLs
  // Examples:
  // https://github.com/owner/repo
  // https://github.com/owner/repo/tree/main/path/to/folder
  // https://github.com/owner/repo/blob/main/README.md
  const urlMatch = input.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?/
  )

  if (urlMatch) {
    return {
      repo: urlMatch[1],
      branch: urlMatch[2] || undefined,
      path: urlMatch[3] || undefined,
    }
  }

  return null
}

/**
 * Check what documentation sources exist in a GitHub repo
 */
async function detectRepoContent(repo: string, branch?: string): Promise<{
  hasDocs: boolean
  hasReadme: boolean
  hasSkills: boolean
  docsPath?: string
  skillsPath?: string
  defaultBranch: string
}> {
  const result = {
    hasDocs: false,
    hasReadme: false,
    hasSkills: false,
    docsPath: undefined as string | undefined,
    skillsPath: undefined as string | undefined,
    defaultBranch: branch || 'main',
  }

  // Use gh CLI to list repo contents
  const { execSync } = await import('child_process')

  try {
    // Get the default branch if not specified
    if (!branch) {
      try {
        const repoInfo = execSync(`gh api repos/${repo} --jq '.default_branch'`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        result.defaultBranch = repoInfo || 'main'
      } catch {
        result.defaultBranch = 'main'
      }
    }

    // List root directory contents
    const contents = execSync(
      `gh api repos/${repo}/contents?ref=${result.defaultBranch} --jq '.[].name'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim().split('\n')

    // Check for common documentation directories
    const docsDirectories = ['docs', 'doc', 'documentation']
    for (const dir of docsDirectories) {
      if (contents.includes(dir)) {
        result.hasDocs = true
        result.docsPath = dir
        break
      }
    }

    // Check for README
    const readmeFiles = ['README.md', 'README.mdx', 'readme.md', 'Readme.md']
    for (const readme of readmeFiles) {
      if (contents.includes(readme)) {
        result.hasReadme = true
        break
      }
    }

    // Check for skills directory
    const skillsDirectories = ['skills', '.claude/skills']
    for (const dir of skillsDirectories) {
      if (contents.includes(dir) || contents.includes(dir.split('/')[0])) {
        result.hasSkills = true
        result.skillsPath = dir
        break
      }
    }

  } catch {
    // gh CLI not available or error, return defaults
  }

  return result
}

async function promptForOptions(
  cwd: string
): Promise<{ provider: DocProvider; version: string; output: string; description?: string }> {
  // Try auto-detection first
  const detected = autoDetectProvider(cwd)

  console.log(pc.cyan('\nagdex - Documentation Index for AI Coding Agents\n'))

  console.log(pc.gray('  Create compressed documentation indexes for AI coding assistants.'))
  console.log(pc.gray('  Indexes are embedded into AGENTS.md/CLAUDE.md files.\n'))

  if (detected) {
    console.log(
      pc.green(`  ✓ Detected ${detected.provider.displayName} v${detected.version}\n`)
    )
  }

  // First, ask what the user wants to do
  const actionResponse = await prompts(
    {
      type: 'select',
      name: 'action',
      message: 'What would you like to index?',
      choices: [
        ...(detected ? [{
          title: `${detected.provider.displayName} docs (detected)`,
          value: 'detected',
          description: `Index ${detected.provider.displayName} v${detected.version} documentation`,
        }] : []),
        {
          title: 'Built-in provider',
          value: 'provider',
          description: 'Next.js, React, Pixi, Bun, Tauri, etc.',
        },
        {
          title: 'GitHub repository',
          value: 'github',
          description: 'Enter a GitHub URL or owner/repo',
        },
        {
          title: 'Local directory',
          value: 'local',
          description: 'Index docs from a local folder',
        },
        {
          title: 'Skills',
          value: 'skills',
          description: 'Index Claude Code skills',
        },
      ],
      initial: detected ? 0 : 0,
    },
    { onCancel }
  )

  // Handle detected provider shortcut
  if (actionResponse.action === 'detected' && detected) {
    const output = await promptForOutputFile()
    const description = await promptForDescription()
    return {
      provider: detected.provider,
      version: detected.version!,
      output,
      description,
    }
  }

  // Handle local directory
  if (actionResponse.action === 'local') {
    const localResponse = await prompts(
      {
        type: 'text',
        name: 'path',
        message: 'Path to documentation directory',
        initial: './docs',
        validate: (v: string) => {
          if (!v.trim()) return 'Please enter a path'
          const absPath = path.isAbsolute(v) ? v : path.join(cwd, v)
          if (!fs.existsSync(absPath)) return `Directory not found: ${v}`
          return true
        },
      },
      { onCancel }
    )

    // Delegate to runLocal
    const nameResponse = await prompts(
      {
        type: 'text',
        name: 'name',
        message: 'Display name',
        initial: path.basename(localResponse.path),
      },
      { onCancel }
    )

    const output = await promptForOutputFile()
    await runLocal(localResponse.path, { name: nameResponse.name, output })
    process.exit(0)
  }

  // Handle skills
  if (actionResponse.action === 'skills') {
    await runSkillsEmbed({})
    process.exit(0)
  }

  // Handle GitHub repository
  if (actionResponse.action === 'github') {
    return await promptForGitHubRepo(cwd)
  }

  // Handle built-in provider selection (configurable checklist)
  const availableProviders = listProviders().filter(isProviderAvailable)

  const choices = availableProviders.map((p) => {
    const provider = getProvider(p)!
    let defaultVersion = ''
    if (provider.detectVersion) {
      const detected = provider.detectVersion(cwd)
      if (detected.version) {
        defaultVersion = detected.version
      }
    }
    return {
      title: provider.displayName,
      value: p,
      defaultVersion,
    }
  })

  const selected = await configurableMultiselect({
    message: 'Select documentation providers',
    choices,
  })

  if (!selected || selected.length === 0) {
    console.log(pc.yellow('\nNo providers selected.\n'))
    process.exit(0)
  }

  const output = await promptForOutputFile()

  for (const item of selected) {
    const provider = getProvider(item.value as ProviderPreset)!
    await executeEmbed(cwd, provider, item.version, output, undefined, item.description || undefined, item.version ? 'pinned' : 'auto')
  }

  process.exit(0)
}

async function promptForOutputFile(): Promise<string> {
  const defaultOutput = getDefaultOutput()
  const choices = [
    { title: 'CLAUDE.local.md', value: 'CLAUDE.local.md' },
    { title: 'AGENTS.local.md', value: 'AGENTS.local.md' },
    { title: 'CLAUDE.md', value: 'CLAUDE.md' },
    { title: 'AGENTS.md', value: 'AGENTS.md' },
    { title: 'Custom...', value: '__custom__' },
  ]
  // Put configured default first
  const defaultIndex = choices.findIndex((c) => c.value === defaultOutput)
  const initial = defaultIndex >= 0 ? defaultIndex : 0

  const response = await prompts(
    {
      type: 'select',
      name: 'output',
      message: 'Target file',
      choices,
      initial,
    },
    { onCancel }
  )

  if (response.output === '__custom__') {
    const customOutput = await prompts(
      {
        type: 'text',
        name: 'file',
        message: 'Custom file path',
        initial: defaultOutput,
        validate: (v: string) => (v.trim() ? true : 'Please enter a file path'),
      },
      { onCancel }
    )
    return customOutput.file
  }

  return response.output
}

async function promptForDescription(): Promise<string | undefined> {
  const response = await prompts(
    {
      type: 'text',
      name: 'description',
      message: 'Additional description (optional, press Enter to skip)',
      initial: '',
    },
    { onCancel }
  )

  return response.description?.trim() || undefined
}

async function promptForGitHubRepo(
  cwd: string
): Promise<{ provider: DocProvider; version: string; output: string; description?: string }> {
  console.log('')
  console.log(pc.gray('  Enter a GitHub URL or owner/repo. Examples:'))
  console.log(pc.gray('    • anthropics/skills'))
  console.log(pc.gray('    • https://github.com/vercel/next.js'))
  console.log(pc.gray('    • https://github.com/anthropics/skills/tree/main/skills'))
  console.log('')

  const urlResponse = await prompts(
    {
      type: 'text',
      name: 'url',
      message: 'GitHub repository',
      validate: (v: string) => {
        if (!v.trim()) return 'Please enter a URL or owner/repo'
        const parsed = parseGitHubInput(v)
        if (!parsed) return 'Invalid format. Use owner/repo or a GitHub URL'
        return true
      },
    },
    { onCancel }
  )

  const parsed = parseGitHubInput(urlResponse.url)!

  console.log(`\n${pc.gray('Checking repository contents...')}`)

  const repoContent = await detectRepoContent(parsed.repo, parsed.branch)

  // If a specific path was provided in the URL, use it directly
  if (parsed.path) {
    console.log(pc.green(`  ✓ Using specified path: ${parsed.path}\n`))

    const nameResponse = await prompts(
      {
        type: 'text',
        name: 'name',
        message: 'Display name',
        initial: path.basename(parsed.path) || parsed.repo.split('/')[1],
      },
      { onCancel }
    )

    const versionResponse = await prompts(
      {
        type: 'text',
        name: 'version',
        message: 'Version/tag (or "latest" for default branch)',
        initial: parsed.branch || repoContent.defaultBranch,
      },
      { onCancel }
    )

    const output = await promptForOutputFile()
    const description = await promptForDescription()

    const provider = createProvider({
      name: nameResponse.name.toLowerCase().replace(/\s+/g, '-'),
      displayName: nameResponse.name,
      repo: parsed.repo,
      docsPath: parsed.path,
    })

    return { provider, version: versionResponse.version, output, description }
  }

  // Show what was detected
  const detected: string[] = []
  if (repoContent.hasDocs) detected.push(`docs (${repoContent.docsPath})`)
  if (repoContent.hasReadme) detected.push('README.md')
  if (repoContent.hasSkills) detected.push(`skills (${repoContent.skillsPath})`)

  if (detected.length > 0) {
    console.log(pc.green(`  ✓ Found: ${detected.join(', ')}\n`))
  } else {
    console.log(pc.yellow('  No standard docs/skills directories detected.\n'))
  }

  // Build choices based on what's available
  const choices: Array<{ title: string; value: string; description?: string }> = []

  if (repoContent.hasDocs) {
    choices.push({
      title: `Documentation (${repoContent.docsPath}/)`,
      value: 'docs',
      description: 'Index the docs directory',
    })
  }

  if (repoContent.hasReadme) {
    choices.push({
      title: 'README.md',
      value: 'readme',
      description: 'Index the README file',
    })
  }

  if (repoContent.hasSkills) {
    choices.push({
      title: `Skills (${repoContent.skillsPath}/)`,
      value: 'skills',
      description: 'Index Claude Code skills',
    })
  }

  choices.push({
    title: 'Custom path...',
    value: 'custom',
    description: 'Specify a custom path in the repository',
  })

  const contentChoice = await prompts(
    {
      type: 'select',
      name: 'content',
      message: 'What would you like to index?',
      choices,
    },
    { onCancel }
  )

  let docsPath: string
  let displayName: string = parsed.repo.split('/')[1]

  if (contentChoice.content === 'docs') {
    docsPath = repoContent.docsPath!
    displayName = `${parsed.repo.split('/')[1]} Docs`
  } else if (contentChoice.content === 'readme') {
    docsPath = '.'
    displayName = `${parsed.repo.split('/')[1]} README`
  } else if (contentChoice.content === 'skills') {
    // Embed skills from the detected skills directory
    const output = await promptForOutputFile()
    await runSkillsEmbed({ repo: parsed.repo, output })
    process.exit(0)
  } else {
    // Custom path
    const pathResponse = await prompts(
      {
        type: 'text',
        name: 'path',
        message: 'Path in repository',
        initial: 'docs',
      },
      { onCancel }
    )
    docsPath = pathResponse.path
  }

  const nameResponse = await prompts(
    {
      type: 'text',
      name: 'name',
      message: 'Display name',
      initial: displayName,
    },
    { onCancel }
  )

  const versionResponse = await prompts(
    {
      type: 'text',
      name: 'version',
      message: 'Version/tag (or branch name for latest)',
      initial: repoContent.defaultBranch,
    },
    { onCancel }
  )

  const output = await promptForOutputFile()
  const description = await promptForDescription()

  const provider = createProvider({
    name: nameResponse.name.toLowerCase().replace(/\s+/g, '-'),
    displayName: nameResponse.name,
    repo: parsed.repo,
    docsPath,
  })

  return { provider, version: versionResponse.version, output, description }
}

// Local docs command - embed docs from a local directory
interface LocalCommandOptions {
  name?: string
  output?: string
  extensions?: string
}

async function runLocal(docsPath: string, options: LocalCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const absoluteDocsPath = path.isAbsolute(docsPath) ? docsPath : path.join(cwd, docsPath)

  if (!fs.existsSync(absoluteDocsPath)) {
    console.error(pc.red(`Documentation directory not found: ${docsPath}`))
    process.exit(1)
  }

  const name = options.name || path.basename(docsPath)
  const output = options.output || getDefaultOutput()
  const extensions = options.extensions?.split(',') || ['.md', '.mdx']

  console.log(`\nBuilding index from ${pc.cyan(docsPath)}...`)

  const targetPath = path.join(cwd, output)
  let existingContent = ''
  let sizeBefore = 0
  let isNewFile = true

  if (fs.existsSync(targetPath)) {
    existingContent = fs.readFileSync(targetPath, 'utf-8')
    sizeBefore = Buffer.byteLength(existingContent, 'utf-8')
    isNewFile = false
  }

  const docFiles = collectDocFiles(absoluteDocsPath, { extensions })
  const sections = buildDocTree(docFiles)

  const indexContent = generateIndex({
    docsPath: docsPath.startsWith('./') ? docsPath : `./${docsPath}`,
    sections,
    outputFile: output,
    providerName: name,
    instruction: `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${name} tasks.`,
    regenerateCommand: `npx agdex local ${docsPath} --name "${name}" --output ${output}`,
  })

  // Use a sanitized name for the marker (lowercase, no spaces)
  const providerName = name.toLowerCase().replace(/\s+/g, '-')
  const newContent = injectIndex(existingContent, indexContent, providerName)
  fs.writeFileSync(targetPath, newContent, 'utf-8')

  const sizeAfter = Buffer.byteLength(newContent, 'utf-8')

  upsertIndexLockEntry(cwd, {
    id: createIndexId('docs', providerName, output),
    kind: 'docs',
    source: {
      type: 'local-docs',
      name: providerName,
      displayName: name,
      docsPath,
      versionMode: 'unknown',
    },
    targetFile: output,
    marker: providerName,
    cachePath: absoluteDocsPath,
    command: `npx agdex local ${docsPath} --name "${name}" --output ${output}`,
  })

  const action = isNewFile ? 'Created' : 'Updated'
  const sizeInfo = isNewFile
    ? formatSize(sizeAfter)
    : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(output)} (${sizeInfo})`)
  console.log('')
}

// URL docs command - scrape docs from a website URL
interface UrlCommandOptions {
  name?: string
  output?: string
  selector?: string
  concurrency?: string
  delay?: string
  global?: boolean
  local?: boolean
}

async function runUrl(url: string, options: UrlCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const { pullDocsFromUrl } = await import('../lib/url-scraper')

  const name = options.name || new URL(url).hostname.replace(/^docs\./, '').replace(/\.\w+$/, '')
  const providerName = name.toLowerCase().replace(/\s+/g, '-')
  const output = options.output || getDefaultOutput()
  const globalCache = resolveGlobalCacheOption(options)

  // Determine cache directory
  const docsDir = globalCache
    ? path.join(os.homedir(), '.cache', 'agdex', providerName)
    : path.join('.agdex', providerName)
  const docsPath = path.isAbsolute(docsDir) ? docsDir : path.join(cwd, docsDir)
  const docsLinkPath = globalCache ? docsPath : `./${docsDir}`

  console.log(`\nScraping documentation from ${pc.cyan(url)}...`)

  // Check if cached
  const cacheHit = fs.existsSync(docsPath) && fs.readdirSync(docsPath).length > 0

  if (cacheHit) {
    console.log(`${pc.green('✓')} Using cached docs from ${pc.bold(docsPath)}`)
  } else {
    const urlConfig = {
      baseUrl: url,
      contentSelector: options.selector || 'main#main-content, main, article, .body',
      removeSelectors: [] as string[],
      concurrency: options.concurrency ? parseInt(options.concurrency, 10) : 5,
      fetchDelay: options.delay ? parseInt(options.delay, 10) : 200,
    }

    const pullResult = await pullDocsFromUrl(urlConfig, docsPath, {
      onProgress: (current, total, page) => {
        process.stdout.write(`\r  Fetching pages... ${current}/${total} (${page})`)
      },
    })

    if (!pullResult.success) {
      console.error(pc.red(`\nFailed: ${pullResult.error}`))
      process.exit(1)
    }

    console.log(`\n${pc.green('✓')} Downloaded docs to ${pc.bold(docsPath)}`)
  }

  // Build index from the downloaded markdown files
  const targetPath = path.join(cwd, output)
  let existingContent = ''
  let sizeBefore = 0
  let isNewFile = true

  if (fs.existsSync(targetPath)) {
    existingContent = fs.readFileSync(targetPath, 'utf-8')
    sizeBefore = Buffer.byteLength(existingContent, 'utf-8')
    isNewFile = false
  }

  const docFiles = collectDocFiles(docsPath, { extensions: ['.md'] })
  const sections = buildDocTree(docFiles)

  const indexContent = generateIndex({
    docsPath: docsLinkPath,
    sections,
    outputFile: output,
    providerName: name,
    instruction: `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${name} tasks.`,
    regenerateCommand: `npx agdex url "${url}" --name "${name}" --output ${output}${globalCache ? ' --global' : ''}`,
  })

  const newContent = injectIndex(existingContent, indexContent, providerName)
  fs.writeFileSync(targetPath, newContent, 'utf-8')

  const sizeAfter = Buffer.byteLength(newContent, 'utf-8')

  upsertIndexLockEntry(cwd, {
    id: createIndexId('docs', providerName, output),
    kind: 'docs',
    source: {
      type: 'url-docs',
      name: providerName,
      displayName: name,
      url,
      version: 'latest',
      versionMode: 'default-branch',
    },
    targetFile: output,
    marker: providerName,
    cachePath: docsPath,
    command: `npx agdex url "${url}" --name "${name}" --output ${output}${globalCache ? ' --global' : ''}`,
  })

  const action = isNewFile ? 'Created' : 'Updated'
  const sizeInfo = isNewFile
    ? formatSize(sizeAfter)
    : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(output)} (${sizeInfo})`)
  if (!globalCache) {
    const gitignoreResult = ensureGitignoreEntry(cwd, '.agdex')
    if (gitignoreResult.updated) {
      console.log(`${pc.green('✓')} Added ${pc.bold('.agdex')} to .gitignore`)
    }
  }
  console.log('')
}

// List providers command
function runList(): void {
  console.log(pc.cyan('\n📚 Built-in Documentation Providers\n'))

  for (const preset of listProviders()) {
    const provider = getProvider(preset)
    const status = provider ? pc.green('✓') : pc.gray('○')
    const name = provider?.displayName || preset
    const source = provider?.urlConfig
      ? provider.urlConfig.baseUrl
      : provider?.repo || 'not implemented'

    console.log(`  ${status} ${pc.bold(preset)} - ${name} (${pc.gray(source)})`)
  }

  console.log('')
  console.log(pc.cyan('📦 Usage Examples\n'))
  console.log(pc.gray('  Built-in provider:'))
  console.log(`    ${pc.white('agdex --provider nextjs')}`)
  console.log('')
  console.log(pc.gray('  Any GitHub repository:'))
  console.log(`    ${pc.white('agdex --repo owner/repo --docs-path docs')}`)
  console.log('')
  console.log(pc.gray('  GitHub URL with path:'))
  console.log(`    ${pc.white('agdex')} ${pc.gray('(interactive)')}`)
  console.log(`    ${pc.gray('→ then enter:')} ${pc.white('https://github.com/anthropics/skills/tree/main/skills')}`)
  console.log('')
  console.log(pc.gray('  Website URL:'))
  console.log(`    ${pc.white('agdex url https://docs.example.com/latest/index.html --name "My Docs"')}`)
  console.log('')
  console.log(pc.gray('  Local documentation:'))
  console.log(`    ${pc.white('agdex local ./my-docs --name "My Docs"')}`)
  console.log('')
  console.log(pc.gray('  Skills indexing:'))
  console.log(`    ${pc.white('agdex skills embed')}`)
  console.log(`    ${pc.white('agdex skills embed --repo vercel-labs/agent-skills')}`)
  console.log(`    ${pc.white('agdex skills find react')}`)
  console.log('')
}

// Setup CLI commands
program
  .name('agdex')
  .description(`Create compressed documentation indexes for AI coding agents.

Sources you can index:
  • Built-in providers (Next.js, React, Bun, Pixi, Tauri, TensorRT, etc.)
  • Any GitHub repository URL or owner/repo
  • Any documentation website URL
  • Local documentation directories
  • Claude Code skills

Run 'agdex' without arguments for interactive mode.`)
  .version('0.4.2')

program
  .command('embed', { isDefault: true })
  .description('Embed documentation index into AGENTS.md/CLAUDE.md')
  .option('-p, --provider <name>', 'Documentation provider (nextjs, react, etc.)')
  .option('--fw-version <version>', 'Framework version (auto-detected if not provided)')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('--repo <owner/repo>', 'Custom GitHub repository')
  .option('--docs-path <path>', 'Path to docs folder in repository')
  .option('-g, --global', 'Store docs in global cache (~/.cache/agdex/) instead of local .agdex/')
  .option('-l, --local', 'Store docs in local .agdex/ (default)')
  .option('-d, --description <text>', 'Additional description to include in the index')
  .option('-u, --url <url>', 'Scrape documentation from a website URL')
  .action(runEmbed)

program
  .command('local <docs-path>')
  .description('Build index from local documentation directory')
  .option('-n, --name <name>', 'Display name for the documentation')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('-e, --extensions <exts>', 'File extensions to include (comma-separated, default: .md,.mdx)')
  .action(runLocal)

program
  .command('url <url>')
  .description('Scrape documentation from a website URL and build index')
  .option('-n, --name <name>', 'Display name for the documentation (default: derived from URL)')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('-s, --selector <css>', 'CSS selector for main content (default: main#main-content, main, article)')
  .option('-c, --concurrency <n>', 'Max concurrent fetches (default: 5)')
  .option('--delay <ms>', 'Delay between fetch batches in ms (default: 200)')
  .option('-g, --global', 'Store docs in global cache (~/.cache/agdex/) instead of local .agdex/')
  .option('-l, --local', 'Store docs in local .agdex/ (default)')
  .action(runUrl)

program.command('list').description('List available documentation providers').action(runList)

interface StatusCommandOptions {
  output?: string
  json?: boolean
  check?: boolean
}

function runStatus(options: StatusCommandOptions): void {
  const report = createStatusReport({
    cwd: process.cwd(),
    targetFile: options.output,
  })
  const unhealthy = report.indexes.filter((index) => index.health !== 'ok')

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printStatusReport(report.indexes, report.scannedFiles)
  }

  if (options.check && unhealthy.length > 0) {
    process.exit(1)
  }
}

function printStatusReport(indexes: IndexStatus[], scannedFiles: string[]): void {
  console.log(pc.cyan('\nagdex status\n'))
  console.log(pc.gray(`  Scanned: ${scannedFiles.length > 0 ? scannedFiles.join(', ') : 'no agent instruction files found'}`))

  if (indexes.length === 0) {
    console.log(pc.yellow('\n  No indexes found.\n'))
    return
  }

  console.log('')
  for (const index of indexes) {
    const symbol = index.health === 'ok' ? pc.green('✓') : pc.yellow('!')
    const source = index.source?.displayName || index.source?.name || index.marker
    console.log(`  ${symbol} ${pc.bold(index.kind)} ${source} ${pc.gray(`(${index.targetFile})`)}`)
    console.log(`    health: ${formatHealth(index.health)}`)
    if (index.cachePath) {
      console.log(`    cache: ${index.cachePath}`)
    }
    if (index.health !== 'ok') {
      console.log(`    action: ${index.suggestedAction}`)
    }
  }
  console.log('')
}

function formatHealth(health: string): string {
  if (health === 'ok') return pc.green(health)
  return pc.yellow(health)
}

program
  .command('status')
  .description('Inspect lockfile-backed index health')
  .option('-o, --output <file>', 'Scope status to one agent instruction file')
  .option('--json', 'Print machine-readable JSON')
  .option('--check', 'Exit non-zero when any discovered index is unhealthy')
  .action(runStatus)

interface RefreshCommandOptions {
  output?: string
  provider?: string
  kind?: 'docs' | 'skills'
  force?: boolean
  repair?: boolean
}

async function runRefresh(options: RefreshCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const lockfile = readIndexLockfile(cwd)
  const repairIds = options.repair
    ? new Set(
        createStatusReport({ cwd, targetFile: options.output }).indexes
          .filter((index) => index.lockfileEntry && index.health !== 'ok')
          .map((index) => index.id)
      )
    : null

  const entries = lockfile.indexes.filter((entry) => {
    if (options.output && entry.targetFile !== options.output) return false
    if (options.kind && entry.kind !== options.kind) return false
    if (options.provider && entry.source.name !== options.provider && entry.marker !== options.provider) return false
    if (repairIds && !repairIds.has(entry.id)) return false
    return true
  })

  if (entries.length === 0) {
    console.log(pc.yellow('\nNo lockfile-backed indexes matched refresh filters.\n'))
    return
  }

  for (const entry of entries) {
    if (options.force && entry.kind === 'docs') {
      const cachePath = path.isAbsolute(entry.cachePath) ? entry.cachePath : path.join(cwd, entry.cachePath)
      if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true })
      }
    }

    if (entry.kind === 'skills') {
      if (entry.source.type === 'skills-sh' && entry.source.repo) {
        await runSkillsEmbed({ repo: entry.source.repo, output: entry.targetFile })
      } else {
        await runSkillsEmbed({ output: entry.targetFile })
      }
      continue
    }

    if (entry.source.type === 'local-docs' && entry.source.docsPath) {
      await runLocal(entry.source.docsPath, {
        name: entry.source.displayName || entry.source.name,
        output: entry.targetFile,
      })
      continue
    }

    if (entry.source.type === 'url-docs' && entry.source.url) {
      await runUrl(entry.source.url, {
        name: entry.source.displayName || entry.source.name,
        output: entry.targetFile,
        global: path.isAbsolute(entry.cachePath),
      })
      continue
    }

    const provider =
      entry.source.type === 'builtin-provider'
        ? getProvider(entry.source.name as ProviderPreset)
        : entry.source.repo && entry.source.docsPath
          ? createProvider({
              name: entry.source.name,
              displayName: entry.source.displayName || entry.source.name,
              repo: entry.source.repo,
              docsPath: entry.source.docsPath,
            })
          : null

    if (!provider) {
      console.log(pc.yellow(`Skipped ${entry.id}: source metadata is incomplete.`))
      continue
    }

    const version = entry.source.versionMode === 'pinned' ? entry.source.version : undefined
    await executeEmbed(cwd, provider, version, entry.targetFile, path.isAbsolute(entry.cachePath), undefined, entry.source.versionMode)
  }
}

program
  .command('refresh')
  .description('Refresh lockfile-backed indexes')
  .option('-o, --output <file>', 'Refresh indexes in one agent instruction file')
  .option('-p, --provider <name>', 'Refresh one provider or marker name')
  .option('--kind <kind>', 'Refresh only docs or skills indexes')
  .option('--force', 'Delete existing documentation caches before refreshing')
  .option('--repair', 'Refresh only unhealthy lockfile-backed indexes')
  .action(runRefresh)

interface MigrateCommandOptions {
  output?: string
  json?: boolean
}

function runMigrate(options: MigrateCommandOptions): void {
  const cwd = process.cwd()
  const targets = options.output ? [options.output] : ['AGENTS.md', 'AGENTS.local.md', 'CLAUDE.md', 'CLAUDE.local.md']
  const migrated: string[] = []
  const skipped: Array<{ targetFile: string; marker: string; reason: string }> = []

  for (const targetFile of targets) {
    const targetPath = path.join(cwd, targetFile)
    if (!fs.existsSync(targetPath)) continue

    const content = fs.readFileSync(targetPath, 'utf-8')
    const regex = /<!-- AGENTS-MD-EMBED-START:(\S+?) -->\n([\s\S]*?)\n<!-- AGENTS-MD-EMBED-END:\1 -->/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(content)) !== null) {
      const marker = match[1]
      const block = match[2]
      const rootMatch = block.match(/(?:^|\|)root:\s*([^|]+)/)
      if (!rootMatch) {
        skipped.push({ targetFile, marker, reason: 'missing root metadata' })
        continue
      }

      const cachePath = rootMatch[1].trim().replace(/^\.\//, '')
      const provider = getProvider(marker as ProviderPreset)
      const source = provider
        ? {
            type: 'builtin-provider' as const,
            name: provider.name,
            displayName: provider.displayName,
            repo: provider.repo,
            docsPath: provider.docsPath,
            versionMode: 'unknown' as const,
          }
        : {
            type: 'local-docs' as const,
            name: marker,
            displayName: marker,
            docsPath: cachePath,
            versionMode: 'unknown' as const,
          }

      const entry = upsertIndexLockEntry(cwd, {
        id: createIndexId('docs', marker, targetFile),
        kind: 'docs',
        source,
        targetFile,
        marker,
        cachePath,
        command: `npx agdex --provider ${marker} --output ${targetFile}`,
      })
      migrated.push(entry.id)
    }
  }

  const result = { migrated, skipped }
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(pc.cyan('\nagdex migrate\n'))
  for (const id of migrated) {
    console.log(`${pc.green('✓')} Created lockfile entry ${pc.bold(id)}`)
  }
  for (const item of skipped) {
    console.log(`${pc.yellow('!')} Skipped ${item.marker} in ${item.targetFile}: ${item.reason}`)
  }
  if (migrated.length === 0 && skipped.length === 0) {
    console.log(pc.yellow('  No migratable indexes found.'))
  }
  console.log('')
}

program
  .command('migrate')
  .description('Create lockfile entries from existing embedded markers when safe')
  .option('-o, --output <file>', 'Migrate one agent instruction file')
  .option('--json', 'Print machine-readable JSON')
  .action(runMigrate)

// Remove command
interface RemoveCommandOptions {
  output?: string
  docs?: boolean
  skills?: boolean
  provider?: string
}

async function runRemove(options: RemoveCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const output = options.output || getDefaultOutput()
  const targetPath = path.join(cwd, output)

  if (!fs.existsSync(targetPath)) {
    console.error(pc.red(`File not found: ${output}`))
    process.exit(1)
  }

  let content = fs.readFileSync(targetPath, 'utf-8')
  const sizeBefore = Buffer.byteLength(content, 'utf-8')

  const hasExplicitFlags = options.docs || options.skills || options.provider

  if (!hasExplicitFlags) {
    // Interactive mode: show checklist of active indices
    const embeddedProviders = getEmbeddedProviders(content)
    const hasSkills = hasExistingSkillsIndex(content)

    if (embeddedProviders.length === 0 && !hasSkills) {
      console.log(pc.yellow('\nNo indices found to remove.\n'))
      return
    }

    const choices: { title: string; value: string }[] = []
    for (const provider of embeddedProviders) {
      choices.push({ title: `docs: ${provider}`, value: `docs:${provider}` })
    }
    if (hasSkills) {
      choices.push({ title: 'skills', value: 'skills' })
    }

    const response = await prompts({
      type: 'multiselect',
      name: 'indices',
      message: 'Select indices to remove',
      choices,
      instructions: false,
      hint: '- Space to select, Return to confirm',
    })

    if (!response.indices || response.indices.length === 0) {
      console.log(pc.yellow('\nNo indices selected.\n'))
      return
    }

    const selected: string[] = response.indices
    let docsRemoved: string[] = []
    let skillsRemoved = false

    for (const item of selected) {
      if (item === 'skills') {
        content = removeSkillsIndex(content)
        skillsRemoved = true
      } else if (item.startsWith('docs:')) {
        const provider = item.slice(5)
        content = removeDocsIndex(content, provider)
        docsRemoved.push(provider)
      }
    }

    fs.writeFileSync(targetPath, content, 'utf-8')
    const sizeAfter = Buffer.byteLength(content, 'utf-8')

    console.log('')
    for (const provider of docsRemoved) {
      console.log(`${pc.green('✓')} Removed docs index (${provider}) from ${pc.bold(output)}`)
    }
    if (skillsRemoved) {
      console.log(`${pc.green('✓')} Removed skills index from ${pc.bold(output)}`)
    }
    console.log(pc.gray(`  (${formatSize(sizeBefore)} → ${formatSize(sizeAfter)})`))
    console.log('')
    return
  }

  // Non-interactive mode: use explicit flags
  const removeAll = !options.docs && !options.skills
  const removeDocs = removeAll || options.docs
  const removeSkillsIdx = removeAll || options.skills

  let docsRemoved = false
  let skillsRemoved = false

  if (removeDocs && hasExistingIndex(content, options.provider)) {
    content = removeDocsIndex(content, options.provider)
    docsRemoved = true
  }

  if (removeSkillsIdx && hasExistingSkillsIndex(content)) {
    content = removeSkillsIndex(content)
    skillsRemoved = true
  }

  if (!docsRemoved && !skillsRemoved) {
    console.log(pc.yellow('\nNo indices found to remove.\n'))
    return
  }

  fs.writeFileSync(targetPath, content, 'utf-8')
  const sizeAfter = Buffer.byteLength(content, 'utf-8')

  console.log('')
  if (docsRemoved) {
    const providerInfo = options.provider ? ` (${options.provider})` : ' (all providers)'
    console.log(`${pc.green('✓')} Removed docs index${providerInfo} from ${pc.bold(output)}`)
  }
  if (skillsRemoved) {
    console.log(`${pc.green('✓')} Removed skills index from ${pc.bold(output)}`)
  }
  console.log(pc.gray(`  (${formatSize(sizeBefore)} → ${formatSize(sizeAfter)})`))
  console.log('')
}

program
  .command('remove')
  .description('Remove embedded indices from AGENTS.md/CLAUDE.md')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('--docs', 'Remove only docs index')
  .option('--skills', 'Remove only skills index')
  .option('-p, --provider <name>', 'Remove only a specific provider\'s docs index')
  .action(runRemove)

// Skills subcommands
const skillsCommand = program
  .command('skills')
  .description('Manage Claude Code skills indexing')

interface SkillsEmbedCommandOptions {
  output?: string
  plugin?: string[]
  user?: boolean
  project?: boolean
  plugins?: boolean
  repo?: string
}

async function runSkillsEmbed(options: SkillsEmbedCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const output = options.output || getDefaultOutput()

  // Build source configuration
  const sources = getDefaultSkillSources(cwd, {
    includeUser: options.user !== false,
    includeProject: options.project !== false,
    includeEnabledPlugins: options.plugins !== false,
    pluginPaths: options.plugin || [],
  })

  // Handle --repo flag: clone remote repo and discover skills
  if (options.repo) {
    const { execSync } = await import('child_process')
    const repoName = options.repo

    console.log(`\nFetching skills from ${pc.cyan(repoName)}...`)

    // Use global cache
    const cacheDir = path.join(os.homedir(), '.cache', 'agdex', 'skills-sh', repoName.replace('/', path.sep))
    const cacheHit = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0

    if (!cacheHit) {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-skills-'))
      try {
        execSync(
          `git clone --depth 1 --filter=blob:none https://github.com/${repoName}.git .`,
          { cwd: tempDir, stdio: 'pipe' }
        )

        fs.mkdirSync(cacheDir, { recursive: true })
        fs.cpSync(tempDir, cacheDir, { recursive: true })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(pc.red(`Failed to clone ${repoName}: ${msg}`))
        process.exit(1)
      } finally {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true })
        }
      }
      console.log(`${pc.green('✓')} Cloned ${pc.bold(repoName)}`)
    } else {
      console.log(`${pc.green('✓')} Using cached ${pc.bold(repoName)}`)
    }

    const remoteSkills = discoverSkillsShRepo(cacheDir, repoName)

    if (remoteSkills.length === 0) {
      console.error(pc.red(`No skills found in ${repoName}`))
      process.exit(1)
    }

    console.log(`${pc.green('✓')} Found ${pc.bold(remoteSkills.length.toString())} skills`)

    const localSkills = collectAllSkills(sources)
    const allSkills = [...remoteSkills, ...localSkills]

    const targetPath = path.join(cwd, output)
    let existingContent = ''
    let sizeBefore = 0
    let isNewFile = true

    if (fs.existsSync(targetPath)) {
      existingContent = fs.readFileSync(targetPath, 'utf-8')
      sizeBefore = Buffer.byteLength(existingContent, 'utf-8')
      isNewFile = false
    }

    const indexContent = generateSkillsIndex(allSkills, {
      regenerateCommand: `npx agdex skills embed --repo ${repoName}`,
    })

    const newContent = injectSkillsIndex(existingContent, indexContent)
    fs.writeFileSync(targetPath, newContent, 'utf-8')

    const sizeAfter = Buffer.byteLength(newContent, 'utf-8')

    upsertIndexLockEntry(cwd, {
      id: createIndexId('skills', `skills-sh:${repoName}`, output),
      kind: 'skills',
      source: {
        type: 'skills-sh',
        name: `skills-sh:${repoName}`,
        displayName: repoName,
        repo: repoName,
        versionMode: 'default-branch',
      },
      targetFile: output,
      marker: 'skills',
      cachePath: cacheDir,
      command: `npx agdex skills embed --repo ${repoName}`,
    })

    const action = isNewFile ? 'Created' : 'Updated'
    const sizeInfo = isNewFile
      ? formatSize(sizeAfter)
      : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

    console.log(`${pc.green('✓')} ${action} ${pc.bold(output)} (${sizeInfo})`)
    console.log(`${pc.green('✓')} Indexed ${pc.bold(allSkills.length.toString())} skills`)
    console.log('')
    return
  }

  if (sources.length === 0) {
    console.error(pc.red('No skill sources configured. Use --plugin, --user, --project, or --plugins flags.'))
    process.exit(1)
  }

  console.log(`\nDiscovering skills from ${pc.cyan(sources.length.toString())} sources...`)

  const result = await embedSkills({ cwd, sources, output })

  if (!result.success) {
    console.error(pc.red(`Failed: ${result.error}`))
    process.exit(1)
  }

  const action = result.isNewFile ? 'Created' : 'Updated'
  const sizeInfo = result.isNewFile
    ? formatSize(result.sizeAfter!)
    : `${formatSize(result.sizeBefore!)} → ${formatSize(result.sizeAfter!)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(result.targetFile!)} (${sizeInfo})`)
  console.log(`${pc.green('✓')} Indexed ${pc.bold(result.skillCount!.toString())} skills`)

  upsertIndexLockEntry(cwd, {
    id: createIndexId('skills', 'local-skills', output),
    kind: 'skills',
    source: {
      type: 'skills-local',
      name: 'local-skills',
      displayName: 'Local skills',
      versionMode: 'unknown',
    },
    targetFile: output,
    marker: 'skills',
    cachePath: cwd,
    command: 'npx agdex skills embed',
  })

  // Show breakdown by source
  if (result.sourceBreakdown) {
    const breakdown: string[] = []
    if (result.sourceBreakdown.plugin > 0) {
      breakdown.push(`${result.sourceBreakdown.plugin} plugin`)
    }
    if (result.sourceBreakdown.user > 0) {
      breakdown.push(`${result.sourceBreakdown.user} user`)
    }
    if (result.sourceBreakdown.project > 0) {
      breakdown.push(`${result.sourceBreakdown.project} project`)
    }
    console.log(pc.gray(`  (${breakdown.join(', ')})`))
  }

  console.log('')
}

interface SkillsListCommandOptions {
  plugin?: string[]
  user?: boolean
  project?: boolean
  plugins?: boolean
}

function runSkillsList(options: SkillsListCommandOptions): void {
  const cwd = process.cwd()

  // Build source configuration
  const sources = getDefaultSkillSources(cwd, {
    includeUser: options.user !== false,
    includeProject: options.project !== false,
    includeEnabledPlugins: options.plugins !== false,
    pluginPaths: options.plugin || [],
  })

  const skills = collectAllSkills(sources)

  if (skills.length === 0) {
    console.log(pc.yellow('\nNo skills found in any of the specified sources.\n'))
    return
  }

  console.log(pc.cyan(`\nDiscovered ${skills.length} skills:\n`))

  // Group by source
  const grouped = new Map<string, typeof skills>()
  for (const skill of skills) {
    const key = skill.source === 'plugin' && skill.pluginName
      ? `plugin:${skill.pluginName}`
      : skill.source
    const existing = grouped.get(key) || []
    existing.push(skill)
    grouped.set(key, existing)
  }

  for (const [source, sourceSkills] of grouped) {
    console.log(pc.bold(`  ${source}:`))
    for (const skill of sourceSkills) {
      console.log(`    ${pc.green('•')} ${pc.bold(skill.name)} - ${skill.description}`)
      if (skill.siblingFiles.length > 0) {
        console.log(pc.gray(`      Files: ${skill.siblingFiles.join(', ')}`))
      }
    }
    console.log('')
  }
}

interface SkillsLocalCommandOptions {
  output?: string
  name?: string
}

async function runSkillsLocal(skillsPath: string, options: SkillsLocalCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const absolutePath = path.isAbsolute(skillsPath) ? skillsPath : path.join(cwd, skillsPath)

  if (!fs.existsSync(absolutePath)) {
    console.error(pc.red(`Skills directory not found: ${skillsPath}`))
    process.exit(1)
  }

  const output = options.output || getDefaultOutput()
  const label = options.name || path.basename(skillsPath)

  // Determine if this is a plugin structure or flat structure
  const hasPluginsDir = fs.existsSync(path.join(absolutePath, 'plugins'))

  const sources: SkillSourceConfig[] = [{
    type: hasPluginsDir ? 'plugin' : 'project',
    path: absolutePath,
    label,
  }]

  console.log(`\nDiscovering skills from ${pc.cyan(skillsPath)}...`)

  const result = await embedSkills({ cwd, sources, output })

  if (!result.success) {
    console.error(pc.red(`Failed: ${result.error}`))
    process.exit(1)
  }

  const action = result.isNewFile ? 'Created' : 'Updated'
  const sizeInfo = result.isNewFile
    ? formatSize(result.sizeAfter!)
    : `${formatSize(result.sizeBefore!)} → ${formatSize(result.sizeAfter!)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(result.targetFile!)} (${sizeInfo})`)
  console.log(`${pc.green('✓')} Indexed ${pc.bold(result.skillCount!.toString())} skills`)
  console.log('')
}

interface SkillsFindCommandOptions {
  limit?: number
  output?: string
}

async function runSkillsFind(query: string | undefined, options: SkillsFindCommandOptions): Promise<void> {
  const limit = options.limit || 20

  if (query) {
    // Non-interactive mode: display results
    console.log(`\nSearching skills.sh for ${pc.cyan(query)}...`)

    try {
      const results = await fetchSkillsShSearch(query, limit)

      if (results.length === 0) {
        console.log(pc.yellow(`\nNo skills found matching "${query}".\n`))
        return
      }

      console.log(pc.cyan(`\nFound ${results.length} skills:\n`))

      // Find max name length for alignment
      const maxNameLen = Math.max(...results.map(r => r.name.length))

      for (const result of results) {
        const name = pc.bold(result.name.padEnd(maxNameLen))
        const source = pc.gray(result.source)
        const installs = pc.green(`${result.installs.toLocaleString()} installs`)
        console.log(`  ${name}  ${source}  ${installs}`)
      }

      console.log('')
      console.log(pc.gray(`  To embed: agdex skills embed --repo <owner/repo>`))
      console.log('')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(pc.red(`Failed to search skills.sh: ${msg}`))
      process.exit(1)
    }
    return
  }

  // Interactive mode: search + select + embed
  console.log(pc.cyan('\nagdex - Search skills.sh\n'))
  console.log(pc.gray('  Search the skills.sh ecosystem for agent skills.\n'))

  const searchResponse = await prompts(
    {
      type: 'text',
      name: 'query',
      message: 'Search skills',
      validate: (v: string) => v.trim() ? true : 'Please enter a search query',
    },
    { onCancel }
  )

  console.log(`\n${pc.gray('Searching...')}`)

  try {
    const results = await fetchSkillsShSearch(searchResponse.query, limit)

    if (results.length === 0) {
      console.log(pc.yellow(`\nNo skills found matching "${searchResponse.query}".\n`))
      return
    }

    // Build choices
    const choices = results.map(r => ({
      title: `${r.name} ${pc.gray(`(${r.source})`)} ${pc.green(`${r.installs.toLocaleString()}`)}`,
      value: r,
    }))

    const selectResponse = await prompts(
      {
        type: 'select',
        name: 'skill',
        message: 'Select a skill to embed',
        choices,
      },
      { onCancel }
    )

    const selected = selectResponse.skill as (typeof results)[0]
    const repoName = selected.source

    console.log(`\nSelected ${pc.bold(selected.name)} from ${pc.cyan(repoName)}`)

    const output = options.output || await promptForOutputFile()

    // Embed using the repo
    await runSkillsEmbed({ repo: repoName, output })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(pc.red(`Failed to search skills.sh: ${msg}`))
    process.exit(1)
  }
}

skillsCommand
  .command('embed')
  .description('Embed skills index into AGENTS.md')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('--plugin <path...>', 'Additional plugin repo paths (with plugins/ structure)')
  .option('--plugins', 'Include enabled plugins from settings.json (default: true)')
  .option('--no-plugins', 'Exclude enabled plugins from settings.json')
  .option('--user', 'Include ~/.claude/skills (default: true)')
  .option('--no-user', 'Exclude ~/.claude/skills')
  .option('--project', 'Include .claude/skills (default: true)')
  .option('--no-project', 'Exclude .claude/skills')
  .option('--repo <owner/repo>', 'Fetch and index skills from a skills.sh-compatible GitHub repository')
  .action(runSkillsEmbed)

skillsCommand
  .command('list')
  .description('List discovered skills')
  .option('--plugin <path...>', 'Additional plugin repo paths (with plugins/ structure)')
  .option('--plugins', 'Include enabled plugins from settings.json (default: true)')
  .option('--no-plugins', 'Exclude enabled plugins from settings.json')
  .option('--user', 'Include ~/.claude/skills (default: true)')
  .option('--no-user', 'Exclude ~/.claude/skills')
  .option('--project', 'Include .claude/skills (default: true)')
  .option('--no-project', 'Exclude .claude/skills')
  .action(runSkillsList)

skillsCommand
  .command('local <skills-path>')
  .description('Index skills from a local path')
  .option('-o, --output <file>', 'Target file (default: from config or CLAUDE.local.md)')
  .option('-n, --name <name>', 'Label for this skill source')
  .action(runSkillsLocal)

skillsCommand
  .command('find [query]')
  .description('Search skills.sh for agent skills')
  .option('-l, --limit <n>', 'Max results (default: 20)', parseInt)
  .option('-o, --output <file>', 'Target file for embedding')
  .action(runSkillsFind)

program.parse()
