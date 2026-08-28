# skill-router

二级 skill 路由 + 包过滤。host 半插件（无浏览器半）。

## Gotchas

- `Config` 必须是 schemastery schema 对象（`z.object(...)`），不能是普通
  函数——cordis Loader 会调 `Config['~standard'].validate`，函数会炸
  `Cannot read properties of undefined (reading 'validate')`。
- 目录改写**只动 `content[].text`，绝不动 `source.entries`**：tool-skill
  的 digest/重发判定基于 entries；动 entries 会每步重发目录，KV cache 报废。
- 开包集合变化时从 `source.entries` **重建**渲染文本，不要在已经滤过的
  prose 上再滤一层。packKey 写在 `<!-- dsh-pack-key:... -->`，不进 source。
- 不要 import `yaml`：profile 的 node_modules 解析不到。packs.yml 走
  `parseLooseYaml`。
- 本插件在 host 层（patch 层挂载），tool-skill 在 agent preset scope 内。
  实测 waterfall 顺序：host 监听器 `next()` 返回后能看到 preset 内产出的
  catalog（外层包内层），所以可以在 catalog append 进 session 前改写。
- 部署用复制（install.sh），不用 symlink——Node ESM 会把 symlink 解析成
  真实路径导致 `@deepseek-ai/schemastery` 无法从 profile 解析。
- 包名三处一致：package.json / cordis.patch.yml 挂载行 name。
- 纯函数在 `lib/logic.js`；`node scripts/logic.test.mjs` 必须绿。
- DSH 0.1.2-alpha.1：catalog `source` 仍是 `kind: skill-catalog` + `form: catalog` +
  可选 `update: true` + `entries`（全量）。`createUserMessage` 会 deep-freeze；
  改写只 spread 新 message / 新 text block，禁止 mutate `content`。
- `scripts/logic.test.mjs` 末段解析 live `packs.yml`；拓扑改名后要同步断言，
  不要把已退役的成员名当成插件回归。
