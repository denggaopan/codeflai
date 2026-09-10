import type { TranslationKey } from './i18n'

/**
 * The Settings dialog's sections, in the order they are stacked in the scrolling pane. The
 * same list drives the anchor menu on the left, so a section can never exist without a way
 * to jump to it (or a menu entry point at nothing).
 */
export type SettingsSectionId = 'general' | 'sessionKinds' | 'updates' | 'about'

export type SettingsSection = { id: SettingsSectionId; labelKey: TranslationKey }

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: 'general', labelKey: 'settings.sectionGeneral' },
  { id: 'sessionKinds', labelKey: 'settings.sessionKinds' },
  { id: 'updates', labelKey: 'settings.sectionUpdates' },
  { id: 'about', labelKey: 'settings.about' }
]

export type SectionOffset = { id: SettingsSectionId; top: number }

export type ScrollViewport = { scrollTop: number; clientHeight: number; scrollHeight: number }

/**
 * How far below the pane's top edge the "you are here" line sits. A section counts as current
 * once its heading has passed that line, which keeps the highlight from flipping to the next
 * section while the previous heading is still the top thing on screen.
 */
export const ACTIVE_SECTION_MARGIN = 24

/**
 * Which menu entry the scroll position points at. Offsets are the sections' `offsetTop` inside
 * the scrolling pane, so they are already in the same coordinate space as `scrollTop`.
 *
 * The bottom of the pane is a special case rather than an afterthought: the last section is
 * usually shorter than the viewport, so its heading can never reach the line above — without
 * this, clicking the last menu entry would scroll as far as it goes and still highlight the
 * one before it.
 */
export const resolveActiveSection = (viewport: ScrollViewport, offsets: ReadonlyArray<SectionOffset>): SettingsSectionId | null => {
  if (offsets.length === 0) return null
  if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1) return offsets[offsets.length - 1].id

  const line = viewport.scrollTop + ACTIVE_SECTION_MARGIN
  let active = offsets[0].id
  for (const offset of offsets) {
    if (offset.top <= line) active = offset.id
  }
  return active
}
