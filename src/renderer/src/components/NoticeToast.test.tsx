// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '../store/use-app-store'
import NoticeToast, { NOTICE_TIMEOUT_MS } from './NoticeToast'

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('NoticeToast', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    useAppStore.getState().reset()
  })

  it('renders nothing while there is no notice', () => {
    render(<NoticeToast />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('floats the message over the app instead of inside the sidebar', () => {
    useAppStore.setState({ notice: { message: 'Something went wrong.', tone: 'error' } })
    render(<NoticeToast />)

    const toast = screen.getByRole('alert')
    expect(toast).toHaveTextContent('Something went wrong.')
    expect(toast).toHaveAttribute('data-tone', 'error')
    // Portalled to the body: it owes the sidebar no layout, and outranks every dialog.
    expect(toast.closest('.notice-toast-layer')?.parentElement).toBe(document.body)
  })

  it('dismisses itself after a few seconds', () => {
    useAppStore.setState({ notice: { message: 'Project path copied: E:\\app', tone: 'info' } })
    render(<NoticeToast />)

    advance(NOTICE_TIMEOUT_MS.info - 1)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    advance(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useAppStore.getState().notice).toBeNull()
  })

  it('gives errors longer than confirmations', () => {
    useAppStore.setState({ notice: { message: 'Worktree has 3 changed files.', tone: 'error' } })
    render(<NoticeToast />)

    advance(NOTICE_TIMEOUT_MS.info)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    advance(NOTICE_TIMEOUT_MS.error - NOTICE_TIMEOUT_MS.info)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('restarts the countdown for a second notice raised with the same text', () => {
    useAppStore.setState({ notice: { message: 'Something went wrong.', tone: 'info' } })
    render(<NoticeToast />)

    advance(NOTICE_TIMEOUT_MS.info - 500)
    // A fresh object, as every store `set` produces: the replacement gets its own full few
    // seconds rather than inheriting the 500ms left of the notice it replaced.
    act(() => {
      useAppStore.setState({ notice: { message: 'Something went wrong.', tone: 'info' } })
    })

    advance(NOTICE_TIMEOUT_MS.info - 500)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    advance(500)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('holds while the pointer is on it and counts down again once it leaves', () => {
    useAppStore.setState({ notice: { message: 'Project path copied: E:\\app', tone: 'info' } })
    render(<NoticeToast />)
    const toast = screen.getByRole('alert')

    fireEvent.mouseEnter(toast)
    advance(NOTICE_TIMEOUT_MS.info * 3)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.mouseLeave(toast)
    advance(NOTICE_TIMEOUT_MS.info)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('dismisses early from the close button', () => {
    useAppStore.setState({ notice: { message: 'Something went wrong.', tone: 'error' } })
    render(<NoticeToast />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useAppStore.getState().notice).toBeNull()
  })
})
