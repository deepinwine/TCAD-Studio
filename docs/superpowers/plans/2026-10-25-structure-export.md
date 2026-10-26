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
上一段合并后基线为前端 808／后端 207 通过；本段日志使用
`/tmp/tcad-structure-export-D3ZyJz/`，不提交运行数据。

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
- `frontend/src/App.tsx`、`frontend/src/mask/MaskWorkbench.tsx` 及 Results／集成测试：
  仅补保存／导入应用的 gate 开始／结束接线。调查发现旧 onWriteStart 只失效执行结果，
  原始资产 API 不持有 provider gate；主审确认这是落实已批准写入互斥所必需的最小改动。
  不改变版图编辑、资产发布、文件导入导出算法或数据契约。

## 任务 1：TDD 与关联实现（单一写者）

- [x] 先运行现有 Toolbar、provider、reducer、client 测试作为当前专项基线；记录数量。
- [x] 在真实 HTTP 测试先写报告开关 RED：临时两材料结构经正式步骤构建，ui_state 中
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

- [x] 后端最小实现：先验证新选项为 bool，缺省 True；仅既有报告生成条件增加此布尔门禁。
  不改网格、_export_zip 的既有其他选项、文件清理策略或其他 worker 命令。更新契约表
  参数／zip_file/files 字段与上述命名测试。GREEN 后提交独立小后端提交。
- [x] 先添加实际 fetch 与 UI/provider RED：旧 Toolbar 无入口或缺 export 行为的断言失败，
  避免只有 nonexistent-module 导入错误。client 在原有方法附近添加真实方法测试。
- [x] typed client 固定打包参数和下载路径，接口可使用以下形状（命名可沿既有惯例）：

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

- [x] provider 增加导出 action，开始时重新核对 mounted、连接、模型、mutual gate、
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

版图保存／导入应用也要持有相同 gate：可将 onWriteStart 的兼容类型扩为 boolean|void，
旧 void 视为准入，App 传 provider beginMaskWrite，配套 endMaskWrite 在本次成功取得 gate
后的 finally 释放。拒绝时 API 零调用，执行结果不失效，也不能释放另一个导出的锁。
先取得 gate 再失效前缀；取消、只读与版图导出保持不失效。新增双向 deferred 集成测试：
mask 写入待响应时导出被拒，导出待响应时保存／导入应用被拒，失败／中止也能释放本次锁。

- [x] 纯门禁派生供入口与确认共用；有 enabled 的 ready/dirty/error/running 步骤、
  现存步骤错误或仅初始化时需要用户确认导出已有结果。disabled 步骤不要求运行。
  历史快照显示实际 index 对应步骤。确认勾选绑定当时的 recipe/model/历史与 preview
  来源，模型切换或配方修改后失效；相机、显隐、透明度和语言不令其失效。
- [x] 弹窗仅说明 ZIP、全部材料与 µm、网格导出能力限制，stale/wafer 提示和 checkbox、
  packing/downloading 进度、下载成功或本地错误及手动 retry。再确认时不能沿用失效勾选。
  busy 禁止重复与关闭；Escape 未忙时可关闭，卸载安全，焦点归入口。失败不自动重试。
- [x] 对并发、失败和保留状态写实际集成测试：重复确认仅一 POST/GET；导出期间其他
  run/step/save/mask/import/undo/timeline 写操作被拒；历史、旧错误与参考 Z、Viewer mount
  保持；失败重试重验门禁；关闭与卸载释放资源；局部错误能在切语言后正确显示。
- [x] 完整前端、typecheck/build、HTTP 专项与 diff check 全过后提交 UI/契约链路。必要
  fixture 补方法可以集中 helper；不重写测试体系，不降低断言、放宽 timeout 或增依赖。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-structure-export-D3ZyJz/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_structure_export_http
