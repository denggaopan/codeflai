import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DirectoryPromptFileStore, unavailablePromptFileStore } from './prompt-file-store'

const created: string[] = []

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'codeflai-prompt-store-'))
  created.push(directory)
  return directory
}

afterEach(async () => {
  for (const directory of created.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('DirectoryPromptFileStore', () => {
  it('writes the prompt under <directory>/<sessionId>.md, creating the directory on demand', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(join(root, 'issue-automation'))

    const path = await store.write('3f2a1b4c-0000-4000-8000-000000000001', 'Do the thing\n')

    expect(path).toBe(join(root, 'issue-automation', '3f2a1b4c-0000-4000-8000-000000000001.md'))
    expect(await readFile(path, 'utf8')).toBe('Do the thing\n')
  })

  it('removes a written file, and tolerates a missing one', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)
    const path = await store.write('session-a', 'x')

    await store.remove('session-a')
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(store.remove('session-a')).resolves.toBeUndefined()
  })

  it('refuses a session id that is not a plain identifier', async () => {
    const store = new DirectoryPromptFileStore(await temporaryDirectory())

    await expect(store.write('..\\escape', 'x')).rejects.toThrow('Refusing to name a prompt file')
    await expect(store.remove('..\\escape')).resolves.toBeUndefined()
  })
})

describe('unavailablePromptFileStore', () => {
  it('rejects writes and ignores removals', async () => {
    await expect(unavailablePromptFileStore.write('s', 'x')).rejects.toThrow('Prompt files are not configured.')
    await expect(unavailablePromptFileStore.remove('s')).resolves.toBeUndefined()
  })
})
