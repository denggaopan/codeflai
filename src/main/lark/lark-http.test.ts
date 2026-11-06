import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import type { HttpInstance, HttpRequestOptions } from '@larksuiteoapi/node-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LARK_HTTP_TIMEOUT_MS, LARK_IMAGE_MAX_BYTES, LarkImageTooLargeError, withRequestTimeout, writeCapped } from './lark-http'

describe('withRequestTimeout', () => {
  const recording = () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const record =
      (method: string) =>
      async (...args: unknown[]): Promise<unknown> => {
        calls.push({ method, args })
        return 'answer'
      }
    const base = {
      request: record('request'),
      get: record('get'),
      delete: record('delete'),
      head: record('head'),
      options: record('options'),
      post: record('post'),
      put: record('put'),
      patch: record('patch')
    } as unknown as HttpInstance
    return { calls, base }
  }

  it('adds the timeout to every kind of request and passes the answer through', async () => {
    const { calls, base } = recording()
    const http = withRequestTimeout(base)
    const options: HttpRequestOptions<unknown> = { headers: { a: '1' }, $return_headers: true, responseType: 'stream' }
    expect(await http.request({ url: '/x', ...options })).toBe('answer')
    await http.get('/g', options)
    await http.delete('/d')
    await http.head('/h')
    await http.options('/o')
    await http.post('/p', { body: 1 }, options)
    await http.put('/u', { body: 2 })
    await http.patch('/a', { body: 3 })

    expect(calls.map((call) => call.method)).toEqual(['request', 'get', 'delete', 'head', 'options', 'post', 'put', 'patch'])
    expect(calls[0]!.args).toEqual([{ url: '/x', ...options, timeout: LARK_HTTP_TIMEOUT_MS }])
    expect(calls[1]!.args).toEqual(['/g', { ...options, timeout: LARK_HTTP_TIMEOUT_MS }])
    expect(calls[2]!.args).toEqual(['/d', { timeout: LARK_HTTP_TIMEOUT_MS }])
    expect(calls[5]!.args).toEqual(['/p', { body: 1 }, { ...options, timeout: LARK_HTTP_TIMEOUT_MS }])
    expect(calls[6]!.args).toEqual(['/u', { body: 2 }, { timeout: LARK_HTTP_TIMEOUT_MS }])
    expect(LARK_HTTP_TIMEOUT_MS).toBe(15_000)
  })

  it("keeps a caller's own timeout", async () => {
    const { calls, base } = recording()
    await withRequestTimeout(base, 15_000).request({ url: '/x', timeout: 500 })
    expect(calls[0]!.args).toEqual([{ url: '/x', timeout: 500 }])
  })
})

describe('writeCapped', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'codeflai-lark-http-'))
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const chunks = (count: number, size: number): Readable =>
    Readable.from(Array.from({ length: count }, () => Buffer.alloc(size, 1)))

  it('writes a stream within the limit', async () => {
    const target = join(directory, '0.png')
    await writeCapped(chunks(3, 4), target, 12)
    expect((await readFile(target)).length).toBe(12)
  })

  it('aborts a stream that grows past the limit and removes the partial file', async () => {
    const target = join(directory, '0.png')
    const source = chunks(4, 4)
    await expect(writeCapped(source, target, 12)).rejects.toBeInstanceOf(LarkImageTooLargeError)
    expect(source.destroyed).toBe(true)
    await expect(stat(target)).rejects.toThrow()
  })

  it('refuses up front when the declared length is too large', async () => {
    const target = join(directory, '0.png')
    const source = chunks(1, 4)
    await expect(writeCapped(source, target, 12, '13')).rejects.toBeInstanceOf(LarkImageTooLargeError)
    expect(source.destroyed).toBe(true)
    await expect(stat(target)).rejects.toThrow()
  })

  it('ignores an unreadable declared length and still counts the bytes', async () => {
    const target = join(directory, '0.png')
    await writeCapped(chunks(1, 4), target, 12, 'nonsense')
    expect((await readFile(target)).length).toBe(4)
  })

  it('caps images at 20 MiB', () => {
    expect(LARK_IMAGE_MAX_BYTES).toBe(20 * 1024 * 1024)
  })
})
