# 完整已构建结构导出实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development。单一实现者端到端完成关联的前后端链路，再依次 SPEC → QUALITY。主审只维护验收记录及独立验证。

**目标：** 从 React 下载完整当前模型的多材料 STL ZIP，明确未重建与历史快照语义。

**架构：** 保留现有 export_zip／下载端点、ProcessModel 网格与 ZIP 格式；增加 typed
client、导出专用呈现与 provider 互斥操作。导出只写会话导出文件，不执行或恢复工艺。

**技术栈：** React、TypeScript、既有 Python worker、Vitest、unittest、真实浏览器。

## 批准与文件职责

所有者已在 `8366c97` 书面规格后明确回复「确认」。规格为
`docs/superpowers/specs/2026-10-25-structure-export-design.md`，起点 `8130e22`，
分支 `codex/structure-export`。复用工作树
`/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
上一段合并后基线为前端 808／后端 207 通过；本段日志使用主审提供的临时目录。

- `tcad_simulator.py`：仅 export_zip 的可选 include_agent_report 布尔控制，缺省保留旧行为。
- `tests/test_structure_export_http.py`：隔离真实 session，HTTP 打包、二进制下载及 ZIP 实物与状态保持。
- `docs/ARCHITECTURE_TARGET.md`：细化已有 export 两端点，关联新布尔选项与命名 HTTP 测试。
- `frontend/src/api/types.ts`、`schemas.ts`、`client.ts`：typed 导出响应、安全文件名、非空 Blob。
  可将新方法设为 optional 兼容旧注入 API；缺方法时入口必须明确不可用，不能静默成功。
- `frontend/src/api/structureExport.test.ts`：实际 fetch 边界、schema、Blob、signal 与错误封套。
- `frontend/src/state/AppStateContext.tsx`、`appReducer.ts`：导出操作互斥，但保留历史索引、
  原有工艺错误、执行结果、模型与 preview generation。不得借运行动作清空这些字段。
- `frontend/src/components/StructureExportDialog.tsx`：原生弹窗，说明／确认／进度／本地导出错误。
- `frontend/src/components/structureExportState.ts`：若 Toolbar、Dialog、provider 共用门禁，
  以此小纯函数模块集中派生，禁止复制三份相互分歧的条件；不计算几何。
- `frontend/src/components/Toolbar.tsx`、`i18n/catalogs.ts`：入口与双语文案。
  必要样式只限定 `.structure-export-dialog`，复用既有模态风格，不改全局控件或三栏。
- `StructureExportDialog.test.tsx`、`state/StructureExport.test.tsx`、既有 Toolbar／reducer
  测试：真实 provider 的门禁、确认、互斥与状态不变。fixture 仅补必要 API，不削弱断言。

## 任务 1：TDD 与关联实现（单一写者）

- [ ] 先运行现有 Toolbar、provider、reducer、client 测试作为当前专项基线；记录数量。
- [ ] 在真实 HTTP 测试先写报告开关 RED：临时两材料结构经正式步骤构建，ui_state 中
  放一个测试 Agent 报告标记，include_agent_report=false 包中不应有 agent_report.md，
  不传选项的旧请求仍含该报告。先证明失败为当前报告总被附带，不是连接或 fixture 错误。

```python
status, headers, raw = self._request(base, cookie, 'POST', '/api/export', {
    'sti': True, 'cross': False, 'metrics': False,
    'merge_same_materials': True, 'include_agent_report': False,
})
self.assertEqual(status, 200)
prepared = json.loads(raw)['result']
status, headers, archive = self._request(base, cookie, 'GET',
    '/api/export/download?file=' + urllib.parse.quote(prepared['zip_file']))
self.assertEqual(status, 200)
with zipfile.ZipFile(io.BytesIO(archive)) as zf:
    self.assertNotIn('agent_report.md', zf.namelist())
