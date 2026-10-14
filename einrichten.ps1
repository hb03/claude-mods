# Richtet die eigenen Claude-Code-Plugins (Marketplace eigene-plugins = hb03/claude-mods) auf einem
# Windows-Rechner ein und haelt sie aktuell. Aufruf in PowerShell (5.1 oder 7):
#
#   irm https://raw.githubusercontent.com/hb03/claude-mods/main/einrichten.ps1 | iex
#
# Macht, soweit noch nicht da:
#   - git, jq (winget) und Claude Code (offizieller Installer) installieren,
#   - Marketplace hinzufuegen bzw. aktualisieren, in ~/.claude/settings.json mit "autoUpdate": true,
#   - alle Plugins des Marketplace installieren bzw. aktualisieren (mit false deaktivierte bleiben aus),
#   - SessionStart-Hook plugins-abgleich.sh (installiert spaeter neu hinzukommende Plugins),
#   - Statuszeile statusline.sh, wenn noch keine gesetzt ist,
#   - push-wache: erlaubte Commit-Mails (noreply, claude@hb03.de, git user.email), wenn noch nicht gesetzt.
# Mehrfach ausfuehren schadet nicht. Vor einer Aenderung an settings.json wird eine Sicherung angelegt.
# Die Datei bleibt ASCII, damit "irm | iex" auch unter Windows PowerShell 5.1 nichts verdreht.

