import { PIANI, PIANI_ORDINE, formatEuro, type PianoSlug } from "./omnia-ai-plans";
import { erroreListino, euroACentesimi, formattaGiorno, giornoRoma, DURATA_MAX_MESI } from "./omnia-ai-catalogo-calcoli";

// Calcoli puri (nessun database, nessuna rete) dell'offerta pilot di OMNIA AI (migrazione 0086):
// un prezzo mensile dedicato a un cliente creato dalla console, per N mesi (0 = sempre), con un
// promemoria negli ultimi 15 giorni. Dopo i mesi indicati il prezzo torna al pieno: lo fa Stripe
// da solo (coupon a durata), qui si calcolano le date e i testi.
//
// Dalla migrazione 0093 l'offerta può anche dedicare al cliente un numero di gare incluse al mese
// (es. 4 invece delle 3 di Starter). Valgono finché dura il prezzo pilot, per l'abbonamento a cui
// l'offerta è stata applicata e finché il cliente resta sul piano dell'offerta; poi tornano quelle del piano.

export const GIORNI_PREAVVISO_PILOT = 15;
export const GARE_PILOT_MAX = 100;
const MS_GIORNO = 24 * 60 * 60 * 1000;

export type OffertaPilot = {
  id: string;
  userId: string;
  piano: PianoSlug;
  prezzoCentesimi: number;
  mesi: number;
  attiva: boolean;
  creataIl: string;
  creataDa: string;
  acquistataIl: string | null;
  scadeIl: string | null;
  prezzoPienoCentesimi: number | null;
  promemoriaInviatoIl: string | null;
  // gare incluse al mese dedicate al cliente (migrazione 0093); null = quelle del piano
  gareIncluse: number | null;
  // l'abbonamento Stripe a cui l'offerta è stata applicata (null finché non è acquistata)
  stripeSubscriptionId: string | null;
};

export type StatoOffertaPilot = "aperta" | "revocata" | "acquistata";

export function statoOffertaPilot(o: Pick<OffertaPilot, "attiva" | "acquistataIl">): StatoOffertaPilot {
  if (o.acquistataIl) return "acquistata";
  return o.attiva ? "aperta" : "revocata";
}

// Il prezzo pilot non può superare il listino: sopra, l'offerta non sarebbe un'offerta e il
// cliente pagherebbe il listino. Si ritorna sempre il più basso dei due.
export function prezzoPilotEffettivo(listino: number, prezzoPilot: number): number {
  return Math.min(listino, prezzoPilot);
}

export function risparmioPilot(listino: number, prezzoPilot: number): number {
  return Math.max(0, listino - prezzoPilot);
}

// `gare` è facoltativo: vuoto = le gare del piano.
export type NuovaOffertaPilotInput = { piano: string; prezzo: string; mesi: string; gare?: string };
export type NuovaOffertaPilotValida = { piano: PianoSlug; prezzoCentesimi: number; mesi: number; gareIncluse: number | null };

export function validaNuovaOffertaPilot(input: NuovaOffertaPilotInput, listini: Record<PianoSlug, number>): { ok: true; valori: NuovaOffertaPilotValida } | { ok: false; errore: string } {
  const pianoGrezzo = input.piano.trim();
  if (!PIANI_ORDINE.includes(pianoGrezzo as PianoSlug)) return { ok: false, errore: "Scegli il piano da offrire." };
  const piano = pianoGrezzo as PianoSlug;

  const prezzoCentesimi = euroACentesimi(input.prezzo);
  const errorePrezzo = erroreListino(prezzoCentesimi);
  if (errorePrezzo || prezzoCentesimi === null) return { ok: false, errore: errorePrezzo ?? "Prezzo non valido." };
  if (prezzoCentesimi >= listini[piano]) return { ok: false, errore: `Il prezzo pilot deve essere inferiore al listino del piano (${formatEuro(listini[piano])}): altrimenti non è un'offerta.` };

  const mesiGrezzi = input.mesi.trim();
  const mesi = mesiGrezzi === "" ? 0 : Number(mesiGrezzi);
  if (!Number.isInteger(mesi) || mesi < 0 || mesi > DURATA_MAX_MESI) return { ok: false, errore: `I mesi di prezzo pilot devono essere un numero intero da 0 a ${DURATA_MAX_MESI} (0 = sempre il prezzo pilot).` };

  // Gare dedicate: solo numeri interi da 1 a GARE_PILOT_MAX (niente «4 gare», «1e1», «2.5»). Se coincidono con
  // quelle del piano non c'è niente di dedicato: si salva null, come se il campo fosse vuoto.
  const gareGrezze = (input.gare ?? "").trim();
  let gareIncluse: number | null = null;
  if (gareGrezze !== "") {
    const gare = /^\d{1,3}$/.test(gareGrezze) ? Number(gareGrezze) : NaN;
    if (!Number.isInteger(gare) || gare < 1 || gare > GARE_PILOT_MAX) return { ok: false, errore: `Le gare incluse al mese devono essere un numero intero da 1 a ${GARE_PILOT_MAX} (oppure lascia vuoto: valgono quelle del piano).` };
    gareIncluse = gare === PIANI[piano].gareIncluse ? null : gare;
  }

  return { ok: true, valori: { piano, prezzoCentesimi, mesi, gareIncluse } };
}

