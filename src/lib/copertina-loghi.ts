import sharp, { type OutputInfo, type OverlayOptions } from "sharp";
import {
  LARGHEZZA_MISURA_DETTAGLIO,
  DIMENSIONI,
  POSIZIONE_PREDEFINITA,
  ZONA_CLIENTE,
  ZONA_STAZIONE,
  metaZona,
  zonaPer,
  type Dimensione,
  type Posizione,
  coloriPrincipali,
  contenutoVisibile,
  dettaglio,
  leggibilita,
  preparaSfondo,
  rettangoloLogo,
  serveVelatura,
  type Rettangolo,
  type Sfondo,
  type Zona,
} from "@/lib/copertina-loghi-calcoli";

// I loghi sulla copertina, applicati dal codice dopo che il modello ha disegnato la pagina (regole e motivi in copertina-loghi-calcoli.ts).
// Nessun riquadro e nessun pannello: il logo originale, senza sfondo, direttamente sull'immagine. Se l'immagine sotto il logo è troppo carica o il logo
// non si stacca, l'immagine si schiarisce lì sotto con una sfumatura morbida senza bordi, così il logo si vede bene.

// Lato massimo su cui si lavora un logo: la zona sulla pagina è al massimo di circa 570 × 314 px, il doppio basta e avanza
const LATO_LAVORO = 1400;

export type LogoPronto = {
  // PNG con trasparenza, senza margini vuoti
  png: Buffer;
  larghezza: number;
  altezza: number;
  // com'era lo sfondo: già trasparente, tolto (era bianco), o lasciato com'è (non si poteva togliere senza rischiare di rovinare il logo)
  sfondo: Sfondo;
  motivo: string | null;
  // i colori principali, da suggerire al modello per l'armonia della pagina
  colori: string[];
};

