# Contributing

## Setup

### Clone and install

```sh
git clone https://github.com/sheepbun/yips.git
cd yips
```

```sh
npm install
```

### Build

```sh
npm run build
```

### Run in development mode

```sh
npm run dev
```

### Run tests

```sh
npm test
```

## Branch Strategy

- `main` — stable branch, always builds and passes tests
- Feature branches — created from `main`, named descriptively: `feat/model-manager`, `fix/streaming-crash`, `refactor/context-loader`
- Merge via pull request with at least one review

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add model download progress bar
fix: correct streaming token buffer overflow
refactor: extract context loading into separate module
docs: update roadmap with Milestone 2 items
chore: update dependencies
test: add unit tests for tool request parser
```

- Use imperative mood in the subject line ("add", not "added" or "adds")
- Keep the subject line under 72 characters
- Use the body for context when the change is not self-explanatory

## Code Standards

### TypeScript

- **Strict mode**: `strict: true` in `tsconfig.json`. No exceptions.
- **No implicit any**: Every variable, parameter, and return type must be explicitly typed or inferable.
- **No `any` type**: Use `unknown` when the type is genuinely unknown, then narrow with type guards.
- **Named exports only**: No default exports. This makes imports grep-able and refactor-friendly.
- **Prefer `const`**: Use `const` by default. Use `let` only when reassignment is necessary. Never use `var`.

### Formatting

Prettier is the project formatter.

Run the formatter before committing:

```sh
npm run format
```

The CI pipeline will fail if formatting is inconsistent.

### Linting

ESLint with `@typescript-eslint` is used for TypeScript linting.

```sh
npm run lint
```

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes, keeping commits atomic and well-described
3. Run the full check suite locally:
   ```sh
   npm run lint && npm run typecheck && npm test
   ```
4. Push your branch and open a pull request
5. Fill in the PR template: describe the change, link related issues, note any breaking changes
6. Address review feedback
7. Merge once approved

## Issue Reporting

Open an issue at [github.com/sheepbun/yips/issues](https://github.com/sheepbun/yips/issues) with:

- **Bug reports**: Steps to reproduce, expected behavior, actual behavior, system info (OS, Node.js version, GPU)
- **Feature requests**: Use case, proposed behavior, alternatives considered
- **Questions**: Check existing docs and issues first

## Project Structure

See [Architecture](./architecture.md) for system design and [Rewrite Guide](./rewrite.md) for how the codebase maps to yips-cli.

---

> Last updated: 2026-02-22
