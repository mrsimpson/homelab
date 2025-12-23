module.exports = {
  // TypeScript files: format, lint, organize imports, type-check
  "infrastructure/src/**/*.{ts,tsx}": [
    "cd infrastructure && npx biome check --write --organize-imports-enabled=true --no-errors-on-unmatched",
    "cd infrastructure && npx tsc --noEmit --pretty"
  ],

  // JSON files: format
  "infrastructure/**/*.json": [
    "cd infrastructure && npx biome format --write --no-errors-on-unmatched"
  ],

  // Markdown files: skip formatting (biome not configured for markdown)
  "**/*.md": []
};
