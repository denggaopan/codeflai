# Codeflai Release Notes — 0.24.0 / 2026-09-14

## Overview

This release adds auto shutdown: leave your agents working, and once the last one has finished, Codeflai powers the computer off for you.

## What's New

### Auto shutdown when nothing is running

- **Why it matters:** Long runs finish when they finish. Start a few agents in the evening and the work is often done well before morning — but the machine keeps running all night, because the only thing left to do was notice that everything had stopped and press the power button.
- **What it is:** A power button in the title bar, just left of the pin. Switch it on and Codeflai checks on a fixed schedule whether any session is still running. When none is, it shuts the computer down. A dropdown next to the button sets how often that check happens: **1m**, **2m**, **3m**, **4m**, **5m** (the default), **10m**, **15m**, **30m**, or **1h**.
- **When to use it:** Any unattended run — overnight work, a long batch of agent sessions, or simply stepping away and not wanting the machine to idle for hours once the work is over.
- **Where to find it:** The power button at the top right of the window, immediately left of the pin button. Hover over it to read what it will do; the frequency dropdown appears beside it once it is on.

### A ten-second countdown you can stop

- **Why it matters:** A computer that shuts itself down without warning is a computer you cannot trust to leave running. Anyone sitting in front of it needs a way to say "not now".
- **What it is:** When a check finds nothing running, a dialog says so and counts down from ten seconds. **Cancel shutdown** stops it, **Shut down now** skips the rest of the countdown, and doing nothing shuts the computer down when the count runs out. Pressing Escape or clicking outside the dialog does the same thing as Cancel — with a shutdown pending, every way out of the dialog is the safe one.
- **When to use it:** Whenever you come back to the machine mid-countdown, or when you are watching the last session finish and would rather not wait out the ten seconds.
- **Where to find it:** It appears on its own, over whatever you were looking at.

## Improvements

- **Cancelling means off, not "later":** Cancel shutdown switches auto shutdown off entirely, rather than skipping one round. Someone who just stopped a shutdown does not want the same dialog back a few minutes later.
- **Arming it is never sudden:** The first check is always a full interval away, so switching auto shutdown on — or changing the frequency — never shuts the machine down on the spot. Changing the frequency restarts the clock, so picking **1m** means a minute from now.
- **Sessions that are still starting count as running:** A session whose terminal is still coming up holds the shutdown off, exactly like a running one.
- **It remembers:** The switch and the frequency come back the next time you launch, so a machine left with auto shutdown on keeps powering itself off. The frequency is remembered even while the switch is off.
- **A quiet button:** The power button brightens when it is armed rather than lighting up in a colour, and the frequency dropdown appearing beside it is the clearest sign that it is on.

## Tips & Guidelines

- **This is a forced shutdown.** On Windows, applications are closed without waiting for them, so anything with unsaved work outside Codeflai will not get to ask you about it. On macOS the request goes through the system's own **Shut Down…**, so applications there may still put up their own save prompts.
- **"Running" means a running session, not a busy one.** An agent session that is finished but still open counts as running and holds the shutdown off. Stop or close the sessions you are done with, and auto shutdown will do the rest.
- **If the shutdown is refused** — no permission on the machine, or a policy that blocks it — Codeflai shows a message saying so and switches auto shutdown off, rather than asking again every few minutes.
- **It is off by default,** and nothing about it changes until you switch it on.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
