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
- [x] 先新增真实组件测试：负深度原因、上限 1000 nm 切 µm 后为 1 µm、90° 切 rad
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

- [x] 补 project/inline 入口：非法值零提交、修正后一次提交且 canonical payload 不变；
  两个候选错误 ID 不冲突；切语言与单位不丢 raw 草稿、name 和隐藏条件字段。
  choice/bool/range 的错误属性亦覆盖。用既有64组合／原子替换测试作回归。
- [x] 运行 RED，确认失败来自旧通用提示、缺描述关联或旧 canonical 边界呈现，
  不是 fixture、label、活动字段或异步等待。保留原始 `red.log`。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/AddStepDialog.test.tsx src/components/ParameterPanel.test.tsx src/components/StepStructureBar.test.tsx src/components/DepthWindowParameters.test.tsx
```

- [x] 共享 helper 的接口约定如下；类型复用现有 I18nContextValue 和 ParameterSpecView。
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

- [x] ParameterPanel 只替换原 validationMessage 调用并传 displayUnit，不改 update、
  flush、timer、changeUnit、ParameterControl、draft 活动判断或 API。
- [x] AddStepDialog 在 map 内派生 `errorId = id + '-validation'`；使用同一个实际
  result 生成错误文案，为该字段 choice/bool/input/range 传 aria-invalid 和
  aria-describedby。错误 small 仍 role=alert，消失后移除关联。不要关联其他候选错误。
  既有 failed 提示、输入类型、onConfirm/gate/finally、条件参数和单位偏好不动。
- [x] GREEN 后跑 helper 和四组件专项、完整前端、typecheck/build，记录退出码。
  不降低断言或延长 timeout；所有 npm 由实现者串行运行，完成释放锁。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [x] 自审生产差异只有错误呈现；提交 `fix(参数提示): 显示具体错误原因与当前单位`。
  交接报告列出 SHA、文件、RED/GREEN、完整回归和限制，不改主审文档。

## 任务 2：主审独立验收与复审

- [x] 主审并行运行 AGENTS 五模块、py_compile 和 grid128；Python
  `/opt/anaconda3/bin/python3`，`TCAD_SKIP_QT=1 MPLBACKEND=Agg`，pycache 在证据根。
- [x] 实现者释放 npm 锁后，主审串行独立完整前端、typecheck 和 build。
- [x] 临时 storage + 12×12×48／10 nm 结构服务，只导入本次临时配方，不操作正式数据。
  CUA 验证中英文错误原因、换单位后提示、修正后确认；260 px 内候选文本换行且
  无横溢出。检查 DOM aria-describedby 精确指向同一字段的错误，不注入应用状态。
  新增与项目设置弹窗同样核验。截图存证据根，退出时停止自己创建的服务。
- [x] 独立 SPEC 审查完整差异；通过后独立 QUALITY。问题交原实现者修复后复审，
  不能将中断／用量限制误当作批准。
- [x] 归档八项架构边界和实际结果、更新复选框，提交纯验收记录。保留功能分支，
  不合并、不推送；合并推送由所有者另行选择。

## 计划自检

具体原因、显示单位、非截断阈值、转换溢出与 canonical 整数分别有 helper 和组件
覆盖；错误关联使用实例 ID。非法零提交、修正一次提交、条件参数与草稿保持由实际
组件和既有 provider 回归约束。没有新校验规则或新数据通路。

## 实现与验收记录（2026-10-25）

实现提交 `5515717`。生产变更为共享纯文案 helper、两组件错误呈现和双语目录，
没有改校验规则、单位算法、状态、提交生命周期、CSS、API、后端或几何。无新 ADR。
首轮测试净增 41 项；已有测试只精确升级包含单位的文案断言，没有削弱原行为断言。
下述极小值修复再增加 8 项，最终较基准净增 49 项。

### 首轮执行结果

所有 npm 命令在 `frontend/` 串行执行；主审使用独立一轮完整前端复验。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 原四组件基线 | 182 PASS，4.31 s | baseline.log |
| 四组件 RED | 14 新失败、182 原测试通过；通用文案／缺单位／无错误 ID | red.log |
| helper 加四组件 GREEN | 223 PASS，4.65 s | green.log |
| 实现者完整前端 | 44 文件，800 PASS，25.21 s | full.log |
| 主审独立完整前端 | 44 文件，800 PASS，25.63 s | root-frontend.log |
| 主审类型检查／构建 | 退出码均为 0 | root-typecheck.log／root-build.log |
| AGENTS 五模块 unittest | 207 tests OK，92.059 s | backend.log |
| Python 编译 | 退出码 0 | compile.log |
| grid128 | 退出码 0，5 demos／39 checks 全 true | grid128.log／grid128.json |

GREEN 早期的两处新测试标签错误，以及原文案断言需升级为含 `mJ/cm²` 单位的失败，
保留原日志；没有更改生产校验使其通过。helper 的额外分支单测不冒称都出现在
四组件 RED 中。原有 jsdom navigation／canvas、Python ResourceWarning 和构建大包
提示仍存在，没有调整 timeout、断言强度或依赖来隐藏它们。

复验命令：

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-parameter-feedback-JkjmcA/pycache /opt/anaconda3/bin/python3 -m unittest tests.test_process_cad_foundation tests.test_process_cad_primitives tests.test_process_cad_demos tests.test_webui_viewer_contract tests.test_webui_cad_shell
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-parameter-feedback-JkjmcA/pycache /opt/anaconda3/bin/python3 -m py_compile tcad_simulator.py tools/*.py
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-parameter-feedback-JkjmcA/pycache /opt/anaconda3/bin/python3 tools/run_process_cad_baseline.py --grid 128 --output /tmp/tcad-parameter-feedback-JkjmcA/grid128.json
git diff --check
```

