import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  DEV_ZONE_COOKIE,
  RESERVED_PREFIXES,
  ZONE_COOKIE,
  ZONE_HEADER,
  ZONE_PREFIX,
  ZONE_RECOGNIZED_HEADER,
  ZONE_REWRITE_EXEMPT_PATHS,
  isRecognizedHost,
  isZone,
  zoneFromHost,
  type Zone,
} from "@/lib/zone";

const IS_DEV = process.env.NODE_ENV !== "production";

// Path garantito senza corrispondenza (prefisso "_" = cartella privata,
// esclusa dal routing di Next per convenzione): usato per forzare un 404
// reale (non un redirect) quando l'e-commerce riceve una richiesta per
// uno dei prefissi interni riservati alle altre zone.
const ZONE_GUARD_NOT_FOUND_PATH = "/__omnia-zone-guard-404__";

// "recognized" distingue l'host REALE (o, in sviluppo, un override
// scelto di proposito) da un host sconosciuto che ricade comunque sulla
// zona "ecommerce" per il ROUTING — usato solo da robots.ts, che deve
// trattarli diversamente (vedi ZONE_RECOGNIZED_HEADER in src/lib/zone.ts).
function resolveZone(request: NextRequest): { zone: Zone; recognized: boolean } {
  if (IS_DEV) {
    const override = request.nextUrl.searchParams.get("__zone");
    if (override === "reset") return { zone: "ecommerce", recognized: false };
    if (isZone(override)) return { zone: override, recognized: true };

    const cookieOverride = request.cookies.get(DEV_ZONE_COOKIE)?.value;
    if (isZone(cookieOverride)) return { zone: cookieOverride, recognized: true };
  }

  const host = request.headers.get("host");
  return { zone: zoneFromHost(host), recognized: isRecognizedHost(host) };
}

export async function proxy(request: NextRequest) {
  const { zone, recognized } = resolveZone(request);

  // Inoltrati alla richiesta upstream (non alla risposta): permettono a
  // un Server Component come src/app/robots.ts di conoscere la zona già
  // risolta PER QUESTA richiesta, senza il ritardo di un giro del cookie
  // ZONE_COOKIE (che riflette solo la richiesta precedente).
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(ZONE_HEADER, zone);
  forwardedHeaders.set(ZONE_RECOGNIZED_HEADER, recognized ? "1" : "0");
  const requestInit = { headers: forwardedHeaders };

  const sessionResponse = await updateSession(request);

  // Un redirect (es. verso /login) vince sempre: mai sovrapporre un
  // rewrite di zona sopra un redirect.
  if (sessionResponse.headers.has("location")) {
    return sessionResponse;
  }

  // robots.txt e sitemap.xml devono restare raggiungibili al path
  // canonico su qualunque dominio: ragionano da soli sulla zona (vedi
  // src/app/robots.ts, sitemap.ts) e un crawler non li cercherebbe mai
  // sotto un prefisso di zona.
  const isSeoExemptPath = ZONE_REWRITE_EXEMPT_PATHS.includes(request.nextUrl.pathname);

  let response: NextResponse;

  if (
    !isSeoExemptPath &&
    zone === "ecommerce" &&
    RESERVED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  ) {
    // I prefissi interni (/site-omnia-ai, /site-console) sono cartelle
    // reali: senza questa guardia sarebbero raggiungibili digitandoli a
    // mano da app.omniaitalia.com.
    response = NextResponse.rewrite(new URL(ZONE_GUARD_NOT_FOUND_PATH, request.url), { request: requestInit });
  } else if (
    !isSeoExemptPath &&
    zone !== "ecommerce" &&
    !request.nextUrl.pathname.startsWith(ZONE_PREFIX[zone])
  ) {
    // Riscrive SOLO se il path non ha già il prefisso di zona — un file
    // generato sotto quel prefisso (es. apple-icon di next/og) porta il
    // prefisso già nel proprio URL reale, prefissarlo di nuovo darebbe
    // /site-omnia-ai/site-omnia-ai/... e un 404 (bug osservato in pratica).
    const zoneUrl = new URL(
      `${ZONE_PREFIX[zone]}${request.nextUrl.pathname}${request.nextUrl.search}`,
      request.url,
    );
    response = NextResponse.rewrite(zoneUrl, { request: requestInit });
  } else {
    // Nessun rewrite di percorso necessario, ma la richiesta upstream
    // porta comunque l'header di zona (vedi sopra) — per questo si
    // ricostruisce comunque la response invece di riusare sessionResponse
    // così com'è.
    response = NextResponse.next({ request: requestInit });
  }

  // response è sempre un oggetto NextResponse nuovo (serve comunque per
  // portare l'header di zona sulla richiesta upstream, vedi sopra): i
  // cookie di sessione impostati da updateSession vivono sull'oggetto
  // precedente e non si ereditano automaticamente, vanno ricopiati
  // esplicitamente (con l'overload a oggetto intero, non set(name,
  // value), per non perdere httpOnly/secure/sameSite/maxAge).
  for (const cookie of sessionResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }

  if (IS_DEV) {
    const override = request.nextUrl.searchParams.get("__zone");
    if (override === "reset") {
      response.cookies.delete(DEV_ZONE_COOKIE);
    } else if (isZone(override)) {
      response.cookies.set(DEV_ZONE_COOKIE, override, { path: "/" });
    }
  }

  response.cookies.set(ZONE_COOKIE, zone, { path: "/" });

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|otf|eot)$).*)",
  ],
};
