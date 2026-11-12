// I loghi sulla copertina della relazione tecnica, applicati dal CODICE e non disegnati dal modello (decisione dell'utente, 12/11/2026).
//
// Perché: il modello d'immagini i loghi li RIDISEGNA. Con il logo di SMAC (PNG trasparente di 4500 px) ha perso le scritte «SMAC» e «MULTISERVIZI»:
// riducendolo a 1024 px il colore nascosto sotto la trasparenza diventava nero e il modello, che la trasparenza non la considera, vedeva scritte nere su
// fondo nero. Ridisegnato, un logo può anche cambiare lettere o colori. Ora il modello lascia liberi i due angoli e i loghi originali si applicano dopo,
// pixel per pixel, SENZA riquadri né pannelli (l'utente non li vuole: «i loghi devono essere apposti come logo senza sfondo»).
//
// Qui le regole pure (numeri e pixel grezzi RGBA, nessuna libreria): dove vanno i loghi, come si toglie uno sfondo bianco senza toccare il logo, i colori
// principali da suggerire al modello per l'armonia della pagina, e quando un logo senza sfondo non si leggerebbe sul fondo che ha sotto.

// ───── Dove vanno i loghi ─────
// In frazioni della pagina A4. Fuori dalla fascia centrale dei testi (circa dal 30% al 70% dell'altezza) e con margini di almeno l'8% sui lati esterni.
export type Zona = { x: number; y: number; larghezza: number; altezza: number; allinea: "alto-sinistra" | "basso-destra" };
export const ZONA_STAZIONE: Zona = { x: 0.08, y: 0.06, larghezza: 0.36, altezza: 0.14, allinea: "alto-sinistra" };
export const ZONA_CLIENTE: Zona = { x: 0.56, y: 0.78, larghezza: 0.36, altezza: 0.14, allinea: "basso-destra" };
// un logo molto piccolo si ingrandisce per farsi vedere, ma non oltre questo (sgranerebbe)
export const INGRANDIMENTO_MASSIMO = 4;

export type Rettangolo = { left: number; top: number; width: number; height: number };

// Il logo entra tutto nella sua zona senza deformarsi; quello della stazione appaltante sta attaccato all'angolo in alto a sinistra della zona, quello
// del cliente all'angolo in basso a destra.
export function rettangoloLogo(zona: Zona, paginaL: number, paginaA: number, logoL: number, logoA: number): Rettangolo {
  const boxL = Math.round(zona.larghezza * paginaL);
  const boxA = Math.round(zona.altezza * paginaA);
  const scala = Math.min(boxL / logoL, boxA / logoA, INGRANDIMENTO_MASSIMO);
  const width = Math.max(1, Math.min(boxL, Math.round(logoL * scala)));
  const height = Math.max(1, Math.min(boxA, Math.round(logoA * scala)));
  const x0 = Math.round(zona.x * paginaL);
  const y0 = Math.round(zona.y * paginaA);
  return zona.allinea === "alto-sinistra" ? { left: x0, top: y0, width, height } : { left: x0 + boxL - width, top: y0 + boxA - height, width, height };
}

// ───── Colori ─────

// Luminanza percepita da 0 (nero) a 1 (bianco)
export function luminanza(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const distanza = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);

const esadecimale = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

// I colori principali del logo, da suggerire al modello perché la pagina si armonizzi: solo colori veri (niente bianco, nero e grigi), i più presenti
// prima. Un logo tutto nero o grigio non ne ha: nessun suggerimento.
export function coloriPrincipali(rgba: Uint8Array, quanti = 3): string[] {
  const bins = new Map<number, { peso: number; r: number; g: number; b: number }>();
  let totale = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 45) continue; // bianchi, neri e grigi
    const chiave = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bin = bins.get(chiave) ?? { peso: 0, r: 0, g: 0, b: 0 };
    bin.peso += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(chiave, bin);
    totale++;
  }
  if (totale === 0) return [];
  return [...bins.values()]
    .filter((b) => b.peso / totale >= 0.04)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, quanti)
    .map((b) => esadecimale(b.r / b.peso, b.g / b.peso, b.b / b.peso));
}

