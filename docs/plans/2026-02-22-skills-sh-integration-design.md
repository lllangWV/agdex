# skills.sh Integration Design

## Goal

Extend agdex's existing `skills` subcommand to integrate with the skills.sh ecosystem. Support both fetching skills from remote skills.sh-compatible repos and discovering locally installed skills.sh skills. Add interactive search with live autocomplete via the skills.sh public API.

## CLI Commands

### `agdex skills embed --repo <owner/repo>`

Fetch a skills.sh-compatible repo via git sparse-checkout, discover SKILL.md files, parse frontmatter (name + description only), and embed a metadata-only index into CLAUDE.md.

### `agdex skills find [query]`

New subcommand for skills.sh ecosystem search.

**Non-interactive** (`agdex skills find react`):
- Single API call to `https://skills.sh/api/search?q=react&limit=20`
- Display results as a table: name, source repo, install count
- Discovery only, no embedding

**Interactive** (`agdex skills find`):
- Text input with 300ms debounced API calls
- Results displayed as selectable list via `prompts`
- After selection: prompt for output file, fetch source repo, embed index

### GitHub repo flow fix

When a user enters a GitHub repo URL and agdex detects a `skills/` directory, replace the current "coming soon" message with actual clone + discover + embed.

## Remote Skills Fetching

Reuse the existing `pullDocs()` sparse-checkout infrastructure. Clone the repo, discover SKILL.md files in skills.sh standard locations (`skills/`, `.claude/skills/`, root SKILL.md, recursive fallback), parse YAML frontmatter, generate index.

**Cache**: `~/.cache/agdex/skills-sh/{owner}/{repo}/` following existing global cache pattern. Cache hit skips re-download.

## Index Format

Reuse existing skills index with new `skills-sh` source type:

```
<!-- AGENTS-MD-SKILLS-START -->
[Skills Index]|skills-sh:owner/repo:{skill1:description;skill2:description}|user:{...}|Regen: npx agdex skills embed
<!-- AGENTS-MD-SKILLS-END -->
```

## skills.sh API

Undocumented but stable public endpoint used by the official CLI:

```
GET https://skills.sh/api/search?q={query}&limit={n}
```

Response:
```json
{
  "query": "string",
  "searchType": "fuzzy",
  "skills": [
    {
      "id": "owner/repo/skillId",
      "skillId": "skill-name",
      "name": "skill-name",
      "installs": 5354,
      "source": "owner/repo"
    }
  ],
  "count": 5,
  "duration_ms": 17
}
```

Limitations: max limit ~50, no pagination, no description (must fetch SKILL.md for that), requires non-empty query.

## Type Changes

- Add `'skills-sh'` to `SkillSource` union: `'plugin' | 'user' | 'project' | 'skills-sh'`
- Add `SkillsShSearchResult` interface for API responses

## Files to Modify

1. **`src/lib/types.ts`** - Add `'skills-sh'` to `SkillSource`, add `SkillsShSearchResult` interface
2. **`src/lib/skills.ts`** - Add `fetchSkillsShSearch()`, `discoverRemoteSkills()`, update `generateSkillsIndex()` for new source type
3. **`src/cli/index.ts`** - Add `skills find` subcommand, add `--repo` to `skills embed`, fix GitHub repo skills flow

No new files. No new dependencies (uses native `fetch`, existing `prompts`, existing git sparse-checkout).
