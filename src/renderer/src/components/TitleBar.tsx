import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'

import logoUrl from '../assets/logo.svg'
import {
  AUTO_SHUTDOWN_INTERVAL_OPTIONS,
  AUTO_SHUTDOWN_TIME_OPTIONS,
  formatAutoShutdownInterval,
  parseTimeOfDay
} from '../auto-shutdown'
import { useTranslation } from '../i18n/use-translation'
import {
  CHIME_GRACE_MS,
  CHIME_STAGGER_MS,
  chimeLaunchOrigins,
  msFromNearestHour,
  msUntilNextHour,
  nearestHourStart,
  rocketsAtHour
} from '../rocket-chime'
import { recordRocketClick, type RocketClickStreak } from '../rocket-click-streak'
import type { Point } from '../rocket-flight'
import { useAppStore } from '../store/use-app-store'
import RocketFlight from './RocketFlight'

interface RocketLaunch {
  id: number
  origin: Point
  burst: boolean
}

/**
 * Custom window title bar. Windows reserves its right-side titleBarOverlay; macOS reserves
 * the left-side traffic lights. Platform-specific padding in styles.css keeps this strip's
 * drag region and controls clear of the native window buttons.
 */
export default function TitleBar() {
  const { t } = useTranslation()
  const pinned = useAppStore((state) => state.windowPinned)
  const setWindowPinned = useAppStore((state) => state.setWindowPinned)
  const autoShutdown = useAppStore((state) => state.autoShutdown)
  const setAutoShutdownEnabled = useAppStore((state) => state.setAutoShutdownEnabled)
  const setAutoShutdownInterval = useAppStore((state) => state.setAutoShutdownInterval)
  const setAutoShutdownTimeRangeEnabled = useAppStore((state) => state.setAutoShutdownTimeRangeEnabled)
  const setAutoShutdownTimeRange = useAppStore((state) => state.setAutoShutdownTimeRange)
  const rocket = useAppStore((state) => state.rocket)
  const [launches, setLaunches] = useState<RocketLaunch[]>([])
  const nextLaunchId = useRef(1)
  const clickStreak = useRef<RocketClickStreak>({ clicks: [], rocketCount: 1 })
  // The brand strip is the launch pad for both kinds of flight: a click drops from it, and a
  // chime uses its lower edge as the height the whole row falls from.
  const brandRef = useRef<HTMLElement | null>(null)
  // The rockets of a chime are appended one short stagger apart, so the timers of one that is
  // still counting itself out have to be cancellable on unmount.
  const chimeTimers = useRef(new Set<ReturnType<typeof setTimeout>>())

  // The brand button is the easter egg's launch pad: every click drops another rocket from
  // wherever the logo currently sits. Multi-rocket launches last until clicks pause for over 3s.
  const launchRocket = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const streak = recordRocketClick(clickStreak.current, performance.now())
    clickStreak.current = streak
    const next = Array.from({ length: streak.rocketCount }, (_, index) => ({
      id: nextLaunchId.current++,
      origin: { x: box.left + box.width / 2 + (index - (streak.rocketCount - 1) / 2) * 36, y: box.bottom },
      burst: streak.rocketCount > 1
    }))
    setLaunches((current) => [...current, ...next])
  }

  const endLaunch = useCallback((id: number) => {
    setLaunches((current) => current.filter((launch) => launch.id !== id))
  }, [])

  /**
   * The clock's own rockets: one per hour on the dial, fanned across the top of the window and
   * counted out a stagger apart.
   *
   * Rescheduled from the wall clock after every chime rather than run off a one-hour interval:
   * an interval drifts, and drift is the one thing a clock may not do. A machine that slept
   * through an hour simply misses it — see rocket-chime.ts for why a late chime is worse than
   * no chime.
   */
  useEffect(() => {
    if (!rocket.enabled || !rocket.hourlyEnabled) return undefined

    const staggered = chimeTimers.current
    let scheduled: ReturnType<typeof setTimeout> | undefined
    let lastChimedHour: number | null = null

    const chime = (hour: Date): void => {
      const origins = chimeLaunchOrigins({
        count: rocketsAtHour(hour),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        y: brandRef.current?.getBoundingClientRect().bottom ?? 0
      })
      const launch = (origin: Point): void => {
        setLaunches((current) => [...current, { id: nextLaunchId.current++, origin, burst: false }])
      }
      origins.forEach((origin, index) => {
        // The first rocket leaves on the hour itself rather than one macrotask after it; the
        // rest count themselves out behind it.
        if (index === 0) {
          launch(origin)
          return
        }
        const timer = setTimeout(() => {
          staggered.delete(timer)
          launch(origin)
        }, index * CHIME_STAGGER_MS)
        staggered.add(timer)
      })
    }

    const schedule = (): void => {
      scheduled = setTimeout(() => {
        const now = new Date()
        const hour = nearestHourStart(now)
        // Guarded on the hour the tick belongs to as well as on its lateness: a timer is
        // allowed to fire a hair early, and the reschedule that follows would then land on the
        // same hour a millisecond later and chime it twice.
        if (hour.getTime() !== lastChimedHour && msFromNearestHour(now) <= CHIME_GRACE_MS) {
          lastChimedHour = hour.getTime()
          chime(hour)
        }
        schedule()
      }, msUntilNextHour(new Date()))
    }
    schedule()

    return () => {
      if (scheduled !== undefined) clearTimeout(scheduled)
      for (const timer of staggered) clearTimeout(timer)
      staggered.clear()
    }
  }, [rocket.enabled, rocket.hourlyEnabled])

  // One label per state rather than a fixed name plus aria-pressed alone: the tooltip is
  // where most users read what the button will do next.
  const pinLabel = pinned ? t('titleBar.unpinWindow') : t('titleBar.pinWindow')
  // The frequency and the time range only appear once the feature is on: controls nothing
  // acts on would be permanent fixtures in a strip that has room for two buttons, and
  // switching it on is what makes them mean anything.
  //
  // A window whose ends are equal contains no minute at all, so the watcher would never fire
  // (see isWithinTimeRange). The control says so rather than silently doing nothing: this is
  // the one place with room to explain it, and the alternative — reading it as "all day" —
  // would throw away the restriction the user had just asked for.
  const emptyTimeRange = parseTimeOfDay(autoShutdown.timeRange.start) === parseTimeOfDay(autoShutdown.timeRange.end)
  const autoShutdownWindowLabel = !autoShutdown.timeRangeEnabled
    ? ''
    : emptyTimeRange
      ? ` ${t('titleBar.autoShutdownWindowEmpty')}`
      : ` ${t('titleBar.autoShutdownWindow', { start: autoShutdown.timeRange.start, end: autoShutdown.timeRange.end })}`
  const autoShutdownLabel = autoShutdown.enabled
    ? `${t('titleBar.autoShutdownOn', { interval: formatAutoShutdownInterval(autoShutdown.intervalMs) })}${autoShutdownWindowLabel}`
    : t('titleBar.autoShutdownOff')

  // One of the window's two ends, picked from a list rather than typed: these are two clock
  // readings somebody sets once, and a field you have to type digits into is the wrong shape
  // for that. Written once for both ends so neither can drift from the other.
  const renderTimeEdge = (edge: 'start' | 'end') => {
    const selected = autoShutdown.timeRange[edge]
    // A window that came from an older preference or a hand-edited one can sit between two
    // rows of the menu. It is offered as its own row rather than rounded away: the rule the
    // watcher follows is that time, and a dropdown showing nothing at all would be a lie.
    const options = AUTO_SHUTDOWN_TIME_OPTIONS.includes(selected)
      ? AUTO_SHUTDOWN_TIME_OPTIONS
      : [...AUTO_SHUTDOWN_TIME_OPTIONS, selected].sort()

    return (
      <select
        className="title-bar-time"
        aria-label={t(edge === 'start' ? 'titleBar.autoShutdownTimeRangeStart' : 'titleBar.autoShutdownTimeRangeEnd')}
        // Equal ends are a window no minute falls in, so the control reports itself invalid
        // rather than leaving a switched-on restriction that quietly never fires.
        aria-invalid={autoShutdown.timeRangeEnabled && emptyTimeRange}
        value={selected}
        onChange={(event) => setAutoShutdownTimeRange({ ...autoShutdown.timeRange, [edge]: event.target.value })}
      >
        {options.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    )
  }

  // One face for both shapes the brand takes, so the button and the inert strip can never
  // drift apart visually.
  const brandFace = (
    <>
      <img className="title-bar-logo" src={logoUrl} alt="" aria-hidden="true" />
      <span className="title-bar-app-name">Codeflai</span>
    </>
  )

  return (
    <header className="title-bar">
      {/* With the easter egg switched off the brand has nothing to do, so it stops being a
          button rather than staying one that ignores clicks — and it gives its strip back to
          the window's drag region, which the no-drag button had taken out of it. */}
      {rocket.enabled ? (
        <button
          type="button"
          className="title-bar-brand"
          aria-label={t('titleBar.launchRocket')}
          ref={(node) => {
            brandRef.current = node
          }}
          onClick={launchRocket}
        >
          {brandFace}
        </button>
      ) : (
        <span
          className="title-bar-brand title-bar-brand--static"
          ref={(node) => {
            brandRef.current = node
          }}
        >
          {brandFace}
        </span>
      )}
      {/* Draggable filler: the brand button and the action buttons are all no-drag, so
          without this the window would have almost no grab area left. */}
      <span className="title-bar-drag-area" aria-hidden="true" />
      <div className="title-bar-actions">
        {autoShutdown.enabled && (
          <>
            <select
              className="title-bar-interval"
              aria-label={t('titleBar.autoShutdownInterval')}
              title={t('titleBar.autoShutdownInterval')}
              value={autoShutdown.intervalMs}
              onChange={(event) => setAutoShutdownInterval(Number(event.target.value))}
            >
              {AUTO_SHUTDOWN_INTERVAL_OPTIONS.map((intervalMs) => (
                <option key={intervalMs} value={intervalMs}>
                  {formatAutoShutdownInterval(intervalMs)}
                </option>
              ))}
            </select>
            {/* The window and its switch travel together, and the hours stay editable while
                the restriction is off: setting the window you want and then arming it is the
                natural order to do this in, and a control that only accepts input after you
                have switched the rule on forces the opposite one. The checkbox says whether
                the window applies, not whether it can be chosen. */}
            <div className="title-bar-time-range">
              <input
                type="checkbox"
                className="title-bar-time-range-toggle"
                aria-label={t('titleBar.autoShutdownTimeRange')}
                title={t('titleBar.autoShutdownTimeRange')}
                checked={autoShutdown.timeRangeEnabled}
                onChange={(event) => setAutoShutdownTimeRangeEnabled(event.target.checked)}
              />
              {renderTimeEdge('start')}
              <span className="title-bar-time-range-dash" aria-hidden="true">
                –
              </span>
              {renderTimeEdge('end')}
            </div>
          </>
        )}
        <button
          type="button"
          className={autoShutdown.enabled ? 'title-bar-action title-bar-power title-bar-power--on' : 'title-bar-action title-bar-power'}
          aria-label={autoShutdownLabel}
          title={autoShutdownLabel}
          aria-pressed={autoShutdown.enabled}
          onClick={() => setAutoShutdownEnabled(!autoShutdown.enabled)}
        >
          <svg
            className="icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          className="title-bar-action title-bar-pin"
          aria-label={pinLabel}
          title={pinLabel}
          aria-pressed={pinned}
          onClick={() => setWindowPinned(!pinned)}
        >
          <svg
            className="icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={pinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
      </div>
      {launches.map((launch) => (
        <RocketFlight key={launch.id} origin={launch.origin} burst={launch.burst} onDone={() => endLaunch(launch.id)} />
      ))}
    </header>
  )
}
