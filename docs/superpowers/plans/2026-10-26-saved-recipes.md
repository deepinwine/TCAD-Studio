# 已保存配方打开与保存反馈实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development。此功能是关联的
> 契约/provider/UI 任务，由一位新实现者端到端完成，再依次 SPEC → QUALITY；主审维护本计划与独立验收。

**目标：** 在 React 中列出、打开当前服务保存的配方，明确保存结果及恢复语义。

**架构：** 复用 GET history 与 POST recipe/load/save；typed client 加法解析。
provider 维护当前 id/name、写入互斥和网络不确定后的只读对账；原生弹窗只负责列表与选择。
不增加持久化格式、工艺执行路径或几何计算。

**技术栈：** React、TypeScript、既有 Python worker、Vitest、unittest、CUA 真实浏览器。

## 批准与文件职责

所有者已明确回复「确认」批准 `1afb20f` 中
`docs/superpowers/specs/2026-10-26-saved-recipes-design.md`。代码基准 `0f90682`；
`codex/saved-recipes`；复用工作树
`/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
证据目录 `/tmp/tcad-saved-recipes-fjCjzz/`，Python cache、测试存储、截图和日志均在此。

- `frontend/src/api/types.ts`、`schemas.ts`、`client.ts`：历史摘要、saved 返回的可选当前身份、
  严格成功标志、加载后的可选 ui_state、listSavedRecipes。既有方法保留兼容签名。
- `frontend/src/api/savedRecipes.test.ts`：实际 fetch 边界、schema、AbortSignal 与错误封套。
- `frontend/src/state/appReducer.ts`、`AppStateContext.tsx`：当前身份、保存专用状态、打开、
  状态不确定保护与显式只读同步；新建/导入/启动同步身份。不得为了美观提取整个 provider。
- `frontend/src/components/savedRecipeState.ts`：若 provider/Toolbar/Dialog 共用门禁、名称或
  来源比较，用小纯函数模块集中；不复制三份逻辑、不引入泛型任务框架。
- `frontend/src/components/SavedRecipesDialog.tsx`：原生弹窗、读取代次、选择、打开、局部错误。
- `frontend/src/components/Toolbar.tsx`、`i18n/catalogs.ts`、`styles.css`：入口、名称/保存反馈、
  对等双语、仅弹窗/反馈局部样式，不改查看器、三栏或全局控件。
- `frontend/src/components/structureExportState.ts`：主审确认增加状态待确认时的导出门禁，
  与 provider action 保护对齐；这是批准规格要求的直接关联，不改导出范围/算法。
- `frontend/src/components/ParameterPanel.tsx`、`StepTypeEditor.tsx`、`StepStructureBar.tsx`、
  `frontend/src/App.tsx`：主审确认补最小的未知会话 UI 禁写，以及全局重新同步指向真实
  init/timeline 对账。只在动作层拒绝而界面仍允许编辑会令人误以为修改已提交，故属必要接线。
  `TimelineBar.tsx` 与 `RecipeAssistant.tsx` 同样仅补既有恢复/导入入口的未知态门禁，
  不改变历史恢复、解析或工艺语义。
- `frontend/src/state/SavedRecipes.test.tsx`、`components/SavedRecipesDialog.test.tsx` 及既有
  Toolbar/reducer/App/StructureExport 测试：真实 provider 的动作、状态、共享门禁与生命周期。
- `tests/test_saved_recipes_http.py`：临时真实 worker/HTTP 的保存、切换、几何与来源、重启。
- `docs/ARCHITECTURE_TARGET.md`：更新三个既有端点消费字段，关联命名 HTTP 测试。
- 主审独占本计划；`tcad_simulator.py` 原则上不改，若行为证据发现本功能必需的服务端
  缺口，先报告实际失败及最小修复范围，禁止绕过正式加载器、直接写正式体素或悄悄改语义。

## 任务 1：单一实现者完成关联功能

- [x] **建立基线。** 串行执行现有 API/provider/reducer/Toolbar 四文件专项，保存
  `baseline.log`。不安装或更新依赖。此分支继承 main 合并后前端 873/后端 211 通过的版本。

```bash
npm test -- --run src/api/client.test.ts src/state/AppStateContext.test.tsx src/state/appReducer.test.ts src/components/Toolbar.test.tsx --maxWorkers=1 --no-file-parallelism
```

- [x] **先补行为 RED。** 向真实 client 和 provider 测试添加保存成功反馈/保留历史的断言，
  确认当前因没有反馈/会退出历史而失败；列表方法新增后的缺实现失败不能代替全部行为 RED。
  记录 RED 原因与原日志；所有临时 fixture 错误单独注明，不算回归证据。

```ts
// 使用真实 provider 捕获的 context；先恢复一个有效历史模型，再保存。
const before = captured.state;
await act(async () => {await captured.actions.saveRecipe('Saved A');});
expect(captured.state.historicalStepIndex).toBe(before.historicalStepIndex);
expect(captured.state.recipe).toBe(before.recipe);
expect(captured.state.stepErrors).toBe(before.stepErrors);
```

- [x] **typed 加法。** 定义并实现以下数据；可沿现有命名微调，但不另造响应协议。

```ts
interface CurrentRecipeView {id: string; name: string}
interface SavedRecipeSummary {id: string; name: string; timestamp?: string; autosave?: boolean; note?: string}
interface SaveRecipeView {saved: boolean; currentRecipe?: CurrentRecipeView; id?: string}
// TcadApi 新增 optional，旧注入 API 缺方法时入口明确不可用。
listSavedRecipes?(signal?: AbortSignal): Promise<SavedRecipeSummary[]>;
// 既有 saveRecipe 返回值加法扩展，不移除 saved；loadRecipe 继续复用已有方法。
```

history 的 result 必须为数组，id 非空且唯一，名称类型正确；可选时间为字符串、autosave
为布尔，未知扩展字段忽略。内部 file 不保存为 UI 请求路径。列表排序为 timestamp 倒序/id
稳定排序，未知时间放最后；时间显示只排版，不推测时区。保存仅显式 true 成功；实际
client 的缺标志、false 或异常封套不能悄悄变为 true。保留旧 fixture 的基本结构兼容性，
只在生产状态无法确认 id 时显示身份未确认提示。load 的 false 不得当作成功。

- [x] **provider 保存和身份。** AppState 增当前可选身份，bootstrap、新建、导入、打开、
  保存成功均消费服务端值；旧响应没有 id 时不按名称猜测。保存共享同步 gate，但用专用
  reducer 动作保留 phase/历史/模型/预览/结果/旧错误；失败返回局部结果，不 run/failed。
  回传保存状态与其来源，名称 trim 后 1–80 字符，重复点击一请求。后续源或待保存名称
  变动撤下旧成功提示；不要简单计时后消失而忽略来源。切语言/显隐/相机不清状态。

- [x] **provider 打开与不确定恢复。** 请求前重验 shared gate、连接、候选、pending saves、
  活动草稿和已选非空 id；不隐式保存草稿。加载期间不提前清当前 recipe/model/错误/历史。
  响应成功后一次提交 recipe/model/currentRecipe，使用既有替换规则使旧快照/结果失效，
  再只读 getTimeline；其失败单独提示，不撤销已打开的配方。
  明确服务端拒绝保留当前内容；网络/超时/成功载荷契约错误设置持久的状态待确认标记。
  该标记与 shared gate 一起禁止所有写入口和结构导出，含原始版图写入口；检查已有
  invalidActiveConfiguration/beginMutation/saveParameter/updateDraft/replaceStep/exportStructure。
  不只禁 Toolbar。动作执行处也要核对，旧 dialog confirm 不能绕过。

```ts
// 对账必须实际请求服务端，不能复用一次性 bootstrap 的已完成快速返回。
const view = await api.init(signal);
// 仅 mounted/当前恢复代次有效后提交权威 view，再请求 timeline；不调用 run/import/set_step。
```

同步失败保留保护，可手动再试；成功才解除。同步期间全程持 gate，旧响应不能覆盖新会话。
不要自动重发 save/load，不把客户端取消承诺为服务端回滚。所有路径 finally 释放本次
controller/gate；卸载不更新状态。必要保存/加载操作状态可加 union 值但不得扩散重构。

- [x] **弹窗与反馈。** 列表进入时 GET，刷新代次使旧读取失效，关闭/卸载 abort。
  不预选自动打开；radio/list 单选后点击「打开此配方」才 POST，支持同名不同 id 和当前项。
  当前身份明确标记；有/无/未知自动保存状态和服务端时间如实显示。列表错误只在本地，
  空列表有说明，不改模型。网络不确定错误提供「重新同步」并保留错误与保护。
  Toolbar 名称从权威身份初始化，用户正在编辑时刷新/语言不覆盖；身份切换才切新名称。
  保存按钮旁显示进度/成功/失败/未确认，说明更名保存更新当前条目。旧源码缺 meta 时
  不伪造 id、成功消息或当前行。打开成功提示模型已恢复但逐步快照需重新构建。
  原生模态内置语言切换，busy 防重复/关闭，idle Escape、焦点返回，窄屏自动换行。

- [x] **实际行为 GREEN 与并发。** deferred 保存/打开各阶段，旧 request generation、
  拒绝/网络断开/契约错误/时间线失败/同步再失败/再成功、raw mask/API 互斥、草稿/候选、
  卸载后晚返回、true/false、保存源失效都有断言。保留真实 ParameterPanel 395 nm 参考值；
  Viewer 保存期间 mount 一次，打开新模型按已有刷新逻辑。不要只测 reducer 对象字段。

```ts
expect(api.runAll).not.toHaveBeenCalled();
expect(api.runStep).not.toHaveBeenCalled();
expect(api.setStep).not.toHaveBeenCalled();
// 恢复 gate pending 时直接 actions 和 raw mask 回调同样拒绝；并检查导出 API 零调用。
```

- [x] **HTTP 实物与契约。** 复用 `tests/test_structure_export_http.py` 的隔离 manager 和
  M2ApiContractTests 请求助手，建立小 domain 和测试存储。正式导入 Structure Wafer +
  Deposit/Pattern 配方、Build All、保存 A；建立不同 B；GET history 后 load A。
  np.array_equal 对比真实 grid/owners、step_ids、voxel/domain 与不可变 mask revision，
  量测材料组成；加载期间 spy execute 不得调用。另覆盖同名不同 id、当前编辑自动保存后
  打开恢复新版、无效 id、不改变既有格式的进程重启后恢复、Ready/无逐步快照。
  契约文档补具体字段与命名测试，同一提交包含行为证据，不更换主存储或执行器。

- [x] **完整验证并提交。** 按代码职责提交小中文提交，不改主审计划、不推远端。执行
  完整前端/type/build/新 HTTP/相关可靠性与版图模块/diff check，报告命令、数量和实际 SHA。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-saved-recipes-fjCjzz/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_saved_recipes_http tests.test_recipe_reliability tests.test_mask_asset_transaction tests.test_mask_workbench_e2e
git diff --check
```

