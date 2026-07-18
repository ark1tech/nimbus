# Nimbus

Nimbus helps developers understand and guide coding-agent work by preserving the reasoning, intended
plan, actual implementation, and handoff for each piece of work.

## Language

**Work Item**:
A bounded piece of development work, such as a story, issue, feature, bug fix, or investigation. One Work
Item owns one durable record from initial brief through handoff.
_Avoid_: Mission, chat, session

**Work Item Markdown**:
The single canonical, human-readable document for a Work Item. Front matter contains only document
metadata; the body uses standardized Markdown headings and lists for Brief, Decisions, Plan,
Implementation, and Handoff. The Browser Workspace renders this document directly, without a duplicated
JSON record, YAML payload sections, or a sidecar data file.
_Avoid_: Work Item database, YAML document, browser cache

**Work Item Update**:
A structured mutation that a Phase Task or Browser Workspace submits to Nimbus. The runtime re-reads the
latest Work Item Markdown, validates all Artifact IDs and relationships, and applies the update as the
sole automated writer; stale or malformed updates fail explicitly. Developers may still edit the
Markdown manually between validated updates.
_Avoid_: Direct Phase Task file edit, blind overwrite, browser-owned state

**Artifact ID**:
A stable, human-visible reference assigned when a Decision, Decision Option, Plan Item, or Implementation
Result is created. Titles and content may change without changing the ID, and retired IDs are never
renumbered or reused. Examples include `D-01`, `D-01/A`, `P-02`, and `IR-03`.
_Avoid_: Heading slug, array index, display order

**Nimbus Invocation**:
The developer's explicit request to start or resume a Nimbus Work Item from a Codex prompt. Nimbus does
not activate implicitly during ordinary coding work.
_Avoid_: Automatic activation, prompt matching

**Work Item Orchestrator Task**:
The Codex app task opened by a Nimbus Invocation. It coordinates the Work Item, launches isolated Phase
Tasks, and receives their standardized results without inheriting their full working conversations.
_Avoid_: Phase Task, browser session

**Phase Task**:
A separate Codex app task responsible for one Work Item phase: Grilling, Planning, Implementation,
Review, or Handoff Site publication. It receives bounded Work Item context, a confirmed model, and the
fixed Method for that phase, then returns a standardized result to the Work Item Orchestrator Task.
_Avoid_: Investigation Task, Work Item Orchestrator Task

**Owning Phase Task**:
The Phase Task responsible for the artifact or action currently shown in the Browser Workspace. Browser
actions resume this task directly; only phase transitions return to the Work Item Orchestrator Task.
_Avoid_: Main Work Item conversation, browser worker

**Phase Protocol**:
The Nimbus-owned input, action, and output contract for a Phase Task. It defines the Work Item context a
phase receives, the structured results it must return, and the validations those results must satisfy,
without depending on the prose format produced during the phase.
_Avoid_: Phase Method, browser template, prompt convention

**Phase Method**:
The fixed Nimbus-owned skill that governs how one phase performs its work. Each phase has one opinionated
Method derived from proven planning, execution, or review principles; developers do not compose or select
skills in the MVP.
_Avoid_: Phase Protocol, user-selected skill, compatibility registry

**Task Launch Confirmation**:
The developer's explicit approval of the model Nimbus will use before creating a Phase Task or
Investigation Task. The fixed Nimbus Method is shown for transparency but is not configurable. Starting
a phase or Investigation requires confirmation; resuming an existing task does not.
_Avoid_: Global model preference, implicit model selection, skill picker

**Work Item Brief**:
The problem, goal, scope, constraints, and acceptance criteria for a Work Item. It defines what the work
must accomplish without prescribing the implementation.
_Avoid_: Overview, prompt

**Decision**:
A consequential choice with at least two credible directions where another choice would materially alter
the plan or implementation. During Grilling, one Decision is presented as a readable question with the
issue and relevant current environment as context. Requirements, constraints, and routine coding details
are not Decisions.
_Avoid_: Preference, task, plan step

**Decision Option**:
One credible answer to a Decision. It explains the direction, the concrete effects expected if selected,
and its advantages and trade-offs. An Option is prospective until the developer accepts it.
_Avoid_: Decision, implementation result

