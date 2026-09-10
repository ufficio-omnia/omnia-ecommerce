import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getBankDetails } from "@/lib/bank-details";
import { updateBankDetails } from "@/app/actions/bank-details";

export const metadata: Metadata = {
  title: "Dati bancari",
  robots: { index: false, follow: false },
};

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm text-ink focus:border-forest focus:outline-none";

export default async function AdminImpostazioniPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  const bank = await getBankDetails();

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-3xl text-ink">Dati bancari</h1>
          <Link
            href="/admin"
            className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
          >
            Torna al pannello admin
          </Link>
        </div>
        <p className="mt-2 text-sm text-sage">
          Questi dati vengono mostrati ai clienti che scelgono il pagamento
          con bonifico bancario (area riservata) e inviati via email subito
          dopo l&apos;ordine.
        </p>

        <form
          action={updateBankDetails}
          className="mt-8 space-y-4 rounded-2xl border border-border bg-cream-soft p-5"
        >
          <div>
            <label htmlFor="iban" className="block text-sm font-medium text-ink">
              IBAN
            </label>
            <input
              id="iban"
              name="iban"
              type="text"
              defaultValue={bank.iban}
              required
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="intestatario"
              className="block text-sm font-medium text-ink"
            >
              Intestatario
            </label>
            <input
              id="intestatario"
              name="intestatario"
              type="text"
              defaultValue={bank.intestatario}
              required
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            className="rounded-full bg-forest px-4 py-2.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
          >
            Salva
          </button>
        </form>
      </div>
    </main>
  );
}
