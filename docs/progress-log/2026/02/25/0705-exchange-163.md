## 2026-02-25 07:05 MST — Exchange 163

Summary: Isolated npm publish failure root cause for unscoped `yips` by forcing token-based auth path; registry now returns a package-name policy rejection.
Changed:

- Verified auth/token state and publish capability inputs:
  - `npm whoami` resolves to `sheepbun`.
  - `npm token list --json` confirms active token has `package:write` and `bypass_2fa: true`.
  - `npm profile get --json` confirms account-level `tfa: false`.
- Forced explicit token auth via temporary user config (`NPM_CONFIG_USERCONFIG=/tmp/npm-publishrc` + `NODE_AUTH_TOKEN`) to remove ambient npm auth ambiguity.
- Re-ran publish with forced token path and captured definitive registry response:
  - `E403`: package name `yips` rejected as too similar to existing packages.
  - npm response guidance suggests scoped fallback (`@sheepbun/yips`) for successful publish.
- User chose to keep unscoped path and proceed via npm support exception request.

Validation:

- `npx -y npm@10 --version` — `10.9.4`
- `npx -y npm@10 publish --access public --dry-run` — clean
- `npm publish --access public` with forced `NODE_AUTH_TOKEN` config — blocked by registry name-policy `E403`

Next:

- Open npm support request for unscoped `yips` name-policy exception.
- Keep package name unscoped in repo until support outcome is decided.