// Dal file caricato dal cliente al logo pronto da applicare. undefined se il file non è un'immagine leggibile o non ha nulla di visibile.
export async function preparaLogo(origine: Buffer): Promise<LogoPronto | undefined> {
  let grezzo: { data: Buffer; info: OutputInfo };
  try {
    grezzo = await sharp(origine)
      .rotate()
      .ensureAlpha()
      .resize({ width: LATO_LAVORO, height: LATO_LAVORO, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return undefined;
  }
  const { width, height } = grezzo.info;
  const esito = preparaSfondo(new Uint8Array(grezzo.data), width, height);
  const visibile = contenutoVisibile(esito.rgba, width, height);
  if (!visibile) return undefined;
  const png = await sharp(Buffer.from(esito.rgba), { raw: { width, height, channels: 4 } }).extract(visibile).png().toBuffer();
  return { png, larghezza: visibile.width, altezza: visibile.height, sfondo: esito.sfondo, motivo: esito.motivo, colori: coloriPrincipali(esito.rgba) };
}

// Quanto la sfumatura va oltre il logo: l'ellisse ha i semiassi pari a queste frazioni di larghezza e altezza del logo (0,5 = il logo esatto)
const VELATURA_ORIZZONTALE = 0.78;
const VELATURA_VERTICALE = 0.85;

// La sfumatura che schiarisce (o scurisce) l'immagine sotto un logo: un'ellisse piena al centro che svanisce verso i bordi, senza nessun contorno. Agli
// angoli del suo rettangolo è del tutto trasparente: non è un riquadro.
async function velatura(larghezza: number, altezza: number, chiara: boolean): Promise<Buffer> {
  const colore = chiara ? "#ffffff" : "#10141f";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larghezza}" height="${altezza}"><defs><radialGradient id="v" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${colore}" stop-opacity="0.86"/><stop offset="52%" stop-color="${colore}" stop-opacity="0.8"/><stop offset="80%" stop-color="${colore}" stop-opacity="0.32"/><stop offset="100%" stop-color="${colore}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Quanto è movimentata l'immagine in un rettangolo della pagina (misurata alla larghezza su cui è tarata la soglia)
async function dettaglioSotto(pagina: Buffer, posto: Rettangolo): Promise<number> {
  const { data, info } = await sharp(pagina)
    .extract(posto)
    .resize({ width: LARGHEZZA_MISURA_DETTAGLIO })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return dettaglio(new Uint8Array(data), info.width, info.height);
}

export type EsitoLoghi = {
  png: Buffer;
  // dove è servita la sfumatura perché il logo si veda bene
  velature: { stazione: boolean; cliente: boolean };
  // i loghi che non si sono potuti applicare (non dovrebbe succedere): la copertina esce lo stesso, senza quel logo
  saltati: ("stazione" | "cliente")[];
};

// Applica i loghi sulla pagina A4 già disegnata: la stazione appaltante in alto a sinistra, il cliente in basso a destra
// Dove va ogni logo e quanto è grande (modifiche in chat). Senza indicazioni: la stazione appaltante in alto a sinistra, il cliente in basso a destra, medi.
export type Disposizione = Partial<Record<"stazione" | "cliente", { posizione: Posizione; dimensione: Dimensione }>>;

// Le zone dei due loghi per una disposizione. Quella di sempre resta identica; due loghi nello stesso punto si affiancano (metà zona ciascuno).
export function zoneDeiLoghi(disposizione: Disposizione, entrambi: boolean): Record<"stazione" | "cliente", Zona> {
  const s = disposizione.stazione ?? { posizione: POSIZIONE_PREDEFINITA.stazione, dimensione: "medio" as Dimensione };
  const c = disposizione.cliente ?? { posizione: POSIZIONE_PREDEFINITA.cliente, dimensione: "medio" as Dimensione };
  const zona = (chi: "stazione" | "cliente", d: { posizione: Posizione; dimensione: Dimensione }) =>
    d.posizione === POSIZIONE_PREDEFINITA[chi] && d.dimensione === "medio" ? (chi === "stazione" ? ZONA_STAZIONE : ZONA_CLIENTE) : zonaPer(d.posizione, d.dimensione);
  if (entrambi && s.posizione === c.posizione) {
    // la più grande delle due dimensioni, divisa a metà
    const grande: Dimensione = DIMENSIONI[Math.max(DIMENSIONI.indexOf(s.dimensione), DIMENSIONI.indexOf(c.dimensione))];
    const condivisa = zonaPer(s.posizione, grande);
    return { stazione: metaZona(condivisa, "sinistra"), cliente: metaZona(condivisa, "destra") };
  }
  return { stazione: zona("stazione", s), cliente: zona("cliente", c) };
}

export async function applicaLoghi(pagina: Buffer, loghi: { stazione?: LogoPronto; cliente?: LogoPronto }, disposizione: Disposizione = {}): Promise<EsitoLoghi> {
  const { width: W, height: H } = await sharp(pagina).metadata();
  if (!W || !H) throw new Error("Pagina della copertina non leggibile.");
  const strati: OverlayOptions[] = [];
  const velature = { stazione: false, cliente: false };
  const saltati: ("stazione" | "cliente")[] = [];

  const zone = zoneDeiLoghi(disposizione, Boolean(loghi.stazione && loghi.cliente));
  const voci: [("stazione" | "cliente"), LogoPronto | undefined, Zona][] = [
    ["stazione", loghi.stazione, zone.stazione],
    ["cliente", loghi.cliente, zone.cliente],
  ];
  for (const [chi, logo, zona] of voci) {
    if (!logo) continue;
    try {
      const posto = rettangoloLogo(zona, W, H, logo.larghezza, logo.altezza);
      const ridotto = await sharp(logo.png).resize(posto.width, posto.height, { fit: "fill" }).png().toBuffer();
      const [logoGrezzo, fondoGrezzo] = await Promise.all([
        sharp(ridotto).ensureAlpha().raw().toBuffer(),
        sharp(pagina).extract(posto).ensureAlpha().raw().toBuffer(),
      ]);
      const decisione = serveVelatura({ leggibilita: leggibilita(new Uint8Array(logoGrezzo), new Uint8Array(fondoGrezzo)), dettaglio: await dettaglioSotto(pagina, posto) });
      if (decisione.serve) {
        // l'ellisse centrata sul logo, un po' più grande; la parte che uscirebbe dalla pagina si ritaglia
        const rx = Math.round(posto.width * VELATURA_ORIZZONTALE), ry = Math.round(posto.height * VELATURA_VERTICALE);
        const vl = Math.round(posto.left + posto.width / 2) - rx, vt = Math.round(posto.top + posto.height / 2) - ry;
        const l0 = Math.max(0, vl), t0 = Math.max(0, vt), r0 = Math.min(W, vl + 2 * rx), b0 = Math.min(H, vt + 2 * ry);
        let input = await velatura(2 * rx, 2 * ry, decisione.chiara);
        if (l0 !== vl || t0 !== vt || r0 !== vl + 2 * rx || b0 !== vt + 2 * ry) {
          input = await sharp(input).extract({ left: l0 - vl, top: t0 - vt, width: r0 - l0, height: b0 - t0 }).png().toBuffer();
        }
        strati.push({ input, left: l0, top: t0 });
        velature[chi] = true;
      }
      strati.push({ input: ridotto, left: posto.left, top: posto.top });
    } catch (err) {
      console.error(`Copertina: logo ${chi} non applicato`, err instanceof Error ? err.message : err);
      saltati.push(chi);
    }
  }
  const png = strati.length ? await sharp(pagina).composite(strati).png().toBuffer() : pagina;
  return { png, velature, saltati };
}
