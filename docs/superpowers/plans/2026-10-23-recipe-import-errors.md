# 本地配方文件错误反馈实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development；单一实现者，完成后依次 SPEC → QUALITY 审查。步骤使用复选框记录。

**目标：** 本地配方读取／JSON 语法错误可见、可重试，失败不改当前工程。

**架构：** Toolbar 保有本地错误类别，复用 ErrorNotice 与语言目录。文件读取与 JSON
解析分别捕获，成功后调用原 actions.importRecipe；provider、API 和后端保持不变。

**技术栈：** React、TypeScript、Vitest、Testing Library；不增加依赖。

## 上下文与职责

所有者已确认 `specs/2026-10-23-recipe-import-errors-design.md`，无需再次询问设计。
起点 `2014c2b`，规格提交 `971bbbe`；分支 `codex/recipe-import-errors`。
工作树 `/Users/jiajia/.config/superpowers/worktrees/TCAD-Simulator/codex/structure-reliability`。
证据 `/tmp/tcad-recipe-import-errors-bQVz3o/`，运行时数据不提交。

- `frontend/src/components/Toolbar.tsx`：本地导入错误状态、异步文件回调和既有错误组件。
- `frontend/src/i18n/catalogs.ts`：只新增两组对等文件错误文案；标题复用 `error.operationTitle`。
- `frontend/src/components/Toolbar.test.tsx`：复用 `apiStub`、`initView`、`step`、`deferred`、`stubViewerRuntime` 和真实 App；追加行为回归，不 mock provider、Toolbar 或 ErrorNotice。
- 本计划：主审记录验证与审查；实现者不修改计划或规格。

## 任务 1：失败测试 → 最小实现 → 提交

- [x] 基线 Toolbar 专项 18 tests PASS，1.78 s；`baseline-toolbar.log`。
- [x] 实现者先完整读取 AGENTS.md、规格约束和 TDD 技能；只写以上三个前端文件。
- [x] 在 Toolbar.test.tsx 增加本地失败场景，以下为最小测试的完整形状：

```tsx
it('损坏 JSON 可见提示，当前配方与时间线不变', async () => {
  const api = apiStub();
  const mount = vi.fn();
  const dispose = vi.fn();
  render(<App api={api} viewerRuntimeFactory={() => ({...stubViewerRuntime(), mount, dispose})} />);
  fireEvent.click(await screen.findByRole('button', {name: '配方操作'}));
  const input = screen.getByLabelText('导入配方文件') as HTMLInputElement;
  await screen.findByRole('button', {name: '恢复步骤 1'});
  const file = new File(['{broken json'], 'broken.json', {type: 'application/json'});
  fireEvent.change(input, {target: {files: [file]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('配方文件不是有效的 JSON，请检查文件后重试。');
  expect(api.importRecipe).not.toHaveBeenCalled();
  expect(api.setStep).not.toHaveBeenCalled();
  expect(api.saveRecipe).not.toHaveBeenCalled();
  expect(api.runStep).not.toHaveBeenCalled();
  expect(api.runTo).not.toHaveBeenCalled();
  expect(api.runAll).not.toHaveBeenCalled();
  expect(screen.getByRole('option', {name: /Step 1/})).toBeInTheDocument();
  expect(screen.getByRole('button', {name: '恢复步骤 1'})).toBeEnabled();
  expect(mount).toHaveBeenCalledTimes(1);
  expect(dispose).not.toHaveBeenCalled();
});
```

按实际可访问角色定位步骤：已有 ProcessFlowPane 测试使用的真实 option；若文案与
上例不同，先查组件而不是降低断言。时间线先等既有异步 bootstrap 完成，再记录
API 调用计数；失败后读请求数量也不增加。不要使用全局 status 冒充指定状态。

- [x] 损坏 JSON 与空字符串分别测试；至少一例切 EN 后同一错误显示英文，再切回中文。
- [x] 以当前 File 的 `text` 方法边界拒绝模拟读取失败，不 mock JSON.parse：

```tsx
const file = new File(['{}'], 'unreadable.json', {type: 'application/json'});
vi.spyOn(file, 'text').mockRejectedValue(new Error('/private/secret-file.json'));
```

验证读取失败专属提示，不包含原始异常／路径／文件内容；JSON 提示同样不包含输入。
spy 用现有清理或 finally 恢复，不污染其他用例。

