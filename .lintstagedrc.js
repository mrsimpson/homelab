module.exports = {
  // TypeScript files: format, lint, organize imports, type-check
  "src/**/*.{ts,tsx}": [
    "npx biome check --write --organize-imports-enabled=true --no-errors-on-unmatched",
    "npx tsc --noEmit --pretty"
  ],

  // Markdown files: skip formatting (biome not configured for markdown)
  "**/*.md": []
};
