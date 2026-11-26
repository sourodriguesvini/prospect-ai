# Prospector: desenha o ícone do programa (chamado por `pnpm app:install`, scripts/app/instalar.mjs).
# Quadrado escuro com "P" branco e ponto laranja (tokens de packages/ui: tinta e acento), em vários
# tamanhos num só .ico, para a barra de tarefas, o Explorer e o Alt+Tab ficarem nítidos.
param([Parameter(Mandatory = $true)][string]$Arquivo)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Desenho([int]$tamanho) {
  $escala = $tamanho / 256.0
  $bitmap = New-Object System.Drawing.Bitmap $tamanho, $tamanho
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $canto = [Math]::Max(2.0, 64 * $escala)
  $lado = $tamanho - 0.5
  $forma = New-Object System.Drawing.Drawing2D.GraphicsPath
  $forma.AddArc(0, 0, $canto, $canto, 180, 90)
  $forma.AddArc($lado - $canto, 0, $canto, $canto, 270, 90)
  $forma.AddArc($lado - $canto, $lado - $canto, $canto, $canto, 0, 90)
  $forma.AddArc(0, $lado - $canto, $canto, $canto, 90, 90)
  $forma.CloseFigure()
  $tinta = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#141416'))
  $acento = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#c2410c'))
  $g.FillPath($tinta, $forma)
  $fonte = New-Object System.Drawing.Font('Segoe UI', [float](168 * $escala), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $formato = New-Object System.Drawing.StringFormat
  $formato.Alignment = [System.Drawing.StringAlignment]::Center
  $formato.LineAlignment = [System.Drawing.StringAlignment]::Center
  $area = New-Object System.Drawing.RectangleF([float](-8 * $escala), [float](6 * $escala), [float]$tamanho, [float]$tamanho)
  $g.DrawString('P', $fonte, [System.Drawing.Brushes]::White, $area, $formato)
  $ponto = [Math]::Max(3.0, 46 * $escala)
  $g.FillEllipse($acento, [float](176 * $escala), [float](176 * $escala), [float]$ponto, [float]$ponto)
  $g.Dispose()
  $memoria = New-Object System.IO.MemoryStream
  $bitmap.Save($memoria, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  return , $memoria.ToArray()
}

# Arquivo .ico com uma imagem PNG por tamanho (aceito pelo Windows desde o Vista).
$tamanhos = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$imagens = @($tamanhos | ForEach-Object { , (New-Desenho $_) })
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Arquivo) | Out-Null
$saida = [System.IO.File]::Create($Arquivo)
$escritor = New-Object System.IO.BinaryWriter($saida)
$escritor.Write([UInt16]0); $escritor.Write([UInt16]1); $escritor.Write([UInt16]$tamanhos.Count)
$posicao = 6 + 16 * $tamanhos.Count
for ($i = 0; $i -lt $tamanhos.Count; $i++) {
  $lado = if ($tamanhos[$i] -ge 256) { 0 } else { $tamanhos[$i] }
  $escritor.Write([Byte]$lado); $escritor.Write([Byte]$lado); $escritor.Write([Byte]0); $escritor.Write([Byte]0)
  $escritor.Write([UInt16]1); $escritor.Write([UInt16]32)
  $escritor.Write([UInt32]$imagens[$i].Length); $escritor.Write([UInt32]$posicao)
  $posicao += $imagens[$i].Length
}
foreach ($imagem in $imagens) { $escritor.Write($imagem) }
$escritor.Close()