- [x] 增加无文件选择不改变旧错误和配方、同一 File 再选两次仍可反馈；读取新文件开始即清除旧错误（可用 deferred<string>），失败后导入有效 JSON 只请求一次且旧提示消失；再失败仍可显示。
- [x] 有效 JSON 但 api.importRecipe 拒绝 TcadApiError(code='invalid_recipe') 时，保留既有全局「配方无效。」错误，不出现文件读取／语法错误。保留当前成功测试，不修改 provider 错误处理。
- [x] 使用不可保存的非法参数草稿验证文件失败不清空草稿；对 input 直接触发 change 只用于检验错误边界，不声称禁用按钮能正常打开。另检查有效 JSON 在该状态仍被 provider 门禁拒绝、不发 API。
- [x] 运行专项并核对 RED。预期 alert 缺失造成断言失败；旧回调产生的未处理拒绝也如实记录，不添加全局监听吞掉或关闭 Vitest 错误捕获。若出现 label／fixture 报错先修正。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism src/components/Toolbar.test.tsx
```

- [x] 最小生产实现：新增 ErrorNotice import，组件内增加如下状态和函数；不改 provider、全局 error 或请求协议。

```tsx
const [importFileError, setImportFileError] = useState<'read' | 'json' | null>(null);
const importFile = async (file: File) => {
  setImportFileError(null);
  let content: string;
  try {
    content = await file.text();
  } catch {
    setImportFileError('read');
    return;
  }
  let recipe: unknown;
  try {
    recipe = JSON.parse(content);
  } catch {
    setImportFileError('json');
    return;
  }
  await actions.importRecipe({recipe});
};
```

文件 input 仍使用既有标签和 accept。回调保留清空值，取消不触发 importFile：

```tsx
onChange={event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file !== undefined) void importFile(file);
}}
```

在 `recipe-tools` 关闭标签之后、草稿提示之前显示本地错误，不能跟随折叠隐藏：

```tsx
{importFileError !== null && <ErrorNotice
  title={t('error.operationTitle')}
  message={t(importFileError === 'read' ? 'toolbar.importFileReadError' : 'toolbar.importFileJsonError')}
/>}
```

目录新增：中文读取「无法读取配方文件，请重新选择文件后重试。」；中文 JSON
「配方文件不是有效的 JSON，请检查文件后重试。」；英文分别为
`Unable to read the recipe file. Select the file again and retry.` 和
`The recipe file is not valid JSON. Check the file and retry.`。
不显示异常字符串，不改已有 `error.invalidJson` 服务响应文案。

- [x] 专项 GREEN 后串行完整前端、类型检查、构建和 diff 检查；记录准确数量和退出码，不改依赖或超时。

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
git diff --check
```

- [x] 自审后提交 `fix(配方导入): 显示本地文件错误并保留安全重试`；报告 SHA、RED/GREEN、文件、风险，并释放 npm 锁。

## 任务 2：主审验收与独立复审

- [x] 主审独立复跑完整前端、类型检查、构建，不与其他 npm 并行；运行 AGENTS 五模块、编译和 grid128（5 demo、39 checks）。Python 环境为 TCAD_SKIP_QT=1、MPLBACKEND=Agg、PYTHONPYCACHEPREFIX 指向证据目录，解释器 /opt/anaconda3/bin/python3。
- [x] 仅创建临时存储的结构会话，浏览器上传本轮生成的坏 JSON 观察双语提示，取消保持，之后有效 JSON 重试；记录真实截图与 console，停止自建服务。读取错误用单测模拟，不声称真实 OS 文件故障已验证。
- [x] 新鲜 SPEC 审查完整范围通过后，再由独立 QUALITY 审查最终整体代码；发现问题交原实现者修复并复审。
- [x] 主审更新本计划中的实际结果、环境限制、八项边界和风险；提交纯验收文档，保留分支，不自动合并或推送。主分支的用户未跟踪文件和其他服务均不动。

## 计划自检

已覆盖规格全部七项行为、请求前失败与服务端失败的区分、双语与重试、真实组件
测试、保护已有状态和门禁。未引入大小预算、读取进度、预览、取消 API 或跨工程
调度。实现函数／错误键与测试对象均在本计划定义，测试角色以当前组件核对为准。

## 实测与验收记录（2026-10-24 收尾）

所有者于书面规格提交后明确回复「确认 继续」。实现提交为
`6206e078a133ca061dc9212efa2005a17ebc74b5`，只修改上述 3 个前端文件，净增 9 个测试。
没有后端、请求协议、配方格式、全局错误映射、Viewer 或几何算法变更。

证据目录为 `/tmp/tcad-recipe-import-errors-bQVz3o/`，不提交运行时数据。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 基线 Toolbar | 18 tests PASS，1.78 s | `baseline-toolbar.log` |
| 有效 RED（最终夹具） | 8 个缺失 alert 失败、19 个通过；原回调 8 个未处理拒绝 | `red-final.log` |
| 修复后 Toolbar | 27 tests PASS，2.29 s，无未处理拒绝 | `green-toolbar.log` |
| 实现者完整前端 | 43 个文件、756 tests PASS，24.41 s | `green-all.log` |
| 主审独立完整前端 | 43 个文件、756 tests PASS，24.40 s | `root-frontend.log` |
| 主审类型检查／生产构建 | 均退出 0 | `root-typecheck.log`、`root-build.log` |
| 主审最终收尾完整前端 | 43 个文件、756 tests PASS，25.59 s | `final-frontend.log` |
| 主审最终类型检查／构建 | 均退出 0 | `final-typecheck.log`、`final-build.log` |
| 主审 AGENTS 五模块 | 207 tests，91.724 s，OK | `backend.log` |
| 主审 Python 编译 | `tcad_simulator.py tools/*.py` 退出 0 | `compile.log` |
| 主审 grid128 | 5 个 demo、39 项检查全 true，退出 0 | `grid128.json`、`grid128.log` |

