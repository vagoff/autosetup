# Долгоживущий command agent: принимает один JSON request на строку COM1,
# исполняет cmd.exe с явным deadline и возвращает JSON response. Все
# произвольные байты команды/вывода передаются Base64, поэтому serial line
# остаётся ASCII и не страдает от codepage Windows.
$agentLogPath = Join-Path $env:ProgramData '{{SERIAL_AGENT_INSTALLATION_DIRECTORY_NAME}}\{{SERIAL_AGENT_LOG_FILENAME}}'

function Write-AgentLog {
  param([Parameter(Mandatory)][string]$Message)
  Add-Content -LiteralPath $agentLogPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" -Encoding ascii
}

$utf8 = [System.Text.Encoding]::UTF8

function Write-Response {
  param([Parameter(Mandatory)]$Response)
  $port.WriteLine(($Response | ConvertTo-Json -Compress -Depth 4))
}

$port = $null
try {
  $port = New-Object System.IO.Ports.SerialPort('{{COM_PORT}}', {{COM_BAUD_RATE}}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
  $port.Encoding = [System.Text.Encoding]::ASCII
  $port.NewLine = "`n"
  $port.Open()
  Write-AgentLog 'started'
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
      $commandPath = Join-Path $env:TEMP "wintest-serial-$runId.command.cmd"
      $wrapperPath = Join-Path $env:TEMP "wintest-serial-$runId.wrapper.cmd"
      $exitCodePath = Join-Path $env:TEMP "wintest-serial-$runId.exit-code"
      try {
        [IO.File]::WriteAllText($commandPath, "@echo off`r`n$commandText`r`n", [Text.Encoding]::ASCII)
        [IO.File]::WriteAllText($wrapperPath, "@echo off`r`ncmd /d /c $commandPath`r`necho %ERRORLEVEL% > $exitCodePath`r`nexit /b 0`r`n", [Text.Encoding]::ASCII)
        $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c $wrapperPath" -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -ErrorAction Stop
        $timedOut = -not $process.WaitForExit({{SERIAL_AGENT_COMMAND_TIMEOUT_MS}})
        if ($timedOut) {
          Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
          $process.WaitForExit()
        }
        $exitCode = $null
        if (-not $timedOut) {
          if (-not (Test-Path -LiteralPath $exitCodePath -PathType Leaf)) {
            throw 'command wrapper did not write exit code'
          }
          $exitCode = [int](Get-Content -LiteralPath $exitCodePath -Raw -ErrorAction Stop).Trim()
        }
        [byte[]]$stdoutBytes = [IO.File]::ReadAllBytes($stdoutPath)
        [byte[]]$stderrBytes = [IO.File]::ReadAllBytes($stderrPath)
        if ($stdoutBytes.Length -gt {{SERIAL_AGENT_MAX_RESPONSE_BYTES}}) {
          [byte[]]$stdoutBytes = $stdoutBytes[0..({{SERIAL_AGENT_MAX_RESPONSE_BYTES}} - 1)]
        }
        if ($stderrBytes.Length -gt {{SERIAL_AGENT_MAX_RESPONSE_BYTES}}) {
          [byte[]]$stderrBytes = $stderrBytes[0..({{SERIAL_AGENT_MAX_RESPONSE_BYTES}} - 1)]
        }
        Write-Response ([ordered]@{
          id = $requestId
          ok = (-not $timedOut)
          timedOut = $timedOut
          exitCode = $exitCode
          stdoutBase64 = [Convert]::ToBase64String($stdoutBytes)
          stderrBase64 = [Convert]::ToBase64String($stderrBytes)
        })
      } finally {
        Remove-Item -LiteralPath $stdoutPath, $stderrPath, $commandPath, $wrapperPath, $exitCodePath -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-AgentLog "request failed: $($_.Exception.Message)"
      Write-Response ([ordered]@{
        id = $requestId
        ok = $false
        error = $_.Exception.Message
        stdoutBase64 = ''
        stderrBase64 = ''
      })
    }
  }
} catch {
  Write-AgentLog "fatal: $($_.Exception.Message)"
  exit 1
} finally {
  if ($port) { $port.Close() }
}
