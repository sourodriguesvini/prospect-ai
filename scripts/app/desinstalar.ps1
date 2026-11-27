# Prospector: remove o aplicativo instalado, os atalhos e o registro em "Aplicativos instalados"
# (atalho "Desinstalar Prospector" e Configurações > Aplicativos).
# Não toca nos dados (no Supabase e, as capturas de marca, em <instalação>-dados) nem no
# código-fonte (C:\dev\prospector).
Add-Type -AssemblyName PresentationFramework

$raiz = $PSScriptRoot
$marca = Join-Path $raiz '.prospector-instalacao'
if (-not (Test-Path $marca)) {
  [System.Windows.MessageBox]::Show("Esta pasta não parece uma instalação do Prospector:`n$raiz", 'Prospector', 'OK', 'Warning') | Out-Null
  exit 1
}

$dados = "$($raiz.TrimEnd('\'))-dados"
$resposta = [System.Windows.MessageBox]::Show(
  "Remover o Prospector instalado em $raiz e os atalhos?`n`nOs dados continuam no banco (Supabase), as capturas de marca continuam em $dados e o código em C:\dev\prospector não é alterado. Para instalar de novo: pnpm app:install.",
  'Prospector', 'YesNo', 'Question')
if ($resposta -ne 'Yes') { exit 0 }

& (Join-Path $raiz 'parar.ps1') -Silencioso

$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Prospector'
Remove-Item -LiteralPath (Join-Path $areaDeTrabalho 'Prospector.lnk') -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $menu) { Remove-Item -LiteralPath $menu -Recurse -Force -ErrorAction SilentlyContinue }

# Só apaga o registro em "Aplicativos instalados" se ele apontar para esta pasta.
$chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Prospector'
$registro = Get-ItemProperty -Path $chave -ErrorAction SilentlyContinue
if ($registro -and $registro.InstallLocation -ieq $raiz) {
  Remove-Item -Path $chave -Recurse -Force -ErrorAction SilentlyContinue
}

# A pasta é apagada depois que este script termina (ele está dentro dela). O cmd roda fora dela:
# com a pasta de trabalho dentro de $raiz, o rmdir não conseguiria apagar a própria raiz.
Start-Process -FilePath cmd.exe -WindowStyle Hidden -WorkingDirectory $env:TEMP -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$raiz`""
