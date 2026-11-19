// Fase B4 — Modelli delle email delle notifiche di Tender Intelligence (decisione dell'utente del 19/11, §2–3).
// componiEmailRadar(evento, destinatario) → { oggetto, html, testo }: funzione PURA. Nessun database, nessuna rete, nessuno stato tra
// una chiamata e l'altra. Chi riceve l'email, quando e se inviarla lo decide il motore di B2; qui solo che cosa si scrive.
//
// Regole che i modelli fanno valere da soli:
// - l'ora della scadenza compare SOLO se indicata dalla fonte, altrimenti «ora non indicata dalla fonte» (mai un'ora presunta);
// - i cambiamenti di una rettifica sono SOLO quelli dell'evidenza passata dal motore: senza dettaglio si dice che non è disponibile;
// - l'avvertenza (servizio informativo, verificare sempre la documentazione ufficiale) e il collegamento alle preferenze ci sono sempre;
// - ogni testo variabile passa dall'escape HTML, i collegamenti solo http(s), l'oggetto su una riga senza caratteri di controllo;
// - un evento di un'impresa non si compone per il destinatario di un'altra impresa (errore, non email).
import {
  CATEGORIA_EMAIL,
  MASSIMO_GARE_RIEPILOGO,
  type DestinatarioEmailRadar,
  type DocumentoEmail,
  type EmailRadar,
  type EventoEmailRadar,
  type GaraEmailRadar,
  type ModificaEmail,
  type EvidenzaEmail,
  type TipoEmailRadar,
} from "./contratto";
import {
  breve,
  esc,
  formattaData,
  formattaScadenza,
  formattaVerifica,
  partiScadenza,
  riga,
  urlSicuro,
  TESTO_ORA_NON_INDICATA,
  TESTO_SCADENZA_NON_INDICATA,
} from "./formato";

export const AVVERTENZA_EMAIL =
  "Questo è un servizio informativo: OMNIA AI segnala ciò che rileva dalle fonti pubbliche, ma non sostituisce la documentazione ufficiale. " +
  "Prima di qualunque decisione verifica sempre bando, disciplinare, rettifiche e scadenze sulla piattaforma della stazione appaltante.";

export const NON_RISPONDERE = "Email automatica: non rispondere a questo indirizzo. Per assistenza usa la pagina Supporto della tua area riservata.";

// ───── stile (coerente con le email di OMNIA AI: Arial, testo #1f2430, viola #6d5dfc, collegamenti #4f46e5) ─────

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const TESTO = "#1f2430";
const GRIGIO = "#6b7280";
const VIOLA = "#6d5dfc";
const LINK = "#4f46e5";

type Aspetto = { etichetta: string; colore: string; sfondo: string };

const ASPETTO: Record<TipoEmailRadar, Aspetto> = {
  scadenza_10: { etichetta: "Scadenza tra 10 giorni", colore: "#4f46e5", sfondo: "#eef0ff" },
  scadenza_5: { etichetta: "Scadenza tra 5 giorni", colore: "#b45309", sfondo: "#fff4e0" },
  scadenza_1: { etichetta: "Scadenza domani", colore: "#b91c1c", sfondo: "#fdecec" },
  scadenza_ravvicinata: { etichetta: "Scadenza ravvicinata", colore: "#b91c1c", sfondo: "#fdecec" },
  rettifica: { etichetta: "Rettifica", colore: "#0e7490", sfondo: "#e6f6f9" },
  proroga: { etichetta: "Scadenza modificata", colore: "#0e7490", sfondo: "#e6f6f9" },
  documenti: { etichetta: "Documenti di gara", colore: "#0e7490", sfondo: "#e6f6f9" },
  nuove_opportunita: { etichetta: "Nuove opportunità", colore: "#15803d", sfondo: "#e8f6ec" },
};

const NATURA_DOCUMENTO: Record<DocumentoEmail["natura"], string> = {
  sostitutivo: "sostituisce un documento precedente",
  integrativo: "integra la documentazione",
  nuovo: "nuovo documento",
};

const NON_INDICATO = "non indicato";

// ───── testi che dipendono dall'evento ─────

