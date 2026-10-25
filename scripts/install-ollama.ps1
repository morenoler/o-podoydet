param([string]$Version = 'v0.40.10')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^v\d+\.\d+\.\d+$') { throw 'Invalid version.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = Join-Path $taskRoot '.local/tools'
$taskArchive = Join-Path $taskTools 'ollama-windows-amd64.zip'
$taskSums = Join-Path $taskTools 'ollama-sha256sum.txt'
$taskDestination = Join-Path $taskTools 'ollama'
New-Item -ItemType Directory -Force -Path $taskDestination | Out-Null
$taskRelease = "https://github.com/ollama/ollama/releases/download/$Version"
Invoke-WebRequest "$taskRelease/sha256sum.txt" -OutFile $taskSums
$taskLine = Get-Content $taskSums | Where-Object { $_ -match '\s+\*?(\./)?ollama-windows-amd64\.zip$' } | Select-Object -First 1
if (-not $taskLine) { throw 'Official checksum is missing.' }
$taskExpected = ($taskLine -split '\s+')[0].ToLowerInvariant()
if ($taskExpected -notmatch '^[a-f0-9]{64}$') { throw 'Invalid checksum.' }
if (-not (Test-Path -LiteralPath $taskArchive) -or (Get-FileHash $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) {
  curl.exe --fail --location --silent --show-error --output $taskArchive "$taskRelease/ollama-windows-amd64.zip"
  if ($LASTEXITCODE -ne 0) { throw 'Ollama download failed.' }
}
if ((Get-FileHash $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) {
  throw 'Ollama archive checksum does not match the official release.'
}
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskDestination -Force
Write-Output "Verified Ollama $Version installed in $taskDestination"
