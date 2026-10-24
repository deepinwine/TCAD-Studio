# 右侧工艺类型编辑区实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development；单一实现者，完成后依次 SPEC → QUALITY 审查。步骤使用复选框记录。

**目标：** 将右侧类型控件分行并统一局部深色样式，保持现有工艺编辑行为。

**架构：** 仅修改 StepTypeEditor 呈现分组和 styles.css 的局部选择器；候选表单仍
复用 AddStepDialog，provider、API、参数与替换逻辑不变。

**技术栈：** React、TypeScript、CSS、Vitest／Testing Library、真实浏览器验收。

## 上下文与文件职责

所有者已于 `fe589ee` 规格提交后明确回复「确认」。批准规格为
`docs/superpowers/specs/2026-10-24-type-editor-layout-design.md`。
功能起点 `9298cc6`，分支 `codex/type-editor-layout`；工作树为
`/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
临时证据 `/tmp/tcad-type-editor-layout-Gfoiaw/` 不进入提交。

- `frontend/src/components/StepTypeEditor.tsx`：只加字段、操作与文本的呈现 class／分组。
- `frontend/src/styles.css`：仅增加 `.step-type-editor` 范围内的规则。
- `frontend/src/components/StepStructureBar.test.tsx`：沿用真实 provider、ParameterPanel、语言组件、factoryTemplates 及 API 边界夹具，追加分组和候选保持回归。
- 本计划：主审回填验证与审查。其他生产文件不改，包括 AddStepDialog、WorkspaceLayout、provider、Viewer、目录文案和后端。

## 任务 1：TDD → 局部实现 → 提交

- [x] 基线专项 97 tests PASS，2.00 s；`baseline.log`。
- [x] 先写真实组件测试：中英文类型字段各有 `.step-type-field`，label.control 指向原生 select，类型和模式位于不同分组，配置按钮位于 `.step-type-actions`。测试形状：

```tsx
it('类型与沉积模式为独立可访问字段', async () => {
  const source = step(0, {name: 'Structure Deposit', instanceName: 'Structure Deposit'});
  const api = apiStub({init: vi.fn(async () => ({...initView(), recipe: [source], factoryTemplates}))});
  render(<AppStateProvider api={api}><SelectedPanel /></AppStateProvider>);
  const type = await screen.findByLabelText('工艺类型');
  const mode = screen.getByLabelText('沉积模式');
  expect(type.closest('.step-type-field')).not.toBeNull();
  expect(mode.closest('.step-type-field')).not.toBe(type.closest('.step-type-field'));
  expect(type.closest('.step-type-field')!.querySelector('label')!.control).toBe(type);
  expect(mode.closest('.step-type-field')!.querySelector('label')!.control).toBe(mode);
  expect(screen.getByRole('button', {name: '配置类型'}).closest('.step-type-actions')).not.toBeNull();
  expect(api.setStep).not.toHaveBeenCalled();
});
```

- [x] 补英文、非沉积不显示模式、旧类型说明／缺模板警告各有独立文本 class、候选状态文本 class。新 CSS hook 断言先失败；既有功能已存在的回归可以原本就通过，不能冒称都是新增失败。
- [x] 在两个步骤上分别配置 Etch 候选：只选中步骤的候选可见，另一个仍有 hidden；返回后保留候选数值与单位草稿，取消不请求，确认仍一次原子 setStep。复用 SelectionControls 与现有唯一 ID／64 组合测试，不改断言。
- [x] 运行专项 RED，确认失败来自缺少呈现分组／class，不是 fixture、label、状态异步或模板缺失。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/StepStructureBar.test.tsx
```

- [x] 最小 JSX 改动：现有 type label/select 包在 `.step-type-field`；现有条件 Deposit fragment 改为第二个 `.step-type-field`，二者放 `.step-type-controls`；原配置按钮包 `.step-type-actions`。保留所有属性、值与事件处理器。例如原类型 label/select 的外层形状为：

