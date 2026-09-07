import assert from 'node:assert/strict'
import { selectCatalog } from '../lib/logic.js'
const local = (name, path) => Object.freeze({ name, resourceBase: { kind: 'directory', path } })
const items = Object.freeze([
  local('new-child', '/shared/new-child'), local('skill-discovery', '/shared/skill-discovery'),
  local('project', '/project/skill'), local('prefix', '/shared-other/skill'),
  { name: 'url', resourceBase: { kind: 'url', url: 'https://example.invalid/shared' } },
  { name: 'opaque', resourceBase: { kind: 'opaque', description: '/shared/opaque' } },
  { name: 'unknown' }, local('relative', 'shared/relative'), local('missing', '/missing'),
])
const canonical = path => path === '/missing' ? undefined : path
const policy = { sharedRoots: ['/shared'], rootNames: ['skill-discovery'] }
assert.deepEqual(selectCatalog(items, policy, canonical), items.slice(1))
assert.equal(selectCatalog(items, policy, canonical)[0], items[1])
assert.deepEqual(selectCatalog(items, { ...policy, sharedRoots: ['/missing'] }, canonical), items)
assert.deepEqual(selectCatalog(items, { ...policy, sharedRoots: ['shared'] }, canonical), items)
console.log('logic.test.mjs: provenance, path boundaries, unknown fallback and object identity passed')
