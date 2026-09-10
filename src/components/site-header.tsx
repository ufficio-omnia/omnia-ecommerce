import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    isAdmin = profile?.role === "admin";
  }

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-cream-soft/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omnia-logo.png" alt="" className="h-8 w-8" />
          <span className="font-serif text-lg font-semibold tracking-tight text-ink">
            OMNIA
          </span>
        </Link>

        <nav className="flex items-center gap-3 sm:gap-5">
          <a
            href="https://omniaitalia.com"
            className="hidden font-mono text-xs tracking-wide text-sage uppercase hover:text-ink sm:inline"
          >
            Consulenza e servizi
          </a>
          <Link
            href="/prodotti"
            className="hidden font-mono text-xs tracking-wide text-sage uppercase hover:text-ink sm:inline"
          >
            Documenti
          </Link>

          {user ? (
            <>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="hidden font-mono text-xs tracking-wide text-sage uppercase hover:text-ink sm:inline"
                >
                  Admin
                </Link>
              )}
              <Link
                href="/dashboard"
                className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
              >
                Area riservata
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
                >
                  Esci
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
              >
                Accedi
              </Link>
              <Link
                href="/registrati"
                className="rounded-full bg-forest px-4 py-1.5 font-mono text-xs tracking-wide text-cream uppercase transition-colors hover:bg-forest-dark"
              >
                Registrati
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
