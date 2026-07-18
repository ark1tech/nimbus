---
name: nimbus-work-item
description: Run the opinionated Nimbus Work Item workflow only when the user explicitly invokes $nimbus.
---

# Nimbus Work Item

Use Nimbus only after an explicit `$nimbus` invocation. Nimbus coordinates one Work Item across separate
Codex tasks while a local browser visualizes state and initiates structured actions. Keep all conversation,
reasoning, implementation, and review in Codex; never add browser chat.

## Fixed method

Nimbus does not offer a skill picker in the MVP. Apply the fixed phase Methods:

- **Nimbus Grill:** challenge the request against repository context and ask one consequential Decision at
  a time using readable context, credible Options, concrete effects, pros, cons, and a recommendation.
- **Nimbus Plan:** produce the smallest executable full-document Plan that honors accepted Decisions.
- **Nimbus Implement:** execute one Plan Item at a time and report the actual result, deviation, and
  repository-relative file-line evidence only after that item is implemented.
- **Nimbus Review:** reconcile accepted intent with implementation evidence, prioritize exceptions, and
  request explicit corrections when necessary.
- **Nimbus Investigation:** deeply interrogate one artifact in a forked task and publish only the approved
  conclusion.
- **Nimbus Publish:** turn the accepted Handoff packet into a real hosted explainer through the Sites
  plugin and return its working URL.

## Orchestrate the Work Item

1. Inspect the repository and its governing documentation.
2. Open or resume the canonical Work Item with `open_work_item`.
3. Before creating every new Phase or Investigation task, send the browser a launch confirmation and wait
   for the developer to confirm the model. Resuming an existing task does not require reconfirmation.
4. Launch bounded Grill, Plan, Implement, and Review tasks. Use the Work Item Orchestrator only for phase
   transitions; return browser actions to the Owning Phase Task.
5. Persist accepted updates only through Nimbus MCP. Nimbus re-reads and validates the Markdown before
   every write.

## Run the phases

1. **Grill:** call `present_decision` for one genuine Decision and wait for the browser selection before
   asking the next question.
2. **Plan:** call `present_plan` with one complete Markdown Plan. Apply submitted annotations and published
   Investigation conclusions as one Plan Change Set. Do not implement before approval.
3. **Implement:** call `begin_plan_item` for exactly one Plan Item. After it is implemented, call
   `report_implementation_item` with its actual result, deviation, and file-line evidence. Transient
   activity is browser-only and must not enter Markdown.
4. **Review:** call `present_review` with the derived complete mapping. A submitted correction set resumes
   the existing Implementation task and returns to Review afterward.
5. **Handoff:** call `present_handoff` with the reviewed outcome, Decisions, deviations, contracts,
   unresolved work, and next actions. Acceptance completes the Work Item.
6. **Publish:** only when requested, launch a fresh model-confirmed Publisher task using the Sites plugin.
   Open the returned Site successfully before `record_handoff_site` persists its URL. Failure is explicit
   and does not change Handoff acceptance.

## Investigations

An Investigation may be rooted at the Work Item, a Decision, Decision Option, Plan Item, or Implementation
Result. Fork the latest completed turn of its Owning Phase Task and add only focused artifact context. Keep
the full transcript isolated. Persist a conclusion only after explicit developer approval, including its
rationale, relevant evidence, unresolved risk, and Codex task link.

## Canonical record

- Keep exactly one human-readable file at `docs/nimbus/<work-item-id>.md`.
- Keep YAML front matter limited to document and task metadata.
- Use immutable visible IDs: `D-01`, `D-01/A`, `P-01`, and `IR-01`.
- Preserve the current Decision answer first and older accepted answers in collapsed Revision history.
- Never retroactively rewrite the Accepted Plan after Implementation starts.
- Map evidence transitively: `Decision -> Plan Item -> Implementation Result -> Evidence Link`.
- Do not persist transcripts, transient activity, draft Plans, annotations awaiting submission, a duplicate
  Review section, or derived Comprehension views.
