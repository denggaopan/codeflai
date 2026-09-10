import { describe, expect, it } from 'vitest'

import { resolveActiveSection, SETTINGS_SECTIONS, type SectionOffset } from './settings-sections'

const offsets: ReadonlyArray<SectionOffset> = [
  { id: 'general', top: 0 },
  { id: 'sessionKinds', top: 200 },
  { id: 'updates', top: 900 },
  { id: 'about', top: 1040 }
]

const viewport = (scrollTop: number, clientHeight = 400, scrollHeight = 1600) => ({ scrollTop, clientHeight, scrollHeight })

describe('SETTINGS_SECTIONS', () => {
  it('lists every section exactly once, in the order they are stacked', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(['general', 'sessionKinds', 'updates', 'about'])
  })
})

describe('resolveActiveSection', () => {
  it('points at the first section while the pane is at the top', () => {
    expect(resolveActiveSection(viewport(0), offsets)).toBe('general')
  })

  it('keeps the previous section current until the next heading passes the line', () => {
    // 170 + 24 is still short of the Session kinds heading at 200; 180 + 24 has passed it.
    expect(resolveActiveSection(viewport(170), offsets)).toBe('general')
    expect(resolveActiveSection(viewport(180), offsets)).toBe('sessionKinds')
  })

  it('follows the scroll position through the middle sections', () => {
    expect(resolveActiveSection(viewport(400), offsets)).toBe('sessionKinds')
    expect(resolveActiveSection(viewport(880), offsets)).toBe('updates')
  })

  // The last section is shorter than the pane, so its heading never reaches the line: without
  // the bottom special case its menu entry could never light up.
  it('claims the last section once the pane is scrolled to the bottom', () => {
    expect(resolveActiveSection(viewport(1200, 400, 1600), offsets)).toBe('about')
  })

  it('has no answer before any section has been measured', () => {
    expect(resolveActiveSection(viewport(0), [])).toBeNull()
  })
})
