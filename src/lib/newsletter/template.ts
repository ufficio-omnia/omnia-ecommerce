import { CLAIM, SEZIONI_PREDEFINITE, SOTTOTITOLO, TESTATA, type ContenutoEdizione, type Notizia, type Sezione } from "./tipi";

// Template email di «OMNIA AI | Tender Weekly». Funzione pura (nessun accesso a rete o database): la usano l'invio,
// l'anteprima della console (anche nel browser) e le verifiche.
//
// Regole per la compatibilità con i client di posta:
//  - impaginazione SOLO a tabelle, larghezza massima 640 px, stili in linea (Gmail ignora parte dei <style>);
//  - nessun JavaScript, nessun flex/grid, nessuna variabile CSS, nessuno sfondo a gradiente (Outlook non li disegna);
//  - le media query (smartphone) migliorano il risultato dove sono supportate, ma senza di loro la mail resta leggibile;
//  - pulsanti «a prova di Outlook»: cella di tabella con bgcolor, non un <a> con padding;
//  - schema colori dichiarato chiaro, per limitare l'inversione automatica dei colori in modalità scura.
// Tutto il testo è neutralizzato (escape) e gli indirizzi passano da urlSicuro prima di arrivare qui.

const C = {
  fondo: "#eeedf5",
  carta: "#ffffff",
  inchiostro: "#1b1930",
  testo: "#38365a",
  fioco: "#5d5b78",
  viola: "#5b4bd0",
  violaChiaro: "#f1effc",
  verde: "#09704e",
  verdeLogo: "#4fd1a5",
  verdeChiaro: "#eaf7f1",
  notte: "#0b0a16",
  notte2: "#16142a",
  bordo: "#e3e1f0",
  suNotte: "#e9e7f4",
  suNotteFioco: "#a9a6c4",
};

const FONT_TITOLI = "'Montserrat', 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_TESTO = "'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

export const LOGO_URL = "https://omnia-ai.it/site-omnia-ai/logo.png";
export const SITO_URL = "https://omnia-ai.it";
export const PRIVACY_URL = "https://omnia-ai.it/privacy";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function dataLunga(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${Number(m[3])} ${MESI[Number(m[2]) - 1]} ${m[1]}`;
}

export function numeroEdizione(n: number): string {
  return String(n).padStart(3, "0");
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Parametri di campagna solo sui collegamenti a omnia-ai.it (le fonti esterne restano come sono).
function conCampagna(url: string, numero: number): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "omnia-ai.it" && u.hostname !== "www.omnia-ai.it") return url;
    if (u.pathname.startsWith("/newsletter/")) return url;
    u.searchParams.set("utm_source", "tender-weekly");
    u.searchParams.set("utm_medium", "email");
    u.searchParams.set("utm_campaign", `tender-weekly-${numeroEdizione(numero)}`);
    return u.toString();
  } catch {
    return url;
  }
}

// Testi discorsivi giustificati (richiesta del 27/11): allineamento in linea, compatibile con Gmail, Outlook e Apple Mail;
// la sillabazione (dove il client la supporta; la lingua è dichiarata «it») evita i vuoti tra le parole su smartphone.
// Titoli, intestazioni, fonti, elenchi e pulsanti NON passano da questa funzione e restano allineati a sinistra.
export const GIUSTIFICATO = "text-align:justify;text-justify:inter-word;-webkit-hyphens:auto;-ms-hyphens:auto;hyphens:auto;";

function paragrafi(testo: string, colore: string, dimensione = 16): string {
  return testo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-family:${FONT_TESTO};font-size:${dimensione}px;line-height:1.65;color:${colore};${GIUSTIFICATO}">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function dataBreve(iso?: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[3])} ${MESI[Number(m[2]) - 1].slice(0, 3)} ${m[1]}`;
}

