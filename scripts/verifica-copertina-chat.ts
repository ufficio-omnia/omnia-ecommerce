// Autotest della CHAT per modificare una copertina della relazione tecnica e della numerazione «COPERTINA N.x» (richiesta dell'utente, 13/11/2026).
// Controlla, senza rete né database (OpenAI e storage sono finti):
//   - quando si apre (dopo le 6 generazioni: 3 stilizzate E 3 realistiche) e quando si chiude (3 copertine nuove; conta solo una copertina consegnata;
//     tetto ai messaggi; servizio non più disponibile; una modifica già in corso);
//   - la richiesta interpretata (il piano): valori controllati, testi e CIG nuovi, loghi spostati/ridimensionati/tolti, logo allegato;
//   - la modifica: se cambiano sfondo o testi il modello RITOCCA la pagina senza loghi; spostare o cambiare un logo lo fa il codice, senza modello e senza
//     costo d'immagine; i loghi si riapplicano sempre originali; la copertina nuova si salva come «-modifica» con i suoi file e si può modificare a sua volta;
//   - i nomi dei file e la numerazione (in ordine di creazione, comprese le modificate); i file interni (pagina senza loghi, miniatura, scheda, logo
//     allegato) non sono copertine e non si scaricano;
//   - le posizioni e dimensioni dei loghi;
//   - l'azione del server (l'ordine dei controlli), la pagina, il pannello, la migrazione 0108 e le etichette dei costi in console.
// Gratuito: gira nel livello 1, quindi in prebuild.
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  MESSAGGIO_CHAT_CHIUSA_PRIMA,
  MESSAGGIO_CHAT_FINITA,
  MESSAGGIO_IN_CORSO,
  MESSAGGIO_TROPPI_MESSAGGI,
  ISTRUZIONI_RICHIESTA,
  STORIA_MASSIMA,
  MESSAGGI_MASSIMI,
  MODIFICHE_MASSIME,
  SCHEMA_RICHIESTA,
  applicaPiano,
  chatAperta,
  copertinaDiLavoro,
  leggiPiano,
  loghiDiRiserva,
  loghiNominati,
  pianoSenzaEffetti,
  storiaPerInterprete,
  verificaPiano,
  type ContestoInterprete,
  messaggioPerInterprete,
  modificheContate,
  percorsoLogoAmmesso,
  promptRitocco,
  schedaDaJson,
  serveRitocco,
  statoChat,
  type PianoModifica,
  type RigaChat,
  type SchedaCopertina,
} from "../src/lib/copertina-chat-calcoli";
import { ZONA_CLIENTE, ZONA_STAZIONE, metaZona, rettangoloLogo, zonaPer } from "../src/lib/copertina-loghi-calcoli";
import { zoneDeiLoghi } from "../src/lib/copertina-loghi";
import { copertineDaNomi, etichettaNumero, fileCopertina, idCopertina, idCopertinaValido, nomeFileScaricato, numeriCopertine, percorsoCopertinaValido } from "../src/lib/copertina-relazione-calcoli";
import { ErroreOpenAI, linkCopertineIntere, modificaCopertina } from "../src/lib/copertina-relazione";
import { interpretaRichiesta } from "../src/lib/copertina-chat";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const GARA = "aaaaaaaa-1111-4111-8111-111111111111";
const ACCOUNT = "dddddddd-1111-4111-8111-111111111111";
const ADESSO = new Date("2026-11-13T10:00:00Z");
const W = 1584, H = 2240;

const riga = (extra: Partial<RigaChat>): RigaChat => ({ id: Math.random().toString(36).slice(2), ruolo: "assistente", testo: "x", copertina: null, allegato: null, allegato_per: null, stato: null, creata_il: ADESSO.toISOString(), ...extra });
const piano = (extra: Partial<PianoModifica> = {}): PianoModifica => ({
  esito: "modifica",
  messaggio: "Va bene, preparo la copertina.",
  istruzioniImmagine: "",
  titoloPrincipale: null,
  sottotitolo: null,
  cig: null,
  loghi: { stazione: { posizione: "invariata", dimensione: "invariata", togli: false }, cliente: { posizione: "invariata", dimensione: "invariata", togli: false } },
  ...extra,
});
const scheda: SchedaCopertina = {
  versione: 1,
  stile: "stilizzato",
  testi: { titoloPrincipale: "RELAZIONE TECNICA", titolo: "Servizio di pulizia degli edifici comunali", cig: "B1C2D3E4F5" },
  loghi: {
    stazione: { bucket: "gare", percorso: `${GARA}/logo-stazione.png`, posizione: "alto-sinistra", dimensione: "medio" },
    cliente: { bucket: "company-assets", percorso: `${ACCOUNT}/logo.png`, posizione: "basso-destra", dimensione: "medio" },
  },
  origine: null,
};
const ORIGINE = idCopertina("20261113T090000Z", "stilizzato", false);

async function pngPieno(larghezza: number, altezza: number, colore: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: larghezza, height: altezza, channels: 3, background: colore } }).png().toBuffer();
}
async function logoTrasparente(colore: { r: number; g: number; b: number }): Promise<Buffer> {
  const pieno = await pngPieno(40, 30, colore);
  return sharp({ create: { width: 60, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: pieno, left: 10, top: 5 }]).png().toBuffer();
}
async function pixel(immagine: Buffer, x: number, y: number): Promise<string> {
  const { data } = await sharp(immagine).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return `${data[0]},${data[1]},${data[2]}`;
}

