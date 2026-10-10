import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Punkt } from '../types'
import { AUFTRAG, ZUSAMMENFASSUNG, anfrage, brauchtErgaenzung, lies, offene, statuszeile, zusammenfuehren } from './logik'

// Offene Punkte der Sitzung: nach jeder Antwort liest ein kleines Modell
// (Haiku), was noch eine Entscheidung, Freigabe oder Zuarbeit des Nutzers
// braucht, und stellt es als Frage mit Antwortmoeglichkeiten ueber die
// Eingabe. Aufgaben bringen ihre Anleitung mit (Befehle, Pfade), dazu fuehrt
// Haiku einen kurzen Ueberblick ueber die Sitzung. /offen zeigt beides,
// /zusammenfassung laesst das Hauptmodell die ganze Sitzung zusammenfassen.

const PANE = 'offene-punkte'
const punkteA = atom({ plugin: 'offene-punkte', key: 'punkte' } as const, [])
const prueftA = atom({ plugin: 'offene-punkte', key: 'prueft' } as const, false)
const ausgeblendetA = atom({ plugin: 'offene-punkte', key: 'ausgeblendet' } as const, false)
const ueberblickA = atom({ plugin: 'offene-punkte', key: 'ueberblick' } as const, '')

// Feste Wahlmoeglichkeiten unter jeder Frage.
const SPAETER = '__spaeter'
const ERLEDIGT = '__erledigt'
const VERWERFEN = '__verwerfen'

// Einstellungen, von register gesetzt.
let modell = 'haiku'
let mindestLaenge = 400
let fragenAnzeigen = true
// Die letzte Nachricht des Nutzers - sagt Haiku, was er gerade schon beantwortet hat.
let letzteEingabe = ''
// Laeuft schon eine Auswertung, wartet die naechste Antwort darauf (nie zwei gleichzeitig).
let warteschlange: { antwort: string; eingabe: string } | null = null
let laeuft = false

async function zeigeStatus($: EngineInterface) {
  const [punkte, prueft] = await Promise.all([read($, punkteA), read($, prueftA)])
  $.ui.status(statuszeile(punkte, prueft))
}

/** Eine Antwort von Haiku auswerten lassen und das Ergebnis in die Liste nehmen. */
async function auswerten($: EngineInterface, antwort: string, eingabe: string) {
  if (laeuft) {
    warteschlange = { antwort, eingabe }
    return
  }
  laeuft = true
  await update($, prueftA, () => true)
  await zeigeStatus($)
  try {
    const vorher = offene(await read($, punkteA))
    const r = await $.model.complete({
      model: modell,
      system: [{ text: AUFTRAG, cache: true }],
      prompt: anfrage(antwort, eingabe, vorher, await read($, ueberblickA)),
      maxTokens: 3000,
      timeoutMs: 45_000,
    })
    if (!r.isAnswered) {
      $.ui.log(`offene-punkte: keine Auswertung (${r.reason})`)
      return
    }
    const a = lies(r.text)
    if (a === null) {
      $.ui.log('offene-punkte: Antwort des Modells war kein lesbares JSON')
      return
    }
    const jetzt = await $.clock.now()
    let zaehler = 0
    const neueId = () => `p${jetzt.toString(36)}${(zaehler++).toString(36)}`
    await update($, punkteA, alt => zusammenfuehren(alt, a, jetzt, neueId))
    if (a.ueberblick !== '') await update($, ueberblickA, () => a.ueberblick)
    const bekannt = new Set(vorher.map(p => p.id))
    const neu = offene(await read($, punkteA)).filter(p => !bekannt.has(p.id)).length
    if (neu > 0) {
      $.ui.toast(neu === 1 ? '1 neuer offener Punkt – Frage über der Eingabe' : `${neu} neue offene Punkte – Fragen über der Eingabe`)
    }
  } finally {
    laeuft = false
    await update($, prueftA, () => false)
    await zeigeStatus($)
    const weiter = warteschlange
    warteschlange = null
    if (weiter) await auswerten($, weiter.antwort, weiter.eingabe)
  }
}

async function setzeStatus($: EngineInterface, id: string, status: Punkt['status'], ergebnis: string) {
  await update($, punkteA, liste => liste.map(p => (p.id === id ? { ...p, status, ergebnis } : p)))
  await zeigeStatus($)
}