**Decision Path**:
The progressively revealed sequence of Decisions and accepted Decision Options produced by adaptive
Grilling. Earlier Decisions remain visible, rejected Options remain inspectable, and a later Decision is
added only after Codex receives the preceding answer.
_Avoid_: Upfront questionnaire, complete predicted tree

**Decision Revision**:
A later accepted answer to the same Decision. The current answer remains first and keeps the Decision's
stable ID; a collapsed, timestamped Revision history preserves prior answers and why they changed without
introducing revision IDs. A revision after Implementation starts never rewrites the Accepted Plan.
_Avoid_: Edited decision, revision node, retroactive Plan edit

**Investigation**:
A user-created branch for deeply questioning a Work Item, Decision, Decision Option, Plan Item, or
Implementation Result without expanding its Owning Phase Task. Exploration remains private to the branch
unless the developer explicitly publishes a conclusion.
_Avoid_: Decision Room, browser chat

**Investigation Task**:
The separate, resumable Codex app task where the developer conducts an Investigation using a confirmed
model and the fixed Nimbus Investigation Method. A published conclusion returns only the accepted
finding, rationale, evidence, and unresolved risk to the Work Item; the full conversation remains
isolated.
_Avoid_: Main Work Item task, implementation task

**Published Investigation Conclusion**:
The compact, developer-approved result of an Investigation: conclusion, rationale, relevant evidence,
unresolved risk, and a link to its Codex task. It is stored inline under the owning artifact's
`Published investigations` label; it has no standalone Artifact ID and never includes the transcript.
_Avoid_: Investigation section, transcript, private draft conclusion

**Comprehension Layer**:
The evidence-backed context, explanations, visual models, and interrogation entry points available
throughout Grilling, Planning, Implementation, Review, and Handoff. It is a cross-cutting product
capability expressed through each phase's own browser surface, not a separate workflow phase or a
permanent generic panel. Review is the only phase that assembles the complete reconciliation view.
_Avoid_: Comprehension phase, post-implementation report, global comprehension panel

**Actual Behavior**:
The implemented outcome reported by an Implementation Result and supported by code evidence. Review and
Handoff derive this view from the Implementation section rather than storing another behavior record.
_Avoid_: Intended behavior, duplicate implementation summary

**Decision Fidelity**:
The derived comparison between an accepted Decision and the evidenced implementation through the path
`Decision -> Plan Item -> Implementation Result -> Evidence Link`. It highlights faithful, deviated, or
unresolved paths without becoming a permanent score or verification status.
_Avoid_: Fidelity matrix, confidence score, verified status

**Model Change**:
A meaningful difference between the developer's pre-implementation understanding and what the
implementation revealed. Nimbus derives it from Decisions, deviations, published Investigations, and
actual behavior for Review and Handoff; it is not an independently identified artifact.
_Avoid_: Model Change node, generic activity note

**Unknown**:
An unresolved concern surfaced by a published Investigation, missing mapping, deviation, contradictory
evidence, or Review finding. It remains anchored to its source artifact and may be summarized under the
Handoff's unresolved work; it is not a separate graph primitive.
_Avoid_: Unknown node, speculative backlog item

**System Model**:
A derived browser or Handoff visualization of relevant components, responsibilities, and relationships.
It is generated from the Work Item's accepted records and evidence instead of becoming another canonical
artifact.
_Avoid_: Canonical diagram node, manually synchronized architecture copy

**Session Trace**:
The supporting Codex task history for a phase or Investigation. Nimbus may link back to its task but does
not copy the conversation into the canonical Work Item Markdown or treat it as the primary evidence.
_Avoid_: Transcript in Markdown, audit-log primitive

**Review**:
The post-implementation phase in which the developer validates the existing Decisions, Plan Items,
Implementation Results, Evidence Links, and published Investigation conclusions before accepting the
Handoff. Review shows the complete mapping but prioritizes deviations, weak or contradictory evidence,
meaningful model changes, and unresolved concerns. It corrects source records instead of creating a
parallel review artifact.
_Avoid_: Comprehend phase, review report

**Browser Workspace**:
The local visual control plane for one Work Item. It dashboards current state, visualizes relationships,
and lets the developer initiate actions that Codex performs. It never hosts a conversational interface.
_Avoid_: Browser chat, coding interface

**Decision Digest**:
The human-approved conclusion produced by investigating a Decision: selected option, rationale, rejected
alternatives, constraints, and remaining risks. The digest is durable project memory; the full chat is
supporting conversation state.
_Avoid_: Full transcript, agent summary

