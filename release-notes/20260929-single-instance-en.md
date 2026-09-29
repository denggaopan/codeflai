# Codeflai Release Notes - 0.29.3 / 2026-09-29

## Overview

This patch fixes the quick prompt bar, theme, language and other settings showing up as defaults when a second Codeflai window was opened while one was already running. Launching Codeflai again now brings the running window to the front instead of opening another one.

## Fix

After both the 0.29.1 and 0.29.2 upgrades, users found the quick prompt bar switched off and their settings apparently wiped. The real cause turned out to be two copies of Codeflai running at the same time, not the upgrade. The typical case is **Launch at startup** being on: Codeflai was already open after signing in, and a click on the desktop or taskbar shortcut a minute later started a second one. That second copy could not read the saved settings, so it showed defaults, and changes made in it were not kept. That was the window you were looking at; the settings themselves were never touched.

Starting with this version, only one Codeflai runs at a time. Launching it again no longer opens a second window: the running one comes to the front, restored first if it was minimized.

## After Updating

If settings ever show as defaults again after updating to 0.29.3, check whether an older version's window is still open: quit every Codeflai window and open it once to recover them. The "settings temporarily unavailable" notice added in 0.29.2 stays in place as a safety net for other unexpected cases.

## Feedback

If launching Codeflai again does not bring the open window forward, or settings still show as defaults, please open an issue at https://github.com/denggaopan/codeflai/issues.
