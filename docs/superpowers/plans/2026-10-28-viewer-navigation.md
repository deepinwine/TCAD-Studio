# 查看器导航与布局修复实现计划

> **面向 AI 代理的工作者：** 使用 executing-plans 在当前隔离工作树逐任务内联实现；不调度子代理。

**目标：** 交付居中入口、26 方向导航立方体、窄屏完整画布和恢复提示生命周期修复。

**架构：** 相机仍由 viewerRuntime 单独拥有。SVG 导航器消费相机 quaternion，只绘制界面和发送方向；不下载或计算工艺几何。提示以权威 timeline 为证据，布局保留 renderer 挂载。

**技术栈：** React、TypeScript、Three.js、SVG、Vitest；不新增依赖。

规格：`docs/superpowers/specs/2026-10-28-viewer-navigation-design.md`（所有者已批准）。
分支 `codex/viewer-navigation`；证据根 `/tmp/tcad-viewer-navigation-dM6OIy`。
基线：51 文件 903 前端 PASS；AGENTS 五模块 207 OK。

## 文件职责

- `frontend/src/viewer/navigation.ts`：26 个方向、倒角立方体 UI 面片、从真实相机 quaternion 投影及背面剔除。
- `frontend/src/viewer/NavigationCube.tsx`：SVG 命中、高亮、键盘方向入口及双语标签。
- `frontend/src/viewer/viewerRuntime.ts`：加法 setViewDirection / subscribeOrientation；沿用 applyPose 和单渲染帧。
- `frontend/src/viewer/ThreeViewer.tsx`：绑定/释放方向订阅、居中入口和导航控件。
- `frontend/src/state/appReducer.ts`：权威有效快照出现后撤下 recipeOpened 提示。
- `frontend/src/styles.css`、`frontend/src/components/WorkspaceLayout.tsx`：窄屏 viewer 优先及有界高度，保留宽屏分栏与现有滚动入口。
- 对应 `*.test.ts(x)`：真实相机、方向投影、控件、恢复状态与布局集成回归。
- `frontend/src/i18n/catalogs.ts`：中英文文案。

## 任务 1：相机导航协议与投影

- [x] 在 `viewerRuntime.test.ts` 添加真实相机方向/订阅用例：
  ```ts
  runtime.setViewDirection!([1, -1, 1]);
  expect(flush().position.clone().sub(target).normalize().distanceTo(new THREE.Vector3(1,-1,1).normalize())).toBeLessThan(2e-6);
  ```
  在 `navigation.test.ts` 断言唯一方向 26 个、面/棱/角分别 6/12/8，投影隐藏背面且矩阵有限。
- [x] `npm test -- --run src/viewer/navigation.test.ts src/viewer/viewerRuntime.test.ts --maxWorkers=1 --no-file-parallelism`；记录缺失功能 RED。
- [x] 定义 `ViewDirection=readonly [number,number,number]`；runtime 加法可选方法，检查有限非零输入；`applyPose(new THREE.Vector3(...direction).normalize())` 保留世界 Z-up 和既有极点行为。
  单帧渲染时复制真实 quaternion 通知订阅者；取消订阅和 dispose 清理集合。
  SVG 面片使用倒角方块 6 方形/12 四边形/8 三角形，以面片法线 dot 观察方向剔除背面，按深度排序投影。
- [x] 重跑专项 GREEN，并检查旧六面/投影/拖拽/适配测试未被削弱。
- [x] 提交 `feat(查看器): 增加相机方向协议与导航投影`。

## 任务 2：可点击立方体与居中入口

- [x] `NavigationCube.test.tsx` 和 `ThreeViewer.test.tsx` 增加可见面片激活、26 方向键盘入口、方向同步、禁用和卸载测试；实际使用 runtime 测试验证零请求。
- [x] `npm test -- --run src/viewer/NavigationCube.test.tsx src/viewer/ThreeViewer.test.tsx --maxWorkers=1 --no-file-parallelism`；记录 RED。
- [x] 组件在 stage 右上角提供 SVG 面片，使用 `onPointerDown/Up={event => event.stopPropagation()}` 隔离模型拾取；Enter/Space 与点击相同行为。原生 select 列出 26 个方向供键盘访问，面片本身也可聚焦。
  ThreeViewer 在 runtime 挂载时订阅 orientation，清理时先 unsubscribe 再 dispose；旧 runtime 不支持新方法时不显示不可用导航器。
  `viewer.fit` 更新为「居中并适应窗口 / Center and fit」。保留旧标准视图。