### 真实浏览器

服务和配方均在 `/tmp/tcad-parameter-feedback-JkjmcA/`，12×12×48／10 nm；
通过 CUA 操作本地 8828 页面，未访问正式工程。证据中的实体为初始化后的硅，
本次只测输入与提交，没有执行工艺构建。

- 修复前负厚度只出现笼统提示（`browser-before.jpg`）。修复后中文负厚度显示
  「必须大于或等于 0 nm」，确认禁用；260 px 面板内容宽度 235 px，与 scrollWidth
  相同。错误描述 ID 指向同一个 `.parameter-field`（`browser-zh-minimum.json/jpg`）。
- 无效 raw `-1` 和名称 `Draft retained` 在切 µm、EN 后保持；错误更新为 `0 µm`。
  切换到另一候选再返回仍保留（`browser-en-minimum.jpg` 与主审 CUA 原始输出）。
- 91° 的错误切 rad 后显示完整 `1.5707963267948966 rad` 上限，未截为 1.57。
  内容无横溢出，控件／错误文本无越界，隐藏候选 display 为 none、rects 为 0
  （`browser-rad-260.json/jpg`）。中文版长上限也自然换行（`browser-final-zh.jpg`）。
- 改为 1.5 rad 后 alert 数为 0、aria-invalid 为 false、错误描述移除，确认恢复可用
  （`browser-corrected.json`）；确认后正式参数为 1.50 rad、状态 Dirty
  （`browser-confirm.txt`）。普通参数区输入 2 rad 同样显示完整上限并正确关联
  （`browser-ordinary.json`），修正和离开单位控件后按既有流程保存。
- 新增 Etch 弹窗负深度显示具体原因、同字段关联和禁用确认（`browser-add.json/jpg`）；
  项目设置负厚度对应中文原因并禁用确认（`browser-project.json/jpg`），均取消未应用。
  数值改为 `bad` 显示「请输入有限数值」（`browser-finite.txt`）。
- 浏览器 warn／error 为空（`browser-console.json`）。请求次数和 canonical payload
  由组件集成测试验证，没有把截图当作网络抓包。此次不重测上一轮已验收的 200% 布局。
- 临时页面已关闭，服务优雅退出 0，8828 无监听；正式项目、几何和用户服务未改。

### 复审

独立 SPEC 审查完整 `bf3125c..5515717`，最终 **APPROVE**，BLOCK／NB 均无。
审查员独立读取代码、原始测试日志、浏览器 JSON／截图和确认记录，浏览器门禁闭合。
首轮 QUALITY 先批准，随后主审发现边界下溢问题；独立审查确认 BLOCK-001 并撤回
该批准。以下修复与增量审查取代首轮的最终交付结论。