## 任务 2：主审验收与两阶段复审

- [x] 实现者提交并释放 npm 锁后，SPEC 独立读完整差异与原日志、对照批准规格逐项审查；
  BLOCK 交原实现者修复并增量复审。通过后才分派新 QUALITY，包含共享 gate/状态恢复审查。
- [x] 主审独立完整前端/type/build。Python 新专项、AGENTS 五模块、相关可靠性/版图测试、
  compile、grid128 串行跑；所有日志与数据在证据根。检查状态待确认不能绕过 raw mask/export。
- [x] CUA 独立服务正式构建并保存两份不同配方，实际列表选择后打开，比对可见材料/结构与
  权威参数。检查保存成功提示及编辑后失效、自动保存标记、Ready/无逐步快照说明。
  中文/EN、长名称、窄屏/键盘/焦点、读取/失败重试等可见证据截图；不注入隐藏 React 状态，
  不破坏用户网络。不可控网络失败的关键 gate 由 deferred 集成证明并如实标注。
- [x] 主审提供浏览器证据补充 SPEC/QUALITY 最终复审，归档八项边界、修复与已知限制。
  关闭自建服务和标签，提交纯验收记录；不自动合并推送、不动第三方 origin/用户未跟踪文件。

## 计划自检

当前身份、自动保存优先、无时区推测、同名 id、保存 false、无模型重跑、保存参考保持、
草稿与 mask/export 双向 gate、不确定后只读同步、实际 HTTP 持久化和浏览器均有对应步骤。
只实现已批准 A，不加入跨电脑工程包、删除/搜索、物理仿真或通用状态框架。

