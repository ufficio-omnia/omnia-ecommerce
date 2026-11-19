import type { Metadata } from "next";
import Link from "next/link";
import { richiediAdminPagina } from "@/lib/console/accesso";
import { createAdminClient } from "@/lib/supabase/admin";
import { contaConsegnePerStato, leggiProblemiEmail, leggiUltimiGiri, type StatoConsegna } from "@/lib/radar/notifiche/console-lettura";
import { Badge, Pannello, Tessera, type Tono } from "../../../_componenti/elementi";

export const metadata: Metadata = { title: "Email non consegnate" };

// Fase B4 (B1, 26A §4) — Console: messaggi email di Tender Intelligence NON consegnati (fallita, esito incerto, rimbalzata, reclamo).
// SOLA LETTURA: nessuna azione, nessun «riprova» (rimandato, decisione n. 5 approvata il 19/11), nessun aggiornamento periodico.
// Letture di B2 (src/lib/radar/notifiche/console-lettura.ts): mai indirizzi email (non sono nemmeno salvati) né testi delle email; dell'impresa
// solo la ragione sociale, del destinatario solo il ruolo. Tabelle assenti (0125 non applicata) = avviso.

const TIPI: Record<string, string> = {
  scadenza_10: "Scadenza tra 10 giorni",
  scadenza_5: "Scadenza tra 5 giorni",
  scadenza_1: "Scadenza domani",
  scadenza_ravvicinata: "Scadenza ravvicinata",
  rettifica: "Rettifica",
  proroga: "Proroga",
  modifica_scadenza: "Scadenza modificata",
  documenti: "Documenti",
  annullamento: "Annullamento",
  riepilogo_opportunita: "Riepilogo nuove opportunità",
};

const STATI: Record<StatoConsegna, { etichetta: string; tono: Tono }> = {
  in_coda: { etichetta: "In coda", tono: "neutro" },
  in_invio: { etichetta: "In invio", tono: "neutro" },
  inviata: { etichetta: "Inviata", tono: "ok" },
  annullata: { etichetta: "Annullata", tono: "neutro" },
  scartata: { etichetta: "Scartata", tono: "neutro" },
  fallita: { etichetta: "Fallita", tono: "errore" },
  esito_incerto: { etichetta: "Esito incerto", tono: "avviso" },
  rimbalzata: { etichetta: "Rimbalzata", tono: "errore" },
  reclamo: { etichetta: "Reclamo", tono: "errore" },
};

const DATA_ORA = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
function quando(iso: string | null): string {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? DATA_ORA.format(new Date(t)) : "—";
}

const BASE = "/tender-intelligence/email";

