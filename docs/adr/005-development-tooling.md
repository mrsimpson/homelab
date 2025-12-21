# ADR 005: Development Tooling (Biome, Husky, lint-staged)

**Status:** Accepted
**Date:** 2025-12-21
**Deciders:** Project maintainers

## Context

Need automated code quality checks to prevent errors from being committed. TypeScript projects typically use:
- Linting (ESLint, oxlint, Biome)
- Formatting (Prettier, Biome)
- Git hooks (Husky, pre-commit)
- Staged file checking (lint-staged)

## Decision

Use **Biome** for linting and formatting, **Husky** for git hooks, **lint-staged** for efficient checking.

## Rationale

### Why Biome?

**All-in-One Tool:**
- Combines linting + formatting in single tool
- No ESLint + Prettier coordination issues
- Simpler configuration (one config file)

**Performance:**
- Written in Rust (50-100x faster than ESLint)
- Near-instant feedback
- Scales well as project grows

**TypeScript Native:**
- Excellent TypeScript support out of box
- No additional parser needed
- Type-aware linting

**Modern Features:**
- Auto-organize imports
- Auto-fix capabilities
- Clear error messages
- JSON/Markdown support

### Why Husky?

**Industry Standard:**
- Most popular git hooks solution
- Well-maintained, mature
- Works across all platforms

**Simple:**
- Easy to set up (`npm run prepare`)
- Hooks are shell scripts (transparent)
- No complex abstractions

**Integration:**
- Works seamlessly with lint-staged
- npm scripts integration
- CI/CD compatible

### Why lint-staged?

**Efficiency:**
- Only checks staged files (not entire project)
- Dramatically faster than checking all files
- Scales to large codebases

**Auto-Fix:**
- Runs commands with `--write`/`--fix` flags
- Re-stages fixed files automatically
- Developers see fixes immediately

**Flexible:**
- Configure per file type
- Multiple commands per file type
- Easy to customize

## Configuration

### Biome (biome.json)

```json
{
  "organizeImports": { "enabled": true },
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

### Husky Pre-commit

```bash
#!/usr/bin/env sh
npx lint-staged
```

### Husky Pre-push

```bash
#!/usr/bin/env sh
cd infrastructure && pulumi preview --non-interactive
```

### lint-staged

```js
module.exports = {
  "infrastructure/src/**/*.{ts,tsx}": [
    "biome check --write --organize-imports-enabled=true",
    "tsc --noEmit"
  ]
};
```

## Alternatives Considered

### ESLint + Prettier (Traditional)

**Pros:**
- Industry standard
- Huge plugin ecosystem
- Mature tooling

**Cons:**
- ❌ Two tools to configure and coordinate
- ❌ Slower (JavaScript-based)
- ❌ ESLint + Prettier conflicts require careful config
- ❌ More complex setup

**Verdict:** Biome simpler and faster for our use case

### oxlint + Prettier

**Pros:**
- Extremely fast (Rust)
- Prettier is standard

**Cons:**
- ❌ oxlint pre-1.0 (less stable)
- ❌ Still two tools (coordination needed)
- ❌ Fewer rules than ESLint/Biome
- ❌ Limited plugin ecosystem

**Verdict:** Biome more complete and mature

### Deno fmt/lint

**Pros:**
- Built into Deno runtime
- Very fast
- No config needed

**Cons:**
- ❌ Requires Deno (we use Node.js)
- ❌ Different runtime environment
- ❌ Less control over rules

**Verdict:** Not applicable (using Node.js)

### pre-commit (Python-based)

**Pros:**
- Language-agnostic
- Many pre-built hooks

**Cons:**
- ❌ Requires Python
- ❌ Less integrated with npm ecosystem
- ❌ Husky more standard in JS/TS projects

**Verdict:** Husky better fit for Node.js project

## Implementation

### Git Hooks

**Pre-commit:**
1. Run lint-staged on staged files
2. Auto-format code (Biome)
3. Auto-fix linting issues (Biome)
4. Organize imports
5. Type-check (TypeScript)
6. Block commit if errors

**Pre-push:**
1. Run Pulumi preview
2. Validate infrastructure changes
3. Block push if preview fails

### Workflow

```bash
# Developer commits
git add src/components/ExposedWebApp.ts
git commit -m "Add component"

# Automatically:
✓ Biome formats code
✓ Biome fixes lint issues
✓ Imports organized
✓ Types checked
✓ Files re-staged if modified

# Developer pushes
git push

# Automatically:
✓ Pulumi preview runs
✓ Infrastructure validated
```

## Trade-offs

### Accepted

**Biome ecosystem smaller than ESLint:**
- Fewer third-party plugins
- Some ESLint plugins not available
- **Mitigation:** Biome's built-in rules sufficient for our needs

**Husky requires npm install:**
- Pre-commit hooks not installed until `npm install`
- Fresh clones need setup
- **Mitigation:** Document in README, `prepare` script automates

**lint-staged only checks staged files:**
- Won't catch issues in unstaged code
- Developers can skip by not staging files
- **Mitigation:** CI runs full checks, pre-push validates infrastructure

### Benefits Outweigh Costs

**Developer experience:**
- ✅ Fast feedback (Biome speed)
- ✅ Auto-fix reduces manual work
- ✅ Consistent code style enforced
- ✅ Fewer merge conflicts (consistent formatting)

**Code quality:**
- ✅ Type errors caught before commit
- ✅ Linting violations caught before commit
- ✅ Infrastructure errors caught before push
- ✅ Cleaner git history

## Monitoring

### Success Metrics

- Pre-commit hooks running on all commits
- Zero unformatted code in Git
- Zero type errors in committed code
- All Pulumi previews pass before push

### Troubleshooting

Common issues:
- Hooks not running → Run `npm run prepare`
- Biome errors → Run `npm run lint:fix`
- Type errors → Run `npm run type-check`
- Slow checks → lint-staged only checks staged files (should be fast)

## Future Enhancements

- [ ] Add policy-as-code checks to pre-push
- [ ] Integrate with GitHub Actions (same checks in CI)
- [ ] Add commit message linting (commitlint)
- [ ] Add spell checking (cspell)

## References

- [Biome Documentation](https://biomejs.dev/)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/lint-staged/lint-staged)
- [Development Setup Guide](../howto/development-setup.md)
