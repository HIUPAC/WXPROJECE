param(
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'miniprogram\images\ui')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Icons use one normalized 24 × 24 grid and transparent 72 × 72 output.
# This script is reproducible on Windows; it creates no external dependencies.
$ThemeFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'miniprogram\data\ui-theme.js'
$ThemeSource = [IO.File]::ReadAllText($ThemeFile)
function Get-ThemeColor {
  param([string]$Key)
  $ThemeMatch = [regex]::Match($ThemeSource, ($Key + ':\s*''(#[0-9a-fA-F]{6})'''))
  if (-not $ThemeMatch.Success) { throw ('Missing UI theme color: ' + $Key) }
  return $ThemeMatch.Groups[1].Value
}
$Colors = [ordered]@{
  green = (Get-ThemeColor 'primary')
  muted = (Get-ThemeColor 'muted')
  white = '#ffffff'
  ochre = (Get-ThemeColor 'accent')
}
$Names = @('leaf', 'book', 'bookmark', 'pen', 'compass', 'heart', 'check', 'search', 'arrow', 'back', 'close', 'user', 'trash', 'edit', 'download', 'home')

function Draw-Polyline {
  param($Graphics, $Pen, [double[]]$Coordinates)
  $Points = [System.Drawing.PointF[]]::new($Coordinates.Length / 2)
  for ($Index = 0; $Index -lt $Coordinates.Length; $Index += 2) {
    $Points[$Index / 2] = [System.Drawing.PointF]::new([float]$Coordinates[$Index], [float]$Coordinates[$Index + 1])
  }
  $Graphics.DrawLines($Pen, $Points)
}

