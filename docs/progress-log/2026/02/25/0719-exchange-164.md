## 2026-02-25 07:19 MST — Exchange 164

Summary: Implemented scoped npm release pivot (`@sheepbun/yips`) with package/version updates, metadata-driven `/update` registry lookup, dual-path upgrade guidance, and docs/test alignment.
Changed:

- Scoped package/version updates:
  - updated `package.json` name to `@sheepbun/yips` and bumped version to `0.1.1`
  - updated lock metadata in `package-lock.json` to match scoped package/version
- Update-check behavior hardening:
  - `src/app/update-check.ts` now resolves default npm package name from local `package.json` metadata instead of hardcoded `yips`
  - retained explicit `UpdateCheckOptions.packageName` override behavior
- `/update` guidance updates:
  - updated `src/agent/commands/commands.ts` output to prefer canonical scoped install command
  - added legacy/unscoped caveat line (`yips` may be unavailable)
- Tests:
  - expanded `tests/app/update-check.test.ts` to verify default scoped package lookup URL encoding
  - updated `/update` command assertions in `tests/agent/commands/commands.test.ts` for scoped command + legacy caveat text
- Docs/changelog updates:
  - `docs/guides/getting-started.md` now uses scoped install commands and includes unscoped availability caveat
  - `docs/guides/slash-commands.md` `/update` guidance updated for scoped canonical command + dual-path note
  - `docs/stack.md` distribution section now references scoped npm package decision
  - `docs/changelog.md` updated with scoped release pivot notes

Validation:

- `npm run typecheck` — clean
- `npm test` — clean (50 files, 400 tests)
- `npm run build` — clean
- `npm publish --access public --dry-run` — clean for `@sheepbun/yips@0.1.1` (tarball generated, scoped metadata verified)

Next:

- Run real publish for scoped package (`npm publish --access public`) with a valid npm auth token/session, then push `v0.1.1` to trigger release workflow and verify GitHub Release + npm publish automation end-to-end.
