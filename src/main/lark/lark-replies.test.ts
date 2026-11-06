import { describe, expect, it } from 'vitest'
import { LARK_REPLY, agentLabel, agentMissingReply, exitReply, idleReply, startedReply } from './lark-replies'

describe('lark replies', () => {
  it('has the fixed copy', () => {
    expect(LARK_REPLY).toEqual({
      denied: '没有权限',
      unbound: '未绑定',
      bound: '已绑定',
      bindInvalid: '没有权限',
      stale: '这条消息发出时 Codeflai 未运行，没有执行，请重新发送',
      noProject: '找不到项目：请在消息里写出 Codeflai 中的项目名',
      ambiguousProject: '消息里匹配到多个项目，请只写一个',
      ambiguousAgent: '请只指定一个 agent（claude 或 codex）',
      empty: '请写出要做什么',
      notGit: '这个项目不是 Git 仓库或还没有提交，无法执行',
      startFailed: '启动失败，请到 Codeflai 查看'
    })
  })

  it('labels agents', () => {
    expect(agentLabel('claude')).toBe('Claude')
    expect(agentLabel('codex')).toBe('Codex')
    expect(agentMissingReply('codex')).toBe('本机没有可用的 Codex')
  })

  it('describes a started session for owner and member', () => {
    const base = { agent: 'claude' as const, projectName: 'demo', branch: 'worktree-1', ownerName: 'Ann' }
    expect(startedReply(base)).toBe('已在 demo 开了 Claude 会话（分支 worktree-1）')
    expect(startedReply({ ...base, requesterName: 'Bob' })).toBe(
      '由 Bob 发起，在 Ann 的电脑上运行。\n已在 demo 开了 Claude 会话（分支 worktree-1）'
    )
  })

  it('describes idle and exit with and without changes', () => {
    expect(idleReply('codex', '')).toBe('Codex 停下了，可能在等你回复，请到 Codeflai 查看')
    expect(idleReply('codex', 'M a.ts')).toBe('本轮结束，改了：\nM a.ts')
    expect(exitReply('')).toBe('会话已结束。')
    expect(exitReply('M a.ts')).toBe('会话已结束。\n改动：\nM a.ts')
  })
})