// ───── Lo sfondo del logo ─────
//
// - logo già trasparente (PNG con sfondo trasparente): si usa così com'è, pixel per pixel;
// - logo con sfondo BIANCO o quasi (JPG, PNG pieni): si toglie SOLO il bianco collegato ai bordi dell'immagine. Il bianco DENTRO il logo (lettere bianche
//   in un cerchio colorato, le linee di un mappamondo, il bianco dentro una «o») non è collegato ai bordi e resta. Ai contorni la trasparenza è graduale e
//   il colore si ripulisce dal bianco, così non resta un alone chiaro;
// - sfondo non bianco, o bordi non uniformi (una foto, un logo su un quadrato colorato che fa parte del marchio): NON si tocca nulla, si usa così com'è.
//   Meglio un logo con il suo sfondo che un logo con dei pezzi in meno;
// - se togliere lo sfondo cancellerebbe quasi tutto (un'immagine tutta chiara): non si tocca nulla.

export type Sfondo = "trasparente" | "tolto" | "pieno";
export type EsitoSfondo = { rgba: Uint8Array; sfondo: Sfondo; motivo: string | null };

// quota di pixel non del tutto opachi oltre la quale un logo si considera già trasparente
const QUOTA_TRASPARENZA = 0.01;
// fin dove un pixel del bordo «è lo sfondo»: distanza dal colore dello sfondo (scala 0–441)
const SOGLIA_SFONDO = 60;
// spessore del contorno ripulito, in pixel, e quanto lontano si cerca il colore pieno del logo per capire quanto un pixel di contorno è «mescolato»
const RAGGIO_CONTORNO = 2;
const RAGGIO_INCHIOSTRO = 3;
// lo sfondo da togliere deve essere chiaro e senza colore
const LUMINANZA_SFONDO_MINIMA = 0.82;
const SATURAZIONE_SFONDO_MASSIMA = 30;
// e uniforme lungo i bordi
const QUOTA_BORDO_UNIFORME = 0.85;
// dopo la rimozione deve restare almeno questa parte dell'immagine, altrimenti non si toglie nulla
const QUOTA_LOGO_MINIMA = 0.015;

