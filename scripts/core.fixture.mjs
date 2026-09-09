/** Executed by the skill-router consumer's core.test.mjs, not a full-suite runner.
 * Real native imports stay here in the adapter boundary. No live session/profile.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { installStarPivotHost } = await import(pathToFileURL(join(process.env.DSH_ADAPTER_ROOT ?? '/root/CODE/dsh-std', 'packages/adapter-dsh/src/starpivot-host.ts')).href)

const harness = resolve(process.env.DSH_ROUTER_TEST_HARNESS)
const pluginRoot = resolve(process.env.DSH_ROUTER_TEST_PLUGIN)
const packages = new Map()
for (const group of await readdir(join(harness, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  for (const entry of await readdir(join(harness, 'packages', group.name), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(harness, 'packages', group.name, entry.name)
    try { packages.set(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name, directory) } catch {}
  }
}
// Match the candidate's tsx paths consistently; mixing lib and src duplicates scope symbols.
const native = name => import(pathToFileURL(join(packages.get(name), 'src/index.ts')).href)
const { Context } = await import(pathToFileURL(join(harness, 'vendor/cordis/src/index.ts')).href)
const { default: SkillRegistry } = await native('@deepseek-ai/dsh-skill')
const { FileSystemSkillProvider } = await native('@deepseek-ai/dsh-skill-filesystem')
const toolSkill = await native('@deepseek-ai/dsh-tool-skill')
const { default: Tools } = await native('@deepseek-ai/dsh-tools')
const { default: SystemPrompt } = await native('@deepseek-ai/dsh-system-prompt')
const { default: Agents, agentEvents } = await native('@deepseek-ai/dsh-agent')
const { default: SessionProjections } = await native('@deepseek-ai/dsh-session-projection')
// Inbox is now an interface; exercise the candidate driver's concrete projection-backed inbox.
const { ReactLoopInbox } = await import(pathToFileURL(join(packages.get('@deepseek-ai/dsh-agent-loop'), 'src/inbox.ts')).href)
const { createScope } = await native('@deepseek-ai/dsh-scope')
const { Session, SessionId, SESSION_FORMAT_VERSION } = await native('@deepseek-ai/dsh-session')
const { createUserMessage } = await native('@deepseek-ai/dsh-llm')
const { default: create } = await import(pathToFileURL(join(pluginRoot, 'lib/host.js')).href)

const manifest = JSON.parse(await readFile(join(pluginRoot, 'dsh-plugin.json'), 'utf8'))
const spec = manifest.contributes['x-dev.dsh-std.extensions'][0].spec
const temp = await mkdtemp('/flyshop/dev/tmp/skill-selector-core-')
const root = new Context()
let disposeSelector, scope, provider
try {
  for (const service of [SystemPrompt, Tools, Agents, SkillRegistry, SessionProjections]) await root.plugin(service)
  const home = join(temp, 'home'), shared = join(home, 'skills'), project = join(temp, 'project')
  await mkdir(project)
  async function put(name) {
    const dir = join(shared, name); await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Searchable ${name} instructions\n---\nBody for ${name}.`)
    return join(dir, 'SKILL.md')
  }
  await put('skill-discovery'); await put('old-child')
  root.get('skills').registerProvider(control => {
    provider = new FileSystemSkillProvider(root, control, { watch: false, dshHome: home, agentsHome: join(temp, 'no-agents') })
    return provider
  })
  disposeSelector = await installStarPivotHost(root, manifest.id, spec, { create }, { sharedRoots: [shared] })
  const id = SessionId('skill-selector-fixture')
  const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: project, isSeeded: false })
  const agent = { id, options: {}, session, status: 'idle', ctx: root }
  agent.inbox = new ReactLoopInbox(root.get('sessionProjections'), session, agentEvents(root, agent))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'fixture' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  scope = createScope(root, agent); agent.ctx = scope.ctx
  await scope.ctx.plugin(toolSkill)
  async function propose() {
    const decision = await agentEvents(root, agent).waterfall('agent/pre-step', { messages: [], turn: 1, step: 1, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    const catalog = decision.messages.find(message => message.source?.kind === 'skill-catalog')
    assert.ok(catalog)
    const names = [...catalog.content[0].text.matchAll(/^- `([^`]+)`:/gm)].map(match => match[1])
    assert.deepEqual(catalog.source.entries.map(entry => entry.name), names)
    return names
  }
  const search = root.get('tools').get('skill_search', agent)
  const expectedInitial = search ? ['skill-discovery'] : ['old-child', 'skill-discovery']
  assert.deepEqual(new Set(await propose()), new Set(expectedInitial))
  const file = await put('brand-new-no-registration'); provider.observeHostMutation(file)
  const exec = { agent, signal: new AbortController().signal }
  if (search) {
    const found = await search.execute({ query: 'brand-new-no-registration' }, exec)
    assert.equal(found.skills[0].name, 'brand-new-no-registration')
  } else {
    // A candidate without native search must advertise every skill, including new ones.
    assert.deepEqual(new Set(await propose()), new Set(['skill-discovery', 'old-child', 'brand-new-no-registration']))
  }
  const skill = root.get('tools').get('skill', agent)
  assert.ok(skill)
  const loaded = await skill.execute({ name: 'brand-new-no-registration' }, exec)
  assert.match(loaded.content, /Body for brand-new-no-registration/)
  assert.deepEqual(new Set(await propose()), new Set(search
    ? ['skill-discovery']
    : ['skill-discovery', 'old-child', 'brand-new-no-registration']))
  await disposeSelector(); disposeSelector = undefined
  assert.deepEqual(new Set(await propose()), new Set(['skill-discovery', 'old-child', 'brand-new-no-registration']))
  console.log(search
    ? 'PASS real adapter/core: entries match text; new skill searched and loaded without registration; selector disposal restores full catalog'
    : 'PASS real adapter/core: native skill_search unavailable; full catalog retained with selector mounted and disposed; new skill advertised and loaded without registration (search-only assertions not applicable)')
} finally {
  if (disposeSelector) await disposeSelector()
  if (scope) await scope.dispose()
  await root.fiber.dispose()
  if (provider) await provider.dispose()
  await rm(temp, { recursive: true, force: true })
  console.log(`Cleaned ${temp}; watchers disabled; no live session or service`)
}
