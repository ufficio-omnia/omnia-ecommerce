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
const TG = "src/lib/radar/tipo-gara-calcoli.ts";
const RC = "src/lib/radar/ricerca-calcoli.ts";
const RG = "src/components/omnia-ai/opportunita/riga-gara.tsx";
const CA = "src/app/site-console/azioni/tender-intelligence.ts";
const CV = "src/app/site-console/_componenti/tender-intelligence-vista.tsx";
const LT = "src/lib/radar/classificazioni-lettura.ts";
const GV = "src/lib/console/gare-in-verifica.ts";
const GVC = "src/lib/console/gare-in-verifica-calcoli.ts";
const GVV = "src/app/site-console/_componenti/gare-in-verifica.tsx";
const CL = "src/lib/console/tender-intelligence.ts";
const ST = "src/lib/radar/settori.ts";

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
  // analisi 49: C4 (tipo dall'avviso), C5 (tipo nelle liste e filtro in «Cerca»), C11 («Avviso di preinformazione»)
  { nome: "MM38 C4: niente ripiego sul tipo dell'avviso", file: TG, cerca: "colonna === null ? (opportunitaDaTipoAvviso(g.tipo_avviso)?.tipo ?? null) :", con: "colonna === null ? null :", richiede: "MT1." },
  { nome: "MM39 C11: la preinformazione torna «Bando di gara»", file: TG, cerca: 'return tipo === "bando" && ePreinformazione(g.tipo_avviso) ? "preinformazione" : tipo;', con: "return tipo;", richiede: "MT1." },
  { nome: "MM40 C11: preinformazioni PVL P2_10-14 dimenticate", file: TG, cerca: ', "P2_10", "P2_11", "P2_12", "P2_13", "P2_14"', con: "", richiede: "MT1." },
  { nome: "MM41 filtro «bandi»: un bando senza tipo di avviso (Sintel) escluso dal NULL di SQL", file: TG, cerca: "or(tipo_avviso.is.null,and(", con: "or(and(", richiede: "MT5." },
  { nome: "MM42 filtro «candidature»: preinformazioni col tipo «bando» nella colonna dimenticate", file: TG, cerca: "and(tipo_opportunita.eq.bando,${PREINFORMAZIONE}),", con: "", richiede: "MT5." },
  { nome: "MM43 filtro «iscrizioni»: senza il ripiego qu-sy", file: TG, cerca: ",and(tipo_opportunita.is.null,tipo_avviso.eq.qu-sy)", con: "", richiede: "MT5." },
  { nome: "MM44 filtro «bandi»: LIKE al posto della regola delle schede PVL (P7, P10 diventano bandi)", file: TG, cerca: "tipo_avviso.match.^P[12]_", con: "tipo_avviso.like.P*", richiede: "MT6." },
  { nome: "MM45 ricerca: filtro per tipo non applicato", file: RIC, cerca: "    if (filtri.tipi.length) q = q.or(condizioneTipi(filtri.tipi));\n", con: "", richiede: "MT5." },
  { nome: "MM46 parametri: tipi sconosciuti e doppioni accettati", file: RC, cerca: "tipi: [...new Set(lista(p.tipo).filter(eCategoriaTipo))],", con: "tipi: lista(p.tipo) as CategoriaTipo[],", richiede: "MT9." },
  { nome: "MM47 parametri: il tipo non torna nell'indirizzo", file: RC, cerca: '  for (const t of x.tipi) p.append("tipo", t);\n', con: "", richiede: "MT9." },
  { nome: "MM48 filtri attivi: il tipo non conta", file: RC, cerca: "f.procedure.length + f.tipi.length +", con: "f.procedure.length +", richiede: "MT9." },
  { nome: "MM49 riga: scadenza di una candidatura detta come quella di un'offerta", file: RG, cerca: 'categoria === "candidature" ? "Candidature entro "', con: 'categoria === "candidature" ? ""', richiede: "MT4." },
  { nome: "MM50 riga: etichetta del tipo assente", file: RG, cerca: "{d.tipo && <span className=", con: "{false && <span className=", richiede: "MT4." },
  { nome: "MM51 «Cerca»: tipo non passato alla riga", file: `${OPP}/cerca/page.tsx`, cerca: "tipo: tipoDellaGara(r),", con: "tipo: null,", richiede: "MT1." },
  { nome: "MM52 «Per te»: tipo non passato alla riga", file: `${OPP}/per-te/page.tsx`, cerca: "tipo: tipoDellaGara(r),", con: "tipo: null,", richiede: "MT2." },
  { nome: "MM53 «Monitorate»: tipo non passato alla riga", file: M, cerca: "tipo: tipoDellaGara(p),", con: "tipo: null,", richiede: "MT3." },
  { nome: "MM54 «Cerca»: caselle del tipo assenti", file: `${OPP}/cerca/page.tsx`, cerca: 'name="tipo" value={c.id}', con: 'name="tipo_x" value={c.id}', richiede: "MT7." },
  { nome: "MM55 «Cerca»: filtro del tipo non tra quelli attivi", file: `${OPP}/cerca/page.tsx`, cerca: "for (const t of f.tipi) chip.push(", con: "for (const t of [] as typeof f.tipi) chip.push(", richiede: "MT7." },
  { nome: "MM56 scheda: riga «Come si partecipa» assente", file: GS, cerca: '{tipo === "preinformazione" && <Dato etichetta="Come si partecipa"', con: '{false && <Dato etichetta="Come si partecipa"', richiede: "MT8." },
  { nome: "MM57 scheda: niente ripiego sul tipo dell'avviso", file: GS, cerca: "const tipo = tipoDellaGara(g);", con: "const tipo = tipoDellaGara({ tipo_opportunita: g.tipo_opportunita, tipo_avviso: null });", richiede: "MT8." },
  { nome: "MM58 liste: il tipo non è nella lettura", file: RIC, cerca: "unita_a, tipo_opportunita, tipo_avviso\"", con: "unita_a\"", richiede: "MT1." },
  // decisione 48E: SardegnaCAT visibile senza parere; nascondi sempre ammesso; registro e cache
  {
    nome: "MM59 console: torna la casella del parere per «mostra» SardegnaCAT",
    file: CA,
    cerca: '  if (!fonte || (azione !== "mostra" && azione !== "nascondi")) return { errore: "Richiesta non valida." };\n  const nascosta = azione === "nascondi";',
    con: '  if (!fonte || (azione !== "mostra" && azione !== "nascondi")) return { errore: "Richiesta non valida." };\n  if (azione === "mostra" && fonte === "sardegnacat" && String(formData.get("parere") ?? "") !== "si") return { errore: "parere" };\n  const nascosta = azione === "nascondi";',
    richiede: "MV1.",
  },
  {
    nome: "MM60 console: «nascondi» chiede una conferma",
    file: CA,
    cerca: '  if (!fonte || (azione !== "mostra" && azione !== "nascondi")) return { errore: "Richiesta non valida." };\n  const nascosta = azione === "nascondi";',
    con: '  if (!fonte || (azione !== "mostra" && azione !== "nascondi")) return { errore: "Richiesta non valida." };\n  if (azione === "nascondi" && String(formData.get("conferma") ?? "") !== "si") return { errore: "conferma" };\n  const nascosta = azione === "nascondi";',
    richiede: "MV2.",
  },
  { nome: "MM61 console: cambio di visibilità non scritto nel registro", file: CA, cerca: "  await registra(admin, [{ oggetto: `fonte:${fonte}:nascosta_ai_clienti`, valore_precedente: String(riga.nascosta_ai_clienti), valore_nuovo: String(nascosta) }], sessione);\n", con: "", richiede: "MV1." },
  { nome: "MM62 console: cache delle fonti visibili non svuotata", file: CA, cerca: "  updateTag(TAG_FONTI_RADAR);\n", con: "", richiede: "MV1." },
  {
    nome: "MM63 console: senza registro si salva lo stesso",
    file: CA,
    cerca: '  const nascosta = azione === "nascondi";\n  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin)))',
    con: '  const nascosta = azione === "nascondi";\n  const admin = createAdminClient();\n  if (false && !(await registroDisponibile(admin)))',
    richiede: "MV4.",
  },
  { nome: "MM64 console: anche TED e PVL si possono nascondere", file: CA, cerca: "return (FONTI_REGIONALI as readonly string[]).includes(s) ? (s as FonteRegionale) : null;", con: "return s ? (s as FonteRegionale) : null;", richiede: "MV4." },
  {
    nome: "MM65 vista: torna la casella del parere",
    file: CV,
    cerca: 'etichetta="Mostra ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "mostra" }} variante="neutro">\n                    {null}',
    con: 'etichetta="Mostra ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "mostra" }} variante="neutro">\n                    <input type="checkbox" name="parere" value="si" />',
    richiede: "MV5.",
  },
  // S4 (49C §4.2): quarto stato per i clienti, elenco e «Decidi» in console
  { nome: "MM66 lettura: le righe C di una gara da verificare tornano visibili («non pertinente»)", file: LT, cerca: 'settori: s.stato === "da_verificare" ? settori.filter((x) => x.livello !== "C") : settori,', con: "settori,", richiede: "MS1." },
  { nome: "MM67 lettura: niente testo «Classificazione in verifica»", file: LT, cerca: '  if (c.stato === "da_verificare") return "Classificazione in verifica:', con: '  if (c.stato === "da_verificare_x") return "Classificazione in verifica:', richiede: "MS1." },
  { nome: "MM68 risultati: niente distintivo «Classificazione in verifica»", file: RC, cerca: '  if (c.rilevanza?.stato === "da_verificare") return "Classificazione in verifica";\n', con: "", richiede: "MS2." },
  { nome: "MM69 elenco: anche le gare in attesa", file: GV, cerca: '.eq("stato", "da_verificare")', con: '.in("stato", ["da_verificare", "in_attesa"])', richiede: "MS4." },
  { nome: "MM70 elenco: caso non ricavato dal motivo", file: GVC, cerca: "caso: casoDaRigaDaVerificare({ regole, motivi })", con: "caso: null", richiede: "MS4." },
  { nome: "MM71 elenco: candidato anche da una riga C senza la regola «da_verificare»", file: GVC, cerca: "    if (i < 0) continue;", con: '    if (i < 0 && r.rilevanza !== "C") continue;', richiede: "MS4." },
  { nome: "MM72 decidi: un settore diverso dal candidato accettato", file: GVC, cerca: "if (candidato !== null && settore !== candidato) return", con: "if (false && candidato !== null && settore !== candidato) return", richiede: "MS7." },
  { nome: "MM73 decidi: C con sottocategorie accettata", file: GVC, cerca: 'if (rilevanza === "C" && scelte.length > 0) return', con: 'if (false && rilevanza === "C" && scelte.length > 0) return', richiede: "MS7." },
  {
    nome: "MM74 decidi: sottocategoria fuori catalogo accettata",
    file: GVC,
    cerca: "    if (!r || r.daAlias || r.id !== s) return { ok: false, errore: `Sottocategoria «${s}» non presente nel catalogo del settore.` };\n    sottocategorie.push(r.id);",
    con: "    sottocategorie.push(s);",
    richiede: "MS7.",
  },
  // (la nota vuota ha una doppia guardia: anche decisioneAmministratore di B2 la rifiuta; qui si prova il limite di lunghezza)
  { nome: "MM75 decidi: nota oltre i 1000 caratteri accettata", file: GVC, cerca: "  if (nota.length > 1000) return", con: "  if (false) return", richiede: "MS7." },
  { nome: "MM76 decidi: anche una gara non da verificare", file: CA, cerca: '  if (!stato || stato.stato !== "da_verificare") return', con: "  if (!stato) return", richiede: "MS7." },
  { nome: "MM77 decidi: disattivazione non condizionata (scrittura concorrente ignorata)", file: CA, cerca: '.eq("id", x.id).eq("attiva", true).select("id");', con: '.eq("id", x.id).select("id");', richiede: "MS8." },
  { nome: "MM78 decidi: lo stato non torna «classificata»", file: CA, cerca: '.update({ stato: "classificata", versione_regole: versione,', con: '.update({ stato: "da_verificare", versione_regole: versione,', richiede: "MS5." },
  { nome: "MM79 decidi: nessuna riga nel registro", file: CA, cerca: '  await registra(admin, [{ oggetto: "gara:decisione_classificazione", valore_precedente: prima, valore_nuovo: dopo }], sessione);\n', con: "  void prima;\n  void dopo;\n", richiede: "MS5." },
  {
    nome: "MM80 decidi: senza registro si salva lo stesso",
    file: CA,
    cerca: '  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n  const [{ data: stato, error: e1 }',
    con: '  if (false && !(await registroDisponibile(admin))) return { errore: "registro" };\n  const [{ data: stato, error: e1 }',
    richiede: "MS7.",
  },
  { nome: "MM81 decidi: autore non registrato nella riga", file: CA, cerca: "autore: `console:${sessione.email}`,", con: 'autore: "console",', richiede: "MS5." },
  { nome: "MM82 vista: nota non obbligatoria nel modulo", file: GVV, cerca: '<textarea name="nota" required', con: '<textarea name="nota"', richiede: "MS10." },
  { nome: "MM83 vista: manca la scelta C", file: GVV, cerca: '  { id: "C", nome: "C non pertinente" },\n', con: "", richiede: "MS10." },
  { nome: "MM84 vista: riquadro non nella pagina", file: CV, cerca: "{dati.gareInVerifica && <GareInVerifica gare={dati.gareInVerifica} />}", con: "{null}", richiede: "MS10." },
  { nome: "MM85 vista: senza collegamento all'avviso", file: GVV, cerca: "<a href={g.urlAvviso}", con: "<a data-href={g.urlAvviso}", richiede: "MS10." },
  { nome: "MM86 pagina della console: elenco non letto", file: CL, cerca: "    leggiGareInVerifica(admin),\n", con: "    Promise.resolve(null),\n", richiede: "MS4." },
  // guardia del caso ricavato dal MOTIVO (MS11). [B2] = settori.ts del classificatore: mutato SOLO in memoria e ripristinato dal buffer
  {
    nome: "MM87 [B2] due casi S4 con lo stesso motivo",
    file: ST,
    cerca: '  biblioteca: "Servizi di biblioteca senza descrizione:',
    con: '  biblioteca: "Appalto misto per stabulari con le «pulizie» tra le attività: da verificare nei documenti (pulizia dei locali o cura degli animali)",\n  _vecchio: "Servizi di biblioteca senza descrizione:',
    richiede: "MS11.",
  },
  { nome: "MM88 [B2] caso nuovo nel tipo, senza la sua riga", file: ST, cerca: '  caso: "immobile_con_cpv_ristorazione" | "stabulari" | "biblioteca";', con: '  caso: "immobile_con_cpv_ristorazione" | "stabulari" | "biblioteca" | "caso_nuovo";', richiede: "MS11." },
  { nome: "MM89 [B2] una riga del classificatore col motivo di un altro caso", file: ST, cerca: "motivo: MOTIVI_DA_VERIFICARE.biblioteca });", con: "motivo: MOTIVI_DA_VERIFICARE.stabulari });", richiede: "MS11." },
  { nome: "MM90 console: caso indovinato dal settore quando il motivo non è riconosciuto", file: GVC, cerca: "caso: casoDaRigaDaVerificare({ regole, motivi })", con: "caso: casoDaRigaDaVerificare({ regole, motivi }) ?? ({ ristorazione: \"immobile_con_cpv_ristorazione\" } as Record<string, string>)[r.settore] ?? null", richiede: "MS4." },
  { nome: "MM91 console: un caso senza nome", file: GVC, cerca: '  stabulari: "Appalto misto per stabulari",\n', con: "", richiede: "MS11." },
  // riallineamento della colonna «settori» dopo «Decidi» (riallineaSettoriGara di B2)
  {
    nome: "MM92 decidi: riallineamento non chiamato",
    file: CA,
    cerca: "const colonna = statoAggiornato ? await riallineaSettoriGara(admin, proceduraId, adesso) : null;",
    con: 'const colonna = statoAggiornato ? ({ esito: "invariata", colonna: { settori: [] as string[], metodo: null } } as const) : null;',
    richiede: "MS12.",
  },
  {
    nome: "MM93 decidi: riallineamento chiamato anche se lo stato non è tornato «classificata»",
    file: CA,
    cerca: "const colonna = statoAggiornato ? await riallineaSettoriGara(admin, proceduraId, adesso) : null;",
    con: "const colonna = await riallineaSettoriGara(admin, proceduraId, adesso);",
    richiede: "MS15.",
  },
  { nome: "MM94 decidi: riallineamento non riuscito detto come riuscito", file: CA, cerca: "  return { errore: `${decisa}, ma i settori della gara NON", con: "  return { ok: true, avviso: `${decisa}, ma i settori della gara NON", richiede: "MS14." },
  { nome: "MM95 decidi: colonna aggiornata detta come errore", file: CA, cerca: 'if (colonna.esito === "aggiornata" || colonna.esito === "invariata") return', con: 'if (colonna.esito === "invariata") return', richiede: "MS12." },
  { nome: "MM96 decidi: esito del riallineamento non nel registro", file: CA, cerca: ' · colonna: ${colonna ? testoRiallineamento(colonna) : "non riallineata"}', con: "", richiede: "MS12." },
  { nome: "MM97 testo: «cambiata nel frattempo» non detto", file: GVC, cerca: '"la colonna dei settori è cambiata nel frattempo"', con: '"colonna non scritta"', richiede: "MS14." },
  { nome: "MM98 testo: «gara non trovata» non detto", file: GVC, cerca: ': "gara non trovata";', con: ': "colonna non scritta";', richiede: "MS14." },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-monitorate-fonti-nascoste.ts", mutazioni: MUTAZIONI, tempoMassimoMs: 120_000 }));
