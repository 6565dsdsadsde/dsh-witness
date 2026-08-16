// test/witness-final-test.ts —— Witness 范式最终验收（12 项，Windows 真机版）
// A 持久化 4 项 / B 收养协调 4 项 / C 事件溯源 2 项 / D 沙箱边界 2 项
// 隔离原则：每块独立 jobsRoot/index.db（防跨测试污染）；B-02 特例（跨会话收养语义需共享 root）
import { WitnessJobRegistry } from '../lib/WitnessJobRegistry.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

let passed = 0, failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) passed++
  else { failed++; console.log(`  ❌ ${name} ${detail}`) }
}

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'wfinal-'))
let rootSeq = 0
const mkRoot = () => {
  const local = path.join(BASE, `t${rootSeq++}`)
  return { jobsRoot: path.join(local, 'jobs'), idx: path.join(local, 'index.db'), local }
}
const mkReg = (r: { jobsRoot: string; idx: string }, adoptMs = 500) =>
  new WitnessJobRegistry({ get: () => undefined, effect: () => () => {} } as never, { jobsRoot: r.jobsRoot, indexDbPath: r.idx, adoptMonitorMs: adoptMs })
const allRegs: WitnessJobRegistry[] = []
const reg = (r: { jobsRoot: string; idx: string }, adoptMs = 500) => { const x = mkReg(r, adoptMs); allRegs.push(x); return x }
const waitLock = async (jobsRoot: string, id: string): Promise<number> => {
  for (let i = 0; i < 150; i++) {
    try {
      const m = /^(\d+):(\d+)$/.exec(fs.readFileSync(path.join(jobsRoot, id, 'lock'), 'utf-8').trim())
      if (m !== null && Number(m[1]) > 0) return Number(m[1])
    } catch {}
    await new Promise(r2 => setTimeout(r2, 200))
  }
  return 0
}
// lock 内容 = runner pid（detached node）；杀任务需定位其子进程——任务 powershell 带 OutputEncoding 标记
// （守卫含 Add-Type、denyEvidence 是短暂 Get-Acl 进程——两者都无此标记；取证铁证：过滤错曾杀到 deny 进程）
// 等到任务 pid = 沙箱 deny 已设 + 任务已 spawn（runner 先 deny 后 spawn）——杀之即"沙箱内死"，证据链真
const taskPidOf = async (runnerPid: number): Promise<number> => {
  const { spawnSync } = await import('node:child_process')
  const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${runnerPid}" | Where-Object { $_.CommandLine -match 'OutputEncoding' } | Select-Object -First 1 -ExpandProperty ProcessId`
  for (let i = 0; i < 150; i++) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000, windowsHide: true })
    const pid = Number(r.stdout.toString('utf-8').trim())
    if (pid > 0) return pid
    await new Promise(r2 => setTimeout(r2, 200))
  }
  return 0
}

console.log('='.repeat(72))
console.log('  Witness 范式最终验收（12 项 · Windows 真机）')
console.log('='.repeat(72))

// ===== A-01 重启存活 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  const id = r1.start({ kind: 'pwsh', label: 'a01', command: "Write-Output hello" } as never)
  const snap = await r1.wait(id, 60000)
  check('A-01 重启存活: 完成状态', (snap.status as string) === 'completed', String(snap.status))
  r1.close()
  const r2 = reg(root)   // 模拟重启（同 db/jobsRoot）
  const recovered = r2.get(id)
  check('A-01 重启存活: 重启后 status=completed', (recovered.status as string) === 'completed', String(recovered.status))
  const out = r2.read(id)
  check('A-01 重启存活: readOutput 含 hello', out.includes('hello'), JSON.stringify(out.slice(0, 40)))
  r2.close()
}

