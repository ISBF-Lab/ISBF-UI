param([switch]$Check, [switch]$Configure)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$forward = $null
$commandExitCode = 1

Push-Location -LiteralPath $repoRoot
try {
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    $ssh = Get-Command ssh.exe -ErrorAction Stop
    $forward = Start-Process -FilePath $ssh.Source -ArgumentList @(
      "-N", "-L", "3000:localhost:3000", "-o", "ExitOnForwardFailure=yes",
      "-o", "BatchMode=yes", "8.155.132.213"
    ) -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      if ($forward.HasExited) { throw "SSH port forward failed to start." }
      if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { break }
      Start-Sleep -Milliseconds 250
    }
    if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
      throw "SSH port forward did not open localhost:3000."
    }
  }

  $wslArgs = @("-d", "Ubuntu", "--", "bash", "./scripts/watch-v3-preview.sh")
  if ($Check) {
    $wslArgs += "--check"
  } elseif ($Configure) {
    $wslArgs += "--configure"
  }
  & wsl.exe @wslArgs
  $commandExitCode = $LASTEXITCODE
} finally {
  if ($forward -and -not $forward.HasExited) {
    Stop-Process -Id $forward.Id
  }
  Pop-Location
}

exit $commandExitCode
