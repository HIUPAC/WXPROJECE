param([string]$DevtoolsPath = 'D:\微信web开发者工具')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$miniPath = Join-Path $projectPath 'miniprogram'
$compilerPath = Join-Path $DevtoolsPath 'resources\app.asar.unpacked\node_modules\wcc-exec'
$wxmlCompiler = Join-Path $compilerPath 'wcc.exe'
$wxssCompiler = Join-Path $compilerPath 'wcsc.exe'
if (-not (Test-Path -LiteralPath $wxmlCompiler) -or -not (Test-Path -LiteralPath $wxssCompiler)) { throw '未找到微信原生编译器，请通过 -DevtoolsPath 指定微信开发者工具安装目录。' }
$outputPath = Join-Path $projectPath '.codex\validation'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
Push-Location -LiteralPath $miniPath
try {
  $wxmlFiles = @(Get-ChildItem -Recurse -Filter '*.wxml' | ForEach-Object { [IO.Path]::GetRelativePath($miniPath, $_.FullName).Replace('\', '/') })
  $wxssFiles = @(Get-ChildItem -Recurse -Filter '*.wxss' | ForEach-Object { [IO.Path]::GetRelativePath($miniPath, $_.FullName).Replace('\', '/') })
  & $wxmlCompiler '-o' (Join-Path $outputPath 'wxml-compiled.js') @wxmlFiles
  if ($LASTEXITCODE -ne 0) { throw 'WXML 编译失败。' }
  & $wxssCompiler '-pc' $wxssFiles.Count '-o' (Join-Path $outputPath 'wxss-compiled.js') @wxssFiles
  if ($LASTEXITCODE -ne 0) { throw 'WXSS 编译失败。' }
  Write-Output "Native compilation passed: $($wxmlFiles.Count) WXML, $($wxssFiles.Count) WXSS files."
} finally { Pop-Location }