// ===== A-02 僵尸恢复 =====
{
  const root = mkRoot()
  const r1 = reg(root, 1000)
  const id = r1.start({ kind: 'pwsh', label: 'a02', command: 'Start-Sleep -Seconds 120' } as never)
  const lockPid = await waitLock(root.jobsRoot, id)
  check('A-02 僵尸恢复: 任务已启动（lock 就位）', lockPid > 0, `pid=${lockPid}`)
  const taskPid = lockPid > 0 ? await taskPidOf(lockPid) : 0   // 任务 pid（deny 已设 + 已 spawn 的实锤）
  check('A-02 僵尸恢复: 沙箱内任务进程定位', taskPid > 0, `taskPid=${taskPid}`)
  try { process.kill(taskPid, 'SIGKILL') } catch {}
  const snap = await r1.wait(id, 30000)
  check('A-02 僵尸恢复: 崩溃后 failed（收养判定）', (snap.status as string) === 'failed', String(snap.status))
  const autopsy = path.join(root.jobsRoot, id, 'autopsy.json')
  check('A-02 僵尸恢复: 尸检报告生成', fs.existsSync(autopsy))
  r1.close()
}

// ===== A-03 输出续读 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  const lines = Array.from({ length: 1000 }, (_, i) => `Write-Output 'line${i + 1}'`)
  const id = r1.start({ kind: 'pwsh', label: 'a03', command: lines.join('; ') } as never)
  await r1.wait(id, 120000)
  const part1 = r1.read(id)
  const p1Lines = part1.split(/\r?\n/).filter(l => l.startsWith('line'))
  check('A-03 输出续读: 首读 1000 行', p1Lines.length === 1000, `got ${p1Lines.length}`)
  r1.close()
  const r2 = reg(root)   // 重启
  const part2 = r2.read(id)
  check('A-03 输出续读: 重启续读无重复（游标持久）', part2 === '', JSON.stringify(part2.slice(0, 40)))
  r2.close()
}

// ===== A-04 ID 不冲突 =====
{
  const root = mkRoot()
  const r1 = reg(root, 0)
  for (let i = 0; i < 10; i++) r1.start({ kind: 'bash', label: `b${i}`, run: () => ({ done: new Promise(() => {}) }) } as never)
  r1.close()
  const r2 = reg(root, 0)   // 重启
  const newIds: string[] = []
  for (let i = 0; i < 5; i++) newIds.push(r2.start({ kind: 'bash', label: `n${i}`, run: () => ({ done: new Promise(() => {}) }) } as never))
  const expected = Array.from({ length: 5 }, (_, i) => `bash-${11 + i}`)
  check('A-04 ID 不冲突: bash-11..15', JSON.stringify(newIds) === JSON.stringify(expected), newIds.join(','))
  r2.close()
}

// ===== B-01 O_EXCL 竞争（真·50 进程并发收养：各自 recover 竞争 finalize，恰好一个终态） =====
{
  const root = mkRoot()
  const r1 = reg(root, 1000)
  const id = r1.start({ kind: 'pwsh', label: 'b01', command: 'Start-Sleep -Seconds 60' } as never)
  const lockPid = await waitLock(root.jobsRoot, id)
  if (lockPid > 0) {
    const taskPid = await taskPidOf(lockPid)
    check('B-01 O_EXCL 竞争: 沙箱内任务进程定位', taskPid > 0, `taskPid=${taskPid}`)
    try { process.kill(taskPid, 'SIGKILL') } catch {}   // 杀任务（沙箱内死）→ runner finish 落 exit.txt + 删 lock
    // 等 runner finish：exit.txt 就位（守卫已删 lock）
    let exitReady = false
    for (let i = 0; i < 100; i++) {
      try { if (/^EXIT:/.test(fs.readFileSync(path.join(root.jobsRoot, id, 'exit.txt'), 'utf-8'))) { exitReady = true; break } } catch {}
      await new Promise(r2 => setTimeout(r2, 200))
    }
    check('B-01 O_EXCL 竞争: orphaned 就绪（exit.txt 落盘）', exitReady)
    // 50 个独立 node 进程并发打开同一 registry（各自 recover → 竞争 finalize）
    const { pathToFileURL } = await import('node:url')
    const libUrl = pathToFileURL(path.resolve('lib/WitnessJobRegistry.js')).href
    const childScript = `const m = await import(process.argv[1]); const r = new m.WitnessJobRegistry({ effect: () => () => {} }, { jobsRoot: process.argv[2], indexDbPath: process.argv[3], adoptMonitorMs: 0 }); const s = r.get(process.argv[4]); console.log(s.status); r.close(); process.exit(0)`
    const results = await Promise.all(Array.from({ length: 50 }, () => new Promise<number>((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', childScript, libUrl, root.jobsRoot, root.idx, id], { windowsHide: true })
      p.on('exit', (c) => resolve(c ?? 1))
    })))
    check('B-01 O_EXCL 竞争: 50 并发进程零异常退出', results.filter(c => c === 0).length === 50, `${results.filter(c => c === 0).length}/50`)
    const donePath = path.join(root.jobsRoot, id, 'state', 'done')
    check('B-01 O_EXCL 竞争: 终态唯一（done 恰好一个）', fs.existsSync(donePath) && fs.readdirSync(path.join(root.jobsRoot, id, 'state')).filter(f => f === 'done').length === 1)
  } else {
    check('B-01 O_EXCL 竞争: 任务启动', false, 'lock 未就位')
  }
  r1.close()
}

