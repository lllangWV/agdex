#!/usr/bin/env bash
set -euo pipefail

echo "=== agdex publish ==="
echo ""

# 1. Run tests
echo "Running tests..."
bun test
echo ""
echo "Tests passed."
echo ""

# 2. Build
echo "Building..."
bun run build
echo ""
echo "Build succeeded."
echo ""

# 3. Show current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"
echo ""

# 4. Prompt for version bump
echo "Select version bump:"
echo "  1) patch"
echo "  2) minor"
echo "  3) major"
echo "  4) no change (publish as $CURRENT_VERSION)"
echo ""
read -rp "Choice [1-4]: " CHOICE

case "$CHOICE" in
  1) BUMP="patch" ;;
  2) BUMP="minor" ;;
  3) BUMP="major" ;;
  4) BUMP="" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

if [ -n "$BUMP" ]; then
  # Update version without creating a git tag
  npm version "$BUMP" --no-git-tag-version
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo ""
  echo "Version bumped: $CURRENT_VERSION -> $NEW_VERSION"

  # 5. Rebuild with updated version
  echo ""
  echo "Rebuilding with new version..."
  bun run build
  echo ""
  echo "Rebuild succeeded."
else
  NEW_VERSION="$CURRENT_VERSION"
  echo ""
  echo "Keeping version $NEW_VERSION"
fi

# 6. Commit, tag, and push
if [ -n "$BUMP" ]; then
  echo ""
  echo "Committing and tagging v$NEW_VERSION..."
  git add package.json
  git commit -m "v$NEW_VERSION"
  git tag "v$NEW_VERSION"

  echo ""
  echo "Pushing..."
  git push && git push --tags
fi

# 7. Publish to npm
echo ""
read -rp "Publish v$NEW_VERSION to npm? [y/N]: " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
  npm publish
  echo ""
  echo "Published agdex@$NEW_VERSION"
else
  echo "Publish skipped."
fi
