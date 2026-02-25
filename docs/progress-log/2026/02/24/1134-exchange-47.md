## 2026-02-24 11:34 MST — Exchange 47

Summary: Restored yips-cli-style highlighted gradients and list styling in downloader, and added background tab preloading with in-memory tab cache for instant switching.
Changed:

- Updated `src/colors.ts`:
  - added background-color helpers (`bgColorText`, `horizontalGradientBackground`) for gradient-highlight UI parity
- Updated `src/downloader-ui.ts`:
  - active tabs now use highlighted gradient backgrounds (not only foreground gradients)
  - selected model/file rows now use yips-cli-like gradient-highlighted backgrounds with focus accent
  - non-selected file rows now use semantic status coloring (green for compatible, red for incompatible)
  - fixed row width math so styled rows remain aligned and avoid style-stripping overflow fallback
- Updated `src/downloader-state.ts`:
  - added downloader tab cache state (`cacheQuery`, `modelCacheByTab`, `preloadingTabs`)
  - added cache helper utilities (`setCachedModels`, `getCachedModels`, `resetModelCache`, `setPreloadingTabs`)
  - exported `DOWNLOADER_TABS` constant for shared tab iteration
- Updated `src/tui.ts`:
  - tab switches now hydrate instantly from cache when available
  - search refresh now clears/rebuilds per-query tab cache and preloads non-active tabs in background
  - opening downloader now triggers active-tab fetch + background preload for other tabs
- Updated tests:
  - `tests/downloader-state.test.ts` expanded for tab constant and cache lifecycle coverage
  - `tests/downloader-ui.test.ts` expanded to verify highlighted/background styling and file status coloring paths
    Validation:
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm test` — clean (17 files, 170 tests)
  Next:
- Add a focused integration test with mocked downloader fetches to assert tab-switch cache hits avoid network calls after preload.
