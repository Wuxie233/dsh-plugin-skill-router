import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import {
  catalogLineNames,
  embedPackKey,
  hiddenNames,
  packHides,
  packKeyOf,
  parseEnabledPacks,
  parseLooseYaml,
  parsePacksTable,
  projectPrivateVisible,
  readPackKey,
  renderFilteredCatalog,
  rewriteCatalogText,
} from '../lib/logic.js'

const table = parsePacksTable({
  alwaysOn: ['host-ops', 'engineering-crosscut'],
  packs: {
    'host-ops': {
      alwaysOn: true,
      catalog: 'host-ops-router',
      members: ['playwright', 'skill-creator'],
    },
    'engineering-crosscut': {
      alwaysOn: true,
      catalog: 'independent',
      members: ['writing', 'wait-what'],
    },
    frontend: {
      alwaysOn: false,
      catalog: 'frontend-design-router',
      members: ['apple-design', 'emil-design-eng'],
    },
    mc: {
      alwaysOn: false,
      catalog: 'mc-bedrock-architecture-router',
      members: ['mc-bedrock-syntax-guard'],
    },
    'writing-polish': {
      alwaysOn: false,
      catalog: 'independent',
      members: ['humanizer', 'stop-slop'],
    },
    rest: {
      alwaysOn: false,
      catalog: 'named-load',
      members: [
        'learning-router',
        'frontend-craft-learning-expert',
        'bilibili-context',
        'cumcm-academic-writing',
      ],
    },
  },
  projectPrivate: {
    'tooldelta-agent-bridge': {
      home: '/root/CODE/Minecraft/ToolDelta-plugins',
      enablingPack: 'mc',
    },
    'sub2api-update': {
      home: '/root/CODE/sub2api-fork',
    },
  },
})

function none() {
  return new Set()
}

