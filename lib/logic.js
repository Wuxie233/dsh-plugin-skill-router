/** Summary-only catalog selection; the native loader and search own invocation. */
import { isAbsolute, relative, sep } from 'node:path'

export const DEFAULT_SHARED_ROOTS = Object.freeze(['/root/CODE/agent-skills/skills'])
export const DEFAULT_ROOT_NAMES = Object.freeze([
  'skill-discovery', 'host-ops-router', 'frontend-design-router', 'gsap-router',
  'mc-bedrock-architecture-router', 'learning-router',
])

/** A directory locator proves filesystem provenance; URLs and opaque hints do not. */
export function sharedSkill(summary, roots, canonicalPath) {
  const base = summary.resourceBase
  if (base?.kind !== 'directory' || typeof base.path !== 'string' || !isAbsolute(base.path)) return false
  const directory = canonicalPath(base.path)
  if (directory === undefined) return false
  return roots.some(root => {
    if (!isAbsolute(root)) return false
    const resolved = canonicalPath(root)
    if (resolved === undefined) return false
    const tail = relative(resolved, directory)
    return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
  })
}

/** Return original summary objects, in original order. Unknown provenance stays advertised. */
export function selectCatalog(skills, { sharedRoots, rootNames }, canonicalPath) {
  const names = new Set(rootNames)
  return skills.filter(skill => names.has(skill.name) || !sharedSkill(skill, sharedRoots, canonicalPath))
}
