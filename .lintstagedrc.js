module.exports = {
  // TypeScript files: format, lint, organize imports, type-check
  "infrastructure/src/**/*.{ts,tsx}": [
    "biome check --write --organize-imports-enabled=true --no-errors-on-unmatched",
    "tsc --noEmit --pretty"
  ],

  // JSON files: format
  "infrastructure/**/*.json": [
    "biome format --write --no-errors-on-unmatched"
  ],

  // Markdown files: format
  "**/*.md": [
    "biome format --write --no-errors-on-unmatched"
  ]
};
