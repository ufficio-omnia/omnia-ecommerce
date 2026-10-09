// Autotest del profilo azienda: loghi visibili e sostituibili. Gratuito, nessun
// database né rete: controlla il collegamento fra azione di salvataggio, pagina,
// modulo e anteprima (gira nel livello 1, quindi in prebuild).
import fs from "fs";
import path from "path";

const fallimenti: string[] = [];
function atteso(nome: string, ok: boolean, dettaglio = "") {
  console.log(`${ok ? "ok    " : "FALLITO"} ${nome}${ok ? "" : ` — ${dettaglio}`}`);
  if (!ok) fallimenti.push(nome);
}
const leggi = (relativo: string) => fs.readFileSync(path.join(__dirname, "..", relativo), "utf-8").replace(/\r\n/g, "\n");

const azione = leggi("src/app/actions/company-profile.ts");
const pagina = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/page.tsx");
const modulo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/company-profile-form.tsx");
const campo = leggi("src/app/site-omnia-ai/dashboard/omnia-ai/profilo-azienda/logo-campo.tsx");

// Il difetto da non reintrodurre: un caricamento fallito restituiva null e il
// salvataggio scriveva logo_path = null, cancellando il logo già presente.
atteso("azione: un formato non ammesso è un errore detto all'utente, non un null silenzioso", /non è un formato supportato/.test(azione) && !/return null;\s*\n\s*const path/.test(azione));
atteso("azione: un file oltre il limite è un errore (5 MB)", /LIMITE_BYTE_LOGO = 5 \* 1024 \* 1024/.test(azione) && /supera i 5 MB/.test(azione));
atteso("azione: se il caricamento fallisce si esce con l'errore PRIMA di salvare il profilo (il logo che c'è resta)", /if \("error" in esito\) return \{ error: esito\.error \};/.test(azione) && azione.indexOf('"error" in esito') < azione.indexOf('.upsert('));
atteso("azione: il percorso del logo si scrive solo se c'è un file nuovo caricato", /\.\.\.\(logoPath !== undefined \? \{ logo_path: logoPath \} : \{\}\)/.test(azione) && /\.\.\.\(softwareLogoPath !== undefined \? \{ software_logo_path: softwareLogoPath \} : \{\}\)/.test(azione));
atteso("azione: il file sostituito con estensione diversa si toglie, senza far fallire il salvataggio", /eliminaLogoSostituito\(attuali\?\.logo_path, logoPath\)/.test(azione) && /eliminaLogoSostituito\(attuali\?\.software_logo_path, softwareLogoPath\)/.test(azione) && /catch \(err\)/.test(azione.slice(azione.indexOf("async function eliminaLogoSostituito"))));
atteso("pagina: anteprima con URL firmato di breve durata dal percorso della riga dell'utente", /createSignedUrl\(percorso, 3600\)/.test(pagina) && /urlFirmato\(company\?\.logo_path\)/.test(pagina) && /urlFirmato\(company\?\.software_logo_path\)/.test(pagina));
atteso("modulo: i due loghi usano il campo con anteprima e hanno gli stessi nomi di campo dell'azione", /name="logo"/.test(modulo) && /name="softwareLogo"/.test(modulo) && /formData\.get\("logo"\)/.test(azione) && /formData\.get\("softwareLogo"\)/.test(azione) && /<LogoCampo/.test(modulo));
atteso("campo: mostra il logo attuale, l'anteprima del nuovo file e permette di annullare", /urlAttuale/.test(campo) && /URL\.createObjectURL/.test(campo) && /URL\.revokeObjectURL/.test(campo) && /Annulla sostituzione/.test(campo));
atteso("campo: dice che il nuovo logo sostituisce quello attuale al salvataggio", /sostituirà quello attuale quando salvi il profilo/.test(campo));

if (fallimenti.length > 0) {
  console.error(`\n${fallimenti.length} controllo/i fallito/i:\n- ${fallimenti.join("\n- ")}`);
  process.exit(1);
}
console.log("\nAutotest del profilo (loghi): tutti i casi ok.");
