"use client";

import { useEffect, useRef, useState } from "react";

export default function PreviewGalleryButton({
  images,
  label,
}: {
  images: string[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  function prev() {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }

  function next() {
    setIndex((i) => (i + 1) % images.length);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (images.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
        className="rounded-full border border-border-strong px-2 py-0.5 font-mono text-[10px] tracking-wide text-forest uppercase transition-colors hover:bg-forest hover:text-cream"
      >
        Anteprima
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Anteprima ${label}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative flex max-h-full w-full max-w-3xl flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Chiudi"
              className="absolute -top-9 right-0 font-mono text-xs tracking-wide text-cream uppercase hover:text-mint"
            >
              Chiudi ✕
            </button>

            {/* Riquadro proporzionato come un foglio A4 (1:1.414):
                l'immagine reale, quale che sia il suo formato, viene
                "contenuta" dentro senza deformarsi. */}
            <div
              className="relative mx-auto aspect-[1/1.414] max-h-[85vh] max-w-full"
              onTouchStart={(e) => {
                touchStartX.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if (touchStartX.current === null) return;
                const delta = e.changedTouches[0].clientX - touchStartX.current;
                if (delta > 50) prev();
                else if (delta < -50) next();
                touchStartX.current = null;
              }}
            >
              {images.length > 1 && (
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Immagine precedente"
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-cream/90 px-3 py-2 text-lg text-ink hover:bg-cream"
                >
                  ‹
                </button>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[index]}
                alt={`${label} — anteprima ${index + 1} di ${images.length}`}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                className="h-full w-full rounded-lg bg-cream-soft object-contain select-none"
              />

              {images.length > 1 && (
                <button
                  type="button"
                  onClick={next}
                  aria-label="Immagine successiva"
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-cream/90 px-3 py-2 text-lg text-ink hover:bg-cream"
                >
                  ›
                </button>
              )}
            </div>

            {images.length > 1 && (
              <p className="mt-3 font-mono text-xs tracking-wide text-cream">
                {index + 1} di {images.length}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