```tsx
<div className="step-type-controls">
  <div className="step-type-field">
    <label htmlFor="step-process-type">{t('typeEdit.type')}</label>
    <select id="step-process-type" disabled={busy} value={choice} onChange={event => configure(event.target.value, 'Deposit')}>
      <option value="" disabled>{t('structure.selectType')}</option>
      {processCatalog.map(item => <option key={item.id} value={item.id}>{t(item.key)}</option>)}
    </select>
  </div>
  {choice === 'Deposit' && <div className="step-type-field">
    <label htmlFor="step-deposition-mode">{t('typeEdit.mode')}</label>
    <select id="step-deposition-mode" disabled={busy} value={mode} onChange={event => configure(choice, event.target.value)}>
      <option value="Deposit">{t('typeEdit.film')}</option>
      <option value="Fill">{t('typeEdit.fill')}</option>
    </select>
  </div>}
  <div className="step-type-actions"><button type="button" disabled={busy || !available} onClick={() => configure(choice, mode)}>{t('typeEdit.configure')}</button></div>
</div>
```

旧类型 p 加 `step-type-help`，缺模板 p 加 `step-type-warning`，候选状态 p 加
`step-type-notice`；map 的原 div 加 `step-type-candidate-panel`，保留原 key 和 hidden。
current／choice／mode／available、configure／cancel、map 与 AddStepDialog 回调不改。

- [x] 增加局部 CSS；以下规则是尺寸／选择器的具体起点，可按实际浏览器微调间距，但不得扩大作用域或裁掉溢出：

```css
.step-type-editor { display: grid; gap: 10px; min-width: 0; margin-block: 12px; }
.step-type-editor .step-type-controls,
.step-type-editor .step-type-field,
.step-type-editor .step-type-candidate-panel:not([hidden]),
.step-type-editor .type-candidate form { display: grid; gap: 8px; min-width: 0; }
.step-type-editor > [hidden] { display: none; }
.step-type-editor .step-type-field label { color: #cbd8e5; font-size: 10px; }
.step-type-editor select,
.step-type-editor input:not([type="checkbox"]):not([type="range"]) {
  box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; min-height: 30px;
  padding: 6px 8px; color: #dce7f2; background: #0b121b; border: 1px solid #34485d; border-radius: 4px;
}
.step-type-editor button { min-height: 30px; max-width: 100%; padding: 6px 8px; color: #dce7f2; background: #172333; border: 1px solid #34485d; border-radius: 4px; white-space: normal; overflow-wrap: anywhere; }
.step-type-editor .step-type-actions button { width: 100%; }
.step-type-editor :is(select, input, button):focus-visible { outline: 2px solid #56b5ff; outline-offset: 1px; }
.step-type-editor :is(select, input, button):disabled { cursor: not-allowed; opacity: .58; }
.step-type-editor :is(p, h2, small, label) { min-width: 0; overflow-wrap: anywhere; }
.step-type-editor :is(.step-type-help, .step-type-warning, .step-type-notice) { margin: 0; font-size: 11px; line-height: 1.45; }
.step-type-editor .step-type-help { color: #a6b9cd; }
.step-type-editor .step-type-warning { color: #f2a6ae; }
.step-type-editor .step-type-notice { color: #a6b9cd; }
.step-type-editor .type-candidate { min-width: 0; padding: 9px; border: 1px solid #263444; border-radius: 5px; background: #101925; }
.step-type-editor .type-candidate h2 { margin: 0; font-size: 13px; }
.step-type-editor .type-candidate form > p { margin: 0; color: #a6b9cd; font-size: 11px; line-height: 1.45; }
.step-type-editor .type-candidate .dialog-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.step-type-editor .type-candidate .dialog-actions button { flex: 1 1 100px; min-width: 0; }
```

不要用 `.step-type-editor div {display:grid}` 破坏 hidden，不改全局控件选择器；
checkbox/range 不套用普通输入外观。原生 select 箭头和菜单保留，不加自绘控件。

