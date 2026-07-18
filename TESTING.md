# Testing Nimbus

Nimbus has two acceptance layers:

1. A deterministic local journey for fast browser, Markdown, runtime, and task-orchestration development.
2. A live Codex journey that proves real task creation, navigation, and Sites publication.

The deterministic journey may simulate external Codex task responses. It must never be used as evidence
that `Publish Handoff Site` works.

## Local product journey

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and exercise one seeded Work Item:

1. Confirm the browser opens directly to the Work Item and contains no chat composer.
2. Inspect a Grill Decision's readable context, Options, concrete effects, pros, cons, and recommendation.
3. Select an Option and confirm the accepted path remains visible while the next Decision appears.
4. Launch the Investigation confirmation surface and confirm that a model must be selected before launch.
5. Review the full Plan, add annotations, request one revision, inspect the diff, and approve it.
6. Start Implementation and confirm exactly one Plan Item displays transient activity.
7. Report that item and confirm the spinner is replaced by its actual result, deviation, and file-line evidence.
8. Complete the remaining Plan Items and inspect Review's mapping-by-exception view.
9. Request one correction, return to Implementation, report it, and return to Review.
10. Accept the Handoff and confirm the Work Item is complete before any publication action.
11. Inspect `docs/nimbus/NIM-001.md` and confirm only canonical accepted state was persisted.

The seeded Work Item and deterministic responses must cover one Decision revision, one published
Investigation conclusion, one implementation deviation, one correction loop, and one unresolved concern.

## Automated verification

```sh
npx playwright install chromium
npm run typecheck
npm test
npm run build
npm run test:plugin-runtime
npm run test:e2e
node scripts/validate-plugin.mjs
```

Required automated coverage:

- Markdown AST round-trip and semantic validation over a complete Work Item.
- Stale updates, invalid or reused IDs, invalid references, path traversal, and invalid line ranges.
- Plan Change Set batching and full-document diff behavior.
- Exactly one active Plan Item and one persisted Implementation Result per Plan Item.
- Investigation publication without transcript leakage.
- Review correction round trip without a duplicate Review Markdown section.
- Desktop and mobile Playwright journeys with screenshots and overlap checks.
- Plugin manifest, production bundle, local runtime, API, and browser shell.

## Live Codex journey

Run this journey from the installed Nimbus plugin in the Codex app:

1. Start a normal coding request with an explicit `$nimbus` invocation.
2. Confirm a model and launch each new Grill, Plan, Implement, and Review task.
3. From one artifact, confirm an Investigation model and create a true forked Codex task.
4. Publish one approved conclusion and confirm only its compact result enters the Work Item.
5. Complete Implementation, Review, and Handoff; confirm the Work Item is complete.
6. Choose `Publish Handoff Site`, confirm a model, and launch the fresh Publisher task.
7. Confirm the task uses the Sites plugin to generate and host the explainer.
8. Confirm Nimbus receives the returned URL and successfully opens the hosted Site.
9. Inspect the Site for the outcome, Decision rationale, Plan-to-Implementation mapping, mental-model
   changes, evidence, and unresolved concerns.
10. Confirm the same working URL is persisted under the Handoff's `Delivery actions`.

The live journey fails if the Publisher task is simulated, the URL is missing or unreachable, the Site
does not represent the accepted Handoff packet, or the URL is not persisted. Publication failure must be
shown explicitly without reopening or invalidating the accepted Handoff.

## Target MCP surface

- `open_work_item`
- `present_decision`
- `present_plan`
- `begin_plan_item`
- `report_implementation_item`
- `present_review`
- `publish_investigation_conclusion`
- `present_handoff`
- `record_handoff_site`

The approved responsibilities and failure behavior for these tools are defined in the
[MVP design](./docs/superpowers/specs/2026-07-18-nimbus-mvp-design.md).
