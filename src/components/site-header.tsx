import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import HeaderNav from "@/components/header-nav";

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
    <header className="sticky top-0 z-20 border-b border-border bg-cream-soft/90 backdrop-blur">
      <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omnia-logo.png" alt="" className="h-8 w-8" />
          <span className="font-serif text-lg font-semibold tracking-tight text-ink">
            OMNIA
          </span>
        </Link>

        <HeaderNav isLoggedIn={!!user} isAdmin={isAdmin} />
      </div>
    </header>
  );
}
