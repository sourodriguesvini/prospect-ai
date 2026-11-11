# Prospector: remove o aplicativo instalado e os atalhos (atalho "Desinstalar Prospector").
# Não toca nos dados (ficam no Supabase) nem no código-fonte (C:\dev\prospector).
Add-Type -AssemblyName PresentationFramework

$raiz = $PSScriptRoot
$marca = Join-Path $raiz '.prospector-instalacao'
if (-not (Test-Path $marca)) {
  [System.Windows.MessageBox]::Show("Esta pasta não parece uma instalação do Prospector:`n$raiz", 'Prospector', 'OK', 'Warning') | Out-Null
  exit 1
}

$resposta = [System.Windows.MessageBox]::Show(
  "Remover o Prospector instalado em $raiz e os atalhos?`n`nOs dados continuam no banco (Supabase) e o código em C:\dev\prospector não é alterado. Para instalar de novo: pnpm app:install.",
  'Prospector', 'YesNo', 'Question')
if ($resposta -ne 'Yes') { exit 0 }

& (Join-Path $raiz 'parar.ps1') -Silencioso

$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Prospector'
Remove-Item (Join-Path $areaDeTrabalho 'Prospector.lnk') -ErrorAction SilentlyContinue
if (Test-Path $menu) { Remove-Item $menu -Recurse -Force -ErrorAction SilentlyContinue }

# A pasta é apagada depois que este script termina (ele está dentro dela).
Start-Process -FilePath cmd.exe -WindowStyle Hidden -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$raiz`""