export function preparaSfondo(rgba: Uint8Array, larghezza: number, altezza: number): EsitoSfondo {
  const n = larghezza * altezza;
  let nonOpachi = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 250) nonOpachi++;
  if (nonOpachi / n > QUOTA_TRASPARENZA) return { rgba: new Uint8Array(rgba), sfondo: "trasparente", motivo: null };

  // il colore dello sfondo: la mediana dei pixel del bordo
  const bordo: number[] = [];
  for (let x = 0; x < larghezza; x++) bordo.push(x, (altezza - 1) * larghezza + x);
  for (let y = 1; y < altezza - 1; y++) bordo.push(y * larghezza, y * larghezza + larghezza - 1);
  const mediana = (canale: number) => {
    const valori = bordo.map((p) => rgba[p * 4 + canale]).sort((a, b) => a - b);
    return valori[Math.floor(valori.length / 2)];
  };
  const sr = mediana(0), sg = mediana(1), sb = mediana(2);
  if (luminanza(sr, sg, sb) < LUMINANZA_SFONDO_MINIMA || Math.max(sr, sg, sb) - Math.min(sr, sg, sb) > SATURAZIONE_SFONDO_MASSIMA) {
    return { rgba: new Uint8Array(rgba), sfondo: "pieno", motivo: "lo sfondo del logo non è bianco" };
  }
  const uniformi = bordo.filter((p) => distanza(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2], sr, sg, sb) <= SOGLIA_SFONDO).length;
  if (uniformi / bordo.length < QUOTA_BORDO_UNIFORME) return { rgba: new Uint8Array(rgba), sfondo: "pieno", motivo: "lo sfondo del logo non è uniforme" };

  // riempimento dai bordi: solo i pixel vicini al colore dello sfondo E collegati al bordo
  const sfondo = new Uint8Array(n);
  const coda = new Int32Array(n);
  let testa = 0, fine = 0;
  const vicino = (p: number) => distanza(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2], sr, sg, sb) <= SOGLIA_SFONDO;
  for (const p of bordo) {
    if (!sfondo[p] && vicino(p)) {
      sfondo[p] = 1;
      coda[fine++] = p;
    }
  }
  while (testa < fine) {
    const p = coda[testa++];
    const x = p % larghezza, y = (p - x) / larghezza;
    const vicini = [x > 0 ? p - 1 : -1, x < larghezza - 1 ? p + 1 : -1, y > 0 ? p - larghezza : -1, y < altezza - 1 ? p + larghezza : -1];
    for (const q of vicini) {
      if (q >= 0 && !sfondo[q] && vicino(q)) {
        sfondo[q] = 1;
        coda[fine++] = q;
      }
    }
  }

  const uscita = new Uint8Array(rgba);
  let restanti = 0;
  for (let p = 0; p < n; p++) {
    if (sfondo[p]) {
      uscita[p * 4 + 3] = 0;
      continue;
    }
    // contorno: un pixel non di sfondo a meno di RAGGIO_CONTORNO pixel dallo sfondo tolto è (in parte) mescolato con il bianco: trasparenza graduale e
    // colore ripulito dal bianco, così sul fondo della copertina non resta un alone chiaro
    const x = p % larghezza, y = (p - x) / larghezza;
    let alContorno = false;
    for (let dy = -RAGGIO_CONTORNO; dy <= RAGGIO_CONTORNO && !alContorno; dy++) {
      for (let dx = -RAGGIO_CONTORNO; dx <= RAGGIO_CONTORNO; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < larghezza && yy < altezza && sfondo[yy * larghezza + xx]) {
          alContorno = true;
          break;
        }
      }
    }
    if (alContorno) {
      const r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2];
      const d = distanza(r, g, b, sr, sg, sb);
      // Un pixel di contorno è (quasi sempre) un miscuglio tra lo sfondo e il colore pieno del logo lì accanto: la sua distanza dallo sfondo, divisa per
      // quella del colore pieno, dice quanto «pesa» il logo. Il colore pieno è il più lontano dallo sfondo tra i vicini non di sfondo.
      let pieno = d;
      for (let dy = -RAGGIO_INCHIOSTRO; dy <= RAGGIO_INCHIOSTRO; dy++) {
        for (let dx = -RAGGIO_INCHIOSTRO; dx <= RAGGIO_INCHIOSTRO; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= larghezza || yy >= altezza) continue;
          const q = yy * larghezza + xx;
          if (sfondo[q]) continue;
          const dq = distanza(rgba[q * 4], rgba[q * 4 + 1], rgba[q * 4 + 2], sr, sg, sb);
          if (dq > pieno) pieno = dq;
        }
      }
      const alfa = d <= SOGLIA_SFONDO ? 0 : Math.min(1, d / pieno);
      if (alfa < 1) {
        uscita[p * 4 + 3] = Math.round(alfa * 255);
        if (alfa > 0) {
          uscita[p * 4] = Math.min(255, Math.max(0, Math.round((r - (1 - alfa) * sr) / alfa)));
          uscita[p * 4 + 1] = Math.min(255, Math.max(0, Math.round((g - (1 - alfa) * sg) / alfa)));
          uscita[p * 4 + 2] = Math.min(255, Math.max(0, Math.round((b - (1 - alfa) * sb) / alfa)));
        }
      }
    }
    if (uscita[p * 4 + 3] > 10) restanti++;
  }
  if (restanti / n < QUOTA_LOGO_MINIMA) return { rgba: new Uint8Array(rgba), sfondo: "pieno", motivo: "togliendo lo sfondo non resterebbe quasi nulla del logo" };
  return { rgba: uscita, sfondo: "tolto", motivo: null };
}

