// Classificazione durante le importazioni (fase B2b, 17/11/2026): gli importatori (TED, e PVL, Sintel, SardegnaCAT con la scrittura unica)
// tengono COERENTI la colonna «settori», le righe della 0121, lo stato, le provenienze e lo storico. Logica pura; le scritture le fanno gli
// importatori dentro i giri che esistono già (nessuna lettura periodica nuova). SOLO con l'interruttore acceso (ambiente.ts: spento).
//
// Regole (le stesse dello script unico di popolamento, riclassifica-settori.ts):
//   - un solo calcolo: classificaPerArchivio sui dati UNITI della gara, con i lotti che restano in archivio dopo la scrittura;
//   - gara di più fonti (decisione D3 dell'utente del 17/11): per ogni settore la rilevanza MIGLIORE tra i dati uniti, la versione della
//     fonte appena letta e la gara com'era prima; le provenienze restano in «per_fonte», i disaccordi segnano la riga «ambigua»;
//   - la colonna «settori» = i settori con rilevanza A o B (così la colonna e le righe dicono la stessa cosa); il cambio della colonna su
//     una gara che esisteva già si traccia nel registro (correzione_dati, campo «settori», mai notificabile).
import { classificaPerArchivio, type ClassificazioneArchivio, type DatiDaClassificare, type LottoDaClassificare } from "./classificazione-unita";
import { righeDaClassificazione, type ClassificazioneDiFonte, type RigaClassificazione } from "./classificazioni-calcoli";
import { valoreRegistro, type StatoSettori } from "./riclassifica-settori";
import { VERSIONE_REGOLE_SETTORI, type SettoreRadar } from "./settori";

const RANGO = { A: 0, B: 1, C: 2 } as const;

export type ClassificazioneImportata = {
  unita: ClassificazioneArchivio;
  perFonte: ClassificazioneDiFonte[] | undefined;
  // la colonna «settori» e il metodo coerenti con le righe
  settori: SettoreRadar[];
  metodo: "cpv" | "parole_chiave" | null;
};

export function classificaImportazione(x: {
  dati: DatiDaClassificare;
  lotti: readonly LottoDaClassificare[];
  fonte: string;
  // la versione appena letta dalla fonte, da sola (serve solo se la gara ha anche altre fonti)
  versioneFonte: { dati: DatiDaClassificare; lotti: readonly LottoDaClassificare[] } | null;
  // la gara com'era prima di questa importazione, con le sue fonti (null = gara nuova)
  prima: { dati: DatiDaClassificare; lotti: readonly LottoDaClassificare[]; fonti: readonly string[] } | null;
}): ClassificazioneImportata {
  const unita = classificaPerArchivio(x.dati, x.lotti);
  const altre = [...new Set((x.prima?.fonti ?? []).filter((f) => f !== x.fonte))].sort();
  const perFonte: ClassificazioneDiFonte[] | undefined =
    x.prima && altre.length && x.versioneFonte
      ? [
          { fonte: x.fonte, classificazione: classificaPerArchivio(x.versioneFonte.dati, x.versioneFonte.lotti) },
          { fonte: altre.join("+"), classificazione: classificaPerArchivio(x.prima.dati, x.prima.lotti) },
        ]
      : undefined;
  const tutte = [unita, ...(perFonte ?? []).map((p) => p.classificazione)];
  const migliore = new Map<SettoreRadar, number>();
  for (const c of tutte) for (const [s, v] of Object.entries(c.perSettore) as [SettoreRadar, { livello: "A" | "B" | "C" }][]) migliore.set(s, Math.min(migliore.get(s) ?? 2, RANGO[v.livello]));
  const ordine = [...new Set(tutte.flatMap((c) => c.settori))];
  const settori = ordine.filter((s) => (migliore.get(s) ?? 2) < 2);
  for (const [s, r] of migliore) if (r < 2 && !settori.includes(s)) settori.push(s);
  const conSettori = tutte.find((c) => c.settori.length > 0);
  const metodo = settori.length ? (unita.settori.length ? unita.metodo : (conSettori?.metodo ?? "cpv")) : null;
  return { unita, perFonte, settori, metodo };
}

export function righeImportate(ci: ClassificazioneImportata, x: { proceduraId: string; fonti: readonly string[]; fonte: string; adessoIso: string; nuovoId: () => string }): RigaClassificazione[] {
  return righeDaClassificazione(ci.unita, {
    proceduraId: x.proceduraId,
    origine: "importazione",
    fonti: [...new Set(x.fonti)],
    autore: `importazione:${x.fonte}`,
    adessoIso: x.adessoIso,
    nuovoId: x.nuovoId,
    perFonte: ci.perFonte,
    settoriColonna: ci.settori,
  });
}

const stessi = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function cambiaColonna(prima: { settori: readonly string[]; metodo_settore: string | null }, ci: Pick<ClassificazioneImportata, "settori" | "metodo">): boolean {
  // il metodo conta solo se la gara ha dei settori (senza settori la colonna del metodo non dice nulla)
  return !stessi(prima.settori, ci.settori) || (ci.settori.length > 0 && (prima.metodo_settore ?? null) !== (ci.metodo ?? null));
}

/** La traccia del cambio della colonna su una gara che esisteva già (null se non cambia). Mai notificabile. */
export function rigaRegistroImportazione(proceduraId: string, prima: StatoSettori, ci: Pick<ClassificazioneImportata, "settori" | "metodo">, fonte: string, idCambiamento: string): Record<string, unknown> | null {
  if (!cambiaColonna({ settori: prima.settori, metodo_settore: prima.metodo }, ci)) return null;
  return {
    procedura_id: proceduraId,
    tipo: "correzione_dati",
    campo: "settori",
    valore_precedente: valoreRegistro(prima),
    valore_nuovo: valoreRegistro({ settori: [...ci.settori], metodo: ci.metodo }),
    fonte,
    id_fonte: `regole-settori-${VERSIONE_REGOLE_SETTORI}:importazione:${idCambiamento}`.slice(0, 200),
    nota: `Settori ricalcolati con le regole ${VERSIONE_REGOLE_SETTORI} sui dati aggiornati della gara.`,
    notificabile: false,
  };
}

/** I lotti che restano in archivio dopo una scrittura per numero di lotto (upsert su procedura + numero): quelli scritti sostituiscono. */
export function lottiDopoScrittura<L extends { numero_lotto: string }>(esistenti: readonly L[], scritti: readonly L[]): L[] {
  const m = new Map<string, L>();
  for (const l of esistenti) m.set(l.numero_lotto, l);
  for (const l of scritti) m.set(l.numero_lotto, l);
  return [...m.values()].sort((a, b) => a.numero_lotto.localeCompare(b.numero_lotto));
}
