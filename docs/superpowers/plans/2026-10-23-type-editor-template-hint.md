# 右侧工艺类型模板误提示修复计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development；单一实现者，完成后依次 SPEC → QUALITY 审查。步骤使用复选框记录状态。

**目标：** 未选择新类型时不误报服务器模板缺失，已选类型真正缺少模板时继续警告。

**架构：** 仅给 `StepTypeEditor` 既有警告增加非空选择条件；不修改工厂选择、候选参数、替换请求或按钮门禁。复用真实 ParameterPanel/AppStateProvider 和既有 API 边界夹具测试。

**技术栈：** React、TypeScript、Testing Library、Vitest；不增加依赖。

## 所有者批准的规格（方案 A）

2026-10-23 所有者选择 A。左侧添加区的同类误提示已在 `e508b8a` 前解决，本轮仅处理
右侧类型切换。旧步骤未选新类型（`choice === ''`）时不显示 `structure.legacyServer`；
仍显示原有旧类型说明，配置按钮保持禁用。明确选择类型后，实际对应模板存在则可配置；
模板缺少则继续原中英文警告和禁用，不猜测模板。取消候选返回未选择状态时不重新误报。
确认仍通过原子 `set_step`，不改 Recipe、参数、步骤身份、保存或几何算法。

起点：`b0259dc2e0aa181d94a11a628b4cdd8be9c735ee`。
分支：`codex/type-editor-template-hint`。
工作树：`/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
临时证据：`/tmp/tcad-type-editor-hint-Dbe47E/`。不访问用户正式存储，不自动合并或推送。

## 文件职责

- 修改 `frontend/src/components/StepTypeEditor.tsx`：一处警告条件。
- 修改 `frontend/src/components/StepStructureBar.test.tsx`：沿用现有 `step`、`apiStub`、`initView`、`SelectedPanel`、`factoryTemplates`、语言组件，追加右侧行为回归；不降低原断言。
- 本计划：记录批准范围、执行步骤、验证与审查结果；不修改旧任务的历史验收事实。

## 任务 1：TDD 最小修复

- [x] 运行基线专项：85 tests PASS，1.64 s；`baseline.log`。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/StepStructureBar.test.tsx
```

- [x] 先追加以下真实组件测试。初态用 `name: 'Legacy'` 的旧步骤，不能用已映射到目录的 `Etch` 冒充未选类型。模板状态覆盖 `undefined`、`[]` 和完整模板；中英文均验证。示例可直接在已有文件中使用：

```tsx
it.each([undefined, [], factoryTemplates])('旧步骤未选新类型不误报：%j', async templates => {
  const source = step(0, {name: 'Legacy', instanceName: 'old layer'});
  const api = apiStub({init: vi.fn(async () => ({...initView(), recipe: [source], factoryTemplates: templates}))});
  render(<AppStateProvider api={api}><SelectedPanel /></AppStateProvider>);
  await screen.findByText('当前为旧配方类型：Legacy');
  expect(screen.getByLabelText('工艺类型')).toHaveValue('');
  expect(screen.queryByText(/结构工艺模板不可用/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: '配置类型'})).toBeDisabled();
  expect(api.setStep).not.toHaveBeenCalled();
});
```

语言用既有 `I18nProvider` + `LanguageSwitcher` 切换，保存并恢复原 localStorage 语言值，
避免污染其他测试。不 mock StepTypeEditor、ParameterPanel 或 provider。补充：

- 未选 → 选择有模板类型：打开现有候选表单，不误报，不提前发 set/add/remove/run。
- 未选 → 选择缺失模板类型：原警告可见、配置禁用，无候选表单和写请求。
- 有模板候选 → 取消：回到旧步骤空选择，不误报、不请求。
- 有模板 → 缺失类型 → 有模板：每次对应真实模板状态；需要丢弃候选时显式确认，并恢复 confirm spy。
- 保留已有「旧步骤可内联改成任何目录类型，取消不请求且确认原子替换」断言。

- [x] 运行 RED，记录失败数量与原因；必须是空选择或取消后的误提示仍出现，不是 fixture、label 或异步时序错误。
- [x] 最小实现仅改以下条件，不改 `available`、`configure`、`cancel` 或按钮：

```tsx
{choice !== '' && !available && <p>{t('structure.legacyServer')}</p>}
```

- [x] 重跑专项 GREEN；继续串行运行完整前端、类型检查、构建和 diff 检查，不改依赖、超时或旧测试断言。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [x] 提交：`fix(类型编辑): 未选择新类型时不误报模板缺失`。自审并报告 RED/GREEN、准确 SHA、文件、限制。

## 任务 2：独立验收

