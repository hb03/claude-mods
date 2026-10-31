// Bausteine fuer Band und Pane
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Punkt } from '../types'
import { KEINE, ZEITEN, z } from './zustand'
import { auswahl, eigeneAntwort, waehlen } from './antworten'

// Die Zustandsreferenzen stehen in jeder Datei, die sie liest oder schreibt: der Lader der Engine
// nimmt an read/update nur Referenzen aus derselben Datei (kein Import).
const eigeneA = atom({ plugin: 'offene-punkte', key: 'eigene' } as const, '')
const spaeterA = atom({ plugin: 'offene-punkte', key: 'spaeter' } as const, '')

type Els = ReturnType<EngineInterface['ui']['resolve']>

/**
 * Die Wahl zu einem Punkt: eine Auswahlliste, wo die Oberflaeche eine hat,
 * sonst (Handy) ein Knopf je Antwort - dort ohnehin das Bessere zum Antippen.
 * Ist "Eigene Antwort" gewaehlt, steht darunter ein Textfeld.
 */
export function wahl($: EngineInterface, els: Els, surface: string, key: string, punkt: Punkt, eigene: string, spaeter: string) {
  const optionen = auswahl(punkt)
  const mitTextfeld = surface !== 'mobile' && 'Input' in els
  const { Box, Button, Text } = els
  if (spaeter === punkt.id) {
    return (
      <Box key={`${key}-spaeter`} flexDirection="row" flexWrap="wrap">
        <Text>Später: </Text>
        {ZEITEN.map(z => (
          <Button key={`${key}-${z.wert}`} label={z.label} onPress={() => void waehlen($, punkt, z.wert, false)} />
        ))}
        <Button key={`${key}-zurueck`} label="Zurück" onPress={() => void update($, spaeterA, () => '')} />
      </Box>
    )
  }
  // Die Antworten des Punkts stehen als Knoepfe da (man sieht, was a und b ist); das Menue hat nur den Rest.
  const feste = optionen.slice(0, punkt.optionen.length)
  const liste = surface !== 'mobile' && 'Select' in els
    ? (
      <Box key={key} flexDirection="row" flexWrap="wrap">
        {feste.map(o => (
          <Box key={`${key}-${o.value}`} flexDirection="row">
            <Button key={`${key}-k${o.value}`} label={o.label} onPress={() => void waehlen($, punkt, o.value, mitTextfeld)} />
            <Text> </Text>
          </Box>
        ))}
        <els.Select
          key={`${key}-menue`}
          label={feste.length > 0 ? '' : 'Antwort'}
          options={[{ value: KEINE, label: feste.length > 0 ? 'mehr …' : 'bitte wählen' }, ...optionen.slice(feste.length)]}
          value={KEINE}
          onSelect={(wert: string) => void (wert === KEINE ? undefined : waehlen($, punkt, wert, mitTextfeld))}
        />
      </Box>
    )
    : (
      <Box key={key} flexDirection="row" flexWrap="wrap">
        {optionen.map(o => (
          <Button key={`${key}-${o.value}`} label={o.label ?? o.value} onPress={() => void waehlen($, punkt, o.value, false)} />
        ))}
      </Box>
    )
  if (!(mitTextfeld && 'Input' in els) || eigene !== punkt.id) return liste

  return (
    <Box key={`${key}-eigene`} flexDirection="column">
      <els.Input
        key={`${key}-text`}
        label="Deine Antwort: "
        placeholder="eigene Antwort, Enter schickt ab"
        submitLabel="senden"
        autoFocus
        onSubmit={(text: string) => void eigeneAntwort($, punkt, text)}
      />
      <Box key={`${key}-zurueck`} flexDirection="row">
        <Text dimColor>Esc: zurück zur Eingabe · </Text>
        <Button key={`${key}-abbrechen`} label="Abbrechen" onPress={() => void update($, eigeneA, () => '')} />
      </Box>
    </Box>
  )
}

export const kopf = (p: Punkt) =>
  p.stufe === 'blockiert'
    ? { zeichen: '■ Blockiert', farbe: 'red' }
    : p.stufe === 'angebot'
      ? { zeichen: '◇ Angebot', farbe: 'gray' }
      : { zeichen: p.art === 'aufgabe' ? '◆ Zu tun' : '◆ Offen', farbe: 'yellow' }

/** Die Befehle, mit denen sich der Punkt ohne Auswahl beantworten laesst - unter der Frage ueber der Eingabe. */
export const kurzbefehle = (p: Punkt) => {
  const n = `/offen ${p.nr}`
  const buchstaben = p.optionen.slice(0, 4).map((_, i) => String.fromCharCode(97 + i)).join('|')
  return [...(buchstaben !== '' ? [`${n} ${buchstaben}`] : []), `${n} <Antwort>`, `/erledigt ${p.nr}`, `/weg ${p.nr}`, `${n} später`].join(' · ')
}

export const optionenText = (p: Punkt) =>
  p.optionen.map((o, i) => `${String.fromCharCode(97 + i)}) ${o.label}`).join(' · ')
