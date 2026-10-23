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

- [ ] 先追加以下真实组件测试。初态用 `name: 'Legacy'` 的旧步骤，不能用已映射到目录的 `Etch` 冒充未选类型。模板状态覆盖 `undefined`、`[]` 和完整模板；中英文均验证。示例可直接在已有文件中使用：

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

- [ ] 运行 RED，记录失败数量与原因；必须是空选择或取消后的误提示仍出现，不是 fixture、label 或异步时序错误。
- [ ] 最小实现仅改以下条件，不改 `available`、`configure`、`cancel` 或按钮：

```tsx
{choice !== '' && !available && <p>{t('structure.legacyServer')}</p>}
```

- [ ] 重跑专项 GREEN；继续串行运行完整前端、类型检查、构建和 diff 检查，不改依赖、超时或旧测试断言。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [ ] 提交：`fix(类型编辑): 未选择新类型时不误报模板缺失`。自审并报告 RED/GREEN、准确 SHA、文件、限制。

## 任务 2：独立验收

- [ ] 主审独立复跑完整前端、类型检查和构建；不与实现者或审查者并行 npm。
- [ ] 主审执行 AGENTS 五个后端模块、Python 编译、grid128（五例、39 checks），明确没有后端源码修改、不把上轮 606 项冒称本轮实跑。
- [ ] 真实浏览器使用全新隔离存储的 legacy 默认会话，选一个未映射到八类目录的旧步骤，验证右侧初态无误报、可配置目标、取消回空状态与双语；保存截图，不更改用户工程或运行物理工艺。
- [ ] SPEC → QUALITY 独立审查完整差异与批准范围，所有 BLOCK 修复复审通过；质量审查覆盖最终整体代码。
- [ ] 将实测结果、八项边界、风险及环境限制写回本计划，停止自己创建的服务，保持干净功能分支；合并和推送由所有者另行决定。
