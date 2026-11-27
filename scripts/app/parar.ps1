# Prospector: fecha o programa instalado (atalho "Parar Prospector" e `pnpm app:install`).
# 1. Fecha a janela do Prospector (o Prospector.exe desta instalação), que encerra o servidor que
#    ela subiu; se a janela não fechar em 15 segundos, encerra o Prospector.exe.
# 2. Se ainda sobrar o servidor (node.exe com o server.js desta instalação, conferido pelo PID salvo
#    e pela linha de comando), encerra-o.
# Nunca encerra processo de outro programa.
param([switch]$Silencioso, [string]$Raiz = $PSScriptRoot)

Add-Type -AssemblyName PresentationFramework

$programa = Join-Path $Raiz 'programa\Prospector.exe'
$servidor = Join-Path $Raiz 'app\apps\web\server.js'
$pidArquivo = Join-Path $Raiz 'servidor.pid'
$fechou = $false

# O node.exe é o servidor desta instalação só se o ÚNICO argumento for este server.js
# (`node outro.js ...\server.js` não passa).
function Test-ServidorDoProspector([string]$linha) {
  if (-not $linha) { return $false }
  $texto = $linha.Trim()
  if ($texto.StartsWith('"')) {
    $fim = $texto.IndexOf('"', 1)
    if ($fim -lt 0) { return $false }
    $resto = $texto.Substring($fim + 1).Trim()
  } else {
    $espaco = $texto.IndexOfAny([char[]]@(' ', "`t"))
    if ($espaco -lt 0) { return $false }
    $resto = $texto.Substring($espaco + 1).Trim()
  }
  return ($resto -ieq $servidor) -or ($resto -ieq ('"' + $servidor + '"'))
}

function Get-JanelasDoProspector {
  @(Get-CimInstance Win32_Process -Filter "Name = 'Prospector.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $programa) })
}

$janelas = Get-JanelasDoProspector
if ($janelas.Count -gt 0) {
  $fechou = $true
  $pediu = $false
  foreach ($item in $janelas) {
    $proc = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if ($proc -and $proc.MainWindowHandle -ne 0) { $pediu = $proc.CloseMainWindow() -or $pediu }
  }
  # Sem janela para fechar (ainda abrindo ou travada), não adianta esperar.
  $limite = if ($pediu) { (Get-Date).AddSeconds(15) } else { Get-Date }
  while ((Get-JanelasDoProspector).Count -gt 0 -and (Get-Date) -lt $limite) {
    Start-Sleep -Milliseconds 300
  }
  foreach ($item in Get-JanelasDoProspector) {
    Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

if (Test-Path $pidArquivo) {
  $id = (Get-Content $pidArquivo -Raw).Trim()
  if ($id -match '^\d+$') {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'node.exe' -and (Test-ServidorDoProspector $proc.CommandLine)) {
      # Sem /T: o Windows guarda o PID do pai mesmo depois que ele morre, e o /T poderia derrubar um
      # programa alheio com PID reaproveitado. O que o servidor abriu (o Chromium da captura) está
      # no job do Node e cai junto com ele.
      & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $id /F | Out-Null
      Wait-Process -Id ([int]$id) -Timeout 10 -ErrorAction SilentlyContinue
      $fechou = $true
    }
  }
  Remove-Item $pidArquivo -ErrorAction SilentlyContinue
}

if (-not $Silencioso) {
  $mensagem = if ($fechou) { 'Prospector encerrado.' } else { 'O Prospector não estava aberto.' }
  [System.Windows.MessageBox]::Show($mensagem, 'Prospector', 'OK', 'Information') | Out-Null
}
