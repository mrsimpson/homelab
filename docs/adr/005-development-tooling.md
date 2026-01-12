# ADR 005: Development Tooling (Biome, Husky, lint-staged)

## Status

Implemented

## Context

We need automated code quality checks to prevent errors from being committed to version control. TypeScript projects typically require linting (for code quality), formatting (for consistency), git hooks (for automation), and staged file checking (for efficiency).

The tooling landscape offers several options: ESLint + Prettier for traditional linting/formatting, newer all-in-one tools like Biome, and various git hook solutions like Husky or pre-commit.

We need a solution that provides fast feedback, handles TypeScript well, and integrates smoothly with our development workflow.

## Decision

We will use Biome for linting and formatting, Husky for git hooks, and lint-staged for efficient checking of only changed files.

This combination provides all-in-one linting/formatting, fast performance, and automated enforcement via pre-commit hooks.

## Consequences

### Positive

- **Fast feedback** - Biome's Rust implementation provides near-instant linting and formatting
- **Simplified toolchain** - Single tool (Biome) replaces ESLint + Prettier configuration coordination
- **Automated enforcement** - Husky pre-commit hooks prevent bad code from being committed
- **Efficient processing** - lint-staged only checks modified files, not entire codebase
- **TypeScript native** - Excellent TypeScript support without additional parser configuration
- **Modern features** - Auto-organize imports, auto-fix capabilities, and clear error messages
- **Industry adoption** - Well-supported tools with active communities

### Negative

- **Tool learning** - Team needs to learn Biome-specific configuration and rules
- **Migration effort** - Moving from existing ESLint/Prettier setups requires configuration translation
- **Git hook complexity** - Failed pre-commit hooks can be confusing for developers unfamiliar with the setup
- **Biome maturity** - Newer tool than ESLint/Prettier, may have edge cases or missing features
- **Hook bypassing** - Developers can use `--no-verify` to skip checks (requires team discipline)

### Neutral

- **Configuration maintenance** - Biome configuration needs periodic updates and team consensus on rules
- **Performance trade-off** - Very fast individual runs, but pre-commit hooks add time to git workflow
- **Editor integration** - Requires configuring editor plugins for optimal development experience