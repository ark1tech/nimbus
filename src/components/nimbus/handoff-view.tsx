import { CheckCircle2, ExternalLink, Globe2, Handshake } from "lucide-react";

import type { NimbusWorkItem } from "@/app/nimbus-api";
import { Button } from "@/components/ui/button";

const groups = ["outcome", "decisions", "deviations", "contracts", "unresolved", "nextActions"] as const;
export function HandoffView({ workItem, onAccept, onPublish }: { workItem: NimbusWorkItem; onAccept: () => void; onPublish: () => void }): React.JSX.Element {
  if (workItem.handoff === null) return <div className="nimbus-empty"><Handshake /><h2>Waiting for a handoff</h2><p>Codex will distill the reviewed Work Item into a handoff.</p></div>;
  const completed = workItem.phase === "complete";
  return <section className="nimbus-handoff" data-testid="handoff-surface"><header><div><span className="nimbus-kicker"><Handshake /> {completed ? "Work Item complete" : "Handoff ready"}</span><h2>{completed ? "Implementation handed off" : "Review the handoff"}</h2><p>The final evidence-backed summary for the next developer or agent.</p></div><div className="nimbus-handoff-actions">{!completed ? <Button onClick={onAccept}><CheckCircle2 data-icon="inline-start" /> Accept handoff</Button> : null}<Button variant="outline" onClick={onPublish}><Globe2 data-icon="inline-start" /> Publish Site</Button></div></header>{workItem.deliveryActions.handoffSiteUrl ? <a className="nimbus-published-site" href={workItem.deliveryActions.handoffSiteUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open published Handoff Site</a> : null}<div className="nimbus-handoff-grid">{groups.map((group) => <article key={group}><h3>{group.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())}</h3>{workItem.handoff?.[group].length ? <ul>{workItem.handoff[group].map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing recorded.</p>}</article>)}</div></section>;
}
