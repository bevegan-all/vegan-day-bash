import { Check, X } from "lucide-react";

// The 10 steps of one turn: green tick for a pass, red cross for a fail, an empty ring for the step being watched
export function StepDots({ steps, total = 10, big }: { steps: string; total?: number; big?: boolean }) {
  const size = big ? "h-11 w-11" : "h-7 w-7";
  const icon = big ? 22 : 15;
  return (
    <div className={`flex flex-wrap ${big ? "gap-2.5" : "gap-1.5"}`} aria-label={`${steps.split("P").length - 1} of ${steps.length} steps passed`}>
      {Array.from({ length: total }, (_, i) => {
        const c = steps[i];
        if (c === "P")
          return (
            <span key={i} className={`flex ${size} items-center justify-center rounded-full bg-accent text-accent-fg`}>
              <Check size={icon} strokeWidth={3} />
            </span>
          );
        if (c === "F")
          return (
            <span key={i} className={`flex ${size} items-center justify-center rounded-full bg-danger-soft text-danger`}>
              <X size={icon} strokeWidth={3} />
            </span>
          );
        return <span key={i} className={`${size} rounded-full ${i === steps.length ? "animate-pulse border-2 border-accent" : "bg-sunken"}`} />;
      })}
    </div>
  );
}

export const passes = (steps: string) => steps.split("P").length - 1;
