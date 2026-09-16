# Codeflai Release Notes — 0.25.2 / 2026-09-16

## Overview

Auto shutdown can now be confined to a time range: tick the box and the machine only powers off between the hours you choose (20:00 – 08:00 by default). Sessions that finish during the day no longer power the machine off in the middle of the afternoon — it waits for the evening.

## New Features

- **Auto shutdown can be restricted to certain hours.** Once auto shutdown is on, a checkbox and two time dropdowns appear beside the frequency. Tick it and the machine may only be shut down between those two times of day. Leave it unticked and nothing changes — a shutdown can happen at any hour, exactly as before.
- **Both times are picked from a list, never typed.** Every half hour from 00:00 to 23:30, 48 in all — this is a coarse "not before the evening" rule, and picking a row beats typing four digits.
- **The times can be changed whether or not the box is ticked.** Set the window you want first, then arm it: the checkbox says whether the window applies, not whether it can be chosen.
- **The default window is the night, 20:00 – 08:00.** A start later than its end means overnight: eight in the evening through eight the next morning. The start counts (20:00 does shut down), the end does not (at 08:00 sharp the window has already closed). A daytime window such as 09:00 – 17:00 works the same way.
- **Outside the window nothing happens, but the check keeps running.** A machine that goes idle at lunchtime is not powered off the instant 20:00 arrives; it is shut down at the first check after that — at most one interval later than the hour you set.
- **The power button's tooltip spells the window out** once the restriction is on, so hovering it tells you exactly when it will power the machine off.

## Tips & Guidelines

- **Setting both times the same shuts nothing down.** A window that starts and ends at the same minute contains no time at all: both dropdowns turn red and the tooltip says so, rather than leaving a restriction that looks switched on but quietly does nothing.
- **A machine that wakes outside the window does not power off.** If it slept through a countdown — lid closed at 07:55, opened at 09:00 — the countdown is dropped instead of being handed its ten seconds back, because that moment is in the hours you ruled out.
- **Unticking the box keeps the hours you picked**, so ticking it again brings them back. The window is remembered across restarts, like the switch and the frequency.
- **Nothing changes when you update.** The restriction is off by default, so a machine already using auto shutdown keeps behaving exactly as it did until you switch it on.
- How "running" is judged has not changed: it is still the status the sidebar shows — a Done agent does not count, Starting… and an open shell do.

## Feedback & Support

If you run into problems after updating, please open an issue: https://github.com/denggaopan/codeflai/issues
