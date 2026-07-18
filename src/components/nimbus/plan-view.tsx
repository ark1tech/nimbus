import { FileDiff, MessageSquarePlus, PencilLine, Send } from "lucide-react";
import { useState } from "react";

import type { NimbusBrowserState, NimbusWorkItem } from "@/app/nimbus-api";
import { Button } from "@/components/ui/button";

type Change = NimbusBrowserState["pendingPlanChangeSet"][number];
export function PlanView({ workItem, browser, onSubmit, onInvestigate }: { workItem: NimbusWorkItem; browser: NimbusBrowserState; onSubmit: (changes: Change[]) => void; onInvestigate: () => void }): React.JSX.Element {
  const [note, setNote] = useState(""); const [mode, setMode] = useState<Change["type"]>("comment");
  if (workItem.plan === null) return <div className="nimbus-empty"><PencilLine /><h2>Waiting for a plan</h2><p>Accepted decisions will become a readable implementation plan.</p></div>;
  const submit = (): void => { const content = note.trim(); if (content.length === 0) return; onSubmit([{ type: mode, target: "plan", content }]); setNote(""); };
  return <section className="nimbus-document" data-testid="plan-surface"><header><div><span className="nimbus-kicker"><FileDiff /> Accepted plan</span><h2>Implementation plan</h2><p>The current approved plan stays readable as one document. Annotations create a revision request; they do not rewrite history in place.</p></div><Button variant="outline" size="sm" onClick={onInvestigate}><MessageSquarePlus data-icon="inline-start" /> Interrogate plan</Button></header><article className="nimbus-markdown" aria-label="Plan markdown"><pre>{workItem.plan.document}</pre></article><section className="nimbus-annotation"><div><span className="nimbus-kicker"><PencilLine /> Plan annotation</span><h3>Request a focused revision</h3></div><div className="nimbus-annotation-controls"><select value={mode} onChange={(event) => setMode(event.target.value as Change["type"])} aria-label="Annotation type"><option value="comment">Comment</option><option value="insert">Insert</option><option value="replace">Replace</option><option value="delete">Delete</option></select><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should change or be explained?" /><Button size="sm" onClick={submit} disabled={note.trim().length === 0}><Send data-icon="inline-start" /> Request revision</Button></div>{browser.pendingPlanChangeSet.length > 0 ? <p className="nimbus-pending-note">Revision request awaiting the Plan task: {browser.pendingPlanChangeSet.length} annotation{browser.pendingPlanChangeSet.length === 1 ? "" : "s"}.</p> : null}</section></section>;
}
