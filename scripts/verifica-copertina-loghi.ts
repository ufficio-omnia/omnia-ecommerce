// Autotest dei loghi sulla copertina della relazione tecnica, applicati dal CODICE e non più disegnati dal modello (decisione dell'utente, 12/11/2026,
// dopo le copertine di SMAC senza le scritte «SMAC» e «MULTISERVIZI»: il loro PNG trasparente di 4500 px, ridotto a 1024 per il modello, aveva il
// colore nascosto sotto la trasparenza diventato nero, e il modello vedeva scritte nere su fondo nero). Controlla, senza rete:
//   - dove vanno i loghi: zone negli angoli, fuori dalla fascia dei testi, con i margini; il logo entra senza deformarsi e non sgrana oltre 4 volte;
//   - lo sfondo: un logo trasparente resta identico; da uno sfondo BIANCO si toglie solo il bianco collegato ai bordi (il bianco dentro il logo resta), con
//     i contorni puliti; uno sfondo colorato o non uniforme NON si tocca (meglio il logo con il suo sfondo che con dei pezzi in meno); un'immagine tutta
//     chiara non si svuota;
//   - il caso SMAC: un logo trasparente grande con scritte nere, preparato e applicato, ha ancora le scritte nere;
//   - i colori principali (per l'armonia della pagina): solo colori veri, niente bianco/nero/grigi;
//   - la leggibilità senza sfondo: si guarda la chiarezza E il colore; quando non si legge, un alone sottile che segue i tratti (mai un riquadro);
//   - l'applicazione sulla pagina: ogni logo nel suo angolo, il resto della pagina intatto, un logo rotto si salta senza far fallire la copertina.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  DETTAGLIO_MASSIMO,
  INGRANDIMENTO_MASSIMO,
  ZONA_CLIENTE,
  ZONA_STAZIONE,
  coloriPrincipali,
  contenutoVisibile,
  dettaglio,
  leggibilita,
  luminanza,
  preparaSfondo,
  rettangoloLogo,
  serveVelatura,
  stacco,
} from "../src/lib/copertina-loghi-calcoli";
import { applicaLoghi, preparaLogo, type LogoPronto } from "../src/lib/copertina-loghi";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const W = 1584, H = 2240;

