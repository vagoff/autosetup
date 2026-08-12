# Долгоживущий command agent: принимает один JSON request на строку COM1,
# исполняет cmd.exe с явным deadline и возвращает JSON response. Все
# произвольные байты команды/вывода передаются Base64, поэтому serial line
# остаётся ASCII и не страдает от codepage Windows.
$port = New-Object System.IO.Ports.SerialPort('{{COM_PORT}}', {{COM_BAUD_RATE}}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$port.Encoding = [System.Text.Encoding]::ASCII
$port.NewLine = "`n"
$utf8 = [System.Text.Encoding]::UTF8

function Limit-Bytes {
  param([Parameter(Mandatory)][byte[]]$Bytes, [Parameter(Mandatory)][int]$MaximumBytes)
  if ($Bytes.Length -le $MaximumBytes) { return $Bytes }
  return [byte[]]$Bytes[0..($MaximumBytes - 1)]
}

function Write-Response {
  param([Parameter(Mandatory)]$Response)
  $port.WriteLine(($Response | ConvertTo-Json -Compress -Depth 4))
}

$port.Open()
try {
  while ($true) {
    $line = $port.ReadLine()
    $requestId = $null
    try {
      $request = $line | ConvertFrom-Json -ErrorAction Stop
      $requestId = [string]$request.id
      if ([string]::IsNullOrWhiteSpace($requestId)) { throw 'request id is empty' }
      $commandText = $utf8.GetString([Convert]::FromBase64String([string]$request.commandBase64))

      $runId = [guid]::NewGuid().ToString('N')
      $stdoutPath = Join-Path $env:TEMP "wintest-serial-$runId.stdout"
      $stderrPath = Join-Path $env:TEMP "wintest-serial-$runId.stderr"
      $runner = "`$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$([string]$request.commandBase64)')); & `$env:ComSpec /d /s /c `$command; exit `$LASTEXITCODE"
      $runnerBase64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))
      try {
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
          '-NoProfile',
          '-EncodedCommand', $runnerBase64
        ) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -ErrorAction Stop
        $timedOut = -not $process.WaitForExit({{SERIAL_AGENT_COMMAND_TIMEOUT_MS}})
        if ($timedOut) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
          $process.WaitForExit()
        }
        [byte[]]$stdoutBytes = Limit-Bytes -Bytes ([IO.File]::ReadAllBytes($stdoutPath)) -MaximumBytes {{SERIAL_AGENT_MAX_RESPONSE_BYTES}}
        [byte[]]$stderrBytes = Limit-Bytes -Bytes ([IO.File]::ReadAllBytes($stderrPath)) -MaximumBytes {{SERIAL_AGENT_MAX_RESPONSE_BYTES}}
        Write-Response ([ordered]@{
          id = $requestId
          ok = (-not $timedOut)
          timedOut = $timedOut
          exitCode = if ($timedOut) { $null } else { $process.ExitCode }
          stdoutBase64 = [Convert]::ToBase64String($stdoutBytes)
          stderrBase64 = [Convert]::ToBase64String($stderrBytes)
        })
      } finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Response ([ordered]@{
        id = $requestId
        ok = $false
        error = $_.Exception.Message
        stdoutBase64 = ''
        stderrBase64 = ''
      })
    }
  }
} finally {
  $port.Close()
}
