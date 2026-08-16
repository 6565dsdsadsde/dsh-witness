# dsh-witness

> Crash-surviving background jobs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), where **the filesystem is the source of truth**. Cross-restart adoption, autopsy reports, sandboxed execution, event sourcing — battle-tested on Windows NTFS.
>
> 给 DeepSeek Harness 的崩溃存活后台任务：**文件系统即真相源**。跨重启收养、尸检报告、沙箱执行、事件溯源——Windows NTFS 实测。

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-4d6bfe)](https://github.com/topics/dsh-plugin)
[![topic: dsh](https://img.shields.io/badge/topic-dsh-4d6bfe)](https://github.com/topics/dsh)

## Why this exists

The Harness core ships background *jobs* as fire-and-forget tool executions. Real-world long-running sessions hit well-known failure modes:

| Published pain point | dsh-witness answer |
|---|---|
| Force-kill drops the un-flushed write-behind tail ([#483](https://github.com/deepseek-ai/deepseek-harness/discussions/483)) | **No buffer.** Every state transition is written to disk immediately; the directory structure *is* the state machine. |
| One corrupted log event permanently kills the session — no repair path ([#1593](https://github.com/deepseek-ai/deepseek-harness/discussions/1593)) | **Dual truth source.** Directory = truth; SQLite = a rebuildable read-only index cache (cursor + mtime invalidation). A damaged cache never blocks recovery — it is rebuilt from the directories. |
| Two tasks in one folder overwrite each other; a 40-minute run delivers a broken artifact (hands-on reports) | **One isolated directory per task** with an O_EXCL lock, plus a sandboxed cwd per task. |
| "Recovery means knowing the last completed step and what evidence proves the output" — expert advice | **Autopsy reports.** `autopsy.json` per task: manner of death, primary evidence, verdict, death code. |
| Scheduled work silently fails with no review path | **Event sourcing.** `events/*.jsonl` records started / output / done / adopted / tampered for every task. |

## What you get

- **Crash-surviving adoption** — the state machine lives in the directory structure (`state/running | stopping | orphaned | adopted | done`). After any force-kill, a fresh registry instance re-adopts or finalizes every task from three pieces of evidence: lock content (`pid:startSec`), process liveness, and process start-time comparison (PID-reuse safe).
- **Autopsy reports** — every terminal task gets `autopsy.json` (manner of death, primary evidence, verdict, death code D-01…D-09), plus an `output` summary event.
- **Sandboxed execution** — Windows NTFS ACL confinement applied *before* the task spawns: overwrite / append / rename / delete / forgery of evidence files are blocked, a guard handle deletes the lock as the completion signal, and tamper-evidence detection (lock content + ACL structure) marks forged rescue attempts as `tampered` (`EXIT:-999`).
- **Cursor-based output reads** — `read(id)` returns only new bytes; the cursor survives restarts, so long outputs are never re-read or lost.
- **Concurrent adoption safety** — 50 independent processes racing to finalize the same orphan produce exactly one terminal state (idempotent finalize + atomic state marker rename).
- **`wait` / `close` lifecycle** — poll to a terminal state; stop monitor timers cleanly.

## Quick start

```sh
dsh plugin --profile <name> add "github:<owner>/dsh-witness#v0.1.0"
```

The repo commits its build output (`lib/`), so git installs need no build step.

```ts
import { WitnessJobRegistry } from 'dsh-witness'

const reg = new WitnessJobRegistry(ctx, {
  jobsRoot: './data/witness-jobs',     // truth source: one directory per task
  indexDbPath: './data/witness-index.db', // rebuildable index cache
  adoptMonitorMs: 30000,               // adoption sweep interval
})

const id = reg.start({ kind: 'pwsh', label: 'long-task', command: 'Start-Sleep 60; Write-Output done' })
const snap = await reg.wait(id, 120000)  // → completed | failed | tampered
const output = reg.read(id)              // cursor-based incremental read
reg.close()                              // stop monitor timers
```

## Acceptance evidence

`test/witness-final-test.ts` — 12 scenarios, 34 assertions, 3 consecutive stable runs (Windows 10/11, Node ≥ 22, PowerShell 5.1+):

- **Persistence (4)** — restart survival, zombie recovery after kill -9, output cursor continuation, ID collision-free
- **Adoption & coordination (4)** — 50-process O_EXCL competition with exactly one terminal state, cross-session adoption, silent-task protection, PID-reuse defense
- **Event sourcing (2)** — complete event log ordering, autopsy report generation
- **Sandbox boundary (2)** — overwrite blocked, delete blocked

Run it yourself: `node --experimental-strip-types test/witness-final-test.ts`

## Honest boundaries

- **Windows-first.** Tested on Windows NTFS with PowerShell. Linux/macOS need a port: the lock protocol (O_EXCL + startSec), the sandbox (ACL → other mechanisms), and the runner (detached node + PowerShell) are Windows-specific today.
- **Arbitrary-code rescue is out of scope at the ACL layer** — a task that loads native code (P/Invoke) can self-rescue its own ACLs as the file owner. The tamper-evidence detection turns such forgery into a visible `tampered` verdict instead of silently trusting it; full confinement of the arbitrary-code layer is the restricted-token job (see the official Harness sandbox recipe).
- The task can always destroy its own output — that only hurts itself and is visible in the evidence chain.

## License

Apache-2.0
