import { realpathSync } from 'node:fs'
import { DEFAULT_ROOT_NAMES, DEFAULT_SHARED_ROOTS, selectCatalog } from './logic.js'

/** Thin consumer of the native summary-selection hook; never rewrites messages. */
export default function createHost({ z }) {
  const Config = z.object({
    sharedRoots: z.array(z.string()).default([...DEFAULT_SHARED_ROOTS]),
    rootNames: z.array(z.string()).default([...DEFAULT_ROOT_NAMES]),
    // Deprecated migration inputs: accepted but never read or applied.
    skillRoot: z.string(),
    extraRoots: z.array(z.string()),
    packsFile: z.string(),
  })
  function apply(ctx, config = {}) {
    const policy = {
      sharedRoots: config.sharedRoots ?? DEFAULT_SHARED_ROOTS,
      rootNames: config.rootNames ?? DEFAULT_ROOT_NAMES,
    }
    ctx.on('agent/skill-catalog', async ({ searchAvailable, signal }, next) => {
      const skills = await next()
      signal?.throwIfAborted()
      // Core checks the exact native search registration, including scoped shadows.
      if (searchAvailable !== true) return skills
      const paths = new Map()
      const canonicalPath = path => {
        if (!paths.has(path)) {
          try { paths.set(path, realpathSync(path)) }
          catch { paths.set(path, undefined) } // Unresolved provenance must not hide skills.
        }
        return paths.get(path)
      }
      return selectCatalog(skills, policy, canonicalPath)
    })
  }
  return { name: 'skill-router', inject: [], Config, apply }
}
