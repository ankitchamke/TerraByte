import { useTranslation, type SupportedLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface FarmerLanguageSelectorProps {
  variant?: "header" | "pill" | "footer";
  className?: string;
}

const DISPLAY_LABELS: Record<SupportedLanguage, string> = {
  en: "EN",
  hi: "हिं",
  mr: "म",
};

export function FarmerLanguageSelector({
  className,
}: FarmerLanguageSelectorProps) {
  const { language, setLanguage, languages } = useTranslation();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs font-semibold shadow-xs",
        className
      )}
      role="group"
      aria-label="Language selector"
    >
      {languages.map((l) => {
        const active = l.code === language;
        const displayLabel = DISPLAY_LABELS[l.code] || l.code.toUpperCase();
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLanguage(l.code)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-bold tracking-wider transition-all min-h-[30px] min-w-[34px]",
              active
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            aria-pressed={active}
            aria-label={l.label}
            title={l.label}
          >
            {displayLabel}
          </button>
        );
      })}
    </div>
  );
}
