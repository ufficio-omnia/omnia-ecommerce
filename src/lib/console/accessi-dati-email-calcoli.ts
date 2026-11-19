import { PIEDE_CLIENTE, cornice, tabella, type EmailPronta } from "@/lib/omnia-ai-email-eventi-calcoli";
import { testoCaso, type CasoAccesso } from "./accessi-dati-calcoli";

// Email al cliente con l'estratto del registro degli accessi in allegato (PDF). Due occasioni:
//  - «nuovo_accesso»: appena registrato un accesso ai suoi dati (lo si dice subito, con i dati di quell'accesso);
//  - «su_richiesta»: l'estratto mandato dalla pagina dell'estratto (per esempio quando il cliente lo chiede, art. 10).
// Solo testo deciso qui o scritto dall'amministratore nel registro, sempre passato da esc().

export type AccessoPerEmail = { accessoIl: Date; caso: CasoAccesso; ambito: string; motivo: string };

function dataOraRoma(quando: Date): string {
  return quando.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function emailClienteEstrattoAccessi(d: { occasione: "nuovo_accesso" | "su_richiesta"; accesso?: AccessoPerEmail | null }): EmailPronta {
  const p = (testo: string) => `<p style="margin:0 0 12px;">${testo}</p>`;
  const riferimento = "come previsto dall&apos;art. 10 delle condizioni di abbonamento e dall&apos;Allegato A (art. 4)";

  if (d.occasione === "nuovo_accesso" && d.accesso) {
    const a = d.accesso;
    return {
      oggetto: "OMNIA AI — Accesso del personale ai tuoi dati: estratto del registro",
      html: cornice({
        titolo: "Accesso del personale ai tuoi dati",
        prova: false,
        piede: PIEDE_CLIENTE,
        corpo: [
          p(`Ti informiamo, ${riferimento}, che il personale autorizzato di OMNIA AI ha effettuato un accesso ai documenti o ai contenuti del tuo account.`),
          tabella([
            ["Data e ora (Roma)", dataOraRoma(a.accessoIl)],
            ["Caso", testoCaso(a.caso)],
            ["Cosa è stato guardato", a.ambito],
            ["Motivo", a.motivo],
          ]),
          p("In allegato trovi l&apos;estratto aggiornato del registro degli accessi ai tuoi dati, in PDF: per ogni accesso riporta data, ora, operatore, caso e motivo."),
          p("Gli accessi del personale sono ammessi solo nei casi indicati dall&apos;Allegato A e vengono tutti registrati. Il registro non si modifica né si cancella."),
        ].join("\n"),
      }),
    };
  }

  return {
    oggetto: "OMNIA AI — Estratto del registro degli accessi ai tuoi dati",
    html: cornice({
      titolo: "Estratto del registro degli accessi",
      prova: false,
      piede: PIEDE_CLIENTE,
      corpo: [
        p(`In allegato trovi, ${riferimento}, l&apos;estratto del registro degli accessi del personale ai documenti e ai contenuti del tuo account, in PDF.`),
        p("Per ogni accesso riporta data, ora, operatore, caso e motivo. Se non risulta alcun accesso, l&apos;estratto lo dice in modo esplicito."),
      ].join("\n"),
    }),
  };
}
