# agentsmd-embed

Embed compressed documentation indexes into `AGENTS.md` or `CLAUDE.md` for AI coding agents.

This package helps AI coding agents (Claude, Cursor, etc.) work with version-matched framework documentation by embedding a compressed docs index directly into your project's markdown file. Based on [Vercel's research](https://vercel.com/blog/teaching-ai-agents-how-to-use-nextjs) showing that embedded docs achieve 100% pass rates compared to 79% for skills.

## Why?

AI coding agents rely on training data that becomes outdated. When agents don't know current APIs, they generate incorrect code. This tool:

1. Downloads version-matched documentation from GitHub
2. Creates a compressed index (~8KB for Next.js)
3. Embeds it in your `AGENTS.md` or `CLAUDE.md`
4. Agents can then retrieve specific docs on demand

The key instruction embedded tells agents to **prefer retrieval-led reasoning over pre-training-led reasoning**.

## Installation

```bash
# Using bun
bun add -D agentsmd-embed

# Using npm
npm install -D agentsmd-embed

# Or run directly with npx
npx agentsmd-embed
```

## CLI Usage

### Interactive Mode

```bash
npx agentsmd-embed
```

Prompts you to select a provider, version, and output file.

### Built-in Providers

```bash
# Next.js (auto-detects version from package.json)
npx agentsmd-embed --provider nextjs --output AGENTS.md

# With explicit version
npx agentsmd-embed --provider nextjs --fw-version 15.1.0 --output CLAUDE.md

# React
npx agentsmd-embed --provider react --fw-version 18.2.0 --output AGENTS.md

# Pixi (auto-detects from pixi.toml or installed version)
npx agentsmd-embed --provider pixi --output AGENTS.md

# Pixi with explicit version
npx agentsmd-embed --provider pixi --fw-version 0.63.2 --output AGENTS.md
```

### Custom GitHub Repository

```bash
npx agentsmd-embed --repo owner/repo --docs-path docs --fw-version v1.0.0 --output AGENTS.md
```

### Local Documentation

Build an index from an existing local docs directory:

```bash
npx agentsmd-embed local ./docs --name "My Framework" --output AGENTS.md
```

### List Available Providers

```bash
npx agentsmd-embed list
```

## Programmatic API

```typescript
import { embed, nextjsProvider, createProvider } from 'agentsmd-embed'

// Use built-in provider
const result = await embed({
  cwd: process.cwd(),
  provider: nextjsProvider,
  output: 'AGENTS.md'
})

// Create custom provider
const myProvider = createProvider({
  name: 'my-framework',
  displayName: 'My Framework',
  repo: 'myorg/myframework',
  docsPath: 'docs',
  packageName: 'my-framework', // for auto-detection
})

await embed({
  cwd: process.cwd(),
  provider: myProvider,
  version: '1.0.0',
  output: 'CLAUDE.md'
})
```

### Building Index Manually

```typescript
import {
  collectDocFiles,
  buildDocTree,
  generateIndex,
  injectIndex
} from 'agentsmd-embed'

// Collect doc files
const files = collectDocFiles('./docs', {
  extensions: ['.md', '.mdx']
})

// Build tree structure
const sections = buildDocTree(files)

// Generate compressed index
const index = generateIndex({
  docsPath: './docs',
  sections,
  providerName: 'My Docs',
  instruction: 'Use retrieval-led reasoning.'
})

// Inject into existing content
const newContent = injectIndex(existingContent, index)
```

## Output Format

The generated index uses a compressed pipe-delimited format:

```
[Next.js Docs Index]|root: ./.nextjs-docs|IMPORTANT: Prefer retrieval-led reasoning...|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx}|...
```

This format:
- Minimizes context window usage (~8KB for Next.js)
- Provides enough structure for agents to find relevant docs
- Includes instructions for retrieval-led reasoning
- Wraps in HTML comments for clean updates

## Available Providers

| Provider       | Status | Repository |
|----------------|--------|------------|
| Next.js        | ✓      | vercel/next.js |
| React          | ✓      | reactjs/react.dev |
| Pixi           | ✓      | prefix-dev/pixi |
| rattler-build  | ✓      | prefix-dev/rattler-build |
| Tauri          | ✓      | tauri-apps/tauri-docs |
| Vue            | ○      | Coming soon |
| Svelte         | ○      | Coming soon |
| Astro          | ○      | Coming soon |

## How It Works

1. **Detection**: Reads `package.json` to detect framework version
2. **Download**: Uses git sparse-checkout to fetch only docs folder
3. **Index**: Builds a tree of all doc files
4. **Compress**: Generates pipe-delimited format
5. **Inject**: Adds to AGENTS.md with markers for updates
6. **Gitignore**: Adds docs directory to .gitignore

## Contributing

Contributions welcome! To add a new provider:

1. Create `src/lib/providers/[name].ts`
2. Export provider from `src/lib/providers/index.ts`
3. Add to provider list in CLI

## License

MIT