- [x] 重跑控件专项及 typecheck；记录 GREEN。
- [x] 提交 `feat(查看器): 接入导航立方体与明确居中入口`。

## 任务 3：恢复提示

- [x] `appReducer.test.ts` 覆盖 recipe/opened 后空、无效、未知索引 timeline 保留提示；对应步骤有效快照撤下提示；步骤错误及保存反馈保持。
- [x] `npm test -- --run src/state/appReducer.test.ts src/state/SavedRecipes.test.tsx --maxWorkers=1 --no-file-parallelism`；记录 RED。
- [x] 在 reducer 统一出口仅对权威 timeline 更新动作检查：
  ```ts
  const hasSnapshot = next.timeline?.items.some(item => item.snapshotValid && next.recipe.some(step => step.index === item.index));
  ```
  有证据才将 recipeOpened 设 false；不因 run/started 或 run/succeeded 的乐观状态提前撤下。
- [x] 重跑 GREEN，保持既有 generation 和错误回归。
- [x] 提交 `fix(配方恢复): 有效快照生成后撤下旧提示`。

## 任务 4：窄屏布局

- [x] 在未修复版本的真实浏览器读取 712×915 的 canvas bottom≈1042、workspace bottom=823，已复现遮挡；保留原截图与 DOM 数据为 RED。组件测试验证 resize 不重挂 Viewer。
- [x] ≤900px 将 viewer 排在步骤区之前，按 workspace 实际可用高度限制 viewer 高度；保留至少可操作画布及外部垂直滚动路径。必要时由 WorkspaceLayout 的 ResizeObserver 发布可用高度 CSS 变量；避免百分比高度相互循环。
  宽屏分栏、步骤/参数滚动、时间线保留，不改全局截图尺寸掩盖问题。
- [x] 在独立存储、独立端口服务上，用 900、712、640、390px 及宽屏实测；真实 DOM 断言 canvas 底部不越过 workspace 可视底部、时间线不重叠；矮窗口检查滚动访问。恢复临时视口。
- [x] 提交 `fix(布局): 窄屏优先完整显示三维查看器`。

## 任务 5：整体验收与复审

- [x] 前端：`npm test -- --run --maxWorkers=1 --no-file-parallelism`、`npm run typecheck`、`npm run build`。
- [x] Python：`TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-viewer-navigation-dM6OIy/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_saved_recipes_http tests.test_process_cad_foundation tests.test_process_cad_primitives tests.test_process_cad_demos tests.test_webui_viewer_contract tests.test_webui_cad_shell`。
- [x] 同环境 `python -m py_compile tcad_simulator.py tools/*.py`；`python tools/run_process_cad_baseline.py --grid 128 --output /tmp/tcad-viewer-navigation-dM6OIy/grid128.json`。
- [x] 真浏览器：正式导入/构建沟槽，测试所有 26 方向、自由旋转同步、居中、正交、剖切、眼睛、保存恢复/生成快照提示；检查 console，截图保存树外。旧服务 8765 不重启。
- [x] 按 AGENTS §9 自审完整 diff，输出 Verdict / BLOCK-NB / 八项边界 / 回归风险；关闭问题并归档命令、结果和限制。未经授权不合并、不推送。

## 计划自检

四项规格分别由任务 1–2、4、3 覆盖；方向协议先于 UI；相机数学使用 Three.js，工艺边界无改动。真实浏览器负责布局/WebGL 证据，Vitest 负责状态和真实相机数学。已有用户批准，按内联方式执行，不再请求执行方式选择。


## 最终验收与交接（2026-10-28）

### Goal / Changed Files / Architecture Decisions

四项批准目标均完成：明确居中入口、26 方向导航、窄屏完整画布及恢复提示生命周期。
最终代码 `2658806`，本次随后仅归档 README、规格与计划，不再修改生产代码。

