#!/usr/bin/env node
/**
 * CLI for agdex
 */
import { Command } from 'commander'
import prompts from 'prompts'
import pc from 'picocolors'
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
} from '../lib/agents-md'
import {
  embedSkills,
  collectAllSkills,
  getDefaultSkillSources,
  hasExistingSkillsIndex,
  removeSkillsIndex,
} from '../lib/skills'
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
} from '../lib/providers'
import type { DocProvider, ProviderPreset } from '../lib/types'
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
  description?: string
}

async function runEmbed(options: EmbedCommandOptions): Promise<void> {
  const cwd = process.cwd()

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
      await executeEmbed(cwd, provider, version, output, options.global, result.description)
      return
    }
  } else {
    // Interactive mode
    const result = await promptForOptions(cwd)
    provider = result.provider
    version = result.version
    output = result.output
    await executeEmbed(cwd, provider, version, output, options.global, result.description)
    return
  }

  // Determine output file
  output = options.output || 'AGENTS.md'

  // Version validation
  if (!version && !provider.detectVersion) {
    console.error(
      pc.red(
        `Provider ${provider.displayName} requires --version flag since auto-detection is not supported.`
      )
    )
    process.exit(1)
  }

  await executeEmbed(cwd, provider, version, output, options.global, options.description)
}

