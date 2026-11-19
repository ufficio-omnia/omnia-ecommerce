// Fase B4 — Modelli delle email delle notifiche di Tender Intelligence (decisione dell'utente del 19/11, §2–3; contratto di B2 versione 1).
// componiEmailRadar(evento, destinatario) → { oggetto, html, testo }: funzione PURA e DETERMINISTICA. Nessun database, nessuna rete, nessun
// orologio, nessuno stato tra una chiamata e l'altra: stessi ingressi, stessa email byte per byte (il motore di B2 rinvia con una chiave di
// idempotenza che esige lo stesso contenuto). Chi riceve, quando e se inviare lo decide il motore; qui solo che cosa si scrive.
//
// Regole che i modelli fanno valere da soli:
// - l'ora della scadenza compare SOLO se indicata, altrimenti «ora non indicata dalla fonte» (mai un'ora presunta);
// - i cambiamenti SOLO da `modifiche` ed `evidenza` passati dal motore: se mancano si rimanda all'avviso ufficiale, senza supporre nulla;
// - avvertenza (servizio informativo, verificare sempre la documentazione ufficiale) e collegamento alle preferenze sempre presenti;
// - ogni testo variabile passa dall'escape HTML, i collegamenti solo http(s), l'oggetto su una riga senza caratteri di controllo;
// - un evento di un'impresa non si compone per il destinatario di un'altra impresa, né con categoria e tipo incoerenti (errore, non email).
import {
  CATEGORIA_DEL_TIPO,
  GIORNI_PROMEMORIA,
  MASSIMO_GARE_RIEPILOGO,
  type DestinatarioEmail,
  type EmailComposta,
  type EventoModifica,
  type EventoRadar,
  type EventoRiepilogo,
  type EvidenzaModifica,
  type GaraEmail,
  type GaraRiepilogo,
  type LottoConScadenza,
  type ModificaRilevata,
  type ScadenzaNota,
  type TipoEvento,
} from "./contratto";
import { breve, esc, formattaData, formattaIstante, formattaScadenza, partiScadenza, riga, urlSicuro, TESTO_SCADENZA_NON_INDICATA } from "./formato";

export const AVVERTENZA_EMAIL =
  "Questo è un servizio informativo: OMNIA AI segnala ciò che rileva dalle fonti pubbliche, ma non sostituisce la documentazione ufficiale. " +
  "Prima di qualunque decisione verifica sempre bando, disciplinare, rettifiche e scadenze sulla piattaforma della stazione appaltante.";

export const NON_RISPONDERE = "Email automatica: non rispondere a questo indirizzo. Per assistenza usa la pagina Supporto della tua area riservata.";

export const NOTA_AGGIUNTA_A_MANO =
  "Gara aggiunta a mano dall'impresa: i dati sono quelli inseriti in OMNIA AI dall'impresa, non quelli di una fonte ufficiale.";

export const RIMANDO_AVVISO_UFFICIALE =
  "La fonte ha pubblicato un avviso di modifica, ma i dati che OMNIA AI confronta non risultano cambiati: i dettagli vanno letti nell'avviso ufficiale.";

export const DETTAGLIO_NON_DISPONIBILE = "Il dettaglio dei cambiamenti non è disponibile in forma leggibile: per sapere che cosa è cambiato apri l'avviso ufficiale.";

// ───── stile (coerente con le email di OMNIA AI: Arial, testo #1f2430, viola #6d5dfc, collegamenti #4f46e5) ─────

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const TESTO = "#1f2430";
const GRIGIO = "#6b7280";
const VIOLA = "#6d5dfc";
const LINK = "#4f46e5";
const AMBRA = "#b45309";

type Aspetto = { etichetta: string; colore: string; sfondo: string };

