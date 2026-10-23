# Studio 首次启动结构工程实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** 全新 Studio 会话默认晶圆工程，保留所有有效恢复路径及旧 WebUI 默认行为。

**Architecture:** 启动器通过可选的 `startup_recipe_mode="structure"` 选择首次启动配方；通用 manager 和 worker 缺省仍为 `legacy`。仅 bootstrap 无恢复结果时创建单晶圆配方，复用 `InitializeWaferStep` 和既有模型初始化，不新建端点或几何算法。

**Tech Stack:** Python、现有 session/worker RPC、React/Three.js 静态客户端、unittest、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-23-structure-first-startup.md`。

**Workspace:** `/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`，分支 `codex/structure-first-startup`，起点 `e508b8a`。

**Artifacts:** `/tmp/tcad-structure-startup-y9uV6d/`。禁止使用所有者真实存储；禁止并行运行 npm；禁止推送到 origin。

## Task 1：首次启动选择与恢复兼容性（单一实现者端到端）

**Files:**

- Modify: `tests/test_tcad_studio_launcher.py`（现有 CI 已包含）。
- Modify: `tcad_studio.py`（manager 显式 opt-in）。
- Modify: `tcad_simulator.py`（manager 验证、两条 worker 传参、bootstrap 的最小默认配方）。
- Modify: `README.md`（启动/恢复说明）；本计划及规格仅在必要时同步准确性。
- Add: `docs/superpowers/2026-10-23-structure-startup-review.md`（最后由协调者整理证据）。

- [x] 1. 先写行为测试：启动器精确 manager 参数包含 `startup_recipe_mode="structure"`；真实小 domain 的全新结构会话只有 `Initialize Wafer`，模型截面与 material/thickness 一致，有非空晶圆和顶部空气，工厂模板仍可添加 Structure 步骤；manager 缺省仍为旧十步。非法模式在副作用前拒绝。
- [x] 2. 真实恢复测试：先用旧默认会话保存有自定义参数、标签、enabled、step_id、UI 和已构建几何的旧配方，再以 structure 模式重启同一 session，验证不迁移、不丢草稿与几何/来源。另覆盖结构项目、空配方，以及 session pointer 缺失时有效 autosave 和最近历史的回退。尽量复用现有夹具，不降低旧 shutdown/删除断言。
- [x] 3. 验证传参：真实 in-process 与可用的 spawn 路径创建会话得到单晶圆；模拟 spawn 不可用后的 in-process fallback 仍为单晶圆。只 mock 进程创建失败，不 mock worker 或恢复内容。旧直接 worker 五参数调用保留缺省兼容。
- [x] 4. 执行 RED，日志保存到 artifacts。命令：`TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-structure-startup-y9uV6d/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_tcad_studio_launcher`。确认新断言因缺失功能失败，不接受拼写或导入错误冒充 RED。
- [x] 5. 最小实现：manager 构造入口严格接受两种模式（默认 `legacy`）；追加 worker 可选参数并覆盖 multiprocessing args 和 in-process 调用；bootstrap 初始化助手仅在 structure 入口使用单晶圆工厂和半 domain 厚度规则，配置 substrate 与实际模型。不要改 `_webui_default_recipe`、recipe_new 或删除回退的旧行为。启动器增加一个 keyword。
- [x] 6. GREEN：重复上述专项，再执行 `tests.test_webui_cad_shell` 与 `tests.test_structure_display_http`。检查实际 slice/owner，不用输入常量冒充输出；相关材料或 domain 管理继续使用既有路径。新选项验证与旧调用兼容须有断言。
- [x] 7. README 简短说明首次启动、继续恢复与旧入口兼容。使用中文提交规范提交，经独立 SPEC → QUALITY 审查，所有 BLOCK 修好再复审。实现者自审不代替独立审查。

## Task 2：协调者最终验收与交付

浏览器验收发现并获准的独立修复（与首次启动实现分开提交）：

- Modify: `frontend/src/components/ProjectSettings.tsx`、`frontend/src/components/ProjectSettingsApiIntegration.test.tsx`。
- [x] 使用真实 `Initialize Wafer` 响应形状回归：三个材料枚举以名称为选项，`params_raw` 保持材料 ID；先确认 BOX 显示错误和确认按钮不可用的 RED。
- [x] 仅在项目设置显示模板中解析受支持的材料 ID；保留原选项已匹配值、未知材料的无效状态、原始导出、SOI、未编辑字段和旧步骤。
- [x] 串行执行项目设置专项、完整前端测试、类型检查及构建；真实浏览器再次确认项目设置可编辑。同步规格，使用独立 `fix` 提交。

- [x] 1. 独立审查完整 diff，对照 AGENTS、ADR-027/028 与规格；完成前验证技能要求重新执行命令，不只转述实现者结果。
- [x] 2. 运行 `.github/workflows/ci.yml` 中当前 Compile 与 Core backend tests 的真实命令（用 Anaconda Python 和隔离缓存）；运行 AGENTS 五模块与 grid 128 基准，确认 5 demos / 39 checks。
- [x] 3. 前端串行执行 `npm test -- --run --maxWorkers=1 --no-file-parallelism`、`npm run typecheck`、`npm run build`，记录数目、退出码和已有警告。
- [x] 4. 隔离临时存储启动真实服务，浏览器验收首次进入 CAD、仅晶圆、项目设置可编辑、添加沉积并构建、刷新保留工程；截图保存 artifacts。恢复用例由真实 worker 测试补充，不操作所有者工程。
- [x] 5. 记录环境限制、八项边界审查与有序结论，停止自己创建的临时服务，工作树保持干净。保持功能分支，等待所有者决定合并与推送。

## 最终状态

实现提交：`2a05273`（启动默认与恢复回归）、`a2b2d45`（项目设置材料显示修复）。
SPEC 与正式 QUALITY 均为 APPROVE，无 BLOCK/NB，八项边界全部 PASS。
主审验证为后端 606 项、前端 735 项通过，编译／类型检查／构建成功，grid128
五例、39 项检查全 true；真实浏览器完成新增、编辑、构建与服务重启恢复。
完整证据、首次质量汇报中断及替补重新审查说明见
[验收记录](../2026-10-23-structure-startup-review.md)。
本次按完成前验证与分支收尾流程交付；没有自动合并、推送或更新所有者服务。
