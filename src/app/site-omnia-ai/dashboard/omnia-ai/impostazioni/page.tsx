import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ImpostazioniForm from "./impostazioni-form";

// Solo dati account: i dati azienda restano esclusivamente in Profilo
// azienda, non duplicati qui.
export default async function ImpostazioniPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="omnia-app-shell">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Impostazioni</h1>
      <p className="omnia-app-sottotitolo">Email e password di accesso al tuo account.</p>

      <ImpostazioniForm emailAttuale={user.email ?? ""} />
    </div>
  );
}
