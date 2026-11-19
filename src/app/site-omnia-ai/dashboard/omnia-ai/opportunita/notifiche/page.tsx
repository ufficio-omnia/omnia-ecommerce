import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { richiediOpportunitaPagina } from "@/lib/radar/guardie-opportunita";
import { dirittoRadarOppure404 } from "@/lib/radar/area-cliente";
import { invioEmailDichiaratoAcceso, preferenzeNotificheAttive } from "@/lib/radar/interruttori-b4";
import { leggiNotifiche } from "@/lib/radar/notifiche-preferenze";
import { TESTI_CATEGORIA, categorieDa, modoModifica, personeVisibili, type PersonaVista } from "@/lib/radar/notifiche-preferenze-calcoli";
import { CATEGORIE_NOTIFICA, type CategoriaNotifica } from "@/lib/radar/notifiche/tipi";
import type { StatoImpresaNotifiche } from "@/lib/radar/notifiche/destinatari-calcoli";
import TestataOpportunita from "@/components/omnia-ai/opportunita/testata-opportunita";
import { InterruttoreEmailImpresa, PreferenzePersonaForm } from "@/components/omnia-ai/opportunita/notifiche-form";

// «Notifiche» (fase B4, grado 3, RADAR_NOTIFICHE_PREFERENZE acceso solo sullo staging). Decisione dell'utente del 19/11 §3 e approvazione
// definitiva:
//   - interruttore delle email dell'IMPRESA: lo cambia il titolare dell'impresa, l'Ufficio Gare lo vede;
//   - preferenze personali a 3 categorie: il titolare per tutte le persone della sua impresa, l'Ufficio Gare solo le proprie e solo per spegnere;
//   - destinatari dell'impresa con lo stato dell'indirizzo e il «riceve sì/no» della regola UNICA di B2 (destinatari-calcoli.ts): solo il
//     titolare, solo la sua impresa, mai gli indirizzi email.
// Letture per la sola impresa della sessione; nessun aggiornamento periodico. Nessuna email parte da questa pagina.

function testoRiceve(p: PersonaVista, c: CategoriaNotifica): string {
  const r = p.riceve[c];
  return r.riceve ? "riceve" : `non riceve: ${r.testo.toLowerCase()}`;
}

export default async function NotifichePage() {
  const sessione = await richiediOpportunitaPagina();
  if (!sessione) return null;
  const { contesto } = sessione;
  const { diritto, cliente } = await dirittoRadarOppure404(contesto.accountId);
  if (!preferenzeNotificheAttive(process.env)) notFound();
  const lettura = await leggiNotifiche(await createClient(), createAdminClient(), contesto.accountId);
  const titolare = contesto.ruolo === "titolare";
  const chiGuarda = { userId: contesto.userId, ruolo: contesto.ruolo };
  const impresa: StatoImpresaNotifiche = { impresaId: contesto.accountId, radarAttivo: cliente?.attivo === true, emailAttive: lettura.emailAttive, abbonamentoValido: diritto.operativo };
  const persone = lettura.persone ? personeVisibili({ persone: lettura.persone, preferenze: lettura.preferenze, impresa, chiGuarda }) : null;
  const io = persone?.find((p) => p.tu) ?? null;
  const altri = (persone ?? []).filter((p) => !p.tu);
  const mieCategorie = io?.categorie ?? categorieDa(lettura.preferenze.get(contesto.userId));
  const testi = Object.fromEntries(CATEGORIE_NOTIFICA.map((c) => [c, TESTI_CATEGORIA[c]])) as typeof TESTI_CATEGORIA;

  return (
    <div className="omnia-app-shell">
      <TestataOpportunita attiva="notifiche" sottotitolo="Gli avvisi email sulle gare salvate o monitorate dall'impresa e sulle nuove opportunità del profilo." />

      {!lettura.tabelle ? (
        <p className="omnia-messaggio-stato avviso">Le notifiche non sono ancora disponibili.</p>
      ) : (
        <>
          {!invioEmailDichiaratoAcceso(process.env) && (
            <p className="omnia-messaggio-stato avviso">Gli avvisi email non sono ancora attivi: le scelte si salvano e varranno quando saranno accesi.</p>
          )}
          {!diritto.operativo && <p className="omnia-messaggio-stato avviso">{diritto.messaggioSolaLettura}</p>}

          <section className="omnia-riquadro" aria-labelledby="notifiche-impresa">
            <h2 id="notifiche-impresa" className="omnia-opp-sottotitolo">
              Avvisi email dell&apos;impresa
            </h2>
            <InterruttoreEmailImpresa attive={lettura.emailAttive} modificabile={titolare && (diritto.operativo || lettura.emailAttive)} />
          </section>

          <section className="omnia-riquadro" aria-labelledby="notifiche-mie">
            <h2 id="notifiche-mie" className="omnia-opp-sottotitolo">
              Le mie preferenze
            </h2>
            {io && <p className="omnia-opp-nota">{io.statoTesto}.</p>}
            <PreferenzePersonaForm
              persona={contesto.userId}
              valori={mieCategorie}
              modo={modoModifica(chiGuarda, { userId: contesto.userId }, diritto.operativo)}
              testi={testi}
              riceve={io ? Object.fromEntries(CATEGORIE_NOTIFICA.map((c) => [c, testoRiceve(io, c)])) : undefined}
            />
          </section>

          {titolare && (
            <section className="omnia-riquadro" aria-labelledby="notifiche-destinatari">
              <h2 id="notifiche-destinatari" className="omnia-opp-sottotitolo">
                Destinatari dell&apos;impresa
              </h2>
              {!persone ? (
                <p className="omnia-opp-nota">Lo stato degli indirizzi non è ancora disponibile.</p>
              ) : altri.length === 0 ? (
                <p className="omnia-opp-nota">Oltre a te, nessuna persona dell&apos;impresa riceve gli avvisi. L&apos;Ufficio Gare si aggiunge dalla pagina «Ufficio Gare».</p>
              ) : (
                altri.map((p) => (
                  <div key={p.userId}>
                    <p className="omnia-opp-prosa">
                      <strong>{p.etichetta}</strong> · {p.statoTesto}
                    </p>
                    <PreferenzePersonaForm
                      persona={p.userId}
                      valori={p.categorie}
                      modo={modoModifica(chiGuarda, p, diritto.operativo)}
                      testi={testi}
                      riceve={Object.fromEntries(CATEGORIE_NOTIFICA.map((c) => [c, testoRiceve(p, c)]))}
                    />
                  </div>
                ))
              )}
            </section>
          )}

          <p className="omnia-opp-nota">
            Gli avvisi riguardano solo le gare salvate o monitorate dall&apos;impresa e il profilo di ricerca dell&apos;impresa. Sono un servizio informativo:
            verifica sempre la documentazione ufficiale.
          </p>
        </>
      )}
    </div>
  );
}
