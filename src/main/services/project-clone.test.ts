// @vitest-environment node
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandError, commandRunner, type CommandRunner } from '../infrastructure/command-runner'
import { CLONE_IDLE_TIMEOUT_MS, ProjectService } from './project-service'
import { SessionStore } from './session-store'

describe('ProjectService.clone', () => {
  let directory: string
  let store: SessionStore
  const repositoryUrl = 'https://example.com/team/my-repo.git'

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'codeflai-clone-'))
    directory = await realpath(directory)
    store = new SessionStore(join(directory, 'state.json'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }, 30_000)

  it('clones with real Git and registers the checked-out directory after success', async () => {
    const source = join(directory, 'source')
    await mkdir(source)
    await commandRunner.run('git', ['init', source])
    await writeFile(join(source, 'README.md'), 'cloned content\n')
    await commandRunner.run('git', ['-C', source, 'add', 'README.md'])
    await commandRunner.run('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial'])
    // Substitute a local fixture for the network transport; Git still performs the clone.
    const run = vi.fn<CommandRunner['run']>((file, args, cwd, options) =>
      commandRunner.run(file, args.map((arg) => arg === repositoryUrl ? source : arg), cwd, options))
    const service = new ProjectService(store, { run })

    const project = await service.clone({ repositoryUrl, targetDirectory: directory })

    expect(project.path).toBe(join(directory, 'my-repo'))
    expect(project.repoRoot).toBe(project.path)
    expect((await readFile(join(project.path, 'README.md'), 'utf8')).replace(/\r\n/gu, '\n')).toBe('cloned content\n')
    expect((await store.load()).projects).toEqual([project])
    // --progress is what makes the idle timeout meaningful: without it Git stays silent on a
    // pipe, so every healthy clone would look exactly like a stalled transport.
    expect(run).toHaveBeenCalledWith('git', ['-c', 'credential.interactive=false', 'clone', '--progress', '--', repositoryUrl, project.path], directory, {
      idleTimeoutMs: CLONE_IDLE_TIMEOUT_MS,
      env: { GIT_TERMINAL_PROMPT: '0' },
      signal: expect.any(AbortSignal)
    })
  }, 30_000)

  it('leaves an existing destination untouched, even when it is empty', async () => {
    const destination = join(directory, 'my-repo')
    await mkdir(destination)
    const run = vi.fn()
    const service = new ProjectService(store, { run })

    await expect(service.clone({ repositoryUrl, targetDirectory: directory })).rejects.toThrow('already exists')
    expect(run).not.toHaveBeenCalled()
    expect((await stat(destination)).isDirectory()).toBe(true)
    expect((await store.load()).projects).toEqual([])
  })

  it('rejects invalid input before creating a destination or starting Git', async () => {
    const run = vi.fn()
    const service = new ProjectService(store, { run })
    await expect(service.clone({ repositoryUrl: '--upload-pack=evil', targetDirectory: directory })).rejects.toThrow()
    await expect(service.clone({ repositoryUrl, targetDirectory: 'relative' })).rejects.toThrow('Invalid project path')
    await expect(service.clone({ repositoryUrl, targetDirectory: join(directory, 'missing') })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
    await expect(stat(join(directory, 'my-repo'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes an empty reservation after failure and allows a retry', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Authentication failed'))
    const service = new ProjectService(store, { run })
    const request = { repositoryUrl, targetDirectory: directory }

    await expect(service.clone(request)).rejects.toThrow('Authentication failed')
    await expect(stat(join(directory, 'my-repo'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.clone(request)).rejects.toThrow('Authentication failed')
    expect(run).toHaveBeenCalledTimes(2)
    expect((await store.load()).projects).toEqual([])
  })

  it('clears a partially cloned directory so the next attempt can start', async () => {
    const run = vi.fn(async () => {
      await writeFile(join(directory, 'my-repo', 'partial'), 'half a repository')
      throw new Error('Connection lost')
    })
    const service = new ProjectService(store, { run })
    const request = { repositoryUrl, targetDirectory: directory }

    await expect(service.clone(request)).rejects.toThrow('Connection lost')
    await expect(stat(join(directory, 'my-repo'))).rejects.toMatchObject({ code: 'ENOENT' })
    // Retrying must reach Git again rather than tripping over its own leftover reservation.
    await expect(service.clone(request)).rejects.toThrow('Connection lost')
    expect(run).toHaveBeenCalledTimes(2)
    expect((await store.load()).projects).toEqual([])
  })

  it('cancels a running clone and clears the reserved directory', async () => {
    let started!: () => void
    const running = new Promise<void>((resolve) => { started = resolve })
    const run = vi.fn<CommandRunner['run']>((file, args, _cwd, options) => new Promise((_resolve, reject) => {
      started()
      options?.signal?.addEventListener('abort', () => {
        reject(new CommandError('Command cancelled: git', file, args, { stdout: '', stderr: '', exitCode: -1 }, { reason: 'cancelled' }))
      })
    }))
    const service = new ProjectService(store, { run })

    const pending = service.clone({ repositoryUrl, targetDirectory: directory })
    const failed = expect(pending).rejects.toMatchObject({ reason: 'cancelled' })
    await running
    service.cancelClone()
    await failed

    await expect(stat(join(directory, 'my-repo'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await store.load()).projects).toEqual([])
  })

  it('accepts a new clone after the previous one was cancelled', async () => {
    const run = vi.fn<CommandRunner['run']>((file, args, _cwd, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new CommandError('Command cancelled: git', file, args, { stdout: '', stderr: '', exitCode: -1 }, { reason: 'cancelled' }))
      })
    }))
    const service = new ProjectService(store, { run })
    const request = { repositoryUrl, targetDirectory: directory }

    const first = expect(service.clone(request)).rejects.toMatchObject({ reason: 'cancelled' })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    service.cancelClone()
    await first

    const second = expect(service.clone(request)).rejects.toMatchObject({ reason: 'cancelled' })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    service.cancelClone()
    await second
  })

  it('ignores a cancel request when no clone is running', () => {
    const service = new ProjectService(store, { run: vi.fn() })

    expect(() => service.cancelClone()).not.toThrow()
  })

  it('rejects duplicate submissions while a clone is running', async () => {
    let rejectClone!: (reason: Error) => void
    const run = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectClone = reject }))
    const service = new ProjectService(store, { run })
    const request = { repositoryUrl, targetDirectory: directory }
    const first = service.clone(request)
    const failed = expect(first).rejects.toThrow('cancelled test')
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await expect(service.clone(request)).rejects.toThrow('already in progress')
    rejectClone(new Error('cancelled test'))
    await failed
  })
})
