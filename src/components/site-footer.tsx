import Link from "next/link";
import CookiePreferencesLink from "./cookie-preferences-link";

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-cream-soft">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-8 text-center text-xs text-sage sm:flex-row sm:justify-between sm:text-left sm:px-6">
        <p>
          Omnia Consulting SRLS —{" "}
          <a href="mailto:info@omniaitalia.com" className="hover:text-ink">
            info@omniaitalia.com
          </a>
        </p>
        <nav className="flex flex-wrap justify-center gap-4">
          <Link href="/privacy" className="hover:text-ink">
            Privacy policy
          </Link>
          <Link href="/cookie-policy" className="hover:text-ink">
            Cookie policy
          </Link>
          <Link href="/condizioni-vendita" className="hover:text-ink">
            Condizioni di vendita
          </Link>
          <CookiePreferencesLink />
        </nav>
      </div>
    </footer>
  );
}
