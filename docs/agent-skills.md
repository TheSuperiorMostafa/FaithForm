# FaithForm project skills

Updated October 2, 2026. Canonical skills are in `.agents/skills/`; `.claude/skills/` contains
relative links to the same folders. Codex and Claude use one maintained source per skill.
Use a skill when its description matches the task; detailed reference files stay on demand.
No skill introduces a universal testing, review, delegation, SDK-upgrade, or production-action gate.

## Active skills

- [android-permissions-security](../.agents/skills/android-permissions-security/SKILL.md)
- [edge-to-edge](../.agents/skills/edge-to-edge/SKILL.md)
- [faithform-attendance](../.agents/skills/faithform-attendance/SKILL.md)
- [faithform-church-privacy](../.agents/skills/faithform-church-privacy/SKILL.md)
- [faithform-dashboard-ui](../.agents/skills/faithform-dashboard-ui/SKILL.md)
- [faithform-giving-state](../.agents/skills/faithform-giving-state/SKILL.md)
- [faithform-migration-safety](../.agents/skills/faithform-migration-safety/SKILL.md)
- [faithform-mobile-parity](../.agents/skills/faithform-mobile-parity/SKILL.md)
- [faithform-release-readiness](../.agents/skills/faithform-release-readiness/SKILL.md)
- [stripe-best-practices](../.agents/skills/stripe-best-practices/SKILL.md)
- [supabase-postgres-best-practices](../.agents/skills/supabase-postgres-best-practices/SKILL.md)
- [swiftui-expert-skill](../.agents/skills/swiftui-expert-skill/SKILL.md)
- [vercel-react-best-practices](../.agents/skills/vercel-react-best-practices/SKILL.md)

## Sources and local adaptations

- [Vercel React performance](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices).
- [Supabase Postgres](https://github.com/supabase/agent-skills/tree/main/skills/supabase-postgres-best-practices).
- [Stripe integrations](https://github.com/stripe/ai/tree/main/providers/claude/plugin/skills/stripe-best-practices).
- [SwiftUI Expert](https://github.com/AvdLee/SwiftUI-Agent-Skill/tree/main/skills/swiftui-expert-skill).
- [Official Android permissions and edge-to-edge workflows](https://github.com/android/skills).

Each vendor copy is pinned to a commit in `SOURCE.json`, also recorded in
`.agents/skills-manifest.json`. Original entry content is retained as `UPSTREAM.md`.
Available upstream licenses are included (Vercel declares MIT in its original frontmatter).
Local entrypoints narrow activation and route to topic-specific references; they preserve project
versions and deployment targets. SDK/API upgrades, whole-app migrations, and provider mutations
are separate tasks. No installer or vendor script was executed inside either application's runtime.
The SwiftUI reference contains profiling scripts, available only for an actual profiling request.

Project-specific skills encode local authority boundaries and source paths. FaithForm's staff/
visitor identities, giving state, attendance convergence, mobile parity, and loading/Safari rules
are separate from Pivorta's company isolation, quotes/signing, V4 composites, and native targets.
Existing browser tools cover interaction checks; an additional Playwright skill would duplicate
that capability. Project security skills cover the actual tenant/trust boundaries rather than
adding an overlapping generic audit pack.

## Discovery cost and verification

Active skills: 0 → 13. Name/description characters: 0 → 1,879. This measures discoverable metadata, not actual session billing. Character/4 token estimates are approximate; tools may cap or trim catalogs. No behaviour or cost benchmark was run.

All 27 prepared skill entrypoints passed the skill-creator validator; local references and UI metadata were checked. The installation changes instructions only; no application build, paid API request, deployment, database migration, or store submission was needed.
