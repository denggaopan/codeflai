import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react'

export type DropPlacement = 'before' | 'after'

type DragSource = { id: string; surface: string }
type DropTarget = DragSource & { placement: DropPlacement }

/**
 * Drag-to-reorder for a list, shared by quick prompts and session rows.
 *
 * `surface` scopes a drag: a source can only be dropped on a target declaring the same
 * surface, which is how session rows stay inside their own project without a separate check.
 * `mimeType` must be caller-specific and must never be text/plain — dropping a row onto xterm
 * has to be inert rather than pasting itself as a command. The click that would otherwise fire
 * at the end of a drag is suppressed through rootProps, which for a session row would
 * otherwise switch terminals.
 */
export function useDragSort(
  mimeType: string,
  onMove: (sourceId: string, targetId: string, placement: DropPlacement) => void
) {
  const activeRef = useRef<DragSource | null>(null)
  const suppressClickRef = useRef(false)
  const [source, setSource] = useState<DragSource | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)

  const cancel = useCallback(() => {
    activeRef.current = null
    setSource(null)
    setTarget(null)
  }, [])

  const sourceProps = (id: string, surface: string, enabled: boolean) => ({
    draggable: enabled,
    'data-dragging': source?.id === id && source.surface === surface ? 'true' : undefined,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (!enabled) {
        event.preventDefault()
        return
      }
      event.stopPropagation()
      // Never offer text/plain: dropping a row on xterm must not paste a command.
      event.dataTransfer.setData(mimeType, id)
      event.dataTransfer.effectAllowed = 'move'
      activeRef.current = { id, surface }
      suppressClickRef.current = true
      setSource({ id, surface })
      setTarget(null)
    },
    onDragEnd: cancel
  })

  const targetProps = (id: string, surface: string, enabled: boolean) => {
    const destination = (event: DragEvent<HTMLElement>): DropTarget | null => {
      const active = activeRef.current
      if (!enabled || !active || active.surface !== surface || active.id === id) return null
      const rect = event.currentTarget.getBoundingClientRect()
      const before = surface === 'bar' ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2
      return { id, surface, placement: before ? 'before' : 'after' }
    }
    return {
      'data-drop-position': target?.id === id && target.surface === surface ? target.placement : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const next = destination(event)
        if (next) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
        }
        setTarget((current) => current?.id === next?.id && current?.placement === next?.placement && current?.surface === next?.surface ? current : next)
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setTarget((current) => current?.id === id && current.surface === surface ? null : current)
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const next = destination(event)
        const active = activeRef.current
        if (next && active) {
          event.preventDefault()
          event.stopPropagation()
          onMove(active.id, next.id, next.placement)
        }
        cancel()
      }
    }
  }

  const resetClick = (): void => { suppressClickRef.current = false }
  return {
    cancel, sourceProps, targetProps,
    rootProps: {
      onPointerDownCapture: resetClick,
      onKeyDownCapture: resetClick,
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
      }
    }
  }
}