const ASPETTO: Record<TipoEvento, Aspetto> = {
  scadenza_10: { etichetta: "Scadenza tra 10 giorni", colore: "#4f46e5", sfondo: "#eef0ff" },
  scadenza_5: { etichetta: "Scadenza tra 5 giorni", colore: AMBRA, sfondo: "#fff4e0" },
  scadenza_1: { etichetta: "Scadenza domani", colore: "#b91c1c", sfondo: "#fdecec" },
  scadenza_ravvicinata: { etichetta: "Scadenza ravvicinata", colore: "#b91c1c", sfondo: "#fdecec" },
  rettifica: { etichetta: "Rettifica", colore: "#0e7490", sfondo: "#e6f6f9" },
  proroga: { etichetta: "Proroga", colore: "#0e7490", sfondo: "#e6f6f9" },
  modifica_scadenza: { etichetta: "Scadenza modificata", colore: "#0e7490", sfondo: "#e6f6f9" },
  documenti: { etichetta: "Documenti di gara", colore: "#0e7490", sfondo: "#e6f6f9" },
  annullamento: { etichetta: "Gara annullata", colore: "#9f1239", sfondo: "#fdecf1" },
  riepilogo_opportunita: { etichetta: "Nuove opportunità", colore: "#15803d", sfondo: "#e8f6ec" },
};

const NON_INDICATO = "non indicato";

// ───── testi che dipendono dall'evento ─────

function quandoScade(giorni: number): string {
  if (!Number.isInteger(giorni)) return "a breve";
  if (giorni <= 0) return "oggi";
  if (giorni === 1) return "domani";
  return `tra ${giorni} giorni`;
}

function laGara(gara: GaraEmail): string {
  return gara.aggiuntaAMano ? "una gara aggiunta a mano dall'impresa" : "una gara salvata o monitorata dall'impresa";
}

/** Gare del riepilogo NON elencate nell'email: quelle oltre le 20 più quelle che il motore ha già lasciato fuori. */
function altreGare(evento: EventoRiepilogo): number {
  const fuori = Number.isInteger(evento.altreNonIncluse) && evento.altreNonIncluse > 0 ? evento.altreNonIncluse : 0;
  return fuori + Math.max(0, evento.gare.length - MASSIMO_GARE_RIEPILOGO);
}

type Testi = { titolo: string; etichetta: string; introduzione: string; oggetto: string };

function testi(evento: EventoRadar): Testi {
  const etichetta = ASPETTO[evento.tipo].etichetta;
  if (evento.tipo === "riepilogo_opportunita") {
    const totale = Math.min(evento.gare.length, MASSIMO_GARE_RIEPILOGO) + altreGare(evento);
    return {
      titolo: totale === 1 ? "1 nuova gara in linea con il profilo dell'impresa" : `${totale} nuove gare in linea con il profilo dell'impresa`,
      etichetta,
      introduzione: "Dall'ultimo riepilogo sono state pubblicate gare che corrispondono al profilo dell'impresa. Le trovi tutte in «Per te».",
      oggetto: totale === 1 ? "1 nuova gara per te" : `${totale} nuove gare per te`,
    };
  }
  const nome = breve(evento.gara.denominazione, 90) || "gara senza denominazione";
  const quale = laGara(evento.gara);
  switch (evento.tipo) {
    case "scadenza_10":
    case "scadenza_5":
    case "scadenza_1": {
      const quando = quandoScade(GIORNI_PROMEMORIA[evento.tipo]);
      return {
        titolo: `La gara scade ${quando}`,
        etichetta,
        introduzione: `Promemoria per ${quale}: il termine per le offerte scade ${quando}.`,
        oggetto: `Scadenza ${quando}: ${nome}`,
      };
    }
    case "scadenza_ravvicinata": {
      const quando = quandoScade(evento.giorniMancanti);
      return {
        titolo: `La gara scade ${quando}`,
        etichetta,
        introduzione: `La gara è entrata da poco nella lista dell'impresa e il termine per le offerte è vicino: scade ${quando}.`,
        oggetto: `Scadenza ${quando}: ${nome}`,
      };
    }
    case "rettifica":
      return {
        titolo: "È stata pubblicata una rettifica",
        etichetta,
        introduzione: `Sulla fonte ufficiale è stata rilevata una rettifica per ${quale}.`,
        oggetto: `Rettifica: ${nome}`,
      };
    case "proroga":
      return {
        titolo: "La scadenza è stata prorogata",
        etichetta,
        introduzione: `Sulla fonte ufficiale la scadenza di ${quale} è stata prorogata. I prossimi promemoria seguiranno la nuova scadenza.`,
        oggetto: `Scadenza prorogata: ${nome}`,
      };
    case "modifica_scadenza":
      return {
        titolo: "La scadenza è stata modificata",
        etichetta,
        introduzione: `Sulla fonte ufficiale la scadenza di ${quale} è cambiata. I prossimi promemoria seguiranno la nuova scadenza.`,
        oggetto: `Scadenza modificata: ${nome}`,
      };
    case "documenti":
      return {
        titolo: "Sono stati pubblicati documenti di gara",
        etichetta,
        introduzione: `Sulla fonte ufficiale sono stati rilevati documenti sostitutivi o integrativi per ${quale}.`,
        oggetto: `Nuovi documenti di gara: ${nome}`,
      };
    case "annullamento":
      return {
        titolo: "La gara è stata annullata",
        etichetta,
        introduzione: `Secondo la fonte ufficiale, ${quale} è stata annullata.`,
        oggetto: `Gara annullata: ${nome}`,
      };
  }
}

