import type { Quantita } from "@/lib/piano-lavoro-dati";

// Piano di lavoro: le rese di riferimento e la conversione delle frequenze.
//
// Le rese NON le sceglie il modello di linguaggio: indica a quale categoria appartiene una lavorazione e il codice
// assegna la resa tipica di quella categoria (sempre un'ipotesi da validare, salvo che il bando ne fissi una).
// I valori vengono dai quattro piani di lavoro fatti a mano (Milanosport, Teatro alla Scala, Castello Donnafugata,
// Ferrovie del Sud-Est): la resa tipica è un valore centrale tra quelli usati, il minimo e il massimo sono i
// valori più bassi e più alti incontrati o, dove un solo piano la citava, un intervallo prudente attorno ad essa.

export type CategoriaResa = {
  chiave: string;
  etichetta: string;
  unita: "mq/h" | "unità/h";
  tipica: number;
  minima: number;
  massima: number;
  // da dove viene il valore, SOLO per chi deve validarlo qui nel codice. MAI nell'output: il piano di un cliente non deve parlare di nessun'altra
  // gara, nemmeno nelle note. Per scrivere la fonte di una resa si usa testoFonteResa(), che non nomina nessuno (provato da
  // scripts/verifica-piano-lavoro-riservatezza-omnia-ai.ts).
  provenienzaInterna: string;
};

