# Codeflai Release Notes — 0.24.1 / 2026-09-15

## Overview

This release fixes auto shutdown from 0.24.0, which in practice almost never fired. The machine now powers itself off once your agents are finished, without you stopping any sessions by hand first.

## Bug Fixes

- **Fixed: auto shutdown never triggering.** It used to ask whether any session was still open, and an agent session stays open from the moment you first talk to it until you stop it yourself — so "the machine powers itself off" really meant "after you have walked back to it and stopped everything", which is the one moment the feature is no use. It now goes by the status shown in the sidebar: an agent reading **Done** (finished, waiting for your input) no longer holds the shutdown off.
- **Fixed: the countdown stretching out while you were away.** The ten-second countdown used to tick once a second, and a window in the background has those ticks slowed down heavily by the system — ten seconds could become ten minutes, and the number on screen no longer matched the clock. The countdown now works from the actual time, so ten seconds is ten seconds whether or not the window is in front.
- **Fixed: a possible shutdown the moment the computer woke up.** If the machine slept through its own countdown, it now gives you the full ten seconds again when it wakes instead of powering off as the screen comes on.

## Tips & Guidelines

- **What holds the shutdown off** is exactly what the session's row says in the sidebar:

  | Sidebar status | Holds the shutdown off? |
  | --- | --- |
  | **Running** — an agent working right now | Yes |
  | **Starting…** — a terminal still coming up | Yes |
  | An open PowerShell, Command Prompt, or Shell session | Yes |
  | **Done** — an agent finished and waiting for input | No |
  | **Stopped**, **Path missing**, **Error** | No |

- **An open shell keeps the machine on.** Shells never report Done — they sit at their prompt, which says nothing about whether a build is running behind it. Stop the ones you are finished with; conversely, leaving one open is an easy way to keep a machine from powering off.
- **An idle agent starts the countdown.** If you are reading results rather than typing, the ten-second countdown will appear once the check interval passes — click **Cancel shutdown**, which also switches auto shutdown off.
- The switch and the frequency work exactly as before, and your saved choices are untouched.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