function perche(destinatario: DestinatarioEmail, nomeImpresa: string | null): string {
  const impresa = riga(nomeImpresa);
  if (destinatario.ruolo === "titolare") {
    return impresa ? `Ricevi questa email perché sei il titolare dell'impresa ${impresa} in OMNIA AI.` : "Ricevi questa email perché sei il titolare dell'impresa in OMNIA AI.";
  }
  return impresa
    ? `Ricevi questa email perché fai parte dell'Ufficio Gare dell'impresa ${impresa} in OMNIA AI.`
    : "Ricevi questa email perché fai parte dell'Ufficio Gare dell'impresa in OMNIA AI.";
}

function nomiFonti(gara: GaraEmail): string {
  return gara.fonti.map((f) => riga(f.nome) || riga(f.fonte)).filter(Boolean).join(", ");
}

function etichettaAggiornamento(gara: GaraEmail): string {
  return gara.aggiuntaAMano ? "Ultimo aggiornamento della gara aggiunta" : "Ultimo aggiornamento rilevato dalla fonte";
}

function testoEvidenza(evidenza: EvidenzaModifica): { avviso: string; dettagli: string[] } {
  const avviso = riga(evidenza.avvisoId) ? `avviso ${riga(evidenza.avvisoId)}` : "avviso ufficiale";
  const fonte = riga(evidenza.nomeFonte) || riga(evidenza.fonte);
  const data = formattaData(evidenza.pubblicatoIl);
  const dettagli = [
    `${fonte ? `su ${fonte}` : ""}${data ? `${fonte ? ", " : ""}pubblicato il ${data}` : ""}`,
    evidenza.affidabilita === "confronto_versioni"
      ? "Cambiamento rilevato confrontando due versioni ufficiali della gara pubblicate dalla fonte."
      : "Avviso di modifica pubblicato dalla fonte.",
    riga(evidenza.motivoFonte) ? `Motivo indicato dalla fonte: ${riga(evidenza.motivoFonte)}.` : "",
    formattaIstante(evidenza.rilevatoIl) ? `Rilevato da OMNIA AI il ${formattaIstante(evidenza.rilevatoIl)}.` : "",
  ];
  return { avviso, dettagli };
}

function modificheDaElencare(evento: EventoModifica): ModificaRilevata[] {
  const valide = evento.modifiche.filter((m) => riga(m.etichetta));
  // per proroga e modifica della scadenza la scadenza ha già il suo riquadro «prima / ora»: qui solo gli altri cambiamenti
  return evento.tipo === "proroga" || evento.tipo === "modifica_scadenza" ? valide.filter((m) => m.campo !== "scadenza") : valide;
}

function titoloModifiche(evento: EventoModifica): string {
  if (evento.tipo === "documenti") return "Documenti pubblicati o sostituiti";
  if (evento.tipo === "proroga" || evento.tipo === "modifica_scadenza" || evento.tipo === "annullamento") return "Altri cambiamenti indicati dalla fonte";
  return "Che cosa è cambiato";
}

