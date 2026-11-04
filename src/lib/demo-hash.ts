import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Cifrature della richiesta di demo (solo SERVER: non importare mai in un componente del browser).

// SHA-256 in esadecimale: l'email normalizzata che si manda a Google Ads (Data Manager API, «encoding: HEX») e l'impronta dei testi dei consensi.
export function sha256Hex(testo: string): string {
  return createHash("sha256").update(testo, "utf8").digest("hex");
}

// L'indirizzo IP non si salva mai: si salva solo questo hash con un segreto (HMAC-SHA256), che serve a contare le richieste di uno
// stesso indirizzo (limite anti-abuso) senza poter risalire all'indirizzo.
export function hashIp(ip: string, segreto: string): string {
  return createHmac("sha256", segreto).update(ip.trim()).digest("hex");
}

// Firma di una riga del registro dei consensi (HMAC-SHA256 con un segreto del server): chi non ha il segreto non può fabbricare né
// alterare una riga senza che la firma smetta di tornare.
export function firmaConsenso(stringa: string, segreto: string): string {
  return createHmac("sha256", segreto).update(stringa, "utf8").digest("hex");
}

export function firmaConsensoValida(stringa: string, firma: string | null, segreto: string): boolean {
  if (!firma || !/^[0-9a-f]{64}$/.test(firma)) return false;
  const attesa = Buffer.from(firmaConsenso(stringa, segreto), "hex");
  const ricevuta = Buffer.from(firma, "hex");
  return attesa.length === ricevuta.length && timingSafeEqual(attesa, ricevuta);
}

// Il segreto della firma dei consensi: uno dedicato; in mancanza, gli stessi segreti già usati per l'hash degli indirizzi. Senza nessuno
// la firma non si calcola (la riga resta valida ma «non firmata»: la guida dice di impostarlo).
export function segretoFirmaConsensi(env: Record<string, string | undefined>): string | null {
  return env.DEMO_CONSENT_SIGNING_SECRET?.trim() || env.DEMO_LEADS_HASH_SECRET?.trim() || env.CRON_SECRET?.trim() || null;
}
