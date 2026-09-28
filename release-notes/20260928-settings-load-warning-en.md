# Codeflai Release Notes - 0.29.2 / 2026-09-28

## Overview

This patch fixes saved settings such as quick prompts, theme and language occasionally showing up as defaults after an upgrade, as if they had been wiped.

## Fix

After upgrading to 0.29.1, a user found the quick prompts bar switched off and every saved prompt gone. The settings had not been lost: the first launch after an upgrade occasionally fails to read them, and Codeflai used to fall back to defaults without saying so. Changes made during that launch were not kept either. Quitting Codeflai completely and starting it again brings everything back.

Starting with this version, Codeflai checks at startup whether the saved settings were actually read. When they were not, a red notice appears in the window explaining that the settings are temporarily unavailable and asking you to quit and relaunch, instead of silently showing an empty settings page. The notice appears only when the settings really could not be read; a normal launch is unchanged.

## After Updating

The fix itself takes effect on the next upgrade. If the first launch after updating to 0.29.2 shows default settings again, do not add prompts or change settings in that window: those changes would not be kept, and your original settings are not overwritten either. Quit Codeflai completely and open it again to recover them.

## Feedback

If the settings do not come back after a restart, or the notice appears during normal use, please open an issue at https://github.com/denggaopan/codeflai/issues.