// --- No Repo / default catalog ---
assert.equal(packHides('grill-with-docs', table, none(), ['/root/.dsh/no-repo']), false)
assert.equal(packHides('writing', table, none(), ['/root/.dsh/no-repo']), false)
assert.equal(packHides('host-ops-router', table, none(), ['/root/.dsh/no-repo']), false)
assert.equal(packHides('playwright', table, none(), ['/root/.dsh/no-repo']), false)
assert.equal(packHides('gsap-router', table, none(), ['/root/.dsh/no-repo']), false)
assert.equal(packHides('humanizer', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('bilibili-context', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('frontend-design-router', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('mc-bedrock-architecture-router', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('learning-router', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('tooldelta-agent-bridge', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('sub2api-update', table, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('apple-design', table, none(), ['/root/.dsh/no-repo']), true)

// --- Minecraft opens mc ---
const mcPacks = parseEnabledPacks({ packs: ['host-ops', 'engineering-crosscut', 'mc'] })
assert.equal(packHides('mc-bedrock-architecture-router', table, mcPacks, ['/root/CODE/Minecraft']), false)
assert.equal(packHides('mc-bedrock-syntax-guard', table, mcPacks, ['/root/CODE/Minecraft']), true, 'routed child stays hidden even when pack is open')
assert.equal(packHides('humanizer', table, mcPacks, ['/root/CODE/Minecraft']), true)
assert.equal(packHides('tooldelta-agent-bridge', table, mcPacks, ['/root/CODE/Minecraft']), false, 'enabling pack mc reveals the project-private skill')
assert.equal(packHides('sub2api-update', table, mcPacks, ['/root/CODE/Minecraft']), true)

// --- ToolDelta home reveals without listing packs ---
assert.equal(
  projectPrivateVisible(table.projectPrivate.get('tooldelta-agent-bridge'), ['/root/CODE/Minecraft/ToolDelta-plugins'], none()),
  true,
)
assert.equal(
  packHides('tooldelta-agent-bridge', table, none(), ['/root/CODE/Minecraft/ToolDelta-plugins']),
  false,
)

// --- sub2api home ---
assert.equal(packHides('sub2api-update', table, none(), ['/root/CODE/sub2api-fork']), false)
assert.equal(packHides('sub2api-update', table, none(), ['/root/CODE/sub2api-fork/packages/web']), false)

// --- rest open: router + independents, not learning children ---
const restPacks = parseEnabledPacks({ packs: ['rest'] })
assert.equal(packHides('learning-router', table, restPacks, ['/tmp/paper']), false)
assert.equal(packHides('bilibili-context', table, restPacks, ['/tmp/paper']), false)
assert.equal(packHides('cumcm-academic-writing', table, restPacks, ['/tmp/paper']), false)
assert.equal(packHides('frontend-craft-learning-expert', table, restPacks, ['/tmp/paper']), true)
assert.equal(packHides('humanizer', table, restPacks, ['/tmp/paper']), true)

// --- writing-polish open: independents visible ---
const polish = parseEnabledPacks({ packs: ['writing-polish'] })
assert.equal(packHides('humanizer', table, polish, ['/tmp/blog']), false)
assert.equal(packHides('stop-slop', table, polish, ['/tmp/blog']), false)
assert.equal(packHides('frontend-design-router', table, polish, ['/tmp/blog']), true)

// --- frontend open: router visible, members still pack-hidden here
//     (routing layer hides them once routers: is set; pack layer also hides
//     members that are not the catalog entry)
const fe = parseEnabledPacks({ packs: ['frontend'] })
assert.equal(packHides('frontend-design-router', table, fe, ['/tmp/ui']), false)
assert.equal(packHides('apple-design', table, fe, ['/tmp/ui']), true)

// --- extraRoots union: backend cwd + Minecraft folder ---
const unionPacks = parseEnabledPacks({ packs: ['mc'] })
assert.equal(
  packHides('mc-bedrock-architecture-router', table, unionPacks, ['/tmp/backend', '/root/CODE/Minecraft']),
  false,
)

// --- packKey stability ---
assert.equal(packKeyOf(['mc', 'host-ops']), packKeyOf(['host-ops', 'mc', 'host-ops']))
assert.notEqual(packKeyOf(['mc']), packKeyOf([]))

// --- rewrite keeps entries out of the prose, appends hint ---
const catalog = [
  '<system-reminder>',
  '<available_skills>',
  '- `writing`: Drafting prose.',
  '- `humanizer`: Remove AI taste.',
  '- `gsap-router`: Motion router.',
  '</available_skills>',
  'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation.',
  '</system-reminder>',
].join('\n')
const rewritten = rewriteCatalogText(catalog, new Set(['humanizer', 'gsap-router']))
assert.ok(rewritten.includes('`writing`'))
assert.equal(rewritten.includes('`humanizer`'), false)
assert.equal(rewritten.includes('`gsap-router`'), false)
assert.ok(rewritten.includes('Some skills are not listed here'))
assert.deepEqual(catalogLineNames(rewritten), ['writing'])

const routed = new Set(['playwright'])
const hidden = hiddenNames(
  routed,
  ['writing', 'playwright', 'humanizer', 'grill-with-docs'],
  table,
  none(),
  ['/root/.dsh/no-repo'],
)
assert.ok(hidden.has('playwright'))
assert.ok(hidden.has('humanizer'))
assert.equal(hidden.has('writing'), false)
assert.equal(hidden.has('grill-with-docs'), false)

// --- packKey comment survives rewrite and round-trips ---
const keyed = embedPackKey(rewritten, 'engineering-crosscut,host-ops')
assert.equal(readPackKey(keyed), 'engineering-crosscut,host-ops')
assert.equal(readPackKey(embedPackKey(keyed, 'mc')), 'mc')
assert.equal(keyed.includes('<system-reminder>\n<!-- dsh-pack-key:'), true)

// --- rebuild from full entries, never re-filter already-hidden prose ---
const rebuilt = renderFilteredCatalog(
  [
    { name: 'writing', description: 'Drafting prose.' },
    { name: 'humanizer', description: 'Remove AI taste.' },
    { name: 'gsap-router', description: 'Motion router.' },
  ],
  new Set(['humanizer', 'gsap-router']),
  { update: true },
)
assert.ok(rebuilt.includes('`writing`'))
assert.equal(rebuilt.includes('`humanizer`'), false)
assert.ok(rebuilt.includes('The available skill catalog changed'))
assert.ok(rebuilt.includes('Some skills are not listed here'))

// --- real packs.yml + Minecraft skill-packs.yml parse ---
const realPacks = parsePacksTable(parseLooseYaml(
  readFileSync('/root/CODE/agent-habits/skills/skill-topology/packs.yml', 'utf8'),
))
assert.equal(realPacks.alwaysOn.has('host-ops'), true)
assert.equal(realPacks.catalogNames.get('gsap-router'), 'gsap')
assert.equal(realPacks.nameToPack.get('writing-dna-skill'), 'writing-polish')
assert.equal(realPacks.nameToPack.get('lieflat-less-ai-tone'), 'writing-polish')
assert.equal(realPacks.nameToPack.get('mcbe-text-render'), 'mc')
assert.equal(realPacks.independentWhenOpen.get('rest')?.has('learning-router'), true)
assert.equal(realPacks.independentWhenOpen.get('rest')?.has('frontend-craft-learning-expert'), false)
assert.equal(realPacks.projectPrivate.get('sub2api-update')?.home, '/root/CODE/sub2api-fork')

const mcFile = parseEnabledPacks(parseLooseYaml(
  readFileSync('/root/CODE/Minecraft/.dsh/skill-packs.yml', 'utf8'),
))
assert.equal(mcFile.has('mc'), true)
assert.equal(packHides('mc-bedrock-architecture-router', realPacks, mcFile, ['/root/CODE/Minecraft']), false)
assert.equal(packHides('writing-dna-skill', realPacks, none(), ['/root/.dsh/no-repo']), true)
assert.equal(packHides('grill-with-docs', realPacks, none(), ['/root/.dsh/no-repo']), false)

console.log('logic.test.mjs: ok')
