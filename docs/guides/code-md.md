# CODE.md Guide

## What CODE.md Is

`CODE.md` is a project brief for the AI agent. Place it in a repository's root directory, and Yips loads it into the Conductor's system prompt at the start of every session run from that directory.

It tells the agent what the project is, what tools and conventions it uses, and how the codebase is organized — so you do not have to repeat this context in every conversation.

## Format

CODE.md is a plain markdown file. Use headers to organize sections. The agent parses it as free-form text, not a schema, so the exact format is flexible. The following sections are recommended.

### Required Sections

These give the agent enough context to be useful immediately.

#### Project Name and Description

```markdown
# MyProject

A REST API for managing inventory, built with Express and PostgreSQL.
```

#### Tech Stack

```markdown
## Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database**: PostgreSQL 16 with Drizzle ORM
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest
- **Package manager**: pnpm
```

#### Directory Structure

```markdown
## Structure

```
src/
├── routes/         # Express route handlers
├── services/       # Business logic
├── db/
│   ├── schema.ts   # Drizzle schema definitions
│   └── migrate.ts  # Migration runner
├── middleware/      # Auth, validation, error handling
└── index.ts        # Entry point
tests/              # Vitest test files, mirrors src/ structure
```
```

### Recommended Sections

These help the agent follow your project's specific conventions.

#### Conventions

```markdown
## Conventions

- Use `snake_case` for database columns, `camelCase` for TypeScript
- All route handlers return `{ data, error, status }` response shape
- Errors are thrown as `AppError` instances, caught by error middleware
- No default exports — use named exports everywhere
```

#### Build and Run Commands

```markdown
## Commands

- `pnpm dev` — start dev server with hot reload
- `pnpm build` — compile TypeScript
- `pnpm test` — run test suite
- `pnpm db:migrate` — apply pending migrations
- `pnpm db:generate` — generate migration from schema changes
```

#### Architecture Decisions

```markdown
## Architecture Decisions

- **No ORM query builder in route handlers**: routes call service functions, services use Drizzle
- **Migrations are code-generated**: never write migration SQL by hand
- **Auth is middleware-only**: no auth checks inside service functions
```

## Example CODE.md

```markdown
# inventory-api

REST API for warehouse inventory management.

## Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database**: PostgreSQL 16, Drizzle ORM
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest
- **Package manager**: pnpm

## Structure

```
src/
├── routes/         # Express route handlers
├── services/       # Business logic
├── db/
│   ├── schema.ts   # Drizzle schema
│   └── migrate.ts  # Migration runner
├── middleware/      # Auth, validation, error handling
└── index.ts        # Entry point
tests/              # Mirrors src/ structure
```

## Conventions

- snake_case for DB columns, camelCase for TypeScript
- Route handlers return { data, error, status }
- Named exports only (no default exports)
- Errors thrown as AppError, caught by error middleware

## Commands

- `pnpm dev` — dev server
- `pnpm test` — run tests
- `pnpm build` — compile
- `pnpm db:migrate` — apply migrations
```

## How Yips Uses It

When the Conductor assembles its system prompt, it looks for `CODE.md` in the current working directory (and optionally in parent directories). If found, the file's contents are injected into the context alongside the soul document, memory, and system information.

This means the agent:

- Knows your project's stack without being told each session
- Follows your naming conventions when writing code
- Uses the correct build and test commands
- Understands your directory layout when navigating files

The context loading pattern follows the same approach as yips-cli's `AgentContextMixin.load_context()`, which assembles the system prompt from multiple document sources. CODE.md is a new source added in the TypeScript rewrite.

## Tips

- **Keep it concise**: The agent's context window is finite. A 50-line CODE.md is better than a 500-line one. Focus on what the agent needs to know to write correct code.
- **Update it as the project evolves**: If you add a new database, change frameworks, or adopt new conventions, update CODE.md.
- **One per project**: Place CODE.md at the repository root. If you have a monorepo, consider one CODE.md per workspace/package.

---

> Last updated: 2026-02-22
