import { describe, it, expect, afterEach } from 'bun:test'
import {
  injectIndex,
  getDocIndexEntries,
  generateDocIndexSummary,
  hasDocIndexSummary,
  injectDocIndexSummary,
  removeDocIndexSummary,
  applyDocIndex,
  removeDocIndexEntry,
  DEFAULT_DOC_INDEX_FILE,
} from '../agents-md'
import fs from 'fs'
import path from 'path'
import os from 'os'

const SUMMARY_START = '<!-- AGENTS-MD-DOCINDEX-SUMMARY-START -->'
const SUMMARY_END = '<!-- AGENTS-MD-DOCINDEX-SUMMARY-END -->'

// A realistic index block as produced by generateIndex(), wrapped in markers
function block(name: string, displayName: string): string {
  const index = `[${displayName} Docs Index]|root: /cache/${name}|api:{a.md,b.md}`
  return injectIndex('', index, name)
}

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agdex-docindex-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
  }
})

describe('getDocIndexEntries', () => {
  it('returns empty array for content with no indices', () => {
    expect(getDocIndexEntries('')).toEqual([])
    expect(getDocIndexEntries('# nothing here')).toEqual([])
  })

  it('parses name and display name from a single index', () => {
    const content = block('tensorrt', 'NVIDIA TensorRT')
    const entries = getDocIndexEntries(content)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('tensorrt')
    expect(entries[0].displayName).toBe('NVIDIA TensorRT')
  })

  it('parses multiple indices in document order', () => {
    const content = block('tensorrt', 'NVIDIA TensorRT') + '\n' + block('bun', 'Bun')
    const entries = getDocIndexEntries(content)
    expect(entries.map((e) => e.name)).toEqual(['tensorrt', 'bun'])
    expect(entries.map((e) => e.displayName)).toEqual(['NVIDIA TensorRT', 'Bun'])
  })

  it('falls back to the marker name when no header is present', () => {
    const content = injectIndex('', 'no-header-content', 'weird')
    const entries = getDocIndexEntries(content)
    expect(entries[0].displayName).toBe('weird')
  })
})

describe('generateDocIndexSummary', () => {
  it('includes the heading and the IMPORTANT instruction', () => {
    const summary = generateDocIndexSummary([{ name: 'tensorrt', displayName: 'NVIDIA TensorRT' }])
    expect(summary).toContain('## Document Indices')
    expect(summary).toContain(
      `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any of the docs found in ${DEFAULT_DOC_INDEX_FILE} .`
    )
    expect(summary).toContain('- NVIDIA TensorRT (`tensorrt`)')
  })

  it('uses a custom doc index file name when provided', () => {
    const summary = generateDocIndexSummary([], 'MYINDEX.md')
    expect(summary).toContain('docs found in MYINDEX.md .')
  })

  it('shows a placeholder when there are no entries', () => {
    const summary = generateDocIndexSummary([])
    expect(summary).toContain('_No documentation indices available yet._')
  })
})

describe('doc index summary inject/remove', () => {
  it('appends a wrapped summary section to existing content', () => {
    const result = injectDocIndexSummary('# Project\n', generateDocIndexSummary([]))
    expect(result).toContain('# Project')
    expect(result).toContain(SUMMARY_START)
    expect(result).toContain('## Document Indices')
    expect(result).toContain(SUMMARY_END)
  })

  it('does not add leading blank lines to an empty file', () => {
    const result = injectDocIndexSummary('', generateDocIndexSummary([]))
    expect(result.startsWith(SUMMARY_START)).toBe(true)
  })

  it('replaces an existing summary section in place', () => {
    const first = injectDocIndexSummary(
      '# Project\n',
      generateDocIndexSummary([{ name: 'bun', displayName: 'Bun' }])
    )
    const second = injectDocIndexSummary(
      first,
      generateDocIndexSummary([{ name: 'tensorrt', displayName: 'NVIDIA TensorRT' }])
    )
    expect(second).toContain('- NVIDIA TensorRT (`tensorrt`)')
    expect(second).not.toContain('- Bun (`bun`)')
    // Only one summary section
    expect(second.split(SUMMARY_START)).toHaveLength(2)
  })

  it('is idempotent', () => {
    const summary = generateDocIndexSummary([{ name: 'bun', displayName: 'Bun' }])
    const first = injectDocIndexSummary('# Project\n', summary)
    const second = injectDocIndexSummary(first, summary)
    expect(second).toBe(first)
  })

  it('hasDocIndexSummary detects presence', () => {
    expect(hasDocIndexSummary('# Project')).toBe(false)
    const withSummary = injectDocIndexSummary('# Project\n', generateDocIndexSummary([]))
    expect(hasDocIndexSummary(withSummary)).toBe(true)
  })

  it('removeDocIndexSummary strips the section but keeps surrounding content', () => {
    const content = injectDocIndexSummary('# Project\n\nIntro.\n', generateDocIndexSummary([]))
    const removed = removeDocIndexSummary(content)
    expect(removed).toContain('# Project')
    expect(removed).toContain('Intro.')
    expect(removed).not.toContain(SUMMARY_START)
    expect(removed).not.toContain('## Document Indices')
  })
})