git diff --check
```

## 任务 2：主审独立回归、浏览器和复审

- [x] 实现者释放 npm 锁后，主审独立完整前端、typecheck/build；Python 串行 HTTP 专项、
  AGENTS 五模块、py_compile、grid128，pycache 与数据在临时目录。日志记录实际 SHA。
- [x] CUA 真实隔离服务导入小结构，正式 Build All 后导出并取得下载的 ZIP 本地实物；
  Python 只读检查该下载 ZIP/STL 数值和材料清单，不用直接接口代替浏览器操作。
- [x] 检查中英文、未构建勾选、仅晶圆说明、历史快照标签、眼睛／剖切不影响完整导出、
  窄窗口/键盘/焦点。失败重试优先由集成测试证据，浏览器可用隔离空模型测试真实错误；
  不修改用户网络、注入隐藏状态或重启用户服务。截图及实际 ZIP 存证据根。
- [x] 独立 SPEC 对完整差异审查，通过后独立 QUALITY；问题交原实现者修复并增量复审。
- [x] 关闭自己创建的服务和临时标签，回填八项边界、日志、实际 ZIP 检查与已知限制，
  提交纯验收记录；合并和推送待所有者决定。

## 自检

导出完整模型、未重建与历史说明、单位、Agent 报告、空模型、下载实物、安全文件名、
并发门禁、旧工艺错误保持、双语/资源释放均有对应测试或浏览器对象。状态辅助模块只
为共享 UI 门禁；不建立新的几何、文件格式或后端执行路径。

## 验收记录（2026-10-26）

### 提交与范围

代码终点 `3456d7994c48b1204c866467405de11e2ccc517a`，起点 `8130e22`。
关联提交依次为 `4968995`（后端报告开关及 HTTP 实物测试）、`9fb3188`（typed client）、
`393ee52`（弹窗、共享门禁及集成测试）、`3456d79`（保持参考 Z 呈现）。
本记录提交仅归档验收，不改变代码。主审已阅读完整生产差异及独立评审原日志。

原 App 的版图保存/导入绕过 provider 互斥，因此按本计划职责声明增加最小 begin/end
接线：准入被拒时不发请求、不失效结果、不释放其他操作的锁；不改版图算法或协议。
ACK 来源比较允许 reducer 双路径生成的内容相同对象，同时比较历史位置、模型 revision
与 preview generation；相机、显隐和语言不进入模型来源。

### 测试与修复证据

证据根 `/tmp/tcad-structure-export-D3ZyJz/`，全部运行数据在工作树外。

| 执行者与命令 | 结果与日志 |
| --- | --- |
| 实现者既有四文件专项基线 | 171 PASS，`frontend-baseline.log` |
| HTTP 报告开关及布尔类型 RED → GREEN | 先因报告仍附带和类型未拒绝失败；最终 4 PASS，`backend-red.log`、`backend-boolean-red.log`、`backend-green.log` |
| client/UI/provider/mask/locale TDD | RED 日志保留，最终完整 870 PASS，`api-red.log`、`frontend-full.log` 等；早期 fixture/环境失败不计行为 RED |
| QUALITY 发现参考 Z 呈现回归 | 真 ParameterPanel + provider 三个 deferred 场景先在 395 nm 可见断言失败，再修复；`quality-reference-red.log`、`quality-reference-green.log`（123 PASS） |
| 主审最终 `npm test -- --run --maxWorkers=1 --no-file-parallelism` | `3456d79`，47 文件 **873 PASS**，27.84 s，`root-final-frontend.log` |
| 主审最终 `npm run typecheck` / `npm run build` | 均 exit 0，`root-final-typecheck.log`、`root-final-build.log` |
| 主审 `python3 -m unittest tests.test_structure_export_http` 加 AGENTS 五模块 | **211 OK**，93.337 s，`root-backend.log`；后端验证后没有 Python 代码变更 |
| 主审 `python3 -m py_compile tcad_simulator.py tools/*.py` | exit 0，`root-compile.log` |
| 主审 `tools/run_process_cad_baseline.py --grid 128 --output .../root-grid128.json` | exit 0，5 组示例共 **39 项**检查为真，`root-grid128.log/json` |
| 独立 QUALITY 专项 | 初次 92 PASS；修复后 5 文件 **123 PASS**，`quality-independent-recheck.log` |

Python 使用 `/opt/anaconda3/bin/python3`，`TCAD_SKIP_QT=1 MPLBACKEND=Agg`，pycache 在证据根。
保留既有 jsdom canvas/navigation、Numba/TBB、Vite chunk 大小提示；无新增依赖、旧断言削弱或
测试超时放宽。QUALITY 曾用工作树外测试探针遇到 Vite 加载失败，该尝试未收集测试，
明确不作为 RED 证据；原实现者随后在正式测试文件完成真实 RED/GREEN。

初次 QUALITY 的 BLOCK-001：`export/started` 设置 `phase=running`，虽未清除执行结果对象，
但真实参数面板会把 395 nm 参考 Z 临时呈现为未解析。`3456d79` 仅保留原 phase，仍用
`activeMutation=export` 和同步 gate 禁写。新增成功、打包失败、下载失败三种测试，覆盖
两阶段参考 Z 可见、写 API 零调用和收尾状态保持。修复后所有检查通过。

### 真实浏览器及 ZIP 实物

主审通过 CUA 使用隔离 `127.0.0.1:8830/studio/`，domain 为 12×12×48、10 nm、单线程，
正式导入配方并 Build All；没有注入 React 状态或用直接 HTTP 下载替代浏览器动作。
下载事件返回用户 Downloads 中实物，再只读复制到证据根解压。每包 CRC 正常，所有
STL 顶点非空且有限，无 `agent_report.md`。保留 Downloads 原件。

| 场景 | 实测与证据 |
| --- | --- |
| 完整模型，隐藏 oxide 步骤并启用 Z 剖切 0.2 | `browser-full-model.zip`，58,604 bytes；仍含 Si 与 SiO2 拆分、组合 STL、manifest、XYZ、height CSV；`browser-full-model-inspection.json` |
| 恢复步骤 1 历史快照 | 弹窗标注 Base silicon 与步骤 1；`browser-history-model.zip`，36,378 bytes；仅 Si 拆分及组合，时间线位置保留，`browser-history-dialog.jpg` |
| 膜厚 40 → 50 nm，保存参数但不 Build | 提交按钮先禁用，勾选后可用；切 EN 保持勾选；`browser-dirty-model.zip` 实测氧化层仍为 0.04 µm，组合高度 0.14 µm，未冒充新参数结果；`browser-dirty-ack-en.jpg` |
| 仅晶圆配方 | 显示已有结果/仅晶圆提示，确认前按钮禁用，`browser-wafer-only.jpg` |
| 640×720 窄窗、键盘及焦点 | dialog x=32、宽 576；clientWidth=scrollWidth=574；Escape 关闭后焦点返回 Export structure，视口已 reset；`browser-narrow-640.jpg` |
| PR 晶圆 + Strip 后正式空模型 | 最终代码构建后 EN 明确失败，切中文保留错误，手动重新导出仍明确失败且可再试，无 ZIP 成功；`browser-empty-error-en.jpg`、`browser-empty-retry-zh.jpg`；console warn/error=[] |
| 最终代码再次完整模型下载 | `browser-final-model.zip` CRC/尺寸复查正常；`browser-final-success-zh.jpg`；用户原件 `tcad_export_20261026_085803_507.zip` |

只读 STL 实测：Si 为 0.12×0.12×0.10 µm；SiO2 为 0.12×0.12×0.04 µm，
Z 范围 0.10–0.14 µm；组合为 0.12×0.12×0.14 µm。历史包为 0.12×0.12×0.10 µm。
后续历史/dirty/final 实物解析记录在 `browser-history-dirty-inspection.json`。
重复请求、打包/下载期间门禁与资源释放由 deferred 集成测试证明，未把浏览器截图
当作请求数量证据。长空闲后旧页面的快照请求一度因服务会话到期失败；刷新后显示
Ready，重新 Build All 后历史恢复及导出正常，不作为本特性的失败或成功捷径。

### 独立复审与八项边界

SPEC 对完整差异初审后，复核 `3456d79` 增量与浏览器实物，最终 **APPROVE**，
无 BLOCK/NB（`spec-final.log`）。原 QUALITY 代理因使用额度中断，未作出批准；
重新分派的独立 QUALITY 完整审查发现上述 BLOCK，再增量复审关闭，最终 **APPROVE**，
无剩余 BLOCK/NB（`quality.log`）。两位审查者均只读代码/refs，未操作用户服务。

| 边界 | 结果 |
| --- | --- |
| React | PASS：typed 请求、确认和界面状态；无几何运算 |
| Three.js | PASS：不改 renderer；视图显隐/剖切不进入导出请求，Viewer 保持挂载 |
| Python | PASS：仅可选布尔与附加报告开关，旧缺省行为保留 |
| C++ | PASS：无引擎、绑定或依赖变化 |
| Layout | PASS：仅必要共享 gate 接线，无版图协议/算法改变 |
| ViennaPS | PASS：无新增仿真或隐式运行 |
| Canonical | PASS：ProcessModel/Recipe 权威不变，STL 仅导出 |
| 范围、测试与存储 | PASS：关联最小实现、真实 RED/GREEN、全量回归、临时证据隔离 |

回归风险主要在共享 UI 与版图互斥，已有双向 deferred 及真实参数面板行为覆盖。
已知能力限制：STL 不嵌单位、非 BRep，沿用现有网格提取/平滑/面数策略；客户端下载
校验并非完整 ZIP 解压器，实物 CRC 另验；卸载只取消客户端等待，不保证中止 worker 打包。

自建标签已关闭，测试服务 session 48697 正常退出，8830 无监听；未改用户服务或存储。
分支保留 `codex/structure-export`，本地 main 保持 `8130e22`，studio/main 保持 `9298cc6`；
本特性未合并或推送。`origin` 指向第三方，未访问。集成方式留给所有者决定。
