# skills.sh Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend agdex's `skills` subcommand to integrate with the skills.sh ecosystem — remote repo fetching, interactive API search, and the GitHub repo flow fix.

**Architecture:** Add `'skills-sh'` as a new skill source type. Add `fetchSkillsShSearch()` for API calls and `cloneAndDiscoverSkills()` for remote repo fetching (reusing existing git sparse-checkout). Wire into CLI via `--repo` flag on `skills embed` and new `skills find` subcommand.

**Tech Stack:** TypeScript, Bun, native `fetch`, `prompts` (existing dep), `picocolors` (existing dep), `child_process` (existing)

---

### Task 1: Add types for skills.sh integration

**Files:**
- Modify: `src/lib/types.ts:145` (SkillSource union)
- Modify: `src/lib/types.ts:167` (add new interface after SkillsEmbedResult)
- Test: `src/lib/__tests__/skills.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/__tests__/skills.test.ts` at the end of the file (before the closing `})`):

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: FAIL — `'skills-sh'` is not a valid `SkillSource` type

**Step 3: Update SkillSource type**

In `src/lib/types.ts:145`, change:
```typescript
export type SkillSource = 'plugin' | 'user' | 'project'
```
to:
```typescript
export type SkillSource = 'plugin' | 'user' | 'project' | 'skills-sh'
```

**Step 4: Add SkillsShSearchResult interface**

After the `SkillsEmbedResult` interface (after line 168), add:

```typescript
export interface SkillsShSearchResult {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

export interface SkillsShSearchResponse {
  query: string
  searchType: string
  skills: SkillsShSearchResult[]
  count: number
  duration_ms: number
}
```

**Step 5: Update sourceBreakdown in embedSkills**

In `src/lib/skills.ts:527-531`, update the sourceBreakdown initializer:
```typescript
const sourceBreakdown: Record<SkillSource, number> = {
  plugin: 0,
  user: 0,
  project: 0,
  'skills-sh': 0,
}
```

**Step 6: Update generateSkillsIndex to handle skills-sh source**

In `src/lib/skills.ts:326-341`, add `skillsShSkills` grouping. The full updated block:

```typescript
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
```

