# skill-router

二级 skill 路由 host 半插件（无浏览器半）。

## Gotchas

- `Config` 必须是 schemastery schema 对象（`z.object(...)`），不能是普通
  函数——cordis Loader 会调 `Config['~standard'].validate`，函数会炸
  `Cannot read properties of undefined (reading 'validate')`。
- 目录改写**只动 `content[].text`，绝不动 `source.entries`**：tool-skill
  的 digest/重发判定基于 entries；动 entries 会每步重发目录，KV cache 报废。
- 本插件在 host 层（patch 层挂载），tool-skill 在 agent preset scope 内。
  实测 waterfall 顺序：host 监听器 `next()` 返回后能看到 preset 内产出的
  catalog（外层包内层），所以可以在 catalog append 进 session 前改写。
- 部署用复制（install.sh），不用 symlink——Node ESM 会把 symlink 解析成
  真实路径导致 `@deepseek-ai/schemastery` 无法从 profile 解析。
- 包名三处一致：package.json / cordis.patch.yml 挂载行 name。