## 执行中的事实记录

- 基线：既有 API/provider/reducer/Toolbar 4 文件 174 PASS，`baseline.log`。
- 前任实现者的实际行为 RED：保存历史位置从 0 变为 null，以及缺少保存反馈，共 2 FAIL；
  `RED-behavior-actual.log`。原始 probe/fixture 失败单独保留，不冒充行为证据。
- 首位实现者因模型服务容量限制中断，无代码提交，关联未提交修改已完整保留。
  接手实现者从该差异核查并续写；无并行代码 writer，npm 锁随接手转交。
- 主审独立 AGENTS 五模块基线 207 tests OK，91.098 s，`root-baseline-backend.log`。
  当前没有 Python 运行时代码变更，后续如有变更须重新验证受影响范围。
- 浏览器隔离服务仅在 8840，存储位于证据根；已通过旧版 UI 正式导入/构建/保存氧化层
  配方用于旧数据兼容验收，此准备动作不作为新功能已通过的证据。
- `71fcf3d` 初版主审独立验证：50 文件 895 PASS，`root-frontend.log`；typecheck/build
  成功；新专项、相关可靠性/版图、既有结构导出和文档一致性共 56 OK，8.156 s，
  `root-feature-backend.log`。Python 运行时代码未改变。
- 原 SPEC 模型因额度限制未能进行审查；独立接手者对完整差异审查后给出
  REQUEST CHANGES（`spec.log`）：畸形 ok 封套误判为拒绝、JS/Python strip 不一致、
  只读 Timeline 假引用变化撤销保存提示。主审已逐项核实，交原实现者 TDD 修复。
  NB 为打开后 Timeline 仍 pending 时可见 busy 提前解除，以及浏览器证据待补。