export const CATEGORIE_RESA: CategoriaResa[] = [
  { chiave: "uffici_ripasso", etichetta: "Uffici, corridoi, ascensori, officine leggere: pulizia giornaliera o di mantenimento", unita: "mq/h", tipica: 300, minima: 220, massima: 380, provenienzaInterna: "Milanosport 250, Scala 220, Donnafugata 320-355, FS Sud-Est 380" },
  { chiave: "uffici_fondo", etichetta: "Uffici e corridoi: pulizia a fondo periodica (vetri, deceratura, pareti, battiscopa)", unita: "mq/h", tipica: 120, minima: 100, massima: 150, provenienzaInterna: "Milanosport 100-120, Scala 150" },
  { chiave: "servizi_igienici", etichetta: "Servizi igienici e bagni: ripasso giornaliero", unita: "mq/h", tipica: 90, minima: 70, massima: 115, provenienzaInterna: "FS Sud-Est 70, Milanosport 100, Donnafugata 115" },
  { chiave: "servizi_igienici_fondo", etichetta: "Servizi igienici: pulizia a fondo o disinfezione periodica", unita: "mq/h", tipica: 60, minima: 50, massima: 90, provenienzaInterna: "Milanosport 60, FS Sud-Est 50" },
  { chiave: "spogliatoi", etichetta: "Spogliatoi e docce: ripasso giornaliero", unita: "mq/h", tipica: 150, minima: 100, massima: 180, provenienzaInterna: "Milanosport 100 (docce) e 180 (spogliatoi), Donnafugata 160" },
  { chiave: "spogliatoi_fondo", etichetta: "Spogliatoi e docce: pulizia a fondo o disinfezione periodica", unita: "mq/h", tipica: 80, minima: 60, massima: 90, provenienzaInterna: "Milanosport 60-90" },
  { chiave: "ambulatori", etichetta: "Ambulatori e locali di primo soccorso (alta cura e disinfezione)", unita: "mq/h", tipica: 170, minima: 150, massima: 195, provenienzaInterna: "Milanosport 150, Donnafugata 195" },
  { chiave: "monumentale_pregio", etichetta: "Aree monumentali, di rappresentanza, palchi e sale teatrali di pregio", unita: "mq/h", tipica: 100, minima: 90, massima: 120, provenienzaInterna: "Scala 100, Donnafugata 95 (monumento)" },
  { chiave: "musei_sale_espositive", etichetta: "Musei, sale espositive, sale con arredi di pregio", unita: "mq/h", tipica: 240, minima: 200, massima: 300, provenienzaInterna: "Donnafugata 240, 435 (museo/uffici)" },
  { chiave: "sale_riunioni_auditorium", etichetta: "Sale riunioni, auditorium, teatri minori e locali a uso saltuario (a richiesta)", unita: "mq/h", tipica: 400, minima: 350, massima: 485, provenienzaInterna: "Donnafugata 400-485" },
  { chiave: "biblioteche", etichetta: "Biblioteche e sale di consultazione con arredi", unita: "mq/h", tipica: 385, minima: 320, massima: 485, provenienzaInterna: "Donnafugata 385-485" },
  { chiave: "scuole_aule", etichetta: "Scuole e aule didattiche", unita: "mq/h", tipica: 225, minima: 200, massima: 300, provenienzaInterna: "Donnafugata 225" },
  { chiave: "tribune_scale", etichetta: "Tribune, gradinate, scale e rampe coperte", unita: "mq/h", tipica: 300, minima: 250, massima: 350, provenienzaInterna: "Milanosport 300" },
  { chiave: "locali_servizio", etichetta: "Locali tecnici, di servizio e non aperti al pubblico", unita: "mq/h", tipica: 280, minima: 220, massima: 320, provenienzaInterna: "Milanosport 280" },
  { chiave: "piscine_coperte", etichetta: "Piscine coperte: bordo vasca e piano vasca", unita: "mq/h", tipica: 200, minima: 150, massima: 250, provenienzaInterna: "Milanosport 200" },
  { chiave: "piscine_scoperte", etichetta: "Piscine scoperte e aree attorno alle vasche (stagionali)", unita: "mq/h", tipica: 250, minima: 200, massima: 300, provenienzaInterna: "Milanosport 250" },
  { chiave: "solarium_verde", etichetta: "Solarium e aree a verde attrezzate", unita: "mq/h", tipica: 400, minima: 300, massima: 450, provenienzaInterna: "Milanosport 400" },
  { chiave: "palestre_coperte", etichetta: "Palestre, palazzetti e campi coperti", unita: "mq/h", tipica: 450, minima: 350, massima: 565, provenienzaInterna: "Milanosport 350, Donnafugata 565" },
  { chiave: "campi_scoperti", etichetta: "Campi, piste e aree sportive scoperte", unita: "mq/h", tipica: 500, minima: 400, massima: 600, provenienzaInterna: "Milanosport 500" },
  { chiave: "esterni_manuali", etichetta: "Aree esterne, cortili, marciapiedi, banchine: scopatura e ripasso manuale", unita: "mq/h", tipica: 800, minima: 700, massima: 1200, provenienzaInterna: "Scala 700, Milanosport 900, FS Sud-Est 1200" },
  { chiave: "esterni_meccanizzati", etichetta: "Piazzali e grandi aree esterne con spazzatrice o lavasciuga", unita: "mq/h", tipica: 2500, minima: 1500, massima: 3000, provenienzaInterna: "FS Sud-Est 2500" },
  { chiave: "esterni_fondo", etichetta: "Aree esterne: pulizia a fondo periodica (infestanti, arredi)", unita: "mq/h", tipica: 150, minima: 100, massima: 200, provenienzaInterna: "Milanosport 150" },
  { chiave: "magazzini_depositi", etichetta: "Magazzini, depositi, laboratori e locali a bassa intensità di uso", unita: "mq/h", tipica: 550, minima: 480, massima: 700, provenienzaInterna: "Scala 500, Donnafugata 485-645, FS Sud-Est 700" },
  { chiave: "archivi_scaffalati", etichetta: "Archivi e locali con scaffalature", unita: "mq/h", tipica: 240, minima: 200, massima: 300, provenienzaInterna: "Donnafugata 240" },
  { chiave: "autorimesse_ecostazioni", etichetta: "Autorimesse, autoparchi, ecostazioni (a richiesta)", unita: "mq/h", tipica: 500, minima: 320, massima: 645, provenienzaInterna: "Donnafugata 320-645" },
  { chiave: "verde_sfalcio", etichetta: "Sfalcio e diserbo di aree verdi", unita: "mq/h", tipica: 300, minima: 250, massima: 350, provenienzaInterna: "Scala 300" },
  { chiave: "periodiche_miste", etichetta: "Lavorazioni periodiche miste (vetri, corrimano, lucidature, lampadari)", unita: "mq/h", tipica: 150, minima: 100, massima: 200, provenienzaInterna: "Scala 150" },
  { chiave: "sanificazione_ambienti", etichetta: "Sanificazione periodica di ambienti (uffici, aree comuni)", unita: "mq/h", tipica: 250, minima: 200, massima: 300, provenienzaInterna: "FS Sud-Est 250" },
  { chiave: "sanificazione_servizi", etichetta: "Sanificazione periodica di servizi igienici", unita: "mq/h", tipica: 50, minima: 40, massima: 70, provenienzaInterna: "FS Sud-Est 50" },
  { chiave: "sanificazione_depositi", etichetta: "Sanificazione periodica di locali a bassa intensità (magazzini, archivi, locali tecnici)", unita: "mq/h", tipica: 500, minima: 400, massima: 600, provenienzaInterna: "FS Sud-Est 500" },
  { chiave: "disinfestazione", etichetta: "Disinfestazione periodica (insetti), a punti o a nebulizzazione", unita: "mq/h", tipica: 3000, minima: 2000, massima: 4000, provenienzaInterna: "FS Sud-Est 3000" },
  { chiave: "derattizzazione", etichetta: "Derattizzazione periodica (controllo esche perimetrali)", unita: "mq/h", tipica: 2000, minima: 1500, massima: 2500, provenienzaInterna: "FS Sud-Est 2000" },
  { chiave: "deblattizzazione", etichetta: "Deblattizzazione periodica (gel/spray su pozzetti e caditoie)", unita: "mq/h", tipica: 1200, minima: 1000, massima: 1500, provenienzaInterna: "FS Sud-Est 1200" },
  { chiave: "apparecchiature_unita", etichetta: "Sanificazione di apparecchiature (es. emettitrici di biglietti): misurata in UNITÀ, non in mq", unita: "unità/h", tipica: 4, minima: 3, massima: 6, provenienzaInterna: "FS Sud-Est 4 unità/h" },
];

