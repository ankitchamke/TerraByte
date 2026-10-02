import { useState, useEffect } from "react";
import { X, ZoomIn, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/**
 * Resolves a breakdown or repair photo path/URL.
 * Supports:
 * - Full HTTP / HTTPS URLs (e.g. external CDN, mock photos)
 * - Data URLs (base64 compressed photos from camera upload)
 * - Blob URLs
 * - Relative Supabase Storage paths in 'breakdown-photos' bucket
 */
export function resolvePhotoUrl(pathOrUrl?: string | null): string {
  if (!pathOrUrl) return "";
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:")
  ) {
    return trimmed;
  }
  // Strip optional bucket prefix if present
  const cleanPath = trimmed.replace(/^breakdown-photos\//, "");
  const { data } = supabase.storage.from("breakdown-photos").getPublicUrl(cleanPath);
  return data?.publicUrl || trimmed;
}

export interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Fullscreen lightbox preview for repair and breakdown images.
 * Preserves native aspect ratio, supports backdrop/Escape dismiss, mobile responsive.
 */
export function ImageLightbox({ src, alt = "Repair photo preview", onClose }: ImageLightboxProps) {
  const [loadError, setLoadError] = useState(false);
  const resolvedSrc = resolvePhotoUrl(src);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
    >
      <button
        type="button"
        aria-label="Close image preview"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2.5 text-white hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
      >
        <X className="h-6 w-6" />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] max-w-[92vw] overflow-hidden rounded-2xl flex items-center justify-center"
      >
        {loadError ? (
          <div className="flex flex-col items-center justify-center p-8 bg-card rounded-2xl border border-border text-center space-y-3 max-w-sm">
            <ImageOff className="h-12 w-12 text-muted-foreground" />
            <p className="font-semibold text-foreground">Unable to load image</p>
            <p className="text-xs text-muted-foreground">The image file could not be displayed or the URL is invalid.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-xl border border-border bg-muted px-4 py-2 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        ) : (
          <img
            src={resolvedSrc}
            alt={alt}
            onError={() => setLoadError(true)}
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Reusable clickable thumbnail that shows a zoom hint and opens the full lightbox.
 */
export function ClickableImage({
  src,
  alt = "Repair photo",
  className,
  thumbnailClassName,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  thumbnailClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const resolvedSrc = resolvePhotoUrl(src);

  if (!resolvedSrc) return null;

  if (loadError) {
    return (
      <div className={cn("flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 p-2 text-xs text-muted-foreground", className)}>
        <ImageOff className="h-4 w-4 shrink-0" />
        <span className="truncate">Image unavailable</span>
      </div>
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`View larger: ${alt}`}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-muted/20 transition-all hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-primary",
          className
        )}
      >
        <img
          src={resolvedSrc}
          alt={alt}
          onError={() => setLoadError(true)}
          className={cn("h-full w-full object-cover transition-transform duration-200 group-hover:scale-105", thumbnailClassName)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
          <span className="rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <ZoomIn className="h-4 w-4" />
          </span>
        </div>
      </div>

      {open && <ImageLightbox src={resolvedSrc} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
