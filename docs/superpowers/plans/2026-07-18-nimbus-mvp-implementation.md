# Nimbus MVP Implementation Plan

**Status:** Ready for implementation orchestration  
**Date:** 2026-07-18  
**Product contract:** `CONTEXT.md` and `docs/superpowers/specs/2026-07-18-nimbus-mvp-design.md`

## Delivery rule

Implement the approved contract as a migration of the existing prototype, not as a second architecture.
Remove the legacy Decision Room, browser chat, YAML payload sections, direct Decision-to-code mappings,
generic implementation progress, and combined Implementation/Handoff review as their replacements land.

The main Codex task is the integrator. Packages 1 and 2 use separate Terra High workers with disjoint write
scopes. The integrator reviews each returned diff and runs its package gate before dependent work begins.
Do not commit unless the developer explicitly requests it.

## Package 0: Baseline and boundaries

**Owner:** Integrator  
**Dependencies:** None

1. Capture `git status`, existing test results, and all pre-existing user changes.
2. Treat the approved spec and vocabulary as authoritative over legacy source terminology.
3. Confirm worker write scopes before spawning; never let two workers edit the same files concurrently.
4. Keep the deterministic demo runnable after every integrated package.

**Gate:** Existing failures and dirty files are understood without reverting user work.

## Package 1: User-visible Codex task gateway

**Owner:** Terra High Codex integration worker  
**Dependencies:** Package 0  
**May run parallel with:** Package 2

Prove and implement task orchestration against the developer's running Codex app before the broader
migration. A private standalone app-server whose tasks do not appear in Codex is a failed gate, not a
fallback.

**Primary write scope**

- `src/server/codex/**`
- `tests/codex/**`

**Required behavior**

- Discover one unambiguous Orchestrator task through the supported app integration.
- Use `model/list`; never silently substitute a model.
- Use `thread/start` for Phase and Publisher tasks and true `thread/fork` from an Owning Phase Task's latest
  completed turn for Investigations.
- Start and resume tasks that are visible and openable in the Codex app.
- Supply bounded context packets and fixed Nimbus Methods.
- Navigate through `codex://threads/<task-id>` and never construct editor-specific links.
- Fail explicitly when the app bridge, model, task, fork point, or navigation target is unavailable.
- Do not rebuild browser message streaming or a read-only Decision Room.

**Gate:** A live desktop smoke lists models, starts a model-confirmed user-visible Phase task, forks a
user-visible Investigation, resumes both, and opens them in Codex.

## Package 2: Canonical Work Item foundation

**Owner:** Terra High foundation worker  
**Dependencies:** Package 0  
**May run parallel with:** Package 1

Replace the legacy YAML-section model with the approved typed domain and human-readable Markdown AST
contract.

**Primary write scope**

- `src/shared/model.ts`
- `src/core/work-item-markdown.ts`
- new pure core modules for artifact lookup, validation, hashing, and semantic updates
- `src/server/markdown-store.ts`
- `examples/**`
- `docs/nimbus/NIM-001.md`
- `tests/core/**`
- `tests/fixtures/**`
- Markdown AST dependencies in `package.json` and `package-lock.json`

**Required behavior**

- Canonical sections are Brief, Decisions, Plan, Implementation, and Handoff.
- YAML front matter contains metadata and task IDs only.
- Visible IDs use `D-01`, `D-01/A`, `P-01`, and `IR-01`; retired IDs are not reused.
- Current Decision answers precede collapsed, timestamped Revision history.
- Published Investigation conclusions remain inline under their owner without transcripts or IDs.
- Decision mapping is transitive through Plan Items and Implementation Results.
- Review and derived Comprehension concepts do not become duplicate Markdown sections.
- Every structured mutation includes `expectedDocumentHash`; writes re-read and hash the current file,
  reject stale updates, validate semantics, and apply one pure mutation.

**Gate:** Markdown round-trip, malformed structure, stale hash, invalid/reused ID, invalid relationship,
manual-edit compatibility, and transcript-leakage integration tests pass.

## Package 3: Runtime and phase protocol

**Owner:** Runtime worker  
**Dependencies:** Packages 1 and 2

Replace the five legacy MCP operations and demo shortcuts with the approved single-purpose protocol,
connected to the proven task gateway and canonical Work Item compiler.

**Primary write scope**

- `src/server/mcp/**`
- `src/server/http/**`
- `src/server/mcp/runtime-manager.ts`
- `src/server/demo.ts`
- `tests/server/**`
- `scripts/smoke-plugin-runtime.ts`

