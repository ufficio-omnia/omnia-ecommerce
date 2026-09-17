"use client";

import { useEffect, useState } from "react";

type TocItem = { id: string; label: string };

export default function Toc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);

    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Tra le sezioni visibili, la più in alto nel viewport è quella
        // "corrente": entries non è già ordinato per posizione, va
        // ordinato esplicitamente prima di prendere la prima.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-100px 0px -70% 0px" },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items]);

  const list = (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className={`block font-mono text-xs tracking-wide uppercase transition-colors ${
              activeId === item.id
                ? "text-forest"
                : "text-sage hover:text-ink"
            }`}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <nav aria-label="Indice dei contenuti">
      {/* Desktop: colonna laterale sticky */}
      <div className="hidden lg:block">
        <p className="font-mono text-[11px] tracking-widest text-sage uppercase">
          In questa guida
        </p>
        <div className="mt-4">{list}</div>
      </div>

      {/* Mobile/tablet: blocco collassabile */}
      <details className="group mt-8 rounded-2xl border border-border bg-cream-soft p-4 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between font-mono text-xs tracking-widest text-ink uppercase">
          Indice dei contenuti
          <span className="transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-4">{list}</div>
      </details>
    </nav>
  );
}
