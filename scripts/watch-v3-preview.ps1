param([switch]$Check, [switch]$Configure)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location -LiteralPath $repoRoot
try {
  $wslArgs = @("-d", "Ubuntu", "--", "bash", "./scripts/watch-v3-preview.sh")
  if ($Check) {
    $wslArgs += "--check"
  } elseif ($Configure) {
    $wslArgs += "--configure"
  }
  & wsl.exe @wslArgs
  $commandExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

exit $commandExitCode
