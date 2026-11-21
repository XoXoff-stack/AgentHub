param(
  [string]$Output = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'AgentHub.zip')
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Parent = Split-Path -Parent $Root
$Output = [System.IO.Path]::GetFullPath($Output)
$Temp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $Temp | Out-Null
$Stage = Join-Path $Temp 'AgentHub'
New-Item -ItemType Directory -Path $Stage | Out-Null

try {
  Get-ChildItem -Path $Root -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/](node_modules|dist|target|\.git)[\\/]' -and
    $_.Name -ne '.DS_Store' -and $_.Name -ne 'Thumbs.db' -and
    $_.Name -ne '.env' -and $_.Name -notmatch '^npm-debug\.log'
  } | ForEach-Object {
    $Relative = $_.FullName.Substring($Root.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $Destination = Join-Path $Stage $Relative
    $DestinationFolder = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $DestinationFolder | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $Destination
  }

  if (Test-Path $Output) { Remove-Item $Output -Force }
  Compress-Archive -Path $Stage -DestinationPath $Output -CompressionLevel Optimal
  Write-Host "Created $Output"
}
finally {
  Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
