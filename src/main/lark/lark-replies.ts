export type LarkAgent = 'claude' | 'codex'

export const LARK_REPLY = {
  denied: '没有权限',
  unbound: '未绑定',
  bound: '已绑定',
  bindInvalid: '没有权限', // wrong/expired code: indistinguishable from denied
  stale: '这条消息发出时 Codeflai 未运行，没有执行，请重新发送',
  noProject: '找不到项目：请在消息里写出 Codeflai 中的项目名',
  ambiguousProject: '消息里匹配到多个项目，请只写一个',
  ambiguousAgent: '请只指定一个 agent（claude 或 codex）',
  empty: '请写出要做什么',
  notGit: '这个项目不是 Git 仓库或还没有提交，无法执行',
  startFailed: '启动失败，请到 Codeflai 查看',
  // A stopped session is not woken from the chat: stopping is what a person does to end it.
  followUpStopped: '这个会话已经停止，没有转给它。要继续请在 Codeflai 里点开它恢复，或者 @我 重新发起',
  followUpGone: '这个会话已经不在了，请 @我 重新发起'
} as const

export const agentLabel = (agent: LarkAgent): string => (agent === 'claude' ? 'Claude' : 'Codex')

export const agentMissingReply = (agent: LarkAgent): string => `本机没有可用的 ${agentLabel(agent)}`

export const startedReply = (input: {
  agent: LarkAgent
  projectName: string
  branch: string
  requesterName?: string
  ownerName: string
}): string => {
  const base = `已在 ${input.projectName} 开了 ${agentLabel(input.agent)} 会话（分支 ${input.branch}）`
  return input.requesterName === undefined
    ? base
    : `由 ${input.requesterName} 发起，在 ${input.ownerName} 的电脑上运行。\n${base}`
}

export const idleReply = (agent: LarkAgent, changeList: string): string =>
  changeList === ''
    ? `${agentLabel(agent)} 停下了，可能在等你回复。回复这条消息并 @我 可以接着说`
    : `本轮结束，改了：\n${changeList}`

const withChanges = (text: string, changeList: string): string => (changeList === '' ? text : `${text}\n改了：\n${changeList}`)

export const questionReply = (agent: LarkAgent, question: string): string =>
  `${agentLabel(agent)} 在问你：${question}\n（回复这条消息并 @我 来回答）`

export const doneReply = (agent: LarkAgent, summary: string, changeList: string): string =>
  withChanges(`${agentLabel(agent)} 完成了：${summary}`, changeList)

export const blockedReply = (agent: LarkAgent, reason: string): string =>
  `${agentLabel(agent)} 卡住了：${reason}\n（回复这条消息并 @我 告诉它怎么办）`

export const followUpSentReply = (agent: LarkAgent): string => `已转给 ${agentLabel(agent)}`

export const followUpFailedReply = (agent: LarkAgent): string => `没能转给 ${agentLabel(agent)}，请到 Codeflai 查看`

export const exitReply = (changeList: string): string =>
  '会话已结束。' + (changeList ? `\n改动：\n${changeList}` : '')
