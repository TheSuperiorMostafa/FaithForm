# Agent instruction refresh

Reviewed October 2, 2026 for FaithForm and Pivorta (the ATLAS repository), plus personal Codex and Claude Code guidance.

## Research and decision

The useful pattern is a short, project-specific instruction file, with detailed workflows loaded only when relevant. There is no universal best Markdown template or evidence that all newer models should stop testing.

- [OpenAI: Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra), September 11, 2026: reduce accumulated scaffolding, use contextual document pointers, and remove redundant encouragement to check work/run tests. Its automatic-testing observation is specifically about Astra; these project instructions remain model-agnostic rather than asserting identical behaviour for every model.
- [Anthropic: Claude Code best practices](https://code.claude.com/docs/en/best-practices): keep broadly loaded instructions concise, include project-specific gotchas, exclude generic advice and copied manuals, and prefer focused tests when appropriate. This supports proportionate validation rather than eliminating evidence of correctness.
- [Anthropic: project memory](https://code.claude.com/docs/en/memory): a `CLAUDE.md` containing `@AGENTS.md` shares one source across coding tools. Rules under `.claude/rules/` load automatically; moving optional reference material outside that directory prevents blanket procedures from entering ordinary tasks.
- [OpenAI: AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md): Codex discovers `AGENTS.md` and configured fallback filenames. `CODEX.md` is not a default entrypoint. Neither project had such a file, and the local Codex configuration had no custom fallback filenames.

GitHub research compared the [concise agents-md guide](https://github.com/farhadeidi/agents-md-guide), [Anbeeld's global template](https://github.com/Anbeeld/AGENTS.md), and [Codex's built-in prompt](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/prompts/base_instructions/default.md). These illustrate differing trade-offs; no third-party template was copied or adopted as binding policy. The project files preserve local constraints instead.

[Developer forum discussion](https://www.reddit.com/r/ClaudeCode/comments/1rohbj0/what_to_include_in_claudemd_and_what_not/) also favours minimal project gotchas and references. This is anecdotal context, not a benchmark or proof of model behaviour.

## Changes

- FaithForm: consolidate root `AGENTS.md` and `CLAUDE.md` into shared guidance. Preserve mandatory matching skeletons, static chrome, accessibility, timing, scrollbar stability, dashboard simplicity, and Safari sizing requirements, including the existing uncommitted Safari guidance. Replace the duplicated `.agents/rules/skeleton-loading.md` body with a canonical pointer.
- Pivorta: add root `AGENTS.md`; make `CLAUDE.md` import it. Remove blanket tests-per-edit, full-suite completion checks, graph reflection, stale repository counts, and old Node requirements. Preserve tenant isolation, authorization, billing/signing, legacy identifiers, native boundaries, migration safety, PDF tracing, and V4 replay gates.
- Pivorta imported rules: retain the ECC pack in `.claude/reference-rules/ecc/`, outside automatic rule loading. Its automatic agents, mandatory TDD/coverage, generic browser-suite prescriptions, and old model rankings conflicted with the intended workflow. The original source under `everything-claude-code/` remains separate.
- Pivorta skills: narrow `testing-and-verification`, `verification-loop`, and `agent-self-evaluation` triggers; remove the unconditional full-suite rerun in `code-review`. Other skills, hooks, permissions, and model settings are outside this change.
- Personal guidance: concise independent files at `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`; preserve the explicit `/graphify` convention. No cross-directory Claude import is needed.

Validation for this instruction-only change is file/import/path review and Markdown/frontmatter checks. Application builds, production calls, database resets, and behaviour benchmarks are unnecessary. Actual effects on future agent work are not established by syntax checks.

## Subagent delegation

Reviewed October 3, 2026. Selective delegation is supported; an always-delegate rule is not.
Context isolation can reduce clutter in the parent conversation and parallel work can
reduce elapsed time, but neither establishes lower total token consumption.

- [OpenAI subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents) recommends bounded, read-heavy parallel tasks and cautions about concurrent edits. Local Codex can delegate when applicable project instructions request it; the project policy now supplies that instruction.
- [OpenAI multi-agent guidance](https://developers.openai.com/api/docs/guides/responses-multi-agent) identifies independent workstreams as useful and explicitly warns that subagents can increase token usage. Small tasks, dependent steps, and shared mutable resources favour a single agent.
- [Claude Code subagent documentation](https://code.claude.com/docs/en/sub-agents) supports isolated, self-contained work with summarized output; quick changes and phases sharing substantial context suit the main conversation. Each child consumes its own tokens.
- [Anthropic's research-system report](https://www.anthropic.com/engineering/multi-agent-research-system) describes quality benefits for research alongside significant overhead. Its approximately 15x token comparison is against chat interactions in that system, not a universal comparison against a single coding agent.

Implementation: shared personal guidance and both project entrypoints authorize selective
delegation. One or two children is a conservative local starting policy, not a benchmarked
optimum. Bound briefs, minimize passed context, avoid duplicate work, separate write
ownership, and keep integration with the parent. No model changes or extra always-loaded
skills are needed. Instructions guide decisions; they do not enforce a token budget.

FaithForm: separate read-only investigations of web, iOS, and Android can run in
parallel. Native implementation can split after the API contract is agreed. Keep church
authorization, giving state, attendance convergence, and shared generated contracts under
coordinated ownership.

Validation covers instruction consistency, imports, links, and whitespace only. Actual
quality, latency, and token savings require comparable real task measurements; none are
claimed from this documentation change.
