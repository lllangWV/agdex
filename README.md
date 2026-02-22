# agdex

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
bun add -D agdex

# Using npm
npm install -D agdex

# Or run directly with npx
npx agdex
```

## Configuration

You can configure agdex defaults using either `.agdexrc.json` or the `agdex` field in `package.json`.

### Using .agdexrc.json

Create a `.agdexrc.json` file in your project root:

```json
{
  "output": "CLAUDE.md"
}
```

### Using package.json

Add an `agdex` field to your `package.json`:

```json
{
  "name": "my-project",
  "agdex": {
    "output": "CLAUDE.md"
  }
}
```

**Note:** `.agdexrc.json` takes priority over `package.json` if both are present.

### Configuration Options

| Option   | Type   | Default     | Description |
|----------|--------|-------------|-------------|
| `output` | string | `CLAUDE.md` | Default output file for indexes |

## CLI Usage

### Interactive Mode

```bash
npx agdex
```

Prompts you with options to:
- Use a detected provider (if one is found in your project)
- Select a built-in provider
- Enter a GitHub repository URL or `owner/repo`
- Index a local directory
- Index Claude Code skills

When entering a GitHub URL, you can use various formats:
- `owner/repo` - indexes the detected docs directory
- `https://github.com/owner/repo` - same as above
- `https://github.com/owner/repo/tree/main/docs` - indexes a specific path

### Built-in Providers

```bash
# Next.js (auto-detects version from package.json)
npx agdex --provider nextjs --output AGENTS.md

# With explicit version
npx agdex --provider nextjs --fw-version 15.1.0 --output CLAUDE.md

# React
npx agdex --provider react --fw-version 18.2.0 --output AGENTS.md

# Pixi (auto-detects from pixi.toml or installed version)
npx agdex --provider pixi --output AGENTS.md

# Pixi with explicit version
npx agdex --provider pixi --fw-version 0.63.2 --output AGENTS.md

# Bun (auto-detects from bun.lockb or bunfig.toml)
npx agdex --provider bun --output AGENTS.md

# Add custom description to the index
npx agdex --provider nextjs --description "Project uses App Router only"
```

**Options:**
```bash
-p, --provider <name>     Documentation provider (nextjs, react, etc.)
--fw-version <version>    Framework version (auto-detected if not provided)
-o, --output <file>       Target file (default: from config or CLAUDE.md)
-d, --description <text>  Additional description to include in the index
-g, --global              Use global cache ~/.cache/agdex/ (default)
-l, --local               Use local .agdex/ instead
```

### Custom GitHub Repository

```bash
npx agdex --repo owner/repo --docs-path docs --fw-version v1.0.0 --output AGENTS.md
```

### Local Documentation

Build an index from an existing local docs directory:

```bash
npx agdex local ./docs --name "My Framework" --output AGENTS.md
```

### Skills Indexing

Index Claude Code skills from your `.claude` directories, enabled plugins, and remote [skills.sh](https://skills.sh) repositories:

```bash
# Index skills (auto-detects from all sources)
npx agdex skills embed

# Index from a skills.sh-compatible GitHub repo
npx agdex skills embed --repo owner/repo

# List discovered skills
npx agdex skills list

# Index from a specific local path
npx agdex skills local ./my-skills --name "My Skills"

# Search skills.sh for community skills
npx agdex skills find "debugging"

# Search with a result limit
npx agdex skills find "frontend" --limit 10
```

**Auto-detection sources:**
- **Enabled plugins** - Reads `~/.claude/settings.json` and `.claude/settings.json` to find enabled plugins, then indexes their skills from the plugin cache
- **User skills** - `~/.claude/skills` (shared across projects)
- **Project skills** - `.claude/skills` (project-specific)
- **Remote repos** - Any GitHub repo with skills in standard locations (`skills/`, `.claude/skills/`, `.agents/skills/`)

**Options for `skills embed`:**
```bash
--plugins       Include enabled plugins from settings.json (default: true)
--no-plugins    Exclude enabled plugins
--user          Include ~/.claude/skills (default: true)
--no-user       Exclude ~/.claude/skills
--project       Include .claude/skills (default: true)
--no-project    Exclude .claude/skills
--plugin <path> Additional plugin repo paths (with plugins/ structure)
--repo <owner/repo>  Fetch and index from a skills.sh-compatible GitHub repo
-o, --output    Target file (default: AGENTS.md)
```

**Options for `skills find`:**
```bash
-l, --limit <n>   Max results (default: 20)
-o, --output       Target file for embedding
```

Running `skills find` without a query argument launches interactive mode, where you can search and immediately embed a selected result.

Skills are discovered by looking for `SKILL.md` files with YAML frontmatter:
```yaml
---
name: My Skill
description: What this skill does
---
```

The index includes skill names, descriptions, and all sibling files (recursively).

### Removing Indexes

Remove embedded indexes interactively or by flag:

```bash
# Interactive mode - select which indexes to remove
npx agdex remove

# Remove a specific provider's docs index
npx agdex remove --provider nextjs

# Remove only docs or skills indexes
npx agdex remove --docs
npx agdex remove --skills
```

### List Available Providers

```bash
npx agdex list
```

## Programmatic API

```typescript
import { embed, nextjsProvider, createProvider } from 'agdex'

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
} from 'agdex'

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
| conda-forge    | ✓      | conda-forge/conda-forge.github.io |
| CUDA Feedstock | ✓      | conda-forge/cuda-feedstock |
| Bun            | ✓      | oven-sh/bun |
| Svelte         | ✓      | sveltejs/svelte |
| SvelteKit      | ✓      | sveltejs/kit |
| shadcn-svelte  | ✓      | huntabyte/shadcn-svelte |
| Tailwind CSS   | ✓      | tailwindlabs/tailwindcss.com |
| Ruff           | ✓      | astral-sh/ruff |
| ty             | ✓      | astral-sh/ty |
| basedpyright   | ✓      | DetachHead/basedpyright |
| Convex         | ✓      | get-convex/convex-backend |
| Polars         | ✓      | pola-rs/polars |
| delta-rs       | ✓      | delta-io/delta-rs |
| Obsidian       | ✓      | obsidianmd/obsidian-developer-docs |
| Obsidian Excalidraw | ✓ | zsviczian/obsidian-excalidraw-plugin |
| FFmpeg         | ✓      | FFmpeg/FFmpeg |
| Manim          | ✓      | ManimCommunity/manim |

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