export default async function PaginaEmailNonConsegnate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await richiediAdminPagina();
  const parametri = await searchParams;
  const dopo = typeof parametri.dopo === "string" ? parametri.dopo : null;
  const admin = createAdminClient();
  const adesso = new Date();
  const settimana = new Date(adesso.getTime() - 7 * 86_400_000);
  const [problemi, conteggi, giri] = await Promise.all([leggiProblemiEmail(admin, { cursore: dopo, limite: 50 }), contaConsegnePerStato(admin, settimana), leggiUltimiGiri(admin, 10)]);

  const imprese = problemi.disponibile ? [...new Set(problemi.righe.map((r) => r.impresa_id))] : [];
  const { data: aziende } = imprese.length
    ? await admin.from("companies").select("user_id, ragione_sociale").in("user_id", imprese).returns<{ user_id: string; ragione_sociale: string | null }[]>()
    : { data: [] as { user_id: string; ragione_sociale: string | null }[] };
  const nomeImpresa = new Map((aziende ?? []).map((a) => [a.user_id, a.ragione_sociale]));

  return (
    <>
      <div className="cn-testata">
        <div>
          <h1>Email non consegnate</h1>
          <p>
            Tender Intelligence: gli avvisi email ai clienti che non sono arrivati (falliti, esito incerto, rimbalzati, reclami). Sola lettura: nessun
            indirizzo email e nessun testo delle email.{" "}
            <Link href="/tender-intelligence" prefetch={false}>
              Torna a Tender Intelligence
            </Link>
          </p>
        </div>
      </div>

      {!problemi.disponibile && problemi.motivo === "tabelle_assenti" ? (
        <p className="cn-esito avviso" role="alert">
          Le tabelle delle email di Tender Intelligence (0124–0125) non sono ancora nel database: non c&apos;è nulla da mostrare.
        </p>
      ) : (
        <>
          {conteggi.disponibile && (
            <div className="cn-tessere">
              <Tessera etichetta="Inviate (7 giorni)" valore={conteggi.perStato.inviata} tono="ok" />
              <Tessera etichetta="In coda o in invio" valore={conteggi.perStato.in_coda + conteggi.perStato.in_invio} />
              <Tessera etichetta="Fallite o incerte" valore={conteggi.perStato.fallita + conteggi.perStato.esito_incerto} tono={conteggi.perStato.fallita + conteggi.perStato.esito_incerto > 0 ? "avviso" : "neutro"} />
              <Tessera etichetta="Rimbalzi e reclami" valore={conteggi.perStato.rimbalzata + conteggi.perStato.reclamo} tono={conteggi.perStato.rimbalzata + conteggi.perStato.reclamo > 0 ? "errore" : "neutro"} />
            </div>
          )}

          <Pannello titolo="Messaggi non consegnati">
            {!problemi.disponibile ? (
              <p className="cn-esito errore">Lettura non riuscita: riprova ricaricando la pagina.</p>
            ) : problemi.righe.length === 0 ? (
              <p className="cn-nota">{dopo ? "Nessun altro messaggio non consegnato." : "Nessun messaggio non consegnato."}</p>
            ) : (
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Aggiornato</th>
                    <th>Impresa</th>
                    <th>Destinatario</th>
                    <th>Avviso</th>
                    <th>Gara</th>
                    <th>Stato</th>
                    <th>Tentativi</th>
                    <th>Ultimo errore</th>
                  </tr>
                </thead>
                <tbody>
                  {problemi.righe.map((r) => (
                    <tr key={r.id}>
                      <td>{quando(r.aggiornata_il)}</td>
                      <td>{nomeImpresa.get(r.impresa_id) ?? "impresa senza ragione sociale"}</td>
                      <td>{r.ruolo === "titolare" ? "Titolare dell'impresa" : "Ufficio Gare"}</td>
                      <td>{TIPI[r.evento?.tipo ?? ""] ?? r.evento?.tipo ?? "—"}</td>
                      <td>{r.evento?.denominazione ?? "—"}</td>
                      <td>
                        <Badge tono={STATI[r.stato]?.tono ?? "neutro"}>{STATI[r.stato]?.etichetta ?? r.stato}</Badge>
                      </td>
                      <td>{r.tentativi}</td>
                      <td>{[r.ultimo_errore, r.motivo].filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {problemi.disponibile && (dopo || problemi.prossimo) && (
              <p className="cn-nota">
                {dopo && (
                  <Link href={BASE} prefetch={false}>
                    ← Dall&apos;inizio
                  </Link>
                )}
                {dopo && problemi.prossimo && " · "}
                {problemi.prossimo && (
                  <Link href={`${BASE}?dopo=${encodeURIComponent(problemi.prossimo)}`} prefetch={false}>
                    Successivi →
                  </Link>
                )}
              </p>
            )}
          </Pannello>

          <Pannello titolo="Ultimi giri del processo giornaliero">
            {!giri.disponibile ? (
              <p className="cn-nota">Nessun giro registrato.</p>
            ) : giri.righe.length === 0 ? (
              <p className="cn-nota">Il processo giornaliero non è ancora partito.</p>
            ) : (
              <table className="cn-tab">
                <thead>
                  <tr>
                    <th>Giorno</th>
                    <th>Fase</th>
                    <th>Esito</th>
                    <th>Ambiente</th>
                    <th>Invio</th>
                    <th>Inizio</th>
                    <th>Fine</th>
                    <th>Errore</th>
                  </tr>
                </thead>
                <tbody>
                  {giri.righe.map((g) => (
                    <tr key={g.id}>
                      <td>{g.giorno_roma}</td>
                      <td>{g.fase}</td>
                      <td>{g.esito}</td>
                      <td>{g.ambiente}</td>
                      <td>{g.provider}</td>
                      <td>{quando(g.iniziato_il)}</td>
                      <td>{quando(g.finito_il)}</td>
                      <td>{g.errore ? g.errore.slice(0, 160) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Pannello>
        </>
      )}
    </>
  );
}
