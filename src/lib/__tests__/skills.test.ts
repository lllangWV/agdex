import { describe, it, expect } from 'bun:test'
import {
  parseSkillFrontmatter,
  discoverFlatSkills,
  discoverPluginSkills,
  discoverSkillsShRepo,
  collectAllSkills,
  generateSkillsIndex,
  injectSkillsIndex,
  hasExistingSkillsIndex,
  removeSkillsIndex,
  getDefaultSkillSources,
  fetchSkillsShSearch,
} from '../skills'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SKILLS_START_MARKER = '<!-- AGENTS-MD-SKILLS-START -->'
const SKILLS_END_MARKER = '<!-- AGENTS-MD-SKILLS-END -->'

describe('skills', () => {
  describe('parseSkillFrontmatter', () => {
    it('parses valid frontmatter with name and description', () => {
      const content = `---
name: my-skill
description: A useful skill
---

# My Skill

Content here.`

      const result = parseSkillFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('my-skill')
      expect(result!.description).toBe('A useful skill')
    })

    it('handles quoted values', () => {
      const content = `---
name: "quoted-skill"
description: 'Single quoted description'
---
# Content`

      const result = parseSkillFrontmatter(content)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('quoted-skill')
      expect(result!.description).toBe('Single quoted description')
    })

    it('returns null for missing name', () => {
      const content = `---
description: Only description
---
# Content`

      const result = parseSkillFrontmatter(content)
      expect(result).toBeNull()
    })

    it('returns null for missing description', () => {
      const content = `---
name: only-name
---
# Content`

      const result = parseSkillFrontmatter(content)
      expect(result).toBeNull()
    })

    it('returns null for no frontmatter', () => {
      const content = `# Just a heading

No frontmatter here.`

      const result = parseSkillFrontmatter(content)
      expect(result).toBeNull()
    })

    it('returns null for empty frontmatter', () => {
      const content = `---
---
# Content`

      const result = parseSkillFrontmatter(content)
      expect(result).toBeNull()
    })
  })

  describe('discoverFlatSkills', () => {
    it('discovers skills from flat directory structure', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'))
      const skillDir = path.join(tempDir, 'test-skill')
      fs.mkdirSync(skillDir)

      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test`
      )
      fs.writeFileSync(path.join(skillDir, 'helper.ts'), 'export const x = 1')

      try {
        const skills = discoverFlatSkills(tempDir, 'project', 'project')

        expect(skills).toHaveLength(1)
        expect(skills[0].name).toBe('test-skill')
        expect(skills[0].description).toBe('A test skill')
        expect(skills[0].source).toBe('project')
        expect(skills[0].siblingFiles).toContain('helper.ts')
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('returns empty array for non-existent directory', () => {
      const skills = discoverFlatSkills('/non/existent/path', 'user', 'user')
      expect(skills).toEqual([])
    })

    it('skips directories without SKILL.md', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'))
      const skillDir = path.join(tempDir, 'not-a-skill')
      fs.mkdirSync(skillDir)
      fs.writeFileSync(path.join(skillDir, 'README.md'), '# Not a skill')

      try {
        const skills = discoverFlatSkills(tempDir, 'project', 'project')
        expect(skills).toHaveLength(0)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('skips skills with invalid frontmatter', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'))
      const skillDir = path.join(tempDir, 'invalid-skill')
      fs.mkdirSync(skillDir)

      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---
name: missing-desc
---
# No description`
      )

      try {
        const skills = discoverFlatSkills(tempDir, 'project', 'project')
        expect(skills).toHaveLength(0)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('discoverPluginSkills', () => {
    it('discovers skills from plugin directory structure', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-test-'))
      const pluginSkillDir = path.join(tempDir, 'plugins', 'my-plugin', 'skills', 'my-skill')
      fs.mkdirSync(pluginSkillDir, { recursive: true })

      fs.writeFileSync(
        path.join(pluginSkillDir, 'SKILL.md'),
        `---
name: plugin-skill
description: A plugin skill
---
# Plugin Skill`
      )

      try {
        const skills = discoverPluginSkills(tempDir, 'my-plugin')

        expect(skills).toHaveLength(1)
        expect(skills[0].name).toBe('plugin-skill')
        expect(skills[0].source).toBe('plugin')
        expect(skills[0].pluginName).toBe('my-plugin')
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('discovers skills from multiple plugins', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-test-'))

      // Plugin A
      const pluginASkillDir = path.join(tempDir, 'plugins', 'plugin-a', 'skills', 'skill-a')
      fs.mkdirSync(pluginASkillDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginASkillDir, 'SKILL.md'),
        `---
name: skill-a
description: Skill from plugin A
---
# A`
      )

      // Plugin B
      const pluginBSkillDir = path.join(tempDir, 'plugins', 'plugin-b', 'skills', 'skill-b')
      fs.mkdirSync(pluginBSkillDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginBSkillDir, 'SKILL.md'),
        `---
name: skill-b
description: Skill from plugin B
---
# B`
      )

      try {
        const skills = discoverPluginSkills(tempDir, 'test')

        expect(skills).toHaveLength(2)
        expect(skills.find((s) => s.pluginName === 'plugin-a')).toBeDefined()
        expect(skills.find((s) => s.pluginName === 'plugin-b')).toBeDefined()
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('returns empty array when plugins directory does not exist', () => {
      const skills = discoverPluginSkills('/non/existent', 'label')
      expect(skills).toEqual([])
    })
  })

  describe('collectAllSkills', () => {
    it('collects skills from multiple sources', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'all-skills-test-'))

      // Create flat skills directory
      const flatDir = path.join(tempDir, 'flat')
      const flatSkillDir = path.join(flatDir, 'flat-skill')
      fs.mkdirSync(flatSkillDir, { recursive: true })
      fs.writeFileSync(
        path.join(flatSkillDir, 'SKILL.md'),
        `---
name: flat-skill
description: A flat skill
---
# Flat`
      )

      // Create plugin skills directory
      const pluginDir = path.join(tempDir, 'repo')
      const pluginSkillDir = path.join(pluginDir, 'plugins', 'test-plugin', 'skills', 'plugin-skill')
      fs.mkdirSync(pluginSkillDir, { recursive: true })
      fs.writeFileSync(
        path.join(pluginSkillDir, 'SKILL.md'),
        `---
name: plugin-skill
description: A plugin skill
---
# Plugin`
      )

      try {
        const skills = collectAllSkills([
          { type: 'project', path: flatDir, label: 'project' },
          { type: 'plugin', path: pluginDir, label: 'plugins' },
        ])

        expect(skills).toHaveLength(2)
        expect(skills.find((s) => s.source === 'project')).toBeDefined()
        expect(skills.find((s) => s.source === 'plugin')).toBeDefined()
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('generateSkillsIndex', () => {
    it('generates compressed pipe-delimited format', () => {
      const skills = [
        {
          name: 'skill1',
          description: 'First skill',
          skillMdPath: '/path/to/SKILL.md',
          siblingFiles: ['helper.ts'],
          source: 'project' as const,
        },
      ]

      const index = generateSkillsIndex(skills)

      expect(index).toContain('[Skills Index]')
      expect(index).toContain('project:{skill1:First skill[helper.ts]}')
      expect(index).toContain('Regen:')
    })

    it('groups plugin skills by plugin name', () => {
      const skills = [
        {
          name: 'skill1',
          description: 'Plugin skill 1',
          skillMdPath: '/path/to/SKILL.md',
          siblingFiles: [],
          source: 'plugin' as const,
          pluginName: 'my-plugin',
        },
        {
          name: 'skill2',
          description: 'Plugin skill 2',
          skillMdPath: '/path/to/SKILL.md',
          siblingFiles: [],
          source: 'plugin' as const,
          pluginName: 'my-plugin',
        },
      ]

      const index = generateSkillsIndex(skills)

      expect(index).toContain('plugin:my-plugin:{skill1:Plugin skill 1;skill2:Plugin skill 2}')
    })

    it('escapes special characters in descriptions', () => {
      const skills = [
        {
          name: 'skill',
          description: 'Has | pipe and ; semicolon',
          skillMdPath: '/path/to/SKILL.md',
          siblingFiles: [],
          source: 'user' as const,
        },
      ]

      const index = generateSkillsIndex(skills)

      expect(index).toContain('\\|')
      expect(index).toContain('\\;')
    })

    it('includes custom regenerate command', () => {
      const skills = [
        {
          name: 'skill',
          description: 'Test',
          skillMdPath: '/path',
          siblingFiles: [],
          source: 'project' as const,
        },
      ]

      const index = generateSkillsIndex(skills, {
        regenerateCommand: 'custom-command --flag',
      })

      expect(index).toContain('Regen: custom-command --flag')
    })
  })

  describe('injectSkillsIndex', () => {
    it('appends to empty file', () => {
      const result = injectSkillsIndex('', 'index content')
      expect(result).toContain(SKILLS_START_MARKER)
      expect(result).toContain('index content')
      expect(result).toContain(SKILLS_END_MARKER)
    })

    it('appends to file without markers', () => {
      const existing = '# My Project\n\nSome content.'
      const result = injectSkillsIndex(existing, 'skills index')

      expect(result).toContain(existing)
      expect(result).toContain(SKILLS_START_MARKER)
      expect(result).toContain('skills index')
      expect(result).toContain(SKILLS_END_MARKER)
    })

    it('replaces content between existing markers', () => {
      const existing = `# Project
${SKILLS_START_MARKER}
old skills
${SKILLS_END_MARKER}
Footer`

      const result = injectSkillsIndex(existing, 'new skills')

      expect(result).toContain('# Project')
      expect(result).toContain('new skills')
      expect(result).toContain('Footer')
      expect(result).not.toContain('old skills')
    })

    it('is idempotent', () => {
      const initial = '# Project\n'
      const first = injectSkillsIndex(initial, 'skills v1')
      const second = injectSkillsIndex(first, 'skills v1')

      expect(second).toBe(first)
    })
  })

  describe('hasExistingSkillsIndex', () => {
    it('returns true when skills markers are present', () => {
      const content = `# Project\n${SKILLS_START_MARKER}\nindex\n${SKILLS_END_MARKER}`
      expect(hasExistingSkillsIndex(content)).toBe(true)
    })

    it('returns false when no markers', () => {
      const content = '# Project\n\nNo skills index.'
      expect(hasExistingSkillsIndex(content)).toBe(false)
    })
  })

  describe('removeSkillsIndex', () => {
    it('removes skills index from content', () => {
      const content = `# Project\n\n${SKILLS_START_MARKER}\nskills content\n${SKILLS_END_MARKER}\n\nFooter`
      const result = removeSkillsIndex(content)

      expect(result).toContain('# Project')
      expect(result).toContain('Footer')
      expect(result).not.toContain(SKILLS_START_MARKER)
      expect(result).not.toContain(SKILLS_END_MARKER)
      expect(result).not.toContain('skills content')
    })

    it('returns unchanged content when no index exists', () => {
      const content = '# Project\n\nNo skills index here.\n'
      const result = removeSkillsIndex(content)
      expect(result).toBe(content)
    })

    it('cleans up extra newlines after removal', () => {
      const content = `# Project\n\n\n${SKILLS_START_MARKER}\nindex\n${SKILLS_END_MARKER}\n\n\nFooter`
      const result = removeSkillsIndex(content)

      // Should not have more than 2 consecutive newlines
      expect(result).not.toMatch(/\n{3,}/)
    })

    it('preserves content before and after index', () => {
      const before = '# Header\n\nIntro.'
      const after = '## Footer\n\nMore.'
      const content = `${before}\n\n${SKILLS_START_MARKER}\nskills\n${SKILLS_END_MARKER}\n\n${after}`

      const result = removeSkillsIndex(content)

      expect(result).toContain('# Header')
      expect(result).toContain('Intro.')
      expect(result).toContain('## Footer')
      expect(result).toContain('More.')
    })

    it('handles file with only skills index', () => {
      const content = `${SKILLS_START_MARKER}\nskills\n${SKILLS_END_MARKER}`
      const result = removeSkillsIndex(content)

      expect(result).toBe('')
    })
  })

  describe('getDefaultSkillSources', () => {
    it('includes user and project sources by default', () => {
      const sources = getDefaultSkillSources('/my/project')

      expect(sources.find((s) => s.type === 'user')).toBeDefined()
      expect(sources.find((s) => s.type === 'project')).toBeDefined()
    })

    it('can exclude user source', () => {
      const sources = getDefaultSkillSources('/my/project', { includeUser: false })

      expect(sources.find((s) => s.type === 'user')).toBeUndefined()
      expect(sources.find((s) => s.type === 'project')).toBeDefined()
    })

    it('can exclude project source', () => {
      const sources = getDefaultSkillSources('/my/project', { includeProject: false })

      expect(sources.find((s) => s.type === 'user')).toBeDefined()
      expect(sources.find((s) => s.type === 'project')).toBeUndefined()
    })

    it('includes plugin paths when provided', () => {
      const sources = getDefaultSkillSources('/my/project', {
        pluginPaths: ['/path/to/plugin1', '/path/to/plugin2'],
        includeEnabledPlugins: false,
      })

      const pluginSources = sources.filter((s) => s.type === 'plugin')
      expect(pluginSources).toHaveLength(2)
    })

    it('sets correct paths for sources', () => {
      const sources = getDefaultSkillSources('/my/project')

      const userSource = sources.find((s) => s.type === 'user')
      const projectSource = sources.find((s) => s.type === 'project')

      expect(userSource!.path).toBe(path.join(os.homedir(), '.claude', 'skills'))
      expect(projectSource!.path).toBe('/my/project/.claude/skills')
    })
  })

  describe('discoverSkillsShRepo', () => {
    it('discovers skills from a local directory with skills.sh structure', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillssh-test-'))
      const skillsDir = path.join(tempDir, 'skills')

      const skill1Dir = path.join(skillsDir, 'skill-one')
      fs.mkdirSync(skill1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
description: First skill
---
# Skill One`
      )

      const skill2Dir = path.join(skillsDir, 'skill-two')
      fs.mkdirSync(skill2Dir, { recursive: true })
      fs.writeFileSync(
        path.join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
description: Second skill
---
# Skill Two`
      )

      const noSkillDir = path.join(skillsDir, 'not-a-skill')
      fs.mkdirSync(noSkillDir, { recursive: true })
      fs.writeFileSync(path.join(noSkillDir, 'README.md'), '# Not a skill')

      try {
        const skills = discoverSkillsShRepo(tempDir, 'test/repo')

        expect(skills).toHaveLength(2)
        expect(skills.every(s => s.source === 'skills-sh')).toBe(true)
        expect(skills.every(s => s.pluginName === 'test/repo')).toBe(true)
        expect(skills.find(s => s.name === 'skill-one')).toBeDefined()
        expect(skills.find(s => s.name === 'skill-two')).toBeDefined()
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('discovers skills from root SKILL.md', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillssh-test-'))

      fs.writeFileSync(
        path.join(tempDir, 'SKILL.md'),
        `---
name: root-skill
description: A root-level skill
---
# Root Skill`
      )

      try {
        const skills = discoverSkillsShRepo(tempDir, 'test/repo')

        expect(skills).toHaveLength(1)
        expect(skills[0].name).toBe('root-skill')
        expect(skills[0].source).toBe('skills-sh')
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('searches multiple skills.sh standard directories', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillssh-test-'))

      const skillsDir = path.join(tempDir, 'skills', 'from-skills')
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillsDir, 'SKILL.md'),
        `---
name: from-skills
description: From skills dir
---
# S`
      )

      const claudeDir = path.join(tempDir, '.claude', 'skills', 'from-claude')
      fs.mkdirSync(claudeDir, { recursive: true })
      fs.writeFileSync(
        path.join(claudeDir, 'SKILL.md'),
        `---
name: from-claude
description: From claude dir
---
# C`
      )

      try {
        const skills = discoverSkillsShRepo(tempDir, 'test/repo')

        expect(skills).toHaveLength(2)
        expect(skills.find(s => s.name === 'from-skills')).toBeDefined()
        expect(skills.find(s => s.name === 'from-claude')).toBeDefined()
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('skills-sh source type', () => {
    it('generateSkillsIndex handles skills-sh source', () => {
      const skills = [
        {
          name: 'frontend-design',
          description: 'Create distinctive frontend interfaces',
          skillMdPath: '/cache/SKILL.md',
          siblingFiles: [],
          source: 'skills-sh' as const,
          pluginName: 'vercel-labs/agent-skills',
        },
      ]

      const index = generateSkillsIndex(skills)

      expect(index).toContain('[Skills Index]')
      expect(index).toContain('skills-sh:vercel-labs/agent-skills:{frontend-design:Create distinctive frontend interfaces}')
    })
  })

  describe('fetchSkillsShSearch', () => {
    it('is exported and callable', () => {
      expect(typeof fetchSkillsShSearch).toBe('function')
    })
  })
})
