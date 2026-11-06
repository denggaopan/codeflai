import { describe, expect, it } from 'vitest'

import { LARK_BOT_MISSING_ERROR, LARK_BOT_REFETCH_MS, LarkBotIdentity } from './lark-bot-identity'
import type { LarkConnectionState } from './lark-client'

type Deferred = { resolve: (id: string | undefined) => void }

/** A bot-info endpoint whose answers the test hands out one lookup at a time. */
function harness() {
  let now = 1_000_000
  const lookups: Deferred[] = []
  const log: string[] = []
  const identity = new LarkBotIdentity({
    fetchBotId: () => new Promise<string | undefined>((resolve) => lookups.push({ resolve })),
    onState: (state: LarkConnectionState, error?: string) => log.push(error === undefined ? state : `${state}:${error}`),
    now: () => now
  })
  const receive = (name: string): void => identity.receive((botOpenId) => log.push(`${name}:${botOpenId ?? '-'}`))
  return {
    identity,
    lookups,
    log,
    receive,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('LarkBotIdentity', () => {
  it('reports connected once the id is known and delivers with it', async () => {
    const { identity, lookups, log, receive } = harness()
    identity.linkUp()
    lookups[0]!.resolve('ou_bot')
    await identity.whenIdle()
    receive('m1')
    await identity.whenIdle()
    expect(log).toEqual(['connected', 'm1:ou_bot'])
    expect(lookups).toHaveLength(1)
  })

  it('reports an error asking for a published version while the bot is missing', async () => {
    const { identity, lookups, log } = harness()
    identity.linkUp()
    lookups[0]!.resolve(undefined)
    await identity.whenIdle()
    expect(log).toEqual([`error:${LARK_BOT_MISSING_ERROR}`])
    expect(LARK_BOT_MISSING_ERROR).toMatch(/publish a new version/)
  })

  it('looks the id up again when a message arrives after the first lookup failed', async () => {
    const { identity, lookups, log, receive, advance } = harness()
    identity.linkUp()
    lookups[0]!.resolve(undefined) // 11205 before the app version is published
    await identity.whenIdle()
    advance(LARK_BOT_REFETCH_MS)
    receive('bind')
    receive('next')
    await Promise.resolve()
    expect(lookups).toHaveLength(2)
    lookups[1]!.resolve('ou_bot')
    await identity.whenIdle()
    // Both messages see the fresh id, in order, before the state turns connected.
    expect(log).toEqual([`error:${LARK_BOT_MISSING_ERROR}`, 'bind:ou_bot', 'next:ou_bot', 'connected'])
    expect(identity.id).toBe('ou_bot')
  })

  it('looks up at most once per 30 seconds while the bot stays missing', async () => {
    const { identity, lookups, log, receive, advance } = harness()
    identity.linkUp()
    lookups[0]!.resolve(undefined)
    await identity.whenIdle()
    advance(LARK_BOT_REFETCH_MS - 1)
    receive('early')
    await identity.whenIdle()
    expect(lookups).toHaveLength(1)
    advance(1)
    receive('later')
    await Promise.resolve()
    expect(lookups).toHaveLength(2)
    lookups[1]!.resolve(undefined)
    await identity.whenIdle()
    expect(log).toEqual([`error:${LARK_BOT_MISSING_ERROR}`, 'early:-', 'later:-', `error:${LARK_BOT_MISSING_ERROR}`])
  })

  it('makes a message that arrives during the first lookup wait for it', async () => {
    const { identity, lookups, log, receive } = harness()
    identity.linkUp()
    receive('m1')
    await Promise.resolve()
    expect(log).toEqual([])
    expect(lookups).toHaveLength(1)
    lookups[0]!.resolve('ou_bot')
    await identity.whenIdle()
    expect(log).toEqual(['m1:ou_bot', 'connected'])
  })

  it('does not look up again once the id is known, and keeps it across a failed reconnect lookup', async () => {
    const { identity, lookups, log, receive, advance } = harness()
    identity.linkUp()
    lookups[0]!.resolve('ou_bot')
    await identity.whenIdle()
    identity.linkDown()
    identity.linkUp()
    lookups[1]!.resolve(undefined)
    await identity.whenIdle()
    advance(LARK_BOT_REFETCH_MS * 10)
    receive('m1')
    await identity.whenIdle()
    expect(lookups).toHaveLength(2)
    expect(log).toEqual(['connected', 'connected', 'm1:ou_bot'])
  })

  it('ignores an answer that arrives after the link dropped', async () => {
    const { identity, lookups, log } = harness()
    identity.linkUp()
    identity.linkDown()
    lookups[0]!.resolve('ou_bot')
    await identity.whenIdle()
    expect(log).toEqual([])
  })

  it('returns from receive before any lookup settles', () => {
    const { identity, lookups, log, receive } = harness()
    identity.linkUp()
    receive('m1')
    expect(log).toEqual([])
    expect(lookups).toHaveLength(1)
  })

  it('survives a lookup that rejects', async () => {
    const log: string[] = []
    const identity = new LarkBotIdentity({
      fetchBotId: () => Promise.reject(new Error('network')),
      onState: (state) => log.push(state)
    })
    identity.receive((botOpenId) => log.push(`m1:${botOpenId ?? '-'}`))
    await identity.whenIdle()
    expect(log).toEqual(['m1:-', 'error'])
  })
})