**Plan Item**:
One implementable part of the accepted Plan. Each Plan Item has a stable identifier so the implementation
can report whether it was followed.
_Avoid_: Decision, requirement

**Accepted Plan**:
The complete, developer-approved implementation baseline. Draft Plan snapshots may support comparison
during review, but only the final approved Plan becomes project memory. After implementation starts, the
Accepted Plan is not rewritten; differences are recorded in the Implementation Record.
_Avoid_: Plan draft, latest implementation

**Plan Annotation**:
Developer-authored feedback anchored to a specific part of a proposed Plan. An Annotation can request a
comment, insertion, replacement, or deletion and returns to the owning Planning Phase Task as structured
feedback. It is not a conversation.
_Avoid_: Investigation, plan chat

**Plan Change Set**:
The developer-reviewed batch of Plan Annotations and published Investigation conclusions returned to the
owning Planning Phase Task as one revision request before Plan approval. Draft feedback does not alter
the Accepted Plan.
_Avoid_: Plan revision, individual agent message

**Implementation Record**:
The evidence-backed account of what the coding agent actually changed. It lists every Plan Item and its
corresponding Implementation Result when one has been reported.
_Avoid_: Plan, completion claim

**Implementation Result**:
A durable statement of what was implemented for one Plan Item, created only when the coding agent reports
that item implemented. It summarizes the result and links the supporting code evidence; its Decision
relationships are inherited through the Plan Item.
_Avoid_: Changed file, progress message, implementation node

**Implementation Activity**:
A transient loading state shown while Codex works on a Plan Item. It combines a spinner with a short
present-tense activity phrase and is replaced by the Implementation Result when reported; it is not
stored in the Work Item Markdown.
_Avoid_: Implementation Result, activity log, verification status

**Implementation Sequence**:
The accepted Plan Item order used during Implementation. Exactly one Plan Item is active at a time; its
Implementation Result is reported before the next Plan Item becomes active.
_Avoid_: Parallel implementation queue, activity timeline

**Implementation Change Set**:
The developer-reviewed batch of corrections requested during Review. Submitting it returns the Work Item
to Implementation as one bounded instruction set; draft corrections do not alter the Implementation
Record.
_Avoid_: Automatic fix, unresolved Handoff item

**Evidence Link**:
A checkable reference to the repository-relative file and code lines that support an Implementation
Result. Selecting it in the Browser Workspace returns the developer to the owning Codex Phase Task;
Nimbus does not choose or launch an external editor.
_Avoid_: Changed file, unsupported citation

**Handoff**:
The reviewed, audience-specific final artifact for every Work Item. It summarizes implemented state,
deviations, contracts, unresolved work, and any action another developer or agent must take.
_Avoid_: Implementation Record, changelog

**Delivery Action**:
An optional use of the reviewed Handoff after the Work Item is complete, such as creating or updating a
pull request, publishing a shareable explanation, or opening an implemented prototype. It is not a stage
of the Work Item, and declining or failing it does not reopen or block the accepted Handoff.
_Avoid_: Handoff, required output

**Handoff Site**:
A shareable, static explainer generated from the reviewed Work Item. It presents the implemented outcome,
Decision rationale, intent-to-reality fidelity, evidence, mental-model changes, unresolved concerns, and
relevant captured UI evidence. It does not depend on running the implemented project, and the Work Item
Markdown remains authoritative. The MVP publication flow is complete only when the generated Site is
hosted at a URL that Nimbus records and the developer can open.
_Avoid_: Project memory, implementation runtime, generic project website

**Site Publisher Task**:
A separate Codex task that receives a bounded publication packet from a reviewed Work Item and creates its
Handoff Site. Site iteration remains separate from the Work Item Orchestrator Task, and the published URL
returns to the Handoff as a Delivery Action result.
_Avoid_: Investigation Task, Work Item Orchestrator Task

## Example dialogue

**Developer:** Open a Work Item for session authentication. The Brief is accepted, but I need to compare
JWTs with server-side sessions before implementation.

**Nimbus:** I will record that as a Decision because either answer changes the Plan. After Codex
implements the accepted Plan, the Implementation Record will connect that Decision through its Plan Items
to actual Implementation Results and code evidence, report any deviation, and produce the Handoff.