- 保存异常仍按批准规格显示「未确认」，允许显式重新保存；它不切换模型，因此不扩大为
  打开异常那样的全局待确认保护。此范围解释已与 SPEC 对齐，不新增决策或要求。
- 真实浏览器已从列表分别打开旧版 A/B；无构建请求，Ready/无逐步快照如实显示。
  下载实物 `browser-restored-a.zip`、`browser-restored-b.zip` CRC 正常、STL 顶点有限。
  A：Si 100 nm + SiO2 40 nm；B：Si 80 nm + SiN 60 nm；横向均为 0.12×0.12 µm。
  记录 `browser-restored-inspection.json/log`；保留用户 Downloads 原件。
  初版浏览器长名、语言切换、选择、保存成功/名称编辑失效和 640×720 布局已验证；
  dialog clientWidth=scrollWidth=574、x=32、宽 576，Escape 后焦点回打开入口，视口已 reset。

## 最终验收（2026-10-27）

### 提交与复审修复

实现提交 `71fcf3d`；修复提交 `c297c81165646152f031a381f8c622c9af1af5aa`。
仅最终验收文档在本次记录提交，不再修改代码。主审阅读完整生产差异、修复差异及原日志。

| 发现 | 修复与行为证据 |
| --- | --- |
| BLOCK-001：HTTP 200 的缺失/非布尔 ok 封套被当作明确拒绝 | 仅 save/load 开启严格封套校验；无法证明拒绝的响应抛契约错误。真实 fetch + provider 检查旧身份保持、写/导出拒绝，实际 init/timeline 后才解锁；`spec-block1-integrated-red.log` → `spec-block1-green.log` |
| BLOCK-002：JS trim 与 Python strip 字符集合不同 | 使用 Python 空白集合，包含 U+0085、排除 U+FEFF；Toolbar 传原始输入，action 统一清理；80/81 码点及实际 save/new 请求体测试；`spec-block2-red.log` → `spec-block2-green2.log` |
| BLOCK-003：只读 Timeline 刷新误清成功反馈 | 不因 timeline/loaded 的数组新引用撤销保存状态；实际草稿仍使旧反馈失效；`spec-block3-red.log` → `spec-block3-green.log` |
| NB-001：打开成功后 Timeline pending 时可见 busy 提前解除 | 打开专用 preserveMutation 让 visible activeMutation 与真实 gate 一直持有到 finally；`spec-nb1-red.log` → `spec-nb1-green.log` |

