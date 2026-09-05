# Routing coherence verification

## Delivery scope and evidence identity

Accepted contract: `/root/CODE/agent-habits/specs/2026-09-05-skill-ecosystem-coherence.md`.
Historical audit: `/root/CODE/agent-habits/research/dsh-skill-ecosystem-audit/router.md`.
The audit remains historical evidence, not rewritten to claim a fix.

Pre-write baselines were clean: router `master` at
`7add1785153105615761e7c42b1daa8215db0463`; adapter `main` at
`573fdf569865c2fc0ec5ff56ada3f903ccfbf198`. The later actual-core fixture uses the
inspected checkout `e3df6dac42246445e9e9b01f494df4d36844bc64`, not the audit's older
`80de3ac` observation. No tracked or untracked core source was edited.

Adapter capability lands before the consumer: `99db847`,
`feat(adapter): bundle strict YAML for private host consumers`, version
`0.1.1-starpivot.2`. Parser/host API, dependency declaration, bundle rules, notices,
and native fixture imports belong to the private adapter; product policy remains
in this plugin.

## Findings

| Finding | Routing-slice disposition | Evidence |
| --- | --- | --- |
| R1 Native model-invocation denial | Preserved loader boundary, not bypassed. Native body/invocation adaptation belongs to runtime-topology/methods. | Actual `tool.execute`: hidden child allowed; disabled model definition denied; direct human slash invokes only user-invocable skills. Plain names/non-user slash do not synthesize gestures. |
| R2 incomplete visibility stamp | Fixed. Includes effective roots/private-home context, preset, winner identity, routing/pack data and errors. | Same-pack rehome both ways, exposure/member edits after TTL, stable unchanged steps, immutable full entries; actual Session/core digest checks. |
| R3 losing metadata used for winner | Fixed. Query current scoped registry winner, then its explicitly returned resource or provider metadata. | Native custom root beats losing global body; project override wins; flat files/frontmatter-name aliases; URL/opaque/directory resource hints; missing/stale resources withheld with recovery. |
| R4 contradictory replacement | Fixed. Replacement/empty text describes attention entries, not exhaustive tool availability. | Assert no “Use only names”/“No skills are currently available”; hidden entries remain in source and loadable when core allows. |
| R5 GSAP parent prose gaps | Shared-skills owns the six parent routes; no router execution policy added here. | Communicated all six-child ownership; source pack table still validates through the actual fixture. |
| R6 YAML policy drift | Fixed in router+private adapter. Syntax and schema failures do not become an empty fail-open table. | Comments, flow/block/bare lists, quoted/block scalars; malformed/duplicate/tag/alias errors; null/map/set/type/value/unknown config-key controls; bounded diagnostics and recovery. |

Native advertisement additionally removes all three Team-only names, including
Bugbot. This is an attention rule, not a new invocation restriction.

## Executed focused checks

From `/root/CODE/dsh-plugins/skill-router`:

```sh
node scripts/logic.test.mjs
node scripts/host.test.mjs
node scripts/core.test.mjs
node --test scripts/*.test.mjs
git diff --check
```

- Existing baseline logic tests passed before changes, despite the audited bugs.
- The audit's exact C2 VM probe was re-executed without file/session mutation,
  substituting only the source reads with `git show <router baseline>:lib/host.js`
  and `lib/logic.js`. All 14 original rows reproduced: three preservation cases,
  nine defect rows, two YAML-limit rows.
- New host fixtures execute actual host/logic/schema source with an in-memory
  filesystem, registry and clock. They test behavior changes, not only replacement
  expected prose. They preserve frozen source entries and non-text blocks.
- `core.test.mjs` runs the adapter-owned
  `packages/adapter-dsh/tests/starpivot-router.fixture.mjs` through the selected
  checkout's existing `tsx/esm`. It exercises actual Cordis admission before any
  agent/preset, scoped registry/provider precedence, tool-skill catalog waterfall,
  real isolated Session history, model invocation and user gestures. All native
  imports stay in the adapter. No real user session is opened or changed.
- Pure/core checks also retain pack-layer and current machine-table assertions;
  machine topology checks are not silently removed when the ad-hoc parser retires.

From `/root/CODE/dsh-std/packages/adapter-dsh`:

```sh
pnpm exec vitest run tests/starpivot-host.spec.ts tests/starpivot-yaml.spec.ts tests/starpivot-yaml-copy.spec.ts
pnpm run build
pnpm run typecheck
```

The three focused files passed 15 tests; the package-only build/typecheck passed.
The copied-parser fixture uses the production Node bundle settings, imports a
copy with no installed dependencies, checks strict behavior and the bundled ISC
notice, and cleans its temporary directory.

## Self-review and test-harness corrections

Self-review covered contract fidelity, immutable entries, provider ownership,
current native service admission, schema failures, cache/error stability and
copy deployment. Independent review is not duplicated per slice; the Lead owns
terminal integration and the selected single Bugbot pass.

Early fixture failures were investigated rather than counted as product passes:

- A broad “external yaml import” regex matched a bundled dependency comment;
  anchored import inspection plus an actual isolated copy import replaced it.
- Real Cordis admission exposed use of the obsolete `{required, optional}`
  inject shape. The consumer now uses `['skills']` and supported optional
  `ctx.get` reads; the real admission test passes.
- Mixing core `lib` imports with candidate `tsx` source aliases duplicated scope
  symbols in the fixture. All fixture native imports now use the selected
  source graph consistently; actual layered winner tests pass.

## Limits and resources

No full `pnpm check`, combined candidate gate, installer/deploy, service restart,
push, browser, nested agent, QQ notification, credentials/config-secret read or
real user-session mutation was performed by this slice. Source/build/test
success is not evidence that the running host has imported this version.

Parsed machine/routing metadata has a 10-second TTL; unchanged catalogs are
stable, but provider winner reads still occur each step. Only a provider-returned
absolute body path is read as YAML frontmatter. Providers without one publish
routing fields through their returned metadata; URL/opaque hints are not fetched
as files. Custom body formats must not advertise an incompatible file resource.
The plugin does not redefine all core/authoring frontmatter keys or traverse
parent prose; the authoring/topology slices own those checks.

Every `skill-router-core-*` and `skill-router-yaml-copy-*` directory is created
under `$TMPDIR` (default `/flyshop/dev/tmp`) and removed in `finally`. All isolated
native fibers/providers are disposed, with provider watchers disabled. No server
or browser is started. One task-owned source-tooling symlink remains deliberately
for the Lead's terminal build:

`/root/CODE/dsh-std/packages/adapter-dsh/node_modules/yaml` → the already installed
`/root/CODE/deepseek-harness/node_modules/.pnpm/yaml@2.9.0/node_modules/yaml`.

It is not a live profile link or a deployment artifact; the declared dependency
and bundled output are the runtime contract. No download or package lifecycle
script was needed to wire that source tooling.
