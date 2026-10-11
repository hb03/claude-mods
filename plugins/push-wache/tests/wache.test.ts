import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { ablehnung, frage, hinzugefuegt, host, inhaltPruefen, istOeffentlich, mailsPruefen, pushAufrufe } from '../hooks/logik'

// Zusammengesetzt, damit dieses Repo beim eigenen Push nicht anschlägt.
const SCHLUESSEL = ['sk', 'ant', 'api03', 'A'.repeat(24)].join('-')
const TOKEN = 'gh' + 'p_' + 'b'.repeat(36)

describe('git push erkennen', () => {
  test('Verzeichnis aus -C oder cd, Remote aus dem ersten Argument', async () => {
    expect(pushAufrufe('git push')).toEqual([{}])
    expect(pushAufrufe('git push -u origin main')).toEqual([{ remote: 'origin' }])
    expect(pushAufrufe('cd /projekt && git add -A && git commit -m "x" && git push -q origin HEAD')).toEqual([{ verzeichnis: '/projekt', remote: 'origin' }])
    expect(pushAufrufe('git -C /repo -c user.name=x push oben')).toEqual([{ verzeichnis: '/repo', remote: 'oben' }])
    expect(pushAufrufe('GIT_SSH_COMMAND=ssh git push')).toEqual([{}])
  })

  test('kein Push: andere Befehle, Text in Anführungszeichen, git als Argument', async () => {
    expect(pushAufrufe('git commit -m "danach git push"')).toEqual([])
    expect(pushAufrufe('git log --oneline')).toEqual([])
    expect(pushAufrufe('echo git push')).toEqual([])
    expect(pushAufrufe('grep -r "git push" .')).toEqual([])
  })

  test('öffentliche Hosts aus https-, ssh- und scp-Form', async () => {
    const hosts = 'github.com, gitlab.com'
    expect(host('https://github.com/a/b.git')).toBe('github.com')
    expect(host('git@github.com:a/b.git')).toBe('github.com')
    expect(host('ssh://git@gitlab.com:22/a/b')).toBe('gitlab.com')
    expect(istOeffentlich('git@github.com:a/b.git', hosts)).toBe(true)
    expect(istOeffentlich('/opt/git/b.git', hosts)).toBe(false)
    expect(istOeffentlich('https://git.example.org/a/b', hosts)).toBe(false)
  })
})

const DIFF = [
  'commit 1234567890abcdef',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -3,0 +4,2 @@',
  '+Pfad: /opt/geheimprojekt/daten',
  `+export KEY=${SCHLUESSEL}`,
  'diff --git a/alt.txt b/alt.txt',
  '--- a/alt.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-Geheimprojekt weg',
  'commit abcdef1234567890',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -10 +10 @@',
  `+const t = '${TOKEN}'`,
  '+const ok = 1',
].join('\n')

describe('Funde', () => {
  test('nur hinzugefügte Zeilen, mit Datei und Zeilennummer', async () => {
    const z = hinzugefuegt(DIFF)
    expect(z.map(x => `${x.datei}:${x.nr}`)).toEqual(['README.md:4', 'README.md:5', 'x.ts:10', 'x.ts:11'])
    expect(z[2]?.commit).toBe('abcdef1')
  })

  test('Muster und Geheimnisse; Geheimnisse gekürzt; ohne Muster nur Geheimnisse', async () => {
    const f = inhaltPruefen(hinzugefuegt(DIFF), 'geheimprojekt')
    expect(f).toEqual([
      { art: 'muster', wo: 'README.md:4 (1234567)', was: '„geheimprojekt“' },
      { art: 'geheimnis', wo: 'README.md:5 (1234567)', was: 'Anthropic-Schlüssel sk-ant…' },
      { art: 'geheimnis', wo: 'x.ts:10 (abcdef1)', was: 'GitHub-Token ghp_bb…' },
    ])
    expect(inhaltPruefen(hinzugefuegt(DIFF), '').map(x => x.art)).toEqual(['geheimnis', 'geheimnis'])
    // Ein kaputtes Muster legt die Prüfung nicht lahm.
    expect(inhaltPruefen(hinzugefuegt(DIFF), '(').length).toBe(2)
    expect(inhaltPruefen(hinzugefuegt('+++ b/a\n@@ +1 @@\n+const ok = 1'), 'geheimprojekt')).toEqual([])
  })

  test('Mails: Autor und Committer müssen passen', async () => {
    const log = 'aaaaaaa1\t1+x@users.noreply.github.com\t1+x@users.noreply.github.com\nbbbbbbb2\tich@beispiel.de\t1+x@users.noreply.github.com\n'
    expect(mailsPruefen(log, '@users\\.noreply\\.github\\.com$')).toEqual([{ art: 'mail', wo: 'Commit bbbbbbb', was: 'Autor ich@beispiel.de' }])
    expect(mailsPruefen(log, '')).toEqual([])
  })

  test('Frage endet mit Fragezeichen; Ablehnung nennt die Funde und was der Nutzer schreibt', async () => {
    const f = [{ art: 'mail' as const, wo: 'Commit bbbbbbb', was: 'Autor ich@beispiel.de' }]
    expect(frage('github.com/a/b', f)).toMatch(/1 Fund[\s\S]*Commit bbbbbbb: Autor ich@beispiel.de \(Mail\)[\s\S]*\?$/)
    expect(ablehnung('github.com/a/b', f, 'erst die Mail ändern')).toContain('Der Nutzer schreibt dazu: erst die Mail ändern')
  })
})

