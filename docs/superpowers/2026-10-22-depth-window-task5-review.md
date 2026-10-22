# 深度区间刻蚀任务 5 验收记录

日期：2026-10-22。分支：`codex/depth-window-etch`。
代码审查范围：`31770cc3a9485b37aa260b6ea9836482ba78009e..7eaf24aea0a24afaa4eb215bd66e0a56cd57024b`，
13 文件、357 增／17 删。本记录及计划状态更新另作纯文档提交。

## 状态

真实浏览器验收和最终回归已完成。独立 SPEC → QUALITY 均为
`APPROVE WITH NON-BLOCKING COMMENTS`，无 BLOCK，唯一 NB 为本轮 diff 外的既有提示问题。
验收不代表已合并、已推送或已更新用户运行界面。

## 验收中发现并修复的问题

| 提交 | 真实故障 | 最小修复与回归 |
| --- | --- | --- |
| `17f1c2f` | 合法裸 JSON 配方被二进制护栏拒绝，导出及项目设置不可用 | `exportRecipe` 复用既有 `apiBlob`；保留 `apiBinary` 拒绝 JSON 的行为和后端 Content-Type。真实 Response 测试和项目设置 API 集成测试覆盖导出、修改、导入及旧字段保留 |
| `cc117e5` | 顶视／前视方向与 canonical Z 向上约定不一致 | 仅修正四个方向常量；Top 为 +Z、Bottom 为 −Z、Front 为 −Y、Back 为 +Y。真实相机和 OrbitControls 测试覆盖极点、屏幕方向、投影切换、适应窗口、重复视角与指针拖拽，仅 Renderer 为桩 |
| `7eaf24a` | 合理的几何拒绝仅显示“未预期错误”，无法调整参数 | 已知几何／预算拒绝使用 `DepthWindowGeometryError`，在既有 execute 边界适配为 `EtchParameterError`，经原事务返回固定 code/path；前端白名单映射七类中英文原因与调整建议 |

第三项不改变接触面、距离预算、候选计算或事务算法。未知异常不按消息字符串归类，
原始 message、suggestion 和敏感路径仍不直接显示。已知失败的 `error_type`
改为既有 `EtchParameterError`，属于明确记录的诊断行为变化。
无新增端点、依赖或物理模型；错误码契约见 `docs/WEBUI_RUNTIME.md`，延续 ADR-031。

实现者保留 RED→GREEN 证据：导出集成测试 3 项先失败；相机方向测试 4 项先失败；
七类 UI 错误映射先失败，真实 HTTP 缺 code/path 出现 6 个失败。
这些历史 RED 与下文独立实跑的最终 GREEN 分开记录。

## 真实浏览器与独立几何核对

全部数据为隔离合成验收数据，不使用用户配方或正式存储。浏览器从界面创建：

- 域为 `12×12×48`，每格 `10 nm`，Initialize Wafer 厚 `400 nm`。
- 不可变版本化版图 revision 1：矩形 `x=45 nm`、`y=45 nm`、宽／高各 `30 nm`。
- 普通刻蚀建立 `300 nm` 竖直通道；孔底为 `95 nm`，孔口参考为 `395 nm`。
- 区间刻蚀起始 `100 nm`、终止 `200 nm`、距离 `30 nm`、方向性 0。
  成功后只读参考为 `395 nm`，对应绝对高度 `[195,295)`。

X=0.5、Y=0.5 的真实裁切显示窄通道中段扩腔和实体截面；Z=0.62 显示区间内部
扩大的孔洞及实心孔沿。Fixed Z 设置 `195/295 nm` 得到相同结构，且明确不使用
孔口参考。改变方向性为 100 后，纯竖壁没有有效删除，真实请求失败并回滚；
中英文同时可见具体原因、`params.directionality_percent`、回滚说明及参考未解析。
改回 0 后重新成功并显示 `395 nm`。

实际拖拽可旋转几何，正交／透视切换有效，顶视沿 +Z 观察 XY 平面。
起始深度单独切至 µm 显示 `0.10`，终止深度仍为 `200 nm`，没有联动改变其他单位。
最终浏览器控制台没有记录 error/warn。截图不是由 DOM 测试桩或人工绘制生成。

独立 HTTP 验收使用固定矩形接触面的解析距离，不调用待测 `resolve_window`、
`window_etch_candidate` 或共享的面片 oracle。共 864 次切片 GET，核对 legacy
与 display 两类响应的全轴 material/owner；另含偏心 XY 开口和三来源层，避免对称
fixture 掩盖轴交换。区间内删除 `680` 个体素，10 层每层 `68` 个；带外材料与
owner 不变，删材 owner 清零。Fixed Z 全数组等价，方向性 100 失败后两数组不变，
无有效 execution_result。截图与这些数组断言互为补充，不把截图当逐体素证据。

本机证据位于 `/tmp/tcad-depth-task5-KbL5T1/`，未提交运行时数据：

| 证据 | 文件 |
| --- | --- |
| 最终成功及 395 nm、中文／英文 | `browser-final-opening-x-iso-zh.jpg`、`browser-final-opening-x-iso-en.jpg` |
| 最终 Y／Z 实体剖面 | `browser-final-opening-y-iso.jpg`、`browser-final-opening-z-iso.jpg` |
| 明确失败、回滚和参考失效 | `browser-visible-error-zh.jpg`、`browser-visible-error-en.jpg` |
| 顶视、实际拖拽及正交 | `browser-final-top.jpg`、`browser-final-dragged.jpg`、`browser-final-orthographic.jpg` |
| 最终后端结果、源码哈希与完整命令 | `backend-final-result.json`、`backend-final-core.log` |
| 基准及独立 HTTP 结果 | `backend-final-grid128.json`、`backend-final-http-independent.json` |
| 最终前端原始日志 | `frontend-final-tests.log`、`frontend-final-typecheck.log`、`frontend-final-build.log` |

