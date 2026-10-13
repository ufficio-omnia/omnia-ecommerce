import type { ReactElement } from "react";
import PrivacyPolicyV1 from "@/components/omnia-ai/legal/privacy-policy-v1";
import CookiePolicyV1 from "@/components/omnia-ai/legal/cookie-policy-v1";
import CondizioniAbbonamentoV1 from "@/components/omnia-ai/legal/condizioni-abbonamento-v1";
import DocumentoMarkdown from "@/components/omnia-ai/legal/documento-markdown";
import { getOmniaAiDocumentoEffectiveDate } from "@/lib/omnia-ai-legal";
import { DOCUMENTI_MARKDOWN, leggiMarkdownLegale } from "@/lib/legal-documenti";
import { compilaSegnaposto, dataEstesa, interpretaMarkdown } from "@/lib/legal-markdown";

// Registro delle versioni pubblicate dei documenti legali di omnia-ai.it. Una versione,
// una volta pubblicata, non si modifica mai: una revisione AGGIUNGE una voce, così un
// link raccolto al momento dell'accettazione continua a mostrare esattamente il testo
// che era in vigore allora.
//
// Due modi di scrivere una versione: come componente (la v1 di privacy, cookie e
// condizioni) oppure come file markdown in legal/ (dalla v2 delle condizioni e per
// l'Allegato A), registrato in src/lib/legal-documenti.ts. Il file markdown è l'unica
// fonte del testo, anche per il PDF.
const COMPONENTI: Record<string, Record<string, () => ReactElement>> = {
  "privacy-policy": { "1": PrivacyPolicyV1 },
  "cookie-policy": { "1": CookiePolicyV1 },
  "condizioni-abbonamento": { "1": CondizioniAbbonamentoV1 },
};

export const TITOLI_DOCUMENTI: Record<string, string> = {
  "privacy-policy": "Privacy policy",
  "cookie-policy": "Cookie policy",
  "condizioni-abbonamento": "Condizioni di abbonamento",
  "allegato-a": "Allegato A — Atto di nomina a responsabile del trattamento",
};

export function versioneEsiste(slug: string, version: string): boolean {
  return Boolean(COMPONENTI[slug]?.[version] ?? DOCUMENTI_MARKDOWN[slug]?.[version]);
}

// La versione registrata più alta non superiore a quella richiesta (o la più bassa, se
// la richiesta è inferiore a tutte): serve alla pagina «corrente» quando il database
// indica una versione che il codice non conosce ancora — mostra l'ultimo testo che
// possiede invece di una pagina vuota.
export function versioneRegistrataPiuVicina(slug: string, desiderata: number): number | null {
  const note = [...Object.keys(COMPONENTI[slug] ?? {}), ...Object.keys(DOCUMENTI_MARKDOWN[slug] ?? {})].map(Number).sort((a, b) => a - b);
  if (note.length === 0) return null;
  return [...note].reverse().find((v) => v <= desiderata) ?? note[0];
}

export default async function DocumentoLegaleVersionato({ slug, version }: { slug: string; version: string }) {
  const registrato = DOCUMENTI_MARKDOWN[slug]?.[version];

  if (registrato) {
    const effectiveDate = await getOmniaAiDocumentoEffectiveDate(registrato.tipoDb, Number(version));
    // Pagina pubblica: i dati del cliente non ci sono, quindi i campi restano come
    // segnaposto (è il modello dell'atto); la data di entrata in vigore invece è nota.
    const testo = compilaSegnaposto(leggiMarkdownLegale(registrato.file), { data: effectiveDate ? dataEstesa(effectiveDate) : null }, "mantieni");
    return (
      <DocumentoMarkdown
        documento={interpretaMarkdown(testo)}
        versione={Number(version)}
        inVigoreDal={effectiveDate ? dataEstesa(effectiveDate) : null}
        mostraRigaVersione={!registrato.versioneNelTesto}
      />
    );
  }

  const Componente = COMPONENTI[slug]?.[version];
  if (!Componente) return null;
  return <Componente />;
}
