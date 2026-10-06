import { useEffect, useState } from "react";
import { X } from "lucide-react";

export const PROTOTYPE_STATUS_STORAGE_KEY = "terrabyte.prototype-status-dismissed";

export function PrototypeStatusCard() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(PROTOTYPE_STATUS_STORAGE_KEY);
      if (dismissed !== "true") {
        setIsVisible(true);
      }
    } catch {
      // Graceful fallback if localStorage is unavailable or throws (e.g. private mode, quota)
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    try {
      localStorage.setItem(PROTOTYPE_STATUS_STORAGE_KEY, "true");
    } catch {
      // Graceful fallback if localStorage writes fail
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <aside
      role="region"
      aria-label="Prototype Status"
      className="fixed bottom-3 right-3 left-3 sm:left-auto sm:right-4 sm:bottom-4 z-40 w-auto sm:w-[360px] max-w-[calc(100vw-1.5rem)] sm:max-w-[360px] pointer-events-auto rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg animate-prototype-in motion-reduce:animate-none motion-reduce:transform-none select-normal"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none select-none" role="img" aria-hidden="true">
            🚧
          </span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">
            Prototype in Active Development
          </h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss prototype notification"
          className="rounded-md p-1 -mr-1 -mt-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">Main progress</span>
          <span className="font-semibold text-primary">~60% Prototype Complete</span>
        </div>
        <div
          role="progressbar"
          aria-label="Prototype completion progress"
          aria-valuenow={60}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: "60%" }}
          />
        </div>
      </div>

      <div className="mt-2.5 space-y-2 text-xs text-muted-foreground leading-relaxed">
        <p>Core Farmer, Technician &amp; Service Centre workflows are functional.</p>
        <div>
          <p className="font-medium text-foreground">Still under development:</p>
          <ul className="mt-1 space-y-1 pl-4 list-disc marker:text-primary/70">
            <li>Doorstep &amp; mobile repair</li>
            <li>Spare-parts availability</li>
            <li>Preventive maintenance packages</li>
            <li>Emergency response</li>
            <li>Technician certification</li>
            <li>FPO/cooperative service centres</li>
          </ul>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-border/70 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>You&apos;re viewing an evolving prototype.</span>
        <button
          type="button"
          onClick={handleDismiss}
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1 -mr-1 cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
