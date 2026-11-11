#requires -Version 5.1
<#
  sync-todo.ps1 — DN-08 (ronda DN, PROMPT-142) — "siempre al dia con el proyecto".
  Para SGC y csd-app: fetch, reporta divergencia de main/dev locales vs origin,
  hace fast-forward SOLO-FF de los que esten limpios (nunca toca un arbol sucio,
  nunca --hard), corre `graphify update .` en cada arbol principal (y en los
  worktrees de solo-grafo configurados abajo), e imprime una tabla final
  repo . rama . commit . grafo-al-commit . divergencia.

  Copia versionada en SGC/scripts/sync-todo.ps1 (regla DN-10: paso 0 de toda
  ronda). Esta copia en C:\developer\tools\ es la que corre Xaviel a mano o
  desde cualquier carpeta.

    powershell -File C:\developer\tools\sync-todo.ps1
    powershell -File C:\developer\tools\sync-todo.ps1 -SinGrafo   (salta graphify, solo fetch+ff+reporte)
#>
param(
  [switch]$SinGrafo
)

$ErrorActionPreference = 'Stop'

# Arbol principal de cada repo (donde vive main/dev por defecto) + worktrees
# que son SOLO para tener el grafo mas reciente (no participan del ff-only de
# main/dev, pero si se les corre `graphify update .`).
$Repos = @(
  @{ Nombre = 'SGC';     Path = 'C:\Users\xavie\Desktop\X Dev\dev\SGC' },
  @{ Nombre = 'csd-app'; Path = 'C:\Users\xavie\Desktop\X Dev\dev2\csd-app' }
)
$GrafoExtra = @(
  @{ Repo = 'SGC'; Path = 'C:\Users\xavie\Desktop\X Dev\dev\SGC-graph' }
)
$RamasAlDia = @('main', 'dev')

function Invoke-Git {
  param([string]$RepoPath, [string]$ArgStr)
  $gitArgs = @('-C', $RepoPath) + ($ArgStr -split ' ')
  $out = & git @gitArgs 2>&1
  return @{ Codigo = $LASTEXITCODE; Salida = ($out -join "`n") }
}

function Test-HashesIguales {
  # git rev-parse --short y "Built from commit" de graphify no siempre usan
  # el mismo largo de hash abreviado -- comparar por prefijo, no por igualdad.
  param([string]$A, [string]$B)
  if (-not $A -or -not $B) { return $false }
  $n = [Math]::Min($A.Length, $B.Length)
  if ($n -lt 4) { return $false }
  return $A.Substring(0, $n) -eq $B.Substring(0, $n)
}

function Get-DivergenciaTexto {
  param([string]$RepoPath, [string]$Rama)
  $r = Invoke-Git $RepoPath "rev-list --left-right --count $Rama...origin/$Rama"
  if ($r.Codigo -ne 0) { return 'sin origin/{0}' -f $Rama }
  $partes = $r.Salida.Trim() -split '\s+'
  $adelante = $partes[0]; $atras = $partes[1]
  if ($adelante -eq '0' -and $atras -eq '0') { return 'al dia' }
  return "+$adelante/-$atras (ahead/behind)"
}

$filasTabla = @()

