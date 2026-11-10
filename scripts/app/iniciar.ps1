# Prospector: abre o aplicativo instalado (atalho "Prospector").
# Sobe o servidor local, que só atende 127.0.0.1 (ADR-0007), se ainda não estiver no ar; abre o
# Ollama se ele estiver fechado; e abre o app numa janela própria do Chrome (ou do Edge).
# Copiado para a pasta de instalação por `pnpm app:install` (scripts/app/instalar.mjs).
param([int]$Porta = 3210)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework

$raiz = $PSScriptRoot
$web = Join-Path $raiz 'app\apps\web'
$servidor = Join-Path $web 'server.js'
$logs = Join-Path $raiz 'logs'
$pidArquivo = Join-Path $raiz 'servidor.pid'
$url = "http://127.0.0.1:$Porta/"

function Show-Aviso([string]$texto) {
  [System.Windows.MessageBox]::Show($texto, 'Prospector', 'OK', 'Warning') | Out-Null
}

# O processo do servidor só conta se for o node deste app (nunca mexe em outro programa).
function Get-ServidorDoProspector {
  if (-not (Test-Path $pidArquivo)) { return $null }
  $id = (Get-Content $pidArquivo -Raw).Trim()
  if ($id -notmatch '^\d+$') { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
  if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -and $proc.CommandLine.Contains($servidor)) {
    return $proc
  }
  return $null
}

function Get-DonoDaPorta([int]$numero) {
  $conexao = Get-NetTCPConnection -LocalPort $numero -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($conexao) { return $conexao.OwningProcess }
  return $null
}

function Test-Responde {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    # Qualquer resposta HTTP (mesmo erro de página) quer dizer que o servidor está no ar.
    return [bool]$_.Exception.Response
  }
}

function Start-OllamaSeFechado {
  if (Get-DonoDaPorta 11434) { return }
  $candidatos = @(
    'D:\ollama\app\ollama app.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe')
  )
  $ollama = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($ollama) { Start-Process -FilePath $ollama -WindowStyle Hidden }
}

if (-not (Test-Path $servidor)) {
  Show-Aviso "Instalação incompleta: falta $servidor.`nRode 'pnpm app:install' em C:\dev\prospector."
  exit 1
}

Start-OllamaSeFechado

if (-not (Get-ServidorDoProspector)) {
  $dono = Get-DonoDaPorta $Porta
  if ($dono) {
    Show-Aviso "A porta $Porta está ocupada por outro programa (processo $dono).`nFeche esse programa e abra o Prospector de novo."
    exit 1
  }
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Show-Aviso 'Node.js não encontrado. Instale o Node 24 (https://nodejs.org) e abra o Prospector de novo.'
    exit 1
  }
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $env:PORT = "$Porta"
  $env:HOSTNAME = '127.0.0.1'
  $env:NODE_ENV = 'production'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  $processo = Start-Process -FilePath $node -ArgumentList "`"$servidor`"" -WorkingDirectory $web `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'servidor.log') `
    -RedirectStandardError (Join-Path $logs 'servidor-erros.log')
  Set-Content -Path $pidArquivo -Value $processo.Id -Encoding Ascii

  $limite = (Get-Date).AddSeconds(60)
  while (-not (Test-Responde)) {
    if ($processo.HasExited) {
      Remove-Item $pidArquivo -ErrorAction SilentlyContinue
      Show-Aviso "O servidor do Prospector parou ao iniciar.`nDetalhes em $logs\servidor-erros.log."
      exit 1
    }
    if ((Get-Date) -gt $limite) {
      Show-Aviso "O servidor do Prospector não respondeu em 60 segundos.`nDetalhes em $logs."
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
}

$navegadores = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { Test-Path $_ }

if ($navegadores) {
  Start-Process -FilePath ($navegadores | Select-Object -First 1) -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
