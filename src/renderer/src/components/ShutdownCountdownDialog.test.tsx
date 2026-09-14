// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppStore } from '../store/use-app-store'
import ShutdownCountdownDialog from './ShutdownCountdownDialog'

const cancelAutoShutdown = vi.fn()
const shutdownNow = vi.fn(async () => undefined)

describe('ShutdownCountdownDialog', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    useAppStore.setState({ cancelAutoShutdown, shutdownNow })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cancelAutoShutdown.mockClear()
    shutdownNow.mockClear()
    useAppStore.getState().reset()
  })

  it('renders nothing while no countdown is running', () => {
    render(<ShutdownCountdownDialog />)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('names the seconds left and offers both ways out', () => {
    useAppStore.setState({ shutdownCountdown: 7 })
    render(<ShutdownCountdownDialog />)

    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('No sessions are running')
    expect(screen.getByText(/shuts down in 7 second/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel shutdown' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Shut down now' })).toBeInTheDocument()
  })

  it('cancels the shutdown from the button', async () => {
    useAppStore.setState({ shutdownCountdown: 10 })
    render(<ShutdownCountdownDialog />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel shutdown' }))

    expect(cancelAutoShutdown).toHaveBeenCalledTimes(1)
    expect(shutdownNow).not.toHaveBeenCalled()
  })

  it('shuts down now when the user will not wait', async () => {
    useAppStore.setState({ shutdownCountdown: 10 })
    render(<ShutdownCountdownDialog />)

    await userEvent.click(screen.getByRole('button', { name: 'Shut down now' }))

    expect(shutdownNow).toHaveBeenCalledTimes(1)
    expect(cancelAutoShutdown).not.toHaveBeenCalled()
  })

  // Doing nothing here powers the machine off, so every dismissal gesture has to mean cancel
  // rather than "leave it running" the way it does for the update dialog.
  it('treats Escape and a backdrop click as cancelling the shutdown', async () => {
    useAppStore.setState({ shutdownCountdown: 10 })
    const { container } = render(<ShutdownCountdownDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(cancelAutoShutdown).toHaveBeenCalledTimes(1)

    await userEvent.click(document.querySelector('.shutdown-dialog-backdrop') as HTMLElement)
    expect(cancelAutoShutdown).toHaveBeenCalledTimes(2)
    expect(container).toBeDefined()
  })

  it('keeps clicks inside the panel from reaching the backdrop', async () => {
    useAppStore.setState({ shutdownCountdown: 10 })
    render(<ShutdownCountdownDialog />)

    await userEvent.click(screen.getByRole('alertdialog'))

    expect(cancelAutoShutdown).not.toHaveBeenCalled()
  })
})
