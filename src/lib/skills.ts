/**
 * Skills module: Discover and index Claude Code skills from multiple sources.
 *
 * Supports:
 * - Plugin repos (like ccmarket) with plugins/{plugin}/skills/{skill}/SKILL.md structure
 * - User skills from ~/.claude/skills
 * - Project skills from .claude/skills
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import type {
  SkillFrontmatter,
  SkillEntry,
  SkillSource,
  SkillSourceConfig,
  SkillsEmbedOptions,
  SkillsEmbedResult,
  SkillsShSearchResult,
  SkillsShSearchResponse,
} from './types'

const SKILLS_START_MARKER = '<!-- AGENTS-MD-SKILLS-START -->'
const SKILLS_END_MARKER = '<!-- AGENTS-MD-SKILLS-END -->'

const SKILLS_SH_API_BASE = 'https://skills.sh'

/**
 * Search the skills.sh API for skills matching a query.
 * Uses the same endpoint as `npx skills find`.
 */
export async function fetchSkillsShSearch(
  query: string,
  limit: number = 20
): Promise<SkillsShSearchResult[]> {
  const url = `${SKILLS_SH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`skills.sh API returned ${response.status}`)
  }

  const data = (await response.json()) as SkillsShSearchResponse

  return data.skills
}

/**
 * Parse enabled plugins from settings.json
 * Returns array of { skillName, pluginRepo } for each enabled plugin
 */
function parseEnabledPlugins(settingsPath: string): Array<{ skillName: string; pluginRepo: string }> {
  if (!fs.existsSync(settingsPath)) return []

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content)
    const enabledPlugins = settings.enabledPlugins || {}

    const plugins: Array<{ skillName: string; pluginRepo: string }> = []

    for (const [key, enabled] of Object.entries(enabledPlugins)) {
      if (!enabled) continue

      // Parse "skill-name@plugin-repo" format
      const match = key.match(/^(.+)@(.+)$/)
      if (match) {
        plugins.push({
          skillName: match[1],
          pluginRepo: match[2],
        })
      }
    }

    return plugins
  } catch {
    return []
  }
}

/**
 * Find the skills directory for a cached plugin
 * Path structure: ~/.claude/plugins/cache/{pluginRepo}/{skillName}/{hash}/skills
 */
function findPluginSkillsPath(pluginRepo: string, skillName: string): string | null {
  const cacheDir = path.join(os.homedir(), '.claude', 'plugins', 'cache', pluginRepo, skillName)

  if (!fs.existsSync(cacheDir)) return null

  try {
    // Find hash directories (should typically be one)
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true })
    const hashDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))

    if (hashDirs.length === 0) return null

    // Use the first hash directory (or could sort by mtime for most recent)
    const hashDir = hashDirs[0].name
    const skillsPath = path.join(cacheDir, hashDir, 'skills')

    if (fs.existsSync(skillsPath)) {
      return skillsPath
    }

    return null
  } catch {
    return null
  }
}

/**
 * Get all enabled plugins from settings.json files (user and project level)
 */
export function getEnabledPluginSources(cwd: string): SkillSourceConfig[] {
  const sources: SkillSourceConfig[] = []
  const seenPlugins = new Set<string>()

  // Check both user and project settings
  const settingsPaths = [
    path.join(os.homedir(), '.claude', 'settings.json'),  // User level
    path.join(cwd, '.claude', 'settings.json'),           // Project level
  ]

  for (const settingsPath of settingsPaths) {
    const plugins = parseEnabledPlugins(settingsPath)

    for (const { skillName, pluginRepo } of plugins) {
      const key = `${skillName}@${pluginRepo}`
      if (seenPlugins.has(key)) continue
      seenPlugins.add(key)

      const skillsPath = findPluginSkillsPath(pluginRepo, skillName)
      if (skillsPath) {
        sources.push({
          type: 'plugin',
          path: skillsPath,
          label: `${skillName}@${pluginRepo}`,
        })
      }
    }
  }

  return sources
}

/**
 * Parse YAML frontmatter from a SKILL.md file
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null

  const frontmatter = match[1]
  const result: SkillFrontmatter = { name: '', description: '' }

  // Simple YAML parsing for name and description
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

  if (nameMatch) {
    result.name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  if (descMatch) {
    result.description = descMatch[1].trim().replace(/^["']|["']$/g, '')
  }

  // Both name and description are required
  if (!result.name || !result.description) {
    return null
  }

  return result
}

/**
 * Recursively get all files in a directory, returning paths relative to the base directory
 */
function getFilesRecursively(dir: string, baseDir: string): string[] {
  const files: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      // Skip hidden files/directories and SKILL.md
      if (entry.name.startsWith('.') || entry.name === 'SKILL.md') continue

      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(baseDir, fullPath)

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        files.push(...getFilesRecursively(fullPath, baseDir))
      } else {
        files.push(relativePath)
      }
    }
  } catch {
    // Ignore read errors
  }

  return files
}

/**
 * Get sibling files in the same directory as SKILL.md (recursively includes nested directories)
 */
function getSiblingFiles(skillMdPath: string): string[] {
  const dir = path.dirname(skillMdPath)
  if (!fs.existsSync(dir)) return []

  return getFilesRecursively(dir, dir).sort()
}

/**
 * Discover skills from a plugin repository structure.
 * Expected structure: {pluginsPath}/plugins/{pluginName}/skills/{skillName}/SKILL.md
 */
export function discoverPluginSkills(pluginsPath: string, label: string): SkillEntry[] {
  const skills: SkillEntry[] = []
  const pluginsDir = path.join(pluginsPath, 'plugins')

  if (!fs.existsSync(pluginsDir)) {
    return skills
  }

  // Iterate through plugin directories
  const plugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const plugin of plugins) {
    const skillsDir = path.join(pluginsDir, plugin.name, 'skills')
    if (!fs.existsSync(skillsDir)) continue

    // Iterate through skill directories in this plugin
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())

    for (const skillDir of skillDirs) {
      const skillMdPath = path.join(skillsDir, skillDir.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const frontmatter = parseSkillFrontmatter(content)
        if (!frontmatter) continue

        skills.push({
          name: frontmatter.name,
          description: frontmatter.description,
          skillMdPath,
          siblingFiles: getSiblingFiles(skillMdPath),
          source: 'plugin',
          pluginName: plugin.name,
        })
      } catch {
        // Skip skills with read errors
      }
    }
  }

  return skills
}

/**
 * Discover skills from a flat directory structure.
 * Expected structure: {skillsPath}/{skillName}/SKILL.md
 */
export function discoverFlatSkills(
  skillsPath: string,
  source: SkillSource,
  label: string
): SkillEntry[] {
  const skills: SkillEntry[] = []

  if (!fs.existsSync(skillsPath)) {
    return skills
  }

  const skillDirs = fs.readdirSync(skillsPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const skillDir of skillDirs) {
    const skillMdPath = path.join(skillsPath, skillDir.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const frontmatter = parseSkillFrontmatter(content)
      if (!frontmatter) continue

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        skillMdPath,
        siblingFiles: getSiblingFiles(skillMdPath),
        source,
      })
    } catch {
      // Skip skills with read errors
    }
  }

  return skills
}

/**
 * Discover skills from a cloned skills.sh-compatible repository.
 * Searches standard skills.sh locations: root SKILL.md, skills/, .claude/skills/,
 * .agents/skills/, and other known directories.
 */
export function discoverSkillsShRepo(repoDir: string, repoName: string): SkillEntry[] {
  const skills: SkillEntry[] = []
  const seen = new Set<string>()

  // Skills.sh standard discovery locations
  const searchDirs = [
    'skills',
    '.claude/skills',
    '.agents/skills',
    'skills/.curated',
    'skills/.experimental',
  ]

  // Check root SKILL.md
  const rootSkillMd = path.join(repoDir, 'SKILL.md')
  if (fs.existsSync(rootSkillMd)) {
    try {
      const content = fs.readFileSync(rootSkillMd, 'utf-8')
      const frontmatter = parseSkillFrontmatter(content)
      if (frontmatter) {
        seen.add(frontmatter.name)
        skills.push({
          name: frontmatter.name,
          description: frontmatter.description,
          skillMdPath: rootSkillMd,
          siblingFiles: getSiblingFiles(rootSkillMd),
          source: 'skills-sh',
          pluginName: repoName,
        })
      }
    } catch {
      // Skip read errors
    }
  }

  // Search standard directories
  for (const dir of searchDirs) {
    const fullDir = path.join(repoDir, dir)
    if (!fs.existsSync(fullDir)) continue

    const discovered = discoverFlatSkills(fullDir, 'skills-sh', repoName)
    for (const skill of discovered) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name)
        skill.pluginName = repoName
        skills.push(skill)
      }
    }
  }

  return skills
}

/**
 * Collect all skills from multiple sources
 */
export function collectAllSkills(sources: SkillSourceConfig[]): SkillEntry[] {
  const allSkills: SkillEntry[] = []

  for (const source of sources) {
    if (source.type === 'plugin') {
      // Check if this is a plugin cache path (from enabled plugins in settings.json)
      // These have a flat structure: {path}/{skillName}/SKILL.md
      // vs plugin repo structure: {path}/plugins/{pluginName}/skills/{skillName}/SKILL.md
      const isCachePath = source.path.includes('/plugins/cache/')

      if (isCachePath) {
        // Enabled plugins from cache - use flat discovery with plugin source
        const skills = discoverFlatSkills(source.path, 'plugin', source.label)
        // Add the plugin name from the label
        for (const skill of skills) {
          skill.pluginName = source.label
        }
        allSkills.push(...skills)
      } else {
        // Plugin repo structure - use plugin discovery
        allSkills.push(...discoverPluginSkills(source.path, source.label))
      }
    } else {
      allSkills.push(...discoverFlatSkills(source.path, source.type, source.label))
    }
  }

  return allSkills
}

/**
 * Generate a compressed skills index in pipe-delimited format
 * Format: [Skills Index]|plugin:pluginName:{skill1:desc[file1,file2];skill2:desc}|user:{...}|project:{...}|Regen: cmd
 */
export function generateSkillsIndex(
  skills: SkillEntry[],
  options: { regenerateCommand?: string } = {}
): string {
  const parts: string[] = ['[Skills Index]']

  // Group skills by source and plugin
  const pluginSkills = new Map<string, SkillEntry[]>()
  const skillsShSkills = new Map<string, SkillEntry[]>()
  const userSkills: SkillEntry[] = []
  const projectSkills: SkillEntry[] = []

  for (const skill of skills) {
    if (skill.source === 'plugin' && skill.pluginName) {
      const existing = pluginSkills.get(skill.pluginName) || []
      existing.push(skill)
      pluginSkills.set(skill.pluginName, existing)
    } else if (skill.source === 'skills-sh' && skill.pluginName) {
      const existing = skillsShSkills.get(skill.pluginName) || []
      existing.push(skill)
      skillsShSkills.set(skill.pluginName, existing)
    } else if (skill.source === 'user') {
      userSkills.push(skill)
    } else if (skill.source === 'project') {
      projectSkills.push(skill)
    }
  }

  // Format plugin skills
  for (const [pluginName, entries] of pluginSkills) {
    const skillParts = entries.map((s) => formatSkillEntry(s)).join(';')
    parts.push(`plugin:${pluginName}:{${skillParts}}`)
  }

  // Format skills-sh skills
  for (const [repoName, entries] of skillsShSkills) {
    const skillParts = entries.map((s) => formatSkillEntry(s)).join(';')
    parts.push(`skills-sh:${repoName}:{${skillParts}}`)
  }

  // Format user skills
  if (userSkills.length > 0) {
    const skillParts = userSkills.map((s) => formatSkillEntry(s)).join(';')
    parts.push(`user:{${skillParts}}`)
  }

  // Format project skills
  if (projectSkills.length > 0) {
    const skillParts = projectSkills.map((s) => formatSkillEntry(s)).join(';')
    parts.push(`project:{${skillParts}}`)
  }

  // Add regeneration command
  const cmd = options.regenerateCommand || 'npx agdex skills embed'
  parts.push(`Regen: ${cmd}`)

  return parts.join('|')
}

/**
 * Format a single skill entry for the index
 */
function formatSkillEntry(skill: SkillEntry): string {
  // Escape special characters in description
  const desc = skill.description
    .replace(/\|/g, '\\|')
    .replace(/;/g, '\\;')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')

  if (skill.siblingFiles.length > 0) {
    return `${skill.name}:${desc}[${skill.siblingFiles.join(',')}]`
  }
  return `${skill.name}:${desc}`
}

/**
 * Check if content has an existing skills index
 */
export function hasExistingSkillsIndex(content: string): boolean {
  return content.includes(SKILLS_START_MARKER)
}

/**
 * Remove the skills index from content
 * Returns the content with the index removed, or unchanged if no index exists
 */
export function removeSkillsIndex(content: string): string {
  if (!hasExistingSkillsIndex(content)) {
    return content
  }

  const startIdx = content.indexOf(SKILLS_START_MARKER)
  const endIdx = content.indexOf(SKILLS_END_MARKER) + SKILLS_END_MARKER.length

  // Remove the index and clean up extra newlines
  let result = content.slice(0, startIdx) + content.slice(endIdx)

  // Clean up multiple consecutive newlines (more than 2)
  result = result.replace(/\n{3,}/g, '\n\n')

  // Trim trailing whitespace but keep one newline at end if file had content
  result = result.trimEnd()
  if (result.length > 0) {
    result += '\n'
  }

  return result
}

/**
 * Inject skills index into content
 */
export function injectSkillsIndex(existingContent: string, indexContent: string): string {
  const wrappedContent = `${SKILLS_START_MARKER}\n${indexContent}\n${SKILLS_END_MARKER}`

  if (hasExistingSkillsIndex(existingContent)) {
    const startIdx = existingContent.indexOf(SKILLS_START_MARKER)
    const endIdx = existingContent.indexOf(SKILLS_END_MARKER) + SKILLS_END_MARKER.length

    return (
      existingContent.slice(0, startIdx) +
      wrappedContent +
      existingContent.slice(endIdx)
    )
  }

  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n'
  return existingContent + separator + wrappedContent + '\n'
}

/**
 * Get default skill source configurations
 */
export function getDefaultSkillSources(cwd: string, options: {
  includeUser?: boolean
  includeProject?: boolean
  includeEnabledPlugins?: boolean
  pluginPaths?: string[]
} = {}): SkillSourceConfig[] {
  const sources: SkillSourceConfig[] = []
  const {
    includeUser = true,
    includeProject = true,
    includeEnabledPlugins = true,
    pluginPaths = [],
  } = options

  // Add manually specified plugin sources
  for (const pluginPath of pluginPaths) {
    sources.push({
      type: 'plugin',
      path: pluginPath,
      label: path.basename(pluginPath),
    })
  }

  // Add enabled plugins from settings.json
  if (includeEnabledPlugins) {
    const enabledPluginSources = getEnabledPluginSources(cwd)
    sources.push(...enabledPluginSources)
  }

  // Add user skills
  if (includeUser) {
    const userSkillsPath = path.join(os.homedir(), '.claude', 'skills')
    sources.push({
      type: 'user',
      path: userSkillsPath,
      label: 'user',
    })
  }

  // Add project skills
  if (includeProject) {
    const projectSkillsPath = path.join(cwd, '.claude', 'skills')
    sources.push({
      type: 'project',
      path: projectSkillsPath,
      label: 'project',
    })
  }

  return sources
}

/**
 * High-level function to embed skills index into AGENTS.md
 */
export async function embedSkills(options: SkillsEmbedOptions): Promise<SkillsEmbedResult> {
  const { cwd, sources, output = 'AGENTS.md' } = options
  const targetPath = path.join(cwd, output)

  // Track file sizes
  let sizeBefore = 0
  let isNewFile = true
  let existingContent = ''

  if (fs.existsSync(targetPath)) {
    existingContent = fs.readFileSync(targetPath, 'utf-8')
    sizeBefore = Buffer.byteLength(existingContent, 'utf-8')
    isNewFile = false
  }

  // Collect all skills
  const skills = collectAllSkills(sources)

  if (skills.length === 0) {
    return {
      success: false,
      error: 'No skills found in any of the specified sources',
    }
  }

  // Calculate source breakdown
  const sourceBreakdown: Record<SkillSource, number> = {
    plugin: 0,
    user: 0,
    project: 0,
    'skills-sh': 0,
  }
  for (const skill of skills) {
    sourceBreakdown[skill.source]++
  }

  // Generate index
  const indexContent = generateSkillsIndex(skills, {
    regenerateCommand: `npx agdex skills embed`,
  })

  // Inject into target file
  const newContent = injectSkillsIndex(existingContent, indexContent)
  fs.writeFileSync(targetPath, newContent, 'utf-8')

  const sizeAfter = Buffer.byteLength(newContent, 'utf-8')

  return {
    success: true,
    targetFile: output,
    skillCount: skills.length,
    sizeBefore,
    sizeAfter,
    isNewFile,
    sourceBreakdown,
  }
}

// Re-export types
export type {
  SkillFrontmatter,
  SkillEntry,
  SkillSource,
  SkillSourceConfig,
  SkillsEmbedOptions,
  SkillsEmbedResult,
  SkillsShSearchResult,
  SkillsShSearchResponse,
} from './types'
