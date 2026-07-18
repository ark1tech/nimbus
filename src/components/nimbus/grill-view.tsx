import "@xyflow/react/dist/style.css";

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Check, CircleHelp, ExternalLink, GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { NimbusDecision } from "@/app/nimbus-api";
import { Button } from "@/components/ui/button";

type GraphData = { id: string; label: string; selected: boolean; accepted: boolean; onClick: () => void };
function GraphNode({ data }: NodeProps<Node<GraphData>>): React.JSX.Element { return <button type="button" onClick={data.onClick} className={`nimbus-flow-node ${data.selected ? "is-selected" : ""} ${data.accepted ? "is-accepted" : ""}`}><Handle type="target" position={Position.Left} /><span>{data.id}</span><strong>{data.label}</strong>{data.accepted ? <Check /> : null}<Handle type="source" position={Position.Right} /></button>; }
const nodeTypes = { nimbus: GraphNode };

export function GrillView({ decisions, onChoose, onInvestigate }: { decisions: NimbusDecision[]; onChoose: (decision: NimbusDecision, optionId: string) => void; onInvestigate: (decision: NimbusDecision) => void }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(decisions.at(-1)?.id ?? null);
  const selected = decisions.find((decision) => decision.id === selectedId) ?? decisions.at(-1) ?? null;
  const { nodes, edges } = useMemo(() => {
    const graphNodes: Node<GraphData>[] = []; const graphEdges: Edge[] = [];
    decisions.forEach((decision, index) => { const decisionNode = `decision-${decision.id}`; graphNodes.push({ id: decisionNode, type: "nimbus", position: { x: 40 + index * 230, y: 52 }, data: { id: decision.id, label: "Question", selected: selectedId === decision.id, accepted: decision.selectedOptionId !== null, onClick: () => setSelectedId(decision.id) } }); decision.options.forEach((option, optionIndex) => { const optionNode = `option-${option.id}`; graphNodes.push({ id: optionNode, type: "nimbus", position: { x: 40 + index * 230, y: 190 + optionIndex * 104 }, data: { id: option.id, label: option.label, selected: false, accepted: decision.selectedOptionId === option.id, onClick: () => setSelectedId(decision.id) } }); graphEdges.push({ id: `${decisionNode}-${optionNode}`, source: decisionNode, target: optionNode, markerEnd: { type: MarkerType.ArrowClosed }, animated: decision.selectedOptionId === option.id }); }); }); return { nodes: graphNodes, edges: graphEdges };
  }, [decisions, selectedId]);
  if (selected === null) return <EmptyGrill />;
  return <div className="nimbus-grill"><section className="nimbus-flow"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}><Background gap={22} size={1} /><Controls showInteractive={false} /></ReactFlow></section><aside className="nimbus-decision-detail" data-testid="grill-detail"><div className="nimbus-detail-heading"><span className="nimbus-kicker"><CircleHelp /> {selected.id}</span><Button variant="outline" size="sm" onClick={() => onInvestigate(selected)}><Search data-icon="inline-start" /> Investigate</Button></div><h2>{selected.question}</h2><p className="nimbus-context">{selected.context}</p><div className="nimbus-recommendation"><GitBranch /><div><strong>Recommendation</strong><p>{selected.recommendationReason}</p></div></div><div className="nimbus-option-list">{selected.options.map((option) => <article key={option.id} className={selected.selectedOptionId === option.id ? "is-selected" : ""}><div className="nimbus-option-title"><span>{option.id}</span><h3>{option.label}</h3>{option.id === selected.recommendationOptionId ? <em>Recommended</em> : null}</div><p>{option.explanation}</p><div className="nimbus-effects"><strong>Taking this path</strong><ul>{option.concreteEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul></div><div className="nimbus-pro-con"><div><strong>Pros</strong><ul>{option.pros.map((pro) => <li key={pro}>{pro}</li>)}</ul></div><div><strong>Cons</strong><ul>{option.cons.map((con) => <li key={con}>{con}</li>)}</ul></div></div><Button size="sm" onClick={() => onChoose(selected, option.id)} disabled={selected.selectedOptionId !== null}><Check data-icon="inline-start" /> {selected.selectedOptionId === option.id ? "Accepted" : "Choose this path"}</Button></article>)}</div></aside></div>;
}
function EmptyGrill(): React.JSX.Element { return <div className="nimbus-empty"><CircleHelp /><h2>Waiting for a grill question</h2><p>Codex will publish the next decision here.</p></div>; }