async function main() {
  console.log("--- Quando si apre e quanto resta ---");
  {
    atteso("la chat si apre solo dopo 3 stilizzate E 3 realistiche", chatAperta({ perStile: { stilizzato: 3, realistico: 3 } }) && !chatAperta({ perStile: { stilizzato: 3, realistico: 2 } }) && !chatAperta({ perStile: { stilizzato: 2, realistico: 3 } }));
    const vecchia = new Date(ADESSO.getTime() - 25 * 60_000).toISOString();
    const righe = [
      riga({ ruolo: "cliente", stato: null }),
      riga({ stato: null, testo: "Puoi dirmi quale colore preferisci?" }),
      riga({ stato: "pronta", copertina: "copertina-20261113T091000Z-stilizzato-modifica" }),
      riga({ stato: "in_corso" }),
      riga({ stato: "in_corso", creata_il: vecchia }),
    ];
    atteso("contano solo le copertine consegnate e quelle in preparazione da poco (non le domande, non i messaggi del cliente, non le preparazioni interrotte)", modificheContate(righe, ADESSO).length === 2);
    const ok = { ok: true, messaggio: null };
    const chiusa = statoChat({ aperta: false, righe: [], adesso: ADESSO, diritto: ok });
    atteso("prima delle 6 generazioni: non si scrive, e il motivo lo dice", !chiusa.puoScrivere && chiusa.motivo === MESSAGGIO_CHAT_CHIUSA_PRIMA && /6 generazioni/.test(MESSAGGIO_CHAT_CHIUSA_PRIMA));
    const aperta = statoChat({ aperta: true, righe: [riga({ stato: "pronta" })], adesso: ADESSO, diritto: ok });
    atteso(`dopo le 6 generazioni si scrive: rimaste ${MODIFICHE_MASSIME - 1} di ${MODIFICHE_MASSIME} dopo una copertina consegnata`, aperta.puoScrivere && aperta.modificheFatte === 1 && aperta.modificheRimaste === MODIFICHE_MASSIME - 1 && MODIFICHE_MASSIME === 3);
    const finita = statoChat({ aperta: true, righe: [riga({ stato: "pronta" }), riga({ stato: "pronta" }), riga({ stato: "pronta" })], adesso: ADESSO, diritto: ok });
    atteso("dopo 3 copertine nuove la chat si chiude e non si può più scrivere", !finita.puoScrivere && finita.modificheRimaste === 0 && finita.motivo === MESSAGGIO_CHAT_FINITA);
    const molteDomande = statoChat({ aperta: true, righe: Array.from({ length: MESSAGGI_MASSIMI }, () => riga({ ruolo: "cliente" })), adesso: ADESSO, diritto: ok });
    atteso(`le domande non consumano le copertine, ma c'è un tetto di ${MESSAGGI_MASSIMI} messaggi del cliente`, !molteDomande.puoScrivere && molteDomande.modificheRimaste === 3 && molteDomande.motivo === MESSAGGIO_TROPPI_MESSAGGI);
    const spento = statoChat({ aperta: true, righe: [], adesso: ADESSO, diritto: { ok: false, messaggio: "Il periodo gratuito è terminato." } });
    atteso("servizio non più disponibile per la gara (spento, scaduto, non pagato): non si scrive, con il motivo del servizio", !spento.puoScrivere && spento.motivo === "Il periodo gratuito è terminato.");
    const inCorso = statoChat({ aperta: true, righe: [riga({ stato: "in_corso" })], adesso: ADESSO, diritto: ok });
    atteso("una copertina già in preparazione: si aspetta (niente doppi invii)", !inCorso.puoScrivere && inCorso.inCorso && inCorso.motivo === MESSAGGIO_IN_CORSO);
  }

  console.log("--- La copertina di lavoro (scelta una volta, poi sempre l'ultima versione) ---");
  {
    const t = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000).toISOString();
    const A = "copertina-20261113T090000Z-realistico";
    const B = "copertina-20261113T090500Z-stilizzato";
    const M1 = "copertina-20261113T091000Z-realistico-modifica";
    const M2 = "copertina-20261113T092000Z-realistico-modifica";
    atteso("chat vuota (o solo messaggi senza copertina): nessuna copertina di lavoro, la sceglie il cliente", copertinaDiLavoro([]) === null && copertinaDiLavoro([riga({ ruolo: "assistente", stato: null })]) === null);
    const soloScelta = copertinaDiLavoro([riga({ ruolo: "cliente", copertina: A, creata_il: t(0) }), riga({ stato: null, testo: "Quale colore preferisci?", creata_il: t(1) })]);
    atteso("primo messaggio su una copertina, nessuna consegnata (anche dopo una domanda): si lavora su quella scelta", soloScelta?.scelta === A && soloScelta?.ultima === A);
    const conConsegne = copertinaDiLavoro([
      riga({ ruolo: "cliente", copertina: A, creata_il: t(0) }),
      riga({ stato: "pronta", copertina: M1, creata_il: t(1) }),
      riga({ ruolo: "cliente", copertina: M1, creata_il: t(2) }),
      riga({ stato: "pronta", copertina: M2, creata_il: t(3) }),
    ]);
    atteso("dopo le consegne si continua sempre dall'ULTIMA copertina consegnata", conConsegne?.scelta === A && conConsegne?.ultima === M2);
    const disordinate = copertinaDiLavoro([
      riga({ stato: "pronta", copertina: M2, creata_il: t(3) }),
      riga({ ruolo: "cliente", copertina: B, creata_il: t(2) }),
      riga({ stato: "pronta", copertina: M1, creata_il: t(1) }),
      riga({ ruolo: "cliente", copertina: A, creata_il: t(0) }),
    ]);
    atteso("conta l'ordine di creazione, non quello in cui arrivano le righe; un messaggio successivo su un'altra copertina non cambia la scelta", disordinate?.scelta === A && disordinate?.ultima === M2);
    const inCorsoNo = copertinaDiLavoro([riga({ ruolo: "cliente", copertina: A, creata_il: t(0) }), riga({ stato: "pronta", copertina: M1, creata_il: t(1) }), riga({ stato: "in_corso", copertina: M2, creata_il: t(2) })]);
    atteso("una copertina ancora in preparazione (o interrotta) non è l'ultima versione", inCorsoNo?.ultima === M1);
  }

  console.log("--- La richiesta interpretata (il piano) ---");
  {
    atteso("lo schema della risposta è rigido: tutti i campi obbligatori, posizioni e dimensioni solo dagli elenchi", SCHEMA_RICHIESTA.required.length === 8 && SCHEMA_RICHIESTA.additionalProperties === false && JSON.stringify(SCHEMA_RICHIESTA.properties.logo_cliente.properties.posizione.enum).includes("alto-destra"));
    const buono = leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "  Sposto il logo  ", istruzioni_immagine: "Sfondo in toni blu", titolo_principale: null, sottotitolo: "Nuovo sottotitolo", cig: "cig: b1c2d3e4f6", logo_stazione: { posizione: "invariata", dimensione: "invariata", togli: false }, logo_cliente: { posizione: "alto-destra", dimensione: "grande", togli: false } }));
    atteso("un piano valido si legge, con i testi ripuliti e il CIG normalizzato", buono !== null && buono.messaggio === "Sposto il logo" && buono.sottotitolo === "Nuovo sottotitolo" && buono.cig === "B1C2D3E4F6" && buono.loghi.cliente.posizione === "alto-destra" && buono.loghi.cliente.dimensione === "grande" && buono.istruzioniImmagine === "Sfondo in toni blu");
    atteso("risposte inutilizzabili: JSON rotto, esito strano, messaggio vuoto → nessun piano", leggiPiano("non json") === null && leggiPiano(JSON.stringify({ esito: "boh", messaggio: "x" })) === null && leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "  " })) === null && leggiPiano(null) === null);
    const strano = leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "ok", istruzioni_immagine: "", titolo_principale: null, sottotitolo: null, cig: "XX", logo_stazione: { posizione: "sul tetto", dimensione: "enorme", togli: "si" }, logo_cliente: {} }));
    atteso("valori fuori elenco diventano «invariata», un CIG con la forma sbagliata non cambia nulla, «togli» solo se è proprio vero", strano !== null && strano.loghi.stazione.posizione === "invariata" && strano.loghi.stazione.dimensione === "invariata" && !strano.loghi.stazione.togli && strano.cig === null);
    atteso("CIG vuoto = togliere il CIG", leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "ok", istruzioni_immagine: "", titolo_principale: null, sottotitolo: null, cig: "", logo_stazione: {}, logo_cliente: {} }))?.cig === "");
    const msg = messaggioPerInterprete({ scheda, numero: 4, richiesta: "metti il logo a destra", allegatoPer: "cliente" });
    atteso("all'interprete vanno lo stato della copertina scelta (numero, testi, loghi e loro posto), l'allegato e la richiesta", /COPERTINA N\.4/.test(msg) && /RELAZIONE TECNICA/.test(msg) && /B1C2D3E4F5/.test(msg) && /in basso a destra, dimensione medio/.test(msg) && /ALLEGATO un nuovo logo del cliente/.test(msg) && msg.endsWith("metti il logo a destra"));
  }

  console.log("--- Chi è chi, la conversazione, i controlli sul piano (caso Teatro alla Scala, 13/11/2026) ---");
  {
    const NOMI = { stazione: "Fondazione Teatro alla Scala di Milano", cliente: "Pulizie Rossi S.r.l." };
    const C3 = "copertina-20261113T110813Z-stilizzato";
    const C7 = "copertina-20261113T111404Z-stilizzato-modifica";
    const C8 = "copertina-20261113T115020Z-stilizzato-modifica";
    const numeri = new Map([[C3, 3], [C7, 7], [C8, 8]]);
    const t = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000).toISOString();
    const righeScala: RigaChat[] = [
      riga({ ruolo: "cliente", copertina: C3, testo: "metti il nostro logo in basso a sinistra, adatta la copertina", creata_il: t(0) }),
      riga({ stato: "pronta", copertina: C7, testo: "Procedo a spostare il vostro logo in basso a sinistra.", creata_il: t(1) }),
      riga({ ruolo: "cliente", copertina: C7, testo: 'il logo "teatro alla scala mettilo centrale, fai in modo che si veda bene', creata_il: t(2) }),
      riga({ stato: "pronta", copertina: C8, testo: "Va bene, sposto il logo del cliente al centro.", creata_il: t(3) }),
      riga({ stato: "in_corso", testo: "Preparo...", creata_il: t(4) }),
    ];
    const storia = storiaPerInterprete(righeScala, numeri);
    atteso("la conversazione per l'interprete: in ordine, con la copertina di ogni messaggio e quelle consegnate, senza le preparazioni in corso", storia.length === 4 && storia[0].ruolo === "cliente" && storia[0].numeroSu === 3 && storia[1].numeroConsegnata === 7 && storia[3].numeroConsegnata === 8 && storia.every((m) => m.testo !== "Preparo..."));
    const schedaC7: SchedaCopertina = { ...scheda, loghi: { stazione: scheda.loghi.stazione, cliente: { ...(scheda.loghi.cliente as NonNullable<SchedaCopertina["loghi"]["cliente"]>), posizione: "basso-sinistra" } }, origine: C3 };
    const conSchede = storiaPerInterprete(righeScala, numeri, new Map([[C7, schedaC7]]));
    atteso("nella conversazione, per ogni copertina consegnata, com'erano i loghi (se la scheda si legge)", conSchede[1].loghiConsegnata?.cliente?.posizione === "basso-sinistra" && conSchede[3].loghiConsegnata === null && storia[1].loghiConsegnata === null);
    const lunga = storiaPerInterprete([...Array.from({ length: 14 }, (_, i) => riga({ ruolo: "cliente", testo: `messaggio ${i}`, creata_il: t(i) })), riga({ ruolo: "cliente", testo: "x".repeat(900), creata_il: t(20) })], numeri);
    atteso(`solo gli ultimi ${STORIA_MASSIMA} messaggi, quelli lunghi accorciati`, lunga.length === STORIA_MASSIMA && lunga[0].testo === "messaggio 5" && lunga[STORIA_MASSIMA - 1].testo.length === 401 && lunga[STORIA_MASSIMA - 1].testo.endsWith("…"));
    const schedaC8: SchedaCopertina = { ...scheda, loghi: { stazione: scheda.loghi.stazione, cliente: { ...(scheda.loghi.cliente as NonNullable<SchedaCopertina["loghi"]["cliente"]>), posizione: "alto-centro" } } };
    const contesto: ContestoInterprete = { nomi: NOMI, storia: conSchede, partenza: { numero: 3, scheda }, precedente: { numero: 7, scheda: schedaC7 } };
    const msg = messaggioPerInterprete({ scheda: schedaC8, numero: 8, richiesta: "no, errore, avevo detto solo il logo della stazione appaltante, non il nostro logo.", allegatoPer: null, contesto });
    atteso(
      "all'interprete vanno: chi è chi (nomi e quale logo è di chi), la conversazione, la copertina di partenza, quella da modificare adesso e la richiesta",
      /CHI È CHI:/.test(msg) && /stazione appaltante \(l'ente che ha bandito la gara\): «Fondazione Teatro alla Scala di Milano» → il suo logo è logo_stazione/.test(msg) && /cliente \(l'azienda che ti scrive: «nostro», «mio»\): «Pulizie Rossi S\.r\.l\.» → il suo logo è logo_cliente/.test(msg) &&
        /CONVERSAZIONE FINORA/.test(msg) && /CLIENTE \(su COPERTINA N\.3\): metti il nostro logo in basso a sinistra/.test(msg) && /ASSISTENTE: Va bene, sposto il logo del cliente al centro\. \[ha consegnato la COPERTINA N\.8\]/.test(msg) &&
        /COPERTINA DI PARTENZA \(COPERTINA N\.3, scelta dal cliente all'inizio\)/.test(msg) && /COPERTINA DA MODIFICARE ADESSO \(COPERTINA N\.8\)/.test(msg) && msg.indexOf("COPERTINA DI PARTENZA") < msg.indexOf("COPERTINA DA MODIFICARE ADESSO") &&
        /\[ha consegnato la COPERTINA N\.7: logo della stazione appaltante in alto a sinistra, dimensione medio; logo del cliente in basso a sinistra, dimensione medio\]/.test(msg) &&
        /COPERTINA PRECEDENTE \(COPERTINA N\.7, da cui è nata quella da modificare adesso: per annullare l'ultima modifica si torna a questa\):\n- logo della stazione appaltante: in alto a sinistra, dimensione medio\n- logo del cliente: in basso a sinistra, dimensione medio/.test(msg) && /logo del cliente: in alto al centro, dimensione medio/.test(msg) && msg.endsWith("non il nostro logo."),
    );
    const conTitolo = messaggioPerInterprete({ scheda, numero: 4, richiesta: "ciao", allegatoPer: null, contesto: { nomi: { stazione: null, cliente: "MARIO ROSSI" }, titoloGara: "teatro la scala milano pulizie", storia: [], partenza: null } });
    atteso("senza il nome dell'ente l'interprete ha almeno il titolo della gara, e le istruzioni gli dicono di ricavarlo da lì e dal sottotitolo", /- la gara: «teatro la scala milano pulizie»/.test(conTitolo) && /stazione appaltante \(l'ente che ha bandito la gara\): nome non indicato/.test(conTitolo) && /ricavalo dal titolo della gara e dal sottotitolo della copertina/.test(ISTRUZIONI_RICHIESTA));
    const conEnte = schedaDaJson({ ...JSON.parse(JSON.stringify(scheda)), ente: "  Fondazione Teatro alla Scala  " }, GARA, ACCOUNT);
    atteso("il nome dell'ente si salva nella scheda (ripulito), passa alle copertine modificate e manca se non c'è", conEnte?.ente === "Fondazione Teatro alla Scala" && applicaPiano({ scheda: conEnte as SchedaCopertina, piano: piano(), allegato: null, origine: ORIGINE }).ente === "Fondazione Teatro alla Scala" && !("ente" in (schedaDaJson({ ...JSON.parse(JSON.stringify(scheda)), ente: "   " }, GARA, ACCOUNT) ?? {})) && !("ente" in applicaPiano({ scheda, piano: piano(), allegato: null, origine: ORIGINE })));
    atteso("ogni copertina generata salva il nome dell'ente (dalla gara, o letto dal documento)", /\.\.\.entePerScheda\(gara\.stazioneAppaltante \?\? letto\.lettura\.ente\)/.test(leggi("src/lib/copertina-relazione.ts")));
    const precedenteUguale = messaggioPerInterprete({ scheda: schedaC7, numero: 7, richiesta: "x", allegatoPer: null, contesto: { nomi: NOMI, storia: [], partenza: { numero: 3, scheda }, precedente: { numero: 3, scheda } } });
    atteso("se la copertina precedente è quella di partenza la si scrive una volta sola, dicendolo", !/COPERTINA DI PARTENZA/.test(precedenteUguale) && /COPERTINA PRECEDENTE \(COPERTINA N\.3, la copertina di partenza scelta dal cliente, da cui è nata/.test(precedenteUguale));
    atteso("le istruzioni: per annullare l'ultima modifica si torna alla copertina PRECEDENTE (non a quella di partenza) e si fa anche la richiesta vera", /nella STESSA risposta fai due cose/.test(ISTRUZIONI_RICHIESTA) && /posizione e dimensione dei loghi della COPERTINA PRECEDENTE \(non quella di partenza\)/.test(ISTRUZIONI_RICHIESTA) && /fai quello che il cliente aveva chiesto davvero/.test(ISTRUZIONI_RICHIESTA));
    const senzaContesto = messaggioPerInterprete({ scheda, numero: 4, richiesta: "ciao", allegatoPer: null });
    atteso("senza nomi l'interprete lo sa («nome non indicato») e non c'è una conversazione inventata", (senzaContesto.match(/nome non indicato/g) ?? []).length === 2 && !/CONVERSAZIONE FINORA/.test(senzaContesto) && !/COPERTINA DI PARTENZA/.test(senzaContesto));
    atteso("le istruzioni spiegano chi è chi, di cambiare solo il richiesto, di togliere solo se chiesto e come rimediare a un errore", /CHI È CHI/.test(ISTRUZIONI_RICHIESTA) && /«nostro», «mio»/.test(ISTRUZIONI_RICHIESTA) && /Togli un logo SOLO se il cliente chiede esplicitamente di toglierlo/.test(ISTRUZIONI_RICHIESTA) && /LA CONVERSAZIONE/.test(ISTRUZIONI_RICHIESTA) && /rimetti true/.test(ISTRUZIONI_RICHIESTA));
    atteso("lo schema ha «rimetti» obbligatorio per ogni logo; si legge solo se è proprio vero", JSON.stringify(SCHEMA_RICHIESTA.properties.logo_stazione.required) === JSON.stringify(["posizione", "dimensione", "togli", "rimetti"]) && leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "ok", istruzioni_immagine: "", titolo_principale: null, sottotitolo: null, cig: null, logo_stazione: { rimetti: true }, logo_cliente: { rimetti: "si" } }))?.loghi.stazione.rimetti === true && leggiPiano(JSON.stringify({ esito: "modifica", messaggio: "ok", istruzioni_immagine: "", titolo_principale: null, sottotitolo: null, cig: null, logo_stazione: {}, logo_cliente: { rimetti: "si" } }))?.loghi.cliente.rimetti === false);

    const n1 = loghiNominati('il logo "teatro alla scala mettilo centrale, fai in modo che si veda bene', NOMI);
    const n2 = loghiNominati("no, errore, avevo detto solo il logo della stazione appaltante, non il nostro logo.", NOMI);
    const n3 = loghiNominati("metti il mio logo più grande", NOMI);
    const n4 = loghiNominati("sposta il logo in alto a destra", NOMI);
    atteso("di quali loghi parla la richiesta: per nome dell'ente, «stazione appaltante», «nostro/mio», o nessuno", n1.stazione && !n1.cliente && n2.stazione && n2.cliente && n3.cliente && !n3.stazione && !n4.stazione && !n4.cliente);
    atteso("«il logo del comune» è la stazione appaltante; una parola presente in tutti e due i nomi non indica nessuno dei due", loghiNominati("metti il logo del comune in alto", { stazione: "Comune di Aosta", cliente: "Pulizie Rossi" }).stazione && !loghiNominati("il logo di milano", { stazione: "Milano Servizi Pubblici", cliente: "Pulizie Milano srl" }).stazione && !loghiNominati("il logo di milano", { stazione: "Milano Servizi Pubblici", cliente: "Pulizie Milano srl" }).cliente);

    const fermo = { posizione: "invariata", dimensione: "invariata", togli: false, rimetti: false } as const;
    const spostaCliente = piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, posizione: "alto-centro" } } });
    const v1 = verificaPiano({ piano: spostaCliente, richiesta: 'il logo "teatro alla scala mettilo centrale', nomi: NOMI });
    atteso("caso Scala n.2: il cliente nomina il Teatro alla Scala ma il modello sposta il logo del cliente → si chiede quale (niente copertina consumata)", v1.domanda !== null && /stazione appaltante \(Fondazione Teatro alla Scala di Milano\) o il logo della tua azienda/.test(v1.domanda ?? ""));
    const v2 = verificaPiano({ piano: piano({ loghi: { stazione: { ...fermo, posizione: "alto-centro" }, cliente: { ...fermo } } }), richiesta: 'il logo "teatro alla scala mettilo centrale', nomi: NOMI });
    atteso("se il modello sposta il logo giusto si procede", v2.domanda === null && v2.piano.loghi.stazione.posizione === "alto-centro");
    const v3 = verificaPiano({ piano: piano({ loghi: { stazione: { ...fermo, posizione: "alto-centro" }, cliente: { ...fermo, togli: true } } }), richiesta: "no, errore, avevo detto solo il logo della stazione appaltante, non il nostro logo.", nomi: NOMI });
    atteso("caso Scala n.3: «non il nostro logo» non è una richiesta di togliere → il «togli» del modello non vale", v3.domanda === null && v3.piano.loghi.cliente.togli === false && v3.piano.loghi.stazione.posizione === "alto-centro");
    const v4 = verificaPiano({ piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, togli: true } } }), richiesta: "togli il nostro logo", nomi: NOMI });
    const v5 = verificaPiano({ piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, togli: true } } }), richiesta: "elimina il nostro logo dalla copertina", nomi: NOMI });
    atteso("se il cliente chiede davvero di togliere, il «togli» resta", v4.piano.loghi.cliente.togli && v5.piano.loghi.cliente.togli && v4.domanda === null);
    const v6 = verificaPiano({ piano: spostaCliente, richiesta: "sposta il logo in alto al centro", nomi: NOMI });
    const v7 = verificaPiano({ piano: { ...spostaCliente, esito: "risposta" }, richiesta: 'il logo "teatro alla scala mettilo centrale', nomi: NOMI });
    atteso("nessuna domanda se la richiesta non nomina nessuno dei due, o se il modello sta già rispondendo", v6.domanda === null && v7.domanda === null);

    const riserva = loghiDiRiserva(righeScala, scheda, GARA);
    const daPrecedente = loghiDiRiserva(righeScala, scheda, GARA, schedaC7);
    const precedenteSenza = loghiDiRiserva(righeScala, scheda, GARA, { ...schedaC7, loghi: { ...schedaC7.loghi, cliente: null } });
    atteso("logo da rimettere: prima quello della copertina precedente (annullare l'ultima modifica), se lì non c'è quello di partenza", daPrecedente.cliente?.posizione === "basso-sinistra" && precedenteSenza.cliente?.posizione === "basso-destra");
    atteso("logo da rimettere: quello della copertina di partenza, nel suo posto", riserva.cliente?.percorso === `${ACCOUNT}/logo.png` && riserva.cliente?.posizione === "basso-destra" && riserva.stazione?.posizione === "alto-sinistra");
    const conAllegati = loghiDiRiserva([...righeScala, riga({ ruolo: "cliente", allegato: `${GARA}/copertina-allegato-20261113T120000Z.png`, allegato_per: "cliente", creata_il: t(5) }), riga({ ruolo: "cliente", allegato: "bbbbbbbb-1111-4111-8111-111111111111/copertina-allegato-x.png", allegato_per: "stazione", creata_il: t(6) })], scheda, GARA);
    atteso("se il cliente aveva allegato un logo, si rimette l'ultimo allegato (nel posto di partenza); un allegato di un'altra gara no", conAllegati.cliente?.bucket === "gare" && conAllegati.cliente?.percorso === `${GARA}/copertina-allegato-20261113T120000Z.png` && conAllegati.cliente?.posizione === "basso-destra" && conAllegati.stazione?.percorso === scheda.loghi.stazione?.percorso);
    const senzaCliente: SchedaCopertina = { ...scheda, loghi: { ...scheda.loghi, cliente: null } };
    const rimesso = applicaPiano({ scheda: senzaCliente, piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, rimetti: true } } }), allegato: null, origine: ORIGINE, riserva });
    const rimessoAltrove = applicaPiano({ scheda: senzaCliente, piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, rimetti: true, posizione: "alto-destra" } } }), allegato: null, origine: ORIGINE, riserva });
    atteso("un logo tolto per errore si rimette: dov'era all'inizio, o dove chiede il cliente", rimesso.loghi.cliente?.percorso === `${ACCOUNT}/logo.png` && rimesso.loghi.cliente?.posizione === "basso-destra" && rimessoAltrove.loghi.cliente?.posizione === "alto-destra");
    const senzaRiserva = applicaPiano({ scheda: senzaCliente, piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, rimetti: true } } }), allegato: null, origine: ORIGINE });
    const presente = applicaPiano({ scheda, piano: piano({ loghi: { stazione: { ...fermo }, cliente: { ...fermo, rimetti: true, togli: true } } }), allegato: null, origine: ORIGINE, riserva: conAllegati });
    atteso("senza un logo da rimettere resta assente; «rimetti» non sostituisce un logo che c'è già e vince su «togli»", senzaRiserva.loghi.cliente === null && presente.loghi.cliente?.percorso === `${ACCOUNT}/logo.png`);
    atteso("una copertina che resterebbe uguale non si prepara (non consuma); basta un logo spostato, tolto o un ritocco per prepararla", pianoSenzaEffetti(piano(), scheda, applicaPiano({ scheda, piano: piano(), allegato: null, origine: ORIGINE })) && !pianoSenzaEffetti(spostaCliente, scheda, applicaPiano({ scheda, piano: spostaCliente, allegato: null, origine: ORIGINE })) && !pianoSenzaEffetti(piano({ istruzioniImmagine: "più blu" }), scheda, scheda) && !pianoSenzaEffetti(piano(), scheda, senzaCliente));
  }

  console.log("--- Il piano applicato alla scheda ---");
  {
    const testi = applicaPiano({ scheda, piano: piano({ titoloPrincipale: "OFFERTA TECNICA", cig: "" }), allegato: null, origine: ORIGINE });
    atteso("testi nuovi applicati, CIG tolto, il resto invariato, origine registrata", testi.testi.titoloPrincipale === "OFFERTA TECNICA" && testi.testi.titolo === scheda.testi.titolo && testi.testi.cig === null && testi.origine === ORIGINE && testi.stile === "stilizzato");
    const sposta = applicaPiano({ scheda, piano: piano({ loghi: { stazione: { posizione: "invariata", dimensione: "invariata", togli: true }, cliente: { posizione: "alto-destra", dimensione: "grande", togli: false } } }), allegato: null, origine: ORIGINE });
    atteso("loghi: uno tolto, l'altro spostato e ingrandito (con lo stesso file)", sposta.loghi.stazione === null && sposta.loghi.cliente?.posizione === "alto-destra" && sposta.loghi.cliente?.dimensione === "grande" && sposta.loghi.cliente?.percorso === `${ACCOUNT}/logo.png`);
    const allegato = applicaPiano({ scheda, piano: piano({ loghi: { stazione: { posizione: "invariata", dimensione: "invariata", togli: false }, cliente: { posizione: "invariata", dimensione: "invariata", togli: true } } }), allegato: { per: "cliente", percorso: `${GARA}/copertina-allegato-20261113T100000Z.png` }, origine: ORIGINE });
    atteso("logo allegato: sostituisce quello indicato nello stesso posto, e vince anche su un «togli»", allegato.loghi.cliente?.bucket === "gare" && allegato.loghi.cliente?.percorso === `${GARA}/copertina-allegato-20261113T100000Z.png` && allegato.loghi.cliente?.posizione === "basso-destra");
    const senzaStazione: SchedaCopertina = { ...scheda, loghi: { ...scheda.loghi, stazione: null } };
    const nuovoStazione = applicaPiano({ scheda: senzaStazione, piano: piano(), allegato: { per: "stazione", percorso: `${GARA}/copertina-allegato-x.png` }, origine: ORIGINE });
    atteso("logo allegato per un logo che non c'era: va nella sua posizione di sempre, medio", nuovoStazione.loghi.stazione?.posizione === "alto-sinistra" && nuovoStazione.loghi.stazione?.dimensione === "medio");
    atteso("serve il ritocco del modello solo se cambiano sfondo o testi; per i loghi no (li applica il codice)", serveRitocco(piano({ istruzioniImmagine: "più blu" }), scheda, scheda) && serveRitocco(piano(), scheda, testi) && !serveRitocco(piano(), scheda, sposta));
    const p = promptRitocco({ piano: piano({ istruzioniImmagine: "Sfondo in toni blu più scuri" }), prima: scheda, dopo: testi });
    atteso(
      "il comando di ritocco: cambia solo il richiesto, lascia IDENTICO il resto, scrive i testi nuovi esattamente, nessun logo né riquadro, spazi dei loghi liberi",
      /lascia IDENTICO tutto il resto/.test(p) && /Sfondo in toni blu più scuri/.test(p) && /AL CENTRO SCRIVI: OFFERTA TECNICA/.test(p) && /SOTTO SEMPRE AL CENTRO SCRIVI: Servizio di pulizia degli edifici comunali\n/.test(p) && /Non disegnare NESSUN logo/.test(p) && /in alto a sinistra \(circa dal 8% al 44% della larghezza/.test(p),
    );
    const senzaTesti = promptRitocco({ piano: piano({ istruzioniImmagine: "più luce" }), prima: scheda, dopo: scheda });
    atteso("se i testi non cambiano il ritocco li deve lasciare lettera per lettera", /I testi della copertina restano esattamente quelli attuali/.test(senzaTesti) && !/AL CENTRO SCRIVI/.test(senzaTesti));
  }

  console.log("--- La scheda salvata ---");
  {
    const json = JSON.parse(JSON.stringify(scheda));
    atteso("una scheda valida si rilegge identica", JSON.stringify(schedaDaJson(json, GARA, ACCOUNT)) === JSON.stringify(scheda));
    atteso("versione sconosciuta o dati mancanti: nessuna scheda (copertina non modificabile)", schedaDaJson({ ...json, versione: 2 }, GARA, ACCOUNT) === null && schedaDaJson({ ...json, testi: { titolo: "" } }, GARA, ACCOUNT) === null && schedaDaJson(null, GARA, ACCOUNT) === null);
    const altrui = schedaDaJson({ ...json, loghi: { stazione: { ...json.loghi.stazione, percorso: "bbbbbbbb-1111-4111-8111-111111111111/logo.png" }, cliente: { ...json.loghi.cliente, percorso: `${ACCOUNT}/../altro/logo.png` } } }, GARA, ACCOUNT);
    atteso("un logo di un'altra gara o con un percorso che risale non si usa", altrui !== null && altrui.loghi.stazione === null && altrui.loghi.cliente === null);
    atteso("il logo del cliente solo dalla cartella del suo account, quello della stazione solo dalla cartella della gara", percorsoLogoAmmesso({ bucket: "company-assets", percorso: `${ACCOUNT}/logo.png` }, GARA, ACCOUNT) && !percorsoLogoAmmesso({ bucket: "company-assets", percorso: `${GARA}/logo.png` }, GARA, ACCOUNT) && !percorsoLogoAmmesso({ bucket: "gare", percorso: `${ACCOUNT}/logo.png` }, GARA, ACCOUNT));
  }

  console.log("--- Nomi dei file e numerazione ---");
  {
    const nomi = [
      "copertina-20261112T120000Z-stilizzato.png", "copertina-20261112T120000Z-stilizzato.pdf",
      "copertina-20261113T090000Z-stilizzato.png", "copertina-20261113T090000Z-stilizzato.pdf", "copertina-20261113T090000Z-stilizzato-base.png", "copertina-20261113T090000Z-stilizzato-mini.jpg", "copertina-20261113T090000Z-stilizzato.json",
      "copertina-20261113T091500Z-realistico.png", "copertina-20261113T091500Z-realistico.pdf",
      "copertina-20261113T100000Z-stilizzato-modifica.png", "copertina-20261113T100000Z-stilizzato-modifica.pdf", "copertina-20261113T100000Z-stilizzato-modifica-base.png", "copertina-20261113T100000Z-stilizzato-modifica.json",
      "copertina-allegato-20261113T095900Z.png",
    ];
    const elenco = copertineDaNomi(nomi);
    atteso("l'elenco ha solo le copertine (anche le modificate): niente pagine senza loghi, miniature, schede o loghi allegati", elenco.length === 4 && elenco.every((c) => !/-base|-mini|\.json|allegato/.test(c.png)) && elenco[0].modifica && elenco[0].id === "copertina-20261113T100000Z-stilizzato-modifica");
    const numeri = numeriCopertine(elenco);
    atteso("numerazione in ordine di creazione, le modificate continuano: N.1 la più vecchia, N.4 la modificata", numeri.get("copertina-20261112T120000Z-stilizzato") === 1 && numeri.get("copertina-20261113T090000Z-stilizzato") === 2 && numeri.get("copertina-20261113T091500Z-realistico") === 3 && numeri.get("copertina-20261113T100000Z-stilizzato-modifica") === 4);
    const conUnaNuova = numeriCopertine(copertineDaNomi([...nomi, "copertina-20261113T110000Z-realistico.png"]));
    atteso("una copertina nuova non cambia il numero di quelle che c'erano", [...numeri.entries()].every(([id, n]) => conUnaNuova.get(id) === n) && conUnaNuova.get("copertina-20261113T110000Z-realistico") === 5);
    atteso("etichetta «COPERTINA N.x»", etichettaNumero(3) === "COPERTINA N.3");
    atteso("i file di una copertina: PNG, PDF, pagina senza loghi, miniatura, scheda", JSON.stringify(fileCopertina("copertina-20261113T090000Z-stilizzato")) === JSON.stringify({ png: "copertina-20261113T090000Z-stilizzato.png", pdf: "copertina-20261113T090000Z-stilizzato.pdf", base: "copertina-20261113T090000Z-stilizzato-base.png", mini: "copertina-20261113T090000Z-stilizzato-mini.jpg", scheda: "copertina-20261113T090000Z-stilizzato.json" }));
    atteso("identificativo di copertina: solo nella forma giusta (lo sceglie il browser)", idCopertinaValido("copertina-20261113T090000Z-stilizzato") && idCopertinaValido("copertina-20261113T090000Z-realistico-modifica") && !idCopertinaValido("copertina-20261113T090000Z-stilizzato-base") && !idCopertinaValido("../copertina-20261113T090000Z-stilizzato") && !idCopertinaValido(5));
    atteso(
      "si scaricano le copertine (anche le modificate), non i file interni",
      percorsoCopertinaValido(GARA, "copertina-20261113T100000Z-stilizzato-modifica.pdf") && !percorsoCopertinaValido(GARA, "copertina-20261113T090000Z-stilizzato-base.png") && !percorsoCopertinaValido(GARA, "copertina-20261113T090000Z-stilizzato.json") && !percorsoCopertinaValido(GARA, "copertina-allegato-20261113T095900Z.png"),
    );
    atteso("il file scaricato porta il numero", nomeFileScaricato("Gara pulizie", "pdf", "realistico", 3) === "Copertina N.3 relazione tecnica (realistico) - Gara pulizie.pdf" && nomeFileScaricato("Gara pulizie", "pdf", "realistico") === "Copertina relazione tecnica (realistico) - Gara pulizie.pdf");
  }

  console.log("--- Dove vanno i loghi ---");
  {
    const s = zonaPer("alto-sinistra"), c = zonaPer("basso-destra");
    atteso("le posizioni di sempre (medie) coincidono con le zone di prima", Math.abs(s.x - ZONA_STAZIONE.x) < 1e-9 && Math.abs(s.y - ZONA_STAZIONE.y) < 1e-9 && Math.abs(c.x - ZONA_CLIENTE.x) < 1e-9 && Math.abs(c.y - ZONA_CLIENTE.y) < 1e-9);
    const tutte = (["alto-sinistra", "alto-centro", "alto-destra", "basso-sinistra", "basso-centro", "basso-destra"] as const).flatMap((p) => (["piccolo", "medio", "grande"] as const).map((d) => zonaPer(p, d)));
    atteso("tutte le 18 combinazioni stanno dentro i margini (8% ai lati, 6% in alto, 8% in basso) e fuori dalla fascia dei testi (30–70%)", tutte.every((z) => z.x >= 0.08 - 1e-9 && z.x + z.larghezza <= 0.92 + 1e-9 && z.y >= 0.06 - 1e-9 && z.y + z.altezza <= 0.92 + 1e-9 && (z.y + z.altezza <= 0.3 || z.y >= 0.7)));
    const centro = rettangoloLogo(zonaPer("alto-centro"), W, H, 100, 100);
    atteso("al centro il logo è centrato", Math.abs(centro.left + centro.width / 2 - W / 2) <= 1);
    atteso("grande è più grande di medio, piccolo più piccolo", zonaPer("basso-destra", "grande").larghezza > c.larghezza && zonaPer("basso-destra", "piccolo").larghezza < c.larghezza);
    const insieme = zoneDeiLoghi({ stazione: { posizione: "alto-destra", dimensione: "medio" }, cliente: { posizione: "alto-destra", dimensione: "medio" } }, true);
    atteso("due loghi nello stesso punto si affiancano senza sovrapporsi", insieme.stazione.x + insieme.stazione.larghezza <= insieme.cliente.x + 1e-9 && JSON.stringify(insieme.cliente) === JSON.stringify(metaZona(zonaPer("alto-destra"), "destra")));
    atteso("senza indicazioni le zone sono esattamente quelle di sempre", JSON.stringify(zoneDeiLoghi({}, true)) === JSON.stringify({ stazione: ZONA_STAZIONE, cliente: ZONA_CLIENTE }));
  }

  console.log("--- La modifica (OpenAI e storage finti) ---");
  {
    const basePagina = await pngPieno(W, H, { r: 230, g: 232, b: 236 });
    const ritoccata = await pngPieno(W, H, { r: 20, g: 40, b: 120 });
    const caricati: { percorso: string; corpo: Buffer; tipo?: string }[] = [];
    let baseEsiste = true;
    const admin = {
      storage: {
        from: () => ({
          download: async (p: string) => (baseEsiste && p === `${GARA}/${fileCopertina(ORIGINE).base}` ? { data: new Blob([new Uint8Array(basePagina)]), error: null } : { data: null, error: { message: "non trovato" } }),
          upload: async (percorso: string, corpo: Buffer, opzioni?: { contentType?: string }) => {
            caricati.push({ percorso, corpo, tipo: opzioni?.contentType });
            return { error: null };
          },
          remove: async () => ({ error: null }),
        }),
      },
    };
    const loghiFinti: Record<string, Buffer> = { [`${GARA}/logo-stazione.png`]: await logoTrasparente({ r: 204, g: 0, b: 0 }), [`${ACCOUNT}/logo.png`]: await logoTrasparente({ r: 0, g: 170, b: 0 }) };
    const ritocchi: { prompt: string; base: Buffer }[] = [];
    const usi: Record<string, unknown>[] = [];
    const comuni = {
      garaId: GARA,
      accountId: ACCOUNT,
      origine: ORIGINE,
      prima: scheda,
      admin: admin as never,
      adesso: new Date("2026-11-13T10:05:00Z"),
      leggiLogoFn: (async (_b: string, p: string | null) => (p && loghiFinti[p] ? { png: loghiFinti[p] } : undefined)) as never,
      ritocca: (async (p: { prompt: string; base: Buffer }) => {
        ritocchi.push(p);
        return { immagine: ritoccata, uso: { inputTokens: 3000, outputTokens: 2264 } };
      }) as never,
      registraUso: (async (u: Record<string, unknown>) => {
        usi.push(u);
      }) as never,
    };
    const chiave = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "chiave-finta";

    // 1) solo i loghi: il cliente in alto a destra, grande; nessun modello, nessun costo
    const pianoLoghi = piano({ loghi: { stazione: { posizione: "invariata", dimensione: "invariata", togli: false }, cliente: { posizione: "alto-destra", dimensione: "grande", togli: false } } });
    const dopoLoghi = applicaPiano({ scheda, piano: pianoLoghi, allegato: null, origine: ORIGINE });
    const soloLoghi = await modificaCopertina({ ...comuni, dopo: dopoLoghi, piano: pianoLoghi });
    atteso("spostare un logo: niente ritocco del modello e nessun costo d'immagine", soloLoghi.ok && !soloLoghi.ritoccata && ritocchi.length === 0 && usi.length === 0);
    atteso("la copertina nuova si salva come «-modifica» con tutti i suoi file (PNG, PDF, pagina senza loghi, miniatura, scheda)", soloLoghi.ok && soloLoghi.id === "copertina-20261113T100500Z-stilizzato-modifica" && caricati.map((c) => c.percorso.split("/")[1]).join() === "copertina-20261113T100500Z-stilizzato-modifica.png,copertina-20261113T100500Z-stilizzato-modifica.pdf,copertina-20261113T100500Z-stilizzato-modifica-base.png,copertina-20261113T100500Z-stilizzato-modifica-mini.jpg,copertina-20261113T100500Z-stilizzato-modifica.json");
    const png = caricati[0].corpo;
    const nuovo = rettangoloLogo(zonaPer("alto-destra", "grande"), W, H, 40, 30);
    const vecchio = rettangoloLogo(ZONA_CLIENTE, W, H, 40, 30);
    const st = rettangoloLogo(ZONA_STAZIONE, W, H, 40, 30);
    const [alNuovo, alVecchio, allaStazione] = await Promise.all([pixel(png, nuovo.left + nuovo.width / 2, nuovo.top + nuovo.height / 2), pixel(png, vecchio.left + vecchio.width / 2, vecchio.top + vecchio.height / 2), pixel(png, st.left + st.width / 2, st.top + st.height / 2)]);
    atteso("il logo del cliente è nel posto nuovo (in alto a destra), non più in basso a destra; quello della stazione resta dov'era", alNuovo === "0,170,0" && alVecchio === "230,232,236" && allaStazione === "204,0,0", `${alNuovo} ${alVecchio} ${allaStazione}`);
    const schedaNuova = schedaDaJson(JSON.parse(String(caricati[4].corpo)), GARA, ACCOUNT);
    atteso("la scheda della copertina nuova dice il nuovo posto del logo e da quale copertina nasce (si può modificare a sua volta)", schedaNuova?.loghi.cliente?.posizione === "alto-destra" && schedaNuova?.loghi.cliente?.dimensione === "grande" && schedaNuova?.origine === ORIGINE);
    atteso("la pagina senza loghi salvata è senza loghi", (await pixel(caricati[2].corpo, nuovo.left + nuovo.width / 2, nuovo.top + nuovo.height / 2)) === "230,232,236");

    // 2) sfondo e testi: il modello ritocca la pagina SENZA loghi; il costo si registra; i loghi si riapplicano originali
    caricati.length = 0;
    const pianoSfondo = piano({ istruzioniImmagine: "Sfondo in toni blu scuri", sottotitolo: "Servizio di pulizia - Lotto 2" });
    const dopoSfondo = applicaPiano({ scheda, piano: pianoSfondo, allegato: null, origine: ORIGINE });
    const sfondo = await modificaCopertina({ ...comuni, dopo: dopoSfondo, piano: pianoSfondo, adesso: new Date("2026-11-13T10:10:00Z") });
    atteso("sfondo/testi: il modello ritocca partendo dalla pagina SENZA loghi, con il comando di ritocco", sfondo.ok && sfondo.ritoccata && ritocchi.length === 1 && Buffer.compare(ritocchi[0].base, basePagina) === 0 && /Sfondo in toni blu scuri/.test(ritocchi[0].prompt) && /Servizio di pulizia - Lotto 2 - CIG: B1C2D3E4F5/.test(ritocchi[0].prompt));
    atteso("il costo del ritocco si registra (operazione «copertina_relazione_modifica», OpenAI)", usi.length === 1 && /copertina_relazione_modifica$/.test(String(usi[0].operazione)) && usi[0].provider === "openai" && usi[0].inputTokens === 3000);
    const [fondoRitoccato, logoStazione] = await Promise.all([pixel(caricati[0].corpo, 792, 300), pixel(caricati[0].corpo, st.left + st.width / 2, st.top + st.height / 2)]);
    atteso("la copertina nuova è la pagina ritoccata con i loghi originali sopra", fondoRitoccato === "20,40,120" && logoStazione === "204,0,0", `${fondoRitoccato} ${logoStazione}`);

    // 3) errori
    baseEsiste = false;
    const senzaBase = await modificaCopertina({ ...comuni, dopo: dopoLoghi, piano: pianoLoghi });
    atteso("copertina senza pagina senza loghi (fatta prima): errore chiaro, nessun file", !senzaBase.ok && /non si può modificare/.test(senzaBase.errore));
    baseEsiste = true;
    caricati.length = 0;
    const rifiutata = await modificaCopertina({ ...comuni, dopo: dopoSfondo, piano: pianoSfondo, ritocca: (async () => { throw new ErroreOpenAI("OpenAI ha rifiutato la richiesta (401): chiave", 401); }) as never });
    atteso("ritocco rifiutato da OpenAI (chiave): messaggio «non configurato», nessun file salvato", !rifiutata.ok && /non è configurato correttamente/.test(rifiutata.errore) && caricati.length === 0);
    delete process.env.OPENAI_API_KEY;
    const senzaChiave = await modificaCopertina({ ...comuni, dopo: dopoSfondo, piano: pianoSfondo });
    const senzaChiaveLoghi = await modificaCopertina({ ...comuni, dopo: dopoLoghi, piano: pianoLoghi });
    atteso("senza la chiave di OpenAI: il ritocco non parte, ma spostare un logo funziona lo stesso", !senzaChiave.ok && /chiave di OpenAI/.test(senzaChiave.errore) && senzaChiaveLoghi.ok);
    if (chiave === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = chiave;
  }

  console.log("--- I link alle copertine intere (storage finto) ---");
  {
    let chiesti: string[] = [];
    let durata = 0;
    const storage = (risposta: { data: { signedUrl: string | null }[] | null; error: unknown }) =>
      ({
        storage: {
          from: (bucket: string) => ({
            createSignedUrls: async (percorsi: string[], secondi: number) => {
              chiesti = percorsi.map((x) => `${bucket}:${x}`);
              durata = secondi;
              return risposta;
            },
          }),
        },
      }) as unknown as Parameters<typeof linkCopertineIntere>[0];
    const copertineFinte = [
      { id: "copertina-20261113T120000Z-stilizzato", png: "copertina-20261113T120000Z-stilizzato.png" },
      { id: "copertina-20261113T121000Z-realistico", png: "copertina-20261113T121000Z-realistico.png" },
    ];
    const link = await linkCopertineIntere(storage({ data: [{ signedUrl: "https://x/1" }, { signedUrl: "https://x/2" }], error: null }), GARA, copertineFinte);
    atteso("una sola richiesta per tutte, nella cartella della gara del bucket «gare», per un'ora; ogni link alla sua copertina", chiesti.length === 2 && chiesti[0] === `gare:${GARA}/copertina-20261113T120000Z-stilizzato.png` && durata === 3600 && link.get(copertineFinte[0].id) === "https://x/1" && link.get(copertineFinte[1].id) === "https://x/2");
    const conBuco = await linkCopertineIntere(storage({ data: [{ signedUrl: null }, { signedUrl: "https://x/2" }], error: null }), GARA, copertineFinte);
    atteso("un link mancante resta senza (non prende quello di un'altra copertina)", !conBuco.has(copertineFinte[0].id) && conBuco.get(copertineFinte[1].id) === "https://x/2");
    chiesti = [];
    const vuoto = await linkCopertineIntere(storage({ data: [], error: null }), GARA, []);
    const errore = await linkCopertineIntere(storage({ data: null, error: { message: "giù" } }), GARA, copertineFinte);
    atteso("nessuna copertina: nessuna richiesta; storage in errore: nessun link (la pagina mostra comunque la griglia)", vuoto.size === 0 && errore.size === 0);
  }

  console.log("--- L'interprete (OpenAI finto) ---");
  {
    let corpoInviato: Record<string, unknown> = {};
    const fetchFinto = (async (_url: string, init: { body: string }) => {
      corpoInviato = JSON.parse(init.body);
      const risposta = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ esito: "risposta", messaggio: "Quale colore preferisci?", istruzioni_immagine: "", titolo_principale: null, sottotitolo: null, cig: null, logo_stazione: { posizione: "invariata", dimensione: "invariata", togli: false }, logo_cliente: { posizione: "invariata", dimensione: "invariata", togli: false } }) }] }], usage: { input_tokens: 900, output_tokens: 120 } };
      return new Response(JSON.stringify(risposta), { status: 200 });
    }) as unknown as typeof fetch;
    const esito = await interpretaRichiesta({ scheda, numero: 2, richiesta: "cambia colore", allegatoPer: null, apiKey: "k", fetchFn: fetchFinto });
    const formato = (corpoInviato.text as { format?: { type?: string; strict?: boolean; schema?: unknown } })?.format;
    const testoInviato = () => String(((corpoInviato.input as { content: { text: string }[] }[])?.[0]?.content?.[0]?.text) ?? "");
    atteso("senza contesto l'interprete riceve comunque «CHI È CHI» (nomi non indicati)", /CHI È CHI/.test(testoInviato()) && /nome non indicato/.test(testoInviato()));
    await interpretaRichiesta({ scheda, numero: 2, richiesta: "sposta il logo", allegatoPer: null, contesto: { nomi: { stazione: "Comune di Aosta", cliente: "Pulizie Rossi" }, storia: [{ ruolo: "cliente", testo: "metti il nostro logo in alto", numeroSu: 1, numeroConsegnata: null, conAllegato: null }], partenza: null }, apiKey: "k", fetchFn: fetchFinto });
    atteso("con il contesto l'interprete riceve i nomi e la conversazione", /«Comune di Aosta»/.test(testoInviato()) && /«Pulizie Rossi»/.test(testoInviato()) && /CLIENTE \(su COPERTINA N\.1\): metti il nostro logo in alto/.test(testoInviato()));
    atteso("l'interprete ragiona «medium» (con «low» le correzioni dimenticavano la richiesta vera)", JSON.stringify(corpoInviato.reasoning) === JSON.stringify({ effort: "medium" }));
    atteso("l'interprete usa le istruzioni della chat e la risposta vincolata allo schema (rigido)", typeof corpoInviato.instructions === "string" && /I LOGHI NON SI DISEGNANO/.test(String(corpoInviato.instructions)) && formato?.type === "json_schema" && formato?.strict === true && JSON.stringify(formato?.schema) === JSON.stringify(SCHEMA_RICHIESTA));
    atteso("una domanda dell'interprete torna come piano «risposta» (non consuma nulla), con l'uso dei token", esito.piano?.esito === "risposta" && esito.piano?.messaggio === "Quale colore preferisci?" && esito.uso.inputTokens === 900);
  }

  console.log("--- L'azione del server ---");
  {
    const azione = leggi("src/app/actions/gara-copertina.ts");
    const corpo = azione.slice(azione.indexOf("export async function inviaRichiestaCopertina("));
    const prima = (a: string, b: string) => corpo.indexOf(a) > -1 && corpo.indexOf(b) > -1 && corpo.indexOf(a) < corpo.indexOf(b);
    atteso("guardie per prime: account, sola lettura, gara, copertina scelta, testo, allegato (tipo, misura, quale logo)", prima("richiediAccountAzione()", "accessoNegatoPerAccount(") && prima("accessoNegatoPerAccount(", "idCopertinaValido(origine)") && /RICHIESTA_MASSIMA/.test(corpo) && /TIPI_ALLEGATO\[file\.type\]/.test(corpo) && /ALLEGATO_MASSIMO_BYTE/.test(corpo) && /per !== "stazione" && per !== "cliente"/.test(corpo));
    atteso("la copertina dal browser vale SOLO per il primo messaggio: poi si lavora sempre sull'ultima versione di quella scelta, decisa dalla chat", /const lavoro = copertinaDiLavoro\(chat\.righe\);/.test(corpo) && /const origine = lavoro \? lavoro\.ultima : sceltaDalBrowser;/.test(corpo) && prima("copertinaDiLavoro(chat.righe)", "nomiFileCopertine(admin, garaId)") && prima("copertinaDiLavoro(chat.righe)", "salvaMessaggioCliente("));
    atteso("all'interprete l'azione passa chi è chi (stazione appaltante della gara, ragione sociale del cliente), la conversazione e la copertina di partenza", /\.select\("id, titolo, stazione_appaltante, amministrazione_committente"\)/.test(corpo) && /from\("companies"\)\.select\("ragione_sociale"\)\.eq\("user_id", contesto\.accountId\)/.test(corpo) && /nomi: \{ stazione: gara\.stazione_appaltante \?\? gara\.amministrazione_committente \?\? schedaPartenza\?\.ente \?\? scheda\.ente \?\? null, cliente: azienda\?\.ragione_sociale \?\? null \}/.test(corpo) && /titoloGara: gara\.titolo/.test(corpo) && /storia: storiaPerInterprete\(chat\.righe, numeri, new Map\(schedeConsegnate\)\)/.test(corpo) && /r\.ruolo === "assistente" && r\.stato === "pronta" && r\.copertina && idCopertinaValido\(r\.copertina\)/.test(corpo) && /const schedaPrecedente = scheda\.origine \? \(scheda\.origine === sceltaIniziale \? schedaPartenza : \(new Map\(schedeConsegnate\)\.get\(scheda\.origine\) \?\? null\)\) : null;/.test(corpo) && /precedente: schedaPrecedente && scheda\.origine \? \{ numero: numeri\.get\(scheda\.origine\) \?\? null, scheda: schedaPrecedente \} : null/.test(corpo) && /const sceltaIniziale = lavoro \? lavoro\.scelta : origine;/.test(corpo) && /contesto: contestoInterprete, apiKey/.test(corpo));
    atteso("il piano passa dai controlli del codice PRIMA di consumare: domanda se il logo nominato non è quello toccato, niente copertina se resterebbe uguale", prima("verificaPiano(", "riservaModifica(") && /if \(verificato\.domanda\) return rispondi\(verificato\.domanda\);/.test(corpo) && prima("verificaPiano(", 'piano.esito === "risposta"') && prima("pianoSenzaEffetti(", "riservaModifica(") && /if \(!allegato && pianoSenzaEffetti\(piano, scheda, dopo\)\) return rispondi\(MESSAGGIO_SENZA_EFFETTI\);/.test(corpo) && /riserva: loghiDiRiserva\(chat\.righe, schedaPartenza, garaId, schedaPrecedente\)/.test(corpo));
    atteso("prima di qualsiasi chiamata a OpenAI: chat aperta, modifiche rimaste, tetto, diritto (senza il limite per stile), nessuna modifica in corso", prima("statoChat(", "interpretaRichiesta(") && /perStile: \{ stilizzato: 0, realistico: 0 \}/.test(corpo) && /if \(!stato\.puoScrivere\) return/.test(corpo));
    atteso("la copertina scelta deve avere pagina senza loghi e scheda (altrimenti non è modificabile), prima di interpretare", prima("fileOrigine.base", "interpretaRichiesta(") && prima("leggiSchedaCopertina(", "interpretaRichiesta("));
    atteso("il logo allegato si controlla (immagine leggibile) e si salva nella cartella della gara, mai sopra un file esistente", /preparaLogo\(contenuto\)/.test(corpo) && /`\$\{garaId\}\/copertina-allegato-/.test(corpo) && /upsert: false/.test(corpo));
    atteso("il messaggio del cliente si registra prima dell'interpretazione; il costo della lettura si registra («copertina_relazione_chat»)", prima("salvaMessaggioCliente(", "interpretaRichiesta(") && /operazionePerRegistro\("copertina_relazione_chat"\)/.test(corpo));
    atteso("una domanda o una richiesta da chiarire: si risponde senza preparare copertine (non consuma)", /if \(piano\.esito === "risposta" && !allegato\) return rispondi\(piano\.messaggio\)/.test(corpo) && prima('piano.esito === "risposta"', "riservaModifica("));
    atteso("la copertina nuova: registrata in preparazione PRIMA di farla, poi consegnata o annullata (un errore non consuma)", prima("riservaModifica(", "modificaCopertina(") && /annullaModifica\(admin, riserva\)/.test(corpo) && /completaModifica\(admin, riserva, \{ testo: \[piano\.messaggio, \.\.\.esito\.avvisi\]\.join\(" "\), copertina: esito\.id \}\)/.test(corpo) && /revalidatePath\(`\/dashboard\/omnia-ai\/gare\/\$\{garaId\}`\)/.test(corpo));
    atteso("lo scaricamento mette il numero nel nome del file", /numeriCopertine\(copertineDaNomi\(await nomiFileCopertine\(admin, garaId\)\)\)/.test(azione) && /nomeFileScaricato\(gara\.titolo, estensione, stileDaNomeFile\(nomeFile\) \?\? undefined, numero\)/.test(azione));
  }

  console.log("--- Pagina, pannello, migrazione, console ---");
  {
    const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/page.tsx");
    atteso("la pagina mostra TUTTE le copertine, numerate, con la miniatura quando c'è", !/elencoCopertine\.slice\(0, 8\)/.test(pagina) && /numero: numeriCop\.get\(c\.id\)/.test(pagina) && /linkMiniature\(/.test(pagina) && /modificabile: \[fileCopertina\(c\.id\)\.base, fileCopertina\(c\.id\)\.scheda\]/.test(pagina));
    atteso("la pagina passa alla chat se la scelta è già fatta, la copertina di lavoro (l'ultima versione) e il numero di quella scelta", /const lavoroChat = copertinaDiLavoro\(chatCopertina\.righe\);/.test(pagina) && /sceltaFatta: lavoroChat !== null/.test(pagina) && /lavoro: lavoroChat \? \(perId\.get\(lavoroChat\.ultima\) \?\? null\) : null/.test(pagina) && /numeroSceltaIniziale: lavoroChat \? \(numeriCop\.get\(lavoroChat\.scelta\) \?\? null\) : null/.test(pagina));
    atteso("la chat compare solo con la tabella (0108) e dopo le 6 generazioni (o se ha già messaggi)", /chatCopertina\.disponibile && !chatCopertina\.errore/.test(pagina) && /if \(aperta \|\| chatCopertina\.righe\.length > 0\)/.test(pagina) && /chatAperta\(ctxCopertina\.uso\)/.test(pagina));
    const pannello = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-panel.tsx");
    const galleria = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertine-galleria.tsx");
    atteso("ogni copertina ha la sua etichetta «COPERTINA N.x» (e «modificata in chat» se lo è)", /<strong>\{etichettaNumero\(x\.numero\)\}<\/strong>/.test(galleria) && /modificata in chat/.test(galleria) && /\{chat && <CopertinaChat garaId=\{garaId\} chat=\{chat\} \/>\}/.test(pannello));
    atteso("le copertine stanno in una griglia di miniature (non più una colonna con le più recenti in grande)", /<CopertineGalleria garaId=\{garaId\} copertine=\{copertine\} \/>/.test(pannello) && !/width: ultima \? 240 : 130/.test(pannello) && /<ul className="omnia-copertine-griglia">/.test(galleria) && /copertine\.map\(\(x, i\) =>/.test(galleria) && /Le tue copertine \(\{copertine\.length\}\)/.test(galleria));
    atteso("ogni miniatura è un pulsante con la lente: un clic apre l'anteprima grande; ogni copertina si scarica in PDF e PNG", /className="omnia-copertina-miniatura" onClick=\{\(\) => apri\(i\)\} aria-label=\{`Ingrandisci la \$\{etichetta\}`\}/.test(galleria) && /className="omnia-copertina-lente"/.test(galleria) && /<Lente misura=\{22\} \/>/.test(galleria) && /<Scarica garaId=\{garaId\} c=\{x\} grandi=\{false\} \/>/.test(galleria) && /nomeFile: c\.nomePdf/.test(galleria) && /nomeFile: c\.nomePng/.test(galleria) && /action=\{scaricaCopertinaGara\}/.test(galleria));
    atteso(
      "l'anteprima grande: sopra a tutto (sul body), finestra di dialogo, PNG intero (la miniatura sotto finché arriva), pulsanti per scaricarla, frecce, ✕",
      /createPortal\(/.test(galleria) && /document\.body,\n\s*\)\}/.test(galleria) && /role="dialog"/.test(galleria) && /aria-modal="true"/.test(galleria) && /src=\{c\.grandeUrl \?\? c\.anteprimaUrl \?\? ""\}/.test(galleria) && /backgroundImage: `url\("\$\{c\.anteprimaUrl\}"\)`/.test(galleria) && /<Scarica garaId=\{garaId\} c=\{c\} grandi \/>/.test(galleria) && /aria-label="Copertina precedente"/.test(galleria) && /aria-label="Copertina successiva"/.test(galleria) && /aria-label="Chiudi l'anteprima"/.test(galleria),
    );
    atteso(
      "l'anteprima grande si chiude con Esc, la ✕ o un clic fuori dall'immagine; le frecce scorrono (girando); la pagina sotto resta ferma e il fuoco torna alla miniatura",
      /if \(e\.key === "Escape"\) chiudi\(\);/.test(galleria) && /else if \(e\.key === "ArrowLeft"\) vai\(-1\);/.test(galleria) && /else if \(e\.key === "ArrowRight"\) vai\(1\);/.test(galleria) && /if \(e\.target === e\.currentTarget\) chiudi\(\);/.test(galleria) && /\(i \+ passo \+ copertine\.length\) % copertine\.length/.test(galleria) && /document\.body\.style\.overflow = "hidden";/.test(galleria) && /document\.body\.style\.overflow = overflowPrima;/.test(galleria) && /window\.removeEventListener\("keydown", tasto\);/.test(galleria) && /daDove\.current\?\.focus\(\);/.test(galleria) && /\}, \[inVista, chiudi, vai\]\);/.test(galleria),
    );
    const stili = leggi("src/app/site-omnia-ai/omnia-ai.css");
    const regola = (selettore: string) => {
      const i = stili.indexOf(`${selettore} {`);
      return i < 0 ? "" : stili.slice(i, stili.indexOf("}", i));
    };
    atteso("griglia: miniature affiancate che si adattano alla larghezza (2 per riga al telefono, di più su schermo largo)", /grid-template-columns: repeat\(auto-fill, minmax\(132px, 1fr\)\)/.test(regola(".omnia-copertine-griglia")) && /cursor: zoom-in/.test(regola(".omnia-copertina-miniatura")));
    atteso("la lente compare al passaggio del mouse (e con la tastiera); senza mouse resta sempre visibile in un angolo", /opacity: 0/.test(regola(".omnia-copertina-lente")) && /\.omnia-copertina-miniatura:hover \.omnia-copertina-lente,\n\.omnia-copertina-miniatura:focus-visible \.omnia-copertina-lente \{\n  opacity: 1;/.test(stili) && /@media \(hover: none\) \{\n  \.omnia-copertina-lente \{\n    opacity: 1;/.test(stili));
    atteso("l'anteprima grande copre lo schermo sopra header e banner, con colori fissi (scura anche nel tema chiaro), e al telefono le frecce vanno in basso", /position: fixed/.test(regola(".omnia-lightbox")) && /inset: 0/.test(regola(".omnia-lightbox")) && /z-index: 1000/.test(regola(".omnia-lightbox")) && /background: rgba\(var\(--sovrapposto-rgb\), 0\.88\)/.test(regola(".omnia-lightbox")) && !/var\(--nero-rgb\)/.test(regola(".omnia-lightbox")) && ["sovrapposto-rgb", "su-sovrapposto", "carta", "inchiostro"].every((v) => { const valori = [...stili.matchAll(new RegExp(`--${v}: ([^;]+);`, "g"))].map((m) => m[1]); return valori.length === 2 && valori[0] === valori[1]; }) && /max-height: calc\(100vh - 150px\)/.test(regola(".omnia-lightbox-immagine")) && /@media \(max-width: 640px\) \{[\s\S]*?\.omnia-lightbox-freccia \{\n    top: auto;\n    bottom: 14px;/.test(stili));
    atteso("la pagina passa a ogni copertina il PNG intero per l'anteprima grande (una sola richiesta per tutte) e lo usa come miniatura se manca", /linkCopertineIntere\(adminCopertina, gara\.id, elencoCopertine\.map\(\(c\) => \(\{ id: c\.id, png: c\.png \}\)\)\)/.test(pagina) && /grandeUrl: intere\.get\(c\.id\) \?\? null/.test(pagina) && /anteprimaUrl: miniature\.get\(c\.id\) \?\? intere\.get\(c\.id\) \?\? null/.test(pagina) && !/linkCopertina\(adminCopertina/.test(pagina));
    const chat = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/gare/[id]/copertina-chat.tsx");
    atteso("la chat ha l'aspetto della «Chat con OMNIA AI»: intestazione col marchio, messaggi a fumetto, barra di scrittura con graffetta, Invio per inviare", /className="omnia-chat"/.test(chat) && /className="omnia-chat-intestazione"/.test(chat) && /<BrandMark /.test(chat) && /className="omnia-chat-corpo"/.test(chat) && /className="omnia-chat-input"/.test(chat) && /className="omnia-chat-riga"/.test(chat) && /className="omnia-chat-allegabutton"/.test(chat) && /e\.key === "Enter" && !e\.shiftKey/.test(chat) && /id="copertina-chat"/.test(chat));
    atteso("prima del primo messaggio si sceglie la copertina migliore (nessuna di base) e si avvisa che dopo non si cambia", /const \[scelta, setScelta\] = useState\(""\);/.test(chat) && /\{!sceltaFatta && scrivibile && \(/.test(chat) && /type="radio" name="sceltaCopertina" value=\{c\.id\}/.test(chat) && /dopo il primo messaggio non potrai più cambiarla/.test(chat));
    atteso("dopo la scelta: niente più flag, si vede «Stai modificando» la copertina di lavoro (l'ultima versione) e la richiesta va su quella", /const copertinaInUso = sceltaFatta \? lavoro : \(chat\.scelte\.find\(\(c\) => c\.id === scelta\) \?\? null\);/.test(chat) && /Stai modificando la <strong>\{etichettaNumero\(lavoro\.numero\)\}<\/strong>/.test(chat) && /<input type="hidden" name="copertina" value=\{copertinaInUso\?\.id \?\? ""\} \/>/.test(chat));
    atteso("la chat: testo, logo allegato con la graffetta (aggiunto all'invio) e «di chi è», copertine nuove rimaste", /name="richiesta"/.test(chat) && /accept="image\/png,image\/jpeg,image\/webp"/.test(chat) && /if \(logoRef\.current\) dati\.set\("allegato", logoRef\.current\);/.test(chat) && /name="allegatoPer"/.test(chat) && /<option value="cliente">/.test(chat) && /<option value="stazione">/.test(chat) && /copertine nuove rimaste/.test(chat));
    atteso("la chat: si invia solo con la copertina scelta e un testo; ogni copertina consegnata si scarica in PDF e PNG; a chat chiusa si vede il motivo e niente modulo", /const puoInviare = scrivibile && !pending && copertinaInUso !== null && testo\.trim\(\)\.length > 0;/.test(chat) && /disabled=\{!puoInviare\}/.test(chat) && /m\.copertina\.nomePdf/.test(chat) && /m\.copertina\.nomePng/.test(chat) && /\{!scrivibile && \(/.test(chat) && /\{scrivibile && \(\n\s*<form/.test(chat) && /const scrivibile = stato\.puoScrivere && !lavoroPerso && !nessunaScelta;/.test(chat));
    atteso("la chat: testo e logo restano in caso di errore e si svuotano solo quando la richiesta è andata a buon fine", /if \(esito\.ok\) \{\n\s*setTesto\(""\);\n\s*scegliLogo\(null\);/.test(chat) && /value=\{testo\}/.test(chat));
    atteso("nel testo iniziale, ben visibile: dopo le 6 generazioni si apre la chat sulla copertina migliore, fino a 3 nuove copertine in PNG e PDF", /className="omnia-copertina-avviso-chat"/.test(pannello) && /Al termine delle 6 generazioni potrai fare le tue modifiche in chat\./.test(pannello) && /sulla copertina che ritieni migliore/.test(pannello) && /fino a <strong>3 nuove copertine<\/strong>, in PNG e PDF/.test(pannello) && pannello.indexOf("3 generazioni per stile") < pannello.indexOf("omnia-copertina-avviso-chat") && /<a href="#copertina-chat">/.test(pannello));
    const migrazione = leggi("supabase/migrations/0108_copertine_chat.sql");
    const sql = migrazione.replace(/--.*$/gm, "");
    atteso("migrazione 0108: solo una tabella nuova (additiva), con i vincoli, accesso solo dal server", /create table if not exists public\.gara_copertine_chat/.test(sql) && !/alter table public\.(gare|gara_copertine|users)\b/.test(sql) && !/\bdrop\b/i.test(sql) && /enable row level security/.test(sql) && /grant select, insert, update, delete on public\.gara_copertine_chat to service_role/.test(sql) && !/to authenticated|to anon/.test(sql) && /notify pgrst/.test(sql));
    atteso("migrazione 0108: ruolo e stato controllati, la copertina solo nella forma dei nomi dei file", /check \(ruolo in \('cliente', 'assistente'\)\)/.test(sql) && /check \(stato is null or stato in \('in_corso', 'pronta'\)\)/.test(sql) && /\(stilizzato\|realistico\)\(-modifica\)\?\$/.test(sql));
    const console_ = leggi("src/app/site-console/_componenti/costi-dettaglio-vista.tsx");
    atteso("in console i due costi nuovi hanno un nome", /copertina_relazione_chat: "/.test(console_) && /copertina_relazione_modifica: "/.test(console_));
    atteso("il test è nella catena verifica:livello1", /tsx scripts\/verifica-copertina-chat\.ts/.test(leggi("package.json")));
  }

  if (fallimenti.length) {
    console.error(`\n${fallimenti.length} controlli falliti:\n- ${fallimenti.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nTutti i controlli sulla chat delle copertine sono superati.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
