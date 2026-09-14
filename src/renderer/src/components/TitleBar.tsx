import { useCallback, useRef, useState, type MouseEvent } from 'react'

import logoUrl from '../assets/logo.svg'
import { AUTO_SHUTDOWN_INTERVAL_OPTIONS, formatAutoShutdownInterval } from '../auto-shutdown'
import { useTranslation } from '../i18n/use-translation'
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
  const [launches, setLaunches] = useState<RocketLaunch[]>([])
  const nextLaunchId = useRef(1)
  const clickStreak = useRef<RocketClickStreak>({ clicks: [], rocketCount: 1 })

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

  // One label per state rather than a fixed name plus aria-pressed alone: the tooltip is
  // where most users read what the button will do next.
  const pinLabel = pinned ? t('titleBar.unpinWindow') : t('titleBar.pinWindow')
  // The frequency only appears once the feature is on: an interval nothing acts on would be
  // a permanent control in a strip that has room for two buttons, and switching it on is
  // what makes the number mean anything.
  const autoShutdownLabel = autoShutdown.enabled
    ? t('titleBar.autoShutdownOn', { interval: formatAutoShutdownInterval(autoShutdown.intervalMs) })
    : t('titleBar.autoShutdownOff')

  return (
    <header className="title-bar">
      <button type="button" className="title-bar-brand" aria-label={t('titleBar.launchRocket')} onClick={launchRocket}>
        <img className="title-bar-logo" src={logoUrl} alt="" aria-hidden="true" />
        <span className="title-bar-app-name">Codeflai</span>
      </button>
      {/* Draggable filler: the brand button and the action buttons are all no-drag, so
          without this the window would have almost no grab area left. */}
      <span className="title-bar-drag-area" aria-hidden="true" />
      <div className="title-bar-actions">
        {autoShutdown.enabled && (
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
