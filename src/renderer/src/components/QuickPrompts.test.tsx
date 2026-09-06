import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QUICK_PROMPTS_STORAGE_KEY, readStoredQuickPrompts } from '../quick-prompts'
import { useAppStore } from '../store/use-app-store'
import QuickPrompts from './QuickPrompts'

beforeEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  useAppStore.getState().reset()
  useAppStore.setState({ showQuickPrompts: true })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

const mount = (running = true) => {
  const onInsert = vi.fn(() => null)
  const onFocusTerminal = vi.fn()
  render(<div className="terminal-workspace"><textarea aria-label="Terminal input" />
    <QuickPrompts sessionId="session-1" running={running} onInsert={onInsert} onFocusTerminal={onFocusTerminal} />
  </div>)
  return { onInsert, onFocusTerminal }
}

describe('QuickPrompts', () => {
  it('saves a multiline prompt and inserts it only when the user selects it', async () => {
    const user = userEvent.setup()
    const { onInsert } = mount()
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveFocus()
    expect(screen.queryByRole('textbox', { name: /Name/ })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Check changes.{Enter}Run tests.')
    await user.click(screen.getByRole('button', { name: 'Save prompt' }))

    expect(readStoredQuickPrompts()).toEqual([
      { id: expect.any(String), starred: false, content: 'Check changes.\nRun tests.' }
    ])
    expect(onInsert).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Insert Check changes. Run tests.' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Quick prompts' }))
    await user.click(screen.getByRole('option', { name: 'Insert Check changes. Run tests.' }))
    expect(onInsert).toHaveBeenCalledExactlyOnceWith('Check changes.\nRun tests.')
    expect(screen.getByRole('button', { name: 'Quick prompts' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('searches content, edits a saved prompt, and confirms deletion', async () => {
    useAppStore.getState().setQuickPrompts([
      { id: 'review', starred: true, content: 'Check tests' },
      { id: 'continue', starred: false, content: 'Continue working' }
    ])
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Manage prompts' }))
    await user.type(screen.getByRole('searchbox'), 'tests')
    expect(screen.queryByRole('button', { name: 'Edit Continue working' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Check tests' }))
    await user.clear(screen.getByRole('textbox', { name: 'Content' }))
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Check the diff')
    await user.click(screen.getByRole('button', { name: 'Save prompt' }))
    expect(readStoredQuickPrompts()[0]).toEqual({ id: 'review', starred: true, content: 'Check the diff' })
    expect(screen.getByRole('button', { name: 'Insert Check the diff' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Manage prompts' }))
    await user.click(screen.getByRole('button', { name: 'Delete prompt Check the diff' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(readStoredQuickPrompts()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Delete prompt Check the diff' }))
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    expect(readStoredQuickPrompts()).toEqual([{ id: 'continue', starred: false, content: 'Continue working' }])
  })

  it('keeps the draft and reports storage failures instead of pretending to save', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Check changes')
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full') })
    await user.click(screen.getByRole('button', { name: 'Save prompt' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue('Check changes')
    expect(useAppStore.getState().quickPrompts).toEqual([])
    storage.mockRestore()
    await user.click(screen.getByRole('button', { name: 'Save prompt' }))
    expect(window.localStorage.getItem(QUICK_PROMPTS_STORAGE_KEY)).toContain('Check changes')
  })

  it('allows management in stopped sessions but disables insertion', async () => {
    useAppStore.getState().setQuickPrompts([{ id: 'continue', starred: true, content: 'Continue working' }])
    const user = userEvent.setup()
    const { onInsert } = mount(false)
    await user.click(screen.getByRole('button', { name: 'Manage prompts' }))
    expect(screen.getByRole('button', { name: 'Insert Continue working' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit Continue working' })).toBeEnabled()
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('returns focus on Escape and retains an edit when the user clicks the terminal or closes the panel', async () => {
    const user = userEvent.setup()
    const { onFocusTerminal } = mount()
    const trigger = screen.getByRole('button', { name: 'Quick prompts' })
    await user.click(trigger)
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onFocusTerminal).toHaveBeenCalledOnce()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Draft prompt')
    fireEvent.pointerDown(document.body)
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue('Draft prompt')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue('Draft prompt')
  })

  it('inserts a saved prompt in one click without opening a panel', async () => {
    useAppStore.getState().setQuickPrompts([{ id: 'continue', starred: true, content: 'Continue working' }])
    const user = userEvent.setup()
    const { onInsert, onFocusTerminal } = mount()
    await user.click(screen.getByRole('button', { name: 'Insert Continue working' }))
    expect(onInsert).toHaveBeenCalledExactlyOnceWith('Continue working')
    expect(onFocusTerminal).toHaveBeenCalledOnce()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('Inserted - Enter to send')).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps an unsaved draft across session switches while closing the panel', async () => {
    const user = userEvent.setup()
    const props = { running: true, onInsert: vi.fn(() => null), onFocusTerminal: vi.fn() }
    const { rerender } = render(<QuickPrompts sessionId="first" {...props} />)
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Finish this draft')
    rerender(<QuickPrompts sessionId="second" {...props} />)
    expect(screen.queryByRole('textbox', { name: 'Content' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue('Finish this draft')
    expect(props.onInsert).not.toHaveBeenCalled()
  })

  it('stars a new prompt explicitly and uses its content for the bar button', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    await user.type(screen.getByRole('textbox', { name: 'Content' }), 'Review changes{Enter}Run tests')
    const star = screen.getByRole('button', { name: 'Star in quick bar' })
    expect(star).toHaveAttribute('aria-pressed', 'false')
    await user.click(star)
    await user.click(screen.getByRole('textbox', { name: 'Content' }))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(readStoredQuickPrompts()[0]).toEqual({ id: expect.any(String), starred: true, content: 'Review changes\nRun tests' })
    expect(screen.getByRole('button', { name: 'Insert Review changes Run tests' })).toBeVisible()
  })

  it.each(['win32', 'darwin'] as const)('opens search from the %s terminal without forwarding the shortcut and selects with the keyboard', async (platform) => {
    useAppStore.setState({ platform, quickPrompts: [
      { id: 'review', starred: false, content: 'Review the changes' },
      { id: 'tests', starred: false, content: 'Run tests' }
    ] })
    const user = userEvent.setup()
    const { onInsert } = mount()
    const terminal = screen.getByRole('textbox', { name: 'Terminal input' })
    const terminalKeys = vi.fn()
    terminal.addEventListener('keydown', terminalKeys)
    const event = new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', shiftKey: true,
      ctrlKey: platform === 'win32', metaKey: platform === 'darwin', bubbles: true, cancelable: true })
    fireEvent(terminal, event)
    expect(event.defaultPrevented).toBe(true)
    expect(terminalKeys).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onInsert).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('filters from the keyboard and does not insert while confirming IME composition', async () => {
    useAppStore.setState({ quickPrompts: [{ id: 'review', starred: false, content: 'Check the changes' }] })
    const user = userEvent.setup()
    const { onInsert } = mount()
    await user.click(screen.getByRole('button', { name: 'Quick prompts' }))
    const search = screen.getByRole('combobox')
    await user.type(search, 'changes')
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
    expect(onInsert).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onInsert).toHaveBeenCalledExactlyOnceWith('Check the changes')
  })

  it('shows only starred prompts in the bar and persists star changes from management', async () => {
    useAppStore.getState().setQuickPrompts([
      { id: 'review', starred: false, content: 'Review the changes' },
      { id: 'tests', starred: true, content: 'Run tests' }
    ])
    const user = userEvent.setup()
    mount()
    expect(screen.queryByRole('button', { name: 'Insert Review the changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert Run tests' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Manage prompts' }))
    await user.click(screen.getByRole('button', { name: 'Star prompt Review the changes' }))
    expect(screen.getByRole('button', { name: 'Insert Review the changes' })).toBeVisible()
    expect(readStoredQuickPrompts()[0].starred).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Star prompt Run tests' }))
    expect(screen.queryByRole('button', { name: 'Insert Run tests' })).not.toBeInTheDocument()
    expect(readStoredQuickPrompts()[1].starred).toBe(false)
    expect(screen.getByRole('button', { name: 'Edit Run tests' })).toBeVisible()
  })

  it('keeps the saved star state when persistence fails', async () => {
    useAppStore.getState().setQuickPrompts([{ id: 'tests', starred: false, content: 'Run tests' }])
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Manage prompts' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full') })
    await user.click(screen.getByRole('button', { name: 'Star prompt Run tests' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('button', { name: 'Star prompt Run tests' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Insert Run tests' })).not.toBeInTheDocument()
    expect(readStoredQuickPrompts()[0].starred).toBe(false)
  })
})