/** Il testo quando non c'è niente da elencare (null = nessun testo: proroga e modifica della scadenza hanno già il loro riquadro). */
function senzaModifiche(evento: EventoModifica): string | null {
  if (evento.tipo === "proroga" || evento.tipo === "modifica_scadenza" || evento.tipo === "annullamento") return null;
  return evento.evidenza.affidabilita === "avviso_ufficiale" ? RIMANDO_AVVISO_UFFICIALE : DETTAGLIO_NON_DISPONIBILE;
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

/** La scadenza in HTML; `compatta` per le righe del riepilogo e dei lotti (una riga, senza l'invito a controllare il bando). */
function scadenzaHtml(scadenza: ScadenzaNota | null, compatta = false): string {
  const { giorno, ora, senzaOra } = partiScadenza(scadenza);
  if (!giorno) return esc(TESTO_SCADENZA_NON_INDICATA);
  if (ora) return esc(`${giorno}, ore ${ora}`);
  if (compatta) return `${esc(giorno)} <span style="color:${AMBRA};">· ${esc(senzaOra)}</span>`;
  return `${esc(giorno)}<br><span style="font-weight:400;font-size:13px;color:${AMBRA};">${esc(senzaOra)}: controlla l'orario nel bando</span>`;
}

function campiGara(gara: GaraEmail, opzioni: { scadenza: boolean }): string[] {
  const righe = [campo("Gara", esc(riga(gara.denominazione) || "senza denominazione")), campo("Stazione appaltante", esc(riga(gara.stazioneAppaltante) || NON_INDICATO))];
  const cig = gara.cig.map(riga).filter(Boolean);
  if (cig.length) righe.push(campo("CIG", esc(cig.join(", "))));
  if (opzioni.scadenza) righe.push(campo("Scadenza per le offerte", scadenzaHtml(gara.scadenza)));
  if (riga(gara.tipoAvviso)) righe.push(campo("Tipo di avviso", esc(riga(gara.tipoAvviso))));
  if (riga(gara.luogo)) righe.push(campo("Luogo di esecuzione", esc(riga(gara.luogo))));
  const fonti = nomiFonti(gara);
  if (fonti || urlSicuro(gara.urlFonteUfficiale)) righe.push(campo("Fonte", link(fonti || "fonte ufficiale", gara.urlFonteUfficiale)));
  righe.push(campo(etichettaAggiornamento(gara), esc(formattaIstante(gara.ultimaVerificaIl) ?? "non disponibile")));
  return righe;
}

function riquadro(aspetto: Aspetto, etichetta: string, valoreHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;border-collapse:separate;">` +
    `<tr><td style="background:${aspetto.sfondo};border-left:4px solid ${aspetto.colore};border-radius:6px;padding:12px 16px;${FONT}">` +
    `<div style="font-size:12px;line-height:16px;color:${GRIGIO};text-transform:uppercase;letter-spacing:0.4px;">${esc(etichetta)}</div>` +
    `<div style="font-size:17px;line-height:24px;color:${TESTO};font-weight:700;">${valoreHtml}</div>` +
    `</td></tr></table>`
  );
}

function titoletto(testo: string): string {
  return `<div style="${FONT}font-size:15px;font-weight:700;color:${TESTO};margin:22px 0 8px;">${esc(testo)}</div>`;
}

function paragrafo(html: string, stile = ""): string {
  return `<p style="margin:0 0 12px;${FONT}font-size:15px;line-height:22px;color:${TESTO};${stile}">${html}</p>`;
}

function nota(testo: string): string {
  return paragrafo(esc(testo), "background:#f7f7fb;border-radius:6px;padding:10px 14px;font-size:14px;");
}

function evidenzaHtml(evidenza: EvidenzaModifica): string {
  const { avviso, dettagli } = testoEvidenza(evidenza);
  const [doveQuando, ...resto] = dettagli;
  return paragrafo(
    `Fonte del cambiamento: ${link(avviso, evidenza.avvisoUrl)}${doveQuando ? ` ${esc(doveQuando)}` : ""}.` +
      resto
        .filter(Boolean)
        .map((d) => `<br>${esc(d)}`)
        .join(""),
    `font-size:13px;line-height:19px;color:${GRIGIO};margin-top:10px;`,
  );
}

function valore(v: string | null): string {
  return riga(v) || NON_INDICATO;
}

function modificheHtml(modifiche: ModificaRilevata[]): string {
  return tabellaCampi(
    modifiche.map(
      (m) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
        `<div style="font-size:13px;font-weight:700;color:${TESTO};margin-bottom:4px;">${esc(riga(m.etichetta))}</div>` +
        `<div style="font-size:14px;line-height:20px;color:${GRIGIO};word-break:break-word;">Prima: <span style="text-decoration:line-through;">${esc(valore(m.prima))}</span></div>` +
        `<div style="font-size:14px;line-height:20px;color:${TESTO};font-weight:600;word-break:break-word;">Ora: ${esc(valore(m.dopo))}</div>` +
        `</td></tr>`,
    ),
  );
}

