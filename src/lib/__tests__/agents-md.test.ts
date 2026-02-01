import { describe, it, expect } from 'bun:test'
import {
  buildDocTree,
  injectIndex,
  hasExistingIndex,
  removeDocsIndex,
  generateIndex,
  collectDocFiles,
  getGlobalCacheDir,
  getLocalCacheDir,
} from '../agents-md'
import fs from 'fs'
import path from 'path'
import os from 'os'

const START_MARKER = '<!-- AGENTS-MD-EMBED-START -->'
const END_MARKER = '<!-- AGENTS-MD-EMBED-END -->'

describe('agents-md', () => {
  describe('injectIndex', () => {
    it('appends to empty file', () => {
      const result = injectIndex('', 'index content')
      expect(result).toContain(START_MARKER)
      expect(result).toContain('index content')
      expect(result).toContain(END_MARKER)
    })

    it('appends to file without markers', () => {
      const existing = '# My Project\n\nSome existing content.'
      const result = injectIndex(existing, 'index content')

      expect(result).toContain(existing)
      expect(result).toContain(START_MARKER)
      expect(result).toContain('index content')
      expect(result).toContain(END_MARKER)
    })

    it('replaces content between existing markers', () => {
      const existing = `# My Project
Some content before.
${START_MARKER}
old index
${END_MARKER}
Some content after.`

      const result = injectIndex(existing, 'new index')

      expect(result).toContain('# My Project')
      expect(result).toContain('Some content before.')
      expect(result).toContain('new index')
      expect(result).toContain('Some content after.')
      expect(result).not.toContain('old index')
    })

    it('is idempotent - running twice produces same result', () => {
      const initial = '# Project\n'
      const first = injectIndex(initial, 'index v1')
      const second = injectIndex(first, 'index v1')

      expect(second).toBe(first)
    })

    it('preserves content before and after markers on update', () => {
      const before = '# Header\n\nIntro paragraph.'
      const after = '\n\n## Footer\n\nMore content.'
      const existing = `${before}\n\n${START_MARKER}\nold\n${END_MARKER}${after}`

      const result = injectIndex(existing, 'new')

      expect(result).toContain(before)
      expect(result).toContain(after)
      expect(result).toContain(`${START_MARKER}`)
      expect(result).toContain('new')
      expect(result).toContain(`${END_MARKER}`)
      expect(result).not.toContain('\nold\n')
    })
  })

  describe('hasExistingIndex', () => {
    it('returns true when markers are present', () => {
      const content = `# Project\n${START_MARKER}\nindex\n${END_MARKER}`
      expect(hasExistingIndex(content)).toBe(true)
    })

    it('returns false when no markers', () => {
      const content = '# Project\n\nNo index here.'
      expect(hasExistingIndex(content)).toBe(false)
    })
  })

  describe('removeDocsIndex', () => {
    it('removes index from content', () => {
      const content = `# Project\n\n${START_MARKER}\nindex content\n${END_MARKER}\n\nFooter`
      const result = removeDocsIndex(content)

      expect(result).toContain('# Project')
      expect(result).toContain('Footer')
      expect(result).not.toContain(START_MARKER)
      expect(result).not.toContain(END_MARKER)
      expect(result).not.toContain('index content')
    })

    it('returns unchanged content when no index exists', () => {
      const content = '# Project\n\nNo index here.\n'
      const result = removeDocsIndex(content)
      expect(result).toBe(content)
    })

    it('cleans up extra newlines after removal', () => {
      const content = `# Project\n\n\n${START_MARKER}\nindex\n${END_MARKER}\n\n\nFooter`
      const result = removeDocsIndex(content)

      // Should not have more than 2 consecutive newlines
      expect(result).not.toMatch(/\n{3,}/)
    })

    it('preserves content before and after index', () => {
      const before = '# Header\n\nIntro paragraph.'
      const after = '## Footer\n\nMore content.'
      const content = `${before}\n\n${START_MARKER}\nindex\n${END_MARKER}\n\n${after}`

      const result = removeDocsIndex(content)

      expect(result).toContain('# Header')
      expect(result).toContain('Intro paragraph.')
      expect(result).toContain('## Footer')
      expect(result).toContain('More content.')
    })

    it('handles index at start of file', () => {
      const content = `${START_MARKER}\nindex\n${END_MARKER}\n\nContent after`
      const result = removeDocsIndex(content)

      expect(result).toContain('Content after')
      expect(result).not.toContain(START_MARKER)
    })

    it('handles index at end of file', () => {
      const content = `Content before\n\n${START_MARKER}\nindex\n${END_MARKER}`
      const result = removeDocsIndex(content)

      expect(result).toContain('Content before')
      expect(result).not.toContain(START_MARKER)
      expect(result.endsWith('\n')).toBe(true)
    })

    it('handles file with only index', () => {
      const content = `${START_MARKER}\nindex\n${END_MARKER}`
      const result = removeDocsIndex(content)

      expect(result).toBe('')
    })
  })

  describe('buildDocTree', () => {
    it('groups files by top-level directory', () => {
      const files = [
        { relativePath: '01-getting-started/installation.mdx' },
        { relativePath: '01-getting-started/project-structure.mdx' },
        { relativePath: '02-app/routing.mdx' },
      ]

      const tree = buildDocTree(files)

      expect(tree).toHaveLength(2)
      expect(tree[0].name).toBe('01-getting-started')
      expect(tree[0].files).toHaveLength(2)
      expect(tree[1].name).toBe('02-app')
      expect(tree[1].files).toHaveLength(1)
    })

    it('creates nested subsections for deeper paths', () => {
      const files = [
        { relativePath: '02-app/01-building/layouts.mdx' },
        { relativePath: '02-app/01-building/pages.mdx' },
        { relativePath: '02-app/02-api/route-handlers.mdx' },
      ]

      const tree = buildDocTree(files)

      expect(tree).toHaveLength(1)
      const appSection = tree[0]
      expect(appSection.name).toBe('02-app')
      expect(appSection.files).toHaveLength(0) // No direct files
      expect(appSection.subsections).toHaveLength(2)

      const building = appSection.subsections.find((s) => s.name === '01-building')
      expect(building).toBeDefined()
      expect(building!.files).toHaveLength(2)

      const api = appSection.subsections.find((s) => s.name === '02-api')
      expect(api).toBeDefined()
      expect(api!.files).toHaveLength(1)
    })

    it('handles 4-level deep paths with sub-subsections', () => {
      const files = [
        { relativePath: '02-app/01-building/01-routing/dynamic-routes.mdx' },
        { relativePath: '02-app/01-building/01-routing/parallel-routes.mdx' },
      ]

      const tree = buildDocTree(files)

      const routing = tree[0].subsections[0].subsections[0]
      expect(routing.name).toBe('01-routing')
      expect(routing.files).toHaveLength(2)
    })

    it('includes root-level files in a special "." section', () => {
      const files = [
        { relativePath: 'getting-started.mdx' },
        { relativePath: 'overview.mdx' },
        { relativePath: '01-guide/intro.mdx' },
      ]

      const tree = buildDocTree(files)

      // Root-level files should be in a "." section
      expect(tree).toHaveLength(2)
      const rootSection = tree.find((s) => s.name === '.')
      expect(rootSection).toBeDefined()
      expect(rootSection!.files).toHaveLength(2)
      expect(tree.find((s) => s.name === '01-guide')).toBeDefined()
    })

    it('sorts sections and files alphabetically', () => {
      const files = [
        { relativePath: 'z-section/b-file.mdx' },
        { relativePath: 'a-section/z-file.mdx' },
        { relativePath: 'a-section/a-file.mdx' },
        { relativePath: 'z-section/a-file.mdx' },
      ]

      const tree = buildDocTree(files)

      expect(tree[0].name).toBe('a-section')
      expect(tree[1].name).toBe('z-section')
      expect(tree[0].files[0].relativePath).toBe('a-section/a-file.mdx')
      expect(tree[0].files[1].relativePath).toBe('a-section/z-file.mdx')
    })
  })

  describe('generateIndex', () => {
    it('creates compressed pipe-delimited format', () => {
      const sections = [
        {
          name: '01-intro',
          files: [
            { relativePath: '01-intro/getting-started.mdx' },
            { relativePath: '01-intro/installation.mdx' },
          ],
          subsections: [],
        },
      ]

      const index = generateIndex({
        docsPath: './.docs',
        sections,
        outputFile: 'AGENTS.md',
        providerName: 'Test Framework',
        instruction: 'Test instruction.',
      })

      expect(index).toContain('[Test Framework Docs Index]')
      expect(index).toContain('root: ./.docs')
      expect(index).toContain('Test instruction.')
      expect(index).toContain('01-intro:{getting-started.mdx,installation.mdx}')
      expect(index.split('|').length).toBeGreaterThan(1)
    })

    it('groups files by directory in output', () => {
      const sections = [
        {
          name: 'docs',
          files: [],
          subsections: [
            {
              name: 'api',
              files: [
                { relativePath: 'docs/api/routes.mdx' },
                { relativePath: 'docs/api/middleware.mdx' },
              ],
              subsections: [],
            },
          ],
        },
      ]

      const index = generateIndex({
        docsPath: './docs',
        sections,
      })

      expect(index).toContain('docs/api:{')
      expect(index).toContain('routes.mdx')
      expect(index).toContain('middleware.mdx')
    })
  })

  describe('collectDocFiles', () => {
    it('collects files with specified extensions', () => {
      // Create temp directory with test files
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentsmd-test-'))
      const subDir = path.join(tempDir, 'section')
      fs.mkdirSync(subDir)

      fs.writeFileSync(path.join(subDir, 'doc1.md'), '# Doc 1')
      fs.writeFileSync(path.join(subDir, 'doc2.mdx'), '# Doc 2')
      fs.writeFileSync(path.join(subDir, 'style.css'), '/* styles */')
      fs.writeFileSync(path.join(subDir, 'index.md'), '# Index')

      try {
        const files = collectDocFiles(tempDir, { extensions: ['.md', '.mdx'] })

        expect(files.some((f) => f.relativePath.includes('doc1.md'))).toBe(true)
        expect(files.some((f) => f.relativePath.includes('doc2.mdx'))).toBe(true)
        expect(files.some((f) => f.relativePath.includes('style.css'))).toBe(false)
        expect(files.some((f) => f.relativePath.includes('index.md'))).toBe(false)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('getGlobalCacheDir', () => {
    it('returns path under ~/.cache/agdex', () => {
      const result = getGlobalCacheDir()
      expect(result).toBe(path.join(os.homedir(), '.cache', 'agdex'))
    })
  })

  describe('getLocalCacheDir', () => {
    it('returns path under cwd/.agdex', () => {
      const cwd = '/some/project'
      const result = getLocalCacheDir(cwd)
      expect(result).toBe(path.join(cwd, '.agdex'))
    })

    it('works with different cwd values', () => {
      expect(getLocalCacheDir('/a')).toBe('/a/.agdex')
      expect(getLocalCacheDir('/home/user/project')).toBe('/home/user/project/.agdex')
    })
  })
})
