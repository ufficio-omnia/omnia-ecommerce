import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AssistenzaChat, { type AssistenzaMessaggio } from "./assistenza-chat";

// Nessun gate di sola scrittura qui (a differenza di gara-chat): questa
// chat non tocca mai la quota gare, deve restare utilizzabile anche in
// sola lettura — solo sessione valida richiesta, come ogni altra pagina.
export default async function AssistenzaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: messaggi } = await supabase
    .from("assistenza_messaggi")
    .select("id, ruolo, contenuto, created_at")
    .order("created_at", { ascending: true })
    .returns<AssistenzaMessaggio[]>();

  return (
    <div className="omnia-app-shell largo">
      <Link href="/dashboard/omnia-ai" className="omnia-torna">
        ← OMNIA AI
      </Link>

      <h1 className="omnia-app-titolo">Assistenza</h1>
      <p className="omnia-messaggio-stato avviso">
        Questo assistente si occupa solo del funzionamento della piattaforma, dell&apos;abbonamento e
        della fatturazione: non fornisce consulenza sui contenuti delle gare. Per quello serve un
        consulente — puoi chiederglielo direttamente in chat.
      </p>

      <AssistenzaChat messaggi={messaggi ?? []} />
    </div>
  );
}
