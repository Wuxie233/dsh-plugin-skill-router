# dsh-plugin-skill-router

给模型显示精简的 **skill 注意力目录**，保留 core 的完整模型可调用 entries。
插件不执行 router 的选择逻辑，也不改变 `skill` 工具或用户 `/name` 的权限。

## 当前接入

`dsh-plugin.json` 声明标准 host facet；`lib/index.js` 发布私有
`plugins.starpivot.dev/v1 HostPlugin`，`lib/host.js` 从 adapter 接收 API。
本版本需要提供 `api.parseYaml(text)` 的 `@dsh-std/adapter-dsh`
（维护分支 `0.1.1-starpivot.2` 起）。旧 adapter 会在 factory admission
得到明确兼容错误，而不是启用一半后再失败。

HostPlugin 和 native `inject` 都声明 `skills` 为必需服务；基础 host 必须
在创建 agent/preset 前提供 registry。不要把 `lib/index.js` 当旧 Cordis
插件挂载，也不要在运行目录直接改文件。

## 可见性与来源

插件查询当前 agent scope、effective cwd 和有效附加 workspace folders 下的
**registry winner**。Native custom root、项目覆盖、flat `.md`、目录名与
frontmatter name 不同的文件都跟随同一来源，不与同名 global losing metadata
取并集。

| 条件 | 模型注意力目录 |
| --- | --- |
| `exposure: root`，且 pack 已开/always-on/未分类 | 可见 |
| `exposure: explicit` | 隐藏 |
| `routers: [parent, ...]`，没有 `exposure: root` | 隐藏 |
| 所属领域 pack 未开 | 隐藏 |
| 没有 routing 声明，且 pack 可见/未分类 | 可见 |
| project-private | 当前根在 home 下，或启用了 enablingPack 时可见 |

Native 还隐藏 `team-spec-workflow`、`agent-teams`、`bugbot-review`；其它
预设不加这层过滤。模式取 projection，缺失时回退 header；都缺失时不猜模式。

隐藏不等于加载许可：core 的 `modelInvocable` 决定模型工具能否加载，
`userInvocable` 决定用户 gesture/UI surface。实际路由和 pack-use 行为由
对应 skill/policy 负责，插件不复制业务工作流或自动改项目包配置。

### 非 filesystem provider

Provider 返回明确的绝对 `path` 时，插件只读取那个 body 文件的 YAML
frontmatter；缺文件、缺完整 header、name 与 registry 不符或非法 routing
字段会隐藏该条并诊断。没有 `path` 时，使用 provider 返回的
`metadata.exposure` / `metadata.routers`（可省略）。`resourceBase` 的 directory、
URL 或 opaque hint 不意味着 body 存放在 global filesystem；插件不猜地址、
不额外抓取 URL、不读取 losing root 作为回退。只提供自定义 body 格式的 provider
应返回 routing metadata 而不冒充 filesystem frontmatter resource。

## 目录更新与故障

原始 `source.entries` 和 source 其它字段始终保留。只替换 text blocks，
因此不会破坏 core digest。更新从完整 entries 重建，不在已过滤 prose 上
继续减条目。

`dsh-pack-key` 的 v2 digest 覆盖 roots、preset、winner provenance、routing
metadata、机器包表/项目选择、隐藏结果与诊断。同包 rehome、exposure 或
pack membership 改动都能更新现有会话；相同状态不每步重发。
机器包表和各 resource 的解析结果缓存 10 秒，过期重读但不因过期本身重发；
项目 pack selection 每步读取。Registry winner 每步重新解析，避免独立扫描
重建错误的优先级；这会增加 provider reads，不能理解成零开销缓存。

替换 prose 只取代旧的**广告条目**，不会禁止一切未列出的精确名称。
空的注意力目录也不声称工具完全无 skill。

- YAML 支持 flow/block 列表、注释、引号、block scalar 等合法写法；adapter
  拒绝语法错误、重复 key、unsupported tag 和过量 alias expansion。
- `exposure` 必须是 `root|explicit`，`routers` 必须是无重复的 kebab-name
  数组。机器包表、项目选择验证类型、已定义的 pack 和未知 config key。
  其它 core/provider frontmatter 字段不由插件重新定义。
- 配置错误不会转成空表后扩大可见目录。机器表缺失/非法、非法项目选择或
  registry 不完整会暂时隐藏该目录；单项资源故障只隐藏该项。最多显示五条
  修复诊断，不回显文件内容，稳定故障不重复注入。修复后按读取周期恢复。

## 配置

在 adapter 的 `componentConfigs` 中配置，不添加旧 direct mount：

```yaml
componentConfigs:
  dev.starpivot.skill-router:
    packsFile: /root/CODE/agent-habits/skills/skill-topology/packs.yml
```

默认机器表如上；`packsFile: ""` 明确关闭全部 pack table/selection 过滤，
仍保留 routing 和 Native 隐藏。使用绝对路径；这里不执行 shell `~` 展开。

项目开包文件是 effective cwd/有效附加 folders 及其所有祖先的
`.dsh/skill-packs.yml`，取并集，可写为：

```yaml
packs: [mc, gsap]
```

或 `{ packs: [...] }` 的 block 写法、bare YAML name list。后代不能关闭
祖先开的包。旧 `skillRoot` / `extraRoots` 配置仍可通过 schema，但已不决定
metadata 来源；真正的 custom roots 应配置在 core filesystem provider 上。

## 验证与部署

```sh
node scripts/logic.test.mjs
node scripts/host.test.mjs
node scripts/core.test.mjs
```

`core.test.mjs` 通过 adapter boundary 使用已安装的 candidate source/tooling，
不是 live session 测试；支持 `DSH_ADAPTER_ROOT`、`DSH_HARNESS_ROOT` 与
`DSH_ROUTER_TEST_PACKS` 路径覆盖。临时文件在 `$TMPDIR`（默认
`/flyshop/dev/tmp`），watchers 关闭，退出清理。

授权部署时，`./install.sh` 仍先运行共享 candidate gate，再备份并复制。
先部署包含 YAML capability 的 adapter，再部署 consumer。`yaml` 是 adapter
显式打包依赖，profile 不必另装它；不可用 symlink 代替 runtime copy。
Host-half 激活需要授权重启，必须由操作者确认不会中断其它任务。测试通过或
source/build 匹配都不等于正在运行的 host 已加载新版本。

具体回归与未改变的边界见 `docs/verification.md`。
