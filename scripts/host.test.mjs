import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

// Shared candidate runners execute every *.test.mjs with plain node.
if (!vm.SourceTextModule) {
  const child = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: process.env })
  process.exit(child.status ?? 1)
}
const adapter = process.env.DSH_ADAPTER_ROOT ?? '/root/CODE/dsh-std'
const { parseYaml } = await import(pathToFileURL(path.join(adapter, 'packages/adapter-dsh/src/starpivot-yaml.ts')).href)
const base = new URL('../lib/', import.meta.url)
const source = Object.fromEntries(['host.js', 'logic.js', 'schema.js'].map(file => [file, readFileSync(new URL(file, base), 'utf8')]))
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x) } return x }
const raw = (name, fields = '') => `---\nname: ${name}\ndescription: Fixture ${name}\n${fields}---\nBody`
const visible = message => [...message.content[0].text.matchAll(/^- `([^`]+)`:/gm)].map(x => x[1])
const text = message => message.content[0].text

async function fixture(initial = {}, config = {}) {
  const files = new Map([['/packs.yml', '{}'], ...Object.entries(initial)])
  const definitions = new Map()
  const reads = [], lookups = [], gets = []
  let clock = 20_000, listener, extra = [], projected, complete = true
  const context = vm.createContext({ Date: { now: () => clock }, TypeError, SyntaxError })
  const synthetic = (id, value) => new vm.SyntheticModule(Object.keys(value), function () { for (const [key, item] of Object.entries(value)) this.setExport(key, item) }, { context, identifier: id })
  const modules = new Map([
    ['node:fs', synthetic('fs', { existsSync: p => files.has(p), readFileSync: p => { reads.push(p); if (!files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(p) } })],
    ['node:path', synthetic('path', path)], ['node:os', synthetic('os', { homedir: () => '/unrelated-home' })],
    ['node:crypto', synthetic('crypto', { createHash })],
  ])
  for (const [file, content] of Object.entries(source)) modules.set(`./${file}`, new vm.SourceTextModule(content, { context, identifier: file }))
  const mod = modules.get('./host.js')
  await mod.link(id => modules.get(id)); await mod.evaluate()
  const scalar = { default() { return this } }
  const z = { object: x => x, string: () => scalar, array: () => scalar }
  const api = { parseYaml, z, createUserMessage: freeze, snapshotSessionEvents: s => { if (!s.snapshotEvents) throw new Error('unsupported snapshot'); return s.snapshotEvents() }, sessionWorkingDirectory: s => s.events.findLast(e => e.type === 'workspace/home')?.data.path ?? s.header.cwd }
  const session = { header: { cwd: '/away', agentPreset: 'team' }, events: [], snapshotEvents() { return this.events } }
  const agent = { session }
  const skills = {
    snapshot: async options => { lookups.push(options); return { complete, skills: [...definitions.values()].filter(Boolean) } },
    get: async (name, options) => { gets.push(name); lookups.push(options); const definition = definitions.get(name); return definition?.missing ? undefined : definition },
  }
  const ctx = { on: (name, fn) => { assert.equal(name, 'agent/pre-step'); listener = fn }, get: name => ({ skills, sandboxPolicy: { foldersOf: () => ({ additional: extra }) }, sessionProjections: { stateOf: () => projected } })[name] }
  const policy = mod.namespace.default(api)
  assert.deepEqual(JSON.parse(JSON.stringify(policy.inject)), ['skills'])
  policy.apply(ctx, { packsFile: '/packs.yml', ...config })
  function skill(name, fields = {}) {
    const definition = { name, description: `Fixture ${name}`, provider: 'fixture', source: 'runtime', content: 'Body', invocation: { modelInvocable: true, userInvocable: true }, ...fields }
    definitions.set(name, definition)
    return definition
  }
  const disk = (name, file, fields = '') => { files.set(file, raw(name, fields)); return skill(name, { path: file, source: 'custom', resourceBase: { kind: 'directory', path: path.dirname(file) } }) }
  const step = async (messages = []) => listener({ agent, signal: new AbortController().signal }, async () => ({ kind: 'continue', messages }))
  const emit = async names => {
    for (const name of names) if (!definitions.has(name)) skill(name)
    const input = freeze({ content: [{ type: 'text', text: '<system-reminder></system-reminder>' }, { type: 'fixture-nontext', value: 4 }], source: { kind: 'skill-catalog', form: 'catalog', entries: names.map(name => ({ name, description: `Fixture ${name}` })) } })
    return { input, output: (await step([input])).messages[0] }
  }
  return { api, create: mod.namespace.default, files, definitions, reads, lookups, gets, agent, session, skill, disk, step, emit, remember: message => session.events.push({ type: 'user/message', data: message }), tick: () => clock += 20_000, rehome: cwd => session.events.push({ type: 'workspace/home', data: { path: cwd } }), extras: values => extra = values.map(value => typeof value === 'string' ? { path: value, missing: false } : value), preset: value => projected = value, complete: value => complete = value }
}
let groups = 0
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`) }

