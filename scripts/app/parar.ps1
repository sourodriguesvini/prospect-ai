# Prospector: encerra o servidor local do aplicativo instalado (atalho "Parar Prospector").
# Só encerra o node deste app, conferido pelo PID salvo e pelo caminho do server.js.
param([switch]$Silencioso)

Add-Type -AssemblyName PresentationFramework

$raiz = $PSScriptRoot
$servidor = Join-Path $raiz 'app\apps\web\server.js'
$pidArquivo = Join-Path $raiz 'servidor.pid'
$mensagem = 'O Prospector não estava aberto.'

if (Test-Path $pidArquivo) {
  $id = (Get-Content $pidArquivo -Raw).Trim()
  if ($id -match '^\d+$') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -and $proc.CommandLine.Contains($servidor)) {
      Stop-Process -Id ([int]$id) -Force
      Wait-Process -Id ([int]$id) -Timeout 10 -ErrorAction SilentlyContinue
      $mensagem = 'Prospector encerrado. A janela do app pode ser fechada.'
    }
  }
  Remove-Item $pidArquivo -ErrorAction SilentlyContinue
}

if (-not $Silencioso) {
  [System.Windows.MessageBox]::Show($mensagem, 'Prospector', 'OK', 'Information') | Out-Null
}
