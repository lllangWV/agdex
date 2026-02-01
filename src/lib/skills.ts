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
} from './types'

const SKILLS_START_MARKER = '<!-- AGENTS-MD-SKILLS-START -->'
const SKILLS_END_MARKER = '<!-- AGENTS-MD-SKILLS-END -->'

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
 * Get sibling files in the same directory as SKILL.md
 */
function getSiblingFiles(skillMdPath: string): string[] {
  const dir = path.dirname(skillMdPath)
  if (!fs.existsSync(dir)) return []

  try {
    const files = fs.readdirSync(dir)
    return files
      .filter((f) => f !== 'SKILL.md' && !f.startsWith('.'))
      .sort()
  } catch {
    return []
  }
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
 * Collect all skills from multiple sources
 */
export function collectAllSkills(sources: SkillSourceConfig[]): SkillEntry[] {
  const allSkills: SkillEntry[] = []

  for (const source of sources) {
    if (source.type === 'plugin') {
      allSkills.push(...discoverPluginSkills(source.path, source.label))
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
  const userSkills: SkillEntry[] = []
  const projectSkills: SkillEntry[] = []

  for (const skill of skills) {
    if (skill.source === 'plugin' && skill.pluginName) {
      const existing = pluginSkills.get(skill.pluginName) || []
      existing.push(skill)
      pluginSkills.set(skill.pluginName, existing)
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
  const cmd = options.regenerateCommand || 'npx agentsmd-embed skills embed'
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
  pluginPaths?: string[]
} = {}): SkillSourceConfig[] {
  const sources: SkillSourceConfig[] = []
  const {
    includeUser = true,
    includeProject = true,
    pluginPaths = [],
  } = options

  // Add plugin sources
  for (const pluginPath of pluginPaths) {
    sources.push({
      type: 'plugin',
      path: pluginPath,
      label: path.basename(pluginPath),
    })
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
  }
  for (const skill of skills) {
    sourceBreakdown[skill.source]++
  }

  // Generate index
  const indexContent = generateSkillsIndex(skills, {
    regenerateCommand: `npx agentsmd-embed skills embed`,
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
} from './types'