// Il rettangolo che contiene davvero il logo (pixel visibili), per togliere i margini vuoti; null se non c'è nulla di visibile
export function contenutoVisibile(rgba: Uint8Array, larghezza: number, altezza: number): Rettangolo | null {
  let minX = larghezza, minY = altezza, maxX = -1, maxY = -1;
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      if (rgba[(y * larghezza + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ───── Il logo si vede bene dove viene messo? ─────
// Regola dell'utente (12/11/2026): «importante che dove viene apposto il logo l'immagine venga in modo che si veda bene il logo». Il modello ha
// l'indicazione di lasciare chiari e semplici gli angoli dei loghi, ma non sempre la rispetta (nella prima prova aveva disegnato una villa proprio sotto il
// logo di SMAC). Quindi il codice guarda il pezzo d'immagine che finirà sotto il logo e, se serve, lo SCHIARISCE con una sfumatura morbida a forma di
// ellisse, senza bordi (non un riquadro: l'utente non vuole riquadri), chiara per un logo scuro e scura per un logo chiaro. Serve quando:
//   - l'immagine sotto è MOVIMENTATA (disegni, dettagli, contorni): misurata come differenza media di chiarezza tra pixel vicini su una copia larga 96
//     px. Tarata su pagine vere: angoli calmi 0,0014–0,0021, marmo della foto 0,011, la villa sotto il logo 0,065;
//   - oppure il logo NON SI STACCA dal fondo: il suo «inchiostro» (le parti non bianche, o tutto il logo se è chiaro) ha la stessa chiarezza E lo stesso
//     colore del fondo (un verde su un beige si legge anche con la stessa chiarezza: misurare solo il chiaro/scuro faceva scattare l'aiuto sul logo
//     colorato di SMAC appoggiato sul marmo).

// differenza (la maggiore tra chiarezza e colore, scala 0–1) sotto la quale un pixel del logo non si stacca dal fondo
const DIFFERENZA_LEGGIBILE = 0.22;
// quota di inchiostro che non si stacca oltre la quale il logo non si legge
const QUOTA_ILLEGGIBILE = 0.35;
// oltre questo «movimento» l'immagine sotto il logo è troppo carica e si schiarisce
export const DETTAGLIO_MASSIMO = 0.03;
// la larghezza su cui si misura il movimento (la soglia è tarata su questa misura)
export const LARGHEZZA_MISURA_DETTAGLIO = 96;

// quanto un pixel del logo si stacca dal fondo: la maggiore tra la differenza di chiarezza e quella di colore
export function stacco(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.max(Math.abs(luminanza(r1, g1, b1) - luminanza(r2, g2, b2)), distanza(r1, g1, b1, r2, g2, b2) / 441.7);
}

// quanto è movimentato un pezzo d'immagine RGBA: 0 = tinta unita; le sfumature dolci restano vicine a 0, i disegni e i contorni no
export function dettaglio(rgba: Uint8Array, larghezza: number, altezza: number): number {
  let somma = 0, conti = 0;
  const l = (x: number, y: number) => {
    const i = (y * larghezza + x) * 4;
    return luminanza(rgba[i], rgba[i + 1], rgba[i + 2]);
  };
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      const qui = l(x, y);
      if (x + 1 < larghezza) {
        somma += Math.abs(qui - l(x + 1, y));
        conti++;
      }
      if (y + 1 < altezza) {
        somma += Math.abs(qui - l(x, y + 1));
        conti++;
      }
    }
  }
  return conti ? somma / conti : 0;
}

export type Leggibilita = { illeggibile: boolean; logoScuro: boolean; quotaIllegibile: number };

// `logo` e `fondo` sono della stessa misura: il logo già ridimensionato e il pezzo di pagina che finirà sotto
export function leggibilita(logo: Uint8Array, fondo: Uint8Array): Leggibilita {
  const scuri: number[] = [];
  const tutti: number[] = [];
  for (let i = 0; i < logo.length; i += 4) {
    if (logo[i + 3] < 128) continue;
    const l = luminanza(logo[i], logo[i + 1], logo[i + 2]);
    tutti.push(i);
    if (l < 0.85) scuri.push(i);
  }
  if (tutti.length === 0) return { illeggibile: false, logoScuro: true, quotaIllegibile: 0 };
  // l'inchiostro: le parti non bianche, se sono una parte vera del logo; altrimenti (logo chiaro) tutto
  const inchiostro = scuri.length / tutti.length >= 0.2 ? scuri : tutti;
  let illeggibili = 0;
  let somma = 0;
  for (const i of inchiostro) {
    somma += luminanza(logo[i], logo[i + 1], logo[i + 2]);
    if (stacco(logo[i], logo[i + 1], logo[i + 2], fondo[i], fondo[i + 1], fondo[i + 2]) < DIFFERENZA_LEGGIBILE) illeggibili++;
  }
  const quota = illeggibili / inchiostro.length;
  return { illeggibile: quota > QUOTA_ILLEGGIBILE, logoScuro: somma / inchiostro.length < 0.5, quotaIllegibile: quota };
}

// La decisione: schiarire (o scurire) l'immagine sotto il logo? Sì se è troppo movimentata o se il logo non si stacca. La sfumatura è chiara per un logo
// scuro e scura per un logo chiaro.
export function serveVelatura(params: { leggibilita: Leggibilita; dettaglio: number }): { serve: boolean; chiara: boolean } {
  return { serve: params.leggibilita.illeggibile || params.dettaglio > DETTAGLIO_MASSIMO, chiara: params.leggibilita.logoScuro };
}
