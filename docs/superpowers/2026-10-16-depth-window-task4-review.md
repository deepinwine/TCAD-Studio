# 深度区间刻蚀任务 4 验收记录

日期：2026-10-16。分支：`codex/depth-window-etch`。
代码范围：`3950e19..661156b2cdcc256da2a2852af49a8ab516758674`。
本轮交付检查器、独立单位与后端只读执行参考，不包含任务 5 浏览器验收或发布。

## 结论

Verdict：APPROVE。独立 SPEC → QUALITY 通过，BLOCK-001、BLOCK-002 已关闭，
无新增 NB，有序修复清单为空。主审全量验证已通过，任务 4 完成；此结论不等于
已合并、已发布或已更新运行中的界面。

| 八项边界 | 结果 |
| --- | --- |
| 固定技术栈与职责隔离 | PASS |
| Recipe → factory → execute → ProcessModel | PASS |
| Python 单次解析、成功提交后发布 | PASS |
| React／Three.js 不计算工艺几何 | PASS |
| 既有 API 与可选加法契约 | PASS |
| 条件参数、旧服务与 canonical 单位兼容 | PASS |
| 原子保存、草稿序号与结果可信生命周期 | PASS |
| 双语、测试及依赖范围控制 | PASS |

## 实现与复用

- 普通刻蚀保留深度、侧壁角；区间模式只显示当前参考方式的边界、距离、方向性和材料。
- 前端消费后端 `active_when` 的 AND 条件与工厂缺省，不把显式 null 当成缺失。
  检查器、添加／类型替换候选与保存／执行门禁使用同一活动字段判定。
- 每个长度独立选择 nm／µm，保存归一为 nm；方向性滑块和数字同步，中英文说明对等。
  非活动草稿保留并可随配方保存，但不参与当前模式的校验；重新激活坏值会明确阻塞。
- 条件参数按同一步的最新草稿原子提交，按序号清理已提交版本，保留写入期间的新草稿。
  无条件元数据的旧服务保留原单字段路径；未知字段不能借隐藏状态绕过校验。
- Python 只在真实输入上解析一次参考面，几何提交成功后才发布可选
  `execution_result.reference_z_nm`。结果不写入 Recipe、导出或保存文件；前端不猜高度。
  Fixed Z 不使用孔口参考；缺少可信执行结果时显示未解析。
- 沿用现有 add/set/import/run、历史与 Mask API，无新端点、执行器、依赖或几何算法。
  `/api/run/step`、`/api/run/to`、`/api/run/all` 的现有可选权威 recipe 由前端解析。

契约与命名 HTTP 测试见 `docs/ARCHITECTURE_TARGET.md`，决策延续 ADR-031。
真实 Python 工厂 fixture 的八项已独立核对：仅 Structure Etch 改动，其余七项不变。

## 复审闭环

| 发现 | 修复与回归 |
| --- | --- |
| BLOCK-001：成功 RunTo 后旧前缀错误遮住新参考 | `f3c5847` 仅清权威 recipe 中明确 done 的成功前缀错误；未证明成功的前缀、后缀及旧服务路径仍保守保留 |
| BLOCK-002：未知执行／恢复失败重新显示旧参考 | `090581d` 在执行开始时失效受影响的结果；`661156b` 补齐历史、Timeline、参数／类型／配方与 Mask 写入；无权威新结果不能复活旧值 |
| 主审全量暴露既有相机就绪竞态 | `9317d3d` 在 layout 阶段发布 runtime，避免控件可点击但运行时尚未初始化；即时交互与 StrictMode 先写确定失败测试 |
| 扩展结果失效后，项目设置误判配方已变化 | `661156b` 仅忽略只读 executionResult；真实参数、字段和顺序变化仍判 stale，空失效操作保留原数组 |

纯保存、导出、重命名、只读查询及取消不清有效参考。Mask Workbench 只在实际
保存／导入并应用写请求获准发出前通知对应步骤及后缀失效，不触发工艺重建。
新的权威执行结果可以恢复显示；全局错误不是永久隐藏参考值的开关。