生产变更位于 viewer runtime / SVG navigation / ThreeViewer 接线、WorkspaceLayout 和
局部样式、双语目录，以及 appReducer 的权威快照提示逻辑。已有 `fit()`、OrbitControls、
单 requestAnimationFrame、ResizeObserver、timeline generation/abort/gate 均复用。
没有新接口、依赖、Recipe 字段或存储格式；Python、物理、布局引擎与模型算法未改。
边界沿用 ADR-007/024/029/030，不需要新增架构决策。

### Tests Added / Executed

新增 13 项前端回归；51→53 个测试文件，903→916 项。真实 Three.js 相机测试仅替代
WebGL renderer 外壳，保留真实矩阵、投影和 OrbitControls；不把 mock 调用当作几何证据。

所有命令在本隔离工作树执行，Python `/opt/anaconda3/bin/python3`，npm 使用
`frontend/` 目录；输出、cache、服务存储均在 `/tmp/tcad-viewer-navigation-dM6OIy`。

| 范围 | 命令与结果 |
| --- | --- |
| 最终前端 | `npm test -- --run --maxWorkers=1 --no-file-parallelism`：**53 文件、916 PASS**，31.30 s；`accepted-frontend.log` |
| 类型与构建 | `npm run typecheck`、`npm run build` 均退出 0；`accepted-typecheck.log`、`accepted-build.log`；最终 JS `index-D6TW8rsr.js` |
| 后端相关回归 | `TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=<证据根>/pycache python -m unittest tests.test_saved_recipes_http tests.test_process_cad_foundation tests.test_process_cad_primitives tests.test_process_cad_demos tests.test_webui_viewer_contract tests.test_webui_cad_shell`：**209 OK**，94.480 s；`full-backend.log` |
| Python 编译 | 相同环境 `python -m py_compile tcad_simulator.py tools/*.py`：退出 0；`compile.log` |
| grid128 | 相同环境 `python tools/run_process_cad_baseline.py --grid 128 --output <证据根>/grid128.json`：5 示例 **39 检查全真**，退出 0；`grid128.json/log` |
| 独立评审专项 | reviewer 在 `d812dad` 上独立执行 8 文件 **105 PASS**，3.85 s；后续增量阅读短窗和组合测试修复及最终日志，未与主审并发运行 npm |

保留既有 jsdom canvas、Numba / ResourceWarning 和 Vite 包体积提示；没有放宽 timeout、
降低断言或添加依赖。后端在后续 UI/测试调整期间未变化，未把基线 207 与最终 209 相加。

### RED / GREEN 与反馈闭环

- `runtime-notice-red.log`：相机接口缺失、有效快照后旧提示未撤下，3 项真实失败；
  `task1-green.log` 为55项通过，原六面、极点、投影、拖拽测试全部保持。
- `navigation-red.log`：方向集合/投影入口缺失，2 项断言失败；随后数学和真实相机通过。
- `cube-red.log`：控件缺失和新居中入口不存在，3 项失败；`cube-green.log` 为91项通过。
- `layout-red.log`：无工作区高度值，失败；`layout-green.log` 为5项通过；另有原始真实
  712×915 DOM/截图证明问题，真实浏览器负责最终尺寸验证。
- `refinements-red.log`：方向选择器不能跟随相机、显式对账未撤下旧提示，两项失败；
  对应改动与新增右键平移后居中、语言保持回归进入最终测试。
- 独立评审 BLOCK-001：390×500 下 select bottom477.5 超出 stage bottom459，
  `browser-short-red.json` 实证；`short-window-red.log` 捕获300px最小值不足。
  `8043a40` 将 viewer 最小高度统一为420px，最大460px；最终 stage bottom579，
  方向选择器不再被内部裁切。外部滚动 scrollTop250 后，select206..227.5 位于
  workspace159..408 内；`browser-short-green.json/png`。**BLOCK-001 已关闭**。
- NB-001：新增组合 provider 回归，贯穿打开 A 空快照、旧 valid timeline 迟到、部分失败
  的有效前缀/错误保持、再打开 B、A 的迟到响应不污染 B。先实际 GREEN，再暂时禁用
  提示修复复跑，`provider-lifecycle-red.log` 在 recipeOpened 断言失败；finally 恢复源，
  `accepted-frontend.log` 全通过。**NB-001 已关闭**。
