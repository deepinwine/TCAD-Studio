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

- [ ] 在 `viewerRuntime.test.ts` 添加真实相机方向/订阅用例：
  ```ts
  runtime.setViewDirection!([1, -1, 1]);
  expect(flush().position.clone().sub(target).normalize().distanceTo(new THREE.Vector3(1,-1,1).normalize())).toBeLessThan(2e-6);
  ```
  在 `navigation.test.ts` 断言唯一方向 26 个、面/棱/角分别 6/12/8，投影隐藏背面且矩阵有限。
- [ ] `npm test -- --run src/viewer/navigation.test.ts src/viewer/viewerRuntime.test.ts --maxWorkers=1 --no-file-parallelism`；记录缺失功能 RED。
- [ ] 定义 `ViewDirection=readonly [number,number,number]`；runtime 加法可选方法，检查有限非零输入；`applyPose(new THREE.Vector3(...direction).normalize())` 保留世界 Z-up 和既有极点行为。
  单帧渲染时复制真实 quaternion 通知订阅者；取消订阅和 dispose 清理集合。
  SVG 面片使用倒角方块 6 方形/12 四边形/8 三角形，以面片法线 dot 观察方向剔除背面，按深度排序投影。
- [ ] 重跑专项 GREEN，并检查旧六面/投影/拖拽/适配测试未被削弱。
- [ ] 提交 `feat(查看器): 增加相机方向协议与导航投影`。

## 任务 2：可点击立方体与居中入口

- [ ] `NavigationCube.test.tsx` 和 `ThreeViewer.test.tsx` 增加可见面片激活、26 方向键盘入口、方向同步、禁用和卸载测试；实际使用 runtime 测试验证零请求。
- [ ] `npm test -- --run src/viewer/NavigationCube.test.tsx src/viewer/ThreeViewer.test.tsx --maxWorkers=1 --no-file-parallelism`；记录 RED。
- [ ] 组件在 stage 右上角提供 SVG 面片，使用 `onPointerDown/Up={event => event.stopPropagation()}` 隔离模型拾取；Enter/Space 与点击相同行为。原生 select 列出 26 个方向供键盘访问，面片本身也可聚焦。
  ThreeViewer 在 runtime 挂载时订阅 orientation，清理时先 unsubscribe 再 dispose；旧 runtime 不支持新方法时不显示不可用导航器。
  `viewer.fit` 更新为「居中并适应窗口 / Center and fit」。保留旧标准视图。
- [ ] 重跑控件专项及 typecheck；记录 GREEN。
- [ ] 提交 `feat(查看器): 接入导航立方体与明确居中入口`。

## 任务 3：恢复提示

- [ ] `appReducer.test.ts` 覆盖 recipe/opened 后空、无效、未知索引 timeline 保留提示；对应步骤有效快照撤下提示；步骤错误及保存反馈保持。
- [ ] `npm test -- --run src/state/appReducer.test.ts src/state/SavedRecipes.test.tsx --maxWorkers=1 --no-file-parallelism`；记录 RED。
- [ ] 在 reducer 统一出口仅对权威 timeline 更新动作检查：
  ```ts
  const hasSnapshot = next.timeline?.items.some(item => item.snapshotValid && next.recipe.some(step => step.index === item.index));
  ```
  有证据才将 recipeOpened 设 false；不因 run/started 或 run/succeeded 的乐观状态提前撤下。
- [ ] 重跑 GREEN，保持既有 generation 和错误回归。
- [ ] 提交 `fix(配方恢复): 有效快照生成后撤下旧提示`。

## 任务 4：窄屏布局

- [ ] 在未修复版本的真实浏览器读取 712×915 的 canvas bottom≈1042、workspace bottom=823，已复现遮挡；保留原截图与 DOM 数据为 RED。组件测试验证 resize 不重挂 Viewer。
- [ ] ≤900px 将 viewer 排在步骤区之前，按 workspace 实际可用高度限制 viewer 高度；保留至少可操作画布及外部垂直滚动路径。必要时由 WorkspaceLayout 的 ResizeObserver 发布可用高度 CSS 变量；避免百分比高度相互循环。
  宽屏分栏、步骤/参数滚动、时间线保留，不改全局截图尺寸掩盖问题。
- [ ] 在独立存储、独立端口服务上，用 900、712、640、390px 及宽屏实测；真实 DOM 断言 canvas 底部不越过 workspace 可视底部、时间线不重叠；矮窗口检查滚动访问。恢复临时视口。
- [ ] 提交 `fix(布局): 窄屏优先完整显示三维查看器`。

## 任务 5：整体验收与复审

- [ ] 前端：`npm test -- --run --maxWorkers=1 --no-file-parallelism`、`npm run typecheck`、`npm run build`。
- [ ] Python：`TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-viewer-navigation-dM6OIy/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_saved_recipes_http tests.test_process_cad_foundation tests.test_process_cad_primitives tests.test_process_cad_demos tests.test_webui_viewer_contract tests.test_webui_cad_shell`。
- [ ] 同环境 `python -m py_compile tcad_simulator.py tools/*.py`；`python tools/run_process_cad_baseline.py --grid 128 --output /tmp/tcad-viewer-navigation-dM6OIy/grid128.json`。
- [ ] 真浏览器：正式导入/构建沟槽，测试所有 26 方向、自由旋转同步、居中、正交、剖切、眼睛、保存恢复/生成快照提示；检查 console，截图保存树外。旧服务 8765 不重启。
- [ ] 按 AGENTS §9 自审完整 diff，输出 Verdict / BLOCK-NB / 八项边界 / 回归风险；关闭问题并归档命令、结果和限制。未经授权不合并、不推送。

## 计划自检

四项规格分别由任务 1–2、4、3 覆盖；方向协议先于 UI；相机数学使用 Three.js，工艺边界无改动。真实浏览器负责布局/WebGL 证据，Vitest 负责状态和真实相机数学。已有用户批准，按内联方式执行，不再请求执行方式选择。
