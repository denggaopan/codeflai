# Codeflai Release Notes — 0.29.0 / 2026-09-22

## Overview

The rockets can now tell the time. On every hour, the top of the window drops one rocket per hour on the clock — nine at 9 in the morning, five at 5 in the afternoon. Settings gains two switches: one to turn the hourly drop off on its own, one to turn the whole rocket easter egg off.

## What's New

### Rockets on the hour

- **Why it matters:** A rocket used to appear only when you clicked the brand mark in the top-left corner, so unless you happened to click it you never knew it was there. It is meant to be a small moment of fun, and something hidden that well may as well not exist.
- **What it is:** On every hour, the top of the window drops one rocket **per hour on the clock**: nine at 09:00, five at 17:00, twelve at noon and at midnight. They are spread along the top of the window and leave one after another, so the count is easy to read, and they only pass over the interface — nothing they fly across stops being clickable.
- **When to use it:** When you have a few sessions working away on long tasks, a row of rockets going past tells you another hour has gone by.
- **Where to find it:** On by default, nothing to set up. To stop it, go to Settings → General → "Drop rockets on the hour".

Two notes: the hour is your computer's own local time, and an hour the machine slept through is **not** made up for when it wakes — nine rockets at 11:20 would only tell you the wrong time.

### Two new switches in Settings

- **Why it matters:** Once the easter egg plays on its own, there has to be an obvious place to turn it off — screen sharing and screen recording above all.
- **What it is:** Settings → General gains **Rocket easter egg** (the master switch) and, indented under it, **Drop rockets on the hour**. Both are on by default. Turn off just the hourly one and clicking the brand mark still launches a rocket; turn off the master switch and the whole easter egg goes, including the brand mark itself — that strip stops being a button and goes back to being an area you can drag the window by.
- **When to use it:** Demos, recordings, or simply not wanting the animation.
- **Where to find it:** Settings (bottom-left) → General, just below "Notify when a session finishes".

One note: each switch remembers its own state. Turning the master switch off and back on leaves the hourly one exactly as you last set it, rather than resetting it.

## Tips & Guidelines

- **Both switches are on by default.** You will see rockets the first time an hour comes round after updating; switch them off if you would rather not, and the choice survives a restart.
- **A computer with "reduce motion" turned on gets no rockets.** That matches what clicking the brand mark already did.

## Feedback & Support

If you hit a problem after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
