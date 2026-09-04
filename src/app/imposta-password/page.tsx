import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPasswordForm from "./set-password-form";

export default async function ImpostaPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-cream-soft p-8">
        <h1 className="font-serif text-2xl text-ink">Imposta la tua password</h1>
        <p className="mt-2 text-sm text-sage">
          Account attivato per <span className="font-medium text-ink">{user.email}</span>.
          Scegli ora una password per accedere in futuro.
        </p>

        <SetPasswordForm />
      </div>
    </main>
  );
}
