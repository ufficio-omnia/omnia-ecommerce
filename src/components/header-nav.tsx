"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/actions/auth";

const NAV_LINKS = [
  { href: "/prodotti", label: "Documenti pronti" },
  { href: "/offerta-tecnica-gare-appalto-pulizia", label: "Guida gratuita" },
];

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const navLinkClass = (active: boolean) =>
  `font-mono text-sm tracking-wide uppercase transition-colors ${
    active
      ? "text-forest-dark underline decoration-2 underline-offset-4"
      : "text-forest hover:text-forest-dark"
  }`;

const mobileNavLinkClass = (active: boolean) =>
  `flex min-h-11 items-center font-mono text-sm tracking-wide uppercase transition-colors ${
    active ? "text-forest-dark underline decoration-2 underline-offset-4" : "text-forest"
  }`;

export default function HeaderNav({
  isLoggedIn,
  isAdmin,
}: {
  isLoggedIn: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const internalLinks = [
    ...NAV_LINKS,
    ...(isLoggedIn && isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
    ...(isLoggedIn ? [{ href: "/dashboard", label: "Area riservata" }] : []),
  ];

  return (
    <>
      {/* DESKTOP */}
      <nav className="hidden items-center gap-6 lg:flex">
        {internalLinks.map((link) => (
          <Link key={link.href} href={link.href} className={navLinkClass(isActivePath(pathname, link.href))}>
            {link.label}
          </Link>
        ))}

        <div className="ml-2 flex items-center gap-6 border-l border-border-strong pl-6">
          <a
            href="https://omniaitalia.com"
            target="_blank"
            rel="noopener"
            className="font-mono text-xs tracking-wide text-sage uppercase hover:text-ink"
          >
            Omnia Consulting ↗
          </a>

          {isLoggedIn ? (
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full border border-border-strong px-4 py-1.5 font-mono text-xs tracking-wide text-ink uppercase transition-colors hover:bg-ink hover:text-cream"
              >
                Esci
              </button>
            </form>
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
        </div>
      </nav>

      {/* HAMBURGER — solo sotto lg, dove il nav desktop e' nascosto */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Chiudi menu" : "Apri menu"}
        aria-expanded={open}
        className="flex h-11 w-11 shrink-0 flex-col items-center justify-center gap-1.5 lg:hidden"
      >
        <span
          className={`h-0.5 w-6 bg-ink transition-transform ${open ? "translate-y-2 rotate-45" : ""}`}
        />
        <span className={`h-0.5 w-6 bg-ink transition-opacity ${open ? "opacity-0" : ""}`} />
        <span
          className={`h-0.5 w-6 bg-ink transition-transform ${open ? "-translate-y-2 -rotate-45" : ""}`}
        />
      </button>

      {/* PANNELLO MOBILE — posizionato assoluto rispetto al contenitore
          relative della barra (vedi site-header.tsx), cosi' non deve
          conoscere l'altezza esatta dell'header per agganciarsi sotto. */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-10 bg-ink/50 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 top-full z-20 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border bg-cream-soft p-4 shadow-lg lg:hidden">
            <nav className="flex flex-col">
              {internalLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className={mobileNavLinkClass(isActivePath(pathname, link.href))}
                >
                  {link.label}
                </Link>
              ))}

              <a
                href="https://omniaitalia.com"
                target="_blank"
                rel="noopener"
                onClick={close}
                className="mt-2 flex min-h-11 items-center border-t border-border pt-3 font-mono text-sm tracking-wide text-sage uppercase"
              >
                Omnia Consulting ↗
              </a>

              <div className="mt-2 flex items-center gap-3 border-t border-border pt-3">
                {isLoggedIn ? (
                  <form action={signOut} className="w-full">
                    <button
                      type="submit"
                      onClick={close}
                      className="flex min-h-11 w-full items-center justify-center rounded-full border border-border-strong font-mono text-sm tracking-wide text-ink uppercase"
                    >
                      Esci
                    </button>
                  </form>
                ) : (
                  <>
                    <Link
                      href="/login"
                      onClick={close}
                      className="flex min-h-11 flex-1 items-center justify-center font-mono text-sm tracking-wide text-sage uppercase"
                    >
                      Accedi
                    </Link>
                    <Link
                      href="/registrati"
                      onClick={close}
                      className="flex min-h-11 flex-1 items-center justify-center rounded-full bg-forest font-mono text-sm tracking-wide text-cream uppercase"
                    >
                      Registrati
                    </Link>
                  </>
                )}
              </div>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