// «4 gare incluse al mese», «1 gara inclusa al mese».
export function testoGareIncluse(n: number): string {
  return n === 1 ? "1 gara inclusa al mese" : `${n} gare incluse al mese`;
}

const haGareDedicate = (o: { gareIncluse?: number | null }): o is { gareIncluse: number } => typeof o.gareIncluse === "number";

// Il testo dell'offerta nell'area riservata del cliente (e nell'anteprima in console). `gareDelPiano` serve a dire a
// quante gare si torna a fine pilot: lo si passa solo se l'offerta dedica delle gare.
export function testoOffertaPilot(o: Pick<OffertaPilot, "prezzoCentesimi" | "mesi"> & { gareIncluse?: number | null }, nomePiano: string, listino: number, gareDelPiano?: number): string {
  const prezzo = formatEuro(prezzoPilotEffettivo(listino, o.prezzoCentesimi));
  const conGare = haGareDedicate(o) ? `, con ${testoGareIncluse(o.gareIncluse)}` : "";
  if (o.mesi === 0) return `Offerta riservata a te: piano ${nomePiano} a ${prezzo} al mese, IVA inclusa${conGare}, per tutta la durata dell'abbonamento.`;
  const durata = o.mesi === 1 ? "per il primo mese" : `per i primi ${o.mesi} mesi`;
  const poiGare = haGareDedicate(o) && typeof gareDelPiano === "number" ? `, con ${testoGareIncluse(gareDelPiano)}` : "";
  return `Offerta riservata a te: piano ${nomePiano} a ${prezzo} al mese, IVA inclusa${conGare}, ${durata}. Poi il rinnovo avviene a prezzo pieno: ${formatEuro(listino)} al mese${poiGare}.`;
}

// ───── Gare incluse effettive ─────

export type OffertaPerQuota = Pick<OffertaPilot, "piano" | "gareIncluse" | "acquistataIl" | "scadeIl" | "mesi" | "stripeSubscriptionId">;

// Le gare incluse al mese di un abbonamento attivo: quelle dell'offerta pilot SOLO se tutte queste cose sono vere,
// altrimenti quelle del piano (mai un numero inventato, mai un'eccezione che resta per sbaglio):
//   - l'offerta dedica delle gare;
//   - il prezzo pilot è in corso (acquistato e, se ha una scadenza, non ancora scaduta);
//   - il cliente è ancora sul piano dell'offerta (cambiando piano il prezzo e le gare non sono più quelle pattuite);
//   - l'offerta è stata applicata proprio a QUESTO abbonamento Stripe (chi disdice e si riabbona non la riporta dietro).
export function gareIncluseEffettive(p: { gareDelPiano: number; pianoAbbonamento: PianoSlug | null; stripeSubscriptionId: string | null; offerta: OffertaPerQuota | null; adesso: Date }): number {
  const { offerta } = p;
  if (!offerta || !haGareDedicate(offerta)) return p.gareDelPiano;
  if (!pilotInCorso(offerta, p.adesso)) return p.gareDelPiano;
  if (p.pianoAbbonamento === null || p.pianoAbbonamento !== offerta.piano) return p.gareDelPiano;
  if (!p.stripeSubscriptionId || offerta.stripeSubscriptionId !== p.stripeSubscriptionId) return p.gareDelPiano;
  return offerta.gareIncluse;
}

