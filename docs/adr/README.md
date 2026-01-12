# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records following [Michael Nygard's lightweight format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

## What is an ADR?

An Architecture Decision Record is a short text file that captures a single significant architectural decision and its rationale. ADRs help future developers (including yourself) understand **why** decisions were made, not just **what** was decided.

## When to Write an ADR

Write an ADR for decisions that are:
- **Architecturally significant** - Affects structure, dependencies, interfaces, or construction techniques
- **Hard to reverse** - Changing the decision later would be expensive or disruptive  
- **Non-obvious** - Someone might reasonably wonder "why did they choose this approach?"
- **Precedent-setting** - Establishes patterns for similar future decisions

**Examples:** Choice of programming language, database technology, deployment strategy, authentication approach, testing framework.

## ADR Format

Use this exact structure for all ADRs:

```markdown
# ADR XXX: [Short Noun Phrase Title]

## Status

[Proposed | Accepted | Implemented | Superseded by ADR-YYY | Deprecated]

## Context

[Describe the forces at play - technological, political, social, and project constraints. 
Be factual and value-neutral. Explain why this decision needs to be made.]

## Decision

[State the decision in full sentences with active voice. "We will..."]

## Consequences

### Positive
- [List positive outcomes]

### Negative  
- [List negative outcomes and risks]

### Neutral
- [List trade-offs and considerations that are neither clearly positive nor negative]
```

## Writing Guidelines

### Keep It Concise
- **Target length: 1-2 pages maximum**
- Focus on the decision, not implementation details
- If you find yourself writing implementation steps, stop - that belongs in separate documentation

### Write for Future Developers
- Assume the reader understands the technical domain but not your specific context
- Explain **why**, not just **what**
- Include enough context that someone can understand the decision 6 months later

### Be Honest About Trade-offs
- List both positive AND negative consequences
- Don't oversell your decision - acknowledge its downsides
- Include neutral trade-offs that aren't clearly good or bad

### Use Value-Neutral Language in Context
- State facts objectively without bias toward any particular solution
- Save advocacy for the Decision and Consequences sections
- Let the forces speak for themselves

## What NOT to Include

❌ **Implementation Details** - Step-by-step procedures, code examples, configuration snippets
❌ **Project Management** - Timeline, milestones, success criteria, migration plans  
❌ **Progress Tracking** - Status updates, completion percentages, implementation notes
❌ **Troubleshooting Guides** - Error resolution, debugging procedures
❌ **Extensive Alternatives Analysis** - Detailed pros/cons tables (summarize instead)

## Status Guidelines

- **Proposed** - Decision drafted but not yet agreed upon
- **Accepted** - Decision agreed upon but not yet implemented  
- **Implemented** - Decision fully implemented and operational
- **Superseded by ADR-XXX** - Decision replaced by a newer ADR
- **Deprecated** - Decision no longer valid but kept for historical context

Update status as implementation progresses. Be honest about partial implementations.

## Numbering Convention

- Use sequential numbers: `ADR 001`, `ADR 002`, etc.
- Never reuse numbers, even for superseded ADRs
- Pad with leading zeros for consistent sorting

## File Naming

Format: `NNN-short-title.md`

Examples:
- `001-pulumi-over-yaml.md`
- `002-cloudflare-tunnel-exposure.md`
- `012-gateway-api-implementation-selection.md`

## Example ADR

See `001-pulumi-over-yaml.md` for a good example that follows this format correctly.

## Anti-Patterns to Avoid

### ❌ The Implementation Guide
```markdown
## Decision
Use Docker for containerization.

## Implementation Steps
1. Install Docker Desktop
2. Create Dockerfile with these contents: [50 lines of code]
3. Set up CI/CD pipeline with these commands: [...]
```

### ✅ The Proper ADR
```markdown
## Decision  
We will use Docker for application containerization.

## Consequences
### Positive
- Consistent environments across development and production
- Simplified deployment through container orchestration
- Better resource isolation and utilization

### Negative  
- Additional complexity in local development setup
- Learning curve for team members unfamiliar with containers
```

## Questions?

If you're unsure whether something should be an ADR or how to structure it, ask yourself:
1. Will someone wonder "why did we do this?" in 6 months?
2. Am I documenting a decision or an implementation?
3. Can I explain this in 1-2 pages or do I need a manual?

When in doubt, write the ADR. It's easier to have too many than to lose the context of important decisions.