import { describe, expect, it } from 'vitest'
import { toIncomingMessage } from './lark-client'

const event = {
  sender: {
    sender_id: { open_id: 'ou_sender', union_id: 'on_x', user_id: 'u1' },
    sender_type: 'user',
    tenant_key: 't',
    is_agent: false
  },
  message: {
    message_id: 'om_1',
    chat_id: 'oc_1',
    chat_type: 'group',
    parent_id: 'om_parent',
    message_type: 'text',
    content: '{"text":"@_user_1 fix it"}',
    create_time: '1793934000000',
    mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot', union_id: 'on_b', user_id: '' }, name: 'Bot' }]
  }
}

describe('toIncomingMessage', () => {
  it('maps the observed event', () => {
    expect(toIncomingMessage(event, 'ou_bot')).toEqual({
      messageId: 'om_1',
      chatId: 'oc_1',
      parentId: 'om_parent',
      messageType: 'text',
      content: '{"text":"@_user_1 fix it"}',
      createTimeMs: 1793934000000,
      senderType: 'user',
      senderOpenId: 'ou_sender',
      mentionsBot: true
    })
  })

  it('treats every message as not mentioning the bot until its id is known', () => {
    expect(toIncomingMessage(event, undefined).mentionsBot).toBe(false)
    expect(toIncomingMessage(event, 'ou_other').mentionsBot).toBe(false)
  })

  it('tolerates missing optional parts', () => {
    const mapped = toIncomingMessage(
      { sender: { sender_type: 'app' }, message: { ...event.message, parent_id: undefined, mentions: undefined } },
      'ou_bot'
    )
    expect(mapped.parentId).toBeUndefined()
    expect(mapped.senderOpenId).toBeUndefined()
    expect(mapped.mentionsBot).toBe(false)
    expect(mapped.senderType).toBe('app')
  })
})
