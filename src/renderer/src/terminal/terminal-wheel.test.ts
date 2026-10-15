import { describe, expect, it } from 'vitest'

import { AGENT_KINDS, AGENT_LAUNCH } from '../../../shared/agent-kinds'
import type { SessionKind } from '../../../shared/contracts'
import {
  SGR_WHEEL_DOWN,
  SGR_WHEEL_UP,
  TerminalWheelTranslator,
  type TerminalWheelEvent,
  type TerminalWheelState
} from './terminal-wheel'

const PIXEL = 0
const LINE = 1
const PAGE = 2

const wheel = (deltaY: number, overrides: Partial<TerminalWheelEvent> = {}): TerminalWheelEvent => ({
  deltaY,
  deltaMode: PIXEL,
  shiftKey: false,
  ...overrides
})

const altScreen: TerminalWheelState = { bufferType: 'alternate', mouseTrackingMode: 'none', cellHeight: 20 }

describe('TerminalWheelTranslator', () => {
  it('sends one SGR wheel report per mouse notch in a Comate session on the alternate buffer', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-100), altScreen)).toEqual({ action: 'send', data: SGR_WHEEL_UP })
    expect(translator.translate('comate', wheel(100), altScreen)).toEqual({ action: 'send', data: SGR_WHEEL_DOWN })
  })

  it('sends one report for line- and page-mode wheel events', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-3, { deltaMode: LINE }), altScreen)).toEqual({ action: 'send', data: SGR_WHEEL_UP })
    expect(translator.translate('comate', wheel(1, { deltaMode: PAGE }), altScreen)).toEqual({ action: 'send', data: SGR_WHEEL_DOWN })
  })

  it('accumulates small trackpad deltas until they amount to a line, swallowing the rest', () => {
    const translator = new TerminalWheelTranslator()
    // 10px on a 20px cell, damped by 0.3: 0.15 line per event, so the 7th event crosses 1.
    const results = Array.from({ length: 7 }, () => translator.translate('comate', wheel(10), altScreen))
    expect(results.slice(0, 6)).toEqual(Array(6).fill({ action: 'consume' }))
    expect(results[6]).toEqual({ action: 'send', data: SGR_WHEEL_DOWN })
  })

  it('leaves the wheel to xterm on the normal buffer, which has scrollback of its own', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-100), { ...altScreen, bufferType: 'normal' })).toEqual({ action: 'xterm' })
  })

  it('leaves the wheel to xterm once mouse tracking reached it, since xterm then reports the wheel itself', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-100), { ...altScreen, mouseTrackingMode: 'vt200' })).toEqual({ action: 'xterm' })
  })

  it('leaves horizontal and zero-delta scrolling to xterm', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-100, { shiftKey: true }), altScreen)).toEqual({ action: 'xterm' })
    expect(translator.translate('comate', wheel(0), altScreen)).toEqual({ action: 'xterm' })
  })

  it('sends one report per event when the cell height is unknown rather than never scrolling', () => {
    const translator = new TerminalWheelTranslator()
    expect(translator.translate('comate', wheel(-100), { ...altScreen, cellHeight: 0 })).toEqual({ action: 'send', data: SGR_WHEEL_UP })
  })

  // Any CLI that does not parse the reports would receive them as text typed into its prompt.
  const untouched: SessionKind[] = [...AGENT_KINDS.filter((kind) => AGENT_LAUNCH[kind].sgrWheelInput !== true), 'shell', 'powershell', 'cmd']
  it.each(untouched)('leaves the wheel to xterm in a %s session', (kind) => {
    expect(new TerminalWheelTranslator().translate(kind, wheel(-100), altScreen)).toEqual({ action: 'xterm' })
  })
})
