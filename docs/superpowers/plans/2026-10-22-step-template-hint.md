# NB-001 步骤模板提示修复计划

> **面向 AI 代理的工作者：** 使用 subagent-driven-development，单个实现任务，TDD 后依次进行 SPEC、QUALITY 审查。实现与审查不并行运行 npm。

**目标：** 区分“没有选择新增类型”与“所选类型确实没有模板”，消除误报。

**架构：** 仅修改 StepStructureBar 的现有提示渲染条件，继续由后端 factoryTemplates
决定模板是否可用。添加按钮、配置表单、API 和工艺执行路径不变。

**技术栈：** React、TypeScript、Testing Library、Vitest；不增加依赖。

## 已批准范围

2026-10-22 所有者确认最小方案：未选择类型不显示错误且添加禁用；选择后确实缺少
模板时继续显示现有提示。覆盖未选择、模板存在／缺失和切换类型；不新增引导文案。
基线为 `0ce05689d619192efdd3271ac16e2f9888a262db`，已合并并推至 studio/main。
使用现有独立工作树的新分支 `codex/step-template-hint`，不改 main、用户存储或服务。
历史任务 5 记录保留为当时的验收事实，不改写其结果。

## 文件职责

- `frontend/src/components/StepStructureBar.tsx`：仅修正提示条件。
- `frontend/src/components/StepStructureBar.test.tsx`：使用真实组件和 AppStateProvider，API 边界沿用既有 stub，新增显示条件回归。
- 本计划：记录批准范围、验证和审查结论。

## 任务 1：消除空选择的模板误报

- [x] 运行既有专项，确认基线通过：

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/StepStructureBar.test.tsx
```

- [x] 先新增失败测试。使用本文件已有的 `apiStub`、`initView`、`mount` 和
  `factoryTemplates`，覆盖有完整模板和旧服务无模板两种初态。例如：

```tsx
it.each([{templates: undefined}, {templates: []}, {templates: factoryTemplates}])('未选择新增类型不误报模板缺失', async ({templates}) => {
  const api = apiStub({init: vi.fn(async () => ({...initView(), factoryTemplates: templates}))});
  mount(api);
  await waitFor(() => expect(screen.getByRole('button', {name: '下移'})).toBeEnabled());
  expect(screen.getByLabelText('添加步骤类型')).toHaveValue('');
  expect(screen.queryByText(/结构工艺模板不可用/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: '添加步骤'})).toBeDisabled();
  expect(api.addStep).not.toHaveBeenCalled();
});
```

测试等待服务初始化后的可见状态，不能只检查请求返回前的 loading 状态。继续验证
缺失选择→受支持选择→空选择；旧服务选择后仍提示并禁用；沉积／填充实际模板选择；
添加成功重置选择后不重新误报；中英文现有提示不变。复用已有用例，不削弱旧断言。

- [x] 运行专项，确认新空选择测试因现有 `<small>` 误显示而 FAIL，记录实际结果。
- [x] 只将原条件替换为：

```tsx
{addChoice !== '' && !available && <small>{t('structure.legacyServer')}</small>}
```

- [x] 重跑专项确认 GREEN；审查 diff，生产代码仅一个条件。
- [x] 完整前端测试、类型检查、构建串行通过，不调 timeout、不删测试：

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [x] 使用中文小提交 `fix(步骤编辑): 仅在选中类型缺少模板时显示提示`。
- [x] 主审独立复跑完整前端验证；临时隔离服务实测初态无误报、选中可添加，并保存截图。
- [x] 独立 SPEC → QUALITY，无 BLOCK 后记录验收；不自动合并、推送或更新用户服务。

## 验收边界

不修改 StepTypeEditor、目录八类、工厂元数据、语言文案、后端、Three.js、工艺算法、
保存协议或原子创建行为。本轮没有后端改动时，不把上一轮后端 595 项冒称本轮实跑。
临时测试输出和截图位于 `/tmp`，不提交到仓库。

## 2026-10-22 验收结果

代码提交为 `a18c6c9`（一行提示条件及初始回归）、`844f0e7`（状态转换回归）。
生产代码只有一处条件变更，既有模板匹配、添加门禁及创建路径完全不变。
历史 NB-001 在本轮批准的左侧步骤添加区范围内关闭；不宣称右侧旧类型编辑提示
已统一修改。本记录不修改上轮任务 5 的历史验收事实。

TDD 证据：原专项 78 项通过；首次新增空选择／清空选择测试后为 4 FAIL、78 PASS，
失败均为错误的 `<small>` 仍存在。另在移除本次 guard 时，成功添加后的 reset 用例
再次因误提示出现而失败（1 FAIL、84 SKIP）；恢复后专项 85 项通过。
最终共有 7 项新增测试，不改旧断言、测试超时或依赖。

| 验证者／项目 | 实测结果 | 代码版本 |
| --- | --- | --- |
| 实现者：专项／完整前端 | 85／730 tests PASS | `844f0e7` |
| 实现者：类型检查、构建、diff 检查 | exit 0 | `844f0e7` |
| 主审：完整前端串行测试 | 43 files、730 tests PASS，23.52 s | `844f0e7` |
| 主审：类型检查、生产构建 | 两项 exit 0 | `844f0e7` |
| 主审：AGENTS 五个后端基础模块 | 207 tests，OK，92.940 s | 同一未改后端 |
| 主审：Python 编译、grid128 | 编译 exit 0；五例、39 个检查全部 true | 同一未改后端 |
| 独立 SPEC：步骤编辑专项、范围 diff 检查 | 85 tests PASS，1.44 s；检查 exit 0 | `844f0e7` |
| 独立 QUALITY：步骤编辑专项、范围 diff 检查 | 85 tests PASS，1.59 s；检查 exit 0 | `844f0e7` |

SPEC → QUALITY 均为 APPROVE，无 BLOCK、无新增 NB。八项边界均 PASS：空选择三类
metadata、缺失模板、有效模板、类型状态转换、Deposit／Fill 实际工厂、双语、成功
reset 及最小职责范围。回归风险低；最终验收文档更新不改变审查过的运行时代码。

浏览器使用 `127.0.0.1:8818` 和全新临时 storage。左侧初始空选择无误提示且添加禁用；
选 Etch 后可添加，切空和中文仍无误报。加载合成结构示例后，经真实 AddStepDialog
新增一个名为“模板提示验收”的 Strip 步骤，可见步骤由 5 增为 6；回调完成后 DOM
选择值为 `''`、添加禁用、左侧误提示数为 0。切至英文状态保持，控制台无 error/warn。
真实浏览器未模拟缺失目录；该路径由 API 边界组件回归验证。

证据根目录为 `/tmp/tcad-template-hint-imJxPB/`：`red.log`、`reset-guard-red.log`、
`implementation-final-*.log`、`root-frontend-full.log`、`root-typecheck.log`、
`root-build.log`、`backend-baseline.log`、`grid128.json`。真实 DOM 记录为
`browser-evidence.json`；完整中英文截图为 `browser-reset-zh.jpg`、`browser-reset-en.jpg`，
聚焦左侧添加区的中文截图为 `browser-stepbar-zh.jpg`。临时证据不保证跨机器可用。

本轮没有后端代码修改，也没有重跑全部 595 项后端，不能将上一轮结果冒称为本轮实跑。
保留既有 Python 日志 ResourceWarning、JSDOM canvas/navigation 诊断及 Vite 包体积
警告；未验证 Windows、远端 Linux 或 CI Node 22。没有操作用户正式会话、配方或服务。
main 与 studio/main 保留 `0ce0568`，本修复仅本地功能分支提交，合并／推送另由所有者确认。