早期 `browser-final-error-*.jpg` 未把 Parameters 面板拍入可见区域，不能用作错误提示
可见性的证据，已由 `browser-visible-error-*.jpg` 补齐。临时文件不保证跨机器可用。

## 最终验证

| 验证者／项目 | 实测结果 | 版本 |
| --- | --- | --- |
| 独立后端验收：实际 workflow Compile check | 43 个目标，exit 0 | `7eaf24a` |
| 独立后端验收：实际 27 模块 Core backend tests，含 AGENTS 五模块 | 595 tests，OK，0 skipped，298.754 s | `7eaf24a` |
| 独立后端验收：grid128 | 五例全部成功，39 个语义检查全部 true，exit 0 | `7eaf24a` |
| 独立后端验收：解析 HTTP oracle | 864 次切片查询及等价／回滚断言通过，exit 0 | `7eaf24a` |
| 主审：完整前端串行测试 | 43 files，723 tests PASS，25.37 s | `7eaf24a` |
| 主审：类型检查、生产构建 | 两项 exit 0 | `7eaf24a` |
| SPEC：两个区间 Python 专项 | 60 tests，OK，0 skipped，11.340 s | `7eaf24a` |
| SPEC：四个变更前端文件 | 66 tests PASS，1.72 s | `7eaf24a` |
| SPEC：Python 编译及范围 diff 检查 | exit 0 | `7eaf24a` |
| QUALITY：两个区间 Python 专项 | 60 tests，OK，0 skipped，11.660 s | `7eaf24a` |
| QUALITY：四个变更前端文件 | 66 tests PASS，589 ms | `7eaf24a` |
| QUALITY：四个 Python 文件编译及范围 diff 检查 | exit 0 | `7eaf24a` |

后端验收开始／结束 HEAD 相同、工作树干净，报告记录的全部相关 Python、测试和
workflow 文件 SHA256 未变；主审另核对四个修改 Python 文件的当前哈希一致。
专项已包含在全量内，不将重复运行的数量相加当成独立测试数。

前端可串行复跑：

```bash
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
```

Python 使用 `/opt/anaconda3/bin/python3`，设置 `TCAD_SKIP_QT=1 MPLBACKEND=Agg`，
`PYTHONPYCACHEPREFIX` 和基准输出在 `/tmp`。完整后端命令直接从现有 workflow
提取，包含编译和 27 个核心模块；基准使用 `tools/run_process_cad_baseline.py --grid 128`。

## 独立审查与后续项

SPEC：APPROVE WITH NON-BLOCKING COMMENTS，无 BLOCK，八项边界全部 PASS。
QUALITY：APPROVE WITH NON-BLOCKING COMMENTS，无 BLOCK，八项边界全部 PASS。
两位审查者独立阅读实际 diff、调用链、测试、原始结果及可见截图；未改代码或操纵
主审服务。最终结论支持任务 5 的浏览器／回归验收完成，发布项仍待所有者选择。

| 八项边界 | 结果 |
| --- | --- |
| 固定技术栈与职责隔离 | PASS |
| canonical Recipe → factory → execute → ProcessModel | PASS |
| Python 几何与成功提交后发布参考 | PASS |
| React／Three.js 不计算工艺几何，相机仅本地渲染 | PASS |
| 旧 Recipe／Standard／物理路径及既有 API 兼容 | PASS |
| 单位、条件参数与固定安全双语提示 | PASS |
| 候选、owner、回滚及结果可信生命周期 | PASS |
| 依赖、端点、测试与文档范围控制 | PASS |

NB-001（本轮 diff 外）：`frontend/src/components/StepStructureBar.tsx` 未选新增类型
时 `factory=''`，`available=false` 会误显示“模板不可用”。实际选择 Etch 后立即
消失且可添加，不是后端目录缺失。作为后续独立小任务修复提示条件并增加回归；
不因本次验收顺带重构步骤编辑器。

## 风险、限制与发布边界

回归风险低至中等：标准相机方向为常用交互，诊断错误类型及导出客户端路径有变化，
由真实相机、HTTP 原子失败、安全文案、项目设置集成及完整回归覆盖。
现有 Python 日志 ResourceWarning、JSDOM canvas/navigation 诊断、938.86 kB
构建包体积警告未被压制，也未通过改 timeout 或降低断言让测试通过。

环境为 macOS arm64、Anaconda Python 3.13.5（带可选库）、Node 26.0.0。
本轮不是最小依赖 CI，没有验证远端 Linux、Windows 真机、其他 Python 版本或 CI
Node 22；不能把 0 skipped 解读为所有平台已覆盖。几何方向性仍是 CAD 代理，不是
温度、气体、压力、时间驱动的工艺预测或 foundry 校准结果。

本轮仅启动／重启 `/tmp` 隔离浏览器服务，不操作用户正式存储或原服务。
未合并、推送、清理功能工作树或改写第三方 origin。只读核对：本地 main 与远端
`studio/main` 均为 `27592de`，远端 `studio/codex/depth-window-etch` 仍为 `3950e19`。
后续发布目标为独立公开仓库 `deepinwine/TCAD-Studio`，须先由所有者明确选择合并／PR；
发布前保存并核对当前用户配方，不把旧 backup 约定视为新仓库的自动推送授权。
