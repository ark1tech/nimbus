import type { WorkItemPhase } from "@/shared/model";

import { Badge } from "@/components/ui/badge";

const phaseLabels: Record<WorkItemPhase, string> = {
  grilling: "Grilling",
  planning: "Plan",
  implementing: "Implementation",
  review: "Review",
  handoff: "Handoff",
  complete: "Complete",
};

type Fidelity = "matched" | "deviated" | "missing" | "superseded";
type PlanItemStatus = "pending" | "in_progress" | "complete" | "deviated";

const fidelityClasses: Record<Fidelity, string> = {
  matched: "border-success/30 bg-success/10 text-success-foreground",
  deviated: "border-warning/30 bg-warning/10 text-warning-foreground",
  missing: "border-destructive/30 bg-destructive/10 text-destructive",
  superseded: "border-border bg-muted text-muted-foreground",
};

const planClasses: Record<PlanItemStatus, string> = {
  pending: "border-border bg-muted/50 text-muted-foreground",
  in_progress: "border-info/30 bg-info/10 text-info-foreground",
  complete: "border-success/30 bg-success/10 text-success-foreground",
  deviated: "border-warning/30 bg-warning/10 text-warning-foreground",
};

function PhaseBadge({ phase }: { phase: WorkItemPhase }): React.JSX.Element {
  return (
    <Badge variant="outline" className="rounded-md px-1.5">
      {phaseLabels[phase]}
    </Badge>
  );
}

function FidelityBadge({
  fidelity,
}: {
  fidelity: Fidelity;
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={`rounded-md px-1.5 capitalize ${fidelityClasses[fidelity]}`}
    >
      {fidelity}
    </Badge>
  );
}

function PlanStatusBadge({
  status,
}: {
  status: PlanItemStatus;
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={`rounded-md px-1.5 capitalize ${planClasses[status]}`}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

export { FidelityBadge, PhaseBadge, PlanStatusBadge, phaseLabels };