// La voce «N gare incluse ogni mese» del piano, come la vede il cliente con un'offerta che dedica delle gare:
// «4 gare incluse ogni mese per i primi 6 mesi, poi 3 al mese» (con mesi = 0 non c'è un «poi»).
export function voceGarePilot(o: { gareIncluse: number; mesi: number }, gareDelPiano: number): string {
  const base = o.gareIncluse === 1 ? "1 gara inclusa ogni mese" : `${o.gareIncluse} gare incluse ogni mese`;
  if (o.mesi === 0) return base;
  return `${base} ${o.mesi === 1 ? "per il primo mese" : `per i primi ${o.mesi} mesi`}, poi ${gareDelPiano} al mese`;
}

// Sostituisce nell'elenco dei vantaggi del piano la voce delle gare (la prima che dice «N gare incluse…»), o la mette in testa se non c'è.
export function vociConGarePilot(voci: string[], o: { gareIncluse: number; mesi: number }, gareDelPiano: number): string[] {
  const voce = voceGarePilot(o, gareDelPiano);
  const i = voci.findIndex((v) => /^\d+\s+gar[ae]\s+inclus[ae]/i.test(v.trim()));
  if (i === -1) return [voce, ...voci];
  return voci.map((v, j) => (j === i ? voce : v));
}

// Aggiunge N mesi di calendario (stesso giorno del mese, o l'ultimo se il mese di arrivo è più corto).
// Serve solo come ripiego se Stripe non restituisse la data di fine dello sconto.
export function aggiungiMesi(da: Date, mesi: number): Date {
  const d = new Date(da.getTime());
  const giorno = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mesi);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(giorno, ultimo));
  return d;
}

// La fine dello sconto di un abbonamento Stripe: nell'elenco `discounts` (espanso) ogni sconto ha `end`
// (secondi Unix, null se non finisce mai). Un elemento non espanso (solo l'identificativo) non dice nulla.
export function fineScontoStripe(sconti: ({ end?: number | null } | string)[] | null | undefined): number | null {
  for (const s of sconti ?? []) {
    if (typeof s === "string") continue;
    if (typeof s.end === "number" && Number.isFinite(s.end)) return s.end;
  }
  return null;
}

// Quando finisce il prezzo pilot. Con mesi = 0 non finisce mai (null), qualunque cosa dica Stripe. Con
// mesi ≠ 0 vale la data dello sconto dichiarata da Stripe; se manca si calcola dai mesi.
export function scadenzaPilot(mesi: number, fineScontoUnix: number | null, adesso: Date): Date | null {
  if (mesi === 0) return null;
  return fineScontoUnix !== null ? new Date(fineScontoUnix * 1000) : aggiungiMesi(adesso, mesi);
}

export type PromemoriaPilot = { giorni: number; scadeIlGiorno: string };

// Il promemoria dei «ultimi 15 giorni»: c'è solo per un'offerta acquistata con una scadenza (mesi ≠ 0),
// da 15 giorni prima fino al momento della scadenza. `giorni` è quanti giorni mancano (arrotondati per
// eccesso, minimo 1 finché non è scaduta).
export function promemoriaPilot(o: Pick<OffertaPilot, "acquistataIl" | "scadeIl">, adesso: Date): PromemoriaPilot | null {
  if (!o.acquistataIl || !o.scadeIl) return null;
  const scade = Date.parse(o.scadeIl);
  if (!Number.isFinite(scade)) return null;
  const mancano = scade - adesso.getTime();
  if (mancano <= 0) return null;
  if (mancano > GIORNI_PREAVVISO_PILOT * MS_GIORNO) return null;
  return { giorni: Math.max(1, Math.ceil(mancano / MS_GIORNO)), scadeIlGiorno: giornoRoma(new Date(scade)) };
}

// `gareDopo`: le gare del piano a cui si torna a fine pilot, da passare solo se l'offerta dedica delle gare.
export function testoPromemoriaPilot(p: PromemoriaPilot, prezzoPienoCentesimi: number, gareDopo?: number): string {
  const fra = p.giorni === 1 ? "domani" : `fra ${p.giorni} giorni`;
  const gare = typeof gareDopo === "number" ? ` e le gare incluse tornano a ${gareDopo} al mese` : "";
  return `Il tuo prezzo pilot scade ${fra}, il ${formattaGiorno(p.scadeIlGiorno)}. Dopo quella data l'abbonamento si rinnova a prezzo pieno: ${formatEuro(prezzoPienoCentesimi)} al mese, IVA inclusa${gare}.`;
}

