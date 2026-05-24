# Glossary

## Agent instruction file

A Markdown file read by a coding agent to understand project-specific behavior, conventions, and local context.

## Local overlay

An unversioned agent instruction file that contains machine-specific generated content, such as documentation indexes pointing at local cache paths.

## Documentation cache

A generated copy of external documentation used as source material for an embedded documentation index. It is reproducible and should not be treated as project source.

## Index maintenance

The lifecycle of an embedded documentation or skills index after it has been created, including inspecting whether it is present, whether its documentation cache is available, and whether it needs to be regenerated.

## Index health

The observed condition of an index during index maintenance, based on agreement or drift between the index lockfile, the target agent instruction file, the embedded marker, and the documentation cache.

## Index lockfile

A structured project-local, unversioned record of last-known-good indexes created by agdex, including each index's source, version or reference, target agent instruction file, and documentation cache location. It supports index maintenance but does not replace checking the actual agent instruction files and documentation caches.
