# Repository Guidelines

## Project Structure & Module Organization
The repository now includes a TypeScript Milestone 0 bootstrap and project docs.

- `src/`: application source (`index.ts`, `repl.ts`, config/types modules).
- `tests/`: Vitest test suite (`*.test.ts`).
- `.github/workflows/`: CI workflows.
- `docs/README.md`: documentation entry point and map.
- `docs/guides/`: task-oriented guides (`getting-started`, `hooks`, `slash-commands`, etc.).
- `docs/architecture.md`, `docs/stack.md`, `docs/rewrite.md`, `docs/roadmap.md`: system design and planning.
- `docs/changelog.md`: project history in Keep a Changelog format.
- `docs/progress-log.md`: rolling implementation handoff log between exchanges.

Use kebab-case for new Markdown filenames (for example, `model-manager.md`), and keep links relative (for example, `./guides/getting-started.md`).

## Build, Test, and Development Commands
Use these commands for day-to-day development:

- `npm install`: install dependencies.
- `npm run dev`: run the Milestone 0 REPL from TypeScript source.
- `npm run build`: compile TypeScript to `dist/`.
- `npm start`: run compiled output from `dist/`.
- `npm run typecheck`: strict TypeScript type check.
- `npm test`: run Vitest tests.
- `npm run lint`: run ESLint on TypeScript files.
- `npm run format` / `npm run format:check`: format or verify formatting.

For docs-focused work, these quick commands remain useful:

- `rg --files docs`: list documentation files quickly.
- `rg "TODO|FIXME" docs`: find unresolved notes before submitting.
- `npx markdownlint-cli2 "docs/**/*.md"`: optional Markdown lint pass.
- `npx prettier --check "docs/**/*.md"`: optional formatting check.

## Coding Style & Naming Conventions
For documentation:

- Keep sections short, specific, and task-focused.
- Prefer descriptive headings and bullet lists over long paragraphs.
- Use fenced code blocks with a language tag (`sh`, `ts`, etc.) when possible.

For TypeScript code: strict mode enabled, no `any`, named exports only, prefer `const`, and use formatter/linter defaults.

## Testing Guidelines
For docs-only changes:

- Verify links and command snippets manually.
- Run Markdown lint/format checks when available.

For code changes:

- Follow `*.test.ts` naming and run `npm test`.
- Run `npm run typecheck` for strict typing validation.
- Include regression tests for bug fixes.

## Commit & Pull Request Guidelines
Follow Conventional Commits:

- `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `chore: ...`
- Use imperative mood and keep subjects under 72 characters.

Branch naming should be descriptive, such as `feat/model-manager` or `fix/streaming-crash`.

PRs should include:

- Clear summary of what changed and why.
- Linked issue(s) when applicable.
- Notes on breaking changes or follow-up work.
- Local verification performed (for example lint/tests run).

## Exchange Continuity
To preserve context between exchanges:

- Start each new exchange by reading `docs/progress-log.md`.
- End each exchange by appending a new entry to `docs/progress-log.md` with changes made, verification run, and next step.