每项 RED 均为实际行为断言失败，GREEN 后保留旧断言。初版 API 测试文件名
`api-new-red.log` 实际为 4 PASS，是接手初版的 GREEN，不作为 RED。
测试 mock 返回次数不足、旧 fixture 的 Timeline 将 done 改为 ready、加载补空 mask_file
默认值等尝试日志均保留，未伪称真实回归或通过证据。HTTP 仅规范化这个空兼容默认值，
其余参数、grid、owners、step ids、domain 仍精确比较。

### 独立验证

命令与环境见任务步骤；Python `/opt/anaconda3/bin/python3`，`TCAD_SKIP_QT=1`、
`MPLBACKEND=Agg`，cache、存储和输出在证据根。npm 在作者、主审及 QUALITY 之间串行交接。

| 执行者/范围 | 结果与证据 |
| --- | --- |
| 作者修复后完整前端 | 51 文件 903 PASS，`spec-frontend-attempt1.log` |
| 主审最终完整前端 | **51 文件 903 PASS**，30.59 s，`root-final-frontend.log`；代码 SHA c297c81 |
| 主审最终 typecheck/build | 均成功，`root-final-typecheck.log`、`root-final-build.log`；JS `index-CDXDggHI.js` |
| 主审 AGENTS 五模块 | **207 OK**，91.098 s，`root-baseline-backend.log`；其后生产 Python 没有改变 |
| 主审新 HTTP、相关可靠性/版图、旧导出、文档一致性 | **56 OK**，8.156 s，`root-feature-backend.log`；与基线部分重叠，不将两数相加声称唯一用例数 |
| 主审 compile、grid128 | 成功，`root-compile.log`、`root-grid128.log/json`；5 示例 39 项全真 |
| QUALITY 独立专项 | 5 文件 **99 PASS**，`quality-independent.log`，已释放 npm 锁 |

保留既有 jsdom canvas/navigation、Python ResourceWarning/Numba 和 Vite bundle 大小提示，
没有新增生产依赖、测试 timeout 放宽或旧断言削弱。生产 Python、几何和保存格式未修改。

### 最终浏览器链路

初版真实列表/保存/恢复与 ZIP 检查见上述记录。最终修复版通过 DOM script 属性确认
`/studio/assets/index-CDXDggHI.js` 后，重新进行断线与恢复，不注入 React 状态，不改用户网络。

1. 通过列表选择 A；只停止主审自建 8840 服务 session 9149，再点击打开。
   弹窗明确错误及「当前配方状态待确认」，禁止再次打开，英文截图
   `browser-offline-open-unknown-en.jpg`。
