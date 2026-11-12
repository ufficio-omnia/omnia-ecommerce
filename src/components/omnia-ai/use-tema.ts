"use client";

import { useSyncExternalStore } from "react";
import { SCELTA_PREDEFINITA, TEMA_PREDEFINITO, interpretaScelta, type SceltaTema, type TemaEffettivo } from "@/lib/tema-omnia-ai";

// Legge il tema dall'<html> (lo scrive lo script iniziale e l'interruttore) e avvisa quando cambia. Sul server, e durante la
// prima disegnata nel browser, vale il tema di base (il chiaro): poi React si allinea a quello vero senza errori di coerenza.
function iscrivi(attributo: "data-tema" | "data-tema-scelta") {
  return (avvisa: () => void) => {
    const osservatore = new MutationObserver(avvisa);
    osservatore.observe(document.documentElement, { attributes: true, attributeFilter: [attributo] });
    return () => osservatore.disconnect();
  };
}
const iscriviTema = iscrivi("data-tema");
const iscriviScelta = iscrivi("data-tema-scelta");

export function useTemaEffettivo(): TemaEffettivo {
  return useSyncExternalStore(
    iscriviTema,
    () => (document.documentElement.getAttribute("data-tema") === "scuro" ? "scuro" : "chiaro"),
    () => TEMA_PREDEFINITO,
  );
}

export function useSceltaTema(): SceltaTema {
  return useSyncExternalStore(
    iscriviScelta,
    () => interpretaScelta(document.documentElement.getAttribute("data-tema-scelta")),
    () => SCELTA_PREDEFINITA,
  );
}