describe('applyDocIndex', () => {
  it('writes the full index to DOCINDEX.md and a summary to the agent file', () => {
    const cwd = makeTmpDir()
    fs.writeFileSync(path.join(cwd, 'CLAUDE.local.md'), '# Project\n', 'utf-8')

    const applied = applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'tensorrt',
      indexContent: '[NVIDIA TensorRT Docs Index]|root: /cache/tensorrt|api:{a.md}',
    })

    const docIndex = fs.readFileSync(path.join(cwd, DEFAULT_DOC_INDEX_FILE), 'utf-8')
    expect(docIndex).toContain('[NVIDIA TensorRT Docs Index]')
    expect(docIndex).toContain('AGENTS-MD-EMBED-START:tensorrt')

    const agent = fs.readFileSync(path.join(cwd, 'CLAUDE.local.md'), 'utf-8')
    expect(agent).toContain('# Project')
    expect(agent).toContain('## Document Indices')
    expect(agent).toContain('- NVIDIA TensorRT (`tensorrt`)')
    // The full index must NOT leak into the agent file
    expect(agent).not.toContain('root: /cache/tensorrt')

    expect(applied.entries.map((e) => e.name)).toEqual(['tensorrt'])
  })

  it('accumulates multiple providers in DOCINDEX.md and the summary list', () => {
    const cwd = makeTmpDir()

    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'tensorrt',
      indexContent: '[NVIDIA TensorRT Docs Index]|root: /cache/tensorrt|api:{a.md}',
    })
    const applied = applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'bun',
      indexContent: '[Bun Docs Index]|root: /cache/bun|api:{b.md}',
    })

    const agent = fs.readFileSync(path.join(cwd, 'CLAUDE.local.md'), 'utf-8')
    expect(agent).toContain('- NVIDIA TensorRT (`tensorrt`)')
    expect(agent).toContain('- Bun (`bun`)')
    // Still only one summary section
    expect(agent.split(SUMMARY_START)).toHaveLength(2)
    expect(applied.entries.map((e) => e.name).sort()).toEqual(['bun', 'tensorrt'])
  })

  it('replaces an existing provider block rather than duplicating it', () => {
    const cwd = makeTmpDir()
    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'bun',
      indexContent: '[Bun Docs Index]|root: /cache/bun|api:{old.md}',
    })
    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'bun',
      indexContent: '[Bun Docs Index]|root: /cache/bun|api:{new.md}',
    })
    const docIndex = fs.readFileSync(path.join(cwd, DEFAULT_DOC_INDEX_FILE), 'utf-8')
    expect(docIndex).toContain('new.md')
    expect(docIndex).not.toContain('old.md')
    expect(docIndex.split('AGENTS-MD-EMBED-START:bun')).toHaveLength(2)
  })
})

describe('removeDocIndexEntry', () => {
  function seedTwo(cwd: string) {
    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'tensorrt',
      indexContent: '[NVIDIA TensorRT Docs Index]|root: /cache/tensorrt|api:{a.md}',
    })
    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'bun',
      indexContent: '[Bun Docs Index]|root: /cache/bun|api:{b.md}',
    })
  }

  it('removes one provider and updates the summary, keeping the others', () => {
    const cwd = makeTmpDir()
    seedTwo(cwd)

    const res = removeDocIndexEntry({ cwd, agentFile: 'CLAUDE.local.md', providerName: 'bun' })
    expect(res.removed).toBe(true)
    expect(res.removedProviders).toEqual(['bun'])
    expect(res.docIndexDeleted).toBe(false)

    const docIndex = fs.readFileSync(path.join(cwd, DEFAULT_DOC_INDEX_FILE), 'utf-8')
    expect(docIndex).toContain('AGENTS-MD-EMBED-START:tensorrt')
    expect(docIndex).not.toContain('AGENTS-MD-EMBED-START:bun')

    const agent = fs.readFileSync(path.join(cwd, 'CLAUDE.local.md'), 'utf-8')
    expect(agent).toContain('- NVIDIA TensorRT (`tensorrt`)')
    expect(agent).not.toContain('- Bun (`bun`)')
  })

  it('deletes DOCINDEX.md and removes the summary when the last index is removed', () => {
    const cwd = makeTmpDir()
    fs.writeFileSync(path.join(cwd, 'CLAUDE.local.md'), '# Project\n', 'utf-8')
    applyDocIndex({
      cwd,
      agentFile: 'CLAUDE.local.md',
      providerName: 'bun',
      indexContent: '[Bun Docs Index]|root: /cache/bun|api:{b.md}',
    })

    const res = removeDocIndexEntry({ cwd, agentFile: 'CLAUDE.local.md', providerName: 'bun' })
    expect(res.removed).toBe(true)
    expect(res.docIndexDeleted).toBe(true)
    expect(fs.existsSync(path.join(cwd, DEFAULT_DOC_INDEX_FILE))).toBe(false)

    const agent = fs.readFileSync(path.join(cwd, 'CLAUDE.local.md'), 'utf-8')
    expect(agent).toContain('# Project')
    expect(agent).not.toContain('## Document Indices')
    expect(agent).not.toContain(SUMMARY_START)
  })

  it('removes all indices when no provider name is given', () => {
    const cwd = makeTmpDir()
    seedTwo(cwd)

    const res = removeDocIndexEntry({ cwd, agentFile: 'CLAUDE.local.md' })
    expect(res.removed).toBe(true)
    expect(res.removedProviders.sort()).toEqual(['bun', 'tensorrt'])
    expect(res.docIndexDeleted).toBe(true)
    expect(fs.existsSync(path.join(cwd, DEFAULT_DOC_INDEX_FILE))).toBe(false)
  })

  it('is a no-op when DOCINDEX.md does not exist', () => {
    const cwd = makeTmpDir()
    const res = removeDocIndexEntry({ cwd, agentFile: 'CLAUDE.local.md', providerName: 'bun' })
    expect(res.removed).toBe(false)
    expect(res.removedProviders).toEqual([])
  })
})
