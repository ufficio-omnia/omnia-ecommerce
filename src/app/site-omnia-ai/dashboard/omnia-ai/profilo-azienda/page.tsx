import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CompanyProfileForm from "./company-profile-form";

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
};

export default async function ProfiloAziendaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: company } = await supabase
    .from("companies")
    .select(
      "ragione_sociale, partita_iva, codice_fiscale, indirizzo, codice_sdi, pec, forma_giuridica, anno_costituzione, numero_dipendenti, fatturato_medio_annuo, certificazioni, referenze, settori_attivita, presentazione, sito_web, telefono_aziendale, logo_path, software_nome, software_logo_path",
    )
    .eq("user_id", user.id)
    .maybeSingle<Company>();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <Link
          href="/dashboard/omnia-ai"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← OMNIA AI
        </Link>

        <h1 className="mt-4 font-serif text-3xl text-ink">Profilo azienda</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Questi dati vengono salvati in modo permanente sul tuo account e
          verranno usati da OMNIA AI per l&apos;analisi delle gare e la
          generazione dei contenuti. Puoi aggiornarli in qualsiasi momento.
        </p>

        <CompanyProfileForm company={company ?? null} />
      </div>
    </main>
  );
}
