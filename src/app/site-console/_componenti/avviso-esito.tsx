// Avviso in cima a una pagina dopo un'azione riuscita. L'azione fa un redirect
// con ?esito=…&ordine=…&email=1|0: lo stato vive nell'URL, quindi sopravvive al
// ricaricamento della pagina e funziona anche se la riga su cui si è cliccato è
// sparita. "Email non inviata" è un errore, non una nota: il cliente va avvisato a mano.

export type ParametriEsito = { esito?: string; ordine?: string; email?: string; data?: string };

export default function AvvisoEsito({ esito, ordine, email, data }: ParametriEsito) {
  if (!esito || !ordine) return null;

  let testo: string;
  switch (esito) {
    case "confermato":
      testo = `Accredito confermato per l'ordine ${ordine}.`;
      break;
    case "fattura":
      testo = `Fattura caricata per l'ordine ${ordine}.`;
      break;
    case "eliminato":
      testo = `Ordine ${ordine} eliminato.`;
      break;
    default:
      return null;
  }

  const emailNonInviata = email === "0";
  const dataNonRegistrata = data === "0";

  return (
    <div className={`cn-esito ${emailNonInviata ? "errore" : "ok"}`} role="status" style={{ marginBottom: 14 }}>
      {testo}
      {email === "1" && " Email inviata al cliente."}
      {emailNonInviata && " L'email al cliente NON è partita: avvisalo tu."}
      {dataNonRegistrata && " Data e autore della conferma non registrati: eseguire la migrazione 0075."}
    </div>
  );
}
