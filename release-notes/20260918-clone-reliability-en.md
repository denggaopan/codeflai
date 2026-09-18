# Codeflai Release Notes — 0.27.1 / 2026-09-18

## Overview

This release is about cloning a Git repository getting stuck. Cloning now shows live progress, can be cancelled at any time, and reports a clear error when it stalls instead of spinning indefinitely.

## What's New

### Cancel a clone at any time

- **Why it matters:** Once you pressed **Clone and open**, the dialog locked up — the close button greyed out, Escape did nothing, and clicking outside did nothing. With a slow or unreachable repository your only option was to wait, potentially a full ten minutes.
- **What it is:** A **Cancel clone** button appears while a clone runs. Pressing it ends the clone immediately, drops the connection it opened in the background, and cleans up whatever was downloaded so far.
- **When to use it:** A mistyped address, a repository far larger than expected, or simply realising the network is not going to cooperate.
- **Where to find it:** Add Project → **Clone Git repository** → once the clone starts, the button sits next to the status text.

### Live progress while cloning

- **Why it matters:** The whole operation showed one unchanging line: "Cloning repository. This may take several minutes...". A large repository downloading normally and a completely stalled clone looked exactly the same, so there was no way to tell whether to keep waiting.
- **What it is:** A **progress bar**, with Git's own live output underneath it — which stage it is on, how far along, how much has been transferred, and the current speed.
- **When to use it:** Judging how much longer a large repository will take, or spotting at a glance that the transfer rate is abnormal.
- **Where to find it:** Same place; it appears automatically once the clone starts.

## Bug Fixes

- **Fixed: a clone could hang indefinitely while the window looked frozen.** A clone that makes no progress for two minutes now stops with a clear error, instead of spinning until a ten-minute timeout.
- **Fixed: a failed clone could not simply be retried.** A failure used to leave half a repository on disk, so the next attempt refused with "the destination already exists" and you had to delete the folder by hand. The folder is now cleaned up after a failure or a cancellation, so retrying is just pressing the button again.

## Tips & Guidelines

- **The progress line is Git's own English output and does not follow the interface language.** The status text and buttons above it stay in the language you picked. This is deliberate — Git's wording names the stage, the counts and the speed more precisely than a rewritten version would.
- **The percentage jumping backwards is normal.** Git splits a clone into several stages (counting, compressing, receiving, resolving) and **restarts the count at 0% for each one**, so the bar resets a few times along the way. The line underneath tells you which stage you are in.
- **If your network needs a proxy, configure it for Git separately.** This is the most common cause of a stuck clone: Git **does not read** the Windows system proxy setting, so an address your browser opens fine may be completely unreachable for Git, silently. Configuring it per host is enough, for example:

  ```
  git config --global http.https://github.com.proxy http://127.0.0.1:YOUR_PORT
  ```

  Configuring per host rather than globally keeps an internal company Git server connecting directly, unaffected.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
