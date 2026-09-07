# Codeflai rename and migration

The user selected the full rename and migration option on 2026-09-07.

## Product identity

Use Codeflai for the product, codeflai for the package/repository/internal namespace,
CODEFLAI for environment variables, and com.codeflai.desktop for the application ID.
Current documentation and source move to the new identity; dated design archives and
published releases remain historical records. Existing artwork still fits the name.

## Existing installations

Windows uses the new NSIS identity and explicitly discovers the previous CodeFly
installation for removal with user data retained. Preserve the startup preference and
replace stale startup entries. macOS archives contain Codeflai.app; document replacing
CodeFly.app and preserve login settings where the OS exposes the old entry.

Before Chromium opens the profile, import state.json, its backups, and Local Storage
from the old profile into Codeflai through a staging directory. Keep the old directory
untouched as a backup. Do not overwrite an existing Codeflai profile. A marker records
the import source. Abort with an actionable error if copying fails or the old UI is
still running; a later launch can retry. Custom --user-data-dir profiles remain isolated.

Renderer preferences use codeflai.* keys. Read legacy codefly.* keys only when the new
key is absent, including the older quickPhrases aliases. Preserve explicit false/empty
values and retain legacy values if a storage write fails.

New terminal hosts use codeflai endpoints and executable names. An imported profile
may attach to its original codefly endpoint while that host lives. Never start a second
agent if an old endpoint accepts connections but cannot complete a compatible handshake.
When the old host is gone, subsequent launches create only the new host identity.

## Release

Build a version newer than 0.19.0 with Windows x64 and macOS x64/arm64 assets. Rename
the original GitHub repository so history, issues, stars, tags and releases survive.
Check the old API redirect and installer discovery against the renamed repository.

## Validation

Exercise migration idempotence, copy failures, existing destinations, old preferences,
live legacy-host attachment and ambiguous-host refusal. Run typecheck, unit tests,
release-pruning tests, Electron E2E, Windows packaging and macOS cross-packaging.
Validate actual old/new Electron profiles in temporary directories. Review the final
diff and record platform verification limits before publishing.