**Required behavior**

- Implement the nine MCP tools listed in the product spec.
- Require browser model confirmation before every new Phase, Investigation, or Publisher task; resume
  existing tasks without reconfirmation.
- Keep launch confirmation, Plan annotations, draft diffs, active-item phrases, correction drafts, and
  publication attempts out of canonical Markdown.
- Permit exactly one active Plan Item; only `report_implementation_item` persists its completed Result.
- Batch Plan annotations into one Plan Change Set and corrections into one Implementation Change Set.
- Keep the Accepted Plan immutable after Implementation starts.
- Derive Review by exception and make Handoff acceptance the Work Item completion boundary.
- Return specific errors for invalid phases, stale hashes, expired artifacts, and malformed input.

**Gate:** MCP-to-runtime integration reaches accepted Handoff with one Investigation publication, Plan
revision, implementation deviation, and Review correction loop.

## Package 4: Browser control plane

**Owner:** Frontend worker  
**Dependencies:** Package 3 API contracts  
**May run parallel with:** Package 5 after contracts and write scopes are frozen

Replace the Decision chat split view with the five approved phase surfaces.

**Primary write scope**

- `src/app/**`
- `src/components/nimbus/**`
- `src/index.css`
- browser presentation helpers
- `tests/e2e/**`

**Required behavior**

- Open to one Work Item with `Grill | Plan | Implement | Review | Handoff` navigation.
- Grill uses a progressive React Flow tree and readable details, with no browser chat.
- Actions that create tasks show model confirmation and then return the developer to Codex.
- Plan renders one complete Markdown document with annotations, one revision submission, and diff.
- Implement lists ordered Plan Items with one stable spinner and short activity phrase; a persisted Result
  replaces activity only after implementation is reported.
- Review shows complete mapping by exception and supports accept, Investigate, and request correction.
- Handoff shows completion independently from optional publication; evidence returns to Codex.
- Desktop and mobile layouts have stable dimensions and no overlapping text.

**Gate:** Deterministic Playwright journey passes at desktop and mobile viewports with screenshots and
overlap checks.

## Package 5: Real Handoff Site publication

**Owner:** Terra High integration worker  
**Dependencies:** Packages 1, 2, and 3  
**May run parallel with:** Package 4; the integrator owns narrow browser wiring after both return

Implement the optional Delivery Action as a real Codex Publisher task using the Sites plugin.

**Primary write scope**

- new `src/server/publish/**`
- publication-specific integration tests
- Publisher Method and bounded context packet

**Required behavior**

- Start only after accepted Handoff completion and browser model confirmation.
- Create a transient single-use attempt bound to Work Item ID and accepted-Handoff digest.
- Send the Publisher task only the bounded packet and attempt token.
- Require Sites deployment and return the URL through `record_handoff_site`.
- Reject stale attempts and non-HTTPS URLs.
- Retry real reachability requests with warnings, raise the final error, and provide no placeholder fallback.
- Open the reachable Site, then persist its URL under `Delivery actions`.
- Keep failed attempts retryable without reopening the Handoff.

**Gate:** A live Codex run creates and opens a real hosted Site, checks it against the Handoff packet, and
confirms the identical URL is canonical Markdown. Scripted URLs cannot satisfy this gate.

## Package 6: Final integration and removal

**Owner:** Integrator with independent Terra High review  
**Dependencies:** Packages 1-5

1. Remove superseded Decision Room, message, YAML payload, fidelity, legacy MCP, and demo advance code.
2. Reconcile plugin metadata, README, testing guide, skill, and fixture with implemented behavior.
3. Run formatter, typecheck, tests, build, plugin runtime smoke, Playwright, and plugin validation.
4. Run the complete manual Codex journey, including the live Site gate.
5. Review the final diff against every acceptance criterion and report any residual limitation.

**Gate:** All local commands pass, both viewports are visually inspected, and the live Site remains
reachable from its persisted URL.

## Orchestration order

```text
Package 0
   |
   +---- Package 1 ----+
   |                    |
   +---- Package 2 ----+
                        |
                    Package 3
                        |
   +---- Package 4 ----+
   |                    |
   +---- Package 5 ----+
                        |
                    Package 6
```

Package 1 is the highest-risk feasibility gate and Package 2 is the data-foundation gate. Run them in
parallel with separate Terra High workers and disjoint files. Package 3 begins only after both pass.
Packages 4 and 5 may then run concurrently after shared contracts are frozen; the integrator performs the
narrow publication UI wiring before Package 6.
