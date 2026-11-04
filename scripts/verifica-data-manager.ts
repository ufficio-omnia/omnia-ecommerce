// Verifica della Data Manager API di Google Ads in SOLA VALIDAZIONE, da riga di comando (l'alternativa al pulsante «Verifica Google Ads»
// della pagina DEMO della console). Manda a Google quattro richieste con validateOnly = true e DATI INVENTATI: non legge né scrive nessun
// lead e nessuna tabella, non registra nessuna conversione, non stampa token, segreti, email o identificativi (account e azione si
// vedono mascherati).
//
// Serve che le variabili di Google siano nell'ambiente: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
// GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEMO_CONVERSION_ACTION_ID (come su Vercel). Con le variabili in .env.local:
//
//   npx tsx --env-file=.env.local scripts/verifica-data-manager.ts
//
// Esce con 0 se la verifica è stata eseguita (anche se Google ha rifiutato qualcosa: il rapporto lo dice), con 1 se non è potuta partire.
import { verificaDataManager } from "../src/lib/demo-ads-verifica";
import type { RisultatoVerifica } from "../src/lib/demo-ads-verifica-calcoli";

const SI_NO = (v: boolean) => (v ? "sì" : "no");

function rapporto(r: RisultatoVerifica): string[] {
  const righe: string[] = [];
  const a = r.ambiente;
  righe.push("VERIFICA DATA MANAGER API — sola validazione, dati inventati");
  righe.push(`Ambiente: importazione ${a.importazioneAccesa ? "ACCESA" : "spenta"} · modalità configurata ${a.modalitaConfigurata === "reale" ? "REALE" : "solo verifica"} · configurazione ${a.configurazioneCompleta ? "completa" : "INCOMPLETA"} · credenziali ${a.credenzialiPresenti ? "presenti" : "MANCANTI"} · account ${a.account ?? "-"} · azione ${a.azione ?? "-"}`);
  if (!r.eseguita) {
    righe.push(`NON ESEGUITA: ${r.motivo}${r.motivo === "oauth_fallita" ? ` (${r.oauth.codice || "errore"}${r.oauth.httpStato ? `, HTTP ${r.oauth.httpStato}` : ""})` : ""}`);
  } else {
    righe.push(`OAuth: riuscita · ambito Data Manager nel token: ${r.oauth.scopeDataManager === null ? "non indicato" : SI_NO(r.oauth.scopeDataManager)}`);
    for (const p of r.prove) {
      righe.push(`- ${p.titolo}\n    HTTP ${p.httpStato ?? "-"} · ${p.accettata ? "ACCETTATA da Google" : `rifiutata${p.codiceGoogle ? ` (${p.codiceGoogle})` : ""}`}${p.campi.length ? ` · campi: ${p.campi.join(", ")}` : ""}${p.ragioni.length ? ` · motivi: ${p.ragioni.join(", ")}` : ""} · atteso: ${p.atteso} · ${p.coerente ? "coerente" : "NON coerente"}`);
    }
    if (r.statoRichiesta) righe.push(`requestStatus: HTTP ${r.statoRichiesta.httpStato ?? "-"} · ${r.statoRichiesta.esito}${r.statoRichiesta.ragioni.length ? ` (${r.statoRichiesta.ragioni.join(", ")})` : ""}`);
    if (r.riepilogo) {
      righe.push("RIEPILOGO");
      righe.push(`  1. Autenticazione OAuth ........ ${r.riepilogo.autenticazione}`);
      righe.push(`  2. Permessi .................... ${r.riepilogo.permessi}`);
      righe.push(`  3. Account Google Ads .......... ${r.riepilogo.account}`);
      righe.push(`  4. Azione di conversione ....... ${r.riepilogo.azione}`);
      righe.push(`  5. Schema della richiesta ...... ${r.riepilogo.schema}`);
      righe.push(`  6. Conversioni registrate ...... ${r.riepilogo.conversioniRegistrate}`);
    }
  }
  righe.push("NOTE");
  for (const n of r.note) righe.push(`  - ${n}`);
  return righe;
}

async function main() {
  const risultato = await verificaDataManager(process.env);
  for (const riga of rapporto(risultato)) console.log(riga);
  process.exit(risultato.eseguita ? 0 : 1);
}

main().catch(() => {
  console.error("La verifica non è riuscita (errore imprevisto).");
  process.exit(1);
});
