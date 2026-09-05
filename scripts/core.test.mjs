// Execute the actual native integration inside its owning adapter boundary.
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adapter = process.env.DSH_ADAPTER_ROOT ?? resolve(plugin, '../../dsh-std')
const requireAdapter = createRequire(join(adapter, 'packages/adapter-dsh/package.json'))
// The candidate gate binds this declared adapter dependency to its selected checkout.
const agentPackage = realpathSync(requireAdapter.resolve('@deepseek-ai/dsh-agent/package.json'))
const harness = process.env.DSH_HARNESS_ROOT ?? resolve(dirname(agentPackage), '../../..')
const loader = createRequire(join(harness, 'package.json')).resolve('tsx/esm')
const child = spawnSync(process.execPath, ['--import', loader, join(adapter, 'packages/adapter-dsh/tests/starpivot-router.fixture.mjs')], {
  cwd: harness,
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_ROUTER_TEST_HARNESS: harness,
    DSH_ROUTER_TEST_PLUGIN: plugin,
    DSH_ROUTER_TEST_PACKS: process.env.DSH_ROUTER_TEST_PACKS ?? resolve(plugin, '../../agent-habits/skills/skill-topology/packs.yml'),
  },
})
if (child.error) throw child.error
process.exitCode = child.status ?? 1