**Step 7: Run test to verify it passes**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/skills.ts src/lib/__tests__/skills.test.ts
git commit -m "feat: add skills-sh source type and search API types"
```

---

### Task 2: Add remote skills discovery function

**Files:**
- Modify: `src/lib/skills.ts` (add `cloneAndDiscoverSkills` function)
- Test: `src/lib/__tests__/skills.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/__tests__/skills.test.ts`:

```typescript
describe('cloneAndDiscoverSkills', () => {
  it('discovers skills from a local directory with skills.sh structure', () => {
    // Simulate a cloned skills.sh repo with skills/ directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillssh-test-'))
    const skillsDir = path.join(tempDir, 'skills')

    // Create skill1
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

    // Create skill2
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

    // Create a non-skill directory (no SKILL.md)
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

    // skills/ directory
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

    // .claude/skills/ directory
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
```

**Step 2: Run test to verify it fails**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: FAIL — `discoverSkillsShRepo` is not defined

**Step 3: Implement discoverSkillsShRepo**

Add to `src/lib/skills.ts` (after the `discoverFlatSkills` function, around line 281):

```typescript
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
```

Note: Also need to make `getSiblingFiles` accessible (it's already a module-level function, not exported, but callable within the same file).

**Step 4: Update imports in test file**

Add `discoverSkillsShRepo` to the import list in `src/lib/__tests__/skills.test.ts:2-11`:

```typescript
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
} from '../skills'
```

**Step 5: Export discoverSkillsShRepo from skills.ts**

Add `discoverSkillsShRepo` to the re-export block at the bottom of `src/lib/skills.ts`:

```typescript
// Re-export types
export type {
  SkillFrontmatter,
  SkillEntry,
  SkillSource,
  SkillSourceConfig,
  SkillsEmbedOptions,
  SkillsEmbedResult,
} from './types'
```

(The function is already exported via the `export function` declaration.)

**Step 6: Run test to verify it passes**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/lib/skills.ts src/lib/__tests__/skills.test.ts
git commit -m "feat: add discoverSkillsShRepo for remote skills discovery"
```

---

### Task 3: Add skills.sh API search function

**Files:**
- Modify: `src/lib/skills.ts` (add `fetchSkillsShSearch`)
- Test: `src/lib/__tests__/skills.test.ts`

**Step 1: Write the failing test**

Add to `src/lib/__tests__/skills.test.ts`:

```typescript
describe('fetchSkillsShSearch', () => {
  it('is exported and callable', () => {
    expect(typeof fetchSkillsShSearch).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: FAIL — `fetchSkillsShSearch` is not defined

**Step 3: Implement fetchSkillsShSearch**

Add to `src/lib/skills.ts`:

```typescript
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
```

Also add the import at the top of `src/lib/skills.ts`:

```typescript
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
```

**Step 4: Update test imports**

Add `fetchSkillsShSearch` to the import in the test file.

**Step 5: Run test to verify it passes**

Run: `bun test src/lib/__tests__/skills.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/lib/skills.ts src/lib/__tests__/skills.test.ts
git commit -m "feat: add fetchSkillsShSearch for skills.sh API integration"
```

---

### Task 4: Add `--repo` flag to `skills embed` command

**Files:**
- Modify: `src/cli/index.ts:994-1000` (SkillsEmbedCommandOptions interface)
- Modify: `src/cli/index.ts:1002-1051` (runSkillsEmbed function)
- Modify: `src/cli/index.ts:1149-1160` (skills embed command definition)

**Step 1: Add `repo` to SkillsEmbedCommandOptions**

In `src/cli/index.ts:994-1000`:

```typescript
interface SkillsEmbedCommandOptions {
  output?: string
  plugin?: string[]
  user?: boolean
  project?: boolean
  plugins?: boolean
  repo?: string
}
```

**Step 2: Add --repo option to skills embed command**

In `src/cli/index.ts:1149-1160`, add after the existing options:

```
.option('--repo <owner/repo>', 'Fetch and index skills from a skills.sh-compatible GitHub repository')
```

**Step 3: Add remote repo handling to runSkillsEmbed**

In `src/cli/index.ts:1002`, update the `runSkillsEmbed` function to handle `--repo`. Add this block after the `sources` variable is built (around line 1013), before the existing `if (sources.length === 0)` check:

```typescript
// Handle --repo flag: clone remote repo and discover skills
if (options.repo) {
  const { execSync } = await import('child_process')
  const repoName = options.repo

  console.log(`\nFetching skills from ${pc.cyan(repoName)}...`)

  // Use global cache
  const cacheDir = path.join(os.homedir(), '.cache', 'agdex', 'skills-sh', repoName.replace('/', path.sep))
  const cacheHit = fs.existsSync(cacheDir) && fs.readdirSync(cacheDir).length > 0

  if (!cacheHit) {
    // Clone the repo using sparse checkout
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-skills-'))
    try {
      execSync(
        `git clone --depth 1 --filter=blob:none https://github.com/${repoName}.git .`,
        { cwd: tempDir, stdio: 'pipe' }
      )

      // Copy to cache
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

  // Discover skills from the cloned repo
  const { discoverSkillsShRepo } = await import('../lib/skills')
  const remoteSkills = discoverSkillsShRepo(cacheDir, repoName)

  if (remoteSkills.length === 0) {
    console.error(pc.red(`No skills found in ${repoName}`))
    process.exit(1)
  }

  console.log(`${pc.green('✓')} Found ${pc.bold(remoteSkills.length.toString())} skills`)

  // Also collect local skills if not explicitly excluded
  const localSkills = collectAllSkills(sources)
  const allSkills = [...remoteSkills, ...localSkills]

  // Generate and inject index
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

  const action = isNewFile ? 'Created' : 'Updated'
  const sizeInfo = isNewFile
    ? formatSize(sizeAfter)
    : `${formatSize(sizeBefore)} → ${formatSize(sizeAfter)}`

  console.log(`${pc.green('✓')} ${action} ${pc.bold(output)} (${sizeInfo})`)
  console.log(`${pc.green('✓')} Indexed ${pc.bold(allSkills.length.toString())} skills`)
  console.log('')
  return
}
```

**Step 4: Add missing imports to cli/index.ts**

Add `discoverSkillsShRepo` to the skills imports at the top of `src/cli/index.ts:22-27`:

```typescript
import {
  embedSkills,
  collectAllSkills,
  getDefaultSkillSources,
  hasExistingSkillsIndex,
  removeSkillsIndex,
  discoverSkillsShRepo,
  generateSkillsIndex,
  injectSkillsIndex,
} from '../lib/skills'
```

Also add `os` import if not already present (check the imports).

**Step 5: Test manually**

Run: `bun run src/cli/index.ts skills embed --repo vercel-labs/agent-skills -o /tmp/test-claude.md`
Expected: Clones repo, discovers skills, embeds index

**Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add --repo flag to skills embed for remote skills.sh repos"
```

---

### Task 5: Add `skills find` subcommand

**Files:**
- Modify: `src/cli/index.ts` (add find subcommand after line 1179)

**Step 1: Add the SkillsFindCommandOptions interface and runSkillsFind function**

Add after the `runSkillsLocal` function (around line 1147):

```typescript
interface SkillsFindCommandOptions {
  limit?: number
  output?: string
}

async function runSkillsFind(query: string | undefined, options: SkillsFindCommandOptions): Promise<void> {
  const { fetchSkillsShSearch } = await import('../lib/skills')
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

    // Group results by source repo
    const byRepo = new Map<string, typeof results>()
    for (const result of results) {
      const existing = byRepo.get(result.source) || []
      existing.push(result)
      byRepo.set(result.source, existing)
    }

    // Build choices — group by repo
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
```

**Step 2: Register the find subcommand**

Add after the existing `skillsCommand.command('local ...')` block (after line 1179):

```typescript
skillsCommand
  .command('find [query]')
  .description('Search skills.sh for agent skills')
  .option('-l, --limit <n>', 'Max results (default: 20)', parseInt)
  .option('-o, --output <file>', 'Target file for embedding')
  .action(runSkillsFind)
```

**Step 3: Test manually**

Run: `bun run src/cli/index.ts skills find react`
Expected: Displays search results from skills.sh API

Run: `bun run src/cli/index.ts skills find`
Expected: Interactive mode — prompts for query, shows results, allows selection

**Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: add skills find subcommand for skills.sh search"
```

---

### Task 6: Fix GitHub repo skills flow

**Files:**
- Modify: `src/cli/index.ts:674-678` (replace "coming soon" message)

**Step 1: Replace the coming soon block**

In `src/cli/index.ts:674-678`, replace:

```typescript
} else if (contentChoice.content === 'skills') {
  // Handle skills differently - use the skills embed flow
  console.log(pc.yellow('\nSkills indexing from GitHub URLs is coming soon!'))
  console.log(pc.gray('For now, clone the repo and use: agdex skills local <path>\n'))
  process.exit(0)
```

with:

```typescript
} else if (contentChoice.content === 'skills') {
  // Embed skills from the detected skills directory
  const output = await promptForOutputFile()
  await runSkillsEmbed({ repo: parsed.repo, output })
  process.exit(0)
```

**Step 2: Test manually**

Run: `bun run src/cli/index.ts` → select "GitHub repository" → enter `vercel-labs/agent-skills` → select "Skills"
Expected: Clones repo, discovers and embeds skills (no more "coming soon")

**Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "fix: replace coming soon message with working skills embed from GitHub repos"
```

---

### Task 7: Update help text and list command

**Files:**
- Modify: `src/cli/index.ts:808-816` (help/list command output)

**Step 1: Update list command examples**

In `src/cli/index.ts:808-816`, update the skills section to mention the new capabilities:

```typescript
console.log(pc.gray('  Skills indexing:'))
console.log(`    ${pc.white('agdex skills embed')}`)
console.log(`    ${pc.white('agdex skills embed --repo vercel-labs/agent-skills')}`)
console.log(`    ${pc.white('agdex skills find react')}`)
console.log('')
```

**Step 2: Commit**

```bash
git add src/cli/index.ts
git commit -m "docs: update help text with skills.sh commands"
```

---

### Task 8: Run all tests and verify

**Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run the build**

Run: `bun run build` (if a build script exists) or `bun build src/cli/index.ts --outdir dist`
Expected: No TypeScript errors

**Step 3: Manual smoke tests**

Run each of these and verify:

```bash
# Search skills.sh
bun run src/cli/index.ts skills find react

# Embed from remote repo
bun run src/cli/index.ts skills embed --repo vercel-labs/agent-skills -o /tmp/test.md

# Existing skills embed still works
bun run src/cli/index.ts skills list

# Interactive GitHub flow (enter vercel-labs/agent-skills, select Skills)
bun run src/cli/index.ts
```

**Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