2. 在弹窗切中文，保留选择及错误；手动重新同步，服务仍停时再次失败，保护持续，
   `browser-offline-resync-failed-zh.jpg`。关闭弹窗后，主审读取实际 DOM enabled 状态：
   参数厚度、保存、结构导出均 false，`browser-unknown-editors-disabled-zh.jpg`。
   选择器曾误用按钮长名称/未限定 modal，校正为可见模态内实际名称后操作成功；不是产品故障。
3. 使用相同临时存储重启主审服务 session 54325，不刷新页面，点击重新同步。
   服务端实际仍为 B（Nitride restored B / SiN 60 nm），界面恢复 B，没有自动重发 A 打开。
   待确认警告消失，厚度/保存/结构导出实际 enabled 均 true，
   `browser-resync-success-zh.jpg`。
4. 最终版再次打开列表，用 Space 选 A、Enter 确认，实际恢复 oxide 40 nm、Ready/无逐步
   快照；点击保存显示成功，`browser-final-open-save-zh.jpg`。
   最终列表无自动预选，当前 A 标记、无自动保存与 B 有自动保存清楚显示，
   `browser-final-list-zh.jpg`。这段没有点击构建。
5. 浏览器 warn/error 记录为 `[]`，`browser-console.json`；没有把截图当作请求次数或
   精确几何的替代。实际 ZIP 来自初版 71fcf3d，最终 c297c81 只修前端边界；其断线恢复与
   打开/保存路径由最终构建重新验证。两位 reviewer 明确区分自行读图和主审 UI 操作。

长名称、双语、保存反馈与名称编辑失效、键盘和 640×720 布局截图在前述证据根。
自建 tab 5 已关闭、viewport 已 reset；最后服务 session 54325 正常退出，8840 无监听。
用户服务、网络设置、存储与 Downloads 中下载原件未动。

### 最终评审与边界

SPEC 首次 `REQUEST CHANGES` → 原作者修复 → 增量代码通过 → 浏览器补证，最终
**APPROVE**（`spec.log`、`spec-recheck.log`、`spec-final.log`）。
随后全新独立 QUALITY 完整审核并专项复验，最终 **APPROVE**（`quality.log`）。
无剩余 BLOCK/NB，有序修复清单为空。

| 边界 | 结论 |
| --- | --- |
| React | PASS：typed 列表、权威身份、保存反馈和未知态保护；无几何计算 |
| Three.js | PASS：查看器与算法未改；模型来源刷新沿用既有逻辑 |
| Python | PASS：运行时代码未改，实际 HTTP 恢复/重启/来源和版图引用验证通过 |
| C++ | PASS：未触及引擎、绑定或依赖，不宣称新增引擎验证 |
| Layout | PASS：现有 immutable Mask Asset revision 与来源保持，无新版图算法 |
| Vienna | PASS：未增加引擎或物理执行路径 |
| Canonical | PASS：ProcessModel/Recipe 保持权威，恢复不重算，STL 仍只导出 |
| 范围/测试/存储 | PASS：小范围关联状态接线、真实 RED/GREEN、独立回归及临时数据隔离 |

剩余限制：名称空白集合对应当前 Python Unicode 规则；服务端本地时间没有时区信息，
界面不猜测换算；自动保存标记仅表示文件存在，保存的不同版本仍由原加载规则选择。
无法恢复旧逐步 cache/undo；加载后需显式重新构建才能生成新逐步快照。
客户端 abort 不能撤销已经完成的服务端保存/打开；任意第三方中间件故障不在本机验证范围。
加载仍依赖当前服务已有附件，首版不包含迁移工程包或旧丢失附件修复。

本次仅保留 `codex/saved-recipes`；本地 main 和 studio/main 仍为 `0f90682`。
未合并、推送或访问第三方 origin；集成方式由所有者选择。
