import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Gap between a project row and the popover anchored to its edge, mirrored in styles.css. */
export const ROW_POPOVER_GAP = 6

export type PopoverPlacement = 'below' | 'above'

export type PopoverLayout = {
  placement: PopoverPlacement
  maxHeight: number | null
}

const DEFAULT_LAYOUT: PopoverLayout = { placement: 'below', maxHeight: null }

type ScrollportPopoverOptions = {
  /** Identifies the currently open popover; null while closed. A change re-runs placement. */
  openKey: string | null
  popoverRef: RefObject<HTMLElement | null>
  scrollportRef: RefObject<HTMLElement | null>
  /** Element the popover is positioned against, found by closest() from the popover. */
  anchorSelector: string
  /** Control inside the anchor whose visibility decides whether the popover may stay open. */
  triggerSelector: string
  gap: number
  /** Called when the trigger has left the scrollport, or is gone entirely. */
  onDismiss: () => void
}

/**
 * Keeps a row popover inside the sidebar's scrolling project area: it flips to the roomier
 * side of its anchor row and clamps its height when neither side fits, rather than being
 * clipped by the scrollport it lives in. Both row popovers — the project options menu and
 * the session launcher — are absolutely positioned inside `.project-groups`, so a popover
 * on a bottom row would otherwise extend past the scrollport's bottom edge and lose its
 * lower entries behind the sidebar footer.
 *
 * useLayoutEffect rather than useEffect: placement is measured and applied before paint, so
 * no below-then-above flash is visible.
 */
export function useScrollportPopoverLayout({
  openKey,
  popoverRef,
  scrollportRef,
  anchorSelector,
  triggerSelector,
  gap,
  onDismiss
}: ScrollportPopoverOptions): PopoverLayout {
  // Each newly opened popover starts from the provisional "below" placement instead of
  // inheriting the previous one's flip or clamp, which the layout effect then corrects.
  const [state, setState] = useState<{ key: string | null; layout: PopoverLayout }>({ key: null, layout: DEFAULT_LAYOUT })
  if (state.key !== openKey) setState({ key: openKey, layout: DEFAULT_LAYOUT })

  // Callers pass an inline closure; reading it through a ref keeps the effect from
  // re-subscribing its scroll listener on every render while never calling a stale one.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useLayoutEffect(() => {
    if (!openKey) return

    const popover = popoverRef.current
    const scrollport = scrollportRef.current
    const anchor = popover?.closest<HTMLElement>(anchorSelector)
    if (!popover || !scrollport || !anchor) return
    const trigger = anchor.querySelector<HTMLElement>(triggerSelector)
    if (!trigger) {
      dismissRef.current()
      return
    }

    const updateLayout = (): void => {
      const anchorRect = anchor.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const scrollportRect = scrollport.getBoundingClientRect()
      // A zero-height browser layout has no visible anchor; a layoutless test DOM has no
      // client rect at all and cannot provide meaningful visibility geometry.
      const scrollportHasLayout = scrollport.getClientRects().length > 0
      if (
        scrollportHasLayout &&
        (scrollportRect.height <= 0 || triggerRect.bottom <= scrollportRect.top || triggerRect.top >= scrollportRect.bottom)
      ) {
        // The trigger is no longer visible, so leave focus alone rather than restoring it to
        // an offscreen row while dismissing the clipped popover.
        dismissRef.current()
        return
      }

      const popoverRect = popover.getBoundingClientRect()
      const popoverScrollHeight = popover.scrollHeight
      const popoverStyle = window.getComputedStyle(popover)
      const verticalBorders =
        (Number.parseFloat(popoverStyle.borderTopWidth) || 0) + (Number.parseFloat(popoverStyle.borderBottomWidth) || 0)
      // scrollHeight excludes borders, while max-height uses the app-wide border-box sizing.
      // It therefore remains the stable natural content/padding height after a prior clamp.
      const naturalHeight = popoverScrollHeight > 0 ? popoverScrollHeight + verticalBorders : popoverRect.height
      const belowSpace = Math.max(0, scrollportRect.bottom - anchorRect.bottom - gap)
      const aboveSpace = Math.max(0, anchorRect.top - scrollportRect.top - gap)
      const placement = belowSpace >= naturalHeight || belowSpace >= aboveSpace ? 'below' : 'above'
      const availableSpace = placement === 'below' ? belowSpace : aboveSpace
      const maxHeight = availableSpace >= naturalHeight ? null : Math.floor(availableSpace)

      setState((current) =>
        current.key === openKey && current.layout.placement === placement && current.layout.maxHeight === maxHeight
          ? current
          : { key: openKey, layout: { placement, maxHeight } }
      )
    }

    updateLayout()
    scrollport.addEventListener('scroll', updateLayout)
    window.addEventListener('resize', updateLayout)
    return () => {
      scrollport.removeEventListener('scroll', updateLayout)
      window.removeEventListener('resize', updateLayout)
    }
  }, [anchorSelector, gap, openKey, popoverRef, scrollportRef, triggerSelector])

  return state.key === openKey ? state.layout : DEFAULT_LAYOUT
}
