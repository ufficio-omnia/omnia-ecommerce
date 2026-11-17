// Un database in memoria con il sottoinsieme di supabase-js usato dal motore di unione e importazione di Tender Intelligence (select con
// filtri eq/in/is/not/or, order, limit, update condizionato, upsert con chiave unica e ignoreDuplicates, maybeSingle). Nessuna rete e nessun
// database vero: serve a provare unioni, annullamenti e sincronizzazioni senza scrivere da nessuna parte. Nato dalla prova della B1-bis
// (verifica-radar-pvl.ts), esteso in B2a con il comportamento del trigger della migrazione 0120 (radar_procedure.fonti tenute dalla
// provenienza) e con «or», «order» e «limit». Fase B2 (0121, progetto): inserimento, cancellazione con le cascate delle chiavi esterne e,
// con { fonti: "0121" }, la regola nuova delle fonti (anche la gara di ORIGINE si ricalcola quando una provenienza cambia gara o sparisce).
import type { SupabaseClient } from "@supabase/supabase-js";

export type RigaMem = Record<string, unknown>;

// tabelle con la chiave esterna procedura_id → radar_procedure ON DELETE CASCADE
const A_CASCATA = ["radar_procedure_fonti", "radar_lotti", "radar_aggiornamenti", "radar_classificazioni"];

export function databaseInMemoria(iniziali: Record<string, RigaMem[]>, opzioni: { fonti?: "0120" | "0121" } = {}) {
  const regola = opzioni.fonti ?? "0120";
  let scrittureGare = 0;
  const tabelle: Record<string, RigaMem[]> = Object.fromEntries(Object.entries(iniziali).map(([k, v]) => [k, v.map((r) => structuredClone(r))]));
  let contatore = 0;
  let richieste = 0;

  // trigger della 0120: ogni provenienza aggiunge la sua fonte alle fonti della gara
  // (0121) quando una provenienza cambia gara o sparisce: le fonti della gara di origine dalle provenienze rimaste, scritte solo se cambiano
  const ricalcolaOrigine = (proceduraId: unknown) => {
    const g = (tabelle.radar_procedure ?? []).find((r) => r.id === proceduraId);
    if (!g) return;
    const nuove = [...new Set((tabelle.radar_procedure_fonti ?? []).filter((p) => p.procedura_id === proceduraId).map((p) => p.fonte as string))].sort();
    const ora = Array.isArray(g.fonti) ? (g.fonti as string[]) : [];
    if (nuove.length !== new Set(ora).size || nuove.some((f) => !ora.includes(f))) {
      g.fonti = nuove;
      scrittureGare++;
    }
  };
  const dopoProvenienza = (righe: RigaMem[], prima: { procedura_id: unknown; fonte: unknown }[] = []) => {
    righe.forEach((p, i) => {
      const g = (tabelle.radar_procedure ?? []).find((r) => r.id === p.procedura_id);
      if (g) {
        const fonti = Array.isArray(g.fonti) ? (g.fonti as string[]) : [];
        if (!fonti.includes(p.fonte as string)) {
          g.fonti = [...fonti, p.fonte as string];
          scrittureGare++;
        }
      }
      const v = prima[i];
      if (regola === "0121" && v && (v.procedura_id !== p.procedura_id || v.fonte !== p.fonte)) ricalcolaOrigine(v.procedura_id);
    });
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
      let operazione: { tipo: "select" } | { tipo: "update"; valori: RigaMem } | { tipo: "upsert"; nuove: RigaMem[]; chiavi: string[]; ignora: boolean } | { tipo: "insert"; nuove: RigaMem[] } | { tipo: "delete" } = { tipo: "select" };
      const esegui = () => {
        richieste++;
        if (operazione.tipo === "update") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          const prima = colpite.map((r) => ({ procedura_id: r.procedura_id, fonte: r.fonte }));
          for (const r of colpite) Object.assign(r, structuredClone(operazione.valori));
          if (nome === "radar_procedure_fonti") dopoProvenienza(colpite, prima);
          return { data: colpite.map((r) => ({ ...r })), error: null };
        }
        if (operazione.tipo === "insert") {
          const nuove: RigaMem[] = operazione.nuove.map((n) => ({ ...(n.id ? {} : { id: `mem-${++contatore}` }), ...structuredClone(n) }));
          // vincolo «una sola classificazione attiva per gara e settore» (indice unico parziale della 0121)
          if (nome === "radar_classificazioni") {
            for (const n of nuove) {
              if (n.attiva !== false && [...righe, ...nuove.filter((x) => x !== n)].some((r) => r.attiva !== false && r.procedura_id === n.procedura_id && r.settore === n.settore)) {
                return { data: null, error: { message: "duplicate key value violates unique constraint \"radar_classificazioni_attiva_uidx\"", code: "23505" } };
              }
            }
          }
          righe.push(...nuove);
          if (nome === "radar_procedure_fonti") dopoProvenienza(nuove);
          return { data: nuove.map((r) => structuredClone(r)), error: null };
        }
        if (operazione.tipo === "delete") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          for (const r of colpite) righe.splice(righe.indexOf(r), 1);
          if (nome === "radar_procedure") {
            const ids = new Set(colpite.map((r) => r.id));
            for (const t of A_CASCATA) tabelle[t] = (tabelle[t] ?? []).filter((r) => !ids.has(r.procedura_id));
          }
          if (nome === "radar_procedure_fonti" && regola === "0121") for (const p of colpite) ricalcolaOrigine(p.procedura_id);
          return { data: colpite.map((r) => structuredClone(r)), error: null };
        }
        if (operazione.tipo === "upsert") {
          const { chiavi, ignora } = operazione;
          const toccate: RigaMem[] = [];
          const prima: { procedura_id: unknown; fonte: unknown }[] = [];
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
              prima.push({ procedura_id: nuova.procedura_id, fonte: nuova.fonte });
            } else {
              prima.push({ procedura_id: uguale.procedura_id, fonte: uguale.fonte });
              if (!ignora) Object.assign(uguale, structuredClone(n));
              toccate.push(uguale);
            }
          }
          if (nome === "radar_procedure_fonti") dopoProvenienza(toccate, prima);
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
        insert: (nuove: RigaMem | RigaMem[]) => ((operazione = { tipo: "insert", nuove: Array.isArray(nuove) ? nuove : [nuove] }), q),
        delete: () => ((operazione = { tipo: "delete" }), q),
        upsert: (nuove: RigaMem[], o: { onConflict: string; ignoreDuplicates?: boolean }) => ((operazione = { tipo: "upsert", nuove, chiavi: o.onConflict.split(","), ignora: !!o.ignoreDuplicates }), q),
        returns: () => q,
        maybeSingle: () => Promise.resolve({ data: (esegui().data as RigaMem[] | null)?.[0] ?? null, error: null }),
        then: (ok: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
      };
      return q;
    },
  };
  // scritture sulle gare fatte dal trigger delle fonti (per provare che un upsert identico non scrive nulla)
  return { tabelle, client: client as unknown as SupabaseClient, richieste: () => richieste, scrittureGareDelTrigger: () => scrittureGare };
}