foreach ($repo in $Repos) {
  $nombre = $repo.Nombre
  $path = $repo.Path
  if (-not (Test-Path $path)) {
    Write-Host "SKIP $nombre -- no existe $path" -ForegroundColor Yellow
    continue
  }
  Write-Host "`n=== $nombre ($path) ===" -ForegroundColor Cyan
  $fetch = Invoke-Git $path 'fetch --all --prune'
  if ($fetch.Codigo -ne 0) {
    Write-Host "  FETCH FALLO: $($fetch.Salida)" -ForegroundColor Red
    continue
  }
  Write-Host '  fetch --all --prune OK'

  # Worktrees de este repo (porcelain: pares "worktree <path>" / "branch refs/heads/<nombre>")
  $wtRaw = (Invoke-Git $path 'worktree list --porcelain').Salida -split "`n"
  $worktrees = @()
  $actual = $null
  foreach ($linea in $wtRaw) {
    if ($linea -match '^worktree (.+)$') {
      if ($actual) { $worktrees += $actual }
      $actual = @{ Path = $Matches[1]; Rama = $null }
    } elseif ($linea -match '^branch refs/heads/(.+)$' -and $actual) {
      $actual.Rama = $Matches[1]
    }
  }
  if ($actual) { $worktrees += $actual }

  foreach ($rama in $RamasAlDia) {
    $divergencia = Get-DivergenciaTexto $path $rama
    $wt = $worktrees | Where-Object { $_.Rama -eq $rama } | Select-Object -First 1

    if (-not $wt) {
      # La rama existe pero no esta checked-out en ningun worktree: fetch
      # directo al ref local es seguro (git rechaza si no es fast-forward).
      $ff = Invoke-Git $path "fetch origin ${rama}:${rama}"
      if ($ff.Codigo -eq 0) {
        Write-Host "  [$rama] no esta en ningun worktree -- actualizada directo (ff)." -ForegroundColor Green
      } else {
        Write-Host "  [$rama] no esta en ningun worktree y el ref local no existe o no es ff -- omitido. ($($ff.Salida -replace "`n", ' '))" -ForegroundColor DarkYellow
      }
      continue
    }

    $estado = Invoke-Git $wt.Path 'status --short'
    if ($estado.Salida.Trim().Length -gt 0) {
      Write-Host "  [$rama] worktree $($wt.Path) tiene cambios sin commitear -- SE DETIENE, no se toca (ver `git -C `"$($wt.Path)`" status`")." -ForegroundColor Yellow
      continue
    }

    $merge = Invoke-Git $wt.Path "merge --ff-only origin/$rama"
    if ($merge.Codigo -eq 0) {
      Write-Host "  [$rama] worktree $($wt.Path) -- ff-only OK." -ForegroundColor Green
    } else {
      Write-Host "  [$rama] worktree $($wt.Path) -- ff-only fallo (normal si ya estaba al dia o diverge): $($merge.Salida -replace "`n", ' ')" -ForegroundColor DarkYellow
    }
  }

  if (-not $SinGrafo) {
    if (Test-Path (Join-Path $path 'graphify-out\graph.json')) {
      Write-Host '  graphify update . ...'
      $g = Invoke-Git $path 'rev-parse --short HEAD' # solo para log, no es git graphify
      Push-Location $path
      try { & graphify update . 2>&1 | ForEach-Object { Write-Host "    $_" } }
      catch { Write-Host "    graphify no disponible en PATH -- omitido." -ForegroundColor DarkYellow }
      Pop-Location
    } else {
      Write-Host '  sin graphify-out/graph.json -- omitido.' -ForegroundColor DarkYellow
    }
  }

  # Fila de la tabla final: rama actual del arbol principal.
  $ramaActual = (Invoke-Git $path 'branch --show-current').Salida.Trim()
  $commit = (Invoke-Git $path 'rev-parse --short HEAD').Salida.Trim()
  $grafoReport = Join-Path $path 'graphify-out\GRAPH_REPORT.md'
  $grafoCommit = 'sin grafo'
  if (Test-Path $grafoReport) {
    $linea = Select-String -Path $grafoReport -Pattern 'Built from commit' | Select-Object -First 1
    if ($linea) { $grafoCommit = ($linea.Line -replace '.*`([a-f0-9]+)`.*', '$1') }
  }
  $divergenciaActual = Get-DivergenciaTexto $path $ramaActual
  $filasTabla += [PSCustomObject]@{
    Repo = $nombre; Rama = $ramaActual; Commit = $commit
    GrafoAlCommit = $grafoCommit; AlDiaConGrafo = (Test-HashesIguales $grafoCommit $commit)
    Divergencia = $divergenciaActual
  }
}

foreach ($extra in $GrafoExtra) {
  if (-not (Test-Path $extra.Path)) { continue }
  if ($SinGrafo) { continue }
  Write-Host "`n=== grafo extra: $($extra.Path) ===" -ForegroundColor Cyan
  Push-Location $extra.Path
  try { & graphify update . 2>&1 | ForEach-Object { Write-Host "  $_" } }
  catch { Write-Host "  graphify no disponible en PATH -- omitido." -ForegroundColor DarkYellow }
  Pop-Location
  $commit = (Invoke-Git $extra.Path 'rev-parse --short HEAD').Salida.Trim()
  $grafoReport = Join-Path $extra.Path 'graphify-out\GRAPH_REPORT.md'
  $grafoCommit = 'sin grafo'
  if (Test-Path $grafoReport) {
    $linea = Select-String -Path $grafoReport -Pattern 'Built from commit' | Select-Object -First 1
    if ($linea) { $grafoCommit = ($linea.Line -replace '.*`([a-f0-9]+)`.*', '$1') }
  }
  $filasTabla += [PSCustomObject]@{
    Repo = "$($extra.Repo) (grafo extra)"; Rama = '(detached/mirror)'; Commit = $commit
    GrafoAlCommit = $grafoCommit; AlDiaConGrafo = (Test-HashesIguales $grafoCommit $commit)
    Divergencia = 'n/a'
  }
}

Write-Host "`n=== Tabla final ===" -ForegroundColor Cyan
$filasTabla | Format-Table -AutoSize
