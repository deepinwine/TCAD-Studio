# Studio 首次启动结构工程验收

日期：2026-10-23。功能分支：`codex/structure-first-startup`。
代码范围：`e508b8a..a2b2d45`；本验收文档另作纯文档提交。

## 交付内容

- `2a05273`：Studio 启动器显式选择结构入口。全新、无成功恢复结果的会话只有一个
  `Initialize Wafer`，沿用现有新建项目的厚度与小 domain 生长空间规则；实际模型由
  既有晶圆初始化实现创建，不运行后续物理工艺。
- 有效会话继续按上次项目 → autosave → 最近历史恢复。旧物理配方、结构配方、
  权威空配方、未活动草稿、步骤身份、UI 及材料／来源数组保持，不自动迁移或重建。
- 通用 manager 和旧五参数 worker 缺省仍为 legacy；spawn、in-process 与失败回退
  传递相同选项。删除当前配方的旧十步回退和显式新建项目逻辑没有改变。
- `a2b2d45`：验收发现旧项目设置将 `params_raw` 的材料 ID 与名称选项直接比较，
  导致三个材质字段无效、BOX 错显 Silicon、确认禁用。独立修复仅转换显示模板副本；
  已匹配选项保留，未知／不受支持材料仍拒绝。原始导出、SOI、未知字段及旧步骤保留。

复用既有工厂、`InitializeWaferStep.execute`、模型配置、session/worker RPC、导出与
导入接口；没有增加端点、保存格式、依赖、物理模型或前端几何算法。沿用 ADR-027/028，
没有新架构决策。规格及计划见同日期 `specs/` 与 `plans/` 文档。

## 测试与证据

先有 RED 再实现。启动首轮 23 项中 5 个预期行为失败、0 errors：缺少启动参数、
模式及真实工作进程仍加载十步。管理员材料补充用例抓到 Silicon ID 1 与 Germanium
ID 28 不符。设置修复前 6 项中 4 失败、2 通过，定位为材质枚举而非厚度数值非法。
修复后新增 11 个后端测试；原前端集成用例扩为 6 种响应形状，净增 5 项。

| 验证者／项目 | 结果 | 版本与说明 |
| --- | --- | --- |
| 实现者：启动专项 | 26 tests，OK，3.733 s | `2a05273`，真实 spawn 无 skip |
| 实现者：CAD shell + display HTTP | 90 tests，OK，63.609 s | `2a05273` |
| 实现者：项目设置专项 | 3 files、10 tests PASS，1.36 s | `a2b2d45` |
| 实现者：完整前端 | 43 files、735 tests PASS，34.74 s | `a2b2d45`；类型检查与构建 exit 0 |
| 主审：实际 workflow 编译 | 43 个目标，exit 0 | 后端源码 `2a05273` |
| 主审：实际 workflow Core backend tests | 27 模块、606 tests，OK，294.665 s，无 skip | 含 AGENTS 五模块及启动专项 |
| 主审：完整前端 | 43 files、735 tests PASS，29.28 s | `a2b2d45` |
| 主审：类型检查、生产构建 | 两项 exit 0 | `a2b2d45` |
| 主审：grid128 | 5 demos、39 checks 全部 true，exit 0 | `a2b2d45`，未改旧基准 |
| 主审：收尾复跑启动专项 | 26 tests，OK，4.098 s，无 skip | `a2b2d45`，全部后端哈希再次核对未变 |
| SPEC：启动专项 | 26 tests，OK，3.856 s，无 skip | `a2b2d45` |
| SPEC：项目设置 API 集成与结果失效 | 2 files、8 tests PASS，1.01 s | `a2b2d45` |
| QUALITY：启动专项 | 26 tests，OK，3.868 s，无 skip | `a2b2d45`，正式最终审查者独立实跑 |
| QUALITY：项目设置 API 集成与结果失效 | 2 files、8 tests PASS，1.23 s | `a2b2d45` |

主审完整后端直接读取 `.github/workflows/ci.yml` 当前的 `Compile check` 和
`Core backend tests` 执行命令，展开编译文件后以 `/opt/anaconda3/bin/python3` 运行。
开始 HEAD 为 `2a05273`、结束为 `a2b2d45`，期间只有前端／文档提交；全部 Python 源码、
测试与 workflow 的 SHA-256 前后相同。命令、哈希与退出码记录于 `backend-result.json`。
专项已包含在全量中，不把重复测试数量相加。

可复跑命令：

```bash
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-startup-pycache \
  python3 -m unittest tests.test_tcad_studio_launcher
TCAD_SKIP_QT=1 MPLBACKEND=Agg PYTHONPYCACHEPREFIX=/tmp/tcad-startup-pycache \
  python3 tools/run_process_cad_baseline.py --grid 128 --output /tmp/tcad-startup-grid128.json
# frontend/ 中串行运行
npm test -- --run --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run build
```

## 真实浏览器

仅使用 `/tmp` 隔离存储和本机 8820 端口，domain `12×12×48`、体素 `10 nm`：

