---
name: faithform-dashboard-ui
description: Use when creating or redesigning FaithForm dashboard pages, their loading states, or constrained dialogs/forms.
---

# FaithForm dashboard and loading

Project `AGENTS.md` is the canonical loading/Safari policy; do not duplicate it with looser rules.
Read `docs/ux/DASHBOARD_UX_CHECKLIST.md` for dashboard changes and the full simplicity standard
only for the specific design question. Use existing UI primitives, plain church language,
visible labelled actions, and understandable error/empty/success states.

The shell owns width; loading and resolved geometry must match. Static chrome renders immediately;
only dynamic data shimmers through shared accessible skeleton primitives. A newly designed page
includes its matching fallback in the same change, with reserved scrollbar space and reduced motion.

For auto-height constrained dialog changes, preserve the form/body min-height and flex-auto chain,
visible fixed chrome, viewport cap, and a scroll owner with real height. Test the affected short/long
content and small viewport in available WebKit/Safari; local WebKit does not prove the reported
Safari version is fixed. No whole-dashboard browser audit for every cosmetic edit.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
