import type { AppState, WorkspaceState } from './contracts'

export const emptyWorkspace = (): WorkspaceState => ({
  activeProjectId: null, activeSessionId: null, collapsedProjectIds: []
})

export const reconcileWorkspace = (workspace: WorkspaceState, state: AppState): WorkspaceState => {
  const projectIds = new Set(state.projects.map((project) => project.id))
  const activeSession = state.sessions.find((session) =>
    session.id === workspace.activeSessionId && projectIds.has(session.projectId)
  )
  const collapsedProjectIds = [...new Set(workspace.collapsedProjectIds.filter((id) => projectIds.has(id)))]
  const sessionIds = new Set(state.sessions.filter((session) => projectIds.has(session.projectId)).map((session) => session.id))
  const unreadSessionIds = workspace.unreadSessionIds
    ? [...new Set(workspace.unreadSessionIds.filter((id) => sessionIds.has(id)))]
    : undefined
  return {
    activeProjectId: workspace.activeProjectId && projectIds.has(workspace.activeProjectId)
      ? workspace.activeProjectId
      : activeSession?.projectId ?? state.projects[0]?.id ?? null,
    activeSessionId: activeSession?.id ?? null,
    collapsedProjectIds: collapsedProjectIds.length === workspace.collapsedProjectIds.length
      ? workspace.collapsedProjectIds
      : collapsedProjectIds,
    ...(unreadSessionIds ? {
      unreadSessionIds: unreadSessionIds.length === workspace.unreadSessionIds!.length
        ? workspace.unreadSessionIds
        : unreadSessionIds
    } : {})
  }
}