function quandoScade(giorniMancanti: number): string {
  if (!Number.isInteger(giorniMancanti)) return "a breve";
  if (giorniMancanti <= 0) return "oggi";
  if (giorniMancanti === 1) return "domani";
  return `tra ${giorniMancanti} giorni`;
}

/** Proroga o anticipo solo se entrambe le date sono note e diverse; altrimenti «modificata». Mai una deduzione oltre il confronto. */
function versoDellaModifica(evento: Extract<EventoEmailRadar, { tipo: "proroga" }>): "prorogata" | "anticipata" | "modificata" {
  const prima = evento.scadenzaPrecedente?.giorno ?? "";
  const dopo = evento.gara.scadenza?.giorno ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prima) || !/^\d{4}-\d{2}-\d{2}$/.test(dopo) || prima === dopo) return "modificata";
  return dopo > prima ? "prorogata" : "anticipata";
}

/** Gare del riepilogo NON elencate nell'email: quelle oltre le 20 più quelle che il motore ha già lasciato fuori. */
function altreGare(evento: Extract<EventoEmailRadar, { tipo: "nuove_opportunita" }>): number {
  const fuori = Number.isInteger(evento.altre) && evento.altre > 0 ? evento.altre : 0;
  return fuori + Math.max(0, evento.gare.length - MASSIMO_GARE_RIEPILOGO);
}

type Testi = { titolo: string; etichetta: string; introduzione: string; oggetto: string };

function testi(evento: EventoEmailRadar): Testi {
  const aspetto = ASPETTO[evento.tipo];
  if (evento.tipo === "nuove_opportunita") {
    // le gare oltre le 20 mostrate e quelle che il motore ha già lasciato fuori (altre) contano nel totale
    const totale = Math.min(evento.gare.length, MASSIMO_GARE_RIEPILOGO) + altreGare(evento);
    const titolo = totale === 1 ? "1 nuova gara in linea con il profilo dell'impresa" : `${totale} nuove gare in linea con il profilo dell'impresa`;
    return {
      titolo,
      etichetta: aspetto.etichetta,
      introduzione: "Dall'ultimo riepilogo sono state pubblicate gare che corrispondono al profilo dell'impresa. Le trovi tutte in «Per te».",
      oggetto: totale === 1 ? "1 nuova gara per te" : `${totale} nuove gare per te`,
    };
  }
  const nome = breve(evento.gara.oggetto, 90) || "gara senza denominazione";
  switch (evento.tipo) {
    case "scadenza_10":
    case "scadenza_5":
    case "scadenza_1": {
      const giorni = evento.tipo === "scadenza_10" ? 10 : evento.tipo === "scadenza_5" ? 5 : 1;
      const quando = quandoScade(giorni);
      return {
        titolo: `La gara scade ${quando}`,
        etichetta: aspetto.etichetta,
        introduzione: `Promemoria per una gara salvata o monitorata dall'impresa: il termine per le offerte scade ${quando}.`,
        oggetto: `Scadenza ${quando}: ${nome}`,
      };
    }
    case "scadenza_ravvicinata": {
      const quando = quandoScade(evento.giorniMancanti);
      return {
        titolo: `La gara scade ${quando}`,
        etichetta: aspetto.etichetta,
        introduzione: `La gara è entrata da poco nella lista dell'impresa e il termine per le offerte è vicino: scade ${quando}.`,
        oggetto: `Scadenza ${quando}: ${nome}`,
      };
    }
    case "rettifica":
      return {
        titolo: "È stata pubblicata una rettifica",
        etichetta: aspetto.etichetta,
        introduzione: "Sulla fonte ufficiale è comparso un avviso di rettifica per una gara salvata o monitorata dall'impresa.",
        oggetto: `Rettifica pubblicata: ${nome}`,
      };
    case "proroga": {
      const verso = versoDellaModifica(evento);
      return {
        titolo: `La scadenza è stata ${verso}`,
        etichetta: verso === "prorogata" ? "Proroga" : aspetto.etichetta,
        introduzione: `Sulla fonte ufficiale la scadenza di una gara salvata o monitorata dall'impresa è stata ${verso}. I prossimi promemoria seguiranno la nuova scadenza.`,
        oggetto: `Scadenza ${verso}: ${nome}`,
      };
    }
    case "documenti":
      return {
        titolo: "Sono stati pubblicati documenti di gara",
        etichetta: aspetto.etichetta,
        introduzione: "Sulla fonte ufficiale sono comparsi documenti sostitutivi o integrativi per una gara salvata o monitorata dall'impresa.",
        oggetto: `Nuovi documenti di gara: ${nome}`,
      };
  }
}

