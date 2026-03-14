/**
 * URL-based documentation scraper
 *
 * Fetches documentation from a website, extracts main content,
 * converts to markdown, and saves as files mirroring the URL structure.
 */
import fs from 'fs'
import path from 'path'
import { parse as parseHTML } from 'node-html-parser'
import TurndownService from 'turndown'
import type { UrlDocConfig, PullResult } from './types'

/**
 * Default page discovery: finds all internal links in the index page
 * that point to .html files within the same documentation tree.
 */
function defaultDiscoverPages(html: string, baseUrl: string): string[] {
  const root = parseHTML(html)
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/[^/]*$/, '/')
  const links = root.querySelectorAll('a[href]')
  const pages = new Set<string>()

  for (const link of links) {
    const href = link.getAttribute('href')
    if (!href) continue

    // Skip external links, anchors, and non-html
    if (href.startsWith('http') && !href.startsWith(base.origin)) continue
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue

    // Resolve relative URLs
    let resolved: URL
    try {
      resolved = new URL(href, baseUrl)
    } catch {
      continue
    }

    // Must be under the same base path
    if (!resolved.pathname.startsWith(basePath)) continue

    // Must be an HTML page
    if (!resolved.pathname.endsWith('.html')) continue

    // Get the relative path from the base
    const relativePath = resolved.pathname.slice(basePath.length)
    if (relativePath && relativePath !== 'index.html') {
      pages.add(relativePath)
    }
  }

  return Array.from(pages).sort()
}

/**
 * Create a configured Turndown service for HTML-to-Markdown conversion
 */
function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  // Improve code block handling
  turndown.addRule('codeBlocks', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.querySelector('code') !== null
    },
    replacement: (_content, node) => {
      const code = node.querySelector('code')
      if (!code) return _content
      const lang = (code as any).className?.match(/language-(\w+)/)?.[1] || ''
      const text = code.textContent || ''
      return `\n\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n\n`
    },
  })

  // Remove images that are just icons/decorations
  turndown.addRule('skipSmallImages', {
    filter: (node) => {
      if (node.nodeName !== 'IMG') return false
      const width = parseInt(node.getAttribute('width') || '999', 10)
      return width < 30
    },
    replacement: () => '',
  })

  return turndown
}

/**
 * Extract the main documentation content from an HTML page
 */
function extractContent(
  html: string,
  contentSelector: string,
  removeSelectors: string[]
): string {
  const root = parseHTML(html)

  // Find the main content container
  const main = root.querySelector(contentSelector)
  if (!main) {
    // Fallback: try common selectors
    const fallbacks = ['main', 'article', '.content', '.documentation', '#content']
    for (const sel of fallbacks) {
      const el = root.querySelector(sel)
      if (el) {
        return extractFromElement(el, removeSelectors)
      }
    }
    // Last resort: use body
    const body = root.querySelector('body')
    if (body) return extractFromElement(body, removeSelectors)
    return ''
  }

  return extractFromElement(main, removeSelectors)
}

function extractFromElement(
  element: ReturnType<typeof parseHTML>,
  removeSelectors: string[]
): string {
  // Remove unwanted elements
  const defaultRemove = [
    'nav',
    '.sidebar',
    '.toc',
    '.breadcrumb',
    '.header-link',
    '.edit-this-page',
    '.page-navigation',
    '.footer',
    'script',
    'style',
    '.admonition-title + .last', // sphinx note titles
  ]

  for (const sel of [...defaultRemove, ...removeSelectors]) {
    const els = element.querySelectorAll(sel)
    for (const el of els) {
      el.remove()
    }
  }

  return element.innerHTML
}

/**
 * Fetch a single page and convert to markdown
 */
async function fetchPage(
  url: string,
  contentSelector: string,
  removeSelectors: string[],
  turndown: TurndownService
): Promise<{ markdown: string; title: string }> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const root = parseHTML(html)

  // Extract title
  const titleEl = root.querySelector('h1') || root.querySelector('title')
  const title = titleEl?.textContent?.trim() || ''

  // Extract and convert content
  const contentHtml = extractContent(html, contentSelector, removeSelectors)
  let markdown = turndown.turndown(contentHtml)

  // Clean up excessive whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()

  // Add title as h1 if not already present
  if (title && !markdown.startsWith('# ')) {
    markdown = `# ${title}\n\n${markdown}`
  }

  return { markdown, title }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Scrape documentation from a URL and save as markdown files
 */