async function executeEmbed(
  cwd: string,
  provider: DocProvider,
  version: string | undefined,
  output: string,
  globalCache?: boolean,
  description?: string
): Promise<void> {
  // Detect version if needed
  let resolvedVersion = version
  if (!resolvedVersion && provider.detectVersion) {
    const detected = provider.detectVersion(cwd)
    if (!detected.version) {
      console.error(pc.red(detected.error || `Could not detect ${provider.displayName} version`))
      process.exit(1)
    }
    resolvedVersion = detected.version
  }

  // Determine display path for the message
  const displayPath = globalCache
    ? `~/.cache/agdex/${provider.name}`
    : `.agdex/${provider.name}`

  console.log(
    `\nDownloading ${pc.cyan(provider.displayName)} ${pc.cyan(resolvedVersion!)} documentation to ${pc.cyan(displayPath)}...`
  )

  const result = await embed({
    cwd,
    provider,
    version: resolvedVersion,
    output,
    globalCache,
    description,
  })

  if (!result.success) {
    console.error(pc.red(`Failed: ${result.error}`))
    process.exit(1)
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
  const providers: DocProvider[] = [nextjsProvider, pixiProvider, rattlerBuildProvider, tauriProvider, bunProvider]

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

  // Handle built-in provider selection
  const availableProviders = listProviders().filter(isProviderAvailable)

  const response = await prompts(
    [
      {
        type: 'select',
        name: 'provider',
        message: 'Documentation provider',
        choices: availableProviders.map((p) => ({
          title: getProvider(p)!.displayName,
          value: p,
        })),
        initial: detected
          ? availableProviders.indexOf(detected.provider.name as ProviderPreset)
          : 0,
      },
    ],
    { onCancel }
  )

  const provider = getProvider(response.provider)!

  // Get version
  let initialVersion = ''
  if (provider.detectVersion) {
    const detectedVersion = provider.detectVersion(cwd)
    if (detectedVersion.version) {
      initialVersion = detectedVersion.version
    }
  }

  const versionResponse = await prompts(
    {
      type: 'text',
      name: 'version',
      message: `${provider.displayName} version`,
      initial: initialVersion,
      validate: (v: string) => (v.trim() ? true : 'Please enter a version'),
    },
    { onCancel }
  )

  const output = await promptForOutputFile()
  const description = await promptForDescription()

  return {
    provider,
    version: versionResponse.version,
    output,
    description,
  }
}

async function promptForOutputFile(): Promise<string> {
  const response = await prompts(
    {
      type: 'select',
      name: 'output',
      message: 'Target file',
      choices: [
        { title: 'AGENTS.md', value: 'AGENTS.md' },
        { title: 'CLAUDE.md', value: 'CLAUDE.md' },
        { title: 'Custom...', value: '__custom__' },
      ],
      initial: 0,
    },
    { onCancel }
  )

  if (response.output === '__custom__') {
    const customOutput = await prompts(
      {
        type: 'text',
        name: 'file',
        message: 'Custom file path',
        initial: 'AGENTS.md',
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
    // Handle skills differently - use the skills embed flow
    console.log(pc.yellow('\nSkills indexing from GitHub URLs is coming soon!'))
    console.log(pc.gray('For now, clone the repo and use: agdex skills local <path>\n'))
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
  const output = options.output || 'AGENTS.md'
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

  const action = isNewFile ? 'Created' : 'Updated'
  const sizeInfo = isNewFile
    ? formatSize(sizeAfter)
    : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(output)} (${sizeInfo})`)
  console.log('')
}

// List providers command
function runList(): void {
  console.log(pc.cyan('\n📚 Built-in Documentation Providers\n'))

  for (const preset of listProviders()) {
    const provider = getProvider(preset)
    const status = provider ? pc.green('✓') : pc.gray('○')
    const name = provider?.displayName || preset
    const repo = provider?.repo || 'not implemented'

    console.log(`  ${status} ${pc.bold(preset)} - ${name} (${pc.gray(repo)})`)
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
  console.log(pc.gray('  Local documentation:'))
  console.log(`    ${pc.white('agdex local ./my-docs --name "My Docs"')}`)
  console.log('')
  console.log(pc.gray('  Skills indexing:'))
  console.log(`    ${pc.white('agdex skills embed')}`)
  console.log('')
}

// Setup CLI commands
program
  .name('agdex')
  .description(`Create compressed documentation indexes for AI coding agents.

Sources you can index:
  • Built-in providers (Next.js, React, Bun, Pixi, Tauri, etc.)
  • Any GitHub repository URL or owner/repo
  • Local documentation directories
  • Claude Code skills

Run 'agdex' without arguments for interactive mode.`)
  .version('0.2.0')

program
  .command('embed', { isDefault: true })
  .description('Embed documentation index into AGENTS.md/CLAUDE.md')
  .option('-p, --provider <name>', 'Documentation provider (nextjs, react, etc.)')
  .option('--fw-version <version>', 'Framework version (auto-detected if not provided)')
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
  .option('--repo <owner/repo>', 'Custom GitHub repository')
  .option('--docs-path <path>', 'Path to docs folder in repository')
  .option('-g, --global', 'Store docs in global cache (~/.cache/agdex/) instead of local .agdex/')
  .option('-d, --description <text>', 'Additional description to include in the index')
  .action(runEmbed)

program
  .command('local <docs-path>')
  .description('Build index from local documentation directory')
  .option('-n, --name <name>', 'Display name for the documentation')
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
  .option('-e, --extensions <exts>', 'File extensions to include (comma-separated, default: .md,.mdx)')
  .action(runLocal)

program.command('list').description('List available documentation providers').action(runList)

// Remove command
interface RemoveCommandOptions {
  output?: string
  docs?: boolean
  skills?: boolean
  provider?: string
}

function runRemove(options: RemoveCommandOptions): void {
  const cwd = process.cwd()
  const output = options.output || 'AGENTS.md'
  const targetPath = path.join(cwd, output)

  if (!fs.existsSync(targetPath)) {
    console.error(pc.red(`File not found: ${output}`))
    process.exit(1)
  }

  let content = fs.readFileSync(targetPath, 'utf-8')
  const sizeBefore = Buffer.byteLength(content, 'utf-8')

  // Determine what to remove
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
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
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
}

async function runSkillsEmbed(options: SkillsEmbedCommandOptions): Promise<void> {
  const cwd = process.cwd()
  const output = options.output || 'AGENTS.md'

  // Build source configuration
  const sources = getDefaultSkillSources(cwd, {
    includeUser: options.user !== false,
    includeProject: options.project !== false,
    pluginPaths: options.plugin || [],
  })

  if (sources.length === 0) {
    console.error(pc.red('No skill sources configured. Use --plugin, --user, or --project flags.'))
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
}

function runSkillsList(options: SkillsListCommandOptions): void {
  const cwd = process.cwd()

  // Build source configuration
  const sources = getDefaultSkillSources(cwd, {
    includeUser: options.user !== false,
    includeProject: options.project !== false,
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

  const output = options.output || 'AGENTS.md'
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

skillsCommand
  .command('embed')
  .description('Embed skills index into AGENTS.md')
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
  .option('--plugin <path...>', 'Plugin repo paths (with plugins/ structure)')
  .option('--user', 'Include ~/.claude/skills (default: true)')
  .option('--no-user', 'Exclude ~/.claude/skills')
  .option('--project', 'Include .claude/skills (default: true)')
  .option('--no-project', 'Exclude .claude/skills')
  .action(runSkillsEmbed)

skillsCommand
  .command('list')
  .description('List discovered skills')
  .option('--plugin <path...>', 'Plugin repo paths (with plugins/ structure)')
  .option('--user', 'Include ~/.claude/skills (default: true)')
  .option('--no-user', 'Exclude ~/.claude/skills')
  .option('--project', 'Include .claude/skills (default: true)')
  .option('--no-project', 'Exclude .claude/skills')
  .action(runSkillsList)

skillsCommand
  .command('local <skills-path>')
  .description('Index skills from a local path')
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
  .option('-n, --name <name>', 'Label for this skill source')
  .action(runSkillsLocal)

program.parse()
