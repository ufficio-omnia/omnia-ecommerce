// Definizioni delle attività dell'Utilità di pianificazione di Windows per i giri dello STAGING (decisione dell'utente del 23/11,
// documento 54A; documento 54 §2). Una attività per fonte, con un innesco per ogni orario di ORARI_GIRI (programmazione-calcoli.ts, D2/D5),
// in ora LOCALE del computer (fuso «W. Europe Standard Time» = ora di Roma, cambio dell'ora compreso). Le attività nascono SPENTE:
// accenderle è un passo di attivazione separato, con l'autorizzazione e la conferma dell'utente. Nessuna attività viene creata da qui.
//   npx tsx scripts/pianificazione/genera-attivita.ts <cartella di uscita> <cartella della pianificazione> <primo giorno AAAA-MM-GG>
// Scrive <fonte>.xml (UTF-16, come vuole schtasks /XML) e comandi-schtasks.txt (creare, accendere, spegnere, togliere, controllare).
import fs from "fs";
import path from "path";
import { ORARI_GIRI } from "../../src/lib/radar/programmazione-calcoli";
import { FONTI_PIANIFICATE } from "./pianificazione-calcoli.mjs";

export const NODE = "C:\\Program Files\\nodejs\\node.exe";
export const CARTELLA_ATTIVITA = "\\OMNIA\\";
export const nomeAttivita = (fonte: string) => `${CARTELLA_ATTIVITA}Radar staging ${fonte}`;
const GIORNI_FERIALI = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const GIORNI_FINE_SETTIMANA = ["Saturday", "Sunday"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function innesco(giorno: string, ora: string, giorni: "tutti" | "feriali" | "fine_settimana"): string {
  const inizio = `<StartBoundary>${giorno}T${ora}:00</StartBoundary><Enabled>true</Enabled>`;
  if (giorni === "tutti") return `    <CalendarTrigger>${inizio}<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
  const elenco = (giorni === "feriali" ? GIORNI_FERIALI : GIORNI_FINE_SETTIMANA).map((d) => `<${d} />`).join("");
  return `    <CalendarTrigger>${inizio}<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${elenco}</DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
}

/** Il testo XML dell'attività di una fonte (senza intestazione di codifica: la aggiunge chi scrive il file). */
export function xmlAttivita(fonte: string, p: { cartella: string; giorno: string; node?: string }): string {
  if (!(FONTI_PIANIFICATE as readonly string[]).includes(fonte)) throw new Error(`fonte sconosciuta: ${fonte}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.giorno)) throw new Error(`giorno non valido: ${p.giorno}`);
  const cartella = p.cartella.replace(/\//g, "\\").replace(/\\+$/, "");
  const orari = ORARI_GIRI[fonte as keyof typeof ORARI_GIRI];
  return [
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <RegistrationInfo><Description>${esc(`OMNIA Tender Intelligence: giro di ${fonte} sullo STAGING (documento 54). Parte solo con un'autorizzazione valida nel registro; nasce spenta.`)}</Description></RegistrationInfo>`,
    `  <Triggers>`,
    ...orari.map((o) => innesco(p.giorno, o.ora, o.giorni)),
    `  </Triggers>`,
    `  <Principals><Principal id="Autore"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <AllowHardTerminate>false</AllowHardTerminate>`,
    `    <StartWhenAvailable>false</StartWhenAvailable>`,
    `    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>`,
    `    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>`,
    `    <AllowStartOnDemand>true</AllowStartOnDemand>`,
    `    <Enabled>false</Enabled>`,
    `    <Hidden>false</Hidden>`,
    `    <RunOnlyIfIdle>false</RunOnlyIfIdle>`,
    `    <WakeToRun>false</WakeToRun>`,
    `    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>`,
    `    <Priority>7</Priority>`,
    `  </Settings>`,
    `  <Actions Context="Autore"><Exec><Command>${esc(p.node ?? NODE)}</Command><Arguments>${esc(`"${cartella}\\scripts\\pianificazione\\lancia-giro-pianificato.mjs" ${fonte}`)}</Arguments><WorkingDirectory>${esc(cartella)}</WorkingDirectory></Exec></Actions>`,
    `</Task>`,
  ].join("\r\n");
}

/** I comandi per l'operatore (in PowerShell o nel prompt): creare spente, accendere, spegnere, togliere, controllare. */
export function comandiSchtasks(cartellaXml: string): string {
  const righe = (fn: (f: string) => string) => FONTI_PIANIFICATE.map(fn).join("\n");
  const xml = cartellaXml.replace(/\//g, "\\").replace(/\\+$/, "");
  return [
    "# Attività della pianificazione dello staging (documento 54). Ogni blocco è un passo separato, con la sua autorizzazione.",
    "# 1) Creare le attività, SPENTE (non partono finché non si accendono):",
    righe((f) => `schtasks /Create /TN "${nomeAttivita(f)}" /XML "${xml}\\${f}.xml"`),
    "# 2) Accendere UNA fonte (solo con la sua autorizzazione da 72 ore registrata e la conferma dell'utente):",
    righe((f) => `schtasks /Change /TN "${nomeAttivita(f)}" /ENABLE`),
    "# 3) Spegnere (subito, in qualunque momento; il giro in corso finisce da solo):",
    righe((f) => `schtasks /Change /TN "${nomeAttivita(f)}" /DISABLE`),
    "# 4) Togliere del tutto:",
    righe((f) => `schtasks /Delete /TN "${nomeAttivita(f)}" /F`),
    "# 5) Controllare stato, ultimo e prossimo avvio:",
    righe((f) => `schtasks /Query /TN "${nomeAttivita(f)}" /V /FO LIST`),
    "",
  ].join("\n");
}

if (process.argv[1] && /genera-attivita\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const [uscita, cartella, giorno] = process.argv.slice(2);
  if (!uscita || !cartella || !giorno) {
    console.error("uso: npx tsx scripts/pianificazione/genera-attivita.ts <cartella di uscita> <cartella della pianificazione> <primo giorno AAAA-MM-GG>");
    process.exit(2);
  }
  fs.mkdirSync(uscita, { recursive: true });
  for (const f of FONTI_PIANIFICATE) {
    const testo = `<?xml version="1.0" encoding="UTF-16"?>\r\n${xmlAttivita(f, { cartella, giorno })}\r\n`;
    fs.writeFileSync(path.join(uscita, `${f}.xml`), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(testo, "utf16le")]));
  }
  fs.writeFileSync(path.join(uscita, "comandi-schtasks.txt"), comandiSchtasks(uscita));
  console.log(`Scritte le definizioni di ${FONTI_PIANIFICATE.length} attività (spente) e comandi-schtasks.txt in ${uscita}`);
}
