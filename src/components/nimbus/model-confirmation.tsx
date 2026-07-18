import { Bot, Check, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function ModelConfirmation({ title, onConfirm, onClose }: { title: string; onConfirm: (model: string) => void; onClose: () => void }): React.JSX.Element {
  const [model, setModel] = useState("gpt-5.6-terra");
  return <div className="nimbus-modal-backdrop" role="presentation"><section className="nimbus-modal" role="dialog" aria-modal="true" aria-labelledby="model-confirmation-title"><div className="nimbus-modal-heading"><div><span className="nimbus-kicker"><Bot /> New Codex task</span><h2 id="model-confirmation-title">{title}</h2><p>Choose the model before Nimbus opens the task in Codex.</p></div><Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close model selection"><X /></Button></div><label htmlFor="nimbus-model">Model</label><input id="nimbus-model" value={model} onChange={(event) => setModel(event.target.value)} autoFocus /><div className="nimbus-modal-actions"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => onConfirm(model.trim())} disabled={model.trim().length === 0}><Check data-icon="inline-start" /> Confirm model</Button></div></section></div>;
}
