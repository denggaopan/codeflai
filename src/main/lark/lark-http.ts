import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { HttpInstance, HttpRequestOptions } from '@larksuiteoapi/node-sdk'

/**
 * Every Lark API call gives up after this long without progress. The SDK's default HTTP
 * instance has no timeout at all, and the bridge handles messages one at a time, so one hung
 * request (a name lookup, a quoted message, a reply) would stall every message behind it.
 */
export const LARK_HTTP_TIMEOUT_MS = 15_000

/** An image larger than this is not downloaded; the session starts without it. */
export const LARK_IMAGE_MAX_BYTES = 20 * 1024 * 1024

export class LarkImageTooLargeError extends Error {
  constructor() {
    super(`The image is larger than ${LARK_IMAGE_MAX_BYTES} bytes.`)
    this.name = 'LarkImageTooLargeError'
  }
}

/**
 * Wraps the SDK's default HTTP instance (an axios instance carrying the SDK's own interceptors:
 * the User-Agent, and the response interceptor that unwraps `data` and honours
 * `$return_headers`) so every request gets a timeout unless the caller set its own. Wrapping
 * rather than building a new axios instance keeps those interceptors exactly as the SDK
 * version in use defines them.
 */
export function withRequestTimeout(base: HttpInstance, timeoutMs: number = LARK_HTTP_TIMEOUT_MS): HttpInstance {
  const timed = <D>(options?: HttpRequestOptions<D>): HttpRequestOptions<D> => ({ ...options, timeout: options?.timeout ?? timeoutMs })
  return {
    request: <T, R, D>(options: HttpRequestOptions<D>) => base.request<T, R, D>(timed(options)),
    get: <T, R, D>(url: string, options?: HttpRequestOptions<D>) => base.get<T, R, D>(url, timed(options)),
    delete: <T, R, D>(url: string, options?: HttpRequestOptions<D>) => base.delete<T, R, D>(url, timed(options)),
    head: <T, R, D>(url: string, options?: HttpRequestOptions<D>) => base.head<T, R, D>(url, timed(options)),
    options: <T, R, D>(url: string, options?: HttpRequestOptions<D>) => base.options<T, R, D>(url, timed(options)),
    post: <T, R, D>(url: string, data?: D, options?: HttpRequestOptions<D>) => base.post<T, R, D>(url, data, timed(options)),
    put: <T, R, D>(url: string, data?: D, options?: HttpRequestOptions<D>) => base.put<T, R, D>(url, data, timed(options)),
    patch: <T, R, D>(url: string, data?: D, options?: HttpRequestOptions<D>) => base.patch<T, R, D>(url, data, timed(options))
  }
}

/**
 * Streams `source` into `targetPath`, aborting as soon as more than `maxBytes` have arrived (or
 * up front, when the declared length is already too large). On any failure the source is
 * destroyed, which aborts the download, and the partial file is removed.
 */
export async function writeCapped(
  source: Readable,
  targetPath: string,
  maxBytes: number = LARK_IMAGE_MAX_BYTES,
  declaredLength?: unknown
): Promise<void> {
  const declared = Number(declaredLength)
  if (declaredLength !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    source.destroy()
    throw new LarkImageTooLargeError()
  }
  let received = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > maxBytes) callback(new LarkImageTooLargeError())
      else callback(null, chunk)
    }
  })
  try {
    await pipeline(source, limit, createWriteStream(targetPath))
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined)
    throw error
  }
}
