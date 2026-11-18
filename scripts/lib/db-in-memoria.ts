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

// Fase B2b (riclassificazione e popolamento della 0121): anche contains/containedBy (scritture condizionate sui settori), like (solo «%» in
// testa o in coda), range (letture a pagine) e un contatore delle scritture per tabella (la seconda esecuzione non deve scrivere nulla).
export function databaseInMemoria(iniziali: Record<string, RigaMem[]>, opzioni: { fonti?: "0120" | "0121" } = {}) {
  const regola = opzioni.fonti ?? "0120";
  let scrittureGare = 0;
  const scritture: Record<string, number> = {};
  // guasto simulato (pacchetto 16, punto 11: recupero sicuro): la n-esima richiesta di scrittura da adesso si interrompe, PRIMA di essere
  // applicata (rete giù) o DOPO (applicata ma la risposta si perde: timeout, arresto del processo)
  // «prima» e «dopo» = il processo si ferma lì (da quel momento nessuna richiesta passa più, come un arresto o un timeout definitivo);
  // «errore» = la sola richiesta torna con un errore (come fa supabase-js quando la rete cade) e il processo continua
  let richiesteScrittura = 0;
  let guastoAlla: number | null = null;
  let modoGuasto: "prima" | "dopo" | "errore" = "prima";
  let fermo = false;
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
      let intervallo: [number, number] | null = null;
      let operazione: { tipo: "select" } | { tipo: "update"; valori: RigaMem } | { tipo: "upsert"; nuove: RigaMem[]; chiavi: string[]; ignora: boolean } | { tipo: "insert"; nuove: RigaMem[] } | { tipo: "delete" } = { tipo: "select" };
      const esegui = () => {
        if (fermo) throw new Error("processo fermo (guasto simulato)");
        if (operazione.tipo === "select") return esegui0();
        richiesteScrittura++;
        const guasto = guastoAlla !== null && richiesteScrittura === guastoAlla;
        if (guasto && modoGuasto === "errore") return { data: null, error: { message: `guasto simulato: scrittura ${richiesteScrittura} non riuscita (${nome})` } };
        if (guasto && modoGuasto === "prima") {
          fermo = true;
          throw new Error(`guasto simulato prima della scrittura ${richiesteScrittura} (${nome})`);
        }
        const r = esegui0();
        if (guasto) {
          fermo = true;
          throw new Error(`guasto simulato dopo la scrittura ${richiesteScrittura} (${nome})`);
        }
        return r;
      };
      const esegui0 = () => {
        richieste++;
        // righe davvero scritte (una scrittura condizionata che non trova nulla non scrive)
        const conta = (k: number) => {
          if (k > 0) scritture[nome] = (scritture[nome] ?? 0) + k;
        };
        if (operazione.tipo === "update") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          conta(colpite.length);
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
          conta(nuove.length);
          if (nome === "radar_procedure_fonti") dopoProvenienza(nuove);
          return { data: nuove.map((r) => structuredClone(r)), error: null };
        }
        if (operazione.tipo === "delete") {
          const colpite = righe.filter((r) => filtri.every((f) => f(r)));
          conta(colpite.length);
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
              conta(1);
              prima.push({ procedura_id: nuova.procedura_id, fonte: nuova.fonte });
            } else {
              prima.push({ procedura_id: uguale.procedura_id, fonte: uguale.fonte });
              if (!ignora) {
                Object.assign(uguale, structuredClone(n));
                conta(1);
              }
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
        if (intervallo) out = out.slice(intervallo[0], intervallo[1] + 1);
        return { data: out, error: null };
      };
      const elenco = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
      // «%» solo in testa o in coda (le sole forme usate)
      const somiglia = (testo: unknown, schema: string) => {
        const t = String(testo ?? "");
        const s = schema.replace(/^%/, "").replace(/%$/, "");
        if (schema.startsWith("%") && schema.endsWith("%")) return t.includes(s);
        if (schema.startsWith("%")) return t.endsWith(s);
        if (schema.endsWith("%")) return t.startsWith(s);
        return t === s;
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
        is: (c: string, v: null) => (filtri.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, _op: "is", v: null) => (filtri.push((r) => (r[c] ?? null) !== v), q),
        or: (e: string) => (filtri.push(filtroOr(e)), q),
        contains: (c: string, v: unknown[]) => (filtri.push((r) => v.every((x) => elenco(r[c]).includes(x))), q),
        containedBy: (c: string, v: unknown[]) => (filtri.push((r) => elenco(r[c]).every((x) => v.includes(x))), q),
        like: (c: string, schema: string) => (filtri.push((r) => somiglia(r[c], schema)), q),
        range: (da: number, a: number) => ((intervallo = [da, a]), q),
        order: (c: string, o?: { ascending?: boolean }) => ((ordine = { c, asc: o?.ascending !== false }), q),
        limit: (n: number) => ((limite = n), q),
        update: (valori: RigaMem) => ((operazione = { tipo: "update", valori }), q),
        insert: (nuove: RigaMem | RigaMem[]) => ((operazione = { tipo: "insert", nuove: Array.isArray(nuove) ? nuove : [nuove] }), q),
        delete: () => ((operazione = { tipo: "delete" }), q),
        upsert: (nuove: RigaMem | RigaMem[], o: { onConflict: string; ignoreDuplicates?: boolean }) => ((operazione = { tipo: "upsert", nuove: Array.isArray(nuove) ? nuove : [nuove], chiavi: o.onConflict.split(","), ignora: !!o.ignoreDuplicates }), q),
        returns: () => q,
        maybeSingle: () => Promise.resolve({ data: (esegui().data as RigaMem[] | null)?.[0] ?? null, error: null }),
        then: (ok: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
      };
      return q;
    },
  };
  // scritture sulle gare fatte dal trigger delle fonti (per provare che un upsert identico non scrive nulla)
  return {
    tabelle,
    client: client as unknown as SupabaseClient,
    richieste: () => richieste,
    scrittureGareDelTrigger: () => scrittureGare,
    scritture: () => ({ ...scritture }),
    // richieste di scrittura fatte finora; guasto(n, modo): la n-esima richiesta di scrittura da adesso si interrompe (null = nessun guasto)
    richiesteScrittura: () => richiesteScrittura,
    guasto: (n: number | null, modo: "prima" | "dopo" | "errore" = "prima") => {
      guastoAlla = n === null ? null : richiesteScrittura + n;
      modoGuasto = modo;
      // null = si riparte (il processo nuovo della ripresa)
      if (n === null) fermo = false;
    },
  };
}