export async function pullDocsFromUrl(
  config: UrlDocConfig,
  destDir: string,
  options?: { onProgress?: (current: number, total: number, page: string) => void }
): Promise<PullResult> {
  const {
    baseUrl,
    contentSelector = 'main#main-content, main, article',
    removeSelectors = [],
    concurrency = 5,
    fetchDelay = 200,
  } = config

  try {
    // Ensure base URL ends properly
    const base = new URL(baseUrl)
    const basePath = base.pathname.replace(/\/[^/]*$/, '/')
    const baseUrlNormalized = `${base.origin}${basePath}`

    // Discover pages
    let pages: string[]

    if (config.pages && config.pages.length > 0) {
      pages = config.pages
    } else {
      // Fetch the index page to discover links
      const indexResponse = await fetch(baseUrl)
      if (!indexResponse.ok) {
        return {
          success: false,
          error: `Failed to fetch index page ${baseUrl}: ${indexResponse.status}`,
        }
      }
      const indexHtml = await indexResponse.text()

      if (config.discoverPages) {
        pages = config.discoverPages(indexHtml, baseUrl)
      } else {
        pages = defaultDiscoverPages(indexHtml, baseUrl)
      }
    }

    if (pages.length === 0) {
      return {
        success: false,
        error: `No documentation pages found at ${baseUrl}`,
      }
    }

    // Create destination directory
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    const turndown = createTurndownService()
    const contentSelectors = contentSelector.split(',').map((s) => s.trim())

    // Process pages with concurrency control
    let processed = 0
    const errors: string[] = []

    // Process in batches
    for (let i = 0; i < pages.length; i += concurrency) {
      const batch = pages.slice(i, i + concurrency)

      const results = await Promise.allSettled(
        batch.map(async (pagePath) => {
          const pageUrl = `${baseUrlNormalized}${pagePath}`

          // Try each content selector
          let result: { markdown: string; title: string } | null = null
          for (const sel of contentSelectors) {
            try {
              result = await fetchPage(pageUrl, sel, removeSelectors, turndown)
              if (result.markdown.length > 100) break // Found substantial content
            } catch {
              continue
            }
          }

          if (!result || result.markdown.length < 50) {
            errors.push(`Skipped ${pagePath}: no substantial content found`)
            return
          }

          // Convert HTML path to markdown path
          // e.g., "getting-started/quick-start-guide.html" -> "getting-started/quick-start-guide.md"
          const mdPath = pagePath.replace(/\.html$/, '.md')
          const fullPath = path.join(destDir, mdPath)

          // Ensure directory exists
          const dir = path.dirname(fullPath)
          fs.mkdirSync(dir, { recursive: true })

          // Write markdown file
          fs.writeFileSync(fullPath, result.markdown, 'utf-8')

          processed++
          options?.onProgress?.(processed, pages.length, pagePath)
        })
      )

      // Check for rejections
      for (const r of results) {
        if (r.status === 'rejected') {
          errors.push(r.reason?.message || String(r.reason))
        }
      }

      // Delay between batches
      if (i + concurrency < pages.length && fetchDelay > 0) {
        await sleep(fetchDelay)
      }
    }

    if (processed === 0) {
      return {
        success: false,
        error: `Failed to extract content from any pages. Errors: ${errors.join('; ')}`,
      }
    }

    return {
      success: true,
      docsPath: destDir,
      version: 'latest',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Create a URL-based documentation provider
 */
export function createUrlProvider(options: {
  name: string
  displayName: string
  urlConfig: UrlDocConfig
  extensions?: string[]
  excludePatterns?: string[]
  instruction?: string
}): import('./types').DocProvider {
  return {
    name: options.name,
    displayName: options.displayName,
    repo: '',
    docsPath: '',
    extensions: options.extensions || ['.md'],
    excludePatterns: options.excludePatterns || [],
    instruction:
      options.instruction ||
      `IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any ${options.displayName} tasks.`,
    urlConfig: options.urlConfig,
  }
}