- [x] 主审独立复跑完整前端、类型检查和构建；不与实现者或审查者并行 npm。
- [x] 主审执行 AGENTS 五个后端模块、Python 编译、grid128（五例、39 checks），明确没有后端源码修改、不把上轮 606 项冒称本轮实跑。
- [x] 真实浏览器使用全新隔离存储的 legacy 默认会话，选一个未映射到八类目录的旧步骤，验证右侧初态无误报、可配置目标、取消回空状态与双语；保存截图，不更改用户工程或运行物理工艺。
- [x] SPEC → QUALITY 独立审查完整差异与批准范围，所有 BLOCK 修复复审通过；质量审查覆盖最终整体代码。
- [x] 将实测结果、八项边界、风险及环境限制写回本计划，停止自己创建的服务，保持干净功能分支；合并和推送由所有者另行决定。

## 本轮实测记录（2026-10-23）

实现提交：`34c1feae72b680e91576e45f6dd225ceaba90656`。生产代码仅一行显示条件，
测试净增 12 项；没有运行时后端、API、依赖、布局、序列化或几何变更。

- RED：`correct-red.log` 为 10 项预期失败、87 项通过；空选择及取消后仍显示旧警告。
  早期 `RED.log` 混有测试定位错误，不作为有效 RED 证据。候选表单使用候选专属提示
  定位，不用全局 `status` 将旧步骤状态误认成候选。随后收紧初态为空选择的显式断言。
- GREEN：专项 97/97 通过；实现者完整前端 43 个文件、747 项通过。
- 主审独立串行复跑完整前端 43 个文件、747 项通过（36.12 s）；`typecheck`、
  `build` 均退出 0。日志为 `root-frontend.log`、`root-typecheck.log`、`root-build.log`。
- 主审执行 AGENTS 五模块：207 tests，91.878 s，OK；`backend-baseline.log`。
  编译 `tcad_simulator.py tools/*.py` 退出 0；`compile.log`。这不是上轮 606 项回归。
- 主审 grid128 运行退出 0；独立解析 `grid128.json`，5 个 demo、39 个语义检查全 true。
- 真实浏览器：独立临时存储、通用 legacy 默认会话的 Spin Resist；中英文均验证
  空选择不误报、配置按钮禁用、选择 Etch 出现候选、取消回空选择，旧厚度 120 nm
  与 Photoresist 保留。未确认替换、未点击运行或构建，时间线没有成功快照；控制台
  warn/error 为空。`browser-before-*.jpg`、`browser-after-cancel-*.jpg` 为前后证据。
  真正缺失模板的服务状态由 API 边界组件回归覆盖，未冒称浏览器连接过旧版缺目录服务。
- 自建验收服务正常停止，8822 端口无监听；用户工程、正式存储与其他服务未改动。

环境：macOS arm64、Anaconda Python 3.13.5、Node 26.0.0；未验证 Windows/Linux
真机、最小 Python 依赖或 CI Node 22。既有 ResourceWarning、JSDOM canvas 提示与
Vite 大包警告仍存在，测试及构建退出 0，不在本轮扩大修改范围。

## 独立审查结论

- SPEC：APPROVE；逐行核对 `b0259dc..34c1fea`，无 BLOCK、无 NB。
- 第一位 QUALITY 审查者因模型额度中断，没有形成签核，不计为通过。
- 替代 QUALITY 审查者独立核对完整 feature 后正式 APPROVE，无 BLOCK、无 NB；
  自行重跑同一专项命令，97/97 通过（2.76 s），退出 0；
  `quality-final-targeted.log`。提交范围 `git diff --check` 退出 0。
  其余全量日志由该审查者核对，不冒称为该审查者重新执行。

两轮八项边界结论一致：

| 边界 | 结论 | 依据 |
| --- | --- | --- |
| React 前端 | PASS | 仅调整既有警告条件，不计算几何 |
| Three.js | PASS | 查看器及渲染逻辑未改 |
| Python 兼容 | PASS | 既有调用链、工厂与后端源码未改 |
| C++ | PASS | 无引擎、绑定或依赖变更 |
| Layout / gdstk | PASS | 版图路径和可选依赖未改 |
| ViennaPS 可选性 | PASS | 可选后端边界未改 |
| Canonical / 序列化 | PASS | 参数、Recipe、步骤身份和保存格式未改 |
| 范围 / 测试 / 存储 | PASS | 最小生产差异，原断言保留，语言偏好恢复，无正式存储修改 |

回归风险低：只影响空选择和取消后的提示可见性；真正缺模板的警告及禁用保持。
有序修复清单为空。实施、回归与独立审查已完成；功能分支保留，**未合并、未推送**。
本轮不改历史任务验收文件。`main` 与本地 `studio/main` 仍为 `b0259dc`，
下一步的合并或推送须由所有者另行选择。