### BLOCK-001：单位换算下溢

真实旧 Etch 的侧壁角下限是 `math.nextafter(0,1)`，即 `5e-324°`；既有单位函数
换成 rad 后会得到有限值 0，不抛异常。原 helper 因此误示「≥0 rad」，但原校验器
仍拒绝输入 0。Target depth、Nominal rate 的相同极小值也可能遇到该问题。
复现见 `underflow-diagnostic.txt`，未改变真实校验边界。

修复提交 `cd8481d`：仅在呈现 helper 中检测非零原阈值换算成零（含负零），回退
canonical 数字与正确单位；真正零边界仍显示当前单位。没有修改 units 算法或 validator。
双语 helper 回归覆盖正 minimum、负 maximum、真正零；真实 AddStepDialog 测试使用
旧 Etch 无 `spec.units` 的元数据，输入 0 rad 时提示 `5e-324°`、保持非法标记、
正确错误关联、确认禁用和零提交。

| 修复后检查 | 结果 | 证据 |
| --- | --- | --- |
| helper RED | 4 项预期失败（正 min／负 max × 双语） | underflow-red.log |
| 实际组件 RED | 2 项预期失败（双语） | underflow-component-red.log |
| 最终五文件专项 | 231 PASS | underflow-green.log |
| 实现者最终完整前端 | 44 文件、808 PASS | underflow-full.log |
| 主审最终独立完整前端 | 44 文件、808 PASS，25.64 s | root-final-frontend.log |
| 最终类型检查／构建 | 实现者与主审退出码均为 0 | underflow-typecheck.log／underflow-build.log；root-final-typecheck.log／root-final-build.log |

组件 RED 通过暂时移除仅新增下溢判断验证，随后原样恢复；原日志保留，不把修复前
旧测试通过冒称捕捉到了该边界。后端文件未改，前述 207 项及 grid128 结果继续适用。

主审再次启动同一隔离服务，通过实际导入 `legacy-recipe.json` 取得真实旧 Etch 的
工厂元数据，选择 rad 并输入 0；中英文均提示 canonical 下限 `5e-324°`，
`aria-invalid=true`，raw 与单位保持（`browser-underflow.json`、
`browser-underflow-en.jpg`、`browser-underflow-zh.jpg`）。未运行旧物理工艺；控制台
仍为空，页面关闭，服务再次退出 0 且 8828 无监听。

独立 SPEC 已增量审查 `5515717..cd8481d`，补读极小值浏览器证据后最终 **APPROVE**，
BLOCK-001 精度门禁关闭，无未解决 BLOCK／NB。QUALITY 原审查员在增量补审时遇到
用量限制，不能视作通过；新的独立审查员重新读取完整 `bf3125c..cd8481d` 差异，
重点复核新增修复与 BLOCK-001，最终 **APPROVE**，无未解决 BLOCK／NB。
独立五文件专项 231 PASS、4.85 s、退出码 0（`quality-rereview.log`），
并核对完整回归、RED 和真实界面证据。最终 diff check 通过，生产代码自 `cd8481d`
后未变，仅提交本验收记录。

| 架构边界 | 最终结论 | 依据 |
| --- | --- | --- |
| React | PASS | 仅文案呈现与字段错误关联 |
| Three.js | PASS | Viewer、相机与渲染未改 |
| Python | PASS | 应用层、Recipe 和执行链路未改 |
| C++ | PASS | 科学引擎与依赖未改 |
| Layout | PASS | 版图、gdstk、KLayout 契约未改 |
| ViennaPS | PASS | 可选适配与回退未改 |
| canonical | PASS | 真实参数、校验规则、单位换算算法和请求载荷不变 |
| scope-tests-storage | PASS | 范围最小、断言未削弱、隔离验收完成、正式数据未改 |

已知限制：本段只展示已有校验原因；不新增跨字段规则，不预测未来几何，不翻译任意
服务端原始异常。超长但有限的阈值保留完整数值以免误导合法边界；使用既有换行样式。
本记录阶段未合并或推送，main 保持 `bf3125c`；第三方 origin 未访问。
