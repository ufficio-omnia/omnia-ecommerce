import { CHIAVI_SEZIONE, SEZIONI_PREDEFINITE, contenutoVuoto, type ChiaveSezione, type ContenutoEdizione, type Fonte, type Notizia, type Sezione } from "./tipi";

// Normalizzazione deterministica del contenuto di un'edizione: vale per quello che arriva dall'editor della console
// e per quello proposto dal modello. Niente HTML (il template neutralizza comunque tutto), lunghezze limitate,
// indirizzi solo http(s), sezioni sempre tutte presenti (quelle mancanti si aggiungono spente, in coda).

const MAX_TITOLO = 200;
const MAX_TESTO = 4000;
const MAX_NOTIZIE = 6;
const MAX_FONTI = 5;

function testo(valore: unknown, max: number): string {
  if (typeof valore !== "string") return "";
  return valore
    .replace(/\r\n?/g, "\n")
    // niente caratteri di controllo (tranne a capo e tab)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function urlSicuro(valore: unknown): string | null {
  if (typeof valore !== "string") return null;
  // «&amp;» arriva a volte dai risultati di ricerca già codificati in HTML: nell'indirizzo vale «&»
  // (anche nella forma spezzata «&amp=&»)
  const v = valore.trim().replace(/&amp=&/g, "&").replace(/&amp;/g, "&");
  if (v.length > 600) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function dataIso(valore: unknown): string | undefined {
  if (typeof valore !== "string") return undefined;
  const m = valore.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : `${m[1]}-${m[2]}-${m[3]}`;
}

function fonte(x: unknown): Fonte | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const url = urlSicuro(r.url);
  if (!url) return null;
  const titolo = testo(r.titolo, MAX_TITOLO) || new URL(url).hostname.replace(/^www\./, "");
  const f: Fonte = { titolo, url };
  const data = dataIso(r.data);
  if (data) f.data = data;
  const ente = testo(r.ente, 80);
  if (ente) f.ente = ente;
  return f;
}

function notizia(x: unknown): Notizia | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const titolo = testo(r.titolo, MAX_TITOLO);
  const sintesi = testo(r.sintesi, MAX_TESTO);
  if (!titolo && !sintesi) return null;
  const n: Notizia = {
    titolo,
    sintesi,
    fonti: (Array.isArray(r.fonti) ? r.fonti : []).map(fonte).filter((f): f is Fonte => f !== null).slice(0, MAX_FONTI),
  };
  const implicazioni = testo(r.implicazioni, 1500);
  if (implicazioni) n.implicazioni = implicazioni;
  const evidenza = testo(r.evidenza, 300);
  if (evidenza) n.evidenza = evidenza;
  if (typeof r.immagine === "object" && r.immagine !== null) {
    const im = r.immagine as Record<string, unknown>;
    const url = urlSicuro(im.url);
    // solo https: un'immagine http viene bloccata o segnalata dai client di posta
    if (url && url.startsWith("https://")) n.immagine = { url, alt: testo(im.alt, 160) };
  }
  return n;
}

export function normalizzaContenuto(x: unknown): ContenutoEdizione {
  const base = contenutoVuoto();
  if (typeof x !== "object" || x === null) return base;
  const r = x as Record<string, unknown>;

  const ed = (typeof r.editoriale === "object" && r.editoriale !== null ? r.editoriale : {}) as Record<string, unknown>;
  const editoriale = {
    attivo: ed.attivo === true,
    titolo: testo(ed.titolo, MAX_TITOLO),
    testo: testo(ed.testo, MAX_TESTO),
    firma: testo(ed.firma, 120) || base.editoriale.firma,
  };

  const viste = new Set<ChiaveSezione>();
  const sezioni: Sezione[] = [];
  for (const s of Array.isArray(r.sezioni) ? r.sezioni : []) {
    if (typeof s !== "object" || s === null) continue;
    const so = s as Record<string, unknown>;
    const chiave = so.chiave as ChiaveSezione;
    if (!CHIAVI_SEZIONE.includes(chiave) || viste.has(chiave)) continue;
    viste.add(chiave);
    sezioni.push({
      chiave,
      titolo: testo(so.titolo, 120) || SEZIONI_PREDEFINITE[chiave].titolo,
      attiva: so.attiva !== false,
      introduzione: testo(so.introduzione, 1500),
      notizie: (Array.isArray(so.notizie) ? so.notizie : []).map(notizia).filter((n): n is Notizia => n !== null).slice(0, MAX_NOTIZIE),
    });
  }
  for (const chiave of CHIAVI_SEZIONE) {
    if (!viste.has(chiave)) sezioni.push({ chiave, titolo: SEZIONI_PREDEFINITE[chiave].titolo, attiva: false, introduzione: "", notizie: [] });
  }

  const c = (typeof r.cta === "object" && r.cta !== null ? r.cta : {}) as Record<string, unknown>;
  const cta = {
    testo: testo(c.testo, 600) || base.cta.testo,
    etichetta: testo(c.etichetta, 40) || base.cta.etichetta,
    url: urlSicuro(c.url) ?? base.cta.url,
  };

  return { editoriale, sezioni, cta };
}

// Problemi che impediscono l'approvazione (bloccanti) o che conviene guardare (avvisi).
export function controllaEdizione(e: { oggetto: string; preheader: string; contenuto: ContenutoEdizione }): { bloccanti: string[]; avvisi: string[] } {
  const bloccanti: string[] = [];
  const avvisi: string[] = [];
  if (e.oggetto.trim().length < 5) bloccanti.push("Manca l'oggetto dell'email.");
  if (e.oggetto.length > 120) avvisi.push("Oggetto molto lungo: oltre i 60–70 caratteri viene tagliato da molti client.");
  if (!e.preheader.trim()) avvisi.push("Manca il preheader (la riga di anteprima nella casella di posta).");
  const attive = e.contenuto.sezioni.filter((s) => s.attiva);
  const conTesto = attive.filter((s) => s.notizie.length > 0 || (s.introduzione ?? "").trim());
  if (conTesto.length === 0 && !(e.contenuto.editoriale.attivo && e.contenuto.editoriale.testo.trim())) bloccanti.push("L'edizione è vuota: nessuna sezione attiva ha contenuti.");
  for (const s of attive) {
    if (s.chiave === "chiusura") continue;
    if (s.notizie.length === 0 && !(s.introduzione ?? "").trim()) avvisi.push(`La sezione «${s.titolo}» è attiva ma vuota: verrà omessa.`);
    for (const n of s.notizie) {
      if (!n.titolo.trim()) avvisi.push(`Una notizia in «${s.titolo}» non ha titolo.`);
      if ((s.chiave === "notizia" || s.chiave === "normativa" || s.chiave === "tender") && n.fonti.length === 0) {
        bloccanti.push(`«${n.titolo || "notizia senza titolo"}» (${s.titolo}) non ha fonti verificabili.`);
      }
    }
  }
  return { bloccanti, avvisi };
}
