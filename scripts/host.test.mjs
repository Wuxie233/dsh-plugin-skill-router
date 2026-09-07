import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import createHost from '../lib/host.js'
const temp = await mkdtemp('/flyshop/dev/tmp/skill-selector-host-')
try {
  const shared = join(temp, 'shared'), child = join(shared, 'child'), linked = join(temp, 'linked')
  await mkdir(child, { recursive: true }); await symlink(child, linked)
  // There is deliberately no SKILL.md: selection cannot depend on a body read.
  const scalar = { default() { return this }, optional() { return this } }
  const z = { object: value => value, string: () => scalar, array: () => scalar }
  let listener, disposed = false
  const plugin = createHost({ z })
  assert.deepEqual(plugin.inject, [])
  plugin.apply({ on(event, callback) { assert.equal(event, 'agent/skill-catalog'); listener = callback; return () => { disposed = true } } }, {
    sharedRoots: [shared], packsFile: '/nonexistent/invalid.yml', skillRoot: '/ignored', extraRoots: ['/ignored'],
  })
  const childSummary = Object.freeze({ name: 'brand-new-unregistered', resourceBase: { kind: 'directory', path: linked } })
  const rootSummary = Object.freeze({ name: 'skill-discovery', resourceBase: { kind: 'directory', path: linked } })
  const input = Object.freeze([childSummary, rootSummary, Object.freeze({ name: 'unknown-provider' })])
  const run = searchAvailable => listener({ searchAvailable, signal: new AbortController().signal }, async () => input)
  assert.deepEqual(await run(true), input.slice(1))
  assert.equal((await run(true))[0], rootSummary)
  assert.equal(await run(false), input)
  assert.equal(await run(undefined), input)
  const aborted = new AbortController(); aborted.abort()
  await assert.rejects(listener({ searchAvailable: true, signal: aborted.signal }, async () => input), /abort/i)
  assert.equal(disposed, false)
  console.log('host.test.mjs: summary-only symlink selection; missing search fallback; ignored legacy config; cancellation passed')
} finally {
  await rm(temp, { recursive: true, force: true })
  console.log(`Cleaned ${temp}`)
}
