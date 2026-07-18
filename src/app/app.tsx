import { AlertCircle, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  nimbusApi,
  subscribeToNimbusEvents,
  type NimbusPhase,
  type NimbusState,
} from "@/app/nimbus-api";
import { GrillView } from "@/components/nimbus/grill-view";
import { HandoffView } from "@/components/nimbus/handoff-view";
import { ImplementationView } from "@/components/nimbus/implementation-view";
import { ModelConfirmation } from "@/components/nimbus/model-confirmation";
import { PhaseNavigation } from "@/components/nimbus/phase-navigation";
import { PlanView } from "@/components/nimbus/plan-view";
import { ReviewView } from "@/components/nimbus/review-view";
import { Button } from "@/components/ui/button";

type PendingTask = {
  title: string;
  phase: NimbusPhase;
  afterConfirm: () => Promise<void>;
};
const displayPhase = (phase: NimbusPhase): NimbusPhase =>
  phase === "complete" ? "handoff" : phase;

export function App(): React.JSX.Element {
  const [state, setState] = useState<NimbusState | null>(null);
  const [view, setView] = useState<NimbusPhase>("grill");
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = useCallback((next: NimbusState): void => {
    setState(next);
    setView(displayPhase(next.workItem.phase));
  }, []);
  const load = useCallback(async (): Promise<void> => {
    try {
      apply(await nimbusApi.getWorkItem());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nimbus could not load this Work Item.",
      );
    }
  }, [apply]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      subscribeToNimbusEvents(
        (event) => {
          if (event.type === "work_item.updated") apply(event.state);
          if (event.type === "browser.updated")
            setState((current) =>
              current === null
                ? current
                : { ...current, browser: event.browser },
            );
        },
        () => undefined,
      ),
    [apply],
  );
  const mutate = async (action: () => Promise<NimbusState>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nimbus could not save that action.",
      );
    } finally {
      setBusy(false);
    }
  };
  const requireTask = (
    title: string,
    phase: NimbusPhase,
    afterConfirm: () => Promise<void>,
  ): void => setPendingTask({ title, phase, afterConfirm });
  const openCodex = (): void => {
    window.location.assign("codex://threads/current");
  };
  if (state === null) return <Loading error={error} onRetry={load} />;
  const { workItem, browser } = state;
  const chooseDecision = (decisionId: string, optionId: string): void =>
    requireTask("Continue Grill in Codex", "grill", async () => {
      await mutate(() =>
        nimbusApi.selectDecisionOption(
          decisionId,
          optionId,
          "Accepted from the Nimbus decision tree.",
          browser.documentHash,
        ),
      );
    });
  const investigate = (title: string): void =>
    requireTask(title, displayPhase(workItem.phase), async () => undefined);
  const renderSurface = (): React.JSX.Element => {
    if (view === "grill")
      return (
        <GrillView
          decisions={workItem.decisions}
          onChoose={(decision, optionId) =>
            chooseDecision(decision.id, optionId)
          }
          onInvestigate={() =>
            investigate("Investigate this decision in Codex")
          }
        />
      );
    if (view === "plan")
      return (
        <PlanView
          workItem={workItem}
          browser={browser}
          onSubmit={(changes) =>
            requireTask("Open Plan revision task", "plan", async () => {
              await mutate(() =>
                nimbusApi.submitPlanChangeSet(changes, browser.documentHash),
              );
            })
          }
          onApprove={() =>
            requireTask(
              "Start Implementation in Codex",
              "implement",
              async () => {
                await mutate(() =>
                  nimbusApi.submitPlanChangeSet([], browser.documentHash),
                );
              },
            )
          }
          onInvestigate={() => investigate("Interrogate the plan in Codex")}
        />
      );
    if (view === "implement")
      return (
        <ImplementationView
          workItem={workItem}
          browser={browser}
          onOpenCodex={openCodex}
        />
      );
    if (view === "review")
      return (
        <ReviewView
          workItem={workItem}
          onAccept={() =>
            void mutate(() => nimbusApi.acceptReview(browser.documentHash))
          }
          onInvestigate={() => investigate("Investigate the review in Codex")}
          onCorrection={(correction) =>
            requireTask(
              "Open implementation correction task",
              "implement",
              async () => {
                await mutate(() =>
                  nimbusApi.requestReviewCorrection(
                    correction,
                    browser.documentHash,
                  ),
                );
              },
            )
          }
        />
      );
    return (
      <HandoffView
        workItem={workItem}
        onAccept={() =>
          void mutate(() => nimbusApi.acceptHandoff(browser.documentHash))
        }
        onPublish={() =>
          requireTask("Create Handoff Site in Codex", "handoff", async () => {
            await mutate(() =>
              nimbusApi.startPublication(browser.documentHash),
            );
          })
        }
      />
    );
  };
  const confirmTask = async (model: string): Promise<void> => {
    if (pendingTask === null) return;
    const pending = pendingTask;
    setPendingTask(null);
    setBusy(true);
    setError(null);
    try {
      apply(
        await nimbusApi.confirmLaunch(
          pending.phase,
          model,
          browser.documentHash,
        ),
      );
      await pending.afterConfirm();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nimbus could not start that Codex task.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="nimbus-app" data-testid="nimbus-app">
      <header className="nimbus-header">
        <div>
          <span>{workItem.id}</span>
          <h1>{workItem.title}</h1>
        </div>
        <p>{workItem.phase === "complete" ? "Complete" : workItem.phase}</p>
      </header>
      <PhaseNavigation
        phase={displayPhase(workItem.phase)}
        onSelect={setView}
      />
      {error ? (
        <div className="nimbus-error">
          <AlertCircle /> {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      ) : null}
      <div className="nimbus-content" aria-busy={busy}>
        {renderSurface()}
      </div>
      {pendingTask ? (
        <ModelConfirmation
          title={pendingTask.title}
          onClose={() => setPendingTask(null)}
          onConfirm={(model) => void confirmTask(model)}
        />
      ) : null}
    </main>
  );
}
function Loading({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <main className="nimbus-loading-screen">
      {error ? (
        <>
          <AlertCircle />
          <p>{error}</p>
          <Button onClick={() => void onRetry()}>Retry</Button>
        </>
      ) : (
        <>
          <LoaderCircle className="animate-spin" /> Loading Nimbus
        </>
      )}
    </main>
  );
}
