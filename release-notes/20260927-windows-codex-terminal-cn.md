# Codeflai 更新日志 - 0.29.1 / 2026-09-27

## 概览

修复 Windows 上使用 Codeflai 的 Codex 会话执行命令时，系统 Terminal 窗口反复短暂弹出的问题。

## 修复内容

Windows 上新建或恢复 Codex 会话时，现在会加入 `--no-daemon`，让 Codex 的命令执行器留在会话的 PTY 中。权限与沙箱绕过设置没有变化；macOS 的启动参数也没有变化。

此修复已用 Codex CLI 0.157.1 验证。如果旧版 CLI 提示不认识 `--no-daemon`，请先更新 Codex，再用这一版 Codeflai 启动会话。

## 更新后如何生效

Codeflai 就地升级时会保留常驻 PTY 宿主和正在运行的会话；旧宿主持有的会话仍沿用旧启动参数。请先完成手头工作，在会话行菜单中停止所有运行中的会话，关闭 Codeflai，至少等待 60 秒让空闲宿主退出，再打开应用并恢复 Codex 会话。重启电脑也会启动新宿主。停止会话会保留记录和 worktree；同一目录里有多个 Codex 会话时，`resume --last` 不保证精确恢复到各自原来的对话。

## 问题反馈

如果新宿主启动后仍有 Terminal 闪窗，请附上 Codex CLI 版本，在 https://github.com/denggaopan/codeflai/issues 提交问题。
