import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LarkStore, LARK_PAIRING_MAX_FAILURES, LARK_PAIRING_TTL_MS, LARK_PROCESSED_LIMIT, type ReadText, type SecretCipher } from './lark-store'

class FakeCipher implements SecretCipher {
  available = true
  isAvailable(): boolean {
    return this.available
  }
  encrypt(plain: string): string {
    return Buffer.from(`enc:${plain}`, 'utf8').toString('base64')
  }
  decrypt(cipher: string): string {
    return Buffer.from(cipher, 'base64').toString('utf8').replace(/^enc:/u, '')
  }
}

describe('LarkStore', () => {
  let directory: string
  let now: Date
  let nextRandom: number
  let cipher: FakeCipher

  const build = (): LarkStore => new LarkStore(directory, cipher, () => now, () => nextRandom)

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'codeflai-lark-store-'))
    now = new Date('2026-11-06T10:00:00.000Z')
    nextRandom = 123456
    cipher = new FakeCipher()
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const config = { enabled: true, domain: 'feishu' as const, appId: 'cli_a1' }

  const bindOwner = async (store: LarkStore, openId = 'ou_owner', name = 'Owner'): Promise<void> => {
    await store.startPairing('owner')
    expect(await store.redeemPairing('123456', openId, name)).toBe('added')
  }

  it('never exposes the secret in status', async () => {
    const store = build()
    await store.saveConfig({ ...config, appSecret: 'super-secret-value' })
    const status = await store.status('connected')
    expect(status.secretSet).toBe(true)
    const serialized = JSON.stringify(status)
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain(cipher.encrypt('super-secret-value'))
    expect(status).toMatchObject({ enabled: true, domain: 'feishu', appId: 'cli_a1', connection: 'connected', members: [] })
  })

  it('stores the secret encrypted on disk', async () => {
    await build().saveConfig({ ...config, appSecret: 'super-secret-value' })
    const raw = await readFile(join(directory, 'config.json'), 'utf8')
    expect(raw).not.toContain('super-secret-value')
  })

  it('keeps the secret when saving without one', async () => {
    const store = build()
    await store.saveConfig({ ...config, appSecret: 'keep-me' })
    await store.saveConfig({ ...config, appId: 'cli_b2' })
    expect(await store.credentials()).toEqual({ domain: 'feishu', appId: 'cli_b2', appSecret: 'keep-me' })
  })

  it('returns no credentials when disabled or incomplete', async () => {
    const store = build()
    expect(await store.credentials()).toBeUndefined()
    await store.saveConfig({ ...config, appSecret: 's' })
    await store.saveConfig({ ...config, enabled: false })
    expect(await store.credentials()).toBeUndefined()
    await store.saveConfig({ enabled: true, domain: 'lark', appId: '' })
    expect(await store.credentials()).toBeUndefined()
  })

  it('refuses a secret when secure storage is unavailable', async () => {
    cipher.available = false
    await expect(build().saveConfig({ ...config, appSecret: 'x' })).rejects.toThrow('Secure storage is not available on this system.')
  })

  it('requires an owner before pairing a member', async () => {
    await expect(build().startPairing('member')).rejects.toThrow('Bind an owner first.')
  })

  it('redeems a pending code once', async () => {
    const store = build()
    await store.startPairing('owner')
    expect((await store.status('off')).pairing).toMatchObject({ code: '123456', role: 'owner' })
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('added')
    expect(await store.redeemPairing('123456', 'ou_2', 'Bob')).toBe('invalid')
    expect((await store.status('off')).pairing).toBeUndefined()
    expect(await store.memberFor('ou_2')).toBeUndefined()
  })

  it('pads codes to six digits', async () => {
    nextRandom = 42
    const store = build()
    await store.startPairing('owner')
    expect((await store.status('off')).pairing?.code).toBe('000042')
  })

  it('leaves the pending code in place after a wrong guess', async () => {
    const store = build()
    await store.startPairing('owner')
    expect(await store.redeemPairing('999999', 'ou_1', 'Alice')).toBe('invalid')
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('added')
  })

  it('rejects an expired code', async () => {
    const store = build()
    await store.startPairing('owner')
    now = new Date(now.getTime() + LARK_PAIRING_TTL_MS + 1)
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('invalid')
    expect(await store.owner()).toBeUndefined()
  })

  it('accepts a code right at the deadline', async () => {
    const store = build()
    await store.startPairing('owner')
    now = new Date(now.getTime() + LARK_PAIRING_TTL_MS)
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('added')
  })

  it('replaces a pending code when a new one is generated', async () => {
    const store = build()
    await store.startPairing('owner')
    nextRandom = 654321
    await store.startPairing('owner')
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('invalid')
    expect(await store.redeemPairing('654321', 'ou_1', 'Alice')).toBe('added')
  })

  it('a new owner replaces the old one', async () => {
    const store = build()
    await bindOwner(store, 'ou_old', 'Old')
    await store.startPairing('owner')
    expect(await store.redeemPairing('123456', 'ou_new', 'New')).toBe('added')
    expect((await store.owner())?.openId).toBe('ou_new')
    expect(await store.memberFor('ou_old')).toBeUndefined()
    expect((await store.status('off')).members).toHaveLength(1)
  })

  it('promotes an existing member to owner without duplicating', async () => {
    const store = build()
    await bindOwner(store, 'ou_owner', 'Owner')
    await store.startPairing('member')
    expect(await store.redeemPairing('123456', 'ou_mate', 'Mate')).toBe('added')
    await store.startPairing('owner')
    expect(await store.redeemPairing('123456', 'ou_mate', 'Mate 2')).toBe('added')
    const { members } = await store.status('off')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ openId: 'ou_mate', role: 'owner', name: 'Mate 2' })
  })

  it('updates name and role instead of duplicating a member', async () => {
    const store = build()
    await bindOwner(store)
    await store.startPairing('member')
    await store.redeemPairing('123456', 'ou_mate', 'Mate')
    await store.startPairing('member')
    await store.redeemPairing('123456', 'ou_mate', 'Mate Renamed')
    const mates = (await store.status('off')).members.filter((member) => member.openId === 'ou_mate')
    expect(mates).toEqual([expect.objectContaining({ name: 'Mate Renamed', role: 'member' })])
  })

  it('removing a member revokes it immediately', async () => {
    const store = build()
    await bindOwner(store)
    await store.startPairing('member')
    await store.redeemPairing('123456', 'ou_mate', 'Mate')
    expect(await store.memberFor('ou_mate')).toBeDefined()
    await store.removeMember('ou_mate')
    expect(await store.memberFor('ou_mate')).toBeUndefined()
    expect(await build().memberFor('ou_mate')).toBeUndefined()
  })

  it('markProcessed is persistent and bounded', async () => {
    const seeded = Array.from({ length: LARK_PROCESSED_LIMIT - 1 }, (_, index) => `om_${index + 1}`)
    await writeFile(join(directory, 'processed.json'), JSON.stringify({ version: 1, ids: seeded }), 'utf8')
    const store = build()
    expect(await store.markProcessed('om_1')).toBe(false)
    expect(await build().markProcessed('om_2')).toBe(false)
    expect(await store.markProcessed(`om_${LARK_PROCESSED_LIMIT}`)).toBe(true)
    // The 501st id pushes the oldest one out.
    expect(await store.markProcessed(`om_${LARK_PROCESSED_LIMIT + 1}`)).toBe(true)
    expect(await store.markProcessed('om_1')).toBe(true)
  })

  it('invalidates the code after 5 failed attempts', async () => {
    const store = build()
    await store.startPairing('owner')
    for (let attempt = 0; attempt < LARK_PAIRING_MAX_FAILURES; attempt += 1) {
      expect(await store.redeemPairing('999999', 'ou_1', 'Alice')).toBe('invalid')
    }
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('invalid')
    expect((await store.status('off')).pairing).toBeUndefined()
  })

  it('a correct code after 4 failures still works', async () => {
    const store = build()
    await store.startPairing('owner')
    for (let attempt = 0; attempt < LARK_PAIRING_MAX_FAILURES - 1; attempt += 1) await store.redeemPairing('999999', 'ou_1', 'Alice')
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('added')
  })

  it('a new pairing resets the failure counter', async () => {
    const store = build()
    await store.startPairing('owner')
    for (let attempt = 0; attempt < LARK_PAIRING_MAX_FAILURES - 1; attempt += 1) await store.redeemPairing('999999', 'ou_1', 'Alice')
    await store.startPairing('owner')
    await store.redeemPairing('999999', 'ou_1', 'Alice')
    expect(await store.redeemPairing('123456', 'ou_1', 'Alice')).toBe('added')
  })

  it('does not leak the failure counter through status', async () => {
    const store = build()
    await store.startPairing('owner')
    await store.redeemPairing('999999', 'ou_1', 'Alice')
    expect(Object.keys((await store.status('off')).pairing ?? {}).sort()).toEqual(['code', 'expiresAt', 'role'])
  })

  it('a member code redeemed by the owner is consumed and keeps the owner', async () => {
    const store = build()
    await bindOwner(store)
    await store.startPairing('member')
    expect(await store.redeemPairing('123456', 'ou_owner', 'Owner')).toBe('added')
    expect((await store.owner())?.openId).toBe('ou_owner')
    expect((await store.status('off')).members).toHaveLength(1)
    expect((await store.status('off')).pairing).toBeUndefined()
    expect(await store.redeemPairing('123456', 'ou_other', 'Other')).toBe('invalid')
  })

  it('removing the owner clears any pending pairing', async () => {
    const store = build()
    await bindOwner(store)
    await store.startPairing('member')
    await store.removeMember('ou_owner')
    expect((await store.status('off')).pairing).toBeUndefined()
    expect(await store.redeemPairing('123456', 'ou_x', 'X')).toBe('invalid')
  })

  it('redeems one code for exactly one of two concurrent attempts', async () => {
    const store = build()
    await store.startPairing('owner')
    const results = await Promise.all([store.redeemPairing('123456', 'ou_1', 'A'), store.redeemPairing('123456', 'ou_2', 'B')])
    expect(results.filter((result) => result === 'added')).toHaveLength(1)
    expect((await store.status('off')).members).toHaveLength(1)
  })

  it('marks a message processed exactly once under concurrency', async () => {
    const store = build()
    const results = await Promise.all([store.markProcessed('x'), store.markProcessed('x')])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('a corrupt config file reads as empty', async () => {
    await writeFile(join(directory, 'config.json'), '{not json', 'utf8')
    const store = build()
    const status = await store.status('off')
    expect(status).toMatchObject({ enabled: false, domain: 'feishu', appId: '', secretSet: false, members: [] })
    await store.saveConfig({ ...config, appSecret: 's' })
    expect((await store.credentials())?.appSecret).toBe('s')
  })

  it('a corrupt processed file reads as empty', async () => {
    await writeFile(join(directory, 'processed.json'), 'garbage', 'utf8')
    expect(await build().markProcessed('om_1')).toBe(true)
  })

  describe('a file that exists but cannot be read', () => {
    const denied = (name: string): ReadText => async (path) => {
      if (path === join(directory, name)) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return readFile(path, 'utf8')
    }
    const buildDenying = (name: string): LarkStore => new LarkStore(directory, cipher, () => now, () => nextRandom, denied(name))

    it('rejects a config change without rewriting the file', async () => {
      const store = build()
      await bindOwner(store)
      const before = await readFile(join(directory, 'config.json'), 'utf8')
      const locked = buildDenying('config.json')
      await expect(locked.saveConfig({ ...config, appSecret: 's' })).rejects.toThrow()
      await expect(locked.startPairing('member')).rejects.toThrow()
      await expect(locked.setLastOnlineAt(now)).rejects.toThrow()
      await expect(locked.redeemPairing('123456', 'ou_x', 'X')).rejects.toThrow()
      expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe(before)
      // The store is not wedged: a later write with a readable file goes through.
      expect((await build().owner())?.openId).toBe('ou_owner')
    })

    it('rejects markProcessed without forgetting the processed ids', async () => {
      await build().markProcessed('om_1')
      const before = await readFile(join(directory, 'processed.json'), 'utf8')
      await expect(buildDenying('processed.json').markProcessed('om_2')).rejects.toThrow()
      expect(await readFile(join(directory, 'processed.json'), 'utf8')).toBe(before)
      expect(await build().markProcessed('om_1')).toBe(false)
    })

    it('rejects session-link writes without dropping the links', async () => {
      const link = { sessionId: 's1', chatId: 'oc_1', triggerMessageId: 'om_1', baseCommit: 'abc', agent: 'claude' as const }
      await build().linkSession(link)
      const locked = buildDenying('sessions.json')
      await expect(locked.linkSession({ ...link, sessionId: 's2' })).rejects.toThrow()
      await expect(locked.updateSessionLink('s1', { lastReport: 'x' })).rejects.toThrow()
      await expect(locked.removeSessionLink('s1')).rejects.toThrow()
      expect(await build().sessionLink('s1')).toEqual(link)
    })

    it('still reads as empty outside a mutation', async () => {
      await bindOwner(build())
      expect(await buildDenying('config.json').owner()).toBeUndefined()
    })
  })

  it('links, patches and removes sessions', async () => {
    const store = build()
    const link = { sessionId: 's1', chatId: 'oc_1', triggerMessageId: 'om_1', baseCommit: 'abc', agent: 'claude' as const }
    await store.linkSession(link)
    expect(await store.sessionLink('s1')).toEqual(link)
    await store.updateSessionLink('s1', { lastReport: 'done' })
    expect(await build().sessionLink('s1')).toEqual({ ...link, lastReport: 'done' })
    await store.updateSessionLink('missing', { lastReport: 'x' })
    expect(await store.sessionLink('missing')).toBeUndefined()
    await store.removeSessionLink('s1')
    expect(await store.sessionLink('s1')).toBeUndefined()
  })

  it('a corrupt sessions file reads as empty', async () => {
    await writeFile(join(directory, 'sessions.json'), '[[', 'utf8')
    expect(await build().sessionLink('s1')).toBeUndefined()
  })

  it('resolves attachment directories under the store', () => {
    const store = build()
    expect(store.attachmentDirectory('om_x100b61e7abb0fca4ffa63c824cbbe7c')).toBe(
      join(directory, 'attachments', 'om_x100b61e7abb0fca4ffa63c824cbbe7c')
    )
  })

  it.each(['', '..', '../evil', 'a/b', 'a\\b', 'om 1', 'om.1'])('rejects unsafe message id %j', (id) => {
    expect(() => build().attachmentDirectory(id)).toThrow()
  })

  it('persists the last online time and survives a save of the settings', async () => {
    const store = build()
    expect(await store.lastOnlineAt()).toBeUndefined()
    await store.setLastOnlineAt(new Date('2026-11-06T09:00:00.000Z'))
    await store.saveConfig({ enabled: true, domain: 'feishu', appId: 'cli_x', appSecret: 's' })
    expect(await build().lastOnlineAt()).toEqual(new Date('2026-11-06T09:00:00.000Z'))
  })

  it('keeps the 50 most recent chats, most recent last, without duplicates', async () => {
    const store = build()
    for (let index = 0; index < 55; index += 1) await store.addKnownChat(`oc_${index}`)
    await store.addKnownChat('oc_10')
    const chats = await build().knownChats()
    expect(chats).toHaveLength(50)
    expect(chats[0]).toBe('oc_5')
    expect(chats.at(-1)).toBe('oc_10')
    expect(chats.filter((chat) => chat === 'oc_10')).toHaveLength(1)
  })
})