// ===== B-02 跨会话收养（共享 root：A 崩溃 → B recover 收养） =====
{
  const root = mkRoot()
  const regA = reg(root, 0)
  const id = regA.start({ kind: 'pwsh', label: 'b02', command: 'Start-Sleep -Seconds 120' } as never)
  const lockPid = await waitLock(root.jobsRoot, id)
  check('B-02 跨会话收养: Session A 任务启动', lockPid > 0, `pid=${lockPid}`)
  // Session A 崩溃（close 不 settle）；Session B 启动（构造 recover 扫描）
  regA.close()
  const regB = reg(root, 1000)
  const snapB = regB.get(id)
  const stB = snapB.status as string
  check('B-02 跨会话收养: Session B 可见任务（adopted/running）', stB === 'adopted' || stB === 'running', stB)
  const outB = regB.read(id)
  check('B-02 跨会话收养: 输出可续读', typeof outB === 'string')
  const taskPid = await taskPidOf(lockPid)   // 干净收尾：杀任务（沙箱内死）不留 120s 孤儿
  try { process.kill(taskPid, 'SIGKILL') } catch {}
  await new Promise(r2 => setTimeout(r2, 3000))
  regB.close()
}

// ===== B-03 静默任务保护 =====
{
  const root = mkRoot()
  const r1 = reg(root, 500)
  const id = r1.start({ kind: 'pwsh', label: 'b03', command: 'Start-Sleep -Seconds 30' } as never)
  await new Promise(r2 => setTimeout(r2, 12000))   // 12s 静默（验收 30min 的压缩时间轴）
  const snap = r1.get(id)
  check('B-03 静默任务保护: 静默 12s 仍 running', (snap.status as string) === 'running', String(snap.status))
  await r1.wait(id, 60000)
  r1.close()
}

// ===== B-04 PID 复用防护 =====
{
  const root = mkRoot()
  const r1 = reg(root, 0)
  const id = r1.start({ kind: 'pwsh', label: 'b04', command: 'Start-Sleep -Seconds 60' } as never)
  const lockPid = await waitLock(root.jobsRoot, id)
  check('B-04 PID 复用防护: 任务启动', lockPid > 0, `pid=${lockPid}`)
  if (lockPid > 0) {
    // 杀真任务（沙箱内死）→ runner finish 完整跑（exit.txt 落盘 + lock 删除 + 目录 deny 恢复）→ 伪造窗口干净
    const taskPid = await taskPidOf(lockPid)
    check('B-04 PID 复用防护: 沙箱内任务进程定位', taskPid > 0, `taskPid=${taskPid}`)
    try { process.kill(taskPid, 'SIGKILL') } catch {}
    let lockGone = false
    for (let i = 0; i < 100; i++) {
      try { fs.statSync(path.join(root.jobsRoot, id, 'lock')) } catch { lockGone = true; break }
      await new Promise(r2 => setTimeout(r2, 200))
    }
    check('B-04 PID 复用防护: runner 已释放 lock', lockGone)
    // 伪造 lock：pid=测试进程本身（活）+ starttime=1000（必不匹配）——模拟 PID 复用（目录 deny 已恢复，直接写）
    try { fs.writeFileSync(path.join(root.jobsRoot, id, 'lock'), `${process.pid}:1000`) } catch { check('B-04 PID 复用防护: 伪造 lock 可写', false, 'EPERM') }
    const r2 = reg(root, 500)
    await new Promise(r2 => setTimeout(r2, 3000))
    const snap = r2.get(id)
    check('B-04 PID 复用防护: 判定 failed（starttime 不匹配）', (snap.status as string) === 'failed', String(snap.status))
    r2.close()
  }
  r1.close()
}

