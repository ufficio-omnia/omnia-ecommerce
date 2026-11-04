"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { sendEmail, ADMIN_EMAIL } from "@/lib/email";
import { verificaFormUmano } from "@/lib/turnstile";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashIp, segretoFirmaConsensi } from "@/lib/demo-hash";
import { registraLead } from "@/lib/demo-leads";
import {
  NOME_CAMPO_CHIAVE,
  NOME_CAMPO_TRAPPOLA,
  NOME_CAMPO_VERSIONE_CONSENSI,
  TESTO_ERRORE_PAGINA_VECCHIA,
  TESTO_ERRORE_RECUPERABILE,
  VERSIONE_CONSENSI_DEMO,
  chiaveIdempotenzaValida,
  clientIdDaCookieGa,
  decisioneDopoSalvataggio,
  pulisciAttribuzione,
  sessionIdDaCookieGa,
  validaModuloDemo,
  type CampoModulo,
  type DatiModuloDemo,
} from "@/lib/demo-lead-calcoli";

// Richiesta pubblica, non autenticata: chiunque su omnia-ai.it può inviarla, quindi tutti i campi sono input non fidato (validati
// qui di nuovo con la stessa funzione del browser, ed escapati prima di finire nell'email).
//
// Passi, in quest'ordine: campo trappola (un robot lo compila: finge successo e non salva nulla) → versione dei testi dei consensi
// (se la pagina è vecchia, si ricarica) → validazione → anti-bot Turnstile → salvataggio su Supabase (contatto + richiesta nuova +
// registro dei consensi, con chiave di idempotenza e limiti per indirizzo ed email) → email di avviso all'ufficio.
//
// Se il salvataggio non riesce: PRIMA dell'attivazione (DEMO_LEADS_ATTIVO diverso da «1») il modulo funziona come sempre, la
// richiesta arriva per email e il calendario si apre; DOPO l'attivazione NON si prosegue in silenzio: errore recuperabile, il
// calendario non si apre, e all'ufficio arriva comunque un avviso con i dati («NON registrata») perché la persona si possa ricontattare.
//
// NON registra nessuna conversione: la prenotazione si conferma solo quando compare sul calendario (sincronizzazione periodica).
export type EsitoRichiestaDemo =
  | { ok: true }
  | {
      ok: false;
      errore: string;
      errori?: Partial<Record<CampoModulo, string>>;
      // il salvataggio è fallito per un guasto nostro: riprovare con lo stesso modulo va bene (la chiave di idempotenza evita doppioni)
      recuperabile?: boolean;
      // il testo dei consensi è cambiato: la pagina va ricaricata
      ricarica?: boolean;
    };