function perche(destinatario: DestinatarioEmailRadar, impresaNome: string): string {
  const impresa = riga(impresaNome) || "la tua impresa";
  return destinatario.ruolo === "titolare"
    ? `Ricevi questa email perché sei il titolare dell'impresa ${impresa} in OMNIA AI.`
    : `Ricevi questa email perché fai parte dell'Ufficio Gare dell'impresa ${impresa} in OMNIA AI.`;
}

// ───── mattoni HTML (tabelle e stili in linea, larghezza fluida: si legge uguale su computer e telefono) ─────

function campo(etichetta: string, valoreHtml: string): string {
  return (
    `<tr><td style="padding:9px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
    `<div style="font-size:12px;line-height:16px;color:${GRIGIO};text-transform:uppercase;letter-spacing:0.4px;">${esc(etichetta)}</div>` +
    `<div style="font-size:15px;line-height:21px;color:${TESTO};font-weight:600;word-break:break-word;">${valoreHtml}</div>` +
    `</td></tr>`
  );
}

function tabellaCampi(righe: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${righe.join("")}</table>`;
}

function link(testo: string, url: string | null): string {
  const u = urlSicuro(url);
  return u ? `<a href="${esc(u)}" style="color:${LINK};text-decoration:underline;">${esc(testo)}</a>` : esc(testo);
}

function pulsante(testo: string, url: string | null): string {
  const u = urlSicuro(url);
  if (!u) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;"><tr>` +
    `<td style="background:${VIOLA};border-radius:8px;">` +
    `<a href="${esc(u)}" style="display:inline-block;padding:12px 22px;${FONT}font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(testo)}</a>` +
    `</td></tr></table>`
  );
}

/** La scadenza in HTML; `compatta` per le righe del riepilogo (una riga, senza l'invito a controllare il bando). */
function scadenzaHtml(gara: GaraEmailRadar, compatta = false): string {
  const { giorno, ora } = partiScadenza(gara.scadenza);
  if (!giorno) return esc(TESTO_SCADENZA_NON_INDICATA);
  if (ora) return esc(`${giorno}, ore ${ora}`);
  if (compatta) return `${esc(giorno)} <span style="color:#b45309;">· ${esc(TESTO_ORA_NON_INDICATA)}</span>`;
  return `${esc(giorno)}<br><span style="font-weight:400;font-size:13px;color:#b45309;">${esc(TESTO_ORA_NON_INDICATA)}: controlla l'orario nel bando</span>`;
}

function campiGara(gara: GaraEmailRadar, opzioni: { scadenza: boolean }): string[] {
  const righe = [campo("Gara", esc(riga(gara.oggetto) || "senza denominazione")), campo("Stazione appaltante", esc(riga(gara.stazioneAppaltante) || NON_INDICATO))];
  const cig = gara.cig.map(riga).filter(Boolean);
  if (cig.length) righe.push(campo(cig.length === 1 ? "CIG" : "CIG dei lotti", esc(cig.join(", "))));
  if (opzioni.scadenza) righe.push(campo("Scadenza per le offerte", scadenzaHtml(gara)));
  if (riga(gara.tipoAvviso)) righe.push(campo("Tipo di avviso", esc(riga(gara.tipoAvviso))));
  if (riga(gara.luogo)) righe.push(campo("Luogo di esecuzione", esc(riga(gara.luogo))));
  const fonti = gara.fonti.map(riga).filter(Boolean);
  if (fonti.length || urlSicuro(gara.urlFonte)) righe.push(campo("Fonte", link(fonti.join(", ") || "fonte ufficiale", gara.urlFonte)));
  righe.push(campo("Ultima verifica sulla fonte", esc(formattaVerifica(gara.ultimaVerifica) ?? "non disponibile")));
  return righe;
}

