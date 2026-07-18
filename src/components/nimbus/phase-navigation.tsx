import { ClipboardList, GitBranch, Handshake, ScanSearch, Wrench } from "lucide-react";

import type { NimbusPhase } from "@/app/nimbus-api";

const phases: Array<{ value: NimbusPhase; label: string; icon: typeof GitBranch }> = [
  { value: "grill", label: "Grill", icon: GitBranch },
  { value: "plan", label: "Plan", icon: ClipboardList },
  { value: "implement", label: "Implement", icon: Wrench },
  { value: "review", label: "Review", icon: ScanSearch },
  { value: "handoff", label: "Handoff", icon: Handshake },
];

export function PhaseNavigation({ phase, onSelect }: { phase: NimbusPhase; onSelect: (phase: NimbusPhase) => void }): React.JSX.Element {
  return <nav className="nimbus-phase-nav" aria-label="Work Item phases">{phases.map(({ value, label, icon: Icon }) => <button key={value} type="button" onClick={() => onSelect(value)} data-testid={`${value}-tab`} className={phase === value || (phase === "complete" && value === "handoff") ? "is-active" : ""}><Icon />{label}</button>)}</nav>;
}