/** Eine Wahl in der Frage eines Punkts ausfuehren. */
async function waehlen($: EngineInterface, punkt: Punkt, wert: string) {
  if (wert === SPAETER) {
    await update($, punkteA, liste =>
      liste.map(p => (p.id === punkt.id ? { ...p, zurueckgestellt: p.zurueckgestellt + 1 } : p)),
    )
    return
  }
  if (wert === ERLEDIGT) return setzeStatus($, punkt.id, 'erledigt', 'als erledigt markiert')
  if (wert === VERWERFEN) return setzeStatus($, punkt.id, 'verworfen', 'nicht relevant')

  const option = punkt.optionen[Number(wert)]
  if (option === undefined) return
  await setzeStatus($, punkt.id, 'erledigt', option.label)
  if (option.antwort === '') return
  const text = `Zum offenen Punkt „${punkt.titel}“: ${option.antwort}`
  if (brauchtErgaenzung(option.antwort)) {
    // Braucht noch eigenen Text: in die Eingabe, ergaenzen und selbst abschicken.
    await $.prompt.fill({ text: text.trimEnd() + ' ', mode: 'replace' })
    return
  }
  // Als eigene Nachricht des Nutzers; laeuft gerade eine Antwort, kommt sie danach.
  await $.prompt.submit({ text, asUser: true })
}

/**
 * Die Wahl zu einem Punkt: eine Auswahlliste, wo die Oberflaeche eine hat,
 * sonst (Handy) ein Knopf je Antwort - dort ohnehin das Bessere zum Antippen.
 */
function wahl($: EngineInterface, els: ReturnType<EngineInterface['ui']['resolve']>, surface: string, key: string, punkt: Punkt) {
  const optionen = auswahl(punkt)
  if (surface !== 'mobile' && 'Select' in els) {
    const { Select } = els
    return <Select key={key} label="Antwort: " options={optionen} onSelect={(wert: string) => void waehlen($, punkt, wert)} />
  }
  const { Box, Button } = els
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap">
      {optionen.map(o => (
        <Button key={`${key}-${o.value}`} label={o.label ?? o.value} onPress={() => void waehlen($, punkt, o.value)} />
      ))}
    </Box>
  )
}

function auswahl(punkt: Punkt) {
  return [
    ...punkt.optionen.map((o, i) => ({ value: String(i), label: o.label })),
    { value: SPAETER, label: 'Später' },
    { value: ERLEDIGT, label: 'Schon erledigt' },
    { value: VERWERFEN, label: 'Nicht relevant' },
  ]
}

