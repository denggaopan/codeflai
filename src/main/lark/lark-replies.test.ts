import { describe, expect, it } from 'vitest'
import {
  LARK_REPLY,
  agentLabel,
  agentMissingReply,
  blockedReply,
  doneReply,
  exitReply,
  followUpFailedReply,
  followUpSentReply,
  idleReply,
  questionReply,
  startedReply
} from './lark-replies'

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
      startFailed: '启动失败，请到 Codeflai 查看',
      followUpStopped: '这个会话已经停止，没有转给它。要继续请在 Codeflai 里点开它恢复，或者 @我 重新发起',
      followUpGone: '这个会话已经不在了，请 @我 重新发起'
    })
  })

  it('passes on what the agent reported', () => {
    expect(questionReply('claude', '导出成 JSON 还是 CSV？')).toBe('Claude 在问你：导出成 JSON 还是 CSV？\n（回复这条消息并 @我 来回答）')
    expect(blockedReply('codex', 'gh 未登录')).toBe('Codex 卡住了：gh 未登录\n（回复这条消息并 @我 告诉它怎么办）')
    expect(doneReply('claude', '已开 PR #57', '')).toBe('Claude 完成了：已开 PR #57')
    expect(doneReply('claude', '已开 PR #57', 'M a.ts')).toBe('Claude 完成了：已开 PR #57\n改了：\nM a.ts')
  })

  it('acknowledges a follow-up', () => {
    expect(followUpSentReply('codex')).toBe('已转给 Codex')
    expect(followUpFailedReply('claude')).toBe('没能转给 Claude，请到 Codeflai 查看')
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
    expect(idleReply('codex', '')).toBe('Codex 停下了，可能在等你回复。回复这条消息并 @我 可以接着说')
    expect(idleReply('codex', 'M a.ts')).toBe('本轮结束，改了：\nM a.ts')
    expect(exitReply('')).toBe('会话已结束。')
    expect(exitReply('M a.ts')).toBe('会话已结束。\n改动：\nM a.ts')
  })
})
