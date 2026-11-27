import { NextResponse, type NextRequest } from "next/server";
import { disiscriviConToken } from "@/lib/newsletter/disiscrizione";

// Disiscrizione «in un clic» (RFC 8058): Gmail, Apple Mail e gli altri client mandano un POST all'indirizzo
// dell'intestazione List-Unsubscribe con il corpo «List-Unsubscribe=One-Click». Nessuna pagina, nessuna conferma.
// Un GET (link aperto da un antivirus o da un'anteprima) NON disiscrive: rimanda alla pagina con il pulsante.
export const dynamic = "force-dynamic";

const TOKEN = /^[a-f0-9]{32,64}$/;

export async function POST(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (!TOKEN.test(t)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await disiscriviConToken(t, "disiscrizione in un clic dal client di posta");
  } catch (e) {
    console.error("Newsletter: disiscrizione in un clic non riuscita", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  // risposta uniforme: non rivela se il token esisteva
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  const url = new URL("/newsletter/disiscrizione", request.nextUrl.origin);
  if (TOKEN.test(t)) url.searchParams.set("t", t);
  return NextResponse.redirect(url, 303);
}