// Cosa mostra la pagina Abbonamento a chi ha un pilot in corso. `gareIncluse` è il numero di gare DEDICATE oggi in
// vigore (null se il cliente ha quelle del piano) e `gareDopo` quelle del piano a cui si torna a fine pilot.
export function testoPilotInCorso(o: Pick<OffertaPilot, "prezzoCentesimi" | "mesi" | "scadeIl" | "prezzoPienoCentesimi"> & { gareIncluse?: number | null }, gareDopo?: number): string {
  const prezzo = formatEuro(o.prezzoCentesimi);
  const conGare = haGareDedicate(o) ? `, con ${testoGareIncluse(o.gareIncluse)}` : "";
  if (o.mesi === 0 || !o.scadeIl) return `Hai un prezzo dedicato: ${prezzo} al mese, IVA inclusa${conGare}, per tutta la durata dell'abbonamento.`;
  const doveTorna = haGareDedicate(o) && typeof gareDopo === "number" ? `, con ${testoGareIncluse(gareDopo)}` : "";
  const pieno = o.prezzoPienoCentesimi ? ` Dopo, il rinnovo sarà a prezzo pieno: ${formatEuro(o.prezzoPienoCentesimi)} al mese${doveTorna}.` : " Dopo, il rinnovo sarà a prezzo pieno.";
  return `Hai un prezzo pilot: ${prezzo} al mese, IVA inclusa${conGare}, fino al ${formattaGiorno(giornoRoma(new Date(o.scadeIl)))}.${pieno}`;
}

// ───── Catalogo con l'offerta pilot ─────

// Il catalogo come lo vede QUESTO cliente: il piano offerto mostra il prezzo pilot al posto del prezzo
// di oggi, con lo stesso aspetto di uno sconto (listino barrato, prezzo, frase dell'offerta); gli altri
// piani restano com'erano. Se il prezzo pilot non è inferiore al listino non è un'offerta: nulla cambia.
// `pianoPredefinito` è il piano da selezionare in partenza nel modulo di acquisto.
//
// Se l'offerta dedica delle gare, il piano offerto mostra anche quelle (numero e voce «N gare incluse ogni mese»,
// con il «poi» a fine pilot): il cliente vede ciò che avrà davvero.
export function applicaPilotAlCatalogo<T extends { slug: PianoSlug; prezzoListinoCentesimi: number; prezzoCentesimi: number; sconto: unknown; gareIncluse?: number; voci?: string[] }>(
  piani: T[],
  offerta: (Pick<OffertaPilot, "id" | "piano" | "prezzoCentesimi" | "mesi"> & { gareIncluse?: number | null }) | null,
): { piani: T[]; pianoPredefinito: PianoSlug | null } {
  if (!offerta) return { piani, pianoPredefinito: null };
  const risparmio = (listino: number) => risparmioPilot(listino, offerta.prezzoCentesimi);
  const offerto = piani.find((p) => p.slug === offerta.piano);
  if (!offerto || risparmio(offerto.prezzoListinoCentesimi) <= 0) return { piani, pianoPredefinito: null };

  return {
    piani: piani.map((p) =>
      p.slug !== offerta.piano
        ? p
        : {
            ...p,
            ...(haGareDedicate(offerta)
              ? { gareIncluse: offerta.gareIncluse, voci: vociConGarePilot(p.voci ?? [], { gareIncluse: offerta.gareIncluse, mesi: offerta.mesi }, p.gareIncluse ?? PIANI[p.slug].gareIncluse) }
              : {}),
            prezzoCentesimi: prezzoPilotEffettivo(p.prezzoListinoCentesimi, offerta.prezzoCentesimi),
            sconto: {
              id: offerta.id,
              nome: "Offerta riservata a te",
              tipo: "prezzo" as const,
              percentuale: null,
              validoAl: null,
              durataMesi: offerta.mesi,
              prezzoCentesimi: prezzoPilotEffettivo(p.prezzoListinoCentesimi, offerta.prezzoCentesimi),
              risparmioCentesimi: risparmio(p.prezzoListinoCentesimi),
            },
          },
    ),
    pianoPredefinito: offerta.piano,
  };
}

// Il prezzo pilot è ancora «in corso»: acquistato e, se ha una scadenza, non ancora scaduta.
export function pilotInCorso(o: Pick<OffertaPilot, "acquistataIl" | "scadeIl" | "mesi">, adesso: Date): boolean {
  if (!o.acquistataIl) return false;
  if (o.mesi === 0 || !o.scadeIl) return true;
  return Date.parse(o.scadeIl) > adesso.getTime();
}