function Draw-Icon {
  param([string]$Name, $Graphics, $Pen)
  switch ($Name) {
    'leaf' {
      $Path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $Path.AddBezier(20, 3, 20, 10, 19, 17, 12, 20)
        $Path.AddBezier(12, 20, 7, 22, 3, 18, 4, 13)
        $Path.AddBezier(4, 13, 5, 6, 13, 4, 20, 3)
        $Graphics.DrawPath($Pen, $Path)
        $Graphics.DrawLine($Pen, 4, 21, 16, 8)
        $Graphics.DrawLine($Pen, 9, 15, 9, 10)
        $Graphics.DrawLine($Pen, 12, 12, 17, 12)
      } finally { $Path.Dispose() }
    }
    'book' {
      $Path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $Path.AddBezier(12, 6, 9, 4, 6, 3, 3, 4)
        $Path.AddLine(3, 4, 3, 19)
        $Path.AddBezier(3, 19, 6, 18, 9, 19, 12, 21)
        $Path.AddBezier(12, 21, 15, 19, 18, 18, 21, 19)
        $Path.AddLine(21, 19, 21, 4)
        $Path.AddBezier(21, 4, 18, 3, 15, 4, 12, 6)
        $Path.CloseFigure()
        $Graphics.DrawPath($Pen, $Path)
        $Graphics.DrawLine($Pen, 12, 6, 12, 21)
        $Graphics.DrawLine($Pen, 6, 8, 9, 9)
        $Graphics.DrawLine($Pen, 15, 9, 18, 8)
      } finally { $Path.Dispose() }
    }
    'bookmark' {
      Draw-Polyline $Graphics $Pen @(6, 3, 18, 3, 18, 21, 12, 17, 6, 21, 6, 3)
    }
    'pen' {
      Draw-Polyline $Graphics $Pen @(4, 20, 5, 15, 17, 3, 21, 7, 9, 19, 4, 20)
      $Graphics.DrawLine($Pen, 14, 6, 18, 10)
      $Graphics.DrawLine($Pen, 5, 15, 9, 19)
    }
    'compass' {
      $Graphics.DrawEllipse($Pen, 3, 3, 18, 18)
      Draw-Polyline $Graphics $Pen @(16.5, 7.5, 14, 14, 7.5, 16.5, 10, 10, 16.5, 7.5)
      $Graphics.DrawLine($Pen, 10, 10, 14, 14)
    }
    'heart' {
      $Path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $Path.AddBezier(12, 21, 8, 18, 2.5, 13.5, 2.5, 8)
        $Path.AddBezier(2.5, 8, 2.5, 2.5, 8, 1.5, 12, 6)
        $Path.AddBezier(12, 6, 16, 1.5, 21.5, 2.5, 21.5, 8)
        $Path.AddBezier(21.5, 8, 21.5, 13.5, 16, 18, 12, 21)
        $Graphics.DrawPath($Pen, $Path)
      } finally { $Path.Dispose() }
    }
    'check' {
      Draw-Polyline $Graphics $Pen @(4, 12, 9.5, 17.5, 20, 6)
    }
    'search' {
      $Graphics.DrawEllipse($Pen, 3, 3, 12.5, 12.5)
      $Graphics.DrawLine($Pen, 14, 14, 21, 21)
    }
    'arrow' {
      $Graphics.DrawLine($Pen, 4, 12, 20, 12)
      Draw-Polyline $Graphics $Pen @(14, 6, 20, 12, 14, 18)
    }
    'back' {
      $Graphics.DrawLine($Pen, 20, 12, 4, 12)
      Draw-Polyline $Graphics $Pen @(10, 6, 4, 12, 10, 18)
    }
    'close' {
      $Graphics.DrawLine($Pen, 6, 6, 18, 18)
      $Graphics.DrawLine($Pen, 18, 6, 6, 18)
    }
    'user' {
      $Graphics.DrawEllipse($Pen, 8, 3, 8, 8)
      $Path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $Path.AddBezier(4, 21, 4, 16, 7, 14, 12, 14)
        $Path.AddBezier(12, 14, 17, 14, 20, 16, 20, 21)
        $Graphics.DrawPath($Pen, $Path)
      } finally { $Path.Dispose() }
    }
    'trash' {
      $Graphics.DrawLine($Pen, 4, 6, 20, 6)
      Draw-Polyline $Graphics $Pen @(9, 6, 9, 3, 15, 3, 15, 6)
      Draw-Polyline $Graphics $Pen @(6, 6, 7, 21, 17, 21, 18, 6)
      $Graphics.DrawLine($Pen, 10, 10, 10.5, 17)
      $Graphics.DrawLine($Pen, 14, 10, 13.5, 17)
    }
    'edit' {
      Draw-Polyline $Graphics $Pen @(11, 4, 4, 4, 4, 20, 20, 20, 20, 13)
      Draw-Polyline $Graphics $Pen @(9, 15, 10, 11, 18, 3, 21, 6, 13, 14, 9, 15)
      $Graphics.DrawLine($Pen, 16, 5, 19, 8)
    }
    'download' {
      $Graphics.DrawLine($Pen, 12, 3, 12, 15)
      Draw-Polyline $Graphics $Pen @(7, 10, 12, 15, 17, 10)
      Draw-Polyline $Graphics $Pen @(4, 15, 4, 21, 20, 21, 20, 15)
    }
    'home' {
      Draw-Polyline $Graphics $Pen @(3, 11, 12, 3, 21, 11)
      Draw-Polyline $Graphics $Pen @(5, 9.5, 5, 21, 9, 21, 9, 14, 15, 14, 15, 21, 19, 21, 19, 9.5)
    }
  }
}

[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
foreach ($Name in $Names) {
  foreach ($ColorName in $Colors.Keys) {
    $Bitmap = [System.Drawing.Bitmap]::new(72, 72, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
    $Pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($Colors[$ColorName]), [float]1.6)
    try {
      $Graphics.Clear([System.Drawing.Color]::Transparent)
      $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $Graphics.ScaleTransform(3, 3)
      $Pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $Pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      $Pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
      Draw-Icon $Name $Graphics $Pen
      $Destination = Join-Path $OutputDirectory ($Name + '-' + $ColorName + '.png')
      $Bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $Pen.Dispose()
      $Graphics.Dispose()
      $Bitmap.Dispose()
    }
  }
}
Write-Output ('Generated ' + ($Names.Length * $Colors.Count) + ' icons in ' + $OutputDirectory)
