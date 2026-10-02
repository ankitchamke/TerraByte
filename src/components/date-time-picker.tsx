import React, { useState, useEffect, useRef } from "react";
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatEtaDateTime, getEtaPresets } from "@/lib/date-utils";

export interface DateTimePickerProps {
  value?: string | null;
  onChange: (isoString: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseSafeDate(value?: string | null): Date {
  if (value && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  // Default to tomorrow 9:30 AM if no valid value
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 30, 0, 0);
  return d;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Select date & time",
  disabled = false,
  className,
  id,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);

  // Parse current active value into a Date object
  const activeDate = parseSafeDate(value);
  const hasValidValue = Boolean(value && typeof value === "string" && !isNaN(new Date(value).getTime()));

  // Calendar month/year navigation state
  const [viewYear, setViewYear] = useState(activeDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(activeDate.getMonth());

  // Time state (12-hour format)
  const [hours12, setHours12] = useState(() => {
    const h24 = activeDate.getHours();
    const h = h24 % 12;
    return h === 0 ? 12 : h;
  });
  const [minutes, setMinutes] = useState(() => activeDate.getMinutes());
  const [period, setPeriod] = useState<"AM" | "PM">(() => (activeDate.getHours() >= 12 ? "PM" : "AM"));

  // Text inputs for keyboard & numpad typing
  const [hourInput, setHourInput] = useState(() => String(hours12).padStart(2, "0"));
  const [minuteInput, setMinuteInput] = useState(() => String(minutes).padStart(2, "0"));

  // Sync internal view states when value or popover opens
  useEffect(() => {
    if (open) {
      const d = parseSafeDate(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      const h24 = d.getHours();
      const h = h24 % 12 === 0 ? 12 : h24 % 12;
      const m = d.getMinutes();
      const p = h24 >= 12 ? "PM" : "AM";
      setHours12(h);
      setMinutes(m);
      setPeriod(p);
      setHourInput(String(h).padStart(2, "0"));
      setMinuteInput(String(m).padStart(2, "0"));
    }
  }, [open, value]);

  // Construct ISO string from current view date + time
  const emitDateTime = (year: number, month: number, day: number, h12: number, min: number, ampm: "AM" | "PM") => {
    let h24 = h12 % 12;
    if (ampm === "PM") h24 += 12;
    const newDate = new Date(year, month, day, h24, min, 0, 0);
    onChange(newDate.toISOString());
  };

  // Quick Presets
  const presets = getEtaPresets();

  // Days in month calculation
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const prevMonthDays = Array.from({ length: firstDayOfWeek }, (_, i) => daysInPrevMonth - firstDayOfWeek + i + 1);
  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const remainingCells = 42 - (prevMonthDays.length + currentMonthDays.length);
  const nextMonthDays = Array.from({ length: remainingCells > 7 ? remainingCells - 7 : remainingCells }, (_, i) => i + 1);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleDaySelect = (day: number) => {
    emitDateTime(viewYear, viewMonth, day, hours12, minutes, period);
  };

  const handlePeriodChange = (newPeriod: "AM" | "PM") => {
    setPeriod(newPeriod);
    const d = parseSafeDate(value);
    emitDateTime(d.getFullYear(), d.getMonth(), d.getDate(), hours12, minutes, newPeriod);
  };

  const handleHourBlur = () => {
    let num = parseInt(hourInput, 10);
    if (isNaN(num) || num < 1) num = 12;
    if (num > 12) num = 12;
    setHours12(num);
    setHourInput(String(num).padStart(2, "0"));
    const d = parseSafeDate(value);
    emitDateTime(d.getFullYear(), d.getMonth(), d.getDate(), num, minutes, period);
  };

  const handleMinuteBlur = () => {
    let num = parseInt(minuteInput, 10);
    if (isNaN(num) || num < 0) num = 0;
    if (num > 59) num = 59;
    setMinutes(num);
    setMinuteInput(String(num).padStart(2, "0"));
    const d = parseSafeDate(value);
    emitDateTime(d.getFullYear(), d.getMonth(), d.getDate(), hours12, num, period);
  };

  const handleQuickMinute = (min: number) => {
    setMinutes(min);
    setMinuteInput(String(min).padStart(2, "0"));
    const d = parseSafeDate(value);
    emitDateTime(d.getFullYear(), d.getMonth(), d.getDate(), hours12, min, period);
  };

  const handlePresetSelect = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const today = new Date();
  const isSelectedDate = (day: number) => {
    if (!hasValidValue) return false;
    const d = parseSafeDate(value);
    return (
      d.getDate() === day &&
      d.getMonth() === viewMonth &&
      d.getFullYear() === viewYear
    );
  };

  const isTodayDate = (day: number) => {
    return (
      today.getDate() === day &&
      today.getMonth() === viewMonth &&
      today.getFullYear() === viewYear
    );
  };

  const isPastDate = (day: number) => {
    const compareDate = new Date(viewYear, viewMonth, day, 23, 59, 59);
    return compareDate.getTime() < today.setHours(0, 0, 0, 0);
  };

  const displayText = value ? formatEtaDateTime(value) : "";

  return (
    <div className={cn("relative w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label="Choose date and time"
            className={cn(
              "flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 py-2 text-left text-sm transition-colors",
              "hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              disabled && "cursor-not-allowed opacity-50",
              !displayText && "text-muted-foreground"
            )}
          >
            <div className="flex items-center gap-2.5 truncate">
              <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className={cn("truncate font-medium", displayText ? "text-foreground" : "text-muted-foreground")}>
                {displayText || placeholder}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasValidValue && !disabled && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear date"
                  onClick={handleClear}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-50 w-[320px] sm:w-[350px] p-3.5 rounded-2xl border border-border bg-card shadow-xl outline-none"
        >
          {/* Quick Presets */}
          <div className="space-y-1.5 pb-3 border-b border-border/60">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Quick Presets
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePresetSelect(preset.iso)}
                  className="flex items-center justify-center rounded-lg border border-border/80 bg-muted/30 px-2 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calendar Month Navigation */}
          <div className="py-2.5">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-sm font-bold text-foreground">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={prevMonth}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={nextMonth}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground mb-1">
              {WEEKDAY_NAMES.map((w) => (
                <div key={w} className="py-0.5">
                  {w}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {/* Previous month days */}
              {prevMonthDays.map((d) => (
                <div key={`prev-${d}`} className="h-8 flex items-center justify-center text-muted-foreground/35 select-none">
                  {d}
                </div>
              ))}

              {/* Current month days */}
              {currentMonthDays.map((d) => {
                const selected = isSelectedDate(d);
                const isToday = isTodayDate(d);
                const past = isPastDate(d);

                return (
                  <button
                    key={`cur-${d}`}
                    type="button"
                    onClick={() => handleDaySelect(d)}
                    className={cn(
                      "h-8 w-full rounded-lg font-medium transition-colors flex items-center justify-center text-xs",
                      selected
                        ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary"
                        : isToday
                        ? "border border-primary text-primary font-bold hover:bg-muted"
                        : past
                        ? "text-muted-foreground/60 hover:bg-muted/40"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    {d}
                  </button>
                );
              })}

              {/* Next month days */}
              {nextMonthDays.map((d) => (
                <div key={`next-${d}`} className="h-8 flex items-center justify-center text-muted-foreground/35 select-none">
                  {d}
                </div>
              ))}
            </div>
          </div>

          {/* Time Picker */}
          <div className="pt-2.5 border-t border-border/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Set Time
              </span>
              <div className="flex items-center gap-1">
                {[0, 15, 30, 45].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => handleQuickMinute(min)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold border transition-colors",
                      minutes === min
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 hover:bg-muted text-muted-foreground"
                    )}
                  >
                    :{String(min).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Hour input */}
              <div className="flex-1">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={hourInput}
                    onChange={(e) => setHourInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    onBlur={handleHourBlur}
                    onKeyDown={(e) => e.key === "Enter" && handleHourBlur()}
                    className="h-9 w-full rounded-lg border border-input bg-background text-center font-mono text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Hour (1-12)"
                  />
                  <span className="absolute right-1 text-[10px] text-muted-foreground pointer-events-none pr-1">
                    hr
                  </span>
                </div>
              </div>

              <span className="font-bold text-muted-foreground">:</span>

              {/* Minute input */}
              <div className="flex-1">
                <div className="relative flex items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={minuteInput}
                    onChange={(e) => setMinuteInput(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    onBlur={handleMinuteBlur}
                    onKeyDown={(e) => e.key === "Enter" && handleMinuteBlur()}
                    className="h-9 w-full rounded-lg border border-input bg-background text-center font-mono text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Minute (0-59)"
                  />
                  <span className="absolute right-1 text-[10px] text-muted-foreground pointer-events-none pr-1">
                    min
                  </span>
                </div>
              </div>

              {/* AM / PM toggle */}
              <div className="flex rounded-lg border border-input bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => handlePeriodChange("AM")}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-bold transition-colors",
                    period === "AM"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => handlePeriodChange("PM")}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-bold transition-colors",
                    period === "PM"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  PM
                </button>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="pt-3 mt-2 border-t border-border/60 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                onChange(now.toISOString());
              }}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Set to Now
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
