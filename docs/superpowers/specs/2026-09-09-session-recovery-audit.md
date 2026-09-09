# Same-directory session recovery audit

Date: 2026-09-09

Scope: inspect recovery of two ordinary sessions with the same agent kind and launch directory. This is a source and existing-test audit. No real vendor CLI conversation recovery was reproduced, and no vendor integration or recovery behavior is changed by this document.

## Finding

Codeflai can distinguish two surviving PTYs by their own persisted Codeflai session IDs, even when their agent kind and directory match. After those PTYs are gone, it cannot guarantee that each row reopens its original native agent conversation: persisted state contains no native conversation ID, and the launch adapter receives only the agent kind and a resume boolean. Both relaunches therefore receive the same agent arguments and working directory.

For example, rows A and B can preserve different Codeflai IDs and titles while both launch `claude --dangerously-skip-permissions --continue` in the same directory. If the CLI's newest conversation there is B, both requests are eligible to select B. This is a concrete ambiguity in the application's inputs, not a claim that a particular installed CLI was observed selecting B twice. CLI transcript timing, locks, pickers, and version differences determine the actual outcome.

## Identity and persistence evidence

- `src/main/services/session-coordinator.ts`, `create()`: ordinary sessions use `project.path` as `launchPath`; each record gets `this.createId()` (default `randomUUID`). The ID is Codeflai's own identifier.
- `src/shared/contracts.ts`, `commonSessionRecordShape` and `sessionRecordSchema`: session records have Codeflai ID, project, kind, title, status, directory, and optional worktree metadata. They contain no captured native conversation/session ID. User-facing titles and organization metadata cannot resolve the missing native identity.
- `src/main/services/session-store.ts`, `normalizeRuntimeStatuses()` and `commit()`: state is validated and written atomically with a backup. Persisted `running` survives loading as resume intent; `creating` becomes `stopped`. Restoring these records preserves UI identity, not a native transcript binding.
- `src/shared/pty-protocol.ts:42`, `ptySessionSummarySchema`, and `ptyRequestSchema`: host summaries and spawn requests include the Codeflai session ID, kind, and launch directory. A spawn also includes `resume: boolean` and terminal dimensions; neither message carries a native conversation ID.

## Live host versus replacement processes

| Situation | Current behavior | Supported recovery claim |
| --- | --- | --- |
| Both original PTYs survive in a compatible host | Adopt both matching Codeflai IDs; do not launch either CLI again | Each row reconnects to its own surviving PTY, independent of matching kind/directory |
| Only A's PTY survives | Adopt A; resume missing running row B | A keeps its exact live process; B's original conversation is ambiguous |
| Original host/PTYs are gone and a new host starts | Resume every eligible persisted running row | Separate Codeflai rows and processes can be restored; original native conversation identity is not guaranteed |
| No host exists and a new host cannot start | Bind the in-process fallback and auto-resume eligible running rows | The same native identity ambiguity applies; these fallback PTYs cannot outlive the UI |
| Discovery reports an incompatible or ambiguous live host | Reject attachment and do not expose fallback or reconcile saved state | Avoid starting duplicate replacements while an old host may still own sessions |
| A saved row is explicitly stopped and has no live PTY | Do not auto-resume it; manual restore uses the same resume arguments | Stopped intent is preserved; a later manual restore still lacks native identity |

Relevant implementation:

- `src/main/services/session-attachment.ts:20`, `attachSessions()`: derives `liveSessionIds` from the host handshake, binds the client or safe fallback, and currently calls `reconcile(..., { autoResume: true })` in both connected and unavailable cases. Older coordinator comments describing all unavailable-host cases as `autoResume: false` do not describe this call site.
- `src/main/services/session-coordinator.ts`, `reconcile()`: matches by `session.id`; matching live records are adopted, missing running records are passed to `restoreLocked(sessionId, true)`, and unknown live IDs are stopped as orphans.
- `src/main/services/session-coordinator.ts`, `restoreLocked()`: validates the session location and calls `terminalService.start(session, { resume: true })`. A successful process start produces `running`; there is no native conversation identity verification.
- `src/main/services/pty-host-client.ts:222`, `start()`: transmits the Codeflai ID, kind, directory, resume boolean, and dimensions. The Codeflai ID routes host requests; it is not forwarded as a native CLI session selector.
- `src/pty-host/pty-registry.ts:105`, `entries`: one entry per Codeflai session ID. `spawn()` resolves arguments from only kind and resume, then uses `launchPath` as `cwd`. `write()`, `resize()`, `replay()`, and output events use the ID to select the entry. Entry identity checks also prevent late output from a replaced PTY being attributed to its replacement.
- `src/pty-host/pty-registry.ts:212`, `replay()`: returns that entry's retained output and geometry. This buffer exists in host memory and is bounded by `REPLAY_BUFFER_CHARS` (`256 * 1024` characters). It is not a durable native transcript or complete conversation history after host loss.
- `src/main/services/terminal-service.ts:151`: the fallback uses the same kind/resume argument resolver and launch directory, so it does not add a native identity binding.
- `src/main/index.ts`, `ptyHostClient.onDisconnected`: socket loss logs an instruction to restart Codeflai. It does not prove host death or automatically reconnect; startup reconciliation determines what survived.

