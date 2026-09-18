import { mkdir, realpath, rm, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { CloneProgress, ProjectRecord, RepoRemote } from '../../shared/contracts'
import { cloneProjectRequestSchema, type CloneProjectRequest } from '../../shared/contracts'
import { cloneDirectoryName } from '../../shared/git-clone'
import { normalizeProjectPath } from '../../shared/project-path'
import { commandRunner } from '../infrastructure/command-runner'
import type { CommandRunner } from '../infrastructure/command-runner'
import { parseCloneProgress } from './git-clone-progress'
import { parseRemoteWebUrl } from './git-remote'
import { SessionStore } from './session-store'

export interface ProjectFileSystem {
  realpath(path: string): Promise<string>
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

export class ProjectNotFoundError extends Error {
  readonly projectId: string

  constructor(projectId: string) {
    super(`Project not found: ${projectId}`)
    this.name = 'ProjectNotFoundError'
    this.projectId = projectId
  }
}

export class ProjectOrderMismatchError extends Error {
  constructor() {
    super('The requested project order does not match the current set of projects. Refresh and try again.')
    this.name = 'ProjectOrderMismatchError'
  }
}

export class InvalidProjectPathError extends Error {
  readonly selectedPath: string

  constructor(selectedPath: string, cause?: unknown) {
    super(`Invalid project path: ${selectedPath}${cause instanceof Error ? ` (${cause.message})` : ''}`, { cause })
    this.name = 'InvalidProjectPathError'
    this.selectedPath = selectedPath
  }
}

const productionFileSystem: ProjectFileSystem = { realpath, stat }

/**
 * A clone is declared stuck once Git reports no progress for this long. This replaces a total
 * time budget on purpose: a large repository may legitimately run for hours, but it never runs
 * silently once `--progress` is passed, so "no bytes at all" is the honest stall signal. The
 * failure it catches is a transport that never connects -- e.g. Git ignores the Windows system
 * proxy, so a machine that only has one configured there hangs with zero output.
 */
export const CLONE_IDLE_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Git repaints its progress line many times a second, and every frame would otherwise cross
 * IPC and re-render the dialog. Unlike the updater's download there is no guaranteed final
 * frame: a finished clone closes the dialog and a failed one returns it to the form, so a
 * swallowed last percentage is never seen.
 */
export const CLONE_PROGRESS_INTERVAL_MS = 200

const sameRemote = (left: RepoRemote | undefined, right: RepoRemote | undefined): boolean =>
  left === right || (left !== undefined && right !== undefined && left.host === right.host && left.webUrl === right.webUrl)

const projectWithPath = (projects: readonly ProjectRecord[], candidatePath: string, platform: NodeJS.Platform): ProjectRecord | undefined => {
  const normalizedCandidate = normalizeProjectPath(candidatePath, platform)
  return projects.find((project) => normalizeProjectPath(project.path, platform) === normalizedCandidate)
}

export class ProjectService {
  // Doubles as the "a clone is running" flag, so the guard and the cancel handle can never disagree.
  private cloneRun: AbortController | undefined
  private readonly progressListeners = new Set<(progress: CloneProgress) => void>()

  constructor(
    private readonly store: SessionStore,
    private readonly runner: CommandRunner = commandRunner,
    private readonly fileSystem: ProjectFileSystem = productionFileSystem,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async register(selectedPath: string): Promise<ProjectRecord> {
    if (!selectedPath.trim()) throw new InvalidProjectPathError(selectedPath)

    let realPath: string
    try {
      realPath = await this.fileSystem.realpath(selectedPath)
    } catch (error) {
      throw new InvalidProjectPathError(selectedPath, error)
    }
    let directory: { isDirectory(): boolean }
    try {
      directory = await this.fileSystem.stat(realPath)
    } catch (error) {
      throw new InvalidProjectPathError(selectedPath, error)
    }
    if (!directory.isDirectory()) throw new InvalidProjectPathError(selectedPath)

    const current = await this.store.load()
    const existing = projectWithPath(current.projects, realPath, this.platform)
    if (existing) return existing

    const repoRoot = await this.findRepoRoot(realPath)
    const repoRemote = repoRoot ? await this.findRepoRemote(realPath).catch(() => undefined) : undefined
    const name = (this.platform === 'win32' ? win32 : posix).basename(realPath) || realPath
    const recent = projectWithPath(current.recentProjects ?? [], realPath, this.platform)
    const project: ProjectRecord = {
      id: recent?.id ?? this.createId(),
      name,
      path: realPath,
      ...(repoRoot ? { repoRoot } : {}),
      ...(repoRemote ? { repoRemote } : {}),
      createdAt: recent?.createdAt ?? this.clock().toISOString()
    }

    let persisted = project
    await this.store.update((latest) => {
      const concurrentExisting = projectWithPath(latest.projects, realPath, this.platform)
      if (concurrentExisting) {
        persisted = concurrentExisting
        return latest
      }
      return {
        ...latest,
        projects: [...latest.projects, project],
        ...(latest.recentProjects ? {
          recentProjects: latest.recentProjects.filter((entry) =>
            entry.id !== project.id && normalizeProjectPath(entry.path, this.platform) !== normalizeProjectPath(realPath, this.platform))
        } : {})
      }
    })
    return persisted
  }

  async removeRecent(projectId: string): Promise<void> {
    await this.store.update((state) => {
      if (!state.recentProjects?.some((project) => project.id === projectId)) {
        throw new ProjectNotFoundError(projectId)
      }
      return { ...state, recentProjects: state.recentProjects.filter((project) => project.id !== projectId) }
    })
  }

  async reopen(projectId: string): Promise<ProjectRecord> {
    const state = await this.store.load()
    const project = [...state.projects, ...(state.recentProjects ?? [])].find((entry) => entry.id === projectId)
    if (!project) throw new ProjectNotFoundError(projectId)
    return this.register(project.path)
  }

  /** Subscribes to clone progress for as long as a clone is running. Returns an unsubscribe. */
  onProgress(listener: (progress: CloneProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  private emitProgress(progress: CloneProgress): void {
    for (const listener of [...this.progressListeners]) {
      try {
        listener(progress)
      } catch {
        // A subscriber failure must not abort the clone or starve the other subscribers.
      }
    }
  }

  async clone(request: CloneProjectRequest): Promise<ProjectRecord> {
    const { repositoryUrl, targetDirectory } = cloneProjectRequestSchema.parse(request)
    if (this.cloneRun) throw new Error('A Git clone is already in progress.')
    const controller = new AbortController()
    this.cloneRun = controller
    try {
      const paths = this.platform === 'win32' ? win32 : posix
      if (!paths.isAbsolute(targetDirectory)) throw new InvalidProjectPathError(targetDirectory)
      const parent = await this.fileSystem.realpath(targetDirectory)
      if (!(await this.fileSystem.stat(parent)).isDirectory()) throw new InvalidProjectPathError(targetDirectory)
      const destination = paths.join(parent, cloneDirectoryName(repositoryUrl)!)
      // Reserve a new directory exclusively; an existing folder is never a clone target.
      try {
        await mkdir(destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`The destination already exists: ${destination}`)
        throw error
      }
      let lastProgressAt = 0
      try {
        await this.runner.run('git', ['-c', 'credential.interactive=false', 'clone', '--progress', '--', repositoryUrl, destination], parent, {
          idleTimeoutMs: CLONE_IDLE_TIMEOUT_MS,
          env: { GIT_TERMINAL_PROMPT: '0' },
          signal: controller.signal,
          onOutput: (chunk) => {
            const progress = parseCloneProgress(chunk)
            if (!progress) return
            const at = this.clock().getTime()
            if (at - lastProgressAt < CLONE_PROGRESS_INTERVAL_MS) return
            lastProgressAt = at
            this.emitProgress(progress)
          }
        })
      } catch (error) {
        // Drop the whole reservation. It is a directory this method created exclusively and
        // nothing but clone output ever lands in it, so keeping a half-fetched repository only
        // makes the next attempt fail at mkdir with "already exists" -- which the user can then
        // only escape by deleting the folder by hand.
        await rm(destination, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return await this.register(destination)
    } finally {
      this.cloneRun = undefined
    }
  }

  /**
   * Ends a running clone along with the Git child processes holding the connection. A no-op
   * when nothing is running, so a late click after the clone already finished is harmless.
   */
  cancelClone(): void {
    this.cloneRun?.abort()
  }

  /**
   * Persists a new display order for the projects. The order must be an exact permutation
   * of the projects persisted at commit time — validated inside the update transaction so a
   * project registered concurrently (after the renderer read its stale list) is never
   * silently dropped. Returns the reordered records.
   */
  async reorder(orderedProjectIds: readonly string[]): Promise<ProjectRecord[]> {
    let reordered: ProjectRecord[] = []
    await this.store.update((latest) => {
      const byId = new Map(latest.projects.map((project) => [project.id, project]))
      const isPermutation =
        orderedProjectIds.length === byId.size &&
        new Set(orderedProjectIds).size === orderedProjectIds.length &&
        orderedProjectIds.every((id) => byId.has(id))
      if (!isPermutation) throw new ProjectOrderMismatchError()

      reordered = orderedProjectIds.map((id) => byId.get(id)!)
      return { ...latest, projects: reordered }
    })
    return reordered
  }

  async get(projectId: string): Promise<ProjectRecord> {
    const project = (await this.store.load()).projects.find((candidate) => candidate.id === projectId)
    if (!project) throw new ProjectNotFoundError(projectId)
    return project
  }

  /**
   * Re-resolves every project's browsable remote and persists the result in one write when
   * anything differs. Run on startup so projects registered before remotes were recorded
   * pick theirs up, and so a remote that was added, changed, or removed since the last run
   * is reflected. A project whose `git` invocation fails (folder gone, git missing) keeps
   * whatever it had — a transient failure must not strip the menu entry. Never rejects: the
   * snapshot this feeds must still load when Git is unavailable altogether.
   */
  async refreshRemotes(): Promise<void> {
    try {
      const { projects } = await this.store.load()
      const resolved = await Promise.all(
        projects.map(async (project) => {
          try {
            return { id: project.id, repoRemote: await this.findRepoRemote(project.path) }
          } catch {
            return { id: project.id, repoRemote: project.repoRemote }
          }
        })
      )
      const remoteById = new Map(resolved.map((entry) => [entry.id, entry.repoRemote]))
      const changed = projects.some((project) => !sameRemote(project.repoRemote, remoteById.get(project.id)))
      if (!changed) return

      await this.store.update((latest) => ({
        ...latest,
        projects: latest.projects.map((project) => {
          if (!remoteById.has(project.id)) return project
          const { repoRemote: _previous, ...rest } = project
          const repoRemote = remoteById.get(project.id)
          return repoRemote ? { ...rest, repoRemote } : rest
        })
      }))
    } catch (error) {
      console.error('ProjectService: failed to refresh repository remotes.', error)
    }
  }

  /**
   * The browsable page of the project's remote, preferring `origin` and otherwise the first
   * remote Git lists. Resolves `undefined` when there is no remote or it is not a web URL
   * (see parseRemoteWebUrl); rejects only when `git` itself fails to run.
   */
  private async findRepoRemote(realPath: string): Promise<RepoRemote | undefined> {
    const listed = await this.runner.run('git', ['-C', realPath, 'remote'])
    const names = listed.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0)
    const name = names.includes('origin') ? 'origin' : names[0]
    if (!name) return undefined

    const url = await this.runner.run('git', ['-C', realPath, 'remote', 'get-url', name])
    return parseRemoteWebUrl(url.stdout)
  }

  private async findRepoRoot(realPath: string): Promise<string | undefined> {
    try {
      const result = await this.runner.run('git', ['-C', realPath, 'rev-parse', '--show-toplevel'])
      const output = result.stdout.trim()
      return output ? (this.platform === 'win32' ? win32 : posix).resolve(output) : undefined
    } catch {
      return undefined
    }
  }
}
