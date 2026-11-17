// Un database in memoria con il sottoinsieme di supabase-js usato dal motore di unione e importazione di Tender Intelligence (select con
// filtri eq/in/is/not/or, order, limit, update condizionato, upsert con chiave unica e ignoreDuplicates, maybeSingle). Nessuna rete e nessun
// database vero: serve a provare unioni, annullamenti e sincronizzazioni senza scrivere da nessuna parte. Nato dalla prova della B1-bis
// (verifica-radar-pvl.ts), esteso in B2a con il comportamento del trigger della migrazione 0120 (radar_procedure.fonti tenute dalla
// provenienza) e con «or», «order» e «limit».
import type { SupabaseClient } from "@supabase/supabase-js";

export type RigaMem = Record<string, unknown>;

export function databaseInMemoria(iniziali: Record<string, RigaMem[]>) {
  const tabelle: Record<string, RigaMem[]> = Object.fromEntries(Object.entries(iniziali).map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
  let contatore = 0;
  let richieste = 0;

  // trigger della 0120: ogni provenienza aggiunge la sua fonte alle fonti della gara
  const dopoProvenienza = (righe: RigaMem[]) => {
    for (const p of righe) {
      const g = (tabelle.radar_procedure ?? []).find((r) => r.id === p.procedura_id);
      if (!g) continue;
      const fonti = Array.isArray(g.fonti) ? (g.fonti as string[]) : [];
      if (!fonti.includes(p.fonte as string)) g.fonti = [...fonti, p.fonte as string];
    }
  };

  // «a.is.null,a.lt.2026-…»: le sole forme usate dal blocco dei giri
  const filtroOr = (espressione: string) => {
    const parti = espressione.split(",").map((p) => p.trim());
    return (r: RigaMem) =>
      parti.some((p) => {
        const [c, op, ...resto] = p.split(".");
        const v = resto.join(".");
        if (op === "is" && v === "null") return (r[c] ?? null) === null;
        if (op === "lt") return r[c] !== null && r[c] !== undefined && String(r[c]) < v;
        if (op === "eq") return String(r[c]) === v;
        return false;
      });
  };

  const client = {
    from(nome: string) {
      const righe = (tabelle[nome] ??= []);
      const filtri: ((r: RigaMem) => boolean)[] = [];
      let ordine: { c: string; asc: boolean } | null = null;
      let limite: number | null = null;
      let operazione: { tipo: "select" } | { tipo: "update"; valori: RigaMem } | { tipo: "upsert"; nuove: RigaMem[]; chiavi: string[]; ignora: boolean } = { tipo: "select" };
      const esegui = () => {
        richieste++;
        if (operazione.tipo === "update") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          for (const r of colpite) Object.assign(r, structuredClone(operazione.valori));
          if (nome === "radar_procedure_fonti") dopoProvenienza(colpite);
          return { data: colpite.map((r) => ({ ...r })), error: null };
        }
        if (operazione.tipo === "upsert") {
          const { chiavi, ignora } = operazione;
          const toccate: RigaMem[] = [];
          for (const n of operazione.nuove) {
            const uguale = righe.find((r) => chiavi.every((k) => (r[k] ?? null) === (n[k] ?? null)));
            if (!uguale) {
              const nuova = structuredClone(n);
              if (nome === "radar_procedure") {
                if (!nuova.id) nuova.id = `mem-${++contatore}`;
                if (!Array.isArray(nuova.fonti)) nuova.fonti = [];
                if (nuova.unita_a === undefined) nuova.unita_a = null;
                if (!Array.isArray(nuova.unita_esclusa_con)) nuova.unita_esclusa_con = [];
                if (!nuova.prima_rilevazione_il) nuova.prima_rilevazione_il = `2026-11-17T00:00:${String(contatore % 60).padStart(2, "0")}.000Z`;
              }
              righe.push(nuova);
              toccate.push(nuova);
            } else {
              if (!ignora) Object.assign(uguale, structuredClone(n));
              toccate.push(uguale);
            }
          }
          if (nome === "radar_procedure_fonti") dopoProvenienza(toccate);
          return { data: toccate.map((r) => structuredClone(r)), error: null };
        }
        let out = righe.filter((r) => filtri.every((f) => f(r))).map((r) => structuredClone(r));
        if (ordine) {
          const { c, asc } = ordine;
          out = out.sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        }
        if (limite !== null) out = out.slice(0, limite);
        return { data: out, error: null };
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        is: (c: string, v: null) => (filtri.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, _op: "is", v: null) => (filtri.push((r) => (r[c] ?? null) !== v), q),
        or: (e: string) => (filtri.push(filtroOr(e)), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ordine = { c, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limite = n), q),
        update: (valori: RigaMem) => ((operazione = { tipo: "update", valori }), q),
        upsert: (nuove: RigaMem[], o: { onConflict: string; ignoreDuplicates?: boolean }) => ((operazione = { tipo: "upsert", nuove, chiavi: o.onConflict.split(","), ignora: !!o.ignoreDuplicates }), q),
        returns: () => q,
        maybeSingle: () => Promise.resolve({ data: (esegui().data as RigaMem[] | null)?.[0] ?? null, error: null }),
        then: (ok: (v: { data: unknown; error: null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
      };
      return q;
    },
  };
  return { tabelle, client: client as unknown as SupabaseClient, richieste: () => richieste };
}
