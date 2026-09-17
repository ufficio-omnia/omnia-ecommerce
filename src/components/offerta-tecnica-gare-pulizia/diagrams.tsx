function Node({ number, label }: { number: number; label: string }) {
  return (
    <div className="relative z-10 flex w-20 shrink-0 flex-col items-center text-center sm:w-24">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-forest font-serif text-lg text-cream">
        {number}
      </div>
      <p className="mt-3 font-mono text-[11px] leading-snug tracking-wide text-ink uppercase">
        {label}
      </p>
    </div>
  );
}

export function FlowDiagram({
  steps,
  note,
}: {
  steps: string[];
  note?: string;
}) {
  return (
    <div className="my-6 rounded-2xl border border-border bg-cream-soft p-6 sm:p-8">
      <div className="relative flex flex-wrap justify-between gap-x-2 gap-y-6 sm:flex-nowrap">
        {/* Linea unica dietro ai cerchi, ancorata al loro centro verticale
            (top-6 = metà di h-12) — non dipende dalla lunghezza delle
            etichette sotto, a differenza di un divisore inserito nel
            flusso flex accanto a ciascun nodo (bug precedente: la linea
            si spostava in base all'altezza della label). */}
        <div className="absolute top-6 hidden h-px bg-border-strong sm:block sm:right-12 sm:left-12" />
        {steps.map((step, i) => (
          <Node key={step} number={i + 1} label={step} />
        ))}
      </div>
      {note && (
        <p className="mt-6 text-center font-mono text-[11px] tracking-wide text-sage uppercase">
          ↻ {note}
        </p>
      )}
    </div>
  );
}

export function HubDiagram({
  hub,
  spokes,
}: {
  hub: string;
  spokes: string[];
}) {
  return (
    <div className="my-6 rounded-2xl border border-border bg-cream-soft p-6 sm:p-8">
      <div className="rounded-xl bg-forest px-5 py-3 text-center font-mono text-xs tracking-wide text-cream uppercase">
        {hub}
      </div>
      {/* Niente linee di collegamento verso le 2-4 card sotto: con un
          numero di colonne che cambia da mobile a desktop (2 → 4) una
          linea calcolata via CSS puro finiva storta. Il bordo superiore
          verde sulle card comunica comunque "dipende dall'hub sopra"
          senza dover allineare coordinate. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {spokes.map((spoke) => (
          <div
            key={spoke}
            className="rounded-xl border border-t-4 border-border-strong border-t-forest bg-cream px-3 py-3 text-center font-mono text-[11px] leading-snug tracking-wide text-ink uppercase"
          >
            {spoke}
          </div>
        ))}
      </div>
    </div>
  );
}