function riquadroScadenza(gara: GaraEmailRadar, aspetto: Aspetto): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border-collapse:separate;">` +
    `<tr><td style="background:${aspetto.sfondo};border-left:4px solid ${aspetto.colore};border-radius:6px;padding:12px 16px;${FONT}">` +
    `<div style="font-size:12px;line-height:16px;color:${GRIGIO};text-transform:uppercase;letter-spacing:0.4px;">Scadenza per le offerte</div>` +
    `<div style="font-size:17px;line-height:24px;color:${TESTO};font-weight:700;">${scadenzaHtml(gara)}</div>` +
    `</td></tr></table>`
  );
}

function titoletto(testo: string): string {
  return `<div style="${FONT}font-size:15px;font-weight:700;color:${TESTO};margin:22px 0 8px;">${esc(testo)}</div>`;
}

function paragrafo(html: string, stile = ""): string {
  return `<p style="margin:0 0 12px;${FONT}font-size:15px;line-height:22px;color:${TESTO};${stile}">${html}</p>`;
}

function evidenzaHtml(evidenza: EvidenzaEmail): string {
  const avviso = riga(evidenza.avviso) || "avviso ufficiale";
  const data = formattaData(evidenza.pubblicatoIl);
  return paragrafo(`Fonte del cambiamento: ${link(avviso, evidenza.url)}${data ? `, pubblicato il ${esc(data)}` : ""}.`, `font-size:13px;color:${GRIGIO};`);
}

function valoreModifica(v: string | null): string {
  return riga(v) || NON_INDICATO;
}

function modificheHtml(modifiche: ModificaEmail[]): string {
  const valide = modifiche.filter((m) => riga(m.campo));
  if (!valide.length) {
    return paragrafo(
      "La fonte segnala la rettifica, ma non ne riporta il dettaglio in forma leggibile: per sapere che cosa è cambiato apri l'avviso ufficiale.",
      "background:#f7f7fb;border-radius:6px;padding:10px 14px;",
    );
  }
  const righe = valide.map(
    (m) =>
      `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
      `<div style="font-size:13px;font-weight:700;color:${TESTO};margin-bottom:4px;">${esc(riga(m.campo))}</div>` +
      `<div style="font-size:14px;line-height:20px;color:${GRIGIO};word-break:break-word;">Prima: <span style="text-decoration:line-through;">${esc(valoreModifica(m.prima))}</span></div>` +
      `<div style="font-size:14px;line-height:20px;color:${TESTO};font-weight:600;word-break:break-word;">Ora: ${esc(valoreModifica(m.dopo))}</div>` +
      `</td></tr>`,
  );
  return tabellaCampi(righe);
}

function documentiHtml(documenti: DocumentoEmail[]): string {
  const validi = documenti.filter((d) => riga(d.nome));
  if (!validi.length) return paragrafo("La fonte segnala nuovi documenti, ma non ne riporta l'elenco: consulta la documentazione ufficiale.");
  const righe = validi.map(
    (d) =>
      `<tr><td style="padding:9px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
      `<div style="font-size:15px;line-height:21px;font-weight:600;color:${TESTO};word-break:break-word;">${link(riga(d.nome), d.url)}</div>` +
      `<div style="font-size:13px;color:${GRIGIO};">${esc(NATURA_DOCUMENTO[d.natura] ?? NATURA_DOCUMENTO.nuovo)}</div>` +
      `</td></tr>`,
  );
  return tabellaCampi(righe);
}