- 初次追加测试时工作目录前缀重复，未写入测试；不作为 RED。数学测试初版用名义极点
  方向比较 Three.js 实际 lookAt 的安全偏移，改为真实 camera.getWorldDirection 后验证。
  保存状态 fixture 使用现有 success 枚举；语言控件按实际 button role 定位。
  这些测试脚手架修正与真实产品 RED 分开记录，没有弱化旧断言。

### 最终浏览器验收

独立服务为 `http://127.0.0.1:8767/studio/`，存储 `browser-storage/`，服务 session38075。
通过 UI 正式加载 Structure CAD — Trench 并构建，不写体素、不注入 React 状态。
保留原 8765 服务、用户配方与存储。

- 最终 D6TW8rsr：`browser-accepted-26-directions.json` 逐项记录26个实际 UI 方向，
  native选择框与目标投影中心均正确。面/棱/角均通过鼠标点击；Enter 可切方向；
  自由拖转改变投影且方向选择框退出标准方向，使用真实相机订阅而非最后点击记录。
- 切换方向/居中保留正交与 X剖切0.5，`browser-final-orthographic-section.png`。
  隐藏 Copper 步骤实体后切方向/居中仍保持隐藏，再显式显示；未自动取消眼睛状态。
- 正式保存「导航验收 — 沟槽结构」，重新打开时 Ready/无逐步快照且恢复提示可见；
  显式构建全部后 Done/快照有效且旧提示消失。截图
  `browser-restored-before-build.png`、`browser-restored-after-build.png`。
- 最终尺寸：900×900、712×915、640×720、390×844、1280×900，
  `browser-final-layouts.json` 和 `browser-final-<width>.png`。
  每个 canvas 均在 workspace 可视底界前，cube 在 canvas 内，无横溢出。
  390px 宽时从画布外滚动实际到达参数区（scrollTop1009.5），没有删除参数或时间线。
  390×500 的极矮窗口允许外部滚动，导航选择器实际可达，证据见短窗闭环。
- 中英文切换保留方向 `1,-1,1`、单canvas和居中入口，`browser-final-en.png`。
  最终 console warn/error 为 `[]`，`browser-console.json`。临时 viewport override 已 reset。
- 最初的26方向和保存恢复截图来自 Z80fbwmp；最终 D6TW8rsr 只追加最小高度修复。
  最终26方向和全部尺寸在 D6TW8rsr 上再次验证。reviewer 仅自行读证据和图，浏览器由主审操作。
  原生 AX 的差分输出一度未包含滑块索引，改读完整 AX 后设置；不是产品故障。

### 独立评审与八项边界

完整差异评审初至 d812dad，随后审8043a40短窗修复、2658806组合回归及README。
最终 **APPROVE**，无剩余 BLOCK/NB；详细报告在证据根 `review.log`。

| 边界 | 结论 |
| --- | --- |
| React | PASS：仅 UI 状态、控件、文案和响应式布局 |
| Three.js | PASS：真实相机为唯一方向来源，复用帧与资源生命周期 |
| Python | PASS：canonical运行时与HTTP不变 |
| C++ | PASS：无引擎/绑定改动 |
| Layout | PASS：无版图算法/契约改动 |
| ViennaPS | PASS：可选引擎边界不变 |
| canonical数据 | PASS：模型、Recipe、单位、存储、导出语义不变 |
| 范围/测试/存储 | PASS：四项批准范围内，真实RED/GREEN，数据在树外 |

回归风险低；所有必修与建议均关闭。极矮窗口因物理空间不足仍需在画布外滚动，
不是内部裁切；相机交互保持本地，剖切本身仍使用既有只读截面路径。
没有声称跨浏览器、任意系统尺寸或外部引擎的新验证。

本分支保留预览服务供所有者试用；main仍为bdf4468，没有合并、推送或访问第三方origin。
后续集成由所有者决定；如需清理，保留复用工作树里的既有依赖和用户未跟踪文件。