## Current native resume arguments

The registry in `src/shared/agent-kinds.ts:53` supplies these resume selectors, in addition to each agent's existing permission arguments/environment:

| Agent | Resume selector | Identity supplied by Codeflai |
| --- | --- | --- |
| Claude | `--continue` | No native conversation ID |
| Codex | `resume --last` | No native conversation ID |
| Gemini | `--resume latest` | No native conversation ID |
| GitHub Copilot | `--continue` | No native conversation ID |
| Cursor | `--resume` | No native conversation ID |
| Comate | `--resume` | No native conversation ID; existing source notes that version 1.0.8 ignores this flag and starts a fresh TUI |
| Qwen Code | `--continue` | No native conversation ID |

These are statements about current application arguments and source comments, not newly verified vendor behavior. Separate worktree launch directories reduce collisions for CLIs whose latest-conversation lookup is directory scoped, but directory separation still is not an explicit native identity contract.

## Existing test evidence and limits

The following test definitions were inspected. This audit does not repeat the parent task's baseline test run or claim fresh passing results for these tests.

- `src/main/services/session-store.test.ts:98`: keeps persisted `running` intent and normalizes interrupted `creating` records, including recovered backup state.
- `src/main/services/session-coordinator.test.ts`, `SessionCoordinator.reconcile`: tests adoption without relaunch, resume intent for an absent running PTY, explicit stopped/error/missing exclusions, and continuing after one resume fails. The two-session failure case uses matching ordinary PowerShell defaults, but asserts process-start/status handling rather than native agent conversation identity.
- `src/main/services/session-attachment.test.ts`: covers connected-host ID reconciliation, safe fallback with auto-resume, and refusal to fall back for an ambiguous live host.
- `src/pty-host/launch-spec.test.ts:127`: enumerates exact create/resume arguments for all agent kinds. It establishes which selector is passed, not which transcript a vendor chooses.
- `src/pty-host/pty-registry.test.ts:229`: verifies per-ID data events for two PTYs in the same directory, but with different agent kinds. Replay tests cover retained output and stale-event isolation.
- `src/main/services/pty-host-client.test.ts:238`: verifies two replay requests remain distinct when responses arrive out of order. `src/pty-host/server.test.ts:264` verifies replay ordering relative to subsequent live output.
- `e2e/codeflai.spec.ts:799`: checks the host PID survives UI-only termination, four session rows remain running, and PowerShell retains its marker and accepts further input. Those four sessions have different kinds; this is not a same-kind, same-directory conversation recovery test.
- `e2e/workspace-restore.spec.ts:21`: exercises window close, forced termination, and renderer reload, retaining active-session and fold state. Its two Claude sessions use different project directories, and the assertion checks new terminal input after restart rather than original native conversation identity.
- `e2e/fixtures/fake-agent.cjs`: logs launch arguments, prints a ready marker, echoes input, and synthesizes activity markers. It neither persists native conversations nor implements latest/exact-ID resume. Its argv log is overwritten on each launch. Passing this fixture's restart checks cannot establish real vendor transcript recovery or count all launches from the final log alone.

## Bounded next steps

1. Add a same-kind, same-directory live-host regression case using two ordinary Claude or Codex sessions, separate input markers, and the exact Codeflai IDs. After UI-only restart, assert unchanged host identity, no additional agent launches, retained marker A only in A and marker B only in B, and independently routed new input. Track launches with an append-only fixture log or per-process records; the existing overwritten argv log is insufficient.
2. Add a focused cold-recovery characterization case with two IDs and one missing/all-missing host membership. Verify exactly which Codeflai rows are adopted or spawned and record the identical native selector/cwd pairs. A simulation with a latest-conversation store may demonstrate the ambiguity, but label it as a simulation and do not use it as proof of vendor behavior.
3. Before promising exact cold recovery, validate one installed agent's supported native ID capture and explicit resume mechanism in an isolated test profile with two distinctive conversations. Exercise both UI-only restart and confirmed loss of the test host/PTYs. Record CLI version, native IDs, resolved launch arguments, and which transcript each row actually opens. This audit has not performed that live experiment.
4. If exact cold recovery is the chosen next feature, start with that one verified agent: persist its native conversation ID, carry it through the validated launch contract, resume by that ID, and add a two-conversation acceptance test. Define an explicit legacy/unknown-ID fallback and a per-agent capability result. Broad vendor adapters, transcript scraping, and silent guesses based on titles or modification time are outside this session-organization increment.

Product wording supported today: reconnect surviving sessions, restore workspace selection and organization, and request the agent's available resume behavior after process loss. Exact original-conversation recovery for multiple same-kind sessions in one directory remains unverified and unsupported by the current identity contract.


## Verification added in this increment

`e2e/session-organization.spec.ts` now runs two ordinary Claude fixture sessions
in the same directory, enters distinct markers, and closes/reopens the UI with
the resident host alive. It verifies the same host identity, each session's own
retained marker without the other session's marker, independently routed new
input, and persisted manual title/archive/unread state. This passed against a
real Electron window on Windows. It verifies PTY reconnection and workspace
organization using the fake agent; it does not verify native conversation
selection after host loss. Native exact-ID recovery remains a separate change.