function descriviLotto(l: LottoConScadenza): string {
  return [`Lotto ${riga(l.numero) || "?"}`, riga(l.titolo)].filter(Boolean).join(" — ");
}

function lottiHtml(gara: GaraEmail): string {
  if (!gara.lottiConScadenzeDiverse.length) return "";
  return (
    titoletto("Lotti con una scadenza diversa") +
    tabellaCampi(
      gara.lottiConScadenzeDiverse.map(
        (l) =>
          `<tr><td style="padding:9px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
          `<div style="font-size:14px;font-weight:700;color:${TESTO};word-break:break-word;">${esc(descriviLotto(l))}</div>` +
          (riga(l.cig) ? `<div style="font-size:13px;color:${GRIGIO};">CIG ${esc(riga(l.cig))}</div>` : "") +
          `<div style="font-size:14px;color:${TESTO};">Scadenza: ${scadenzaHtml(l.scadenza, true)}</div>` +
          `</td></tr>`,
      ),
    )
  );
}

function schedaRiepilogo(gara: GaraRiepilogo): string {
  const dettagli = [riga(gara.stazioneAppaltante), riga(gara.luogo)].filter(Boolean).join(" · ");
  const motivo = gara.perche.map(riga).filter(Boolean)[0] ?? "";
  const fonte = nomiFonti(gara);
  const aggiornata = formattaIstante(gara.ultimaVerificaIl);
  return (
    `<tr><td style="padding:12px 0;border-bottom:1px solid #eef0f4;${FONT}">` +
    `<div style="font-size:15px;line-height:21px;font-weight:700;word-break:break-word;">${link(riga(gara.denominazione) || "senza denominazione", gara.urlScheda)}</div>` +
    (dettagli ? `<div style="font-size:13px;line-height:19px;color:${GRIGIO};word-break:break-word;">${esc(dettagli)}</div>` : "") +
    `<div style="font-size:13px;line-height:19px;color:${TESTO};">Scadenza: ${scadenzaHtml(gara.scadenza, true)}</div>` +
    (motivo ? `<div style="font-size:13px;line-height:19px;color:#15803d;word-break:break-word;">${esc(motivo)}</div>` : "") +
    `<div style="font-size:12px;line-height:18px;color:${GRIGIO};">${esc([fonte ? `Fonte: ${fonte}` : "", aggiornata ? `aggiornata il ${aggiornata}` : ""].filter(Boolean).join(" · "))}</div>` +
    `</td></tr>`
  );
}

function corpoHtml(evento: EventoRadar): string {
  if (evento.tipo === "riepilogo_opportunita") {
    const altre = altreGare(evento);
    return (
      tabellaCampi(evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO).map(schedaRiepilogo)) +
      (altre > 0 ? paragrafo(`E ${altre === 1 ? "un'altra gara" : `altre ${altre} gare`} in «Per te».`, "margin-top:14px;") : "") +
      pulsante("Apri «Per te» in OMNIA AI", evento.urlPerTe)
    );
  }
  const aspetto = ASPETTO[evento.tipo];
  const gara = evento.gara;
  const finale =
    lottiHtml(gara) +
    (gara.aggiuntaAMano ? nota(NOTA_AGGIUNTA_A_MANO) : "") +
    pulsante("Apri la scheda in OMNIA AI", gara.urlScheda) +
    (urlSicuro(gara.urlFonteUfficiale) ? paragrafo(`Oppure vai direttamente alla ${link("fonte ufficiale", gara.urlFonteUfficiale)}.`, "font-size:14px;") : "");
  if (evento.categoria === "scadenze") {
    return riquadro(aspetto, "Scadenza per le offerte", scadenzaHtml(gara.scadenza)) + tabellaCampi(campiGara(gara, { scadenza: false })) + finale;
  }
  const scadenzaCambiata = evento.tipo === "proroga" || evento.tipo === "modifica_scadenza";
  const elenco = modificheDaElencare(evento);
  const vuoto = senzaModifiche(evento);
  return (
    (scadenzaCambiata
      ? riquadro(aspetto, "Nuova scadenza per le offerte", scadenzaHtml(gara.scadenza)) +
        tabellaCampi([campo("Scadenza precedente", `<span style="font-weight:400;color:${GRIGIO};text-decoration:line-through;">${esc(formattaScadenza(evento.scadenzaPrecedente))}</span>`)])
      : "") +
    (evento.tipo === "annullamento" ? nota("Se stavi preparando un'offerta, verifica l'avviso ufficiale prima di qualunque passo.") : "") +
    (elenco.length ? titoletto(titoloModifiche(evento)) + modificheHtml(elenco) : vuoto ? nota(vuoto) : "") +
    evidenzaHtml(evento.evidenza) +
    titoletto("La gara") +
    tabellaCampi(campiGara(gara, { scadenza: !scadenzaCambiata })) +
    finale
  );
}

function documentoHtml(evento: EventoRadar, destinatario: DestinatarioEmail, t: Testi): string {
  const aspetto = ASPETTO[evento.tipo];
  const saluto = riga(destinatario.nome) ? `Buongiorno ${esc(riga(destinatario.nome))},` : "Buongiorno,";
  const preferenze = urlSicuro(destinatario.urlPreferenze);
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
${esc(perche(destinatario, evento.nomeImpresa))}<br>
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

function righeGaraTesto(gara: GaraEmail, opzioni: { scadenza: boolean }): string[] {
  const righe = [`Gara: ${riga(gara.denominazione) || "senza denominazione"}`, `Stazione appaltante: ${riga(gara.stazioneAppaltante) || NON_INDICATO}`];
  const cig = gara.cig.map(riga).filter(Boolean);
  if (cig.length) righe.push(`CIG: ${cig.join(", ")}`);
  if (opzioni.scadenza) righe.push(`Scadenza per le offerte: ${formattaScadenza(gara.scadenza)}`);
  if (riga(gara.tipoAvviso)) righe.push(`Tipo di avviso: ${riga(gara.tipoAvviso)}`);
  if (riga(gara.luogo)) righe.push(`Luogo di esecuzione: ${riga(gara.luogo)}`);
  const fonti = nomiFonti(gara);
  if (fonti) righe.push(`Fonte: ${fonti}`);
  righe.push(`${etichettaAggiornamento(gara)}: ${formattaIstante(gara.ultimaVerificaIl) ?? "non disponibile"}`);
  return righe;
}

function lottiTesto(gara: GaraEmail): string[] {
  if (!gara.lottiConScadenzeDiverse.length) return [];
  return [
    "",
    "LOTTI CON UNA SCADENZA DIVERSA",
    ...gara.lottiConScadenzeDiverse.flatMap((l) => [`- ${descriviLotto(l)}${riga(l.cig) ? ` (CIG ${riga(l.cig)})` : ""}`, `  Scadenza: ${formattaScadenza(l.scadenza)}`]),
  ];
}

function evidenzaTesto(evidenza: EvidenzaModifica): string[] {
  const { avviso, dettagli } = testoEvidenza(evidenza);
  const [doveQuando, ...resto] = dettagli;
  const righe = [`Fonte del cambiamento: ${avviso}${doveQuando ? ` ${doveQuando}` : ""}.`, ...resto.filter(Boolean)];
  const u = urlSicuro(evidenza.avvisoUrl);
  if (u) righe.push(`Avviso: ${u}`);
  return righe;
}

function corpoTesto(evento: EventoRadar): string[] {
  if (evento.tipo === "riepilogo_opportunita") {
    const righe: string[] = [];
    evento.gare.slice(0, MASSIMO_GARE_RIEPILOGO).forEach((g, i) => {
      const dettagli = [riga(g.stazioneAppaltante), riga(g.luogo)].filter(Boolean).join(" · ");
      const motivo = g.perche.map(riga).filter(Boolean)[0] ?? "";
      const fonte = nomiFonti(g);
      const aggiornata = formattaIstante(g.ultimaVerificaIl);
      righe.push(`${i + 1}. ${riga(g.denominazione) || "senza denominazione"}`);
      if (dettagli) righe.push(`   ${dettagli}`);
      righe.push(`   Scadenza: ${formattaScadenza(g.scadenza)}`);
      if (motivo) righe.push(`   ${motivo}`);
      const coda = [fonte ? `Fonte: ${fonte}` : "", aggiornata ? `aggiornata il ${aggiornata}` : ""].filter(Boolean).join(" · ");
      if (coda) righe.push(`   ${coda}`);
      const u = urlSicuro(g.urlScheda);
      if (u) righe.push(`   ${u}`);
      righe.push("");
    });
    const altre = altreGare(evento);
    if (altre > 0) righe.push(`E ${altre === 1 ? "un'altra gara" : `altre ${altre} gare`} in «Per te».`, "");
    const perTe = urlSicuro(evento.urlPerTe);
    if (perTe) righe.push(`Apri «Per te» in OMNIA AI: ${perTe}`);
    return righe;
  }
  const gara = evento.gara;
  const righe: string[] = [];
  if (evento.categoria === "scadenze") {
    righe.push(`SCADENZA PER LE OFFERTE: ${formattaScadenza(gara.scadenza)}`, "", ...righeGaraTesto(gara, { scadenza: false }));
  } else {
    const scadenzaCambiata = evento.tipo === "proroga" || evento.tipo === "modifica_scadenza";
    if (scadenzaCambiata) righe.push(`NUOVA SCADENZA PER LE OFFERTE: ${formattaScadenza(gara.scadenza)}`, `Scadenza precedente: ${formattaScadenza(evento.scadenzaPrecedente)}`, "");
    if (evento.tipo === "annullamento") righe.push("Se stavi preparando un'offerta, verifica l'avviso ufficiale prima di qualunque passo.", "");
    const elenco = modificheDaElencare(evento);
    const vuoto = senzaModifiche(evento);
    if (elenco.length) {
      righe.push(titoloModifiche(evento).toUpperCase());
      for (const m of elenco) righe.push(`- ${riga(m.etichetta)}`, `  Prima: ${valore(m.prima)}`, `  Ora: ${valore(m.dopo)}`);
      righe.push("");
    } else if (vuoto) {
      righe.push(vuoto, "");
    }
    righe.push(...evidenzaTesto(evento.evidenza), "", "LA GARA", ...righeGaraTesto(gara, { scadenza: !scadenzaCambiata }));
  }
  righe.push(...lottiTesto(gara));
  if (gara.aggiuntaAMano) righe.push("", NOTA_AGGIUNTA_A_MANO);
  const scheda = urlSicuro(gara.urlScheda);
  const fonte = urlSicuro(gara.urlFonteUfficiale);
  righe.push("");
  if (scheda) righe.push(`Apri la scheda in OMNIA AI: ${scheda}`);
  if (fonte) righe.push(`Fonte ufficiale: ${fonte}`);
  return righe;
}

function documentoTesto(evento: EventoRadar, destinatario: DestinatarioEmail, t: Testi): string {
  const preferenze = urlSicuro(destinatario.urlPreferenze);
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
    perche(destinatario, evento.nomeImpresa),
    preferenze ? `Preferenze delle notifiche: ${preferenze}` : "Puoi scegliere quali avvisi ricevere nelle preferenze delle notifiche della tua area riservata.",
    NON_RISPONDERE,
  ];
  return righe.map((r) => r.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")).join("\n") + "\n";
}

// ───── funzione pubblica ─────

/**
 * Compone l'email di un evento per un destinatario. Pura e deterministica: stessi dati, stessa email. Lancia un errore (e quindi nessuna
 * email) se il destinatario non appartiene all'impresa dell'evento, o se tipo e categoria dell'evento non sono coerenti col contratto.
 */
export function componiEmailRadar(evento: EventoRadar, destinatario: DestinatarioEmail): EmailComposta {
  if (!evento?.impresaId || !destinatario?.impresaId || destinatario.impresaId !== evento.impresaId) {
    throw new Error("componiEmailRadar: il destinatario non appartiene all'impresa dell'evento");
  }
  if (!Object.prototype.hasOwnProperty.call(CATEGORIA_DEL_TIPO, evento.tipo) || CATEGORIA_DEL_TIPO[evento.tipo] !== evento.categoria) {
    throw new Error("componiEmailRadar: tipo o categoria dell'evento non validi");
  }
  const t = testi(evento);
  const oggetto = breve(t.oggetto, 150);
  return { oggetto, html: documentoHtml(evento, destinatario, { ...t, oggetto }), testo: documentoTesto(evento, destinatario, t) };
}
