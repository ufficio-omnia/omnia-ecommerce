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
const FC = "src/lib/console/fonti-calcoli.ts";
const FV = "src/app/site-console/_componenti/fonti-vista.tsx";
const FP = "src/app/site-console/(app)/tender-intelligence/fonti/page.tsx";
// riordino della console (25/11)
const TT = "src/lib/console/tender-intelligence-testi.ts";
const PTI = "src/app/site-console/(app)/tender-intelligence";
const CERCA = `${OPP}/cerca/page.tsx`;

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
  { nome: "MM43 filtro «iscrizioni»: senza il ripiego dal tipo dell'avviso (qu-sy, P7_3)", file: TG, cerca: ",and(tipo_opportunita.is.null,tipo_avviso.in.${ISCRIZIONI_DALL_AVVISO})", con: "", richiede: "MT5." },
  { nome: "MP1 C1: indagine PVL P7_1_3 fuori dalle candidature", file: TG, cerca: ",and(tipo_opportunita.is.null,tipo_avviso.eq.${CANDIDATURE_DALL_AVVISO})", con: "", richiede: "MT5." },
  { nome: "MP2 C1: elenco PVL P7_3 fuori dalle iscrizioni", file: TG, cerca: 'const ISCRIZIONI_DALL_AVVISO = "(qu-sy,P7_3)";', con: 'const ISCRIZIONI_DALL_AVVISO = "(qu-sy)";', richiede: "MT5." },
  // modulo chiuso in produzione (documento 57 §1)
  { nome: "MZ1 menu: tabella dei clienti letta anche a modulo spento", file: "src/lib/radar/visibilita.ts", cerca: "  if (!(await attivoGenerale())) return false;\n", con: "", richiede: "MC1." },
  { nome: "MZ2 apertura di sviluppo valida anche su Vercel", file: "src/lib/radar/diritto-calcoli.ts", cerca: '  return env.NODE_ENV !== "production" && !env.VERCEL;', con: '  return env.NODE_ENV !== "production";', richiede: "MC1." },
  { nome: "MZ3 titolare: «Opportunità» sempre nel menu", file: "src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx", cerca: "voci={conOpportunita ? vociConOpportunita(VOCI_MENU_TITOLARE) : undefined}", con: "voci={vociConOpportunita(VOCI_MENU_TITOLARE)}", richiede: "MC2." },
  { nome: "MZ4 Ufficio Gare: «Opportunità» sempre nel menu", file: "src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx", cerca: "voci={conOpportunita ? vociConOpportunita(VOCI_MENU_UFFICIO_GARE) : VOCI_MENU_UFFICIO_GARE}", con: "voci={vociConOpportunita(VOCI_MENU_UFFICIO_GARE)}", richiede: "MC3." },
  { nome: "MZ5 Ufficio Gare: interruttore letto anche senza il grado 2", file: "src/app/site-omnia-ai/dashboard/omnia-ai/layout.tsx", cerca: "ufficioGareRadarAttivo(process.env) ? radarNelMenu(contesto.accountId) : Promise.resolve(false),", con: "radarNelMenu(contesto.accountId),", richiede: "MC3." },
  { nome: "MZ6 pagine di Opportunità senza la porta", file: "src/lib/radar/area-cliente.ts", cerca: "  if (!contesto.diritto.visibile) notFound();\n", con: "", richiede: "MC4." },
  { nome: "MZ7 cliente abilitato anche a modulo spento", file: "src/lib/radar/diritto-calcoli.ts", cerca: "const abilitato = dati.parametri.attivo && dati.cliente?.attivo === true;", con: "const abilitato = dati.cliente?.attivo === true;", richiede: "MC4." },
  // F7 solo account interni (D-D, documento 57 §5-bis)
  { nome: "MZ8 menu: «Opportunità» a tutti appena l'interruttore generale è acceso", file: "src/lib/radar/visibilita.ts", cerca: "  return attivoCliente(accountId);", con: "  return true;", richiede: "MC5." },
  { nome: "MZ9 console: Ufficio Gare abilitato al posto del titolare", file: CA, cerca: "  if (membro) return { errore: \"Questo utente è un Ufficio Gare: va abilitato il titolare dell'account.\" };\n", con: "", richiede: "MC6." },
  { nome: "MZ10 console: abilitato anche chi non è cliente", file: CA, cerca: '  if (utente.role !== "cliente") return { errore: "Il modulo si abilita solo per i clienti." };\n', con: "", richiede: "MC6." },
  { nome: "MZ11 console: cache del menu delle imprese non svuotata", file: CA, cerca: "  updateTag(TAG_CLIENTI_RADAR);\n", con: "", richiede: "MC6." },
  // pacchetto P del go-live (55 §2): interruttori della B4
  { nome: "MQ1 P: interruttore acceso sulle anteprime", file: "src/lib/radar/interruttori-b4.ts", cerca: '  if (env.VERCEL_ENV === "preview") return false;\n', con: "", richiede: "P1." },
  { nome: "MQ2 P: produzione accesa anche da un computer locale", file: "src/lib/radar/interruttori-b4.ts", cerca: '  return ambiente === "produzione" && env.VERCEL_ENV === "production";', con: '  return ambiente === "produzione";', richiede: "P1." },
  { nome: "MQ3 P: database sconosciuto acceso dal deploy di produzione", file: "src/lib/radar/interruttori-b4.ts", cerca: '  return ambiente === "produzione" && env.VERCEL_ENV === "production";', con: '  return ambiente !== "staging" && env.VERCEL_ENV === "production";', richiede: "P1." },
  { nome: "MQ4 P: produzione ancora spenta (regola di prima)", file: "src/lib/radar/interruttori-b4.ts", cerca: '  return ambiente === "produzione" && env.VERCEL_ENV === "production";', con: "  return false;", richiede: "P1." },
  { nome: "MQ5 P: qualunque valore accende", file: "src/lib/radar/interruttori-b4.ts", cerca: '  if (env[nome] !== "attivo") return false;', con: "  if (!env[nome]) return false;", richiede: "P1." },
  { nome: "MQ6 P: «Per te» legge l'interruttore dell'Ufficio Gare", file: "src/lib/radar/interruttori-b4.ts", cerca: 'return interruttoreB4("RADAR_PER_TE", env);', con: 'return interruttoreB4("RADAR_UFFICIO_GARE", env);', richiede: "P1." },
  { nome: "MQ7 P: pagina «Notifiche» senza il suo interruttore", file: "src/app/site-omnia-ai/dashboard/omnia-ai/opportunita/notifiche/page.tsx", cerca: "  if (!preferenzeNotificheAttive(process.env)) notFound();\n", con: "", richiede: "P2." },
  { nome: "MQ8 P: guardie di Opportunità aperte all'Ufficio Gare a interruttore spento", file: "src/lib/radar/guardie-opportunita.ts", cerca: "? richiediAccountPagina() : richiediTitolarePagina();", con: "? richiediAccountPagina() : richiediAccountPagina();", richiede: "P3." },
  { nome: "MP3 C1: P7_1_3 e P7_3 scambiati nel filtro", file: TG, cerca: 'const CANDIDATURE_DALL_AVVISO = "P7_1_3";\nconst ISCRIZIONI_DALL_AVVISO = "(qu-sy,P7_3)";', con: 'const CANDIDATURE_DALL_AVVISO = "P7_3";\nconst ISCRIZIONI_DALL_AVVISO = "(qu-sy,P7_1_3)";', richiede: "MT5." },
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
    cerca: 'etichetta="Mostra ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "mostra" }} variante="neutro">\n          <span className="cn-nota">{FRASE_VISIBILITA}</span>',
    con: 'etichetta="Mostra ai clienti" etichettaInCorso="Salvo…" campi={{ fonte: f.fonte, azione: "mostra" }} variante="neutro">\n          <input type="checkbox" name="parere" value="si" />\n          <span className="cn-nota">{FRASE_VISIBILITA}</span>',
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
  // pagina «Fonti» della console (48C §3.5–3.6)
  { nome: "MF1 stato «in errore» detto «in funzione»", file: FC, cerca: 'in_errore: { testo: "In errore",', con: 'in_errore: { testo: "In funzione",', richiede: "FS1." },
  { nome: "MF2 accesa e spenta invertite", file: FV, cerca: '{f.attiva ? "Accesa" : "Spenta"}', con: '{f.attiva ? "Spenta" : "Accesa"}', richiede: "FS1." },
  { nome: "MF3 allarmi in ordine diverso da quello di B2", file: FV, cerca: "{f.allarmi.map((a, i) => (", con: "{[...f.allarmi].reverse().map((a, i) => (", richiede: "FS2." },
  { nome: "MF4 solo gli allarmi gravi", file: FV, cerca: "{f.allarmi.map((a, i) => (", con: '{f.allarmi.filter((a) => a.gravita === "errore").map((a, i) => (', richiede: "FS2." },
  { nome: "MF5 prossimo giro anche coi giri programmati spenti", file: FC, cerca: "  if (!attiva || !cronAttivo) return null;", con: "  if (!attiva) return null;", richiede: "FS3." },
  { nome: "MF6 prossimo giro anche per una fonte spenta", file: FC, cerca: "  if (!attiva || !cronAttivo) return null;", con: "  if (!cronAttivo) return null;", richiede: "FS3." },
  { nome: "MF7 elenco dei giri senza limite", file: FC, cerca: "    .slice(0, GIRI_PER_FONTE)\n", con: "", richiede: "FS4." },
  { nome: "MF8 elenco dei giri dal più vecchio", file: FC, cerca: "Date.parse(b.iniziato_il) - Date.parse(a.iniziato_il)", con: "Date.parse(a.iniziato_il) - Date.parse(b.iniziato_il)", richiede: "FS4." },
  { nome: "MF9 registro assente non detto", file: FV, cerca: "{dati.registroAssente && (", con: "{false && (", richiede: "FS5." },
  { nome: "MF10 errore di lettura non detto", file: FV, cerca: "{dati.errore && (", con: "{false && (", richiede: "FS5." },
  { nome: "MF11 conferma non obbligatoria", file: FV, cerca: '<input type="checkbox" name="conferma" value="si" required /> Confermo: {f.attiva ? "spengo" : "accendo"}', con: '<input type="checkbox" name="conferma" value="si" /> Confermo: {f.attiva ? "spengo" : "accendo"}', richiede: "FS6." },
  { nome: "MF12 fonte regionale senza la fonte nel modulo", file: FV, cerca: "campi={{ fonte: f.fonte, azione }}", con: "campi={{ azione }}", richiede: "FS6." },
  { nome: "MF13 accendi e spegni invertiti", file: FV, cerca: 'const azione = f.attiva ? "spegni" : "accendi";', con: 'const azione = f.attiva ? "accendi" : "spegni";', richiede: "FS6." },
  { nome: "MF14 una fonte sospesa senza «Riaccendi»", file: FV, cerca: 'f.stato === "sospesa" ? "Riaccendi la fonte" : "Accendi la fonte"', con: '"Accendi la fonte"', richiede: "FS6." },
  { nome: "MF15 pagina senza la guardia degli amministratori", file: FP, cerca: "  await richiediAdminPagina();\n", con: "", richiede: "FS7." },
  // riordino (25/11): la pagina è collegata dalla barra di schede comune, controllata da CR1
  { nome: "MF16 scheda «Fonti» della barra non collegata alla pagina", file: CV, cerca: '<Link href="/tender-intelligence/fonti" prefetch={false}>\n              Fonti\n', con: '<Link href="/tender-intelligence" prefetch={false}>\n              Fonti\n', richiede: "CR1." },
  { nome: "MF17 regionali: nota «dal giro successivo» tolta", file: FV, cerca: '      {f.attiva ? <p className="cn-nota">{`${f.nome} si ferma dal giro successivo: un giro già in corso arriva alla fine.`}</p> : null}\n', con: "", richiede: "FS8." },
  { nome: "MF18 regionali: nota anche per una fonte spenta", file: FV, cerca: '{f.attiva ? <p className="cn-nota">', con: '{true ? <p className="cn-nota">', richiede: "FS8." },
  // conferma dell'accensione controllata nel server (decisione del coordinamento, 23/11)
  { nome: "MC1 TED: accensione senza controllo della conferma", file: CA, cerca: '  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted"', con: '  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted"', richiede: "FS9." },
  { nome: "MC2 PVL: accensione senza controllo della conferma", file: CA, cerca: '  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n  const attiva = azione === "accendi";\n  if (attiva) {\n    const permesso = scrittureRadarConsentite("pvl"', con: '  const attiva = azione === "accendi";\n  if (attiva) {\n    const permesso = scrittureRadarConsentite("pvl"', richiede: "FS9." },
  { nome: "MC3 regionali: accensione senza controllo della conferma", file: CA, cerca: 'return { errore: "Richiesta non valida." };\n  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };', con: 'return { errore: "Richiesta non valida." };', richiede: "FS9." },
  { nome: "MC4 TED: conferma chiesta anche per spegnere", file: CA, cerca: '  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted"', con: '  if (!accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted"', richiede: "FS9." },
  { nome: "MC5 qualunque valore vale come conferma", file: FC, cerca: '  return dati.get("conferma") === "si";', con: '  return dati.get("conferma") !== null;', richiede: "FS9." },
  { nome: "MC6 TED: controllo della conferma dopo la lettura del registro", file: CA, cerca: '  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };\n  }\n  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n', con: '  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };\n  }\n  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n  if (azione === "accendi" && !accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_ACCENSIONE };\n', richiede: "FS9." },
  // MC7–MC12 tolte col riordino (25/11): mutavano i moduli di accensione della vecchia pagina unica, che non esistono più (l'accensione
  // sta solo nella pagina «Fonti»: MF11–MF14 e le due qui sotto)
  { nome: "MC13 pagina «Fonti»: un secondo modulo di accensione nei dettagli della fonte", file: FV, cerca: "        {ti ? dettagliFonteTi(f.fonte, f.attiva, ti) : null}\n", con: "        {ti ? dettagliFonteTi(f.fonte, f.attiva, ti) : null}\n        {ti ? accendiSpegni(f) : null}\n", richiede: "FS10." },
  { nome: "MC14 pagina «Fonti»: accensione sparita coi dati della console", file: FV, cerca: "        {accendiSpegni(f)}\n", con: "        {ti ? null : accendiSpegni(f)}\n", richiede: "FS10." },
  // orari, interruttori e righe cron dei giri SOLO da programmazione-calcoli.ts (K1 di B2, 51 §9)
  { nome: "MG1 orari senza i giorni", file: FC, cerca: "`${ore.join(\", \")} ${GIORNI_LEGGIBILI[giorni]}`", con: "`${ore.join(\", \")}`", richiede: "FS11." },
  { nome: "MG2 feriali detti «tutti i giorni»", file: FC, cerca: 'feriali: "dal lunedì al venerdì"', con: 'feriali: "tutti i giorni"', richiede: "FS11." },
  { nome: "MG3 regionali senza il vecchio interruttore", file: FC, cerca: "? [INTERRUTTORI_CRON[fonte], INTERRUTTORE_REGIONALI_VECCHIO]", con: "? [INTERRUTTORI_CRON[fonte]]", richiede: "FS11." },
  { nome: "MG4 TED coi giri sempre accesi (regola di prima del K1)", file: FC, cerca: "    attivi: cronAttiviDa(env).has(fonte),", con: '    attivi: fonte === "ted" || cronAttiviDa(env).has(fonte),', richiede: "FS3." },
  { nome: "MG5 giri spenti senza le righe cron proposte", file: FC, cerca: '${g.cronProposti.length === 1 ? "la riga" : "le righe"} «${g.cronProposti.join("», «")}» in vercel.json', con: "la riga in vercel.json", richiede: "FS11." },
  { nome: "MG6 pagina «Fonti» senza la frase dei giri", file: FV, cerca: '        <p className="cn-nota">{testoGiriProgrammati(f.giriProgrammati)}</p>\n', con: "", richiede: "FS11." },
  { nome: "MG7 prossimo giro senza guardare l'interruttore", file: "src/lib/console/fonti.ts", cerca: "prossimoGiro(x.fonte, x.attiva, giri.attivi, adesso)", con: "prossimoGiro(x.fonte, x.attiva, true, adesso)", richiede: "FS3." },
  // MG8–MG10 tolte col riordino (25/11): mutavano le frasi dei giri della vecchia pagina unica, che non esistono più; le stesse regressioni
  // sui nuovi punti (dettagli delle fonti nella pagina «Fonti», Panoramica)
  { nome: "MG14 dettagli PVL con gli orari vecchi scritti a mano", file: CV, cerca: "{FRASE_ESEGUI_GIRO} Dall&apos;ultimo giorno letto meno uno a oggi", con: "{FRASE_ESEGUI_GIRO} Giri programmati alle 8:00, 13:00, 18:00 ora italiana. Dall&apos;ultimo giorno letto meno uno a oggi", richiede: "FS12." },
  { nome: "MG15 dettagli regionali col solo vecchio interruttore", file: CV, cerca: '<span className="cn-nota">{FRASE_ESEGUI_GIRO}</span>', con: '<span className="cn-nota">{FRASE_ESEGUI_GIRO} Giri programmati: servono la riga in vercel.json e RADAR_REGIONALI_CRON=attivo.</span>', richiede: "FS12." },
  { nome: "MG16 Panoramica con le 9:15 UTC di TED", file: CV, cerca: '<p className="cn-nota">Stato calcolato, allarmi, accensione e giri sono nella scheda «Fonti».</p>', con: '<p className="cn-nota">Importazione TED nei giorni feriali alle 9:15 UTC. Stato calcolato, allarmi, accensione e giri sono nella scheda «Fonti».</p>', richiede: "FS12." },
  { nome: "MG11 messaggio TED dopo l'accensione scritto a mano", file: CA, cerca: '`Fonte TED accesa. ${testoGiriProgrammati(giriProgrammatiFonte("ted", process.env, new Date()))} Un giro subito: «Esegui un giro adesso».`', con: "\"Fonte TED accesa: l'importazione partirà al prossimo giro (giorni feriali, 9:15 UTC).\"", richiede: "FS12." },
  { nome: "MG12 messaggio PVL con gli orari di TED", file: CA, cerca: 'testoGiriProgrammati(giriProgrammatiFonte("pvl", process.env, new Date()))', con: 'testoGiriProgrammati(giriProgrammatiFonte("ted", process.env, new Date()))', richiede: "FS12." },
  { nome: "MG13 dati della console con un interruttore scritto a mano", file: CL, cerca: "const giriProgrammati = giriProgrammatiTutti(process.env, new Date());", con: 'const giriProgrammati = giriProgrammatiTutti({ ...process.env, RADAR_TED_CRON: "attivo" }, new Date());', richiede: "FS12." },
  // «Riprendi il recupero» della PVL (K4 di B2)
  { nome: "MR1 ripresa: guardia degli amministratori dopo la lettura del registro", file: CA, cerca: '  const sessione = await richiediAdminAzione();\n  if (!sessione) return { errore: "Non autorizzato." };\n  if (!accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_RIPRESA };\n  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };', con: '  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n  const sessione = await richiediAdminAzione();\n  if (!sessione) return { errore: "Non autorizzato." };\n  if (!accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_RIPRESA };', richiede: "FS14." },
  { nome: "MR2 ripresa senza controllo della conferma", file: CA, cerca: "  if (!accensioneConfermata(formData)) return { errore: ERRORE_CONFERMA_RIPRESA };\n", con: "", richiede: "FS14." },
  { nome: "MR3 ripresa senza registro obbligatorio", file: CA, cerca: '  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n  const esito = await riprendiRecuperoPvl(', con: "  const esito = await riprendiRecuperoPvl(", richiede: "FS14." },
  { nome: "MR4 ripresa registrata come accensione", file: CA, cerca: 'oggetto: "fonte:pvl:ripresa_recupero"', con: 'oggetto: "fonte:pvl:attiva"', richiede: "FS14." },
  { nome: "MR5 ripresa senza «console:» nell'autore", file: CA, cerca: "riprendiRecuperoPvl(admin, `console:${sessione.email}`)", con: "riprendiRecuperoPvl(admin, sessione.email)", richiede: "FS14." },
  { nome: "MR6 ripresa: motivo del rifiuto non detto", file: CA, cerca: "return { errore: `Recupero non ripreso: ${TESTO_MOTIVO_RIPRESA[esito.motivo]}.` };", con: 'return { errore: "Recupero non ripreso." };', richiede: "FS15." },
  { nome: "MR7 ripresa: due motivi con la stessa frase", file: FC, cerca: 'giro_in_corso: "un giro della PVL è in corso, riprova quando è finito",', con: 'giro_in_corso: "lettura dello stato della PVL non riuscita, riprova tra poco",', richiede: "FS15." },
  { nome: "MR8 pulsante per qualunque fonte con l'allarme", file: FC, cerca: 'return fonte === "pvl" && allarmi.some((a) => a.codice === "blocco_incompleto");', con: 'return allarmi.some((a) => a.codice === "blocco_incompleto");', richiede: "FS13." },
  { nome: "MR9 pulsante della PVL anche senza l'allarme", file: FC, cerca: 'return fonte === "pvl" && allarmi.some((a) => a.codice === "blocco_incompleto");', con: 'return fonte === "pvl";', richiede: "FS13." },
  { nome: "MR10 pulsante anche col recupero già ripreso", file: FV, cerca: '  if (r.stato === "gia_ripreso") return <p className="cn-nota">Recupero già ripreso: l&apos;allarme resta fino al prossimo giro, che ritenta il blocco.</p>;\n', con: "", richiede: "FS13." },
  { nome: "MR11 ripresa: casella non obbligatoria", file: FV, cerca: '<input type="checkbox" name="conferma" value="si" required /> Confermo: riprendo il recupero della PVL', con: '<input type="checkbox" name="conferma" value="si" /> Confermo: riprendo il recupero della PVL', richiede: "FS13." },
  { nome: "MR12 ripresa: nota «si ritenta al prossimo giro» tolta", file: FV, cerca: '        <p className="cn-nota">Si ritenta al prossimo giro: nessuna richiesta alla PVL adesso.</p>\n', con: "", richiede: "FS13." },
  { nome: "MR13 ripresa: blocco fermo non mostrato", file: FV, cerca: "`Recupero fermo sul blocco dal ${giornoLeggibile(r.blocco.da)} al ${giornoLeggibile(r.blocco.a)} (fermo dal ${data(r.blocco.il)}).`", con: '"Recupero fermo."', richiede: "FS13." },
  { nome: "MR14 ripresa: cursore letto come già ripreso", file: "src/lib/console/fonti.ts", cerca: 'ripresa = fermo ? { stato: "fermo", blocco: { il: fermo.il, da: fermo.da, a: fermo.a } } : { stato: "gia_ripreso" };', con: 'ripresa = { stato: "gia_ripreso" };', richiede: "FS13." },
  // K8: accendere TED solo dove TED si può scrivere
  { nome: "MK1 TED si accende in qualunque ambiente", file: CA, cerca: '  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };\n  }\n', con: "", richiede: "FS16." },
  { nome: "MK2 controllo dell'ambiente anche per spegnere TED", file: CA, cerca: '  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);', con: '  {\n    const permesso = scrittureRadarConsentite("ted", process.env);', richiede: "FS16." },
  { nome: "MK3 TED rifiutato senza il motivo", file: CA, cerca: '    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };', con: '    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: "Ambiente non consentito." };', richiede: "FS16." },
  { nome: "MK4 TED: controllo dell'ambiente dopo la lettura del registro", file: CA, cerca: '  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };\n  }\n  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n', con: '  const admin = createAdminClient();\n  if (!(await registroDisponibile(admin))) return { errore: "Il registro delle modifiche non esiste ancora (migrazione 0112): nessuna modifica salvata." };\n  if (azione === "accendi") {\n    const permesso = scrittureRadarConsentite("ted", process.env);\n    if (!permesso.ok) return { errore: permesso.motivo };\n  }\n', richiede: "FS16." },
  // riordino della console (25/11, proposta 43 con il via dell'utente): barra di schede, ordine delle fonti, «Avanzate» chiusa, frasi
  { nome: "MX1 pagine senza la barra di schede (testata)", file: CV, cerca: "      <SchedeTenderIntelligence attiva={attiva} />\n", con: "", richiede: "CR1." },
  { nome: "MX2 pagina «Fonti» senza la barra di schede", file: FV, cerca: '      <SchedeTenderIntelligence attiva="fonti" />\n', con: "", richiede: "CR1." },
  { nome: "MX3 pagina «Fonti» segnata come Panoramica", file: FV, cerca: '<SchedeTenderIntelligence attiva="fonti" />', con: '<SchedeTenderIntelligence attiva="panoramica" />', richiede: "CR1." },
  { nome: "MX4 pagina «Email» senza la barra di schede", file: `${PTI}/email/page.tsx`, cerca: '<SchedeTenderIntelligence attiva="email" />', con: "{null}", richiede: "CR1." },
  { nome: "MX5 scheda aperta anche come collegamento", file: CV, cerca: '<span aria-current="page">Registro</span>', con: '<Link href="/tender-intelligence/registro" prefetch={false} aria-current="page">Registro</Link>', richiede: "CR1." },
  { nome: "MX6 «Avanzate» aperta di base", file: CV, cerca: '<details className="cn-dettagli cn-sezione cn-avanzate">', con: '<details className="cn-dettagli cn-sezione cn-avanzate" open>', richiede: "CR3." },
  { nome: "MX7 «Avanzate» con un altro nome", file: CV, cerca: "<summary>Avanzate</summary>", con: "<summary>Altri parametri</summary>", richiede: "CR3." },
  { nome: "MX8 un limite non usato anche tra quelli in uso", file: TT, cerca: 'LIMITI_IN_USO: readonly NomeLimite[] = ["ricerche_minuto"];', con: 'LIMITI_IN_USO: readonly NomeLimite[] = ["ricerche_minuto", "sintesi_giorno"];', richiede: "CR3." },
  { nome: "MX9 il limite in uso spostato in «Avanzate»", file: TT, cerca: 'LIMITI_NON_IN_USO: readonly NomeLimite[] = ["progetti_senza_analisi",', con: 'LIMITI_NON_IN_USO: readonly NomeLimite[] = ["ricerche_minuto", "progetti_senza_analisi",', richiede: "CR3." },
  { nome: "MX10 «Avanzate» senza la frase dei costi", file: CV, cerca: '            <p className="cn-nota">{FRASE_COSTI}</p>\n', con: "", richiede: "CR3." },
  { nome: "MX11 un limite non usato senza «oggi non ha effetto»", file: TT, cerca: "  sintesi_giorno: FRASE_NON_IN_USO,\n", con: '  sintesi_giorno: "Quante sintesi al giorno può fare un\'impresa.",\n', richiede: "CR3." },
  { nome: "MX12 costi detti scalati", file: TT, cerca: "Oggi il codice non li scala per nessuna azione: i valori sono preparati per il futuro e cambiarli non ha effetto.", con: "Il codice li scala a ogni azione.", richiede: "CR5." },
  { nome: "MX13 «Cerca» legge un limite detto non usato", file: CERCA, cerca: 'limiteEffettivo(parametri, cliente, "ricerche_minuto")', con: 'limiteEffettivo(parametri, cliente, "sintesi_giorno")', richiede: "CR5." },
  { nome: "MX14 limiti della PVL sotto un altro titolo", file: CV, cerca: "<summary>Limiti verso la PVL</summary>", con: "<summary>Limiti</summary>", richiede: "CR2." },
  { nome: "MX15 catalogo delle fonti aperto di base", file: CV, cerca: '<details className="cn-dettagli cn-sezione">\n      <summary>Catalogo delle fonti</summary>', con: '<details className="cn-dettagli cn-sezione" open>\n      <summary>Catalogo delle fonti</summary>', richiede: "CR2." },
  { nome: "MX16 catalogo delle fonti tolto dalla pagina «Fonti»", file: FV, cerca: "      {ti ? catalogoFonti(ti) : null}\n", con: "", richiede: "CR2." },
  { nome: "MX17 regionali visibili con «Mostra» invece di «Nascondi»", file: CV, cerca: 'campi={{ fonte: f.fonte, azione: "nascondi" }}', con: 'campi={{ fonte: f.fonte, azione: "mostra" }}', richiede: "CR2." },
  { nome: "MX18 TED accesa senza «Esegui un giro adesso»", file: CV, cerca: "      {attiva && (\n        <ModuloAzione azione={eseguiGiroTed}", con: "      {false && (\n        <ModuloAzione azione={eseguiGiroTed}", richiede: "CR2." },
  { nome: "MX19 PVL spenta con «Esegui un giro adesso»", file: CV, cerca: "      {attiva && (\n        <ModuloAzione azione={eseguiGiroPvl}", con: "      {true && (\n        <ModuloAzione azione={eseguiGiroPvl}", richiede: "CR2." },
  { nome: "MX20 Panoramica con «(solo staging)»", file: CV, cerca: "Scouting delle gare per le imprese abilitate.", con: "Scouting delle gare per le imprese abilitate (solo staging).", richiede: "CR6." },
  { nome: "MX21 pagina «Modulo e clienti» senza la guardia degli amministratori", file: `${PTI}/modulo/page.tsx`, cerca: "  await richiediAdminPagina();\n", con: "", richiede: "CR7." },
  { nome: "MX22 pagina «Gare da controllare» senza la guardia degli amministratori", file: `${PTI}/gare/page.tsx`, cerca: "  await richiediAdminPagina();\n", con: "", richiede: "CR7." },
  { nome: "MX23 pagina «Registro» senza la guardia degli amministratori", file: `${PTI}/registro/page.tsx`, cerca: "  await richiediAdminPagina();\n", con: "", richiede: "CR7." },
  { nome: "MX24 «Accendi» senza la frase", file: FV, cerca: '  const frase = f.attiva ? null : <p className="cn-nota">{FRASE_ACCENDI}</p>;', con: "  const frase = null;", richiede: "CR4." },
  { nome: "MX25 «Spegni» TED senza la frase del giro a metà", file: FV, cerca: '<ModuloAzione azione={impostaFonteTed} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>\n        {conferma}\n        {frase ?? <p className="cn-nota">{FRASE_SPEGNI_A_META}</p>}', con: '<ModuloAzione azione={impostaFonteTed} etichetta={etichetta} etichettaInCorso="Salvo…" campi={{ azione }}>\n        {conferma}\n        {frase}', richiede: "CR4." },
  { nome: "MX26 un limite della PVL senza la frase", file: CV, cerca: '              <p className="cn-nota">{FRASE_LIMITE_PVL[k]}</p>\n', con: "", richiede: "CR4." },
  { nome: "MX27 «Esegui un giro» regionale senza la frase", file: CV, cerca: '<span className="cn-nota">{FRASE_ESEGUI_GIRO}</span>', con: '<span className="cn-nota">Un giro subito.</span>', richiede: "CR4." },
  // stato di adesso (CR8, richiesta del coordinamento dopo l'accensione del 25/11): fonti accese, 5 suggerimenti aperti, modulo acceso con 1 impresa
  { nome: "MX28 «Non sono la stessa gara» mandato come «Unisci»", file: CV, cerca: 'campi={{ a: p.a.id, b: p.b.id, decisione: "rifiuta" }}', con: 'campi={{ a: p.a.id, b: p.b.id, decisione: "conferma" }}', richiede: "CR8." },
  { nome: "MX29 modulo acceso con il pulsante «Accendi»", file: CV, cerca: 'etichetta={parametri.attivo ? "Spegni il modulo" : "Accendi il modulo"}', con: 'etichetta={"Accendi il modulo"}', richiede: "CR8." },
  { nome: "MX30 modulo acceso: il pulsante lo riaccende invece di spegnerlo", file: CV, cerca: 'campi={{ radar_attivo: parametri.attivo ? "0" : "1" }}', con: 'campi={{ radar_attivo: "1" }}', richiede: "CR8." },
  { nome: "MX31 solo i primi 3 suggerimenti di unione", file: CV, cerca: "{regionali.proposte.map((p) => (", con: "{regionali.proposte.slice(0, 3).map((p) => (", richiede: "CR8." },
  { nome: "MX32 Panoramica senza il numero delle imprese abilitate", file: CV, cerca: "valore={numero(dati.clientiAbilitati)}", con: "valore={numero(null)}", richiede: "CR8." },
  { nome: "MX33 Panoramica senza i suggerimenti aperti", file: CV, cerca: "const suggerimenti = dati.regionali?.proposte?.length ?? null;", con: "const suggerimenti = null;", richiede: "CR8." },
  { nome: "MX34 regionale accesa senza «Esegui un giro adesso»", file: CV, cerca: "      {attiva && (\n        <ModuloAzione azione={eseguiGiroRegionale}", con: "      {false && (\n        <ModuloAzione azione={eseguiGiroRegionale}", richiede: "CR8." },
  { nome: "MX35 elenco delle imprese abilitate non mostrato", file: CV, cerca: "{dati.imprese && dati.imprese.length > 0 ? (", con: "{false ? (", richiede: "CR8." },
];

process.exit(eseguiMutazioni({ radice: RADICE, verifica: "scripts/verifica-monitorate-fonti-nascoste.ts", mutazioni: MUTAZIONI, tempoMassimoMs: 120_000 }));
