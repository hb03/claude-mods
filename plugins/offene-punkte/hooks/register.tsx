// Offene Punkte der Sitzung: nach jeder Antwort liest ein kleines Modell
// (Haiku), was noch eine Entscheidung, Freigabe oder Zuarbeit des Nutzers
// braucht, und stellt es als Frage mit Antwortmoeglichkeiten ueber die
// Eingabe - immer auch mit einer eigenen Antwort. Aufgaben bringen ihre
// Anleitung mit (Befehle, Pfade), dazu fuehrt Haiku einen kurzen Ueberblick.
// Die Liste liegt je Projekt in offene-punkte/offen.md und geht so in die
// naechste Sitzung; was entschieden wurde, landet mit Gruenden in
// offene-punkte/antworten-JJJJ-MM-TT.md. /offen zeigt alles,
// /zusammenfassung laesst das Hauptmodell die ganze Sitzung zusammenfassen.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Punkt, Warnung } from '../types'
import {
  BUDGET_GRENZE, HINWEIS_BLOCK, UEBERBLICK_NACH, ZUSAMMENFASSUNG, abschliessen, altern, antwortIn, ausstehende, autoErledigt, beiClaudeFertig,
  blockLesen, eingetippteAntworten, fragbar, fremd, gedankeKurz, gedankenMarken, gedankeZustand, insInterview, interviewNummer, istMaschinenEingabe,
  istVeraltet, kontextZeile, kurzNummern, listeFuerClaude, markenHinweis, markenOhneTreffer, mitCompact, nachfassen, nummerieren, offene,
  perMarkeSchliessen, ruheVermerk, ruht, sammelText, schlussMarken, uebernehmen, vermerk, zuletztFertig, zuruecknehmen, zuZeigen,
} from './logik'
import type { Marke, Nachricht, Teil } from './logik'
import { PANE, unterwegs, z } from './zustand'
import { abschicken, anhalten, eintragen, gesammelt, senden, teileVon, weiter } from './antworten'
import {
  ablageOrt, aendere, kostenSchreiben, laden, lebenszeichen, lebenszeichenWeg, nachladen, nummernAb, resteAufraeumen, sicht, verlaufAufraeumen,
  versionPruefen, zaehlerLaden, zeigeStatus,
} from './dateien'
import { abgleich, abgleichPlanen, auswerten, ueberblickErneuern } from './haiku'
import {
  aufnehmen, eingangLesen, eingangPlanen, gedankenDatei, gedankeTun, gedankeVermerken, offenKommando, punkteEintragen, startKontext,
  uebergabeAnkuendigen, wiederOeffnen,
} from './kommandos'
import { kopf, kurzbefehle, optionenText, wahl } from './oberflaeche'
import { nutzung } from './dateien'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ausgeblendetA = atom({ plugin: 'offene-punkte', key: 'ausgeblendet' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')
const eigeneA = atom({ plugin: 'offene-punkte', key: 'eigene' } as const, '')
const spaeterA = atom({ plugin: 'offene-punkte', key: 'spaeter' } as const, '')
const warnungenAusA = atom({ plugin: 'offene-punkte', key: 'warnungenAus' } as const, [])
const abschickenA = atom({ plugin: 'offene-punkte', key: 'abschicken' } as const, { sekunden: 0, inEingabe: false })
const gedankenStandA = atom({ plugin: 'offene-punkte', key: 'gedankenStand' } as const, 0)
const warnungenA = atom({ plugin: 'kontext-anzeige', key: 'warnungen' } as const, [] as Warnung[])

export const register: Register = (on, options) => {
  z.modell = String(options.modell ?? 'haiku') || 'haiku'
  z.fragenAnzeigen = options.fragenAnzeigen !== false
  z.budgetGrenze = Number(options.haikuBisProzent ?? BUDGET_GRENZE) || BUDGET_GRENZE
  z.laeuft = false
  z.ort = null
  z.zeitgeber = null
  unterwegs.clear()
  z.sitzung = ''
  z.claudeKennt = ''
  z.interaktiv = true
  z.eingabeArt = 'mensch'
  z.turnLaeuft = false
  z.abgleichLaeuft = false
  z.abgleichTakt = null
  z.ueberblickLaeuft = false
  z.fertigeTurns = 0
  z.ueberblickBis = 0
  z.fortgeschrieben = 0
  z.eingangTakt = null
  z.eingangLaeuft = false
  z.letzterMensch = 0
  z.installiert = ''
  z.frisch = false
  z.dateiStand = 0
  z.istWindows = null
  z.lebtGeschrieben = 0

  on('session.start', async ($, e, next) => {
    // Ohne Menschen davor (claude -p, SDK) bleibt der Mod still: kein Werkzeug, kein Hinweis, kein Haiku -
    // nur die Datei und Claudes Marken. Das spart in Skript-Laeufen jede Anfrage rund 1.000 Tokens.
    z.interaktiv = e.isInteractive !== false
    z.turnLaeuft = false
    await $.command.register({
      name: 'offen',
      description: 'Zeigt, was noch offen ist; /offen 2 erledigt|weg|später [sitzung|morgen|drei|woche], /offen 2 a wählt eine Antwort, /offen 2 <Text> antwortet frei, /offen alle weg|erledigt [Grund], /offen klären [alle], /offen übergabe [nur] schreibt eine Übergabe für die nächste Sitzung und leert dann den Verlauf, /offen übergaben, /offen neu <Text>, /offen gedanke <Text> notiert einen Einfall (gedanken.md), /offen gedanke 3 senden|interview|punkt, /offen kosten [Tage] zeigt, was der Mod gekostet hat, /offen leeren',
    })
    await $.command.register({ name: 'erledigt', description: 'Kurzform: /erledigt 2 (oder 2 3) schließt offene Punkte wie /offen 2 erledigt' })
    await $.command.register({ name: 'weg', description: 'Kurzform: /weg 2 (oder 2 3) verwirft offene Punkte wie /offen 2 weg' })
    await $.command.register({
      name: 'zusammenfassung',
      description: 'Fasst die ganze Sitzung zusammen: Ziel, Erledigtes, was du noch tun musst (mit Befehlen), offene Entscheidungen',
    })
    await update($, prueftA, () => false)
    z.sitzung = await $.session.id().catch(() => '')
    await versionPruefen($).catch(() => undefined)
    if (z.interaktiv) await lebenszeichen($).catch(() => undefined)
    await laden($).catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
    // Neu ist die Unterhaltung nur ohne Verlauf: ein Neuladen des Mods mitten in der Sitzung oder
    // --continue bekommen keine Uebergabe (die alte Unterhaltung kennt ihren Stand ja).
    if (z.interaktiv) {
      const verlauf = await Promise.resolve().then(() => $.session.messages()).catch(() => null)
      z.frisch = Array.isArray(verlauf) && verlauf.length === 0
      if (z.frisch) await uebergabeAnkuendigen($).catch(() => undefined)
    }
    $.clock.after(0, () => {
      void verlaufAufraeumen($).catch(fehler => $.ui.log(`offene-punkte: Verlauf nicht aufgeräumt (${String(fehler)})`))
      void resteAufraeumen($).catch(fehler => $.ui.log(`offene-punkte: Reste nicht aufgeräumt (${String(fehler)})`))
    })
    await zaehlerLaden($).catch(fehler => $.ui.log(`offene-punkte: Zaehler nicht gelesen (${String(fehler)})`))
    // Punkte aus 0.5.0 haben noch keine Nummer.
    const ab = await nummernAb($)
    await update($, punkteA, l => nummerieren(l, ab))
    await zeigeStatus($)
    if (z.interaktiv) {
      $.clock.after(0, () => {
        void abgleich($, 'start').catch(fehler => $.ui.log(`offene-punkte: Abgleich fehlgeschlagen (${String(fehler)})`))
        void eingangLesen($).catch(fehler => $.ui.log(`offene-punkte: Eingang (${String(fehler)})`))
      })
      abgleichPlanen($)
      eingangPlanen($)
    }
    // Nach einem Neuladen des Plugins: was gesammelt wartete, wartet weiter (der Zeitgeber ist neu).
    await weiter($).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    z.turnLaeuft = true
    z.turnStart = await $.clock.now()
    z.turnText = e.text
    return next(e)
  })

  // Nach einer Compaction kennt Claude die Liste nicht mehr sicher: mit dem naechsten Prompt kommt sie wieder.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && !('skip' in r && r.skip !== undefined)) {
      z.claudeKennt = ''
      z.ueberblickBis = 0
      // Der Ueberblick aus dem komprimierten Verlauf: die Zusammenfassung der Engine ist jetzt Teil davon.
      if (z.interaktiv) $.clock.after(0, () => void ueberblickErneuern($, 'compaction').catch(fehler => $.ui.log(`offene-punkte: Überblick (${String(fehler)})`)))
    }
    return r
  }).catch((_, e, next) => next(e))

  // Nach /clear startet keine neue Sitzung im Sinne von session.start: dort die Datei nachladen.
  on('session.end', async ($, e, next) => {
    const r = await next(e)
    if (e.reason !== 'clear') await lebenszeichenWeg($, z.sitzung).catch(() => undefined)
    if (e.reason === 'clear') {
      z.ort = null
      z.claudeKennt = ''
      z.ueberblickBis = 0
      z.fortgeschrieben = 0
      // Rückmeldungen zur alten Unterhaltung („Dein Block hat angelegt: #79“) gehören nicht in die neue.
      z.hinweiseFuerClaude = []
      z.eingabeArt = 'mensch'
      z.zeitgeber?.cancel()
      z.zeitgeber = null
      z.vorschlag = ''
      z.ticker?.cancel()
      z.ticker = null
      $.clock.after(0, () => void update($, abschickenA, () => ({ sekunden: 0, inEingabe: false })))
      // Antworten, die noch nicht bei Claude sind, gehoeren zur alten Unterhaltung: wieder fragen.
      $.clock.after(0, () => {
        void (async () => {
          // Neue Unterhaltung, neue Sitzungs-ID: die eigenen Punkte gehen mit.
          const alt = z.sitzung
          z.sitzung = await $.session.id().catch(() => alt)
          if (z.sitzung !== alt) await lebenszeichenWeg($, alt).then(() => lebenszeichen($)).catch(() => undefined)
          await aendere($, l => uebernehmen(zuruecknehmen(l), z.sitzung, alt))
          await laden($)
          if (z.interaktiv) {
            z.frisch = true
            await uebergabeAnkuendigen($)
          }
        })().catch(fehler => $.ui.log(`offene-punkte: Laden fehlgeschlagen (${String(fehler)})`))
      })
    }
    return r
  })

  // Eingaben von Maschinen: Peer-Nachrichten, Zeitplaene, der SDK-Host, Kanaele. Was Claude darauf
  // antwortet, erzeugt keine Punkte und laesst keinen altern - nur seine Marken zaehlen.
  const MASCHINEN = new Set(['sdk', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel'])

  on('prompt.submit', async ($, e, next) => {
    z.eingangZeit = await $.clock.now()
    // Ein stat: hat eine andere Sitzung inzwischen geschlossen, bekommt Claude die Liste ohne diese Punkte.
    if (z.interaktiv) await nachladen($).catch(() => undefined)
    const punkte = await read($, punkteA).catch((): Punkt[] => [])
    // Die offenen Punkte gehen still mit, wenn sie sich geaendert haben (und nach einer Compaction):
    // Claude kennt den ganzen Verlauf und schliesst, was schon erledigt oder hinfaellig ist. Auch zu
    // Maschinen-Eingaben - sonst erfaehrt Claude Nummern und Rueckmeldungen erst Turns spaeter.
    const liste = z.interaktiv ? listeFuerClaude(punkte, await sicht($)) : ''
    const mitListe = liste !== '' && liste !== z.claudeKennt
    if (mitListe) z.claudeKennt = liste
    const hinweise = z.hinweiseFuerClaude
    z.hinweiseFuerClaude = []
    // Erste Nachricht einer neuen Unterhaltung: Uebergabe oder Ueberblick der letzten Sitzung, einmal.
    const start = z.interaktiv && z.frisch
      ? await startKontext($).catch(fehler => (($.ui.log(`offene-punkte: Übergabe nicht gelesen (${String(fehler)})`)), ''))
      : ''
    z.frisch = false
    const zusatz = [...(start !== '' ? [start] : []), ...(mitListe ? [liste] : []), ...hinweise]
    const kontext = zusatz.length > 0 ? { context: [...(e.context ?? []), ...zusatz] } : {}
    // Was der Mod dem Hauptmodell mitgibt, steht geschaetzt in kosten.jsonl (/offen kosten) - der teure Teil.
    if (zusatz.length > 0) {
      const zeile = kontextZeile({ uebergabe: start, liste: mitListe ? liste : '', hinweise: hinweise.join('\n') }, z.sitzung, z.eingangZeit)
      $.clock.after(0, () => void kostenSchreiben($, zeile).catch(() => undefined))
    }
    if (MASCHINEN.has(e.origin.kind)) {
      z.eingabeArt = 'maschine'
      return next({ ...e, ...kontext })
    }
    // Nur was der Nutzer selbst schreibt, an der Tastatur oder am Handy - eine Antwort aus der Auswahl kennt
    // der Mod schon. Die eigene Klaerung (/offen klaeren) zaehlt wie claude-webs Klaerung als Maschine.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') {
      if (istMaschinenEingabe(e.text)) z.eingabeArt = 'maschine'
      return next({ ...e, ...kontext })
    }
    // claude-webs Klaerung kommt per tmux wie getippt an: wie eine Maschine behandeln.
    z.eingabeArt = istMaschinenEingabe(e.text) ? 'maschine' : 'mensch'
    if (z.eingabeArt === 'mensch') z.letzterMensch = await $.clock.now()
    // Selbst abgeschickt (z. B. Enter auf die vorgelegten Antworten): kein Countdown mehr.
    z.vorschlag = ''
    z.ticker?.cancel()
    z.ticker = null
    $.clock.after(0, () => void update($, abschickenA, () => ({ sekunden: 0, inEingabe: false })))
    const mit = gesammelt(punkte)
    const eingabe = ausstehende(punkte, 'eingabe')
    // Selbst geschriebene Antworten („Zum offenen Punkt „Titel“: …“, auch von claude-web per tmux):
    // die Punkte schliessen sich mit dieser Nachricht, ohne zweiten Befehl.
    const getippt = eingetippteAntworten(e.text, punkte)
    // Die Bitte aus dem Knopf Planungsinterview ist abgeschickt: der Punkt ruht, solange das Interview laeuft.
    const interview = interviewNummer(e.text)
    if (interview !== undefined) {
      $.clock.after(0, () => void aendere($, l => insInterview(l, interview, z.sitzung)).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`)))
    }
    // Gesammelte Antworten gehen mit dieser Nachricht, vor ihr - so kennt Claude sie zuerst.
    const text = mit.length > 0 ? `${sammelText(teileVon(mit))}\n\n${e.text}` : e.text
    z.letzteEingabe = text
    if (mit.length + eingabe.length + getippt.length === 0) return next({ ...e, ...kontext })

    z.zeitgeber?.cancel()
    z.zeitgeber = null
    const ids = new Set(mit.map(p => p.id))
    const weg = new Set<string>()
    const ergebnisse = new Map<string, string>()
    // Antworten aus der Eingabe: was noch in der Nachricht steht, ist beantwortet; was der Nutzer
    // herausgenommen hat, wird wieder gefragt.
    for (const p of eingabe) {
      const t = antwortIn(e.text, p.titel)
      if (t === null) {
        weg.add(p.id)
        continue
      }
      ids.add(p.id)
      // Was der Nutzer ergaenzt hat, kommt hinter die Wahl - nicht die Wahl selbst noch einmal.
      ergebnisse.set(p.id, t !== '' && t !== p.ausstehend?.text ? `${p.ausstehend?.ergebnis} – „${t}“` : String(p.ausstehend?.ergebnis))
    }
    const gesendet = await $.clock.now()
    const r = await next({ ...e, text, ...kontext })
    const angekommen = !('drop' in r && r.drop !== undefined)
    // Nicht hier warten: das Schliessen schreibt Dateien.
    $.clock.after(0, () => {
      void aendere($, l => {
        if (!angekommen) return zuruecknehmen(l)
        const selbst = new Map(getippt.map(g => [g.id, g.text]))
        const mitSelbst = l.map(p => {
          const t = selbst.get(p.id)
          if (t === undefined || p.status !== 'offen' || p.ausstehend !== undefined) return p
          return { ...p, status: 'erledigt' as const, ergebnis: t !== '' ? `eigene Antwort – „${t.slice(0, 300)}“` : 'eigene Antwort', beiClaude: gesendet }
        })
        return zuruecknehmen(abschliessen(mitSelbst, ids, ergebnisse, gesendet), weg)
      }).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
    })
    return r
  }).catch((_, e, next) => next(e))

  // Tippt der Nutzer in die vorgelegten Antworten, laeuft kein Countdown mehr: er schickt selbst ab.
  on('prompt.edit', async ($, e, next) => {
    if (z.ticker !== null && z.vorschlag !== '') {
      z.vorschlag = ''
      await anhalten($)
    }
    return next(e)
  })

  // Claude schließt selbst: „erledigt: #3“ in der Antwort schließt den Punkt sofort (auch bei kurzen Antworten).
  on('prompt.context', async ($, e, next) => {
    if (!z.interaktiv) return next(e)
    const r = await next(e)
    return { ...r, blocks: [...r.blocks, { name: 'offenePunkte', text: HINWEIS_BLOCK }] }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) z.turnLaeuft = false
    const marken = e.agentId === undefined && e.reason === 'answer' ? schlussMarken(e.answer) : []
    if (marken.length > 0) {
      void nutzung($, 'marke', marken.some(m => m.ueberholt) ? 'ueberholt' : 'erledigt').catch(() => undefined)
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          let vorher: Punkt[] = []
          const zu = await aendere($, l => {
            vorher = l
            return perMarkeSchliessen(l, marken, jetzt, z.sitzung)
          })
          if (zu.length > 0) $.ui.toast(zu.map(p => `🤖 „${p.titel}“ ${p.ergebnis?.includes('überholt') ? 'überholt' : 'erledigt'}`).join(' · ') + ' · /offen zum Wiederöffnen', { timeoutMs: 6000 })
          // Eine geratene oder fremde Nummer nicht still verpuffen lassen: der Nutzer sieht es, Claude erfaehrt es mit der naechsten Nachricht.
          const fehl = markenOhneTreffer(vorher, marken, z.sitzung, z.eingangZeit)
          if (fehl.length > 0) {
            $.ui.toast(`Marke ohne Treffer: ${fehl.join(' · ')}`, { timeoutMs: 8000 })
            z.hinweiseFuerClaude.push(markenHinweis(fehl, await read($, punkteA), z.sitzung))
          }
        })().catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    // „gedanke erledigt: G3 – Commit abc1234“: der Vermerk in gedanken.md.
    if (e.agentId === undefined && e.reason === 'answer' && /gedanke\s+(erledigt|umgesetzt|verworfen):/i.test(e.answer)) {
      const antwort = e.answer
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          const fertig: string[] = []
          for (const m of gedankenMarken(antwort, jetzt)) {
            if ((await gedankeVermerken($, m.nr, m.vermerk)) !== null) fertig.push(`G${m.nr} ${m.vermerk}`)
          }
          if (fertig.length > 0) $.ui.toast(`💭 ${fertig.join(' · ')}`, { timeoutMs: 6000 })
        })().catch(fehler => $.ui.log(`offene-punkte: Gedanken (${String(fehler)})`))
      })
    }
    // Der Block in der Antwort: Punkte anlegen und aendern, ohne weitere Modellrunde.
    const block = e.agentId === undefined && e.reason === 'answer' ? blockLesen(e.answer) : { neu: [], aenderungen: [] }
    const blockDa = block.neu.length + block.aenderungen.length > 0
    if (blockDa) {
      void nutzung($, 'block', block.neu.length > 0 ? 'neu' : 'aenderung').catch(() => undefined)
      $.clock.after(0, () => {
        void punkteEintragen($, block.neu, block.aenderungen).catch(fehler => $.ui.log(`offene-punkte: Block (${String(fehler)})`))
      })
    }
    // Nach Marken und Block (beide oben eingereiht): was bei Claude lag und weder bestaetigt noch
    // wieder geoeffnet wurde, ist nur noch beantwortet. Kaeme es doch zuerst, oeffnet der Block trotzdem.
    if (e.agentId === undefined && e.reason === 'answer') {
      const start = z.turnStart
      const text = z.turnText
      $.clock.after(0, () => {
        void aendere($, l => beiClaudeFertig(l, start, text)).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    // Nach Maschinen-Eingaben (Peer, Zeitplan, Klaerung) und ohne Menschen davor: nur Marken und Block.
    const mensch = z.interaktiv && z.eingabeArt === 'mensch'
    if (mensch && e.agentId === undefined && e.reason === 'answer') {
      const antwort = e.answer
      const eingabe = z.letzteEingabe
      $.clock.after(0, () => {
        void (async () => {
          const jetzt = await $.clock.now()
          const alt = await aendere($, l => altern(l, antwort, jetzt))
          if (alt.length > 0) $.ui.toast(alt.map(p => `🤖 „${p.titel}“ geschlossen (${p.auto?.grund})`).join(' · ') + ' · /offen zum Wiederöffnen', { timeoutMs: 6000 })
          // Claude hat gefragt, aber keinen Block geschrieben: Haiku fasst nach.
          if (!blockDa && nachfassen(antwort)) await auswerten($, [antwort], eingabe)
          // Alle UEBERBLICK_NACH Antworten den Ueberblick aus dem Verlauf neu schreiben.
          z.fertigeTurns++
          if (z.fertigeTurns >= UEBERBLICK_NACH) await ueberblickErneuern($, 'takt')
        })().catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    return r
  })

  on('command.run', { command: 'offen' }, async ($, e) => {
    const antwort = await offenKommando($, e.args)
    if (antwort !== null) return { text: antwort }

    await update($, ausgeblendetA, () => false)
    const platz = await $.ui.open({ id: PANE, title: 'Offene Punkte' })
    const liste = offene(await read($, punkteA))
    const ueberblick = await read($, ueberblickA)
    const s = await sicht($)
    const o = await ablageOrt($)
    const aktiv = liste.filter(p => !ruht(p, s))
    const ruhend = liste.filter(p => ruht(p, s))
    // Steht das Pane, zeigt es alles - die Befehlsausgabe landet sonst als Text im Kontext des Modells.
    if (platz.isPlaced) {
      const stand = liste.length === 0 ? 'Nichts offen' : `${aktiv.length} offen${ruhend.length > 0 ? `, ${ruhend.length} zurückgelegt` : ''}`
      return { text: `${stand} – alles im Pane „Offene Punkte“.` }
    }
    const kopfzeile = ueberblick !== '' ? `Überblick:\n${ueberblick}\n\n` : ''
    const fuss = o !== null ? `\n\nDatei: ${o.ordner}/offen.md · Verlauf: antworten-JJJJ-MM-TT.md` : ''
    if (liste.length === 0) return { text: `${kopfzeile}Nichts offen.${fuss}` }

    const aktivText = aktiv.length === 0 ? 'Gerade ist nichts dran.' : aktiv.map((p, i) => {
      const anleitung = (p.anleitung ?? '') !== '' ? `\n${p.anleitung.replace(/^/gm, '   ')}` : ''
      return `${p.nr ?? i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel}${vermerk(p, s)} – ${p.frage}${p.info !== '' ? `\n   ${p.info}` : ''}${anleitung}\n   ${optionenText(p)}`
    }).join('\n')
    // Zurueckgelegtes nur mit Titel und Termin, damit es nicht wie eine offene Frage aussieht.
    const ruhendText = ruhend.length === 0 ? '' : `\n\nZurückgelegt (${ruhend.length}):\n` + ruhend
      .map((p, i) => `${p.nr ?? i + 1}. ${p.titel} – ${ruheVermerk(p, s)}`).join('\n')
    const auto = autoErledigt(await read($, punkteA), await $.clock.now())
    const autoText = auto.length === 0 ? '' : `\n\nAutomatisch erledigt (${auto.length}, /offen <Nr> aktuell öffnet wieder):\n` + auto
      .map(p => `🤖 ${p.nr ?? '?'}. ${p.titel} – ${p.auto?.grund}`).join('\n')
    const gedanken = ((await gedankenDatei($))?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')
    const gedankenAbschnitt = gedanken.length === 0 ? '' : `\n\nGedanken (${gedanken.length}, /offen gedanke <Nr> senden|interview|punkt):\n` + gedanken
      .map(x => `💭 G${x.nr} · ${x.vermerk}: ${gedankeKurz(x, 100)}`).join('\n')
    return {
      text: kopfzeile + aktivText + ruhendText + autoText + gedankenAbschnitt + `\n\n/offen <Nr> a|b|c|d wählt eine Antwort · /offen <Nr> antwort <Text> · /offen <Nr> erledigt|weg|später [sitzung|morgen|drei|woche] · /offen alle weg|erledigt · /offen klären [alle] · /offen neu <Text> · /offen gedanke <Text>${fuss}`,
    }
  })

  // Kurzformen: /erledigt 2 3 und /weg 2 - je Nummer wie /offen <Nr> erledigt|weg.
  for (const tun of ['erledigt', 'weg'] as const) {
    on('command.run', { command: tun }, async ($, e) => {
      const nummern = kurzNummern(e.args)
      if (nummern === null) return { text: `Verwendung: /${tun} <Nr> [<Nr> …] – die Nummern zeigt /offen.` }
      const antworten: string[] = []
      for (const n of nummern) antworten.push((await offenKommando($, `${n} ${tun}`)) ?? '')
      return { text: antworten.filter(t => t !== '').join('\n') }
    })
  }

  // Die ganze Sitzung zusammenfassen: ein Fork des Hauptmodells ueber den eigenen Verlauf (aus dem
  // Prompt-Cache), ohne Werkzeuge. Der Ueberblick kommt daneben von Haiku aus den Texten des Verlaufs -
  // nicht als zweiter Fork, der den ganzen Kontext noch einmal laese (claude-web: Knopf "Aktualisieren").
  on('command.run', { command: 'zusammenfassung' }, async $ => {
    const [r] = await Promise.all([
      $.model.fork({ prompt: ZUSAMMENFASSUNG }),
      ueberblickErneuern($, 'zusammenfassung').catch(fehler => $.ui.log(`offene-punkte: Überblick (${String(fehler)})`)),
    ])
    if (r.isAnswered) return { text: r.text }
    if (r.reason === 'nothing-to-fork') return { text: 'Noch nichts zusammenzufassen – die Sitzung hat noch keine Antwort.' }
    return { text: `Zusammenfassung nicht möglich (${r.reason}).` }
  })

  // Die naechste offene Frage ueber der Eingabe, darueber Warnungen von kontext-anzeige.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [alle, aus, warnungen, s] = await Promise.all([read($, punkteA), read($, warnungenAusA), read($, warnungenA), sicht($)])
    // Ausgeblendete Warnungen kommen wieder, sobald sie einmal verschwunden waren.
    const aktuell = new Set(warnungen.map(w => w.schluessel))
    if (aus.some(x => !aktuell.has(x))) $.clock.after(0, () => void update($, warnungenAusA, l => l.filter(x => aktuell.has(x))))
    const zeigen = zuZeigen(warnungen, aus)
    const fragen = z.fragenAnzeigen && !(await read($, ausgeblendetA))
    const liste = fragen ? fragbar(alle, s) : []
    const punkt = liste[0]
    const ab = await read($, abschickenA)
    if (punkt === undefined && zeigen.length === 0 && ab.sekunden === 0) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const warnZeilen = zeigen.map(w => (
      <Box key={`warn-${w.schluessel}`} flexDirection="row" flexWrap="wrap">
        <Text color="red" wrap="wrap">⚠ {w.text} </Text>
        {mitCompact(w) && <Button key={`compact-${w.schluessel}`} label="/compact" onPress={() => void eintragen($, '/compact ')} />}
        <Text> </Text>
        <Button key={`aus-${w.schluessel}`} label="Ausblenden" onPress={() => void update($, warnungenAusA, l => [...l, w.schluessel])} />
      </Box>
    ))
    if (punkt === undefined && ab.sekunden > 0) {
      const n = gesammelt(alle).length + ausstehende(alle, 'eingabe').length
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
          {warnZeilen}
          <Text>
            <Text color="green" bold>✓ Alle Fragen beantwortet</Text>
            <Text>{` – ${n === 1 ? 'die Antwort geht' : `${n} Antworten gehen`} in ${ab.sekunden} s an Claude.`}</Text>
          </Text>
          <Box flexDirection="row">
            <Text dimColor>{ab.inEingabe ? 'Steht in der Eingabe: Enter schickt sofort, Tippen hält an. ' : ''}</Text>
            <Button key="jetzt" label="Jetzt senden" variant="primary" onPress={() => void abschicken($)} />
            {ab.inEingabe && <Text> </Text>}
            {ab.inEingabe && <Button key="anhalten" label="Anhalten" onPress={() => { z.vorschlag = ''; void anhalten($) }} />}
          </Box>
        </Box>
      )
    }
    if (punkt === undefined) return <Box flexDirection="column" paddingX={1}>{warnZeilen}</Box>

    const k = kopf(punkt)
    const wartend = gesammelt(alle).length
    const [eigene, spaeter] = await Promise.all([read($, eigeneA), read($, spaeterA)])

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={k.farbe} paddingX={1}>
        {warnZeilen}
        <Text>
          <Text color={k.farbe} bold>{k.zeichen}{punkt.nr !== undefined ? ` #${punkt.nr}` : ''}</Text>
          <Text dimColor>{liste.length > 1 ? ` (1 von ${liste.length})` : ''}{istVeraltet(punkt) ? ' – noch aktuell?' : ''}: </Text>
          <Text bold>{punkt.titel}</Text>
        </Text>
        <Text wrap="wrap">{punkt.frage}</Text>
        {(punkt.anleitung ?? '') !== '' && <Markdown key={`anleitung-${punkt.id}`} text={punkt.anleitung} />}
        {punkt.nr !== undefined && <Text dimColor wrap="wrap">{kurzbefehle(punkt)}</Text>}
        {wartend > 0 && (
          <Box key="wartend" flexDirection="row">
            <Text color="cyan">{wartend === 1 ? '1 Antwort wartet' : `${wartend} Antworten warten`} auf die übrigen Fragen (höchstens 30 s) </Text>
            <Button key="senden" label="Jetzt senden" onPress={() => void senden($)} />
          </Box>
        )}
        <Box flexDirection="row">
          {wahl($, els, e.surface, `wahl-${punkt.id}`, punkt, eigene, spaeter)}
          <Text> </Text>
          <Button key="alle" label="Alle zeigen" onPress={() => void $.ui.open({ id: PANE, title: 'Offene Punkte' })} />
          <Text> </Text>
          <Button key="ausblenden" label="Ausblenden" onPress={() => void update($, ausgeblendetA, () => true)} />
        </Box>
      </Box>
    )
  })

  // /offen: alles, was offen ist, und was zuletzt erledigt wurde.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els
    const [punkte, prueft, ueberblick, eigene, spaeter, s] = await Promise.all([
      read($, punkteA), read($, prueftA), read($, ueberblickA), read($, eigeneA), read($, spaeterA), sicht($),
    ])
    const liste = offene(punkte).filter(p => !ruht(p, s))
    const ruhend = offene(punkte).filter(p => ruht(p, s))
    const fertig = zuletztFertig(punkte)
    // Gedanken aus der Datei; der Stand-Zaehler sorgt dafuer, dass das Pane nach einer Aenderung neu zeichnet.
    await read($, gedankenStandA)
    const gedanken = ((await gedankenDatei($))?.d.gedanken ?? []).filter(x => gedankeZustand(x) !== 'verarbeitet')

    return (
      <Box flexDirection="column">
        {ueberblick !== '' && (
          <Box key="ueberblick" flexDirection="column" marginBottom={1}>
            <Text bold>Überblick</Text>
            <Markdown key="ueberblick-text" text={ueberblick} />
          </Box>
        )}
        {prueft && <Text dimColor>prüft die letzte Antwort …</Text>}
        {liste.length === 0 && <Text dimColor>{ruhend.length > 0 ? 'Gerade ist nichts dran.' : 'Nichts offen.'}</Text>}
        {liste.map((p, i) => (
          <Box key={p.id} flexDirection="column" borderStyle="round" borderColor={kopf(p).farbe} borderDimColor={istVeraltet(p)} paddingX={1}>
            <Text>
              <Text color={kopf(p).farbe} bold>{p.nr ?? i + 1}. {p.art === 'aufgabe' ? 'Zu tun: ' : ''}</Text>
              <Text bold>{p.titel}</Text>
              <Text dimColor>{vermerk(p, s)}</Text>
            </Text>
            <Text wrap="wrap" dimColor={istVeraltet(p)}>{p.frage}</Text>
            {p.info !== '' && <Text dimColor wrap="wrap">{p.info}</Text>}
            {(p.anleitung ?? '') !== '' && <Markdown key={`anl-${p.id}`} text={p.anleitung} />}
            {fremd(p, s.sitzung)
              ? <Button key={`hier-${p.id}`} label="Hier übernehmen" onPress={() => void aendere($, l => l.map(x => (x.id === p.id ? { ...x, sitzung: z.sitzung } : x)))} />
              : wahl($, els, e.surface, `liste-${p.id}`, p, eigene, spaeter)}
          </Box>
        ))}
        {gedanken.length > 0 && <Text key="gedanken-kopf" dimColor>— Gedanken ({gedanken.length}) —</Text>}
        {gedanken.map(x => (
          <Box key={`g-${x.nr}`} flexDirection="row" flexWrap="wrap">
            <Text dimColor={gedankeZustand(x) !== 'offen'}>💭 G{x.nr} · {x.vermerk}: {gedankeKurz(x)} </Text>
            {gedankeZustand(x) === 'offen' && <Button key={`gs-${x.nr}`} label="Senden" onPress={() => void gedankeTun($, x.nr, 'senden')} />}
            {gedankeZustand(x) === 'offen' && <Text> </Text>}
            {gedankeZustand(x) === 'offen' && <Button key={`gi-${x.nr}`} label="Interview" onPress={() => void gedankeTun($, x.nr, 'interview')} />}
            {gedankeZustand(x) === 'offen' && <Text> </Text>}
            {gedankeZustand(x) === 'offen' && <Button key={`gp-${x.nr}`} label="Als Punkt" onPress={() => void gedankeTun($, x.nr, 'punkt')} />}
            <Text> </Text>
            <Button key={`ge-${x.nr}`} label="Erledigt" onPress={() => void gedankeTun($, x.nr, 'erledigt')} />
            <Text> </Text>
            <Button key={`gw-${x.nr}`} label="Weg" onPress={() => void gedankeTun($, x.nr, 'weg')} />
          </Box>
        ))}
        {ruhend.length > 0 && <Text key="ruhend-kopf" dimColor>— zurückgelegt ({ruhend.length}) —</Text>}
        {ruhend.map(p => (
          <Box key={`r-${p.id}`} flexDirection="row" flexWrap="wrap">
            <Text dimColor>⏸ {p.titel} · {ruheVermerk(p, s)}</Text>
            <Text> </Text>
            <Button key={`aufnehmen-${p.id}`} label="Jetzt aufnehmen" onPress={() => void aufnehmen($, p.id)} />
          </Box>
        ))}
        {fertig.length > 0 && <Text dimColor>— zuletzt erledigt —</Text>}
        {fertig.map(p => (
          <Box key={`f-${p.id}`} flexDirection="row">
            <Text dimColor strikethrough={p.status === 'verworfen'}>
              {p.status === 'verworfen' ? '✗' : p.beiClaude !== undefined ? '⏳' : p.auto !== undefined ? '🤖' : '✓'} {p.titel}{p.ergebnis ? `: ${p.ergebnis}` : ''}{p.beiClaude !== undefined ? ' – bei Claude' : ''}
            </Text>
            <Text> </Text>
            <Button key={`auf-${p.id}`} label="Wieder öffnen" onPress={() => void wiederOeffnen($, p.id)} />
          </Box>
        ))}
      </Box>
    )
  })
}
