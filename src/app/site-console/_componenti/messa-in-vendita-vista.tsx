import type { DatiPrezzi } from "@/lib/console/prezzi";
import type { ControlloStripe } from "@/lib/console/controllo-stripe";
import { motiviCheImpedisconoLaVendita, pianiConPrezzoDaCreare, type PianoDaControllare } from "@/lib/console/controllo-stripe-calcoli";
import { venditaVisibile } from "@/lib/omnia-ai-vendita";
import { creaPrezziMancanti, impostaVenditaAbbonamenti } from "../azioni/vendita";
import { Badge, Pannello, type Tono } from "./elementi";
import PulsanteAzione from "./pulsante-azione";

// «Messa in vendita» degli abbonamenti dal sito: i controlli sulla configurazione di Stripe e
// l'interruttore che mostra (o nasconde) il pulsante «Abbonati» su /piani. L'interruttore si accende
// solo se i controlli passano; si spegne sempre, anche per fermare la vendita in un attimo.

type Riga = { voce: string; tono: Tono; esito: string; dettaglio?: string; azione?: React.ReactNode };

export default function MessaInVenditaVista({ dati, controllo, interruttore }: { dati: DatiPrezzi; controllo: ControlloStripe; interruttore: boolean }) {
  const modalita = dati.modalitaStripe;
  const piani: PianoDaControllare[] = dati.piani.map((p) => ({ slug: p.slug, nome: p.nome, listinoCentesimi: p.listinoCentesimi, stato: p.stripe.stato }));
  const motivi = motiviCheImpedisconoLaVendita({ modalita, piani, webhook: controllo.webhook });
  const daCreare = pianiConPrezzoDaCreare(piani);
  const visibile = venditaVisibile({ interruttore, modalita });

  const non = piani.filter((p) => p.stato === "disallineato" || p.stato === "errore");
  const righe: Riga[] = [
    modalita === "reale"
      ? { voce: "Stripe in modalità reale", tono: "ok", esito: "sì" }
      : { voce: "Stripe in modalità reale", tono: "errore", esito: modalita === "prova" ? "no, è di prova" : "non riconosciuta", dettaglio: "Su Vercel la chiave STRIPE_SECRET_KEY_OMNIA_AI deve essere quella reale (sk_live…), poi va rifatto il deploy." },
    daCreare.length === 0 && non.length === 0
      ? { voce: "Prezzi dei piani su Stripe", tono: "ok", esito: "presenti e uguali al listino" }
      : {
          voce: "Prezzi dei piani su Stripe",
          tono: "errore",
          esito: [daCreare.length > 0 ? `mancano: ${daCreare.map((p) => p.nome).join(", ")}` : "", non.length > 0 ? `da controllare: ${non.map((p) => p.nome).join(", ")}` : ""].filter(Boolean).join(" · "),
          dettaglio: non.length > 0 ? "Un prezzo diverso dal listino si risolve risalvando il prezzo del piano, qui sotto." : undefined,
          azione:
            daCreare.length > 0 && modalita !== "sconosciuta" ? (
              <PulsanteAzione
                azione={creaPrezziMancanti}
                campi={{}}
                conferma={`Creare su Stripe (${modalita === "reale" ? "account REALE" : "account di prova"}) i prezzi mensili dei piani: ${daCreare.map((p) => `${p.nome} ${(p.listinoCentesimi / 100).toFixed(2).replace(".", ",")} €`).join(", ")}?`}
                etichetta="Crea i prezzi mancanti"
                etichettaInCorso="Creo…"
                variante="primario"
              />
            ) : undefined,
        },
    !controllo.webhook.verificabile
      ? { voce: "Webhook di Stripe", tono: "avviso", esito: "non verificabile", dettaglio: "La chiave non riesce a leggere le destinazioni del webhook: controllale a mano su Stripe (Sviluppatori → Webhook)." }
      : controllo.webhook.mancanti.length === 0 && controllo.webhook.doppi.length === 0
        ? { voce: "Webhook di Stripe", tono: "ok", esito: "tutti gli eventi arrivano, una volta sola" }
        : {
            voce: "Webhook di Stripe",
            tono: "errore",
            esito: [
              controllo.webhook.mancanti.length > 0 ? `mancano: ${controllo.webhook.mancanti.join(", ")}` : "",
              controllo.webhook.doppi.length > 0 ? `arrivano due volte: ${controllo.webhook.doppi.map((d) => d.evento).join(", ")}` : "",
            ]
              .filter(Boolean)
              .join(" · "),
            dettaglio: "Ogni evento deve arrivare a UNA sola destinazione: aggiungi quelli che mancano e toglili da quella che li riceve due volte.",
          },
    controllo.portale === "configurato"
      ? { voce: "Portale clienti di Stripe", tono: "ok", esito: "configurato" }
      : controllo.portale === "mancante"
        ? { voce: "Portale clienti di Stripe", tono: "avviso", esito: "non configurato", dettaglio: "Stripe → Impostazioni → Fatturazione → Portale clienti: attiva «Aggiorna metodo di pagamento» e lo storico fatture, poi salva." }
        : { voce: "Portale clienti di Stripe", tono: "avviso", esito: "non verificabile" },
  ];

  return (
    <Pannello titolo="Messa in vendita degli abbonamenti">
      <div className="cn-pannello-corpo">
        <p className={`cn-esito ${visibile ? "ok" : "avviso"}`} role="status" style={{ marginBottom: 14 }}>
          {visibile
            ? "Vendita ACCESA: su /piani, sotto ogni piano, c'è il pulsante «Abbonati»."
            : interruttore
              ? "L'interruttore è acceso, ma il pulsante «Abbonati» NON è visibile: la chiave Stripe di OMNIA AI su questo ambiente non è reale."
              : "Vendita SPENTA: su /piani c'è solo «Richiedi la demo». Nessun cliente può abbonarsi da lì."}
        </p>

        <div className="cn-scorri">
          <table className="cn-tab">
            <thead>
              <tr>
                <th>Controllo</th>
                <th>Esito</th>
                <th>Azione</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.voce}>
                  <td className="cn-cella-doppia">
                    {r.voce}
                    {r.dettaglio && <small>{r.dettaglio}</small>}
                  </td>
                  <td>
                    <Badge tono={r.tono}>{r.esito}</Badge>
                  </td>
                  <td>{r.azione ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14 }}>
          {interruttore ? (
            <PulsanteAzione
              azione={impostaVenditaAbbonamenti}
              campi={{ azione: "sospendi" }}
              conferma="Sospendere la vendita? Da subito su /piani resta solo «Richiedi la demo». Gli abbonamenti già attivi non cambiano."
              etichetta="Sospendi la vendita"
              etichettaInCorso="…"
              variante="pericolo"
            />
          ) : (
            <>
              <PulsanteAzione
                azione={impostaVenditaAbbonamenti}
                campi={{ azione: "attiva" }}
                conferma="Accendere la vendita? Da subito chiunque può abbonarsi dal sito, con pagamento reale su Stripe."
                etichetta="Accendi la vendita"
                etichettaInCorso="…"
                variante="primario"
                disabilitato={motivi.length > 0}
              />
              {motivi.length > 0 && (
                <ul className="cn-nota-inline errore" style={{ marginTop: 10, paddingLeft: 18 }}>
                  {motivi.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <p className="cn-nota-inline" style={{ marginTop: 10 }}>
          Il pulsante compare solo se l&apos;interruttore è acceso <strong>e</strong> la chiave Stripe è reale. La pagina di acquisto diretta (/abbonati/…) resta usabile per i link che mandi ai clienti.
        </p>
      </div>
    </Pannello>
  );
}