- [x] 专项 GREEN，串行完整前端、类型检查、构建、diff check；记录实际数量与退出码，不改 timeout、依赖或旧断言。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [x] 自审仅三个文件、无逻辑或 handler 变更；提交 `fix(类型编辑): 分组右侧控件并统一局部深色样式`。报告 SHA、RED／GREEN、限制，释放 npm 锁。

## 任务 2：主审浏览器、基线与复审

- [x] 并行独立检查 AGENTS 五模块、Python 编译与 grid128（5 个 demo、39 checks）；运行环境 `TCAD_SKIP_QT=1 MPLBACKEND=Agg`，Python `/opt/anaconda3/bin/python3`，pycache 放证据目录。
- [x] npm 锁释放后主审串行独立完整前端、类型检查和构建。
- [x] CUA 真实隔离会话保存修复前截图。修复后在 320／260 px 右栏分别验证中英文、类型和沉积模式、内联候选数字／名称、焦点和禁用状态；使用原分隔键盘 Home 调到下限，不注入状态。
- [x] 浏览器只读检查 `.step-type-editor`、control 与候选的 rect、scrollWidth/clientWidth、computed style；不能以 jsdom 尺寸断言替代真实布局。检查原生键盘缩放 200%，确认缩放生效后才宣称验证；若宿主不支持，尝试实际 Chrome 或报告明确限制，不伪造 CSS zoom。
- [x] 切换候选／取消／确认与单位偏好保持，截图；核对隐藏候选无可见控件。对模态新增／项目设置作样式隔离回归，不改组件或正式数据。停止自己创建的服务与临时 tab。
- [x] 独立 SPEC 通过后再 QUALITY；审查完整差异与已批准范围。问题交原实现者修复并复审，不能继承中断会话的签核。
- [x] 归档八项边界、实际验证与环境限度，提交纯验收记录；保持功能分支，合并推送待所有者选择。

## 计划自检

规格的分行、色彩、焦点、可访问性、窄栏、隐藏候选与行为不变均有测试或浏览器
验收对应。没有变更 AddStepDialog 参数实现、WorkspaceLayout、API、后端或全局样式。
DOM 分组回归与实际 CSS 排版证据分开记录，不把新增 class 当作视觉验收已通过。

## 验收记录（2026-10-24）

实现提交 `70216fc`，生产改动仅 StepTypeEditor 的 JSX 分组／class 与局部 CSS；
新增测试净增 3 个，并强化 2 个已有用例。状态、处理器、候选 key／hidden、
AddStepDialog、单位、步骤身份、API、后端与持久化均未修改，无新 ADR。

### 测试与基线

所有 npm 命令在 `frontend/` 串行执行；Python 使用 `/opt/anaconda3/bin/python3`，
环境为 `TCAD_SKIP_QT=1 MPLBACKEND=Agg`，pycache 置于证据目录。

| 检查 | 实际结果 | 原始日志 |
| --- | --- | --- |
| 实现前 StepStructureBar 专项 | 97 PASS，2.00 s | baseline.log |
| 新测试 RED | 95 PASS／5 FAIL，失败仅缺少呈现分组／class | red.log |
| 实现后同一专项命令 | 100 PASS | green.log |
| 主审完整前端：`npm test -- --run --maxWorkers=1 --no-file-parallelism` | 43 文件、759 PASS，24.89 s | root-frontend.log |
| `npm run typecheck`／`npm run build` | 退出码均为 0 | root-typecheck.log／root-build.log |
| AGENTS §8 五模块 unittest | 207 tests OK，93.127 s | backend.log |
| `python3 -m py_compile tcad_simulator.py tools/*.py` | 退出码 0 | compile.log |
| `python3 tools/run_process_cad_baseline.py --grid 128 --output <json>` | 退出码 0，5 demos、39 checks 全部 true | grid128.log／grid128.json |

五模块为 `tests.test_process_cad_foundation`、`tests.test_process_cad_primitives`、
`tests.test_process_cad_demos`、`tests.test_webui_viewer_contract`、
`tests.test_webui_cad_shell`，通过 `python3 -m unittest` 一次运行。
专项命令为 `npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/StepStructureBar.test.tsx`。
原有 JSDOM canvas／navigation 提示、Python ResourceWarning 和构建大 chunk 提示仍存在，
未更改 timeout、依赖或旧断言来规避。