& {
  $ErrorActionPreference = 'Stop'
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $OutputEncoding = [Text.UTF8Encoding]::new($false)

  $mp = 'eigene-plugins'
  $repo = 'hb03/claude-mods'
  $claudeDir = Join-Path $HOME '.claude'
  $settings = Join-Path $claudeDir 'settings.json'
  $clone = Join-Path $claudeDir "plugins\marketplaces\$mp"
  $utf8 = [Text.UTF8Encoding]::new($false)

  function Schritt($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
  function Info($text) { Write-Host "   $text" }
  function PfadNeu {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
      [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $HOME '.local\bin')
  }
  function Hat($befehl) { [bool](Get-Command $befehl -ErrorAction SilentlyContinue) }
  function Nativ {
    # Fuehrt ein Programm aus und bricht bei Exitcode <> 0 ab.
    $prog, $rest = $args
    $out = & $prog @rest 2>&1
    if ($LASTEXITCODE -ne 0) { throw "$prog $($rest -join ' ') fehlgeschlagen ($LASTEXITCODE):`n$($out -join "`n")" }
    $out
  }

  try {
    Schritt 'Voraussetzungen'
    PfadNeu
    foreach ($p in @(@{ Name = 'git'; Id = 'Git.Git' }, @{ Name = 'jq'; Id = 'jqlang.jq' })) {
      if (Hat $p.Name) { Info "$($p.Name): vorhanden"; continue }
      if (-not (Hat 'winget')) { throw "$($p.Name) fehlt und winget ist nicht da. Bitte $($p.Name) von Hand installieren." }
      Info "$($p.Name): wird installiert (winget $($p.Id)) ..."
      winget install --id $p.Id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
      PfadNeu
      if (-not (Hat $p.Name)) { throw "$($p.Name) ist nach der Installation nicht im PATH. Neues PowerShell-Fenster oeffnen und erneut starten." }
    }
    if (Hat 'claude') {
      Info 'Claude Code: vorhanden'
    } else {
      Info 'Claude Code: wird installiert (offizieller Installer) ...'
      Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
      PfadNeu
      if (-not (Hat 'claude')) { throw 'claude ist nach der Installation nicht im PATH. Neues PowerShell-Fenster oeffnen und erneut starten.' }
    }

    Schritt "Marketplace $mp ($repo)"
    $mps = (Nativ claude plugin marketplace list --json) -join "`n" | ConvertFrom-Json
    if (@($mps | Where-Object { $_.name -eq $mp }).Count -gt 0) {
      Nativ claude plugin marketplace update $mp | Out-Null
      Info 'vorhanden, aktualisiert'
    } else {
      Nativ claude plugin marketplace add $repo | Out-Null
      Info 'hinzugefuegt'
    }

    Schritt 'settings.json'
    if (-not (Test-Path $settings)) {
      New-Item -ItemType Directory -Force $claudeDir | Out-Null
      [IO.File]::WriteAllText($settings, "{}`n", $utf8)
    }
    $bash = (Join-Path (Split-Path (Split-Path (Get-Command git).Source)) 'bin\bash.exe') -replace '\\', '/'
    $base = ($clone -replace '\\', '/')
    $mails = @('@users\.noreply\.github\.com$', '^claude@hb03\.de$')
    $gitMail = (git config --global user.email) 2>$null
    if ($gitMail -and $gitMail -ne 'claude@hb03.de') { $mails += '^' + [regex]::Escape($gitMail) + '$' }

    # Filter als Datei und Werte ueber Umgebungsvariablen: Windows PowerShell 5.1 reicht
    # Anfuehrungszeichen in Argumenten an native Programme falsch weiter.
    $filter = Join-Path ([IO.Path]::GetTempPath()) 'claude-mods-einrichten.jq'
    [IO.File]::WriteAllText($filter, @'
$ENV.CM_MP as $mp | $ENV.CM_PW as $pw
| .extraKnownMarketplaces[$mp] = {source: {source: "github", repo: $ENV.CM_REPO}, autoUpdate: true}
| if ([.hooks.SessionStart[]?.hooks[]?.command // empty] | map(contains("plugins-abgleich.sh")) | any) then .
  else .hooks.SessionStart = ((.hooks.SessionStart // []) + [{hooks: [{type: "command", command: $ENV.CM_HOOK, timeout: 120}]}]) end
| if .statusLine == null then .statusLine = {type: "command", command: $ENV.CM_STATUS, refreshInterval: 30} else . end
| if (.pluginConfigs[$pw].options.mails // "") == "" then .pluginConfigs[$pw].options.mails = $ENV.CM_MAILS else . end
'@, $utf8)
    $env:CM_MP = $mp
    $env:CM_PW = "push-wache@$mp"
    $env:CM_REPO = $repo
    $env:CM_HOOK = "`"$bash`" $base/plugins-abgleich.sh"
    $env:CM_STATUS = "`"$bash`" $base/statusline.sh"
    $env:CM_MAILS = $mails -join '|'
    $alt = (Nativ jq . $settings) -join "`n"
    $neu = (Nativ jq -f $filter $settings) -join "`n"
    Remove-Item $filter -ErrorAction SilentlyContinue
    'CM_MP', 'CM_PW', 'CM_REPO', 'CM_HOOK', 'CM_STATUS', 'CM_MAILS' | ForEach-Object { Remove-Item "env:$_" }
    if ($neu -eq $alt) {
      Info 'schon vollstaendig'
    } else {
      $sicherung = "$settings.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
      Copy-Item $settings $sicherung
      [IO.File]::WriteAllText($settings, "$neu`n", $utf8)
      Info "ergaenzt (Sicherung: $sicherung)"
    }

    Schritt 'Plugins'
    $liste = Get-Content (Join-Path $clone '.claude-plugin\marketplace.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    # ForEach-Object rollt das Array aus: PowerShell 5.1 gibt es sonst als ein einziges Objekt weiter.
    $installiert = @((Nativ claude plugin list --json) -join "`n" | ConvertFrom-Json | ForEach-Object { $_ })
    $enabled = (Get-Content $settings -Raw -Encoding UTF8 | ConvertFrom-Json).enabledPlugins
    foreach ($p in $liste.plugins) {
      $id = "$($p.name)@$mp"
      $ist = $installiert | Where-Object { $_.id -eq $id } | Select-Object -First 1
      $an = if ($enabled) { $enabled.PSObject.Properties[$id] } else { $null }
      if ($an -and $an.Value -eq $false) {
        Info ("{0,-20} deaktiviert, ausgelassen" -f $p.name)
      } elseif (-not $ist) {
        Nativ claude plugin install $id -s user -y | Out-Null
        Info ("{0,-20} installiert ({1})" -f $p.name, $p.version)
      } elseif ($ist.version -ne $p.version) {
        Nativ claude plugin update $id -s user -y | Out-Null
        Info ("{0,-20} aktualisiert {1} -> {2}" -f $p.name, $ist.version, $p.version)
      } else {
        Info ("{0,-20} aktuell ({1})" -f $p.name, $p.version)
      }
    }

    Write-Host "`nFertig. Claude Code neu starten (oder /reload-plugins), damit alles laedt." -ForegroundColor Green
    Write-Host 'Updates kommen ab jetzt von selbst, neue Plugins installiert der Hook beim Sitzungsstart.'
  } catch {
    Write-Host "`nAbgebrochen: $($_.Exception.Message)" -ForegroundColor Red
  }
}