// un'immagine RGBA grezza riempita di un colore, con un disegno sopra
function tela(larghezza: number, altezza: number, colore: [number, number, number, number]): Uint8Array {
  const t = new Uint8Array(larghezza * altezza * 4);
  for (let i = 0; i < larghezza * altezza; i++) t.set(colore, i * 4);
  return t;
}
function rettangolo(t: Uint8Array, larghezza: number, x0: number, y0: number, w: number, h: number, colore: [number, number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) t.set(colore, (y * larghezza + x) * 4);
}
const px = (t: Uint8Array, larghezza: number, x: number, y: number) => Array.from(t.slice((y * larghezza + x) * 4, (y * larghezza + x) * 4 + 4));
const daGrezzo = (t: Uint8Array, larghezza: number, altezza: number) => sharp(Buffer.from(t), { raw: { width: larghezza, height: altezza, channels: 4 } });
async function pixel(immagine: Buffer, x: number, y: number): Promise<number[]> {
  const { data } = await sharp(immagine).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

async function main() {
  console.log("--- Dove vanno i loghi ---");
  {
    const zone = [ZONA_STAZIONE, ZONA_CLIENTE];
    atteso("le zone stanno dentro la pagina, con almeno l'8% di margine ai lati e il 6% in alto/in basso", zone.every((z) => z.x >= 0.08 && z.x + z.larghezza <= 0.92 + 1e-9 && z.y >= 0.06 && z.y + z.altezza <= 0.92 + 1e-9));
    atteso("le zone stanno fuori dalla fascia centrale dei testi (dal 30% al 70% dell'altezza)", ZONA_STAZIONE.y + ZONA_STAZIONE.altezza <= 0.3 && ZONA_CLIENTE.y >= 0.7);
    atteso("la stazione appaltante in alto a sinistra, il cliente in basso a destra", ZONA_STAZIONE.allinea === "alto-sinistra" && ZONA_STAZIONE.x < 0.5 && ZONA_STAZIONE.y < 0.5 && ZONA_CLIENTE.allinea === "basso-destra" && ZONA_CLIENTE.x >= 0.5 && ZONA_CLIENTE.y > 0.5);
    const boxL = Math.round(ZONA_STAZIONE.larghezza * W), boxA = Math.round(ZONA_STAZIONE.altezza * H);
    const casi: [string, number, number][] = [["quadrato", 1000, 1000], ["largo", 2000, 300], ["alto", 300, 1500], ["SMAC", 1168, 1267], ["San Michele", 258, 228]];
    atteso(
      "ogni logo entra tutto nella zona, senza deformarsi (proporzioni rispettate a meno di un pixel)",
      casi.every(([, l, a]) => {
        const r = rettangoloLogo(ZONA_STAZIONE, W, H, l, a);
        return r.width <= boxL && r.height <= boxA && Math.abs(r.width / r.height - l / a) <= l / a / Math.min(r.width, r.height) + 0.02 && (r.width === boxL || r.height === boxA || r.width === Math.round(l * INGRANDIMENTO_MASSIMO));
      }),
    );
    const s = rettangoloLogo(ZONA_STAZIONE, W, H, 1000, 1000);
    const c = rettangoloLogo(ZONA_CLIENTE, W, H, 1000, 1000);
    atteso("la stazione sta attaccata all'angolo in alto a sinistra della sua zona, il cliente a quello in basso a destra", s.left === Math.round(0.08 * W) && s.top === Math.round(0.06 * H) && c.left + c.width === Math.round(0.56 * W) + Math.round(0.36 * W) && c.top + c.height === Math.round(0.78 * H) + Math.round(0.14 * H));
    const piccolo = rettangoloLogo(ZONA_STAZIONE, W, H, 20, 10);
    atteso(`un logo minuscolo si ingrandisce, ma non oltre ${INGRANDIMENTO_MASSIMO} volte (sgranerebbe)`, piccolo.width === 80 && piccolo.height === 40);
  }

  console.log("--- Lo sfondo del logo ---");
  {
    // logo già trasparente: identico
    const tr = tela(50, 40, [255, 255, 255, 0]);
    rettangolo(tr, 50, 10, 10, 30, 20, [0, 0, 0, 255]);
    const etr = preparaSfondo(tr, 50, 40);
    atteso("logo già trasparente: si usa così com'è, pixel per pixel", etr.sfondo === "trasparente" && Buffer.compare(Buffer.from(etr.rgba), Buffer.from(tr)) === 0);

    // logo su bianco: un anello nero con il bianco DENTRO, un rettangolo rosso
    const L = 80, A = 60;
    const bi = tela(L, A, [255, 255, 255, 255]);
    rettangolo(bi, L, 10, 10, 30, 30, [0, 0, 0, 255]);
    rettangolo(bi, L, 18, 18, 14, 14, [255, 255, 255, 255]); // il «buco» bianco dentro l'anello: non è collegato ai bordi
    rettangolo(bi, L, 50, 20, 20, 15, [200, 30, 30, 255]);
    // rumore da JPG nello sfondo
    bi.set([250, 252, 249, 255], (5 * L + 5) * 4);
    bi.set([246, 244, 250, 255], (55 * L + 70) * 4);
    const ebi = preparaSfondo(bi, L, A);
    atteso("sfondo bianco: tolto", ebi.sfondo === "tolto");
    atteso("lo sfondo bianco collegato ai bordi diventa trasparente (anche il bianco «sporco» dei JPG)", px(ebi.rgba, L, 0, 0)[3] === 0 && px(ebi.rgba, L, 79, 59)[3] === 0 && px(ebi.rgba, L, 5, 5)[3] === 0 && px(ebi.rgba, L, 70, 55)[3] === 0);
    atteso("il logo resta pieno e con i suoi colori (nero e rosso)", px(ebi.rgba, L, 12, 25).join() === "0,0,0,255" && px(ebi.rgba, L, 60, 27).join() === "200,30,30,255");
    atteso("il bianco DENTRO il logo resta bianco e pieno (non è sfondo: non tocca i bordi)", px(ebi.rgba, L, 25, 25).join() === "255,255,255,255");

    // contorno sfumato: un pixel grigio (nero mescolato col bianco) accanto allo sfondo diventa semitrasparente e torna scuro
    const aa = tela(L, A, [255, 255, 255, 255]);
    rettangolo(aa, L, 20, 20, 30, 20, [0, 0, 0, 255]);
    rettangolo(aa, L, 19, 20, 1, 20, [150, 150, 150, 255]);
    const eaa = preparaSfondo(aa, L, A);
    const bordoAa = px(eaa.rgba, L, 19, 30);
    atteso("contorni puliti: il pixel di passaggio diventa semitrasparente e il suo colore si ripulisce dal bianco (niente alone chiaro)", bordoAa[3] > 0 && bordoAa[3] < 255 && bordoAa[0] < 60, bordoAa.join());

    // sfondo colorato: non si tocca
    const blu = tela(L, A, [20, 60, 160, 255]);
    rettangolo(blu, L, 20, 20, 30, 20, [255, 255, 255, 255]);
    const eblu = preparaSfondo(blu, L, A);
    atteso("sfondo colorato (un quadrato blu che fa parte del marchio): NON si toglie nulla", eblu.sfondo === "pieno" && Buffer.compare(Buffer.from(eblu.rgba), Buffer.from(blu)) === 0 && /non è bianco/.test(eblu.motivo ?? ""));

    // bordi non uniformi (metà bianco, metà foto scura): non si tocca
    const misto = tela(L, A, [255, 255, 255, 255]);
    rettangolo(misto, L, 0, 0, L, 28, [60, 40, 30, 255]);
    const emisto = preparaSfondo(misto, L, A);
    atteso("bordi non uniformi (una foto, metà chiara metà scura): NON si toglie nulla", emisto.sfondo === "pieno" && Buffer.compare(Buffer.from(emisto.rgba), Buffer.from(misto)) === 0);

    // tutto bianco con un puntino: non si svuota
    const vuoto = tela(L, A, [255, 255, 255, 255]);
    rettangolo(vuoto, L, 40, 30, 2, 2, [0, 0, 0, 255]);
    const evuoto = preparaSfondo(vuoto, L, A);
    atteso("se togliendo lo sfondo non resterebbe quasi nulla: non si toglie nulla", evuoto.sfondo === "pieno" && /non resterebbe quasi nulla/.test(evuoto.motivo ?? ""));

    // il bianco attaccato al bordo ma DENTRO un disegno colorato più grande non viene raggiunto se il disegno lo chiude
    atteso("il rettangolo visibile toglie i margini vuoti", JSON.stringify(contenutoVisibile(ebi.rgba, L, A)) === JSON.stringify({ left: 10, top: 10, width: 60, height: 30 }) && contenutoVisibile(tela(10, 10, [0, 0, 0, 0]), 10, 10) === null);
  }

  console.log("--- Colori e leggibilità ---");
  {
    const t = tela(100, 100, [255, 255, 255, 0]);
    rettangolo(t, 100, 0, 0, 100, 40, [212, 16, 123, 255]); // magenta (il più presente)
    rettangolo(t, 100, 0, 40, 100, 25, [52, 145, 111, 255]); // verde
    rettangolo(t, 100, 0, 65, 100, 20, [0, 0, 0, 255]); // nero
    rettangolo(t, 100, 0, 85, 100, 15, [255, 255, 255, 255]); // bianco
    const colori = coloriPrincipali(t);
    atteso("colori principali: solo colori veri, i più presenti prima, niente nero né bianco", colori.length === 2 && colori[0] === "#d4107b" && colori[1] === "#34916f", colori.join(" "));
    atteso("un logo solo nero e grigio non suggerisce colori", coloriPrincipali(tela(10, 10, [30, 30, 30, 255])).length === 0);
    atteso("luminanza: nero 0, bianco 1", luminanza(0, 0, 0) === 0 && Math.abs(luminanza(255, 255, 255) - 1) < 1e-9);

    const logoNero = tela(20, 20, [0, 0, 0, 255]);
    const logoBianco = tela(20, 20, [255, 255, 255, 255]);
    const chiaro = tela(20, 20, [240, 240, 235, 255]);
    const scuro = tela(20, 20, [30, 35, 50, 255]);
    atteso("logo scuro su fondo chiaro: si legge", !leggibilita(logoNero, chiaro).illeggibile);
    const nero = leggibilita(logoNero, scuro);
    atteso("logo scuro su fondo scuro: non si legge, ed è un logo scuro (la sfumatura sarà CHIARA)", nero.illeggibile && nero.logoScuro);
    const bianco = leggibilita(logoBianco, chiaro);
    atteso("logo bianco su fondo chiaro: non si legge, ed è un logo chiaro (la sfumatura sarà SCURA)", bianco.illeggibile && !bianco.logoScuro);
    // il caso visto nella prova vera (un logo colorato su un marmo beige): un colore si legge anche su un fondo di chiarezza simile, se la tinta è
    // diversa. Qui la chiarezza è identica (verde e rosa antico), quindi conta SOLO il colore.
    const verde = tela(20, 20, [52, 145, 111, 255]);
    const rosa = tela(20, 20, [200, 100, 130, 255]);
    atteso("stessa chiarezza, colore diverso (verde su rosa antico): la chiarezza da sola non lo vede", Math.abs(luminanza(52, 145, 111) - luminanza(200, 100, 130)) < 0.01);
    atteso("logo colorato su un fondo della stessa chiarezza ma di altro colore: si legge per il colore", !leggibilita(verde, rosa).illeggibile && stacco(52, 145, 111, 200, 100, 130) > 0.22);
    atteso("un logo vuoto non chiede aiuti", !leggibilita(tela(5, 5, [0, 0, 0, 0]), chiaro).illeggibile);

    // quanto è movimentata l'immagine sotto il logo
    const unita = tela(96, 60, [235, 238, 240, 255]);
    const sfumata = tela(96, 60, [0, 0, 0, 255]);
    for (let x = 0; x < 96; x++) for (let y = 0; y < 60; y++) sfumata.set([150 + x, 160 + x, 170 + x, 255], (y * 96 + x) * 4);
    const disegnata = tela(96, 60, [235, 238, 240, 255]);
    for (let x = 0; x < 96; x += 6) rettangolo(disegnata, 96, x, 0, 3, 60, [90, 110, 120, 255]); // righe: finestre, ringhiere, contorni di un disegno
    atteso("movimento: una tinta unita è 0, una sfumata dolce resta sotto la soglia, un disegno pieno di contorni la supera", dettaglio(unita, 96, 60) === 0 && dettaglio(sfumata, 96, 60) < DETTAGLIO_MASSIMO && dettaglio(disegnata, 96, 60) > DETTAGLIO_MASSIMO, `${dettaglio(sfumata, 96, 60)} ${dettaglio(disegnata, 96, 60)}`);
    const leggibile = leggibilita(logoNero, chiaro);
    atteso(
      "la sfumatura serve se l'immagine sotto è troppo movimentata, OPPURE se il logo non si stacca; altrimenti no",
      serveVelatura({ leggibilita: leggibile, dettaglio: 0.065 }).serve && serveVelatura({ leggibilita: nero, dettaglio: 0.001 }).serve && !serveVelatura({ leggibilita: leggibile, dettaglio: 0.011 }).serve,
    );
    atteso("la sfumatura è chiara per un logo scuro e scura per un logo chiaro", serveVelatura({ leggibilita: nero, dettaglio: 0 }).chiara && !serveVelatura({ leggibilita: bianco, dettaglio: 0 }).chiara);
    atteso("la soglia del movimento sta tra gli angoli calmi delle pagine vere (fino a 0,011) e la villa sotto il logo (0,065)", DETTAGLIO_MASSIMO > 0.011 && DETTAGLIO_MASSIMO < 0.065);
  }

  console.log("--- Preparazione e applicazione (immagini vere) ---");
  {
    // IL CASO SMAC: PNG trasparente grande (3000 px), scritte NERE, colore nascosto sotto la trasparenza bianco
    const grande = tela(3000, 3000, [255, 255, 255, 0]);
    rettangolo(grande, 3000, 600, 1300, 1800, 400, [0, 0, 0, 255]); // «la scritta» nera
    rettangolo(grande, 3000, 300, 300, 2400, 120, [212, 16, 123, 255]); // «un'orbita» magenta
    const pngGrande = await daGrezzo(grande, 3000, 3000).png().toBuffer();
    const smac = await preparaLogo(pngGrande);
    atteso("caso SMAC: il logo trasparente resta trasparente (nessuna rimozione) e si legge", smac !== undefined && smac.sfondo === "trasparente");
    const pagina = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 245, g: 243, b: 238 } } }).png().toBuffer();
    const conSmac = await applicaLoghi(pagina, { cliente: smac });
    const posto = rettangoloLogo(ZONA_CLIENTE, W, H, smac!.larghezza, smac!.altezza);
    // le posizioni in proporzione al contenuto del logo (nel file originale va da x 300 a 2700 e da y 300 a 1700): il centro della «scritta» nera
    // (1500, 1500) e un punto trasparente tra l'«orbita» e la scritta (1500, 860)
    const sullaPagina = (x: number, y: number) => [Math.round(posto.left + ((x - 300) / 2400) * posto.width), Math.round(posto.top + ((y - 300) / 1400) * posto.height)] as const;
    const scritta = await pixel(conSmac.png, ...sullaPagina(1500, 1500));
    atteso("caso SMAC: nella copertina la scritta nera c'è ed è nera (prima spariva)", scritta[0] < 30 && scritta[1] < 30 && scritta[2] < 30, scritta.join());
    const traScritte = await pixel(conSmac.png, ...sullaPagina(1500, 860));
    atteso("caso SMAC: dove il logo è trasparente si vede la pagina (nessun riquadro, nessuno sfondo aggiunto)", traScritte.slice(0, 3).join() === "245,243,238", traScritte.join());
    atteso("caso SMAC: su un fondo chiaro e calmo l'immagine non si tocca (nessuna sfumatura)", !conSmac.velature.cliente && conSmac.saltati.length === 0);

    // JPG con sfondo bianco
    const jpgGrezzo = tela(400, 200, [255, 255, 255, 255]);
    rettangolo(jpgGrezzo, 400, 50, 50, 300, 100, [20, 60, 160, 255]);
    const jpg = await daGrezzo(jpgGrezzo, 400, 200).jpeg({ quality: 85 }).toBuffer();
    const pjpg = await preparaLogo(jpg);
    atteso("JPG con sfondo bianco: sfondo tolto, margini vuoti tagliati", pjpg !== undefined && pjpg.sfondo === "tolto" && Math.abs(pjpg.larghezza - 300) <= 4 && Math.abs(pjpg.altezza - 100) <= 4, `${pjpg?.sfondo} ${pjpg?.larghezza}x${pjpg?.altezza}`);
    const angoloJpg = await pixel(pjpg!.png, 0, 0);
    atteso("JPG: l'angolo del logo preparato è il disegno, non il bianco (il bianco è stato tolto)", angoloJpg[3] > 0 && angoloJpg[2] > 100, angoloJpg.join());
    atteso("un file che non è un'immagine, o un'immagine tutta trasparente: nessun logo (la copertina esce senza)", (await preparaLogo(Buffer.from("ciao"))) === undefined && (await preparaLogo(await daGrezzo(tela(30, 30, [0, 0, 0, 0]), 30, 30).png().toBuffer())) === undefined);

    // applicazione: due loghi, pagina intatta altrove
    const stazione = await preparaLogo(await daGrezzo((() => { const t = tela(60, 40, [0, 0, 0, 0]); rettangolo(t, 60, 10, 5, 40, 30, [204, 0, 0, 255]); return t; })(), 60, 40).png().toBuffer());
    const entrambi = await applicaLoghi(pagina, { stazione, cliente: smac });
    const ps = rettangoloLogo(ZONA_STAZIONE, W, H, stazione!.larghezza, stazione!.altezza);
    const [centroStazione, lontano] = await Promise.all([pixel(entrambi.png, ps.left + Math.round(ps.width / 2), ps.top + Math.round(ps.height / 2)), pixel(entrambi.png, Math.round(W / 2), Math.round(H / 2))]);
    atteso("il logo della stazione è nel suo angolo e la pagina, fuori dagli angoli, è intatta", centroStazione.slice(0, 3).join() === "204,0,0" && lontano.slice(0, 3).join() === "245,243,238");
    const fuoriDaiLoghi = await pixel(entrambi.png, ps.left + ps.width + 30, ps.top + Math.round(ps.height / 2));
    atteso("subito fuori dal logo la pagina è intatta (niente riquadro né cornice intorno al logo)", fuoriDaiLoghi.slice(0, 3).join() === "245,243,238");

    // logo scuro su pagina scura: l'immagine sotto il logo si schiarisce con una sfumatura a ellisse, senza bordi
    const scura = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 30, g: 35, b: 50 } } }).png().toBuffer();
    const nero = await preparaLogo(await daGrezzo((() => { const t = tela(200, 100, [0, 0, 0, 0]); rettangolo(t, 200, 20, 20, 160, 60, [0, 0, 0, 255]); return t; })(), 200, 100).png().toBuffer());
    const conVelatura = await applicaLoghi(scura, { cliente: nero });
    const pc = rettangoloLogo(ZONA_CLIENTE, W, H, nero!.larghezza, nero!.altezza);
    const cy = pc.top + Math.round(pc.height / 2);
    // la sfumatura è un'ellisse con semiassi 0,78 e 0,85 volte il logo: il suo rettangolo va da (centro − 0,78·w) a (centro + 0,78·w)
    const rx = Math.round(pc.width * 0.78), ry = Math.round(pc.height * 0.85);
    const cx = pc.left + Math.round(pc.width / 2);
    const [aridosso, aMeta, angoloEllisse, lontanoDalLogo] = await Promise.all([
      pixel(conVelatura.png, pc.left - 3, cy),
      pixel(conVelatura.png, cx - Math.round(rx * 0.93), cy),
      pixel(conVelatura.png, cx - rx + 2, cy - ry + 2),
      pixel(conVelatura.png, cx - rx - 40, cy),
    ]);
    atteso("logo scuro su pagina scura: l'immagine sotto il logo si schiarisce (sfumatura CHIARA)", conVelatura.velature.cliente && aridosso[0] > 150, aridosso.join());
    atteso("la sfumatura svanisce dolcemente verso l'esterno (più chiara a ridosso del logo che verso il bordo)", aMeta[0] < aridosso[0] && aMeta[0] > 30, `${aridosso[0]} → ${aMeta[0]}`);
    atteso("non è un riquadro: agli angoli del suo rettangolo e fuori la pagina è intatta", angoloEllisse.slice(0, 3).join() === "30,35,50" && lontanoDalLogo.slice(0, 3).join() === "30,35,50", `${angoloEllisse.join()} ${lontanoDalLogo.join()}`);
    const centroNero = await pixel(conVelatura.png, cx, cy);
    atteso("il logo resta sopra la sfumatura, con il suo colore", centroNero.slice(0, 3).join() === "0,0,0", centroNero.join());

    // un logo che si leggerebbe, ma sopra un disegno pieno di dettagli (la villa della prima prova): si schiarisce lo stesso
    const disegnoSotto = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 235, g: 238, b: 240 } } })
      // righe verticali larghe 6 px ogni 12 px (finestre, ringhiere, contorni) sotto tutta la zona del cliente
      .composite(Array.from({ length: 70 }, (_, i) => ({ input: { create: { width: 6, height: 420, channels: 3 as const, background: { r: 90, g: 110, b: 120 } } }, left: 800 + i * 12, top: 1720 })).filter((s) => s.left + 6 <= W))
      .png()
      .toBuffer();
    const sulDisegno = await applicaLoghi(disegnoSotto, { cliente: nero, stazione });
    atteso("logo leggibile sopra un disegno movimentato: l'immagine sotto si schiarisce lo stesso; l'angolo calmo dell'altro logo no", sulDisegno.velature.cliente && !sulDisegno.velature.stazione);
    // la sfumatura vicino al bordo della pagina si ritaglia (nessun errore)
    const piccolissimo = await applicaLoghi(scura, { stazione: nero });
    atteso("vicino al bordo della pagina la sfumatura si ritaglia senza errori", piccolissimo.velature.stazione && piccolissimo.saltati.length === 0);

    // un logo rotto non fa fallire la copertina
    const rotto: LogoPronto = { png: Buffer.from("rotto"), larghezza: 10, altezza: 10, sfondo: "trasparente", motivo: null, colori: [] };
    const conRotto = await applicaLoghi(pagina, { stazione: rotto, cliente: smac });
    atteso("un logo che non si riesce ad applicare si salta (la copertina esce con l'altro)", conRotto.saltati.join() === "stazione" && !conRotto.velature.cliente);
    atteso("senza loghi la pagina esce identica", Buffer.compare((await applicaLoghi(pagina, {})).png, pagina) === 0);
  }

  console.log("--- Nel codice ---");
  {
    const relazione = leggi("src/lib/copertina-relazione.ts");
    atteso("i loghi non arrivano più al modello: la richiesta d'immagine parte senza allegati", /chiedi\(\{ prompt: promptCopertina\(dati\), loghi: \[\], apiKey, modello \}\)/.test(relazione));
    atteso("i loghi si leggono ORIGINALI (nessuna riduzione prima della preparazione: era la causa del caso SMAC)", !/LATO_MASSIMO_LOGO/.test(relazione) && /return \{ png: Buffer\.from\(grezzo\.base64, "base64"\) \}/.test(relazione));
    atteso("la copertina salvata (PNG e PDF) è quella con i loghi applicati", /applicaLoghi\(pagina\.png, \{ stazione: logoStazione, cliente: logoCliente \}\)/.test(relazione) && /pdfA4\(conLoghi\.png\)/.test(relazione) && /salvaCopertina\(admin, garaId, idCopertina\(marcaTempo\(adesso\), stile, false\), \{ png: conLoghi\.png, pdf, base: pagina\.png, scheda \}\)/.test(relazione));
    atteso("i colori dei loghi vanno nel prompt (letti dai file, mai inventati)", /coloriLoghi: \[\.\.\.\(logoStazione\?\.colori \?\? \[\]\), \.\.\.\(logoCliente\?\.colori \?\? \[\]\)\]/.test(relazione));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    atteso("il pannello consiglia di caricare i loghi in PNG con sfondo trasparente", /PNG con sfondo trasparente/.test(pannello));
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-copertina-loghi\.ts/.test(leggi("package.json")));
  }

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sui loghi della copertina sono superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
