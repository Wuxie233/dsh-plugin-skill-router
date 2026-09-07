# skill-router

## Architecture

标准 HostPlugin facet，`lib/host.js` 只订阅原生 `agent/skill-catalog` waterfall。调用 `next()` 后返回原 summary 对象子集，core 拥有目录正文、`source.entries`、digest 和持久化。不恢复 pre-step prose 重写或自行构造 catalog 消息。

`searchAvailable` 由 core 按原生工具精确注册身份计算；不是 true 时保留全部摘要。原生 `skill_search` 搜完整可调用 registry，不受广告 selector 影响。原生 `skill` 和用户显式调用继续维护 invocation flags。

## Conventions

- 仅用 directory `resourceBase` 的真实路径判定共享来源；解析目录 symlink，不读取 skill 正文，不猜测 URL/opaque hint。来源不明保留广告。
- 默认共享 root 为 `/root/CODE/agent-skills/skills`，可用 `sharedRoots` 修改。根入口由 `rootNames` 配置；不对 Native 硬编码隐藏。
- `skillRoot`、`extraRoots`、`packsFile` 仅兼容旧配置，不产生作用。没有 pack 表、routing schema、TTL、stamp 或正文 metadata 读取。
- `lib/index.js` 发布 HostPlugin；manifest services 和 native inject 都为空，selector 不直接使用 registry/tools 服务。

## Verification

- `node scripts/logic.test.mjs`：来源、路径边界、未知来源回退、对象身份。
- `node scripts/host.test.mjs`：目录 symlink、无正文选择、搜索缺失回退、旧配置忽略、取消信号。
- `DSH_HARNESS_ROOT=/path/to/compatible/harness node scripts/core.test.mjs`：真实 core 与 adapter admission；新建无需登记即可搜索/加载、entries 与正文一致、卸载恢复。fixture 位于本插件 `scripts/core.fixture.mjs`，临时资源在数据盘且 finally 清理。
- `git diff --check`。共享 candidate gate 和授权部署仍由集成方负责；不得把测试通过当成 live host 更新。