await check('admission rejects old private API before hooks activate', async () => {
  const f = await fixture()
  assert.throws(() => f.create({ ...f.api, parseYaml: undefined }), /adapter api.parseYaml/)
})
await check('frozen full entries/nontext survive; unchanged TTL refresh sends nothing', async () => {
  const f = await fixture(); f.disk('child', '/skills/child/SKILL.md', 'routers: [router]\n')
  const a = await f.emit(['writing', 'child'])
  assert.equal(a.output.source, a.input.source); assert.equal(a.output.source.entries, a.input.source.entries)
  assert.ok(Object.isFrozen(a.input.source.entries)); assert.equal(a.output.content[1], a.input.content[1]); assert.deepEqual(visible(a.output), ['writing'])
  f.remember(a.output); const reads = f.reads.length
  assert.equal((await f.step()).messages.length, 0); assert.equal(f.reads.length, reads)
  f.tick(); assert.equal((await f.step()).messages.length, 0)
  assert.ok(f.lookups.every(lookup => lookup.scope === f.agent && lookup.cwd === '/away'))
})
await check('durable stamp survives a new host instance and upgrades a legacy stamp once', async () => {
  const first = await fixture(); first.disk('child', '/skills/child.md', 'routers: [router]\n')
  const a = await first.emit(['writing', 'child'])
  const resumed = await fixture(); resumed.disk('child', '/skills/child.md', 'routers: [router]\n'); resumed.skill('writing'); resumed.remember(a.output)
  assert.equal((await resumed.step()).messages.length, 0)
  const legacy = { ...a.output, content: a.output.content.map(block => block.type === 'text' ? { ...block, text: block.text.replace(/<!-- dsh-pack-key:.*? -->/, '<!-- dsh-pack-key:|team -->') } : block) }
  resumed.remember(legacy); const b = await resumed.step(); assert.equal(b.messages.length, 1); resumed.remember(b.messages[0])
  assert.equal((await resumed.step()).messages.length, 0); assert.equal(b.messages[0].source.entries, a.input.source.entries)
})
await check('R2 same-pack private-home rehome updates in both directions', async () => {
  const f = await fixture({ '/packs.yml': 'projectPrivate:\n  private-skill:\n    home: /home-project\n' })
  const a = await f.emit(['writing', 'private-skill']); f.remember(a.output); assert.deepEqual(visible(a.output), ['writing'])
  f.rehome('/home-project/nested'); const b = await f.step(); assert.equal(b.messages.length, 1); assert.deepEqual(visible(b.messages[0]), ['writing', 'private-skill'])
  assert.equal(b.messages[0].source.entries, a.input.source.entries); f.remember(b.messages[0])
  f.rehome('/away'); const c = await f.step(); assert.deepEqual(visible(c.messages[0]), ['writing']); f.remember(c.messages[0]); assert.equal((await f.step()).messages.length, 0)
})
await check('R2 routing exposure edits with unchanged core descriptions invalidate past TTL', async () => {
  const f = await fixture(); f.disk('child', '/skills/child/SKILL.md')
  const a = await f.emit(['writing', 'child']); f.remember(a.output)
  f.files.set('/skills/child/SKILL.md', raw('child', 'exposure: explicit # manual\n')); f.tick()
  const b = await f.step(); assert.equal(b.messages.length, 1); assert.deepEqual(visible(b.messages[0]), ['writing'])
  f.remember(b.messages[0]); f.tick(); assert.equal((await f.step()).messages.length, 0)
})
await check('R2 closed-pack membership edits invalidate without enabled-set changes', async () => {
  const f = await fixture({ '/packs.yml': 'packs:\n  frontend:\n    catalog: frontend-router\n    members: [old-child]\n' })
  const a = await f.emit(['writing', 'child']); f.remember(a.output)
  f.files.set('/packs.yml', 'packs:\n  frontend:\n    catalog: frontend-router\n    members: [child]\n'); f.tick()
  const b = await f.step(); assert.deepEqual(visible(b.messages[0]), ['writing']); assert.equal(b.messages[0].source.entries, a.input.source.entries)
})
await check('R3 only registry winner metadata is read, including renamed directory/flat files', async () => {
  const f = await fixture({ '/skills/foo/SKILL.md': raw('foo', 'exposure: explicit\n') }, { extraRoots: ['/losing-root'] })
  f.disk('foo', '/native/custom/foo.md', 'exposure: root\n')
  f.disk('actual-name', '/project/.dsh/skills/alias/SKILL.md', 'exposure: explicit\n')
  f.disk('flat', '/project/.dsh/skills/flat.md', 'routers: [router]\n')
  const a = await f.emit(['foo', 'actual-name', 'flat']); assert.deepEqual(visible(a.output), ['foo'])
  assert.ok(!f.reads.includes('/skills/foo/SKILL.md')); f.remember(a.output)
  f.disk('foo', '/project/.dsh/skills/foo/SKILL.md', 'exposure: explicit\n')
  const b = await f.step(); assert.deepEqual(visible(b.messages[0]), [])
})
await check('R3 provider-owned metadata and relative-resource hints do not imply filesystem bodies', async () => {
  const f = await fixture({ '/fake-resources/SKILL.md': raw('opaque', 'exposure: explicit\n') })
  f.skill('remote', { provider: 'remote', resourceBase: { kind: 'url', url: 'https://example.invalid/resources/' }, metadata: { routers: ['router'] } })
  f.skill('opaque', { resourceBase: { kind: 'directory', path: '/fake-resources' }, metadata: {} })
  const a = await f.emit(['remote', 'opaque']); assert.deepEqual(visible(a.output), ['opaque']); assert.ok(!f.reads.includes('/fake-resources/SKILL.md'))
})
await check('R3 stale/missing resources fail closed with recovery and no diagnostic spam', async () => {
  const f = await fixture(); const skill = f.disk('missing', '/custom/missing.md'); f.files.delete(skill.path)
  f.skill('stale', { missing: true })
  const a = await f.emit(['writing', 'missing', 'stale']); assert.deepEqual(visible(a.output), ['writing']); assert.match(text(a.output), /ENOENT/); assert.match(text(a.output), /missing or stale/)
  f.remember(a.output); assert.equal((await f.step()).messages.length, 0)
  f.files.set(skill.path, raw('missing')); f.definitions.get('stale').missing = false; f.tick()
  const b = await f.step(); assert.deepEqual(visible(b.messages[0]), ['writing', 'missing', 'stale']); assert.ok(!text(b.messages[0]).includes('<skill_router_diagnostics>'))
})
await check('Native hides every Team-only name on late projection; entries stay full', async () => {
  const f = await fixture(); delete f.session.header.agentPreset
  const a = await f.emit(['writing', 'team-spec-workflow', 'agent-teams', 'bugbot-review']); f.remember(a.output)
  f.preset('native'); const b = await f.step(); assert.deepEqual(visible(b.messages[0]), ['writing']); assert.equal(b.messages[0].source.entries.length, 4)
  f.remember(b.messages[0]); assert.equal((await f.step()).messages.length, 0)
})
await check('R4 replacement and empty attention catalog preserve exact-name/tool distinction', async () => {
  const f = await fixture(); f.disk('child', '/skills/child.md', 'routers: [router]\n')
  const a = await f.emit(['child']); f.remember(a.output); f.preset('native')
  const b = await f.step(); assert.deepEqual(visible(b.messages[0]), [])
  assert.match(text(b.messages[0]), /Unlisted skills may be loaded/); assert.match(text(b.messages[0]), /No skills are advertised/)
  assert.ok(!text(b.messages[0]).includes('Use only names')); assert.ok(!text(b.messages[0]).includes('No skills are currently available'))
})
const packs = 'packs:\n  mc:\n    catalog: mc-router\n    members: [mc-child]\n  frontend:\n    catalog: frontend-router\n  ops:\n    alwaysOn: true # on\n    catalog: ops-router\n'
for (const [label, selection] of [['flow', 'packs: [mc] # open\n'], ['bare', '- mc\n'], ['block', 'packs:\n  - mc\n']]) {
  await check(`R6 legal ${label} project YAML and inline boolean comments`, async () => {
    const f = await fixture({ '/packs.yml': packs, '/world/.dsh/skill-packs.yml': selection, '/other/.dsh/skill-packs.yml': 'packs: [frontend]' })
    f.rehome('/world/nested'); f.extras(['/other/repo', { path: '/missing', missing: true }])
    const a = await f.emit(['mc-router', 'frontend-router', 'mc-child', 'ops-router']); assert.deepEqual(visible(a.output), ['mc-router', 'frontend-router', 'ops-router'])
    assert.ok(f.lookups.every(x => JSON.stringify(x.extraRoots) === JSON.stringify(['/other/repo'])))
  })
}
for (const invalid of ['packs: [\n', 'packs: null\n', '!!set {mc: null}\n', '!!omap [{mc: closed}]\n', 'packs: {}\nunknown: true\n', 'packs:\n  ops:\n    alwaysOn: "true"\n    catalog: ops-router\n', 'packs:\n  ops:\n    catalog: ops-router\n    members: [bad_name]\n']) {
  await check('R6 malformed/schema-invalid machine table cannot expand the catalog', async () => {
    const f = await fixture({ '/packs.yml': packs }); const a = await f.emit(['writing', 'mc-router']); f.remember(a.output)
    f.files.set('/packs.yml', invalid); f.tick(); const b = await f.step()
    assert.deepEqual(visible(b.messages[0]), []); assert.match(text(b.messages[0]), /Pack table \/packs.yml/)
    assert.equal(b.messages[0].source.entries, a.input.source.entries); f.remember(b.messages[0]); f.tick(); assert.equal((await f.step()).messages.length, 0)
  })
}
await check('R6 routing fields validate types and malformed YAML; bounded source-free diagnostics', async () => {
  const f = await fixture()
  const fields = ['exposure: typo-secret-value\n', 'routers: router\n', 'routers: [bad_name]\n', 'routers: [router, router]\n', 'exposure: root\nexposure: explicit\n', 'routers: [\n', 'exposure: !bad secret-marker\n']
  fields.forEach((field, index) => f.disk(`bad-${index}`, `/skills/bad-${index}.md`, field))
  const a = await f.emit(['writing', ...fields.map((_, i) => `bad-${i}`)])
  assert.deepEqual(visible(a.output), ['writing']); assert.match(text(a.output), /additional routing errors omitted/)
  assert.ok(!text(a.output).includes('secret-marker')); assert.ok(!text(a.output).includes('typo-secret-value'))
})
await check('missing/global disabled selection and invalid project files have explicit semantics', async () => {
  const f = await fixture(); f.files.delete('/packs.yml'); const a = await f.emit(['writing']); assert.deepEqual(visible(a.output), []); assert.match(text(a.output), /ENOENT/)
  const disabled = await fixture({ '/away/.dsh/skill-packs.yml': 'packs: [' }, { packsFile: '' }); const b = await disabled.emit(['writing']); assert.deepEqual(visible(b.output), ['writing'])
  const project = await fixture({ '/packs.yml': packs, '/away/.dsh/skill-packs.yml': 'packs: [unknown-pack]' }); const c = await project.emit(['writing']); assert.deepEqual(visible(c.output), []); assert.match(text(c.output), /undefined pack/)
})
await check('invocation-denied/incomplete registry never turns into a loader bypass', async () => {
  const f = await fixture(); f.skill('manual', { invocation: { modelInvocable: false, userInvocable: true } })
  const a = await f.emit(['writing', 'manual']); assert.deepEqual(visible(a.output), ['writing']); assert.ok(!f.gets.includes('manual')); assert.equal(a.input.source.entries.length, 2)
  f.remember(a.output); f.complete(false); const b = await f.step(); assert.deepEqual(visible(b.messages[0]), []); assert.match(text(b.messages[0]), /discovery is incomplete/)
})
console.log(`host.test.mjs: ${groups} groups passed; in-memory filesystem/session only`)
