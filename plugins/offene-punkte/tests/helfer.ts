import type { TestBody } from 'claude-code/testing'

import { ablageLesen } from '../hooks/logik'

// Gemeinsame Helfer der Testdateien. Die grundlage()-Fassungen unterscheiden sich je Datei und bleiben dort.

export type Eng = Parameters<TestBody>[0]

export const OFFEN = '/projekt/offene-punkte/offen.md'
export const KOSTEN = '/projekt/offene-punkte/kosten.jsonl'

// Unter Windows reicht die Engine Pfade als C:\projekt\... an die fs-Hooks; die Schlüssel der Maps bleiben POSIX.
export const pfad = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

export const befehl = async ($: Eng, args: string) => String(((await $.command.run({ command: 'offen', args } as never)) as { text?: string }).text)

export const gespeichert = (dateien: Map<string, string>) => ablageLesen(String(dateien.get(OFFEN)))?.punkte ?? []
