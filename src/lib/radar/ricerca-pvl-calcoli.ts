// C2 (decisione dell'utente del 23/11, nota 49C, R2 e R3): misura per codice dell'elenco di RICERCA della PVL, per la potatura. Logica pura,
// nessun database: legge le righe del registro dei giri (0128, campo «avvisi.per_codice» scritto dal giro PVL). Provata da
// scripts/verifica-radar-c2-pvl.ts. La console (B1) mostra la tabella; NIENTE si toglie da solo: un codice si toglie SOLO con una decisione
// dell'utente e una modifica registrata del file dell'elenco (src/lib/radar/dati/cpv-ricerca-pvl.csv).
import { CPV_RICERCA_PVL } from "./cpv-ricerca-pvl-dati";
import { eCodiceDivisione } from "./fonti/pvl-calcoli";

// dopo 4 settimane di misura la console mostra i codici con 0 gare A o B e più di 50 avvisi letti (49C, R2)
export const GIORNI_MISURA_CODICI = 28;
export const SOGLIA_AVVISI_DA_VALUTARE = 50;

export type MisuraCodiceRicerca = {
  cpv: string;
  descrizione: string | null;
  divisione: boolean;
  letti: number;
  bandi: number;
  a: number;
  b: number;
  fuori_settore: number;
};

export type MisuraRicercaPvl = {
  // la riga più vecchia considerata (giro PVL con la misura) e se la misura copre già le 4 settimane
  dal: string | null;
  completa: boolean;
  giri: number;
  nonAttribuiti: number;
  // tutti i codici dell'elenco, nell'ordine del file; i codici di divisione hanno «divisione» vero (R3: mostrati a parte)
  codici: MisuraCodiceRicerca[];
  // SOLO a misura completa: i codici con 0 gare A o B e più di 50 avvisi letti, da far VALUTARE all'utente (mai tolti in automatico)
  daValutare: string[];
  // R4 (decisione dell'utente del 23/11): su tutti i giri con la misura, le coppie codice → descrizione scritte dalla PVL per i codici
  // ancora senza descrizione nel file (la prima vista), e le descrizioni sconosciute degli avvisi non attribuiti, dalla più frequente.
  // Il file si completa a mano, con un commit, dopo la verifica: niente si scrive da solo
  descrizioniDaCompletare: Record<string, string>;
  descrizioniSconosciute: { testo: string; volte: number }[];
};

type RigaRegistro = { fonte: string; iniziato_il: string; esito: string; avvisi: Record<string, unknown> | null };

const oggetto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function misuraCodiciRicercaPvl(righe: readonly RigaRegistro[], adesso: Date): MisuraRicercaPvl {
  const inizio = adesso.getTime() - GIORNI_MISURA_CODICI * 86_400_000;
  // i giri PVL veri con la misura (dal C2 in poi: il campo «per_codice» esiste)
  const conMisura = righe.filter((r) => r.fonte === "pvl" && ["ok", "errore", "sospesa"].includes(r.esito) && "per_codice" in oggetto(r.avvisi));
  const dentro = conMisura.filter((r) => Date.parse(r.iniziato_il) >= inizio && Date.parse(r.iniziato_il) <= adesso.getTime());
  const primo = [...conMisura].map((r) => r.iniziato_il).filter((t) => Number.isFinite(Date.parse(t))).sort()[0] ?? null;
  const completa = primo !== null && Date.parse(primo) <= inizio;
  const somma = new Map<string, MisuraCodiceRicerca>();
  for (const r of CPV_RICERCA_PVL) somma.set(r.cpv, { cpv: r.cpv, descrizione: r.descrizione, divisione: eCodiceDivisione(r.cpv), letti: 0, bandi: 0, a: 0, b: 0, fuori_settore: 0 });
  let nonAttribuiti = 0;
  for (const r of dentro) {
    nonAttribuiti += numero(oggetto(r.avvisi).non_attribuiti);
    for (const [cpv, m] of Object.entries(oggetto(oggetto(r.avvisi).per_codice))) {
      const t = somma.get(cpv);
      if (!t) continue; // un codice tolto dall'elenco nel frattempo: non si mostra più
      const x = oggetto(m);
      t.letti += numero(x.letti);
      t.bandi += numero(x.bandi);
      t.a += numero(x.a);
      t.b += numero(x.b);
      t.fuori_settore += numero(x.fuori_settore);
    }
  }
  const senzaDescrizione = new Set(CPV_RICERCA_PVL.filter((r) => !r.descrizione).map((r) => r.cpv));
  const descrizioniDaCompletare: Record<string, string> = {};
  const sconosciute = new Map<string, number>();
  for (const r of [...conMisura].sort((x, y) => x.iniziato_il.localeCompare(y.iniziato_il))) {
    for (const [cpv, t] of Object.entries(oggetto(oggetto(r.avvisi).descrizioni_da_completare)))
      if (senzaDescrizione.has(cpv) && typeof t === "string" && t && !(cpv in descrizioniDaCompletare)) descrizioniDaCompletare[cpv] = t;
    for (const [t, n] of Object.entries(oggetto(oggetto(r.avvisi).descrizioni_sconosciute))) sconosciute.set(t, (sconosciute.get(t) ?? 0) + numero(n));
  }
  const codici = [...somma.values()];
  return {
    dal: dentro.length ? [...dentro].map((r) => r.iniziato_il).sort()[0] : null,
    completa,
    giri: dentro.length,
    nonAttribuiti,
    codici,
    daValutare: completa ? codici.filter((c) => c.a + c.b === 0 && c.letti > SOGLIA_AVVISI_DA_VALUTARE).map((c) => c.cpv) : [],
    descrizioniDaCompletare,
    descrizioniSconosciute: [...sconosciute].map(([testo, volte]) => ({ testo, volte })).sort((x, y) => y.volte - x.volte || x.testo.localeCompare(y.testo)),
  };
}