// ---------------------------------------------------------------- Ablauf

function git(on: On, url: string, diff: string, log: string) {
  const aufrufe: string[][] = []
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    aufrufe.push(argv)
    const stdout = argv.includes('get-url') ? `${url}\n` : argv.includes('-p') ? diff : argv.includes('log') ? log : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('ui.log', () => ({ value: undefined }) as never)
  // Was die Engine ohne die Wache entscheidet.
  on('tool.check', () => ({ decision: 'allow' }) as never)
  return aufrufe
}

/** Der Frage-Dialog (ui.ask läuft als AskUserQuestion): antwortet mit `antwort`, merkt sich die Fragen. */
function frageMock(on: On, antwort: string): string[] {
  const fragen: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
    fragen.push(q)
    return { result: { questions: [], answers: { [q]: antwort } } } as never
  })
  return fragen
}

const MAIL_FALSCH = 'bbbbbbb2\tich@beispiel.de\tich@beispiel.de\n'

for (const [antwort, erlaubt] of [['Trotzdem pushen', true], ['Abbrechen', false]] as const) {
  test(`Fund im öffentlichen Repo: Nutzer wählt „${antwort}“`, async ($, on) => {
    git(on, 'git@github.com:a/b.git', '', MAIL_FALSCH)
    const fragen = frageMock(on, antwort)
    const r = await $.tool.check({ tool: 'Bash', input: { command: 'git push origin main' }, tool_use_id: 't1' } as never)
    expect(fragen.length).toBe(1)
    expect(fragen[0]).toContain('Push nach github.com/a/b: 1 Fund')
    expect((r as { decision: string }).decision === 'deny').toBe(!erlaubt)
    if (!erlaubt) expect(String((r as { reason?: string }).reason)).toContain('Autor ich@beispiel.de')
  })
}

test('nicht öffentlich oder ohne Fund: keine Frage, keine Ablehnung', async ($, on) => {
  const aufrufe = git(on, '/opt/git/b.git', '', MAIL_FALSCH)
  const gefragt = frageMock(on, 'Abbrechen')
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'git push' }, tool_use_id: 't1' } as never)
  expect((r as { decision: string }).decision).not.toBe('deny')
  expect(aufrufe.length).toBe(1)

  const ohne = await $.tool.check({ tool: 'Bash', input: { command: 'ls -la' }, tool_use_id: 't2' } as never)
  expect((ohne as { decision: string }).decision).not.toBe('deny')
  expect(gefragt.length).toBe(0)
})

test('Muster aus den Optionen schlägt an', { options: { muster: 'geheimprojekt' } }, async ($, on) => {
  const aufrufe = git(on, 'https://github.com/a/b.git', DIFF, '')
  frageMock(on, 'Abbrechen')
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'git -C /projekt push' }, tool_use_id: 't1' } as never)
  expect(String((r as { reason?: string }).reason)).toContain('„geheimprojekt“ (Muster)')
  expect(aufrufe[0]).toEqual(['git', '-C', '/projekt', 'remote', 'get-url', 'origin'])
  expect(aufrufe.some(a => a.join(' ').endsWith('HEAD --not --remotes=origin'))).toBe(true)
})