1. 全新会话直接显示纯几何 Structure CAD、零个可见工艺步骤及实际 Silicon 晶圆；
   未加载示例或默认十步，也没有物理配方助手。
2. 从界面添加名为「首次启动沉积验收」的 `20 nm` Silicon Dioxide，构建成功，
   材料列表同时出现硅及氧化硅，步骤 Done；刷新保留。
3. 复现并修复项目设置材质问题后，三个材料选择正确、无误报，晶圆厚度可由
   `200 nm` 改为 `250 nm` 并确认；原沉积步骤保留，重新构建成功。
4. 正常停止、重新启动同一个隔离服务。未点击构建就恢复了原结构、自定义步骤和
   `20 nm` 参数；再次打开设置仍为 `250 nm`。原恢复语义将运行状态重置为 Ready、
   不恢复有效 Timeline 缓存，不能把它误写为重启后仍 Done。
5. 中英文切换可用，最终 console error/warn 为空。截图来自真实 Three.js 页面，
   不把截图当逐体素证据；实际材料和 owner 保留由 worker 回归逐层验证。

两次隔离服务均已停止，端口空闲；未操作所有者正式存储或原服务。

本机临时证据根目录为 `/tmp/tcad-structure-startup-y9uV6d/`，不提交运行时数据：

| 证据 | 文件 |
| --- | --- |
| 启动 RED／GREEN、专项 | `launcher-red.log`、`launcher-admin-red.log`、`launcher-green.log`、`structure-regressions.log` |
| 材质问题诊断与 RED／GREEN | `project-settings-diagnosis.log`、`project-settings-red.log`、`project-settings-green.log` |
| 主审完整后端与基准 | `backend-core.log`、`backend-result.json`、`compile.log`、`grid128.json` |
| 主审前端 | `root-frontend-final.log`、`root-typecheck-final.log`、`root-build-final.log` |
| 收尾与正式 QUALITY 专项 | `root-launcher-closeout.log`、`quality-final-launcher.log`、`quality-final-project-settings.log` |
| 首次仅晶圆 | `browser-first-wafer-zh.jpg` |
| 项目设置修复与恢复的 250 nm | `browser-project-settings-fixed.jpg`、`browser-restart-project-250nm.jpg` |
| 重启恢复的结构及双语 | `browser-final-restored-zh.jpg`、`browser-final-restored-en.jpg` |

## 独立审查

SPEC：APPROVE，无 BLOCK/NB，八项边界 PASS。
QUALITY：APPROVE，无 BLOCK/NB，八项边界 PASS。两阶段均已完成。

首次质量审查会话在正式报告输出前中断；不把其阶段性消息当作完整签核。
替补审查者重新独立读取完整 diff、架构与调用链，重新运行上述专项，给出本次正式
QUALITY 结论。以下为最终审查确认的八项边界：

| 边界 | SPEC / QUALITY |
| --- | --- |
| Studio 显式选择，通用入口缺省 legacy | PASS / PASS |
| 非法模式副作用前拒绝、旧参数兼容 | PASS / PASS |
| 新晶圆工厂、厚度、实际材料与模型一致 | PASS / PASS |
| 有效恢复优先，不覆盖或自动执行 | PASS / PASS |
| 物理／结构／空配方、草稿、identity、UI 与来源保留 | PASS / PASS |
| 多进程、in-process 与失败回退传参 | PASS / PASS |
| 项目设置显示副本、安全材料映射与旧数据保留 | PASS / PASS |
| 固定技术栈、既有端点／保存格式、无前端工艺算法 | PASS / PASS |

有序修复清单：无待修代码项。仅完成本验收文档及计划状态记录，然后保留功能分支，
由所有者决定集成。审查通过不等于已经合并、推送或更新正式运行界面。

## 风险、限制与发布边界

回归风险较低：新默认只在既有恢复全部未成功时启用，旧入口默认不变；显示修复不改
保存协议。仍须保留完整回归，避免将今后的恢复失败误当作需要自动迁移的理由。
管理员配置仅核对实际支持的材料角色，不宣称支持此前不存在的 SOI 管理员参数接口。
一格高等极小 domain 受体素量化约束，不承诺仍有额外生长空气层。

本环境为 macOS arm64、Anaconda Python 3.13.5（带可选库）、Node 26.0.0。
未验证 Windows/Linux 真机、最小依赖环境、其他 Python 或 CI Node 22；真实 spawn
在本机通过，不等于桌面打包跨平台已验证。保留既有日志 ResourceWarning、Numba/TBB
fork 提示、JSDOM canvas/navigation 诊断与 Vite 939.25 kB 大包警告，未降低断言或超时。

验收时本地 main 与本地跟踪 `studio/main` 均为 `e508b8a`，功能仍在独立分支；未查询
远端最新状态，不能把本地跟踪值称为远端实时 SHA。没有合并、推送或改写第三方 origin。
后续集成至 `deepinwine/TCAD-Studio` 仍由所有者选择。
