import { useEffect, useId, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

interface SequenceDiagramProps {
  source: string;
}

export function SequenceDiagram({
  source,
}: SequenceDiagramProps): React.JSX.Element {
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async (): Promise<void> => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "Geist Variable, sans-serif",
          sequence: { useMaxWidth: true, wrap: true },
        });
        const diagramId = `nimbus-sequence-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
        const result = await mermaid.render(diagramId, source);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      } catch (renderError: unknown) {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Nimbus could not render this sequence diagram.",
          );
        }
      }
    };

    void render();
    return (): void => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (error !== null) {
    return (
      <p className="text-xs leading-5 text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (svg === null) {
    return <Skeleton className="h-64 w-full rounded-md" />;
  }

  return (
    <div
      data-testid="execution-sequence"
      className="w-full overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
