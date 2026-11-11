# Prospector: cria o ícone e os atalhos do aplicativo instalado (chamado por `pnpm app:install`).
# Atalhos: Área de Trabalho (Prospector) e Menu Iniciar > Prospector (abrir, parar, desinstalar).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$raiz = $PSScriptRoot
$icone = Join-Path $raiz 'prospector.ico'

# Ícone: quadrado escuro com "P" branco e ponto laranja (tokens de packages/ui: tinta e acento).
$tamanho = 256
$bitmap = New-Object System.Drawing.Bitmap $tamanho, $tamanho
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)
$canto = 64
$forma = New-Object System.Drawing.Drawing2D.GraphicsPath
$forma.AddArc(0, 0, $canto, $canto, 180, 90)
$forma.AddArc($tamanho - $canto, 0, $canto, $canto, 270, 90)
$forma.AddArc($tamanho - $canto, $tamanho - $canto, $canto, $canto, 0, 90)
$forma.AddArc(0, $tamanho - $canto, $canto, $canto, 90, 90)
$forma.CloseFigure()
$tinta = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#141416'))
$acento = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c2410c'))
$g.FillPath($tinta, $forma)
$fonte = New-Object System.Drawing.Font('Segoe UI', 168, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$formato = New-Object System.Drawing.StringFormat
$formato.Alignment = [System.Drawing.StringAlignment]::Center
$formato.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('P', $fonte, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(-8, 6, $tamanho, $tamanho)), $formato)
$g.FillEllipse($acento, 176, 176, 46, 46)
$g.Dispose()

# Arquivo .ico com uma imagem PNG de 256 px (aceito pelo Windows desde o Vista).
$memoria = New-Object System.IO.MemoryStream
$bitmap.Save($memoria, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $memoria.ToArray()
$bitmap.Dispose()
$arquivo = [System.IO.File]::Create($icone)
$escritor = New-Object System.IO.BinaryWriter($arquivo)
$escritor.Write([UInt16]0); $escritor.Write([UInt16]1); $escritor.Write([UInt16]1)
$escritor.Write([Byte]0); $escritor.Write([Byte]0); $escritor.Write([Byte]0); $escritor.Write([Byte]0)
$escritor.Write([UInt16]1); $escritor.Write([UInt16]32)
$escritor.Write([UInt32]$png.Length); $escritor.Write([UInt32]22)
$escritor.Write($png)
$escritor.Close()

$shell = New-Object -ComObject WScript.Shell
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function New-Atalho([string]$caminho, [string]$script, [string]$descricao) {
  $atalho = $shell.CreateShortcut($caminho)
  $atalho.TargetPath = $powershell
  $atalho.Arguments = "-NoProfile -WindowStyle Hidden -File `"$(Join-Path $raiz $script)`""
  $atalho.WorkingDirectory = $raiz
  $atalho.IconLocation = "$icone,0"
  $atalho.Description = $descricao
  $atalho.WindowStyle = 7
  $atalho.Save()
}

$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Prospector'
New-Item -ItemType Directory -Force -Path $menu | Out-Null

New-Atalho (Join-Path $areaDeTrabalho 'Prospector.lnk') 'iniciar.ps1' 'Abrir o Prospector'
New-Atalho (Join-Path $menu 'Prospector.lnk') 'iniciar.ps1' 'Abrir o Prospector'
New-Atalho (Join-Path $menu 'Parar Prospector.lnk') 'parar.ps1' 'Encerrar o servidor do Prospector'
New-Atalho (Join-Path $menu 'Desinstalar Prospector.lnk') 'desinstalar.ps1' 'Remover o Prospector instalado'

Write-Output "Atalhos criados: $areaDeTrabalho\Prospector.lnk e $menu"
