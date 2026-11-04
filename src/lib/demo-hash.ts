import { createHash, createHmac } from "node:crypto";

// Cifrature della richiesta di demo (solo SERVER: non importare mai in un componente del browser).

// SHA-256 in esadecimale: l'email normalizzata che si manda a Google Ads (Data Manager API, «encoding: HEX»).
export function sha256Hex(testo: string): string {
  return createHash("sha256").update(testo, "utf8").digest("hex");
}

// L'indirizzo IP non si salva mai: si salva solo questo hash con un segreto (HMAC-SHA256), che serve a contare le richieste di uno
// stesso indirizzo (limite anti-abuso) senza poter risalire all'indirizzo.
export function hashIp(ip: string, segreto: string): string {
  return createHmac("sha256", segreto).update(ip.trim()).digest("hex");
}