export const CHIAVI_CATEGORIE_RESA = CATEGORIE_RESA.map((c) => c.chiave);

export function categoriaResa(chiave: string | null | undefined): CategoriaResa | null {
  return CATEGORIE_RESA.find((c) => c.chiave === chiave) ?? null;
}

// La resa assegnata dal codice: sempre dentro l'intervallo della categoria.
export function resaDaCategoria(chiave: string | null | undefined, proposta?: number | null): number | null {
  const c = categoriaResa(chiave);
  if (!c) return null;
  const v = typeof proposta === "number" && Number.isFinite(proposta) && proposta > 0 ? proposta : c.tipica;
  return Math.min(c.massima, Math.max(c.minima, v));
}

// La fonte di una resa di riferimento, come si scrive nel piano: l'intervallo usuale della categoria, senza nominare nessun'altra gara o cliente.
export function testoFonteResa(c: CategoriaResa): string {
  const n = (x: number) => x.toLocaleString("it-IT");
  return `Resa di riferimento OMNIA AI per questa categoria (intervallo usuale ${n(c.minima)}–${n(c.massima)} ${c.unita}), da validare in sopralluogo`;
}

// L'elenco delle categorie da mostrare al modello (chiave + descrizione + unità), senza i valori: la resa non la sceglie lui.
export function testoCategorieResa(): string {
  return CATEGORIE_RESA.map((c) => `- ${c.chiave}: ${c.etichetta}${c.unita === "unità/h" ? " [unità]" : ""}`).join("\n");
}

// ───── frequenze ─────

export type FrequenzaTipo = "giornaliera" | "n_per_settimana" | "n_per_mese" | "n_per_anno" | "a_richiesta";
export const FREQUENZE_TIPO: FrequenzaTipo[] = ["giornaliera", "n_per_settimana", "n_per_mese", "n_per_anno", "a_richiesta"];

export type FrequenzaConvertita = { valore: Quantita | null; nota: string; ipotesi: boolean };

// Dalla frequenza dichiarata nei documenti al numero di interventi all'anno. «Giornaliera» rimanda al parametro dei
// giorni di servizio, così cambiandolo in Excel si aggiorna tutto; le altre frequenze sono numeri.
export function frequenzaDaTipo(tipo: unknown, n: unknown, contesto: { parametroGiorni: string; settimane: number }): FrequenzaConvertita {
  const numero = typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  const arrotonda = (x: number) => Math.round(x * 100) / 100;
  switch (tipo) {
    case "giornaliera":
      return { valore: { param: contesto.parametroGiorni }, nota: "giornaliera", ipotesi: false };
    case "n_per_settimana":
      return numero === null ? { valore: null, nota: "", ipotesi: false } : { valore: arrotonda(numero * contesto.settimane), nota: `${numero} ${numero === 1 ? "volta" : "volte"}/settimana`, ipotesi: false };
    case "n_per_mese":
      return numero === null ? { valore: null, nota: "", ipotesi: false } : { valore: arrotonda(numero * 12), nota: `${numero} ${numero === 1 ? "volta" : "volte"}/mese`, ipotesi: false };
    case "n_per_anno":
      return numero === null ? { valore: null, nota: "", ipotesi: false } : { valore: numero, nota: `${numero} ${numero === 1 ? "volta" : "volte"}/anno`, ipotesi: false };
    case "a_richiesta":
      return numero === null ? { valore: null, nota: "a richiesta", ipotesi: true } : { valore: numero, nota: `a richiesta (stima ${numero} interventi/anno)`, ipotesi: true };
    default:
      return { valore: null, nota: "", ipotesi: false };
  }
}
