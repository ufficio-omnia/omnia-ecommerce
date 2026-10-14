import type { Blocco, DocumentoLegale, Inline } from "@/lib/legal-markdown";

// Disegna un documento legale scritto in markdown (legal/*.md) con la stessa grafica
// dei documenti scritti come componenti (versione 1): intestazione, corpo in
// .omnia-prosa, titoli con id «clausola-N» / «art-N» per i collegamenti interni. Non
// legge file né database: riceve il documento già interpretato.

function Testo({ inline }: { inline: Inline[] }) {
  return (
    <>
      {inline.map((s, i) =>
        s.tipo === "grassetto" ? <strong key={i}>{s.testo}</strong> : s.tipo === "corsivo" ? <em key={i}>{s.testo}</em> : <span key={i}>{s.testo}</span>,
      )}
    </>
  );
}

function BloccoDocumento({ blocco }: { blocco: Blocco }) {
  switch (blocco.tipo) {
    case "h1":
      return null;
    case "h2":
      return (
        <h2 id={blocco.id ?? undefined}>
          <Testo inline={blocco.inline} />
        </h2>
      );
    case "h3":
      return (
        <h3 id={blocco.id ?? undefined}>
          <Testo inline={blocco.inline} />
        </h3>
      );
    case "paragrafo":
      return (
        <p>
          <Testo inline={blocco.inline} />
        </p>
      );
    case "elenco":
      return (
        <ul>
          {blocco.voci.map((voce, i) => (
            <li key={i}>
              <Testo inline={voce} />
            </li>
          ))}
        </ul>
      );
    case "tabella":
      return (
        <div className="omnia-tabella-scroll">
          <table>
            <thead>
              <tr>
                {blocco.intestazione.map((cella, i) => (
                  <th key={i}>
                    <Testo inline={cella} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blocco.righe.map((riga, i) => (
                <tr key={i}>
                  {riga.map((cella, j) => (
                    <td key={j}>
                      <Testo inline={cella} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function DocumentoMarkdown({
  documento,
  versione,
  inVigoreDal,
  mostraRigaVersione,
}: {
  documento: DocumentoLegale;
  versione: number;
  // data di entrata in vigore già in forma leggibile; null se non si conosce (la riga si omette)
  inVigoreDal: string | null;
  mostraRigaVersione: boolean;
}) {
  const titolo = documento.blocchi.find((b) => b.tipo === "h1");

  return (
    <>
      <section className="omnia-pagina-hero">
        <h1>{titolo && titolo.tipo === "h1" ? titolo.testo : "Documento"}</h1>
        {mostraRigaVersione && inVigoreDal && (
          <p className="micro" style={{ marginTop: 12, color: "var(--fioco)" }}>
            Versione {versione} — in vigore dal {inVigoreDal}
          </p>
        )}
      </section>

      <section className="omnia-pagina-corpo">
        <div className="omnia-prosa">
          {documento.blocchi.map((blocco, i) => (
            <BloccoDocumento key={i} blocco={blocco} />
          ))}
        </div>
      </section>
    </>
  );
}
