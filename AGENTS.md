# skill-router

## Architecture

标准 host facet：`lib/index.js` 发布 `plugins.starpivot.dev/v1 HostPlugin`，
`lib/host.js` 的 `createHost(api)` 负责模型目录的注意力过滤。原生导入只在
`/root/CODE/dsh-std/packages/adapter-dsh`；不要恢复旧 Cordis 直接挂载方式。

模型目录不是加载器权限表。只改 `content[].text`，保留完整、不可变的
`source.entries` 及其它 core-owned source 字段；core tool-skill 的 digest
和重发判断依赖它们。禁用模型调用的条目仍由 core 排除/拒绝。

## Conventions

- 以 `skills.snapshot/get({ cwd, extraRoots, scope: agent, signal })` 的当前
  winner 为准。`path` 是 provider 明确返回的 body 文件，读取其 frontmatter；
  无 `path` 的 provider 用返回的 `metadata.exposure/routers`。目录/URL/opaque
  `resourceBase` 只表示相对资源定位，不要猜成 `SKILL.md`，不要扫描 losing roots。
- HostPlugin `services` 和原生 `inject` 都要求 `skills`。当前 Cordis inject
  支持数组或 service→intercept map，不支持 `{ required, optional }`。
  可选 `sandboxPolicy` / `sessionProjections` 用 `ctx.get`。
- `api.parseYaml` 由 adapter 严格解析；插件独占 routing/pack schema。
  helper 缺失时在 factory admission 报兼容错误，不等运行 hook 才失败。

## Gotchas & Decisions

- 渲染 stamp 包含 preset、effective roots、winner provenance、routing metadata、
  pack table/selection、最终隐藏集合及诊断。使用 canonical digest，放在
  `<!-- dsh-pack-key:...|v2:... -->`，不写入 source。相同输入不重复注入；
  同包 rehome、exposure/member 改动也会替换。替换从 full entries 重建。
- 每步重新查询 registry winner，解析 body metadata/机器包表缓存 10 秒。
  TTL 到期本身不触发重发；语义变化才触发。项目 pack selection 每步读取。
- 机器表缺失/非法、项目选择非法、registry 不完整时，隐藏这份注意力目录并给
  修复诊断；单个 resource 缺失或 metadata 非法只隐藏该条。诊断最多五条，
  不回显 YAML/provider body。相同故障不每步追加。修复后按缓存周期恢复。
- Native 恰好 `native` 时隐藏 `team-spec-workflow`、`agent-teams`、
  `bugbot-review`。投影优先、header 回退；两者缺失不猜模式，晚到投影会重建。
- `skillRoot/extraRoots` 只为旧配置兼容保留，已不用于扫描。实际 discovery roots
  由 core provider 配置决定。`packsFile: ""` 明确关闭 pack table/selection 过滤。
- plugin source 不直接依赖 `yaml`；adapter 声明并打包依赖供复制部署。

## Commands

- `node scripts/logic.test.mjs`：pure helpers/schema 的独立 fixture。
- `node scripts/host.test.mjs`：真实 host 源码 + 内存 filesystem/clock/registry；
  自动启用 VM modules。使用同级 adapter parser，不依赖 profile yaml。
- `node scripts/core.test.mjs`：在 adapter-owned fixture 中运行真实
  Cordis/SkillRegistry/FileSystemSkillProvider/tool-skill。使用当前绑定的 candidate
  （可显式 `DSH_HARNESS_ROOT` / `DSH_ADAPTER_ROOT`）；隔离 Session，不读写真实
  user session，watchers 关闭，数据盘临时文件和 fibers 在 finally 清理。
- `git diff --check`。完整 workspace/check-candidate 与授权部署由终端集成负责。
  不把 source tooling symlink 当可部署 runtime；部署仍用已有共享复制门禁。

## Module Map

- `lib/host.js`：hook、effective lookup、故障收敛、cache/stamp。
- `lib/logic.js`：包可见性、模式隐藏、attention prose。
- `lib/schema.js`：机器表、项目选择与 routing field 验证。
- `scripts/*.test.mjs`：独立逻辑、host、真实 core 回归入口。
- `docs/verification.md`：本次 R1–R6 边界、原缺陷重现及精确验证命令。
