# dsh-plugin-skill-router

二级 skill 路由 + 包过滤：模型可见的会话 skill 目录只渲染 router、
always-on 独立 skill，以及当前仓开了的领域包。子 skill / 未开包的领域
skill 隐藏，但仍可按名或 `/name` 加载。

默认 No Repo 大约十几条（主链 + host-ops-router + engineering-crosscut）。
开 `.dsh/skill-packs.yml` 后才加回对应 router / 独立项。

## 行为

扫描 `~/.dsh/skills/`（可配 `skillRoot` / `extraRoots`）下每个 skill 的
SKILL.md frontmatter，再叠加 `packs.yml`：

| 声明 / 包 | 目录可见性 |
| --- | --- |
| `exposure: root` 且包开着 / always-on / 主链 | ✅ |
| `exposure: explicit` | ❌（`/name` 或点名加载） |
| `routers: [name, ...]` | ❌（router 路由，`skill` 工具按名可加载） |
| 领域包未开 | ❌（点名或 `/name` 仍可加载） |
| 两者都没有，且包开着 / 未分类主链 | ✅ |

隐藏发生时目录末尾追加一行提示。**durable `source.entries` 保持全量不动**——
tool-skill 的 digest 重发判定基于 entries 而非渲染文本。开包集合因改挂变化时，
本插件从 entries 重建一条替换 catalog，并在渲染文本里写
`<!-- dsh-pack-key:... -->`（HTML 注释，模型当噪声）。

会话预设恰好是 `native` 时，渲染目录再藏 `team-spec-workflow` 与
`agent-teams`（Team 专用）。`team` / `standard` / 其它预设不藏。slash 与
点名加载仍可用。

包表：`~/CODE/agent-habits/skills/skill-topology/packs.yml`。
开包文件：会话 cwd / extraRoots 及其祖先的 `.dsh/skill-packs.yml`，取并集。

## 安装 / 更新

```sh
node scripts/logic.test.mjs
./install.sh          # 部署到 ~/.dsh/profiles/node_modules/@wuxie/dsh-skill-router
# 然后重启 dsh web（host 半插件需要重启生效）
```

挂载行（已写入 `~/.dsh/profiles/web/cordis.patch.yml`）：

```yaml
- insert:
    - id: skill-router
      name: '@wuxie/dsh-skill-router'
```

dsh 升级或 profile heal 之后重新跑一次 `./install.sh`。

## 配置（可选）

```yaml
- insert:
    - id: skill-router
      name: '@wuxie/dsh-skill-router'
      config:
        skillRoot: ~/.dsh/skills
        extraRoots: []
        packsFile: ~/CODE/agent-habits/skills/skill-topology/packs.yml
```

`packsFile: ""` 关掉包过滤，只保留二级路由。

## 已知限制

- frontmatter 解析是 `exposure` / `routers` 的定向子集；非法值按未声明
  处理（该 skill 保持可见），不会报错。
- 过滤只作用于模型可见文本；UI 侧（slash 列表等）仍显示全部 skill。
- Native 藏 Team skill 依赖会话 `agentPreset`。header 与投影都缺时第一份
  catalog 仍会列出它们；投影随后到达会因 packKey 含预设 id 而重建目录。
- 隐藏集合 / 包表扫描有 10s TTL 缓存。
- 项目级例外（`tooldelta-agent-bridge`、`sub2api-update`）仍可从用户根
  按名加载；模型目录只在其 home 或祖先开了 `enablingPack` 时出现。