export const register: Register = (on, options) => {
  modell = String(options.modell ?? 'haiku') || 'haiku'
  mindestLaenge = Number(options.mindestLaenge ?? 400)
  fragenAnzeigen = options.fragenAnzeigen !== false
  warteschlange = null
  laeuft = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'offen',
      description: 'Zeigt, was noch offen ist (offene Punkte aus den Antworten); /offen leeren räumt die Liste',
    })
    await $.command.register({
      name: 'zusammenfassung',
      description: 'Fasst die ganze Sitzung zusammen: Ziel, Erledigtes, was du noch tun musst (mit Befehlen), offene Entscheidungen',
    })
    await update($, prueftA, () => false)
    await zeigeStatus($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Nur was der Nutzer selbst schreibt - eine Antwort aus der Auswahl kennt Haiku schon.
    if (e.origin.kind === 'composer') letzteEingabe = e.text
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && e.answer.length >= mindestLaenge) {
      const antwort = e.answer
      const eingabe = letzteEingabe
      // Ausserhalb dieses Hooks: die Auswertung soll das Ende der Antwort nicht aufhalten.
      $.clock.after(0, () => {
        void auswerten($, antwort, eingabe).catch(fehler => $.ui.log(`offene-punkte: ${String(fehler)}`))
      })
    }
    return r
  })

  on('command.run', { command: 'offen' }, async ($, e) => {
    if (e.args.trim() === 'leeren') {
      await update($, punkteA, () => [])
      await update($, ueberblickA, () => '')
      await zeigeStatus($)
      return { text: 'Liste der offenen Punkte geleert.' }
    }
    await update($, ausgeblendetA, () => false)
    await $.ui.open({ id: PANE, title: 'Offene Punkte' })
    const liste = offene(await read($, punkteA))
    const ueberblick = await read($, ueberblickA)
    const kopf = ueberblick !== '' ? `Überblick:\n${ueberblick}\n\n` : ''
    if (liste.length === 0) return { text: `${kopf}Nichts offen.` }

    return {
      text: kopf + liste.map((p, i) => {
        const anleitung = (p.anleitung ?? '') !== '' ? `\n${p.anleitung.replace(/^/gm, '   ')}` : ''
        return `${i + 1}. ${p.art === 'aufgabe' ? 'Zu tun: ' : ''}${p.titel} – ${p.frage}${p.info !== '' ? `\n   ${p.info}` : ''}${anleitung}`
      }).join('\n'),
    }
  })

  // Die ganze Sitzung zusammenfassen: eine Frage an das Hauptmodell ueber den eigenen
  // Verlauf (aus dem Prompt-Cache), ohne Werkzeuge.
  on('command.run', { command: 'zusammenfassung' }, async $ => {
    const r = await $.model.fork({ prompt: ZUSAMMENFASSUNG })
    if (r.isAnswered) return { text: r.text }
    if (r.reason === 'nothing-to-fork') return { text: 'Noch nichts zusammenzufassen – die Sitzung hat noch keine Antwort.' }
    return { text: `Zusammenfassung nicht möglich (${r.reason}).` }
  })

  // Die naechste offene Frage ueber der Eingabe.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!fragenAnzeigen || e.props.hasSurvey || (await read($, ausgeblendetA))) return next(e)
    const liste = offene(await read($, punkteA))
    const punkt = liste[0]
    if (punkt === undefined) return next(e)

    const els = $.ui.resolve(e)
    const { Box, Button, Markdown, Text } = els

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="yellow">{punkt.art === 'aufgabe' ? '◆ Zu tun' : '◆ Offen'}</Text>
          <Text dimColor>{liste.length > 1 ? ` (1 von ${liste.length})` : ''}: </Text>
          <Text bold>{punkt.titel}</Text>
        </Text>
        <Text wrap="wrap">{punkt.frage}</Text>
        {(punkt.anleitung ?? '') !== '' && <Markdown key={`anleitung-${punkt.id}`} text={punkt.anleitung} />}
        <Box flexDirection="row">
          {wahl($, els, e.surface, `wahl-${punkt.id}`, punkt)}
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
    const { Box, Markdown, Text } = els
    const [punkte, prueft, ueberblick] = await Promise.all([read($, punkteA), read($, prueftA), read($, ueberblickA)])
    const liste = offene(punkte)
    const fertig = punkte.filter(p => p.status !== 'offen').slice(-8).reverse()

    return (
      <Box flexDirection="column">
        {ueberblick !== '' && (
          <Box key="ueberblick" flexDirection="column" marginBottom={1}>
            <Text bold>Überblick</Text>
            <Markdown key="ueberblick-text" text={ueberblick} />
          </Box>
        )}
        {prueft && <Text dimColor>prüft die letzte Antwort …</Text>}
        {liste.length === 0 && <Text dimColor>Nichts offen.</Text>}
        {liste.map((p, i) => (
          <Box key={p.id} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color="yellow">{i + 1}. {p.art === 'aufgabe' ? 'Zu tun: ' : ''}</Text>
              <Text bold>{p.titel}</Text>
              {p.zurueckgestellt > 0 && <Text dimColor> (zurückgestellt)</Text>}
            </Text>
            <Text wrap="wrap">{p.frage}</Text>
            {p.info !== '' && <Text dimColor wrap="wrap">{p.info}</Text>}
            {(p.anleitung ?? '') !== '' && <Markdown key={`anl-${p.id}`} text={p.anleitung} />}
            {wahl($, els, e.surface, `liste-${p.id}`, p)}
          </Box>
        ))}
        {fertig.length > 0 && <Text dimColor>— zuletzt erledigt —</Text>}
        {fertig.map(p => (
          <Text key={`f-${p.id}`} dimColor strikethrough={p.status === 'verworfen'}>
            ✓ {p.titel}{p.ergebnis ? `: ${p.ergebnis}` : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