实现者报告的 RED→GREEN 包括前缀错误、断网双恢复失败、六项即时视图交互、
恢复／输入写入矩阵、Workbench 写入及真实参考值触发的项目设置回归。
这些历史 RED 与下表独立实测分开记录；未删改旧测试、断言或超时。

## 验证证据

| 验证者与项目 | 实测结果 | 代码版本 |
| --- | --- | --- |
| 主审：完整前端串行测试 | 42 files，703 tests PASS，22.72 s | `661156b` |
| 主审：类型检查、生产构建 | 两项 exit 0 | `661156b` |
| 主审：最小依赖实际 CI 编译及 27 模块核心命令 | 编译 exit 0；593 tests，OK，13 skipped，159.251 s | `0b1a138` |
| 主审：grid128 基准 | 五个既有示例全部 ok:true，exit 0 | `0b1a138` |
| 主审：真实 HTTP → 实际 TS parser | 4 个步骤，参考 395 nm，条件元数据一致，exit 0 | 后端 `0b1a138`／前端 `661156b` |
| SPEC 首轮：HTTP 专项与 CI 契约 | 16 tests，OK，8.522 s | `0b1a138` |
| SPEC 复审：新增路径、App 与旧项目／Viewer 对照 | 152 tests PASS，3.73 s + 1.98 s | `661156b` |
| QUALITY：七个新增前端文件与 App／项目／Viewer 对照 | 10 files，188 tests PASS，2.37 s | `661156b` |
| QUALITY：真实 HTTP 专项及编译检查 | 12 tests，OK，8.394 s；编译 exit 0 | `661156b` |
| 实现者：最终完整前端、类型检查、构建 | 703 tests PASS，22.91 s；后两项 exit 0 | `661156b` |

`0b1a138..661156b` 未改后端、Python 测试、依赖、工具或 CI，已检查对应路径 diff
为空；后端验证证据未用旧结果代替新后端改动。最小环境为 macOS arm64、Python
3.13.5，仅装 CI 依赖及其传递依赖，无 Qt、gdstk、ViennaPS、ViennaLS、Numba。
命令从 workflow 的 Compile check 和 Core backend tests 提取，检查实际退出码。

HTTP 使用临时隔离会话：10 nm 网格、300 nm 孔、孔口 395 nm、区间 `[195,295)`、
距离 30 nm、方向性 0，实际去除 680 个体素。原始响应通过 Vite SSR 加载仓库中的
真实 TS schema 解析，核对参考值、活动条件和先前步骤没有虚构的执行结果，非手写响应。
Python 设置 `TCAD_SKIP_QT=1 MPLBACKEND=Agg`，缓存与基准输出位于 `/tmp`。

前端可串行复跑：

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
```

## 风险、限制与下一段

本轮涉及参数队列及运行状态，回归风险中等；既有 JSDOM canvas／navigation 诊断、
Python 日志 ResourceWarning 和构建包体积警告未被压制。Node 为 26.0.0，CI 配置为
Node 22；未运行远端 Linux CI、其他 Python 版本或 Windows 真机。

任务 5 仍需真实浏览器验证 300 nm 通道的局部扩腔、固定 Z 等价区间、0／100 方向性
及无有效删除错误、X/Y/Z 剖面、真实 3D 交互和参考面显示。单元测试的 DOM／runtime
桩不能替代真实浏览器或显卡验收；当前记录不宣称 UI 已发布。

所有者已另行创建独立公开仓库 `deepinwine/TCAD-Studio`，本地 remote 为 `studio`。
本轮未合并、推送或重启用户服务；main 与 studio/main 保持 `27592de`，远端功能
分支仍为 `3950e19`，已通过只读远端查询核对。未来发布需先完成任务 5，并由所有者
确认目标和合并；旧 backup 与第三方 origin 未被改写，不将旧计划的 backup 发布
约定视作新仓库的自动推送授权。
