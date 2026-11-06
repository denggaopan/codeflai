import { describe, expect, it } from 'vitest'
import { extractMessageText, parseLarkCommand, type LarkProjectRef } from './lark-command'

const projects: LarkProjectRef[] = [
  { id: 'p1', name: 'codeflai' },
  { id: 'p2', name: 'codeflai-web' }
]

describe('parseLarkCommand', () => {
  it('parses the canonical sentence', () => {
    expect(parseLarkCommand('用 claude 在 codeflai 项目修复这个 bug', projects)).toEqual({
      type: 'run',
      agent: 'claude',
      projectId: 'p1',
      projectName: 'codeflai',
      instruction: '用 claude 在 codeflai 项目修复这个 bug'
    })
  })

  it('defaults to claude', () => {
    const cmd = parseLarkCommand('在 codeflai 项目修复这个 bug', projects)
    expect(cmd).toMatchObject({ type: 'run', agent: 'claude' })
  })

  it('recognises codex and claude code', () => {
    expect(parseLarkCommand('用 Codex 在 codeflai 修', projects)).toMatchObject({ agent: 'codex' })
    expect(parseLarkCommand('用 Claude Code 在 codeflai 修', projects)).toMatchObject({
      agent: 'claude'
    })
  })

  it('refuses both agents', () => {
    expect(parseLarkCommand('用 claude 和 codex 在 codeflai 修', projects)).toEqual({
      type: 'error',
      reason: 'ambiguousAgent'
    })
  })

  it('matches project names as whole tokens only', () => {
    expect(parseLarkCommand('在 codeflai-web 项目修', projects)).toMatchObject({
      type: 'run',
      projectId: 'p2'
    })
    expect(parseLarkCommand('在 codeflai 项目修', projects)).toMatchObject({
      type: 'run',
      projectId: 'p1'
    })
  })

  it('matches a project name embedded in Chinese without spaces', () => {
    expect(parseLarkCommand('用claude在codeflai项目修复这个bug', projects)).toMatchObject({
      type: 'run',
      agent: 'claude',
      projectName: 'codeflai'
    })
    expect(parseLarkCommand('用codex在codeflai项目修', projects)).toMatchObject({ agent: 'codex' })
  })

  it('accepts a sentence-final period', () => {
    expect(parseLarkCommand('修复 codeflai.', projects)).toMatchObject({ projectId: 'p1' })
  })

  it('matches a CJK project name inside CJK text', () => {
    const cjk = [{ id: 'c1', name: '后台管理' }, ...projects]
    expect(parseLarkCommand('在后台管理项目修复登录', cjk)).toMatchObject({
      type: 'run',
      projectId: 'c1'
    })
  })

  it('does not match across an ASCII word', () => {
    const list = [
      { id: 'a', name: 'code' },
      { id: 'b', name: 'codeflai' }
    ]
    expect(parseLarkCommand('用 codeflai 修复', list)).toMatchObject({ projectId: 'b' })
  })

  it('reports no project and ambiguity', () => {
    expect(parseLarkCommand('修一下', projects)).toEqual({ type: 'error', reason: 'noProject' })
    expect(parseLarkCommand('在 codeflai 和 codeflai-web 修', projects)).toEqual({
      type: 'error',
      reason: 'ambiguousProject'
    })
  })

  it('reports ambiguity for two projects', () => {
    expect(parseLarkCommand('codeflai codeflai-web', projects)).toEqual({
      type: 'error',
      reason: 'ambiguousProject'
    })
  })

  it('reports empty text', () => {
    expect(parseLarkCommand('   ', projects)).toEqual({ type: 'error', reason: 'empty' })
  })

  it('hoists a skill token that opens the instruction', () => {
    expect(parseLarkCommand('/fast-do 修复 codeflai 的登录 bug', projects)).toMatchObject({
      skill: 'fast-do',
      instruction: '/fast-do 修复 codeflai 的登录 bug'
    })
    expect(parseLarkCommand('$fast-do 用 codex 在 codeflai 修', projects)).toMatchObject({
      skill: 'fast-do'
    })
  })

  it('hoists a leading skill token after the mention placeholder is stripped', () => {
    expect(parseLarkCommand('@_user_1 /fast-do 在 codeflai 修', projects)).toMatchObject({ skill: 'fast-do' })
  })

  it('does not hoist a skill token in mid-sentence', () => {
    expect(parseLarkCommand('用 /fast-do 在 codeflai 修', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('在 codeflai 打开 /settings 页面看看', projects)).not.toHaveProperty('skill')
  })

  it("does not hoist one of Claude Code's own commands, in any case", () => {
    expect(parseLarkCommand('/logout 在 codeflai 修', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('/Clear codeflai', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('$model codeflai', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('/logout 在 codeflai 修', projects)).toMatchObject({
      type: 'run',
      instruction: '/logout 在 codeflai 修'
    })
  })

  it('ignores an invalid skill token and path fragments', () => {
    expect(parseLarkCommand('/a&b 在 codeflai 修', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('src/main 在 codeflai 修', projects)).not.toHaveProperty('skill')
    expect(parseLarkCommand('/fast-do修复 codeflai', projects)).not.toHaveProperty('skill')
  })

  it('parses bind', () => {
    expect(parseLarkCommand('绑定 123456', projects)).toEqual({ type: 'bind', code: '123456' })
    expect(parseLarkCommand('绑定123456', projects)).toEqual({ type: 'bind', code: '123456' })
  })
})

describe('extractMessageText', () => {
  it('extracts text', () => {
    expect(extractMessageText('text', JSON.stringify({ text: '你好  世界' }))).toEqual({
      text: '你好 世界',
      imageKeys: []
    })
  })

  it('extracts post text and image keys', () => {
    const content = JSON.stringify({
      title: '标题',
      content: [
        [
          { tag: 'text', text: '第一行' },
          { tag: 'a', text: '链接', href: 'https://x' }
        ],
        [{ tag: 'img', image_key: 'img_1' }, { tag: 'text', text: '第二行' }]
      ]
    })
    expect(extractMessageText('post', content)).toEqual({
      text: '标题 第一行链接 第二行',
      imageKeys: ['img_1']
    })
  })

  it('handles the locale wrapper and empty title', () => {
    const content = JSON.stringify({
      zh_cn: { title: '', content: [[{ tag: 'text', text: 'hi' }]] }
    })
    expect(extractMessageText('post', content)).toEqual({ text: 'hi', imageKeys: [] })
  })

  it('extracts image messages', () => {
    expect(extractMessageText('image', JSON.stringify({ image_key: 'k1' }))).toEqual({
      text: '',
      imageKeys: ['k1']
    })
  })

  it('strips mention placeholders', () => {
    expect(extractMessageText('text', JSON.stringify({ text: '@_user_1 你好 @_user_2' }))).toEqual({
      text: '你好',
      imageKeys: []
    })
  })

  it('returns undefined for a file message or bad JSON', () => {
    expect(extractMessageText('file', '{"file_key":"x"}')).toBeUndefined()
    expect(extractMessageText('text', 'not json')).toBeUndefined()
  })
})
