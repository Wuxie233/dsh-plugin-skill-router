# dsh-plugin-skill-router

二级 skill 路由插件：把模型可见的会话 skill 目录（catalog）过滤为
router + 独立 skill，路由子 skill 隐藏但仍可按名加载。catalog 文本从
全量（~108 条）降到 ~42 条，直接节省每会话开头的提示词 token 和注意力。

## 行为

扫描 `~/.dsh/skills/`（可配 `skillRoot` / `extraRoots`）下每个 skill 的
SKILL.md frontmatter：

| 声明 | 目录可见性 |
| --- | --- |
| `exposure: root` | ✅ 显示（router / 直接可用的专家） |
| `exposure: explicit` | ❌ 隐藏（`/name` 手势或 router 正文点名加载） |
| `routers: [name, ...]`（无 exposure） | ❌ 隐藏（router 路由，`skill` 工具按名可加载） |
| 两者都没有 | ✅ 显示（独立 skill） |

隐藏发生时目录末尾追加一行提示，告知模型还有未列出的 skill 可通过
router 或精确名加载。**durable `source.entries` 保持全量不动**——
tool-skill 的 digest 重发判定基于 entries 而非渲染文本，所以本插件永不
触发目录重发，KV cache 前缀稳定。

## 安装 / 更新

```sh
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
        skillRoot: ~/.dsh/skills       # 默认 ~/.dsh/skills
        extraRoots: []                 # 额外扫描的 skill 根目录
```

## 已知限制

- frontmatter 解析是 `exposure` / `routers` 的定向子集（支持 flow 与
  block 序列、`>-`/`|-` 块标量跳行），不解析其他字段；非法值按未声明
  处理（该 skill 保持可见），不会报错。
- 过滤只作用于模型可见文本；UI 侧（slash 列表等）仍显示全部 skill，
  这是刻意的：显式调用应能触达所有 skill。
- 隐藏集合扫描有 10s TTL 缓存，新增/修改 frontmatter 后最多 10 秒生效。