function schedaRiepilogo(gara: GaraEmailRadar): string {
  const dettagli = [riga(gara.stazioneAppaltante), riga(gara.luogo)].filter(Boolean).join(" · ");
  const fonte = gara.fonti.map(riga).filter(Boolean).join(", ");
  const verifica = formattaVerifica(gara.ultimaVerifica);
  return (
    `<tr><td style="padding:12px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
    `<div style="font-size:15px;line-height:21px;font-weight:700;word-break:break-word;">${link(riga(gara.oggetto) || "senza denominazione", gara.urlScheda)}</div>` +
    (dettagli ? `<div style="font-size:13px;line-height:19px;color:${GRIGIO};word-break:break-word;">${esc(dettagli)}</div>` : "") +
    `<div style="font-size:13px;line-height:19px;color:${TESTO};">Scadenza: ${scadenzaHtml(gara, true)}</div>` +
    `<div style="font-size:12px;line-height:18px;color:${GRIGIO};">${esc([fonte ? `Fonte: ${fonte}` : "", verifica ? `verificata il ${verifica}` : ""].filter(Boolean).join(" · "))}</div>` +
    `</td></tr>`
  );
}

function corpoHtml(evento: EventoEmailRadar): string {
  if (evento.tipo === "nuove_opportunita") {
    const mostrate = evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO);
    const altre = altreGare(evento);
    return (
      tabellaCampi(mostrate.map(schedaRiepilogo)) +
      (altre > 0 ? paragrafo(`E ${altre === 1 ? "un'altra gara" : `altre ${altre} gare`} in «Per te».`, "margin-top:14px;") : "") +
      pulsante("Apri «Per te» in OMNIA AI", evento.urlPerTe)
    );
  }
  const aspetto = ASPETTO[evento.tipo];
  const gara = evento.gara;
  let specifico = "";
  let scadenzaInEvidenza = true;
  switch (evento.tipo) {
    case "rettifica":
      specifico = titoletto("Che cosa è cambiato secondo l'avviso ufficiale") + modificheHtml(evento.modifiche) + evidenzaHtml(evento.evidenza);
      scadenzaInEvidenza = false;
      break;
    case "proroga":
      specifico =
        titoletto("La scadenza") +
        tabellaCampi([
          campo("Prima", `<span style="font-weight:400;color:${GRIGIO};text-decoration:line-through;">${esc(formattaScadenza(evento.scadenzaPrecedente))}</span>`),
          campo("Ora", scadenzaHtml(gara)),
        ]) +
        evidenzaHtml(evento.evidenza);
      scadenzaInEvidenza = false;
      break;
    case "documenti":
      specifico = titoletto("Documenti pubblicati") + documentiHtml(evento.documenti) + evidenzaHtml(evento.evidenza);
      scadenzaInEvidenza = false;
      break;
    default:
      break;
  }
  return (
    (scadenzaInEvidenza ? riquadroScadenza(gara, aspetto) : "") +
    tabellaCampi(campiGara(gara, { scadenza: !scadenzaInEvidenza && evento.tipo !== "proroga" })) +
    specifico +
    pulsante("Apri la scheda in OMNIA AI", gara.urlScheda) +
    (urlSicuro(gara.urlFonte) ? paragrafo(`Oppure vai direttamente alla ${link("fonte ufficiale", gara.urlFonte)}.`, "font-size:14px;") : "")
  );
}

function documentoHtml(evento: EventoEmailRadar, destinatario: DestinatarioEmailRadar, t: Testi): string {
  const aspetto = ASPETTO[evento.tipo];
  const saluto = riga(destinatario.nome) ? `Buongiorno ${esc(riga(destinatario.nome))},` : "Buongiorno,";
  const preferenze = urlSicuro(evento.urlPreferenze);
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(t.oggetto)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(t.introduzione)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5fb;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;border-collapse:separate;">
<tr><td style="padding:18px 28px 14px;border-bottom:2px solid ${VIOLA};${FONT}">
<span style="font-size:18px;font-weight:700;letter-spacing:0.5px;color:${TESTO};">OMNIA AI</span>
<span style="font-size:13px;color:${GRIGIO};">&nbsp;·&nbsp;Opportunità di gara</span>
</td></tr>
<tr><td style="padding:24px 28px 4px;${FONT}">
<span style="display:inline-block;background:${aspetto.sfondo};color:${aspetto.colore};font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${esc(t.etichetta)}</span>
<h1 style="margin:14px 0 10px;font-size:21px;line-height:28px;color:${TESTO};font-weight:700;">${esc(t.titolo)}</h1>
${paragrafo(saluto)}
${paragrafo(esc(t.introduzione))}
</td></tr>
<tr><td style="padding:4px 28px 8px;">
${corpoHtml(evento)}
</td></tr>
<tr><td style="padding:10px 28px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td style="background:#f7f7fb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;${FONT}font-size:13px;line-height:19px;color:#4b5563;">
<strong style="color:${TESTO};">Avvertenza.</strong> ${esc(AVVERTENZA_EMAIL)}
</td></tr></table>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #e5e7eb;${FONT}font-size:12px;line-height:18px;color:${GRIGIO};">
${esc(perche(destinatario, evento.impresaNome))}<br>
${preferenze ? `Puoi scegliere quali avvisi ricevere nelle <a href="${esc(preferenze)}" style="color:${LINK};text-decoration:underline;">preferenze delle notifiche</a>.` : "Puoi scegliere quali avvisi ricevere nelle preferenze delle notifiche della tua area riservata."}<br>
${esc(NON_RISPONDERE)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ───── versione di solo testo ─────

function righeGaraTesto(gara: GaraEmailRadar, opzioni: { scadenza: boolean }): string[] {
  const righe = [`Gara: ${riga(gara.oggetto) || "senza denominazione"}`, `Stazione appaltante: ${riga(gara.stazioneAppaltante) || NON_INDICATO}`];
  const cig = gara.cig.map(riga).filter(Boolean);
  if (cig.length) righe.push(`${cig.length === 1 ? "CIG" : "CIG dei lotti"}: ${cig.join(", ")}`);
  if (opzioni.scadenza) righe.push(`Scadenza per le offerte: ${formattaScadenza(gara.scadenza)}`);
  if (riga(gara.tipoAvviso)) righe.push(`Tipo di avviso: ${riga(gara.tipoAvviso)}`);
  if (riga(gara.luogo)) righe.push(`Luogo di esecuzione: ${riga(gara.luogo)}`);
  const fonti = gara.fonti.map(riga).filter(Boolean);
  if (fonti.length) righe.push(`Fonte: ${fonti.join(", ")}`);
  righe.push(`Ultima verifica sulla fonte: ${formattaVerifica(gara.ultimaVerifica) ?? "non disponibile"}`);
  return righe;
}

function evidenzaTesto(evidenza: EvidenzaEmail): string[] {
  const data = formattaData(evidenza.pubblicatoIl);
  const righe = [`Fonte del cambiamento: ${riga(evidenza.avviso) || "avviso ufficiale"}${data ? `, pubblicato il ${data}` : ""}`];
  const u = urlSicuro(evidenza.url);
  if (u) righe.push(u);
  return righe;
}

function corpoTesto(evento: EventoEmailRadar): string[] {
  if (evento.tipo === "nuove_opportunita") {
    const mostrate = evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO);
    const altre = altreGare(evento);
    const righe: string[] = [];
    mostrate.forEach((g, i) => {
      const dettagli = [riga(g.stazioneAppaltante), riga(g.luogo)].filter(Boolean).join(" · ");
      const fonte = g.fonti.map(riga).filter(Boolean).join(", ");
      const verifica = formattaVerifica(g.ultimaVerifica);
      righe.push(`${i + 1}. ${riga(g.oggetto) || "senza denominazione"}`);
      if (dettagli) righe.push(`   ${dettagli}`);
      righe.push(`   Scadenza: ${formattaScadenza(g.scadenza)}`);
      const coda = [fonte ? `Fonte: ${fonte}` : "", verifica ? `verificata il ${verifica}` : ""].filter(Boolean).join(" · ");
      if (coda) righe.push(`   ${coda}`);
      const u = urlSicuro(g.urlScheda);
      if (u) righe.push(`   ${u}`);
      righe.push("");
    });
    if (altre > 0) righe.push(`E ${altre === 1 ? "un'altra gara" : `altre ${altre} gare`} in «Per te».`, "");
    const perTe = urlSicuro(evento.urlPerTe);
    if (perTe) righe.push(`Apri «Per te» in OMNIA AI: ${perTe}`);
    return righe;
  }
  const gara = evento.gara;
  const righe: string[] = [];
  const scadenzaInEvidenza = evento.tipo !== "rettifica" && evento.tipo !== "proroga" && evento.tipo !== "documenti";
  if (scadenzaInEvidenza) righe.push(`SCADENZA PER LE OFFERTE: ${formattaScadenza(gara.scadenza)}`, "");
  righe.push(...righeGaraTesto(gara, { scadenza: !scadenzaInEvidenza && evento.tipo !== "proroga" }));
  switch (evento.tipo) {
    case "rettifica": {
      righe.push("", "CHE COSA È CAMBIATO SECONDO L'AVVISO UFFICIALE");
      const valide = evento.modifiche.filter((m) => riga(m.campo));
      if (!valide.length) righe.push("La fonte segnala la rettifica, ma non ne riporta il dettaglio in forma leggibile: per sapere che cosa è cambiato apri l'avviso ufficiale.");
      for (const m of valide) righe.push(`- ${riga(m.campo)}`, `  Prima: ${valoreModifica(m.prima)}`, `  Ora: ${valoreModifica(m.dopo)}`);
      righe.push(...evidenzaTesto(evento.evidenza));
      break;
    }
    case "proroga":
      righe.push("", "LA SCADENZA", `Prima: ${formattaScadenza(evento.scadenzaPrecedente)}`, `Ora: ${formattaScadenza(gara.scadenza)}`, ...evidenzaTesto(evento.evidenza));
      break;
    case "documenti": {
      righe.push("", "DOCUMENTI PUBBLICATI");
      const validi = evento.documenti.filter((d) => riga(d.nome));
      if (!validi.length) righe.push("La fonte segnala nuovi documenti, ma non ne riporta l'elenco: consulta la documentazione ufficiale.");
      for (const d of validi) {
        righe.push(`- ${riga(d.nome)} (${NATURA_DOCUMENTO[d.natura] ?? NATURA_DOCUMENTO.nuovo})`);
        const u = urlSicuro(d.url);
        if (u) righe.push(`  ${u}`);
      }
      righe.push(...evidenzaTesto(evento.evidenza));
      break;
    }
    default:
      break;
  }
  const scheda = urlSicuro(gara.urlScheda);
  const fonte = urlSicuro(gara.urlFonte);
  righe.push("");
  if (scheda) righe.push(`Apri la scheda in OMNIA AI: ${scheda}`);
  if (fonte) righe.push(`Fonte ufficiale: ${fonte}`);
  return righe;
}

function documentoTesto(evento: EventoEmailRadar, destinatario: DestinatarioEmailRadar, t: Testi): string {
  const preferenze = urlSicuro(evento.urlPreferenze);
  const righe = [
    `OMNIA AI · Opportunità di gara — ${t.etichetta}`,
    "",
    t.titolo,
    "",
    riga(destinatario.nome) ? `Buongiorno ${riga(destinatario.nome)},` : "Buongiorno,",
    t.introduzione,
    "",
    ...corpoTesto(evento),
    "",
    `AVVERTENZA. ${AVVERTENZA_EMAIL}`,
    "",
    "--",
    perche(destinatario, evento.impresaNome),
    preferenze ? `Preferenze delle notifiche: ${preferenze}` : "Puoi scegliere quali avvisi ricevere nelle preferenze delle notifiche della tua area riservata.",
    NON_RISPONDERE,
  ];
  return righe.map((r) => r.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")).join("\n") + "\n";
}

// ───── funzione pubblica ─────

/**
 * Compone l'email di un evento per un destinatario. Pura: stessi dati, stessa email. Lancia un errore se il destinatario non appartiene
 * all'impresa dell'evento (separazione rigorosa tra imprese: il motore non deve mai arrivare qui con dati di un'altra impresa).
 */
export function componiEmailRadar(evento: EventoEmailRadar, destinatario: DestinatarioEmailRadar): EmailRadar {
  if (!evento?.impresaId || !destinatario?.impresaId || destinatario.impresaId !== evento.impresaId) {
    throw new Error("componiEmailRadar: il destinatario non appartiene all'impresa dell'evento");
  }
  if (!(evento.tipo in CATEGORIA_EMAIL)) throw new Error("componiEmailRadar: tipo di evento sconosciuto");
  const t = testi(evento);
  const oggetto = breve(t.oggetto, 150);
  return { oggetto, html: documentoHtml(evento, destinatario, { ...t, oggetto }), testo: documentoTesto(evento, destinatario, t) };
}
