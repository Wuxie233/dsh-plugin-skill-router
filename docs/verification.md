# Summary selector verification

The selector requires core's `agent/skill-catalog` hook and `searchAvailable` flag. Core owns the native `skill_search` implementation and must validate returned summaries as an original-object subset. This plugin does not change loader permission or catalog messages.

| Surface | Check |
| --- | --- |
| Shared provenance | Only directory resource bases whose real paths are under configured roots are filtered; unknown, URL, opaque and missing paths remain advertised. |
| Discovery fallback | Missing or shadowed native search produces the complete catalog. |
| Source integrity | Core renders entries and text from the same selected summaries. |
| New skills | A newly created provider skill is searchable and loadable without pack or routing registration. |
| Removal | Disposing the selector restores the full native catalog. |
| Body reads | Host fixture intentionally contains no SKILL.md; selection only resolves directories. |
| Old configuration | Deprecated pack/root fields are accepted and ignored, with no file access. |

Run `node scripts/logic.test.mjs`, `node scripts/host.test.mjs`, and `DSH_HARNESS_ROOT=/path/to/compatible/harness node scripts/core.test.mjs`. The integration fixture uses actual core/provider/tool/admission code in an isolated Session. It does not boot a live profile, call a model, or restart services. Runtime activation remains a separate deployment check.

Catalog refreshes remain core-owned; no claim is made that historical catalog messages are physically removed from the model surface. Core's search permission, scoped shadow handling and provider invalidation have additional tests in the owning harness repository.
