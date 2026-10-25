$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskExecutable = Join-Path $taskRoot '.local/tools/ollama/ollama.exe'
if (-not (Test-Path -LiteralPath $taskExecutable)) {
  throw 'Ollama portable is missing. See docs/LOCAL_AI_LAB.md for installation.'
}
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $taskRoot '.local/ollama-models'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_CONTEXT_LENGTH = '8192'
$env:OLLAMA_KEEP_ALIVE = '10m'
& $taskExecutable serve
exit $LASTEXITCODE
