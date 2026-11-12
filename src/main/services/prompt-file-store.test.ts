import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

  it('names the result file next to the prompt and reads it back once the agent wrote it', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)

    expect(store.resultPath('session-a')).toBe(join(root, 'session-a.result.json'))
    expect(await store.readResult('session-a')).toBeUndefined()

    await writeFile(store.resultPath('session-a'), '{"issue": null}\n', 'utf8')
    expect(await store.readResult('session-a')).toBe('{"issue": null}\n')
  })

  // Windows PowerShell 5.1's `>` writes UTF-16LE; an agent that reaches for it must still be heard.
  it('decodes a UTF-16 result file by its byte-order mark', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)

    await writeFile(store.resultPath('session-a'), Buffer.from('﻿{"issue": 42, "title": "Fix"}', 'utf16le'))
    expect(await store.readResult('session-a')).toBe('{"issue": 42, "title": "Fix"}')
  })

  it('removes the result file together with the prompt', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)
    await store.write('session-a', 'x')
    await writeFile(store.resultPath('session-a'), '{"issue": null}', 'utf8')

    await store.remove('session-a')
    await expect(stat(store.resultPath('session-a'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('names the report file apart from the result file, reads it, and removes it on its own', async () => {
    const root = await temporaryDirectory()
    const store = new DirectoryPromptFileStore(root)
    expect(store.reportPath('session-a')).toBe(join(root, 'session-a.report.json'))
    await expect(store.readReport('session-a')).resolves.toBeUndefined()

    await store.write('session-a', 'x')
    await writeFile(store.reportPath('session-a'), '{"status":"done","summary":"ok"}', 'utf8')
    await expect(store.readReport('session-a')).resolves.toBe('{"status":"done","summary":"ok"}')

    await store.removeReport('session-a')
    await expect(stat(store.reportPath('session-a'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'session-a.md'), 'utf8')).resolves.toBe('x')
    await expect(store.removeReport('session-a')).resolves.toBeUndefined()
  })

  it('decodes a UTF-16 report file and removes it with the prompt', async () => {
    const store = new DirectoryPromptFileStore(await temporaryDirectory())
    await store.write('session-a', 'x')
    await writeFile(store.reportPath('session-a'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"a":1}', 'utf16le')]))
    await expect(store.readReport('session-a')).resolves.toBe('{"a":1}')

    await store.remove('session-a')
    await expect(stat(store.reportPath('session-a'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a session id that is not a plain identifier', async () => {
    const store = new DirectoryPromptFileStore(await temporaryDirectory())

    await expect(store.write('..\\escape', 'x')).rejects.toThrow('Refusing to name a prompt file')
    await expect(store.remove('..\\escape')).resolves.toBeUndefined()
    expect(() => store.resultPath('..\\escape')).toThrow('Refusing to name a prompt file')
    await expect(store.readResult('..\\escape')).resolves.toBeUndefined()
    expect(() => store.reportPath('..\\escape')).toThrow('Refusing to name a prompt file')
    await expect(store.readReport('..\\escape')).resolves.toBeUndefined()
    await expect(store.removeReport('..\\escape')).resolves.toBeUndefined()
  })
})

describe('unavailablePromptFileStore', () => {
  it('rejects writes, ignores removals and never has a result', async () => {
    await expect(unavailablePromptFileStore.write('s', 'x')).rejects.toThrow('Prompt files are not configured.')
    await expect(unavailablePromptFileStore.remove('s')).resolves.toBeUndefined()
    expect(() => unavailablePromptFileStore.resultPath('s')).toThrow('Prompt files are not configured.')
    await expect(unavailablePromptFileStore.readResult('s')).resolves.toBeUndefined()
  })
})
