# Codeflai 更新日志 — 0.31.0 / 2026-10-09

## 概览

项目可以自己处理 issue 了：打开项目菜单里的「Auto-resolve issues」，项目空闲时 Codeflai 会自动起一个 agent 会话，挑一条 open issue、解决、等 test 部署通过、关闭 issue。

## 新功能亮点

- **需求背景：** 积压的 issue 要一条条手动开会话、贴 issue、盯着 CI、再去关闭，机器空着的时候这些事没人做。
- **功能描述：** 在项目的 ⋯ 菜单里打开 **Auto-resolve issues** 后，每隔一段时间（默认 30 分钟）Codeflai 会检查该项目有没有正在运行的会话；没有时就在一个新的 worktree 里启动 Claude Code（或 Codex）会话，第一句提示词让它：列出 open issue 并取最早一条、打上 `codeflai:in-progress` 标签认领、用 fast-do 一口气解决并推送、等待这次推送触发的 test 部署、部署成功就关闭 issue，失败或 30 分钟没结果就换成 `codeflai:needs-human` 标签留给人处理，最后退出。侧栏里停在 Done 的 agent 不算「正在运行」，和自动关机的判断一致。
- **使用场景：** 下班前把要处理的 issue 建好、打开开关，第二天看会话列表和 issue 状态；或者想立刻试一次，用菜单里的 **Resolve one issue now** 马上跑一轮，不等定时器。
- **操作路径：** 项目行右侧 ⋯ → **Auto-resolve issues** 打开或关闭（开着时项目名旁有一个小循环图标）；⋯ → **Resolve one issue now** 立即处理一条；**设置 → Issue 自动处理** 里选 agent（Claude Code / Codex）、检查频率（5 分钟到 4 小时）和提示词模板。

## 特别说明与指引

- **提示词模板可以改。** 默认模板写的是 GitHub 用 gh、GitLab 用 glab、其他平台用可用的工具；仓库有多个 workflow 的，在模板里点名要等的那个。模板里的 `{{repoUrl}}`、`{{host}}`、`{{projectPath}}`、`{{projectName}}`、`{{fastDo}}` 会在启动时自动替换；**Reset to default** 恢复内置模板。
- **默认不打包、不发布。** 模板里明确要求 agent 只提交、合并、推送；真想让它发布，自己改模板。
- **Codeflai 自己不读 issue、也不看部署结果。** 认领、关闭、失败处理都由 agent 在会话里完成，过程都在那个会话的终端里，会话标题是「Auto issue 月-日 时:分」。一轮结束照常收到 Done 通知。
- **没有合适 issue 的项目每次检查仍会起一次很短的 agent**，这是默认间隔定为 30 分钟的原因；可以在设置里调长。
- **关掉开关不会停止正在跑的那一轮**，去那一行点 Stop。启动失败（建不出 worktree、找不到 CLI）会自动关掉该项目的开关并提示原因，不会每个间隔都重复报错。
- **没有远程地址的项目这两项是灰的**；所选 agent 在设置里被关掉或没安装时，「Resolve one issue now」是灰的，开关仍可以关闭。
- **需要 Codeflai 开着。** 检查在窗口里进行，退出 Codeflai 就不会再起新的一轮。
- **升级到这个版本时，正在运行的会话会重启一次**，并自动续接上次的对话（Claude 用 continue，Codex 用 resume）。这是后台会话进程换代导致的，只发生在升级这一次。

## 反馈与支持

更新后如遇到问题，请提交 issue：https://github.com/denggaopan/codeflai/issues
