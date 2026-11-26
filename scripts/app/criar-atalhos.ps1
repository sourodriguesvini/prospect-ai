# Prospector: cria os atalhos e o registro em "Aplicativos instalados" (chamado por `pnpm app:install`).
# - Área de Trabalho e Menu Iniciar > Prospector: "Prospector" abre programa\Prospector.exe. Esses
#   atalhos são gravados pelo próprio Prospector.exe (--criar-atalho), com o identificador do
#   programa, para a barra de tarefas juntar a janela aberta com o ícone fixado.
# - Menu Iniciar > Prospector: "Parar Prospector" e "Desinstalar Prospector" (scripts desta pasta).
# - Configurações > Aplicativos > Aplicativos instalados: "Prospector", que desinstala por
#   desinstalar.ps1 (registro do usuário, HKCU; não precisa de administrador).
param([string]$Versao = '0.0.0')

$ErrorActionPreference = 'Stop'

$raiz = $PSScriptRoot
$programa = Join-Path $raiz 'programa\Prospector.exe'
if (-not (Test-Path $programa)) { throw "Falta $programa." }

$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Prospector'
New-Item -ItemType Directory -Force -Path $menu | Out-Null

$atalhoDaArea = Join-Path $areaDeTrabalho 'Prospector.lnk'
$atalhoDoMenu = Join-Path $menu 'Prospector.lnk'
$argumentos = "--criar-atalho `"$atalhoDaArea`" --criar-atalho `"$atalhoDoMenu`""
$processo = Start-Process -FilePath $programa -ArgumentList $argumentos -Wait -PassThru
if ($processo.ExitCode -ne 0 -or -not (Test-Path $atalhoDaArea) -or -not (Test-Path $atalhoDoMenu)) {
  throw "O Prospector.exe não criou os atalhos (código $($processo.ExitCode))."
}

$shell = New-Object -ComObject WScript.Shell
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function New-AtalhoDeScript([string]$caminho, [string]$script, [string]$descricao) {
  $atalho = $shell.CreateShortcut($caminho)
  $atalho.TargetPath = $powershell
  $atalho.Arguments = "-NoProfile -WindowStyle Hidden -File `"$(Join-Path $raiz $script)`""
  $atalho.WorkingDirectory = $raiz
  $atalho.IconLocation = "$programa,0"
  $atalho.Description = $descricao
  $atalho.WindowStyle = 7
  $atalho.Save()
}

New-AtalhoDeScript (Join-Path $menu 'Parar Prospector.lnk') 'parar.ps1' 'Fechar o Prospector e o servidor dele'
New-AtalhoDeScript (Join-Path $menu 'Desinstalar Prospector.lnk') 'desinstalar.ps1' 'Remover o Prospector instalado'

# Tamanho em KB, mostrado em "Aplicativos instalados" (sem o cache do download do Electron).
$bytes = (Get-ChildItem -Path $raiz -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike (Join-Path $raiz 'cache\*') } |
  Measure-Object -Property Length -Sum).Sum
$chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Prospector'
New-Item -Path $chave -Force | Out-Null
$valores = @{
  DisplayName     = 'Prospector'
  DisplayIcon     = "$programa,0"
  DisplayVersion  = $Versao
  Publisher       = 'Prospector (uso local)'
  InstallLocation = $raiz
  InstallDate     = (Get-Date -Format 'yyyyMMdd')
  UninstallString = "`"$powershell`" -NoProfile -WindowStyle Hidden -File `"$(Join-Path $raiz 'desinstalar.ps1')`""
  Comments        = 'Instalado por pnpm app:install a partir de C:\dev\prospector.'
}
foreach ($nome in $valores.Keys) {
  New-ItemProperty -Path $chave -Name $nome -Value $valores[$nome] -PropertyType String -Force | Out-Null
}
foreach ($nome in 'NoModify', 'NoRepair') {
  New-ItemProperty -Path $chave -Name $nome -Value 1 -PropertyType DWord -Force | Out-Null
}
New-ItemProperty -Path $chave -Name 'EstimatedSize' -Value ([int]([math]::Ceiling($bytes / 1KB))) -PropertyType DWord -Force | Out-Null

Write-Output "Atalhos criados: $atalhoDaArea e $menu; Prospector registrado em Aplicativos instalados."