```

测试 fixture 复用 `tests.test_webui_cad_shell.M2ApiContractTests._request` 及
StructureEditorHTTPTests 的 manager 启停方式，临时目录、线程数 1、小 domain。
用真实 grid/slice、导出 Recipe、timeline、manifest revision 和 owner 数据前后对比，
不用输入常量冒充 STL 测量；解析 vertex 浮点，检查非空、有限值、µm 范围及材料分组。
默认报告兼容、显式关闭、空模型、下载不存在均有行为证据。

- [ ] 后端最小实现：先验证新选项为 bool，缺省 True；仅既有报告生成条件增加此布尔门禁。
  不改网格、_export_zip 的既有其他选项、文件清理策略或其他 worker 命令。更新契约表
  参数／zip_file/files 字段与上述命名测试。GREEN 后提交独立小后端提交。
- [ ] 先添加实际 fetch 与 UI/provider RED：旧 Toolbar 无入口或缺 export 行为的断言失败，
  避免只有 nonexistent-module 导入错误。client 在原有方法附近添加真实方法测试。
- [ ] typed client 固定打包参数和下载路径，接口可使用以下形状（命名可沿既有惯例）：

```ts
interface StructureExportView {zipFile: string; files: string[]}
interface TcadApi {
  prepareStructureExport?(signal?: AbortSignal): Promise<StructureExportView>;
  downloadStructureExport?(zipFile: string, signal?: AbortSignal): Promise<Blob>;
}
```

schema 必须拒绝空名、目录分隔符、点路径、编码后路径、控制字符或非 ZIP 基名；
files 必须是字符串数组且有非空 STL 条目，不把 staging 全路径显示或用于下载。
复用 apiPostJson/apiBlob 的 same-origin、错误封套与 AbortSignal；拒绝空二进制。

- [ ] provider 增加导出 action，开始时重新核对 mounted、连接、模型、mutual gate、
  applying、pending save、活动草稿和 pending type candidate。导出持有同一 gate 至
  打包和下载结束；无自动执行、保存、init、reconcile 或 timeline 请求。示意序列：

```ts
// Lock and recheck the confirmed UI source before issuing either request.
const prepared = await api.prepareStructureExport!(signal);
onProgress('downloading');
const blob = await api.downloadStructureExport!(prepared.zipFile, signal);
// Trigger one local download, then release its object URL and the existing gate.
```

导出启动和结束的 reducer 状态只改 busy/export operation；preserve historicalStepIndex、
recipe、stepErrors、globalError、executionResult、timeline、model、previewGeneration。
错误返回调用者，弹窗本地呈现，不调用 run/failed 或清旧工艺错误。所有路径 finally
释放 controller/gate/URL；卸载取消等待，不再更新卸载组件。callback 只报告打包／下载。

- [ ] 纯门禁派生供入口与确认共用；有 enabled 的 ready/dirty/error/running 步骤、
  现存步骤错误或仅初始化时需要用户确认导出已有结果。disabled 步骤不要求运行。
  历史快照显示实际 index 对应步骤。确认勾选绑定当时的 recipe/model/历史与 preview
  来源，模型切换或配方修改后失效；相机、显隐、透明度和语言不令其失效。
- [ ] 弹窗仅说明 ZIP、全部材料与 µm、网格导出能力限制，stale/wafer 提示和 checkbox、
  packing/downloading 进度、下载成功或本地错误及手动 retry。再确认时不能沿用失效勾选。
  busy 禁止重复与关闭；Escape 未忙时可关闭，卸载安全，焦点归入口。失败不自动重试。
- [ ] 对并发、失败和保留状态写实际集成测试：重复确认仅一 POST/GET；导出期间其他
  run/step/save/mask/import/undo/timeline 写操作被拒；历史、旧错误与参考 Z、Viewer mount
  保持；失败重试重验门禁；关闭与卸载释放资源；局部错误能在切语言后正确显示。
- [ ] 完整前端、typecheck/build、HTTP 专项与 diff check 全过后提交 UI/契约链路。必要
  fixture 补方法可以集中 helper；不重写测试体系，不降低断言、放宽 timeout 或增依赖。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=<evidence>/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_structure_export_http
git diff --check
```

## 任务 2：主审独立回归、浏览器和复审

- [ ] 实现者释放 npm 锁后，主审独立完整前端、typecheck/build；Python 串行 HTTP 专项、
  AGENTS 五模块、py_compile、grid128，pycache 与数据在临时目录。日志记录实际 SHA。
- [ ] CUA 真实隔离服务导入小结构，正式 Build All 后导出并取得下载的 ZIP 本地实物；
  Python 只读检查该下载 ZIP/STL 数值和材料清单，不用直接接口代替浏览器操作。
- [ ] 检查中英文、未构建勾选、仅晶圆说明、历史快照标签、眼睛／剖切不影响完整导出、
  窄窗口/键盘/焦点。失败重试优先由集成测试证据，浏览器可用隔离空模型测试真实错误；
  不修改用户网络、注入隐藏状态或重启用户服务。截图及实际 ZIP 存证据根。
- [ ] 独立 SPEC 对完整差异审查，通过后独立 QUALITY；问题交原实现者修复并增量复审。
- [ ] 关闭自己创建的服务和临时标签，回填八项边界、日志、实际 ZIP 检查与已知限制，
  提交纯验收记录；合并和推送待所有者决定。

## 自检

导出完整模型、未重建与历史说明、单位、Agent 报告、空模型、下载实物、安全文件名、
并发门禁、旧工艺错误保持、双语/资源释放均有对应测试或浏览器对象。状态辅助模块只
为共享 UI 门禁；不建立新的几何、文件格式或后端执行路径。
