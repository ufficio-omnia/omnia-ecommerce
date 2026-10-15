import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import CompanyProfileForm from "./company-profile-form";
import { richiediTitolarePagina } from "@/lib/omnia-ai-account-guardie";

export type Company = {
  ragione_sociale: string | null;
  partita_iva: string | null;
  codice_fiscale: string | null;
  indirizzo: string | null;
  codice_sdi: string | null;
  pec: string | null;
  forma_giuridica: string | null;
  anno_costituzione: number | null;
  numero_dipendenti: number | null;
  fatturato_medio_annuo: number | null;
  certificazioni: string | null;
  referenze: string | null;
  settori_attivita: string | null;
  presentazione: string | null;
  sito_web: string | null;
  telefono_aziendale: string | null;
  logo_path: string | null;
  software_nome: string | null;
  software_logo_path: string | null;
  funzioni_direzione?: string | null;
  uffici_gestione?: string | null;
  funzioni_piattaforma?: string | null;
};

export default async function ProfiloAziendaPage() {
  const supabase = await createClient();
  // Solo il titolare: l'Ufficio Gare non vede questa pagina (la barra laterale non la mostra, il controllo vero è qui).
  const sessione = await richiediTitolarePagina();
  if (!sessione) return null;
  const { user } = sessione;

  // I campi del livello di Direzione dell'organigramma (migrazione 0071) e le
  // funzioni della piattaforma (0072) sono facoltativi: se una migrazione non è
  // ancora stata eseguita la query senza quei campi continua a funzionare (i
  // campi restano vuoti).
  const COLONNE_BASE = "ragione_sociale, partita_iva, codice_fiscale, indirizzo, codice_sdi, pec, forma_giuridica, anno_costituzione, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione, sito_web, telefono_aziendale, logo_path, software_nome, software_logo_path";
  const { data: profiloCompleto, error: erroreProfilo } = await supabase
    .from("companies")
    .select(`${COLONNE_BASE}, funzioni_direzione, uffici_gestione, funzioni_piattaforma`)
    .eq("user_id", user.id)
    .maybeSingle<Company>();
  let company = profiloCompleto;
  if (erroreProfilo) {
    const { data: senzaPiattaforma, error: erroreSenzaPiattaforma } = await supabase
      .from("companies")
      .select(`${COLONNE_BASE}, funzioni_direzione, uffici_gestione`)
      .eq("user_id", user.id)
      .maybeSingle<Company>();
    company = senzaPiattaforma;
    if (erroreSenzaPiattaforma) {
      ({ data: company } = await supabase.from("companies").select(COLONNE_BASE).eq("user_id", user.id).maybeSingle<Company>());
    }
  }

  // Anteprima dei loghi già caricati: il bucket è privato, quindi un URL firmato
  // di breve durata. I percorsi vengono dalla riga dell'utente stesso, mai da
  // input esterni; un file mancante dà semplicemente nessuna anteprima.
  const admin = createAdminClient();
  const urlFirmato = async (percorso: string | null | undefined) => {
    if (!percorso) return null;
    const { data } = await admin.storage.from("company-assets").createSignedUrl(percorso, 3600);
    return data?.signedUrl ?? null;
  };
  const [logoUrl, softwareLogoUrl] = await Promise.all([urlFirmato(company?.logo_path), urlFirmato(company?.software_logo_path)]);

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Profilo azienda</h1>
      <p className="omnia-app-sottotitolo">
        Questi dati vengono salvati in modo permanente sul tuo account e verranno usati da OMNIA AI
        per l&apos;analisi delle gare e la generazione dei contenuti. Puoi aggiornarli in qualsiasi
        momento.
      </p>

      <CompanyProfileForm company={company ?? null} logoUrl={logoUrl} softwareLogoUrl={softwareLogoUrl} />
    </div>
  );
}
