import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MessageForm from "./message-form";

type Message = {
  id: string;
  sender: string;
  body: string;
  created_at: string;
};

export default async function MessaggiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender, body, created_at")
    .order("created_at", { ascending: true });

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <Link
          href="/dashboard"
          className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
        >
          ← Dashboard
        </Link>

        <h1 className="mt-4 font-serif text-3xl text-ink">Messaggi</h1>
        <p className="mt-2 text-justify text-sm text-sage">
          Scrivici per qualunque domanda su documenti, ordini o fatture: ti
          risponderemo qui e via email.
        </p>

        <div className="mt-8 space-y-3 rounded-2xl border border-border bg-cream-soft p-5">
          {messages?.length ? (
            (messages as Message[]).map((m) => (
              <div
                key={m.id}
                className={`flex ${m.sender === "cliente" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.sender === "cliente"
                      ? "bg-forest text-cream"
                      : "border border-border bg-cream text-ink"
                  }`}
                >
                  <p className="text-justify">{m.body}</p>
                  <p
                    className={`mt-1 text-[10px] ${
                      m.sender === "cliente" ? "text-cream/70" : "text-sage"
                    }`}
                  >
                    {new Date(m.created_at).toLocaleString("it-IT")}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-sage">
              Nessun messaggio ancora. Scrivici qui sotto.
            </p>
          )}
        </div>

        <MessageForm />
      </div>
    </main>
  );
}
