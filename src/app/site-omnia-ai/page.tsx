import BrandMark, { type StatoMarchio } from "@/components/omnia-ai/brand-mark";

// Pagina di verifica del sistema visivo, non la home (arriva nel passo
// successivo): mostra variabili colore, tipografia, marchio nei tre
// stati e la regola dei paragrafi giustificati/sillabati, tutto isolato
// dall'e-commerce.

const STATI: { stato: StatoMarchio; etichetta: string }[] = [
  { stato: "riposo", etichetta: "riposo — viola" },
  { stato: "elaborazione", etichetta: "elaborazione — ambra" },
  { stato: "pronto", etichetta: "pronto — verde" },
];

const RUOLI = [
  { nome: "viola", varCss: "--viola", ruolo: "azione dell'utente" },
  { nome: "verde", varCss: "--verde", ruolo: "risposta del sistema" },
  { nome: "ambra", varCss: "--ambra", ruolo: "scadenze e avvisi" },
  { nome: "rosso", varCss: "--rosso", ruolo: "errori" },
];

export default function VerificaSistemaVisivoPage() {
  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "64px 32px 96px",
      }}
    >
      <h1 style={{ fontSize: 40 }}>Sistema visivo OMNIA AI</h1>
      <p className="micro" style={{ marginTop: 8, fontSize: 15 }}>
        Pagina di verifica — la home vera arriva nel passo successivo.
      </p>

      <h2 style={{ marginTop: 64, fontSize: 26 }}>Marchio, tre stati</h2>
      <div style={{ display: "flex", gap: 48, marginTop: 24, flexWrap: "wrap" }}>
        {STATI.map(({ stato, etichetta }) => (
          <div key={stato} style={{ textAlign: "center" }}>
            <div style={{ width: 64, height: 64, margin: "0 auto" }}>
              <BrandMark stato={stato} style={{ width: "100%", height: "100%" }} />
            </div>
            <p className="micro" style={{ marginTop: 12, fontSize: 13 }}>
              {etichetta}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 64, fontSize: 26 }}>Ruoli colore</h2>
      <div style={{ display: "flex", gap: 24, marginTop: 24, flexWrap: "wrap" }}>
        {RUOLI.map(({ nome, varCss, ruolo }) => (
          <div key={nome} style={{ textAlign: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `var(${varCss})`,
                margin: "0 auto",
              }}
            />
            <p className="micro" style={{ marginTop: 10, fontSize: 13 }}>
              {nome}
              <br />
              {ruolo}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 64, fontSize: 26 }}>Tipografia</h2>
      <p style={{ marginTop: 20, fontSize: 17, lineHeight: 1.7, color: "var(--fioco)" }}>
        OMNIA AI legge bando, disciplinare e capitolato e ti restituisce la relazione tecnica in Word:
        indice, intestazioni con il tuo logo, tabelle formattate, stili e numerazione già a posto.
        Questo paragrafo è giustificato con sillabazione automatica — su una colonna stretta, parole
        lunghe come &quot;caratterizzazione&quot; o &quot;amministrazione&quot; devono spezzarsi
        correttamente a fine riga.
      </p>
      <p className="micro" style={{ marginTop: 32 }}>
        Cifre tabellari: 10.328,50 € · 999.999,00 € · 1,00 €
      </p>
    </main>
  );
}