RED 没有关闭 Vitest 的错误捕获：7 个 JSON SyntaxError 和 1 个 File.text 拒绝属于
原缺陷，不能把这些计为 8 个额外测试。执行结果保留的前置 250 nm 断言在旧代码
同样成立，真正的新增失败是本地 alert 缺失。补强夹具后用 apply_patch 临时恢复
旧回调再 RED，随后恢复同一实现并 GREEN；没有降低断言或增加超时。

## 真实浏览器

使用独立临时存储的 Structure 会话，`127.0.0.1:8824`，domain 为 `12×12×48`、
体素为 10 nm。只导入测试文件，没有运行或构建工艺，没有操作用户工程及正式存储。

1. 修复前，选择坏 JSON 后界面不变，console 出现 SyntaxError；`browser-before.jpg`。
2. 修复后，坏文件显示中文 JSON 专属提示，切 EN 后即时切换英文；
   `browser-error-zh.jpg`、`browser-error-en.jpg`。同一坏文件再次选择仍可处理。
3. 有效文件重试成功，旧提示消失。含命名沉积步骤的测试文件导入后，左侧显示
   `Import retry layer`，右侧显示 Silicon Dioxide、20.00 nm；
   `browser-retry-success.jpg`。这是配方导入，不把未构建沉积误称为已有沉积几何。
4. 再导入坏文件，命名步骤、选择、材料与 20.00 nm 保留；收起配方操作后错误仍可见，
   `browser-final-error-preserved.jpg`。最终新验收 tab 的 console warn/error 为空。

浏览器自动化的 file chooser 要求至少一个文件，拒绝空列表，因此没有实测原生
选择器的「取消」；空 files 保持由真实 App 单测覆盖。OS 读取失败也仅以 File.text
拒绝模拟，不冒称真实文件系统故障已验证。自建服务正常关闭，8824 端口无监听，
临时 tab 已关闭。截图不代替 API 计数与状态断言。

## 审查与限制

SPEC：APPROVE，无 BLOCK／NB，八项边界 PASS。独立核对完整差异、provider 门禁、
RED／GREEN 及主审原始日志；没有重复运行 npm。

首位 QUALITY 审查者因模型额度中断，没有形成签核，不计为通过。替代审查者重新
独立核对完整 feature 后正式 APPROVE，无 BLOCK／NB；独立 Toolbar 专项为
27/27 通过、2.33 s、退出 0，日志 `quality-final-toolbar.log`。未将核对的主审
全量与浏览器证据冒称为审查者重新执行。两轮均确认八项边界如下：

| 边界 | SPEC / QUALITY | 依据 |
| --- | --- | --- |
| React | PASS / PASS | 只改变本地文件错误呈现，保留 provider |
| Three.js | PASS / PASS | Viewer 未改；挂载、释放和加载次数有回归 |
| Python 兼容 | PASS / PASS | 后端与既有兼容调用链未改 |
| C++ | PASS / PASS | 无引擎、绑定或依赖变更 |
| Layout / gdstk | PASS / PASS | 无版图路径或可选依赖变更 |
| ViennaPS 可选性 | PASS / PASS | 未改变后端选择与依赖边界 |
| Canonical / 序列化 | PASS / PASS | JSON 语义交既有服务端校验，无格式或单位变更 |
| 范围 / 测试 / 存储 | PASS / PASS | 仅本轮前端与文档；旧断言保留，正式存储不动 |

回归风险低；本地失败仅改变 Toolbar 的错误类别，不触发配方、时间线、执行结果或
模型失效。有序修复清单为空。主审最后复跑完整前端、类型检查和构建均通过，
前端源码仍与已审查的 `6206e07` 一致；后续仅提交本验收文档，不改变运行代码。

环境为 macOS arm64、Anaconda Python 3.13.5、Node 26.0.0。Windows/Linux 真机、
最小依赖环境和 CI Node 22 未在本轮验证。保留既有 JSDOM canvas/navigation、
Vite 大包及 Python ResourceWarning，不将这些提示误写为本轮新增未处理异常。

文件预算、读取进度、独立取消、预览确认和跨工程读取调度不在本轮范围内。
服务端已接收请求后的失败、网络不确定性及执行结果失效继续使用既有 provider
语义。本轮仅修本地文件错误边界，不承诺新的导入事务或物理能力。

尚未合并或推送；`main` 与本地跟踪 `studio/main` 仍为 `2014c2b`。
