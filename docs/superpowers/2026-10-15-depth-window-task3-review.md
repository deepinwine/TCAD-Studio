# 深度区间刻蚀任务 3 验收记录

日期：2026-10-15。分支：`codex/depth-window-etch`。
范围：`6dd7562..9c08516901f9db986ff5d5c6e14813e93e99c7b7`。
本轮验收既有参数与几何实现的 HTTP 兼容、持久化及失败事务，不包含任务 4、5。

## 结论

Verdict：APPROVE。独立 SPEC → QUALITY 复审通过，BLOCK-001 已关闭；无待修
BLOCK 或 NB，有序修复清单为空。八项边界结果如下。

| 边界 | 结果 |
| --- | --- |
| 固定技术栈 | PASS |
| Recipe → factories → execute → ProcessModel | PASS |
| canonical 实现与最小差异 | PASS |
| 前端／Three.js 不计算工艺 | PASS |
| Structure 几何与物理算法隔离 | PASS |
| 既有 API、执行器和状态协议复用 | PASS |
| 加法契约、旧配方兼容与 ADR | PASS |
| 测试交付及独立验证 | PASS |

`8c02796` 新增 9 个真实隔离 worker HTTP 测试、M2 参数契约、ADR-031，并将
区间单元与 HTTP 两模块纳入 CI 及其必需模块断言。`9c08516` 仅补强恢复测试。
合计 5 文件、453 行新增；本轮没有修改生产代码、新增端点或改变几何算法。

## 覆盖与复审修正

复用 add/set/import/export/run、命名保存加载、autosave、Timeline 及会话恢复。
覆盖两种参考方式、0%／50% 逐体素独立面片 oracle、带外／非目标材料／来源
保护、未来 Fill/CMP 的预检边界、旧 Standard／物理 Etch、全工厂类型替换的
稳定 ID 与复制新 ID，以及非法候选、无通道、100% 纯竖壁、内存／访问预算失败。
执行失败允许既有当前步骤 error/log 语义，不发布候选或成功快照。

BLOCK-001 是测试盲区：命名加载后仅检查 ID 和配方绑定，后续 autosave 恢复
可以掩盖丢失草稿或错误模型。主审仅在临时会话命名加载后破坏一个体素，旧测试
仍通过；质量评审独立注入命名加载丢失草稿，也确认旧测试漏检。

补丁在 import/run、named load、autosave load、restart 四阶段立即比较全部
参数及逐字段类型、完整 step IDs、grid、owners、来源表与配方绑定，保留旧断言。
主审独立注入 named/grid、named/True→1、autosave/grid、autosave/owners 四类
故障，均立即触发一个预期 AssertionError、零 errors；注入后只读取一次 init，
未进入下一恢复。去掉故障后同一测试通过（1 test，1.373 s）。SPEC 和 QUALITY
也分别重做了草稿故障验证。故障不写入生产代码或正式用户数据。

## 验证证据

所有 HTTP 会话和输出均使用临时目录，不使用或重启用户服务。Python 设置
`TCAD_SKIP_QT=1 MPLBACKEND=Agg`，pycache 位于 `/tmp`。

| 验证 | 结果 | 代码版本 |
| --- | --- | --- |
| 主审：最小依赖实际 CI 编译及 27 模块核心命令 | 编译 exit 0；590 tests，OK，13 skipped，190.094 s | `9c08516` |
| SPEC：HTTP 与 CI 契约两模块 | 13 tests，OK，6.659 s | `9c08516` |
| QUALITY：相同两模块 | 13 tests，OK，8.483 s | `9c08516` |
| 主审：新测试文件编译及全段 diff check | exit 0 | `9c08516` |
| 主审：HTTP facade 补充回归 | 6 tests，OK，3.011 s | `8c02796` |
| 主审：grid128 基准 | 五个示例全部 `ok:true`，exit 0 | `8c02796` |
| 实现者：AGENTS 五模块基线 | 207 tests，OK，96.442 s | `8c02796` |

最小环境为 macOS arm64、Python 3.13.5，依赖为 CI 的
`numpy matplotlib scipy cryptography` 及其传递依赖，无 Qt、gdstk、ViennaPS、
ViennaLS 或 Numba。实际 CI 命令从 workflow 的 `Compile check` 和
`Core backend tests` 提取并检查退出码，不以开发环境替代最小依赖验证。
最新 27 模块命令也包含 AGENTS 要求的五模块。

专项可在仓库根目录复跑：

```bash
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-depth-task3-verify \
  /opt/anaconda3/bin/python3 -m unittest \
  tests.test_depth_window_etch_http tests.test_ci_contract
```

主审另通过真实 HTTP 构造 300 nm 孔并独立手写解析期望：10 nm 网格、孔口
395 nm、带 `[195,295)`、距离 30 nm、方向性 0。准确删除 680 个体素，grid
及 owner 全部匹配，revision 从 6 增到 7；不是仅比较网格面数。

## 风险与下一段

本轮回归风险低，但此结论不等于整个区间功能已经发布。恢复测试依赖既有
in-process worker frame 夹具；未运行远端 Linux CI、Python 3.12 或 Windows
真机。既有日志文件 ResourceWarning 及开发环境 Numba fork 提示没有被压制。

任务 4 仍需实现右侧模式相关字段、独立 nm／µm、方向性滑块与数值、中英文及
后端提供的只读参考 Z；任务 5 仍需真实浏览器与完整发布验收。
本轮未改变前端，因此没有以旧前端结果宣称新 UI 已通过。

main 与 backup/main 保持 `27592de`；本轮没有合并、推送或重启用户服务。
功能工作树保留，下一段继续同一已批准计划，不另起工艺路线。