### 真实界面验收

- 使用 CUA 操作两个隔离服务，storage 和配方都放在临时目录；未访问正式项目数据。
- 320／260 px 参数栏均核验中英文；编辑区实际宽度分别为 295／235 px，
  `clientWidth=scrollWidth`。类型、沉积模式各自独立一行，配置按钮独立一行；
  原生 select 高 35 px，按钮不少于 30 px，焦点为蓝色 2 px。
- 在 260 px 候选中输入 42 nm，切单位为 0.042 µm，切换步骤后值与单位保留；
  非选中候选 `hidden=true`、`display:none`、无可见 rect。取消保留原正式值，
  另一候选确认后正式刻蚀深度为 17 nm、Dirty；未启动构建。
- IAB 的缩放快捷键没有生效，未将其计为 200% 证据。改用独立 Chrome Incognito：
  原始 AX 明确显示 `Zoom: 200%`。在中英文下以 Tab 到达类型选择、数字输入、
  取消与确认，焦点清晰，纵向滚动可到达操作栏；英文填 42 后取消，正式值仍 20.00；
  中文再次填 42 后确认，正式值为 42.00、Dirty。结束恢复 `Zoom: 100%` 并关闭测试窗口。
- 新增步骤和项目设置弹窗均不属于 `.step-type-editor`，保留原背景
  `rgb(12,23,34)` 与 8 px 内边距；打开和取消正常。浏览器最终 warn／error 为空。
- checkbox／range 不套用普通输入框样式由选择器审查确认；未声称逐一视觉验证所有工艺模板。
- 临时服务 8826／8827 均已停止（退出码 0、无监听），临时 IAB 标签关闭。

证据根 `/tmp/tcad-type-editor-layout-Gfoiaw/`。截图包括 `browser-before-320.jpg`、
`browser-after-320-zh.jpg`／`browser-after-320-en.jpg`、`browser-after-260-zh.jpg`、
`browser-candidate-260-en.jpg`、`browser-200-en.jpg`、
`browser-200-candidate-en.jpg`／`browser-200-candidate-zh.jpg`；
尺寸、焦点、隐藏与弹窗隔离分别有对应 JSON，200% 确认后的 AX 存于
`browser-200-confirm.txt`。Zoom 数值和英文取消结果还由本次 CUA 原始工具输出核对。

### 审查与边界

SPEC 独立审查 `9298cc6..70216fc`，最终 **APPROVE**，BLOCK／NB 均无；
代码审查与浏览器证据补审已完成。QUALITY 首位审查员因用量限制未执行，
不计为通过；新的独立审查员审查完整差异后 **APPROVE**，BLOCK／NB 均无，
独立专项 100／100 PASS、1.86 s、退出码 0（`quality.log`），并核对既有完整回归日志
和真实界面证据。两阶段审查没有由实现者自审替代。

| 架构边界 | 判定 | 依据 |
| --- | --- | --- |
| React | PASS | 仅 JSX 呈现与局部 CSS，无几何计算 |
| Three.js | PASS | Viewer、相机与渲染路径未改 |
| Python | PASS | 应用层、API、Recipe 未改 |
| C++ | PASS | 引擎与依赖未改 |
| Layout | PASS | gdstk、KLayout 与版图契约未改 |
| ViennaPS | PASS | 可选适配与回退未改 |
| canonical | PASS | 参数、单位、身份与保存格式未改 |
| scope-tests-storage | PASS | 最小范围、回归与浏览器证据闭合，正式数据未动 |

原生系统下拉菜单颜色存在平台差异，是批准规格中的已知限制。本次为局部呈现调整，
没有新增几何计算、存储格式或运行接口；未改变正式项目与相机逻辑。
分支保留在 `codex/type-editor-layout`；本记录阶段未合并或推送，main 与 studio/main
仍为 `9298cc6`。全程未访问第三方 origin。
