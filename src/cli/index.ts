#!/usr/bin/env node
/**
 * CLI for agentsmd-embed
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
      await executeEmbed(cwd, provider, version, output, options.global)
      return
    }
  } else {
    // Interactive mode
    const result = await promptForOptions(cwd)
    provider = result.provider
    version = result.version
    output = result.output
    await executeEmbed(cwd, provider, version, output, options.global)
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

  await executeEmbed(cwd, provider, version, output, options.global)
}

async function executeEmbed(
  cwd: string,
  provider: DocProvider,
  version: string | undefined,
  output: string,
  globalCache?: boolean
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
    ? `~/.cache/agentsmd-embd/${provider.name}`
    : `.agentsmd-embd/${provider.name}`

  console.log(
    `\nDownloading ${pc.cyan(provider.displayName)} ${pc.cyan(resolvedVersion!)} documentation to ${pc.cyan(displayPath)}...`
  )

  const result = await embed({
    cwd,
    provider,
    version: resolvedVersion,
    output,
    globalCache,
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
    console.log(`${pc.green('✓')} Added ${pc.bold('.agentsmd-embd')} to .gitignore`)
  }

  console.log('')
}

function autoDetectProvider(
  cwd: string
): { provider: DocProvider; version: string | null } | null {
  // Try each built-in provider
  const providers: DocProvider[] = [nextjsProvider, pixiProvider, rattlerBuildProvider, tauriProvider]

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

async function promptForOptions(
  cwd: string
): Promise<{ provider: DocProvider; version: string; output: string }> {
  // Try auto-detection first
  const detected = autoDetectProvider(cwd)

  console.log(pc.cyan('\nagentsmd-embed - Documentation Index for AI Coding Agents\n'))

  if (detected) {
    console.log(
      pc.gray(`  Detected ${detected.provider.displayName} version: ${detected.version}\n`)
    )
  }

  const availableProviders = listProviders().filter(isProviderAvailable)

  const response = await prompts(
    [
      {
        type: 'select',
        name: 'provider',
        message: 'Documentation provider',
        choices: [
          ...availableProviders.map((p) => ({
            title: getProvider(p)!.displayName,
            value: p,
          })),
          { title: 'Custom GitHub repo...', value: '__custom__' },
        ],
        initial: detected
          ? availableProviders.indexOf(detected.provider.name as ProviderPreset)
          : 0,
      },
    ],
    { onCancel }
  )

  let provider: DocProvider

  if (response.provider === '__custom__') {
    const customResponse = await prompts(
      [
        {
          type: 'text',
          name: 'repo',
          message: 'GitHub repository (owner/repo)',
          validate: (v: string) => (v.includes('/') ? true : 'Format: owner/repo'),
        },
        {
          type: 'text',
          name: 'docsPath',
          message: 'Path to docs folder',
          initial: 'docs',
        },
        {
          type: 'text',
          name: 'displayName',
          message: 'Display name',
          initial: 'Custom',
        },
      ],
      { onCancel }
    )

    provider = createProvider({
      name: 'custom',
      displayName: customResponse.displayName,
      repo: customResponse.repo,
      docsPath: customResponse.docsPath,
    })
  } else {
    provider = getProvider(response.provider)!
  }

  // Get version
  let initialVersion = ''
  if (provider.detectVersion) {
    const detectedVersion = provider.detectVersion(cwd)
    if (detectedVersion.version) {
      initialVersion = detectedVersion.version
    }
  }

  const versionResponse = await prompts(
    [
      {
        type: 'text',
        name: 'version',
        message: `${provider.displayName} version`,
        initial: initialVersion,
        validate: (v: string) => (v.trim() ? true : 'Please enter a version'),
      },
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
    ],
    { onCancel }
  )

  let output = versionResponse.output
  if (output === '__custom__') {
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
    output = customOutput.file
  }

  return {
    provider,
    version: versionResponse.version,
    output,
  }
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
    regenerateCommand: `npx agentsmd-embed local ${docsPath} --name "${name}" --output ${output}`,
  })

  const newContent = injectIndex(existingContent, indexContent)
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
  console.log(pc.cyan('\nAvailable documentation providers:\n'))

  for (const preset of listProviders()) {
    const provider = getProvider(preset)
    const status = provider ? pc.green('✓') : pc.gray('○')
    const name = provider?.displayName || preset
    const repo = provider?.repo || 'not implemented'

    console.log(`  ${status} ${pc.bold(preset)} - ${name} (${pc.gray(repo)})`)
  }

  console.log('')
  console.log(pc.gray('Use --provider <name> to select a provider'))
  console.log(pc.gray('Use --repo and --docs-path for custom repositories'))
  console.log('')
}

// Setup CLI commands
program
  .name('agentsmd-embed')
  .description('Embed compressed documentation indexes into AGENTS.md/CLAUDE.md for AI coding agents')
  .version('0.1.0')

program
  .command('embed', { isDefault: true })
  .description('Embed documentation index into AGENTS.md/CLAUDE.md')
  .option('-p, --provider <name>', 'Documentation provider (nextjs, react, etc.)')
  .option('--fw-version <version>', 'Framework version (auto-detected if not provided)')
  .option('-o, --output <file>', 'Target file (default: AGENTS.md)')
  .option('--repo <owner/repo>', 'Custom GitHub repository')
  .option('--docs-path <path>', 'Path to docs folder in repository')
  .option('-g, --global', 'Store docs in global cache (~/.cache/agentsmd-embd/) instead of local .agentsmd-embd/')
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

  if (removeDocs && hasExistingIndex(content)) {
    content = removeDocsIndex(content)
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
    console.log(`${pc.green('✓')} Removed docs index from ${pc.bold(output)}`)
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
