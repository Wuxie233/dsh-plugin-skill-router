# dsh-plugin-skill-router

对共享 skill 库进行轻量广告筛选。原生 `skill_search` 搜索完整可调用目录，原生 `skill` 加载正文；插件只决定哪些摘要进入会话广告目录。

## 使用契约

插件使用 core 的 `agent/skill-catalog` waterfall，从 `await next()` 返回的摘要中选择原对象子集，不修改摘要、消息、`source.entries` 或调用权限。Core 用筛选结果同时生成正文和结构化 entries，并拥有目录 digest、更新与持久化。

只有 core 确认原生 `skill_search` 在当前 agent 可见（`searchAvailable: true`）时才筛选。搜索缺失、受限或被同名工具覆盖时，保留全部目录。卸载插件恢复原生完整目录。旧 core 没有该 hook 时插件不进行筛选；部署须通过新 core 的集成验证。

默认仅筛选真实目录位于 `/root/CODE/agent-skills/skills` 下的共享技能；目录符号链接先解析真实路径。只使用 provider 明确返回的 directory `resourceBase`，不推测 URL、opaque 或缺失定位信息；无法确定归属时保留广告。技能正文和 frontmatter 不参与筛选。

默认保留 `skill-discovery`、`host-ops-router`、`frontend-design-router`、`gsap-router`、`mc-bedrock-architecture-router`、`learning-router`。其它来源（项目技能、Native 覆盖或专用工作流）保留原生广告，不增加按模式隐藏规则。

新增共享技能只需被原生 provider 发现：它立即可搜索、可加载，无需 `routers`、`exposure`、pack membership 或手工路由登记。保留根 router 是便利入口，搜索负责未登记技能的发现。

## 配置

```yaml
componentConfigs:
  dev.starpivot.skill-router:
    sharedRoots: [/root/CODE/agent-skills/skills]
    rootNames:
      - skill-discovery
      - host-ops-router
      - frontend-design-router
      - gsap-router
      - mc-bedrock-architecture-router
      - learning-router
```

`sharedRoots` 使用绝对目录；无法解析或相对路径不会触发隐藏。`rootNames` 是始终保留广告的名字，不是加载白名单。旧 `skillRoot`、`extraRoots`、`packsFile` 配置仅为迁移兼容接收，已废弃且不产生作用；插件不读取包表或项目开包文件。

## 验证与部署

```sh
node scripts/logic.test.mjs
node scripts/host.test.mjs
DSH_HARNESS_ROOT=/path/to/compatible/harness node scripts/core.test.mjs
```

Core fixture 使用真实 Cordis、provider、tool-skill 与 adapter admission；测试新技能搜索加载、entries 与正文一致以及卸载恢复。`DSH_ADAPTER_ROOT` 可指定 adapter。临时目录位于 `/flyshop/dev/tmp`，watchers 关闭，不读写真实用户会话，结束清理。

`./install.sh` 仍走共享 candidate gate 和复制部署。测试通过不代表 live host 已更新；服务重启需要用户明确授权。插件无需 YAML adapter helper。见 [验证记录](docs/verification.md)。
