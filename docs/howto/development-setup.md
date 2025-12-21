# Development Setup

## Goal

Set up your local development environment with automated code quality checks.

## Prerequisites

- Node.js 24+ installed
- Git installed

## Initial Setup

### 1. Install Dependencies

```bash
cd homelab/infrastructure
npm install
```

This installs:
- **Biome** - Linting + formatting
- **TypeScript** - Type checking
- **Husky** - Git hooks
- **lint-staged** - Run checks only on changed files
- **Pulumi packages** - Infrastructure SDKs

### 2. Initialize Git Hooks

```bash
npm run prepare
```

This sets up:
- **Pre-commit hook** - Auto-format, lint, type-check
- **Pre-push hook** - Run Pulumi preview

## What Gets Checked Automatically

### On Every Commit (Pre-commit)

The following runs automatically on staged files:

1. **Biome Format** - Auto-formats code
2. **Biome Lint** - Checks code quality
3. **Import Organization** - Sorts imports alphabetically
4. **TypeScript Type Check** - Validates types

**Example:**
```bash
$ git commit -m "Add blog component"

✔ Preparing lint-staged...
✔ Running tasks for staged files...
  ✔ infrastructure/src/**/*.{ts,tsx} — 2 files
    ✔ biome check --write --organize-imports-enabled=true
    ✔ tsc --noEmit
✔ Applying modifications from tasks...
✔ Cleaning up temporary files...

[main abc123] Add blog component
 1 file changed, 50 insertions(+)
```

If errors are found, commit is **blocked** until fixed.

### On Every Push (Pre-push)

Before pushing to remote:

1. **Pulumi Preview** - Validates infrastructure changes

**Example:**
```bash
$ git push

🔍 Running Pulumi preview...
Previewing update (dev):
  + 6 resources to create

Resources:
  + 6 to create
  38 unchanged

✅ Pulumi preview passed
```

If preview fails, push is **blocked**.

## Manual Commands

### Format Code

```bash
# Check formatting
npm run format

# Auto-fix formatting
biome format --write src/
```

### Lint Code

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### Type Check

```bash
# Check types without building
npm run type-check

# Build TypeScript
npm run build
```

### Pulumi Operations

```bash
# Preview changes
npm run preview

# Deploy infrastructure
npm run up

# Destroy infrastructure
npm run destroy
```

## Biome Configuration

Located in `infrastructure/biome.json`:

```json
{
  "organizeImports": {
    "enabled": true  // Auto-sort imports
  },
  "formatter": {
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "warn",
        "noConsoleLog": "warn"
      }
    }
  }
}
```

### Key Rules

- **No `any` types** - Use specific types
- **No `console.log`** - Use proper logging
- **Use `const`** - Instead of `let` where possible
- **Template literals** - Use `` `${var}` `` instead of `"" + var`

## TypeScript Configuration

Located in `infrastructure/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

**Strict mode catches:**
- Implicit `any` types
- Null/undefined issues
- Unused variables
- Missing return statements

## Skipping Hooks (Emergency Only)

### Skip pre-commit

```bash
git commit --no-verify -m "Emergency fix"
```

### Skip pre-push

```bash
git push --no-verify
```

**⚠️ Only use in emergencies!** Skipping checks defeats the purpose.

## Troubleshooting

### Hooks Not Running

```bash
# Reinstall hooks
rm -rf .husky
npm run prepare
```

### Biome Errors

```bash
# Show detailed errors
biome check --verbose src/

# Check specific file
biome check src/index.ts
```

### TypeScript Errors

```bash
# Show detailed type errors
tsc --noEmit --pretty

# Check specific file
tsc --noEmit src/components/ExposedWebApp.ts
```

### Pulumi Preview Fails in Pre-push

```bash
# Run preview manually to see full output
cd infrastructure
pulumi preview

# Skip pre-push hook if needed (not recommended)
git push --no-verify
```

## IDE Integration

### VS Code

Install extensions:
- **Biome** (biomejs.biome)
- **Pulumi** (pulumi.pulumi-lsp-client)

Add to `.vscode/settings.json`:
```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "[typescript]": {
    "editor.defaultFormatter": "biomejs.biome"
  }
}
```

### JetBrains IDEs (WebStorm, IntelliJ)

1. Install Biome plugin
2. Enable "Reformat code" on save
3. Enable "Optimize imports" on save

## Best Practices

### Before Committing

1. Run manual checks:
   ```bash
   npm run type-check
   npm run lint
   ```

2. Test locally:
   ```bash
   npm run build
   ```

3. Commit (hooks run automatically)

### Before Pushing

1. Ensure preview passes:
   ```bash
   npm run preview
   ```

2. Review changes carefully

3. Push (pre-push hook validates)

### During Development

- **Write types** - Don't use `any`
- **Fix warnings** - Don't ignore linter warnings
- **Organize imports** - Biome does this automatically
- **Format regularly** - Or enable format-on-save in IDE

## Continuous Integration (Future)

When setting up GitHub Actions:

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run preview
```

This runs the same checks as local hooks on every PR.

## Summary

**Automated checks prevent:**
- ✅ Committing unformatted code
- ✅ Committing code with type errors
- ✅ Committing code with lint violations
- ✅ Pushing infrastructure that fails preview

**Result:** Clean, consistent, error-free codebase