function escapeHtml(valore: string): string {
  return valore
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CAMPI_TESTO = ["nome", "azienda", "email", "telefono", "settore"] as const;

async function avvisaUfficio(dati: DatiModuloDemo, stato: string, nota: string, soggetto: string) {
  const righe = [
    ["Nome", dati.nome],
    ["Azienda", dati.azienda],
    ["Email", dati.email],
    ["Telefono", dati.telefono],
    ["Settore", dati.settore],
    ["Salvata nel registro", stato],
  ];
  await sendEmail({
    to: ADMIN_EMAIL,
    from: "OMNIA AI <noreply@omniaitalia.com>",
    subject: `${soggetto} — ${dati.azienda}`,
    html: `
      <div style="font-family:'Space Grotesk',Arial,sans-serif;background:#050509;color:#E9E7F4;padding:32px">
        <div style="max-width:560px;margin:0 auto;background:rgba(255,255,255,.04);border:1px solid rgba(150,140,255,.16);border-radius:16px;padding:28px">
          <p style="font-family:Arial,sans-serif;font-weight:800;font-size:17px;color:#8B7FE8;margin:0 0 20px">OMNIA AI</p>
          <h2 style="margin:0 0 18px;font-size:18px;color:#E9E7F4">${escapeHtml(soggetto)}</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            ${righe
              .map(
                ([etichetta, valore]) => `
              <tr>
                <td style="padding:6px 0;color:#8B8AA8;width:150px;vertical-align:top">${escapeHtml(etichetta)}</td>
                <td style="padding:6px 0;color:#E9E7F4">${escapeHtml(valore)}</td>
              </tr>`,
              )
              .join("")}
          </table>
          <p style="margin:20px 0 0;color:#8B8AA8;font-size:13px">${escapeHtml(nota)}</p>
        </div>
      </div>
    `,
  });
}

export async function inviaRichiestaDemo(formData: FormData): Promise<EsitoRichiestaDemo> {
  // 1. robot: il campo trappola è nascosto alle persone
  if (String(formData.get(NOME_CAMPO_TRAPPOLA) ?? "").trim() !== "") return { ok: true };

  // 2. il testo dei consensi che la persona ha visto dev'essere quello che il server sa dimostrare (versione corrente)
  if (formData.get(NOME_CAMPO_VERSIONE_CONSENSI) !== VERSIONE_CONSENSI_DEMO) {
    return { ok: false, errore: TESTO_ERRORE_PAGINA_VECCHIA, ricarica: true };
  }

  // 3. validazione (la stessa del browser)
  const grezzo: Record<string, unknown> = { privacy: formData.get("privacy"), adsConsenso: formData.get("adsConsenso") };
  for (const campo of CAMPI_TESTO) grezzo[campo] = formData.get(campo);
  const esito = validaModuloDemo(grezzo);
  if (!esito.ok) return { ok: false, errore: "Controlla i campi evidenziati.", errori: esito.errori };
  const dati = esito.dati;

  // 4. anti-bot
  const verifica = await verificaFormUmano(formData);
  if (!verifica.ok) return { ok: false, errore: verifica.errore };

  // 5. attribuzione pubblicitaria: input non fidato, ridotto ai campi noti e ben formati; si conserva solo se il browser dichiara
  // che i cookie pubblicitari sono stati accettati (il server non può verificarlo: lo dichiara il modulo, che lo legge dal banner;
  // nel registro dei consensi è marcato «dichiarato dal browser»)
  const consensoCookie = formData.get("cookie_ok") === "1";
  let attribuzione = {};
  try {
    attribuzione = pulisciAttribuzione(JSON.parse(String(formData.get("attribuzione") ?? "{}")));
  } catch {
    attribuzione = {};
  }
  const gaClientId = clientIdDaCookieGa(String(formData.get("ga_cookie") ?? ""));
  const gaSessionId = sessionIdDaCookieGa(String(formData.get("ga_sessione") ?? ""));
  const percorso = String(formData.get("percorso") ?? "");
  const landingPath = /^\/[A-Za-z0-9\-_/]{0,150}$/.test(percorso) ? percorso : null;

  // 6. indirizzo: solo un hash con segreto (mai l'IP)
  const intestazioni = await headers();
  const ip = (intestazioni.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const segretoIp = process.env.DEMO_LEADS_HASH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const ipHash = ip && segretoIp ? hashIp(ip, segretoIp) : null;

  // 7. salvataggio. La chiave di idempotenza la sceglie il modulo (UUID per invio logico); da un cliente che non la manda se ne crea una.
  const attivo = process.env.DEMO_LEADS_ATTIVO === "1";
  const segretoFirma = segretoFirmaConsensi(process.env);
  const chiave = chiaveIdempotenzaValida(formData.get(NOME_CAMPO_CHIAVE)) ?? randomUUID();
  // a sistema attivo i consensi devono poter essere firmati: senza segreto non si dimostrerebbero (CRON_SECRET c'è sempre in produzione)
  const salvataggio =
    attivo && !segretoFirma
      ? ({ esito: "non_salvato", motivo: "errore" } as const)
      : await registraLead(createAdminClient(), { dati, chiave, attribuzione, consensoCookie, gaClientId, gaSessionId, landingPath, ipHash, segretoFirma, adesso: new Date() });

  const decisione = decisioneDopoSalvataggio(salvataggio.esito, attivo);
  if (decisione === "troppe_richieste") {
    return { ok: false, errore: "Hai inviato molte richieste ravvicinate. Riprova tra un po' oppure scrivici a info@omniaitalia.com." };
  }
  if (decisione === "errore_recuperabile") {
    // niente calendario, ma l'ufficio sa che c'è una persona da richiamare
    try {
      await avvisaUfficio(dati, "NO (errore: il visitatore ha visto un messaggio e il calendario NON si è aperto)", "La richiesta non è stata registrata per un problema tecnico. La persona può riprovare dal modulo; se non lo fa, ricontattarla.", "Richiesta demo NON registrata");
    } catch {
      console.error("Richiesta demo: avviso all'ufficio non inviato");
    }
    return { ok: false, errore: TESTO_ERRORE_RECUPERABILE, recuperabile: true };
  }

  // 8. avviso all'ufficio (come prima; in più dice se la richiesta è stata salvata). Un invio ripetuto già registrato non lo rimanda.
  if (salvataggio.esito !== "gia_registrato") {
    await avvisaUfficio(
      dati,
      salvataggio.esito === "non_salvato" ? "NO (da inserire a mano)" : "sì",
      "Ha aperto il calendario per scegliere l'orario: la demo è confermata solo quando compare la prenotazione sul calendario.",
      "Richiesta demo OMNIA AI",
    );
  }

  return { ok: true };
}
