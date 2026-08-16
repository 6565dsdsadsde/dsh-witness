# dsh-witness 实验记录

> 原则：没实测不声称。每个能力声明带实验编号与对照组；本记录按原始数据核对。

## EXP-1 锁文件协议（detach-runner）

两个前置判决：
- **detached 是子进程存活必要条件**：不 detached 时父进程死、托管进程跟着死。
- **托管层必须是 node 包装，不能直接 powershell**：`powershell + detached` 完全不执行命令（实测铁证）；`node detached` 存活 ✓，node 再用 pipe stdio 托管 powershell（fd stdio 会静默丢输出，实测判决）。

协议：启动时 O_EXCL 创建 `spawnDir/lock`（内容 `pid:startTimeTicks`）；每 60s touch 锁 mtime（观测式心跳）；正常退出删锁（完成信号）；崩溃则锁残留但内容可读（收养判定依据）。

## EXP-2 三证据收养

收养判定 = lock 内容（`pid:startSec`）+ 进程存活 + 启动时间比对。第三证据防 PID 复用：伪造 `lock = 存活进程 pid + 错误 startSec` 被判定 failed（12 项验收 B-04 实测）。

## EXP-3 O_EXCL 竞争

50 个独立进程同时竞争终结同一个孤儿任务，恰好产生一个终态（幂等 finalize + 原子状态标记；12 项验收 B-01 实测）。

## EXP-4 索引缓存

1000 任务（100 活跃/900 静止）×100 轮：纯目录扫描 82.1ms/轮 vs 快照 + 目录 mtime 失效 22.9ms/轮（3.6x）。510 次状态转移全部被目录 mtime 精确检测重扫；append 输出不触发失效（证人与账房分工）。

## EXP-5 沙箱（Windows NTFS ACL）

- 六维闭合：证据文件的覆盖/追加/改名/删除/伪造全挡，任务 spawn 前施加。
- open-before-deny 架构：ACL deny 生效前打开的句柄仍可写——守卫句柄持有 lock 作为完成信号。
- 观测纪律：deny 生效窗口内 `existsSync` 误报 false 而 `statSync` 可靠——观测读一律走 statSync + 重试。
- fail-closed：沙箱施加失败（如管理员环境下 ACL 失效）时 runner 写 `EXIT:-998` 并拒绝执行。
- 留痕检测：任务自救伪造（改 lock 内容/ACL）被识破 → `EXIT:-999` → 显式 `tampered` 判决。

## EXP-6 输出游标续读

`read(id)` 只返回新字节，游标跨重启持久：1000 行输出首读 1000 行、重启后续读为空（不重不漏；12 项验收 A-03 实测）。

## EXP-7 12 项验收

`test/witness-final-test.ts`：12 场景 / 34 断言，连跑稳定全绿。分类：持久化 A（重启存活/僵尸恢复/游标续读/ID 不冲突）、收养协调 B（50 进程竞争/跨会话收养/静默保护/PID 复用防护）、事件溯源 C（事件日志完整有序/尸检报告）、沙箱边界 D（防覆盖/防删）。实测环境：Windows 11 Pro · Node 25.8 · PowerShell 5.1。

## EXP-8 收养延迟（benchmark）

kill -9 后任务被判终态（终态落盘）的延迟分布，×3 复跑稳定（本机 Windows 11 · Node 25.8，每配置 10 次）：

| 配置 | p50 | p99 | 范围 |
|---|---|---|---|
| A 冷启动收养（新实例 recover） | **9.9~10.4ms** | 11.5~16.8ms | 8.5~16.8ms |
| B 活实例监控收养（周期 100ms）| 219.9~224.0ms | 225.5~297.2ms | 211.9~297.2ms |
| B 活实例监控收养（周期 500ms）| 425.2~449.9ms | 438.3~472.6ms | 416.8~472.6ms |

判决：冷启动收养 p50 ≈ 10ms（构造期同步扫描 + 三证据判定）；活实例监控收养 ≈ 监控周期 + 十余毫秒判定开销。收养延迟的代价由 adoptMonitorMs 显式权衡。
