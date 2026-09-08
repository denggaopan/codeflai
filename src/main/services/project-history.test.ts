import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { AppState, ProjectRecord } from '../../shared/contracts'
import { ProjectNotFoundError, ProjectService } from './project-service'
import { SessionStore } from './session-store'

const project = (id: string, path = `C:\\${id}`): ProjectRecord => ({
  id, name: id, path, createdAt: '2026-09-08T00:00:00.000Z'
})

describe('ProjectService.removeRecent', () => {
  it('persists only the selected history deletion across restarts and preserves project files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codeflai-remove-history-'))
    try {
      const file = join(directory, 'state.json')
      const marker = join(directory, 'project.txt')
      await writeFile(marker, 'keep project contents')
      const current = project('current')
      const recent = project('recent', directory)
      const other = project('other')
      const state: AppState = {
        version: 1, projects: [current], recentProjects: [recent, other],
        sessions: [{ id: 'session', projectId: current.id, kind: 'cmd', title: 'Session', titleState: 'pending', createdAt: current.createdAt, mode: 'ordinary', launchPath: current.path, status: 'stopped' }]
      }
      const store = new SessionStore(file)
      await store.save(state)
      await new ProjectService(store).removeRecent(recent.id)
      expect(await new SessionStore(file).load()).toEqual({ ...state, recentProjects: [other] })
      expect(await readFile(marker, 'utf8')).toBe('keep project contents')
      await new ProjectService(store).removeRecent(other.id)
      expect((await new SessionStore(file).load()).recentProjects).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects unknown or current-only ids and never probes the historical folder', async () => {
    const current = project('current')
    const state: AppState = { version: 1, projects: [current], sessions: [] }
    const store = { update: vi.fn(async (mutator) => mutator(structuredClone(state))) } as unknown as SessionStore
    const fileSystem = { realpath: vi.fn(), stat: vi.fn() }
    const service = new ProjectService(store, undefined, fileSystem)
    await expect(service.removeRecent('unknown')).rejects.toBeInstanceOf(ProjectNotFoundError)
    await expect(service.removeRecent(current.id)).rejects.toBeInstanceOf(ProjectNotFoundError)
    expect(fileSystem.realpath).not.toHaveBeenCalled()
    expect(fileSystem.stat).not.toHaveBeenCalled()
    expect(state.projects).toEqual([current])
  })

  it('propagates persistence errors', async () => {
    const store = { update: vi.fn().mockRejectedValue(new Error('disk full')) } as unknown as SessionStore
    await expect(new ProjectService(store).removeRecent('recent')).rejects.toThrow('disk full')
  })
})
