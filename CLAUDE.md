# Repository Guidelines

## Project Structure
- `src/`: application source (`index.ts`, `repl.ts`, config/types modules)
- `tests/`: Vitest test suite (`*.test.ts`)
- `.github/workflows/`: CI workflows
- `docs/`: documentation (`README.md`, `guides/`, architecture, stack, roadmap, changelog)
- `docs/progress-log.md`: rolling implementation handoff log between exchanges

Use kebab-case for new Markdown filenames and keep links relative.

## Commands
- `npm install` — install dependencies
- `npm run dev` — run the Milestone 0 REPL from TypeScript source
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run compiled output from `dist/`
- `npm run typecheck` — strict TypeScript type check
- `npm test` — run Vitest tests
- `npm run lint` — run ESLint on TypeScript files
- `npm run format` / `npm run format:check` — format or verify formatting

## Coding Style
- TypeScript: strict mode, no `any`, named exports only, prefer `const`, use formatter/linter defaults
- Docs: short task-focused sections, descriptive headings, bullet lists, fenced code blocks with language tags

## Testing
- Code changes: `*.test.ts` naming, run `npm test` and `npm run typecheck`, include regression tests for bug fixes
- Docs changes: verify links and snippets manually, run markdown lint/format checks when available

## Commits
Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Imperative mood, subjects under 72 characters.

## Exchange Continuity
- Start each exchange by reading `docs/progress-log.md`
- End each exchange by appending changes made, verification run, and next step
