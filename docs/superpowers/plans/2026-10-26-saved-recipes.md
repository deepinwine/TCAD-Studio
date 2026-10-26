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
- `frontend/src/state/SavedRecipes.test.tsx`、`components/SavedRecipesDialog.test.tsx` 及既有
  Toolbar/reducer/App/StructureExport 测试：真实 provider 的动作、状态、共享门禁与生命周期。
- `tests/test_saved_recipes_http.py`：临时真实 worker/HTTP 的保存、切换、几何与来源、重启。
- `docs/ARCHITECTURE_TARGET.md`：更新三个既有端点消费字段，关联命名 HTTP 测试。
- 主审独占本计划；`tcad_simulator.py` 原则上不改，若行为证据发现本功能必需的服务端
  缺口，先报告实际失败及最小修复范围，禁止绕过正式加载器、直接写正式体素或悄悄改语义。

## 任务 1：单一实现者完成关联功能

- [ ] **建立基线。** 串行执行现有 API/provider/reducer/Toolbar 四文件专项，保存
  `baseline.log`。不安装或更新依赖。此分支继承 main 合并后前端 873/后端 211 通过的版本。

```bash
npm test -- --run src/api/client.test.ts src/state/AppStateContext.test.tsx src/state/appReducer.test.ts src/components/Toolbar.test.tsx --maxWorkers=1 --no-file-parallelism
```

- [ ] **先补行为 RED。** 向真实 client 和 provider 测试添加保存成功反馈/保留历史的断言，
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

- [ ] **typed 加法。** 定义并实现以下数据；可沿现有命名微调，但不另造响应协议。

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

- [ ] **provider 保存和身份。** AppState 增当前可选身份，bootstrap、新建、导入、打开、
  保存成功均消费服务端值；旧响应没有 id 时不按名称猜测。保存共享同步 gate，但用专用
  reducer 动作保留 phase/历史/模型/预览/结果/旧错误；失败返回局部结果，不 run/failed。
  回传保存状态与其来源，名称 trim 后 1–80 字符，重复点击一请求。后续源或待保存名称
  变动撤下旧成功提示；不要简单计时后消失而忽略来源。切语言/显隐/相机不清状态。

- [ ] **provider 打开与不确定恢复。** 请求前重验 shared gate、连接、候选、pending saves、
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

- [ ] **弹窗与反馈。** 列表进入时 GET，刷新代次使旧读取失效，关闭/卸载 abort。
  不预选自动打开；radio/list 单选后点击「打开此配方」才 POST，支持同名不同 id 和当前项。
  当前身份明确标记；有/无/未知自动保存状态和服务端时间如实显示。列表错误只在本地，
  空列表有说明，不改模型。网络不确定错误提供「重新同步」并保留错误与保护。
  Toolbar 名称从权威身份初始化，用户正在编辑时刷新/语言不覆盖；身份切换才切新名称。
  保存按钮旁显示进度/成功/失败/未确认，说明更名保存更新当前条目。旧源码缺 meta 时
  不伪造 id、成功消息或当前行。打开成功提示模型已恢复但逐步快照需重新构建。
  原生模态内置语言切换，busy 防重复/关闭，idle Escape、焦点返回，窄屏自动换行。

- [ ] **实际行为 GREEN 与并发。** deferred 保存/打开各阶段，旧 request generation、
  拒绝/网络断开/契约错误/时间线失败/同步再失败/再成功、raw mask/API 互斥、草稿/候选、
  卸载后晚返回、true/false、保存源失效都有断言。保留真实 ParameterPanel 395 nm 参考值；
  Viewer 保存期间 mount 一次，打开新模型按已有刷新逻辑。不要只测 reducer 对象字段。

```ts
expect(api.runAll).not.toHaveBeenCalled();
expect(api.runStep).not.toHaveBeenCalled();
expect(api.setStep).not.toHaveBeenCalled();
// 恢复 gate pending 时直接 actions 和 raw mask 回调同样拒绝；并检查导出 API 零调用。
```

- [ ] **HTTP 实物与契约。** 复用 `tests/test_structure_export_http.py` 的隔离 manager 和
  M2ApiContractTests 请求助手，建立小 domain 和测试存储。正式导入 Structure Wafer +
  Deposit/Pattern 配方、Build All、保存 A；建立不同 B；GET history 后 load A。
  np.array_equal 对比真实 grid/owners、step_ids、voxel/domain 与不可变 mask revision，
  量测材料组成；加载期间 spy execute 不得调用。另覆盖同名不同 id、当前编辑自动保存后
  打开恢复新版、无效 id、不改变既有格式的进程重启后恢复、Ready/无逐步快照。
  契约文档补具体字段与命名测试，同一提交包含行为证据，不更换主存储或执行器。

- [ ] **完整验证并提交。** 按代码职责提交小中文提交，不改主审计划、不推远端。执行
  完整前端/type/build/新 HTTP/相关可靠性与版图模块/diff check，报告命令、数量和实际 SHA。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-saved-recipes-fjCjzz/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_saved_recipes_http tests.test_recipe_reliability tests.test_mask_asset_transaction tests.test_mask_workbench_e2e
git diff --check
```

## 任务 2：主审验收与两阶段复审

- [ ] 实现者提交并释放 npm 锁后，SPEC 独立读完整差异与原日志、对照批准规格逐项审查；
  BLOCK 交原实现者修复并增量复审。通过后才分派新 QUALITY，包含共享 gate/状态恢复审查。
- [ ] 主审独立完整前端/type/build。Python 新专项、AGENTS 五模块、相关可靠性/版图测试、
  compile、grid128 串行跑；所有日志与数据在证据根。检查状态待确认不能绕过 raw mask/export。
- [ ] CUA 独立服务正式构建并保存两份不同配方，实际列表选择后打开，比对可见材料/结构与
  权威参数。检查保存成功提示及编辑后失效、自动保存标记、Ready/无逐步快照说明。
  中文/EN、长名称、窄屏/键盘/焦点、读取/失败重试等可见证据截图；不注入隐藏 React 状态，
  不破坏用户网络。不可控网络失败的关键 gate 由 deferred 集成证明并如实标注。
- [ ] 主审提供浏览器证据补充 SPEC/QUALITY 最终复审，归档八项边界、修复与已知限制。
  关闭自建服务和标签，提交纯验收记录；不自动合并推送、不动第三方 origin/用户未跟踪文件。

## 计划自检

当前身份、自动保存优先、无时区推测、同名 id、保存 false、无模型重跑、保存参考保持、
草稿与 mask/export 双向 gate、不确定后只读同步、实际 HTTP 持久化和浏览器均有对应步骤。
只实现已批准 A，不加入跨电脑工程包、删除/搜索、物理仿真或通用状态框架。