function fontiHtml(n: Notizia, scuro: boolean): string {
  if (n.fonti.length === 0) return "";
  const coloreEtichetta = scuro ? C.suNotteFioco : C.fioco;
  const coloreLink = scuro ? C.verdeLogo : C.viola;
  const voci = n.fonti
    .map((f) => {
      const meta = [f.ente, dataBreve(f.data)].filter(Boolean).join(" · ");
      return `<tr><td style="padding:0 0 6px 0;font-family:${FONT_TESTO};font-size:13px;line-height:1.5;color:${coloreEtichetta};">
<a href="${esc(f.url)}" target="_blank" style="color:${coloreLink};text-decoration:none;font-weight:600;">${esc(f.titolo)}&nbsp;&rarr;</a>${meta ? `<br><span style="font-size:12px;">${esc(meta)}</span>` : ""}
</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
<tr><td style="padding:0 0 6px 0;font-family:${FONT_TITOLI};font-size:10px;letter-spacing:1.6px;font-weight:800;text-transform:uppercase;color:${coloreEtichetta};">Fonti</td></tr>
${voci}</table>`;
}

function boxEvidenza(testo: string, scuro: boolean): string {
  const fondo = scuro ? C.notte2 : C.verdeChiaro;
  const colore = scuro ? C.verdeLogo : C.verde;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px 0;">
<tr><td width="4" style="background-color:${colore};font-size:0;line-height:0;">&nbsp;</td>
<td style="background-color:${fondo};padding:14px 18px;font-family:${FONT_TITOLI};font-size:17px;line-height:1.45;font-weight:700;color:${scuro ? "#ffffff" : C.inchiostro};">${esc(testo)}</td></tr></table>`;
}

function boxImplicazioni(testo: string, scuro: boolean): string {
  const fondo = scuro ? C.notte2 : C.violaChiaro;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 16px 0;">
<tr><td style="background-color:${fondo};padding:16px 18px;border-radius:6px;">
<p style="margin:0 0 8px 0;font-family:${FONT_TITOLI};font-size:11px;letter-spacing:1.6px;font-weight:800;text-transform:uppercase;color:${scuro ? C.verdeLogo : C.viola};">Cosa cambia per le imprese</p>
${paragrafi(testo, scuro ? C.suNotte : C.testo, 15).replace(/margin:0 0 14px 0/g, "margin:0 0 8px 0")}
</td></tr></table>`;
}

function notiziaHtml(n: Notizia, scuro: boolean, grande: boolean, numero: number): string {
  const immagine = n.immagine
    ? `<tr><td style="padding:0 0 18px 0;"><img src="${esc(n.immagine.url)}" alt="${esc(n.immagine.alt)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:6px;"></td></tr>`
    : "";
  void numero;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${immagine}
<tr><td style="padding:0 0 12px 0;">
<h3 class="tw-titolo-notizia" style="margin:0;font-family:${FONT_TITOLI};font-size:${grande ? 26 : 21}px;line-height:1.25;font-weight:800;color:${scuro ? "#ffffff" : C.inchiostro};">${esc(n.titolo)}</h3>
</td></tr>
<tr><td>
${paragrafi(n.sintesi, scuro ? C.suNotte : C.testo)}
${n.evidenza ? boxEvidenza(n.evidenza, scuro) : ""}
${n.implicazioni ? boxImplicazioni(n.implicazioni, scuro) : ""}
${fontiHtml(n, scuro)}
</td></tr></table>`;
}

function intestazioneSezione(lettera: string, titolo: string, scuro: boolean): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
<tr><td width="28" height="28" align="center" valign="middle" style="background-color:${scuro ? C.verdeLogo : C.viola};border-radius:4px;font-family:${FONT_TITOLI};font-size:13px;font-weight:800;color:${scuro ? C.notte : "#ffffff"};">${esc(lettera)}</td>
<td style="padding-left:12px;font-family:${FONT_TITOLI};font-size:12px;letter-spacing:2px;font-weight:800;text-transform:uppercase;color:${scuro ? C.verdeLogo : C.viola};">${esc(titolo)}</td></tr></table>`;
}

function separatore(): string {
  return `<tr><td class="tw-pad" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="background-color:${C.bordo};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`;
}

function sezioneHtml(s: Sezione, lettera: string, numero: number): string {
  const scuro = s.chiave === "notizia";
  const introduzione = s.introduzione ? paragrafi(s.introduzione, scuro ? C.suNotte : C.testo) : "";
  const notizie = s.notizie
    .map((n, i) => {
      const sep =
        i > 0
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 0 26px 0;"><table role="presentation" width="60" cellpadding="0" cellspacing="0" border="0"><tr><td height="2" style="background-color:${scuro ? C.verdeLogo : C.viola};font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr></table>`
          : "";
      return sep + notiziaHtml(n, scuro, scuro && i === 0, numero);
    })
    .join("");
  const corpo = `${intestazioneSezione(lettera, s.titolo, scuro)}${introduzione}${notizie}`;
  if (scuro) {
    return `<tr><td class="tw-pad" style="padding:8px 24px 8px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tw-pad-interno" bgcolor="${C.notte}" style="background-color:${C.notte};padding:34px 32px 26px 32px;border-radius:10px;">${corpo}</td></tr></table>
</td></tr>`;
  }
  return `<tr><td class="tw-pad" style="padding:36px 40px 20px 40px;">${corpo}</td></tr>`;
}

function chiusuraHtml(s: Sezione | undefined, c: ContenutoEdizione, numero: number): string {
  const testo = s?.introduzione?.trim() || c.cta.testo;
  return `<tr><td class="tw-pad" style="padding:8px 24px 32px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tw-pad-interno" bgcolor="${C.violaChiaro}" style="background-color:${C.violaChiaro};padding:32px;border-radius:10px;" align="left">
<p style="margin:0 0 10px 0;font-family:${FONT_TITOLI};font-size:22px;line-height:1.3;font-weight:800;color:${C.inchiostro};">${esc(s?.titolo && s.titolo !== SEZIONI_PREDEFINITE.chiusura.titolo ? s.titolo : "Il tuo ufficio gare, potenziato.")}</p>
${paragrafi(testo, C.testo, 15)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr>
<td bgcolor="${C.viola}" style="background-color:${C.viola};border-radius:6px;" align="center">
<a href="${esc(conCampagna(c.cta.url, numero))}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_TITOLI};font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">${esc(c.cta.etichetta)}&nbsp;&rarr;</a>
</td></tr></table>
</td></tr></table>
</td></tr>`;
}

export type DatiTemplate = {
  numero: number;
  data_edizione: string;
  oggetto: string;
  preheader: string;
  contenuto: ContenutoEdizione;
};

export type OpzioniTemplate = {
  // link personale di disiscrizione (pagina di conferma). Nell'anteprima: un link d'esempio.
  urlDisiscrizione: string;
  // frase «perché ricevi questa email»
  motivoRicezione?: string;
  // fascia «EMAIL DI PROVA» in cima
  prova?: boolean;
};

export function sezioniVisibili(c: ContenutoEdizione): Sezione[] {
  return c.sezioni.filter((s) => s.attiva && s.chiave !== "chiusura" && (s.notizie.length > 0 || (s.introduzione ?? "").trim()));
}

export function renderNewsletterHtml(d: DatiTemplate, o: OpzioniTemplate): string {
  const c = d.contenuto;
  const visibili = sezioniVisibili(c);
  const lettere = "ABCDEFGHIJ";
  const chiusura = c.sezioni.find((s) => s.chiave === "chiusura" && s.attiva);
  const numero = numeroEdizione(d.numero);
  const dataTxt = dataLunga(d.data_edizione);
  const motivo =
    o.motivoRicezione ??
    "Ricevi questa email perché il tuo indirizzo è iscritto a Tender Weekly, la newsletter informativa di OMNIA AI.";

  const sommario =
    visibili.length > 1
      ? `<tr><td class="tw-pad" style="padding:30px 40px 6px 40px;">
<p style="margin:0 0 12px 0;font-family:${FONT_TITOLI};font-size:11px;letter-spacing:2px;font-weight:800;text-transform:uppercase;color:${C.fioco};">In questo numero</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${visibili
  .map((s, i) => {
    const primo = s.notizie[0]?.titolo;
    return `<tr><td width="30" valign="top" style="padding:0 0 10px 0;font-family:${FONT_TITOLI};font-size:13px;font-weight:800;color:${C.viola};">${lettere[i]}</td>
<td valign="top" style="padding:0 0 10px 0;font-family:${FONT_TESTO};font-size:14px;line-height:1.45;color:${C.testo};"><strong style="color:${C.inchiostro};font-family:${FONT_TITOLI};">${esc(s.titolo)}</strong>${primo ? `<br><span style="color:${C.fioco};">${esc(primo)}</span>` : ""}</td></tr>`;
  })
  .join("")}
</table></td></tr>${separatore()}`
      : "";

  const editoriale =
    c.editoriale.attivo && c.editoriale.testo.trim()
      ? `<tr><td class="tw-pad" style="padding:38px 40px 8px 40px;">
<p style="margin:0 0 10px 0;font-family:${FONT_TITOLI};font-size:11px;letter-spacing:2px;font-weight:800;text-transform:uppercase;color:${C.verde};">Editoriale</p>
${c.editoriale.titolo ? `<h2 class="tw-titolo-editoriale" style="margin:0 0 16px 0;font-family:${FONT_TITOLI};font-size:28px;line-height:1.2;font-weight:800;color:${C.inchiostro};">${esc(c.editoriale.titolo)}</h2>` : ""}
${paragrafi(c.editoriale.testo, C.testo, 17)}
<p style="margin:4px 0 0 0;font-family:${FONT_TESTO};font-size:14px;font-style:italic;color:${C.fioco};">${esc(c.editoriale.firma)}</p>
</td></tr>${sommario ? "" : separatore()}`
      : "";

  const corpoSezioni = visibili
    .map((s, i) => {
      const html = sezioneHtml(s, lettere[i], d.numero);
      const prossima = visibili[i + 1];
      const serveSep = s.chiave !== "notizia" && prossima && prossima.chiave !== "notizia";
      return html + (serveSep ? separatore() : "");
    })
    .join("");

  const fasciaProva = o.prova
    ? `<tr><td align="center" style="background-color:#8f5509;padding:8px 16px;font-family:${FONT_TITOLI};font-size:12px;font-weight:800;letter-spacing:1.5px;color:#ffffff;">EMAIL DI PROVA · NON INOLTRARE</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="it" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(d.oggetto)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Montserrat:wght@700;800&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;}
body{margin:0!important;padding:0!important;width:100%!important;}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;}
@media screen and (max-width:620px){
  .tw-pad{padding-left:20px!important;padding-right:20px!important;}
  .tw-pad-interno{padding-left:22px!important;padding-right:22px!important;}
  .tw-testata{font-size:36px!important;letter-spacing:1px!important;}
  .tw-titolo-notizia{font-size:21px!important;}
  .tw-titolo-editoriale{font-size:24px!important;}
  .tw-blocco,.tw-meta{display:block!important;width:100%!important;}
  .tw-meta{text-align:left!important;padding-top:10px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.fondo};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.fondo};opacity:0;">${esc(d.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background-color:${C.fondo};">
<tr><td align="center" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background-color:${C.carta};border-radius:12px;overflow:hidden;">
${fasciaProva}
<tr><td bgcolor="${C.notte}" style="background-color:${C.notte};padding:22px 40px 0 40px;" class="tw-pad">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" class="tw-blocco"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><img src="${LOGO_URL}" width="34" height="34" alt="OMNIA AI" style="display:block;width:34px;height:34px;border:0;border-radius:6px;"></td>
<td valign="middle" style="padding-left:10px;font-family:${FONT_TITOLI};font-size:16px;font-weight:800;letter-spacing:2px;color:#ffffff;">OMNIA&nbsp;AI</td>
</tr></table></td>
<td valign="middle" align="right" class="tw-meta" style="font-family:${FONT_TITOLI};font-size:11px;letter-spacing:1.4px;font-weight:700;text-transform:uppercase;color:${C.suNotteFioco};">Edizione n.&nbsp;${numero} &middot; ${esc(dataTxt)}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${C.notte}" class="tw-pad" style="background-color:${C.notte};padding:40px 40px 34px 40px;">
<p style="margin:0 0 6px 0;font-family:${FONT_TITOLI};font-size:12px;letter-spacing:3px;font-weight:800;text-transform:uppercase;color:${C.verdeLogo};">La newsletter di OMNIA AI</p>
<h1 class="tw-testata" style="margin:0;font-family:${FONT_TITOLI};font-size:50px;line-height:1.02;font-weight:800;letter-spacing:2px;color:#ffffff;">${TESTATA}</h1>
<p style="margin:14px 0 22px 0;font-family:${FONT_TESTO};font-size:17px;line-height:1.5;color:${C.suNotte};">${esc(SOTTOTITOLO)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="72" height="3" style="background-color:${C.viola};font-size:0;line-height:0;">&nbsp;</td>
<td width="36" height="3" style="background-color:${C.verdeLogo};font-size:0;line-height:0;">&nbsp;</td>
<td height="3" style="background-color:${C.notte2};font-size:0;line-height:0;">&nbsp;</td>
</tr></table>
<p style="margin:16px 0 0 0;font-family:${FONT_TITOLI};font-size:10px;letter-spacing:2.4px;font-weight:700;color:${C.suNotteFioco};">${CLAIM}</p>
</td></tr>
${editoriale}
${sommario}
<tr><td style="padding-top:${sommario || editoriale ? 18 : 26}px;"></td></tr>
${corpoSezioni}
${chiusuraHtml(chiusura, c, d.numero)}
<tr><td bgcolor="${C.notte}" class="tw-pad" style="background-color:${C.notte};padding:30px 40px 34px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding-bottom:14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle"><img src="${LOGO_URL}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border:0;border-radius:5px;"></td>
<td valign="middle" style="padding-left:9px;font-family:${FONT_TITOLI};font-size:13px;font-weight:800;letter-spacing:2px;color:#ffffff;">OMNIA&nbsp;AI &middot; TENDER WEEKLY</td>
</tr></table></td></tr>
<tr><td style="font-family:${FONT_TESTO};font-size:12px;line-height:1.7;color:${C.suNotteFioco};">
OMNIA AI è un prodotto di Omnia Consulting SRLS &middot; P.IVA 02957590819<br>
<a href="mailto:info@omniaitalia.com" style="color:${C.suNotte};text-decoration:underline;">info@omniaitalia.com</a> &middot; <a href="${conCampagna(SITO_URL, d.numero)}" style="color:${C.suNotte};text-decoration:underline;">omnia-ai.it</a> &middot; <a href="${PRIVACY_URL}" style="color:${C.suNotte};text-decoration:underline;">Privacy</a><br><br>
I contenuti hanno finalità informativa e non costituiscono consulenza legale. Verifica sempre le fonti ufficiali citate.<br>
${esc(motivo)}<br>
<a href="${esc(o.urlDisiscrizione)}" style="color:${C.verdeLogo};text-decoration:underline;font-weight:600;">Gestisci l'iscrizione o disiscriviti</a>
</td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

function avvolgi(testo: string, larghezza = 76): string {
  const righe: string[] = [];
  for (const paragrafo of testo.split("\n")) {
    let riga = "";
    for (const parola of paragrafo.split(/\s+/).filter(Boolean)) {
      if ((riga + " " + parola).trim().length > larghezza) {
        righe.push(riga);
        riga = parola;
      } else riga = (riga + " " + parola).trim();
    }
    righe.push(riga);
  }
  return righe.join("\n");
}

// Versione in testo semplice (parte «text/plain» della stessa email).
export function renderNewsletterTesto(d: DatiTemplate, o: OpzioniTemplate): string {
  const c = d.contenuto;
  const righe: string[] = [];
  righe.push(`OMNIA AI | ${TESTATA}`, SOTTOTITOLO, `Edizione n. ${numeroEdizione(d.numero)} · ${dataLunga(d.data_edizione)}`, "");
  if (o.prova) righe.push("*** EMAIL DI PROVA ***", "");
  if (c.editoriale.attivo && c.editoriale.testo.trim()) {
    righe.push("EDITORIALE", c.editoriale.titolo, "", avvolgi(c.editoriale.testo), "", c.editoriale.firma, "", "----------------------------------------", "");
  }
  sezioniVisibili(c).forEach((s, i) => {
    righe.push(`${"ABCDEFGHIJ"[i]}. ${s.titolo.toUpperCase()}`, "");
    if (s.introduzione) righe.push(avvolgi(s.introduzione), "");
    for (const n of s.notizie) {
      righe.push(`» ${n.titolo}`, "", avvolgi(n.sintesi), "");
      if (n.evidenza) righe.push(`In evidenza: ${n.evidenza}`, "");
      if (n.implicazioni) righe.push("Cosa cambia per le imprese:", avvolgi(n.implicazioni), "");
      for (const f of n.fonti) righe.push(`Fonte: ${f.titolo}${f.data ? ` (${dataBreve(f.data)})` : ""} – ${f.url}`);
      righe.push("");
    }
    righe.push("----------------------------------------", "");
  });
  const chiusura = c.sezioni.find((s) => s.chiave === "chiusura" && s.attiva);
  righe.push(avvolgi(chiusura?.introduzione?.trim() || c.cta.testo), `${c.cta.etichetta}: ${conCampagna(c.cta.url, d.numero)}`, "");
  righe.push(CLAIM, "", "OMNIA AI è un prodotto di Omnia Consulting SRLS · P.IVA 02957590819", "info@omniaitalia.com · https://omnia-ai.it · Privacy: " + PRIVACY_URL, "");
  righe.push("I contenuti hanno finalità informativa e non costituiscono consulenza legale.");
  righe.push(o.motivoRicezione ?? "Ricevi questa email perché il tuo indirizzo è iscritto a Tender Weekly, la newsletter informativa di OMNIA AI.");
  righe.push(`Per disiscriverti: ${o.urlDisiscrizione}`);
  return righe.join("\n");
}
