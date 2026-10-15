# Codeflai 更新日志 — 0.33.0 / 2026-10-15

## 概览

Comate 会话现在可以用鼠标滚轮滚动对话记录，不用再靠 PageUp / PageDown 一页一页地翻。

## 新功能亮点

- **需求背景：** 在 Windows 上，Comate 会话里滚动鼠标滚轮翻不了上面的对话，反而会把输入框里的内容换成之前输入过的历史消息；想往回看只能按 PageUp / PageDown / Home / End。
- **功能描述：** 在 Comate 会话里滚动滚轮，对话记录会跟着滚动，每格 3 行，底部会提示「上方 N 行 · 下方 M 行」，往下滚到底回到最新内容。输入框里正在写的内容不受影响。触控板的轻扫也能平滑滚动。
- **使用场景：** Comate 跑完一轮长任务后，用滚轮往上翻看它中间做过什么、改了哪些文件，就像在普通网页里滚动一样。
- **操作路径：** 无需设置，在 Comate 会话的终端区域滚动鼠标滚轮即可。

## 特别说明与指引

- **只影响 Comate 会话。** Claude Code、Codex、其他 agent 以及 PowerShell / CMD / Shell 会话的滚轮行为与之前完全一样。
- **PageUp / PageDown / Home / End 照常可用**，适合一次翻一整页或直接跳到顶部、底部。
- 如果你设置过环境变量 `ZULU_TUI_MOUSE=0` 关闭 Comate 的鼠标支持，滚轮在 Windows 上仍然会滚动对话记录。

## 反馈与支持

更新后如遇到问题，请提交 issue：https://github.com/denggaopan/codeflai/issues
