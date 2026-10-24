$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskExecutable = Join-Path $taskRoot '.local/tools/ollama/ollama.exe'
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
& $taskExecutable pull qwen2.5:1.5b
if ($LASTEXITCODE -ne 0) { throw 'Could not download the local model.' }
& $taskExecutable create opodoydet-local -f (Join-Path $PSScriptRoot 'Modelfile.local')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the project model.' }
Write-Output 'Local CPU model opodoydet-local is ready.'