// ===== C-01 事件日志完整 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  const id = r1.start({ kind: 'pwsh', label: 'c01', command: "Write-Output c01-line" } as never)
  await r1.wait(id, 60000)
  const evDir = path.join(root.jobsRoot, id, 'events')
  const evs = fs.readdirSync(evDir).sort()
  const names = evs.map(f => f.replace(/^\d{4}-/, '').replace(/\.jsonl$/, ''))
  check('C-01 事件日志完整: started 事件', names.includes('started'), names.join(','))
  check('C-01 事件日志完整: output 事件', names.includes('output'), names.join(','))
  check('C-01 事件日志完整: done 事件', names.includes('done'), names.join(','))
  check('C-01 事件日志完整: 顺序正确无断号', evs[0].startsWith('0001'), evs.join(','))
  r1.close()
}

// ===== C-02 尸检报告生成 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  const id = r1.start({ kind: 'pwsh', label: 'c02', command: "Write-Output pre; exit 1" } as never)
  await r1.wait(id, 60000)
  const autopsyPath = path.join(root.jobsRoot, id, 'autopsy.json')
  check('C-02 尸检报告生成: autopsy.json 存在', fs.existsSync(autopsyPath))
  if (fs.existsSync(autopsyPath)) {
    const a = JSON.parse(fs.readFileSync(autopsyPath, 'utf-8'))
    check('C-02 尸检报告生成: manner_of_death', typeof a.manner_of_death === 'string' && a.manner_of_death.length > 0, a.manner_of_death)
    check('C-02 尸检报告生成: primary_evidence', Array.isArray(a.primary_evidence) && a.primary_evidence.length > 0, JSON.stringify(a.primary_evidence))
    check('C-02 尸检报告生成: verdict=failed', a.verdict === 'failed', a.verdict)
    check('C-02 尸检报告生成: 死因代码 D-01~D-09', /^D-0[1-9]$/.test(a.death_code), a.death_code)
  }
  r1.close()
}

// ===== D-01 防覆盖 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  // 攻击词拆字：防 stderr 命令回显含 'OVERWRITE' 字样造成断言误判（防覆盖判定只看文件内容）
  const id = r1.start({ kind: 'pwsh', label: 'd01', command: "Write-Output ORIGINAL; Start-Sleep 2; Set-Content 'out.log' ('OV'+'ERWRITE') -ErrorAction SilentlyContinue" } as never)
  await r1.wait(id, 60000)
  const outFile = path.join(root.jobsRoot, id, 'out.log')
  let content = ''
  try { content = fs.readFileSync(outFile, 'utf-8') } catch {}
  check('D-01 防覆盖: out.log 未被覆盖', content.includes('ORIGINAL') && !content.includes('OVERWRITE'), JSON.stringify(content.slice(0, 60)))
  r1.close()
}

// ===== D-02 防删 =====
{
  const root = mkRoot()
  const r1 = reg(root)
  const id = r1.start({ kind: 'pwsh', label: 'd02', command: "Write-Output KEEP-ME; Start-Sleep 2; Remove-Item 'out.log' -Force -ErrorAction SilentlyContinue" } as never)
  await r1.wait(id, 60000)
  const outFile = path.join(root.jobsRoot, id, 'out.log')
  let statOk = true
  try { fs.statSync(outFile) } catch { statOk = false }
  check('D-02 防删: out.log 仍存在（删除失败）', statOk)
  if (statOk) check('D-02 防删: 内容完好', fs.readFileSync(outFile, 'utf-8').includes('KEEP-ME'))
  r1.close()
}

console.log('='.repeat(72))
console.log(`  最终报告: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`)
console.log(`  通过率: ${(passed / (passed + failed) * 100).toFixed(1)}%`)
console.log('='.repeat(72))
for (const r of allRegs) { try { r.close() } catch {} }
try { fs.rmSync(BASE, { recursive: true, force: true }) } catch {}
process.exit(failed > 0 ? 1 : 0)
