# Lockfile-first index maintenance

agdex will use `.agdex/agdex.lock` as the primary structured, unversioned record for `status` and `refresh`, while still reconciling against actual agent instruction files and documentation caches. Lockfile entries use stable index identities based on kind, source name, and target agent instruction file, with project-local cache paths stored relative to the project root and global or absolute cache paths stored absolutely. Refresh behavior is driven by structured metadata, not stored command text, although a display command may be recorded for diagnostics. Plain `status` remains read-only; migration from older embedded markers happens through an explicit migration workflow. Plain `refresh` refreshes all lockfile-backed indexes, while repair-oriented workflows are explicitly health-driven. Embedded index markers remain a fallback for pre-lockfile projects, because parsing human-readable regeneration text is not a stable long-term contract.

The first lockfile schema supports only the source types already exposed by the CLI: built-in providers, arbitrary GitHub documentation paths, local documentation directories, scraped documentation URLs, local or plugin skills, and skills.sh-compatible repositories.

Index maintenance operations must be surgical: they may replace or remove only the targeted agdex marker block and must preserve surrounding manually written agent instruction content.

Refresh reuses existing documentation caches by default and only refetches upstream sources when forced. Built-in provider entries record whether their version was auto-detected or pinned; auto-detected entries re-detect the project version on refresh, while pinned entries keep their recorded version.
