// Mutazioni della correzione di «Monitorate» con le fonti nascoste (fase B4, B1, 23/11/2026, documento 47 §3.1): ognuna altera UN punto e
// deve cadere sul controllo indicato di scripts/verifica-monitorate-fonti-nascoste.ts (motore comune con tempo massimo e ripristino dal buffer).
// Uso: node scripts/mutazioni-monitorate-fonti-nascoste.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eseguiMutazioni } from "./lib/esegui-mutazioni.mjs";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPP = "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita";
const M = `${OPP}/monitorate/page.tsx`;
const AGG = `${OPP}/aggiunta/[id]/page.tsx`;
const F = "src/lib/radar/fonti-gara-calcoli.ts";
const S = "src/lib/radar/gara.ts";
const AZ = "src/app/actions/radar.ts";
const GS = `${OPP}/gara/[id]/page.tsx`;
const RIC = "src/lib/radar/ricerca.ts";

const MUTAZIONI = [
  // 1. Monitorate: filtro delle fonti nelle due letture
  { nome: "MM1 prima lettura delle gare senza filtro delle fonti", file: M, cerca: '.in("id", idProcedure).overlaps("fonti", visibili);', con: '.in("id", idProcedure);', richiede: "MN1." },
  { nome: "MM2 seconda lettura (classificazioni non leggibili) senza filtro", file: M, cerca: '.in("id", idProcedure).overlaps("fonti", visibili).returns<RigaRisultato[]>()', con: '.in("id", idProcedure).returns<RigaRisultato[]>()', richiede: "MN10." },
  { nome: "MM3 fonti nascoste ignorate (tutte visibili)", file: M, cerca: "const visibili = fontiVisibiliDa(await fontiNascosteAiClienti());", con: "const visibili = fontiVisibiliDa([]);", richiede: "MN1." },
  { nome: "MM4 filtro di troppo: la PVL tolta anche quando è visibile", file: M, cerca: '.in("id", idProcedure).overlaps("fonti", visibili);', con: '.in("id", idProcedure).overlaps("fonti", visibili.filter((f) => f !== "pvl"));', richiede: "MN8." },
  // 1. Monitorate: raggruppamento solo sulle gare lette
  { nome: "MM5 gara mostrata anche se non letta (nascosta)", file: M, cerca: "return m && procedure.has(m) ? m : undefined;", con: "return m;", richiede: "MN3." },
  { nome: "MM6 raggruppamento sulle gare non filtrate", file: M, cerca: "unoPerGaraMostrata(salvate, (s) => garaMostrata(s.procedura_id) ?? garaMostrata(", con: "unoPerGaraMostrata(salvate, (s) => mostrata(s.procedura_id) ?? mostrata(", richiede: "MN3." },
  // 2. etichetta: mai TED presunta
  { nome: "MM7 Monitorate: torna il ripiego su TED", file: M, cerca: "fonte: etichettaFontiElenco(fontiGare.get(p.id)),", con: 'fonte: etichettaFontiElenco(fontiGare.get(p.id) ?? ["ted"]),', richiede: "MN2." },
  { nome: "MM8 Cerca: torna il ripiego su TED", file: `${OPP}/cerca/page.tsx`, cerca: "fonte: etichettaFontiElenco(fontiGare.get(r.id)),", con: 'fonte: etichettaFontiElenco(fontiGare.get(r.id) ?? ["ted"]),', richiede: "MN17." },
  { nome: "MM9 Per te: torna il ripiego su TED", file: `${OPP}/per-te/page.tsx`, cerca: "fonte: etichettaFontiElenco(fontiGare.get(r.id)),", con: 'fonte: etichettaFontiElenco(fontiGare.get(r.id) ?? ["ted"]),', richiede: "MN17." },
  { nome: "MM10 etichetta: senza fonti lette «TED»", file: F, cerca: "etichettaFonti(fonti) : FONTE_NON_INDICATA;", con: 'etichettaFonti(fonti) : "TED";', richiede: "MN2." },
  { nome: "MM11 etichetta: elenco vuoto non riconosciuto", file: F, cerca: "return fonti && fonti.length > 0 ? etichettaFonti(fonti)", con: "return fonti && fonti.length >= 0 ? etichettaFonti(fonti)", richiede: "MN16." },
  // 3. pagina dell'aggiunta a mano
  { nome: "MM12 aggiunta: passaggio alla scheda senza controllo", file: AGG, cerca: "if (a.procedura_id && (await schedaGaraApribile(createAdminClient(), a.procedura_id))) redirect(", con: "if (a.procedura_id) redirect(", richiede: "MN11." },
  { nome: "MM13 schedaGaraApribile: visibilità ignorata", file: S, cerca: "  return garaVisibileAiClienti(data, new Set(await fontiNascosteAiClienti()));\n}", con: "  return true;\n}", richiede: "MN11." },
  { nome: "MM14 schedaGaraApribile: mai apribile (filtro di troppo)", file: S, cerca: "  return garaVisibileAiClienti(data, new Set(await fontiNascosteAiClienti()));\n}", con: "  return false;\n}", richiede: "MN13." },
  { nome: "MM15 schedaGaraApribile: la copia collegata non si segue", file: S, cerca: "  if (!error && data?.unita_a) ({ data, error } = await leggi(data.unita_a));\n", con: "", richiede: "MN12." },
  { nome: "MM16 schedaGaraApribile: errore di lettura = apribile", file: S, cerca: "  if (error || !data) return false;\n  return garaVisibileAiClienti(", con: "  if (error || !data) return true;\n  return garaVisibileAiClienti(", richiede: "MN15." },
  // punto a (coordinamento 23/11): fonte sconosciuta = non visibile
  { nome: "MM17 fonte sconosciuta di nuovo visibile", file: F, cerca: "return fonti.some((f) => eFonte(f) && !nascoste.has(f));", con: "return fonti.some((f) => !nascoste.has(f));", richiede: "MN19." },
  { nome: "MM18 senza fonti, la chiave sconosciuta presunta TED", file: F, cerca: "g.fonti && g.fonti.length > 0 ? g.fonti : [g.chiave.split(\":\")[0]];", con: "g.fonti && g.fonti.length > 0 ? g.fonti : [\"ted\"];", richiede: "MN19." },
  // punto b: «salva», «monitora», «aggiungi a mano»
  {
    nome: "MM19 salva/monitora: torna il solo controllo di esistenza",
    file: AZ,
    cerca: '  if (proceduraId && !(await schedaGaraApribile(createAdminClient(), proceduraId))) return { errore: "Gara non trovata." };',
    con: '  if (proceduraId) {\n    const { data: esiste } = await createAdminClient().from("radar_procedure").select("id").eq("id", proceduraId).maybeSingle();\n    if (!esiste) return { errore: "Gara non trovata." };\n  }',
    richiede: "MN21.",
  },
  { nome: "MM20 controllo di visibilità solo per «salva»", file: AZ, cerca: "if (proceduraId && !(await schedaGaraApribile(createAdminClient(), proceduraId)))", con: 'if (proceduraId && azione === "salva" && !(await schedaGaraApribile(createAdminClient(), proceduraId)))', richiede: "MN21." },
  { nome: "MM21 rifiuto di troppo: ogni gara «non trovata»", file: AZ, cerca: "if (proceduraId && !(await schedaGaraApribile(createAdminClient(), proceduraId)))", con: "if (proceduraId && true)", richiede: "MN23." },
  { nome: "MM22 aggiungi: CIG di una gara nascosta salvato e aperto", file: AZ, cerca: "if (lotto && (await schedaGaraApribile(admin, lotto.procedura_id))) {", con: "if (lotto) {", richiede: "MN24." },
  { nome: "MM23 aggiungi: rifiuto di troppo, ogni CIG come non pubblicato", file: AZ, cerca: "if (lotto && (await schedaGaraApribile(admin, lotto.procedura_id))) {", con: "if (lotto && false) {", richiede: "MN25." },
  // scheda: nessuna fonte riconosciuta (seguito di 60825a1 di B2)
  { nome: "MM24 sintesi: torna «TED» per ripiego", file: GS, cerca: 'fontiMostrate[0] ? NOME_FONTE[fontiMostrate[0]] : "fonte non riconosciuta",', con: 'fontiMostrate[0] ? NOME_FONTE[fontiMostrate[0]] : "TED",', richiede: "MN26." },
  { nome: "MM25 sintesi: numero di avviso anche senza fonti riconosciute", file: GS, cerca: "numeroAvviso: fontiMostrate.length !== 1 ||", con: "numeroAvviso: fontiMostrate.length > 1 ||", richiede: "MN26." },
  { nome: "MM26 riquadro «Fonte» vuoto", file: GS, cerca: 'etichettaFonti(fonti) || "Fonte non riconosciuta"', con: "etichettaFonti(fonti)", richiede: "MN26." },
  { nome: "MM27 nota «Fonti: .»", file: GS, cerca: '.join("; ") || "non riconosciuta"}', con: '.join("; ")}', richiede: "MN26." },
  { nome: "MM28 cambio di troppo: anche una fonte riconosciuta diventa «non riconosciuta»", file: GS, cerca: 'fontiMostrate[0] ? NOME_FONTE[fontiMostrate[0]] : "fonte non riconosciuta",', con: 'false ? NOME_FONTE[fontiMostrate[0]] : "fonte non riconosciuta",', richiede: "MN27." },
  // direttiva 48A: PVL visibile in Cerca, Per te, scheda; meccanismo delle fonti nascoste; Notifiche indipendente dalle fonti
  { nome: "MM29 ricerca senza filtro delle fonti visibili", file: RIC, cerca: '.is("unita_a", null).overlaps("fonti", visibili)', con: '.is("unita_a", null)', richiede: "MN30." },
  { nome: "MM30 ricerca: PVL esclusa anche quando è visibile", file: RIC, cerca: "const visibili = fontiVisibiliDa(await (opzioni.fontiNascoste ?? fontiNascosteAiClienti)());", con: 'const visibili = fontiVisibiliDa(await (opzioni.fontiNascoste ?? fontiNascosteAiClienti)()).filter((f) => f !== "pvl");', richiede: "MN28." },
  { nome: "MM31 «Per te»: etichetta senza la PVL", file: `${OPP}/per-te/page.tsx`, cerca: "fonte: etichettaFontiElenco(fontiGare.get(r.id)),", con: 'fonte: etichettaFontiElenco(fontiGare.get(r.id)?.filter((f) => f !== "pvl")),', richiede: "MN29." },
  { nome: "MM32 «Cerca»: etichetta senza la PVL", file: `${OPP}/cerca/page.tsx`, cerca: "fonte: etichettaFontiElenco(fontiGare.get(r.id)),", con: 'fonte: etichettaFontiElenco(fontiGare.get(r.id)?.filter((f) => f !== "pvl")),', richiede: "MN28." },
  { nome: "MM33 fonti degli elenchi lette anche quando nascoste", file: S, cerca: '.in("procedura_id", proceduraIds).in("fonte", visibili)', con: '.in("procedura_id", proceduraIds)', richiede: "MN30." },
  { nome: "MM34 fonti delle copie collegate non attribuite alla gara che resta", file: S, cerca: "for (const r of extra ?? []) righe.push(", con: "for (const r of [] as { procedura_id: string; fonte: FonteGara }[]) righe.push(", richiede: "MN28." },
  { nome: "MM35 scheda: avvisi delle copie collegate non mostrati", file: S, cerca: "[...(provenienze.data ?? []), ...avvisiCollegati]", con: "[...(provenienze.data ?? [])]", richiede: "MN32." },
  { nome: "MM36 scheda: avvisi di una fonte nascosta mostrati", file: S, cerca: "...avvisiCollegati].filter((p) => !nascoste.has(p.fonte)).sort(", con: "...avvisiCollegati].sort(", richiede: "MN33." },
  {
    nome: "MM37 «Notifiche» legge la visibilità delle fonti",
    file: `${OPP}/notifiche/page.tsx`,
    cerca: 'import { notFound } from "next/navigation";',
    con: 'import { notFound } from "next/navigation";\nimport { fontiNascosteAiClienti } from "@/lib/radar/fonti-nascoste";\nvoid fontiNascosteAiClienti;',
    richiede: "MN34.",
  },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-monitorate-fonti-nascoste.ts", mutazioni: MUTAZIONI, tempoMassimoMs: 120_000 }));
