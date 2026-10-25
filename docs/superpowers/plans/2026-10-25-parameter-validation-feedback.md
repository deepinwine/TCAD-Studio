# 参数错误原因与显示单位提示实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development。单一实现者负责关联的呈现变更，完成后依次 SPEC → QUALITY；主审归档验收。

**目标：** 在既有校验失败时显示具体原因和正确的显示单位，并让错误与字段关联。

**架构：** 从 ParameterPanel 私有文案映射提取共享纯呈现 helper，复用已有校验结果与单位换算；AddStepDialog 和 ParameterPanel 消费 helper。验证、参数和请求路径保持。

**技术栈：** React、TypeScript、Vitest／Testing Library、现有双语目录和 units 工具。

## 批准依据与文件职责

所有者已在规格 `d814657` 提交后回复「确认」。规格为
`docs/superpowers/specs/2026-10-25-parameter-validation-feedback-design.md`。
分支 `codex/parameter-validation-feedback`，起点 `bf3125c`；工作树为
`/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
证据根 `/tmp/tcad-parameter-feedback-JkjmcA/`，日志不提交。

- 新建 `frontend/src/components/parameterValidationMessage.ts`：已有 messageKey 到双语
  文案的共享映射，以及仅为提示使用的边界单位换算。
- 修改 `frontend/src/components/ParameterPanel.tsx`：删除原私有映射，传当前 displayUnit
  调用 helper；保留保存时机、raw/canonical 草稿、字段与服务错误生命周期。
- 修改 `frontend/src/components/AddStepDialog.tsx`：通用错误改为具体提示；同一字段的
  控件、滑块和错误文本按 useId 派生唯一关联。保留原 values/validated/onConfirm。
- 修改 `frontend/src/i18n/catalogs.ts`：仅必要的单位整数语义或边界文案，对等中英文。
- 新建 `frontend/src/components/parameterValidationMessage.test.ts`，补充
  `AddStepDialog.test.tsx`／`ParameterPanel.test.tsx`／`StepStructureBar.test.tsx` 的真实组件
  回归。必要时在既有 DepthWindowParameters 测试补充活动字段与隐藏草稿断言。
- 本文由主审回填测试、浏览器和审查。不修改 CSS、API、后端、单位算法或校验器。

## 任务 1：呈现 helper 与真实组件回归（单一实现者）

- [x] 基线四文件 182 PASS，4.31 s；命令见下，`baseline.log`。
- [ ] 先新增真实组件测试：负深度原因、上限 1000 nm 切 µm 后为 1 µm、90° 切 rad
  后不能写成 1.57 的精确上限、非数值／转换溢出、整数 canonical 含义。
  中英文均有覆盖；借现有 fixture/real provider，不 mock 被测校验器或 helper。

```tsx
const confirm = vi.fn(async () => {});
render(<AddStepDialog template={template} busy={false} onCancel={() => {}} onConfirm={confirm} />);
fireEvent.change(screen.getByLabelText('厚度（nm）'), {target: {value: '-1'}});
expect(screen.getByRole('alert')).toHaveTextContent('必须大于或等于 0 nm');
expect(screen.getByLabelText('厚度（nm）')).toHaveAttribute('aria-invalid', 'true');
expect(screen.getByLabelText('厚度（nm）')).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
expect(screen.getByRole('button', {name: '确认添加'})).toBeDisabled();
expect(confirm).not.toHaveBeenCalled();
```

- [ ] 补 project/inline 入口：非法值零提交、修正后一次提交且 canonical payload 不变；
  两个候选错误 ID 不冲突；切语言与单位不丢 raw 草稿、name 和隐藏条件字段。
  choice/bool/range 的错误属性亦覆盖。用既有64组合／原子替换测试作回归。
- [ ] 运行 RED，确认失败来自旧通用提示、缺描述关联或旧 canonical 边界呈现，
  不是 fixture、label、活动字段或异步等待。保留原始 `red.log`。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/AddStepDialog.test.tsx src/components/ParameterPanel.test.tsx src/components/StepStructureBar.test.tsx src/components/DepthWindowParameters.test.tsx
```

- [ ] 共享 helper 的接口约定如下；类型复用现有 I18nContextValue 和 ParameterSpecView。
  参数顺序可遵循现有习惯，但不传组件状态或 actions，不产生副作用。

```ts
export function parameterValidationMessage(
  messageKey: string | undefined,
  spec: ParameterSpecView,
  t: I18nContextValue['t'],
  displayUnit?: DisplayUnit,
): string;
```

minimum/maximum 从 spec 的 canonical 边界出发，只有 conversionSpec 可靠且当前单位合法
才调用 fromCanonical；否则使用 spec.units。角度 canonical 的 degree 显示为 °。
换算异常仅捕获 UnitConversionError，回退 canonical 数字与 canonical 单位；不标错单位，
不吞其他程序错误。使用有限数值的非截断字符串，不使用 toFixed 造成阈值错误。
整数错误在有换算时明确是 canonical 单位整数，无换算时沿用原文案。其余 messageKey
复用现有目录，缺省继续 parameter.invalid。helper 单元测试覆盖各分支与无单位情况。

- [ ] ParameterPanel 只替换原 validationMessage 调用并传 displayUnit，不改 update、
  flush、timer、changeUnit、ParameterControl、draft 活动判断或 API。
- [ ] AddStepDialog 在 map 内派生 `errorId = id + '-validation'`；使用同一个实际
  result 生成错误文案，为该字段 choice/bool/input/range 传 aria-invalid 和
  aria-describedby。错误 small 仍 role=alert，消失后移除关联。不要关联其他候选错误。
  既有 failed 提示、输入类型、onConfirm/gate/finally、条件参数和单位偏好不动。
- [ ] GREEN 后跑 helper 和四组件专项、完整前端、typecheck/build，记录退出码。
  不降低断言或延长 timeout；所有 npm 由实现者串行运行，完成释放锁。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [ ] 自审生产差异只有错误呈现；提交 `fix(参数提示): 显示具体错误原因与当前单位`。
  交接报告列出 SHA、文件、RED/GREEN、完整回归和限制，不改主审文档。

## 任务 2：主审独立验收与复审

- [ ] 主审并行运行 AGENTS 五模块、py_compile 和 grid128；Python
  `/opt/anaconda3/bin/python3`，`TCAD_SKIP_QT=1 MPLBACKEND=Agg`，pycache 在证据根。
- [ ] 实现者释放 npm 锁后，主审串行独立完整前端、typecheck 和 build。
- [ ] 临时 storage + 12×12×48／10 nm 结构服务，只导入本次临时配方，不操作正式数据。
  CUA 验证中英文错误原因、换单位后提示、修正后确认；260 px 内候选文本换行且
  无横溢出。检查 DOM aria-describedby 精确指向同一字段的错误，不注入应用状态。
  新增与项目设置弹窗同样核验。截图存证据根，退出时停止自己创建的服务。
- [ ] 独立 SPEC 审查完整差异；通过后独立 QUALITY。问题交原实现者修复后复审，
  不能将中断／用量限制误当作批准。
- [ ] 归档八项架构边界和实际结果、更新复选框，提交纯验收记录。保留功能分支，
  不合并、不推送；合并推送由所有者另行选择。

## 计划自检

具体原因、显示单位、非截断阈值、转换溢出与 canonical 整数分别有 helper 和组件
覆盖；错误关联使用实例 ID。非法零提交、修正一次提交、条件参数与草稿保持由实际
组件和既有 provider 回归约束。没有新校验规则或新数据通路。
