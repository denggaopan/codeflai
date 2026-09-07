# Codeflai Rename Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the bounded installer task and requesting-code-review for the completed migration. Execute the remaining coupled startup changes in this session.

**Goal:** Rename CodeFly to Codeflai throughout the maintained product and migrate existing installations without losing state or creating duplicate agent processes.

**Architecture:** A startup migration module copies a closed legacy profile atomically before Chromium uses it. Renderer storage reads new keys with legacy fallback. The host launcher checks the imported profile's old endpoint before spawning a new host. NSIS handles the legacy installation identity explicitly.

**Tech Stack:** Electron, TypeScript, React, Vitest, Playwright, electron-builder/NSIS.

## Tasks

- [x] Establish the baseline with `npm test`, record the existing release, and work on `feat/codeflai-rename`.
- [x] Rename maintained source, fixtures, scripts and current documentation using exact case mappings: `CodeFly -> Codeflai`, `codefly -> codeflai`, `CODEFLY -> CODEFLAI`. Rename `e2e/codefly.spec.ts`. Leave dated archives unchanged.
- [x] Add `src/main/services/brand-migration.test.ts` with real temporary directories for source preservation, state/backup/storage copying, repeat launches, existing destination protection, copying failure and running legacy UI. Implement `prepareBrandMigration` in `brand-migration.ts`, and wire it before `app.whenReady` in `src/main/index.ts`.
- [x] Add `src/renderer/src/storage-migration.test.ts` covering all legacy preference keys, new-value precedence, write failure and older quickPhrases aliases. Implement `readMigratedStorage` and use it in `store/use-app-store.ts` and `quick-prompts.ts`.
- [x] Extend `src/main/services/pty-host-launcher.test.ts` for migrated endpoints: attach without spawning, reject an unresponsive/incompatible legacy host, prefer an existing new host, and create a new endpoint after the old host exits. Implement optional legacy endpoint discovery without changing the wire version.
- [x] Add NSIS migration include and behavioral packaging checks. Use the new app ID and GUID; discover/uninstall the old identity with app data retained. Preserve launch-at-login settings and document macOS replacement behavior.
- [x] Extend `scripts/prune-releases.test.mjs` to include both branding generations. Update current README migration instructions and branding metadata.
- [x] Run `npm run typecheck`, `npm test`, `npx vitest run scripts/prune-releases.test.mjs scripts/installer-migration.test.mjs`, and `npm run test:e2e`. Add real Electron migration coverage using temporary profiles and the old build where available.
- [ ] Review the complete change, fix findings, commit implementation and independently bump the version to `0.20.0`.
- [ ] Build `npm run package:win` and `npm run package:mac`; inspect package names and metadata. Rename the GitHub repository, update the remote, and verify redirects before publishing the new release.

## Acceptance checks

All newly written data, APIs, environment variables and build outputs use Codeflai.
CodeFly literals remain only in explicit compatibility handling, migration tests,
attribution/history and the migration documentation. Source data stays recoverable;
running legacy terminals can be attached without a duplicate host. Real OS installer
and macOS execution limits must be stated separately from automated test results.

## Verification before packaging

- Typecheck passed.
- 55 Vitest files / 1,330 tests passed, including 10 compiled NSIS migration cases.
- 27 Electron E2E tests passed, including released CodeFly host continuity, profile copying and retirement of old host discovery.
- Independent profile/host and installer/login reviews found no remaining issues after fixes.
- Actual macOS execution and elevated HKLM/UAC installer transitions remain manual checks.
