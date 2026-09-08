# Долгоживущий command agent: принимает один JSON request на строку COM2
# (СВОЙ отдельный физический порт, не COM1 — тот целиком отдан
# Write-ComLog; см. serialAgent.comPort в data/base.json5), исполняет
# cmd.exe с явным deadline и возвращает JSON response. Все произвольные
# байты команды/вывода передаются Base64, поэтому serial line остаётся
# ASCII и не страдает от codepage Windows. Держит SerialPort открытым
# бессрочно, пока процесс жив, — это единственный владелец COM2.
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
  $port = New-Object System.IO.Ports.SerialPort('{{SERIAL_AGENT_COM_PORT}}', {{SERIAL_AGENT_COM_BAUD_RATE}}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
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
      $detach = $request.detach -eq $true

      $runId = [guid]::NewGuid().ToString('N')
      $stdoutPath = Join-Path $env:TEMP "wintest-serial-$runId.stdout"
      $stderrPath = Join-Path $env:TEMP "wintest-serial-$runId.stderr"
      $commandPath = Join-Path $env:TEMP "wintest-serial-$runId.command.cmd"
      $wrapperPath = Join-Path $env:TEMP "wintest-serial-$runId.wrapper.cmd"
      $exitCodePath = Join-Path $env:TEMP "wintest-serial-$runId.exit-code"
      try {
        if ($detach) {
          # shutdown.exe waits until the shutdown itself finishes. The normal
          # request path would hit commandTimeoutMs and kill that process,
          # cancelling the very shutdown we asked for. A detached command is
          # deliberately allowed only as an explicit protocol flag: reply
          # after cmd.exe has been created, then let it finish independently.
          [IO.File]::WriteAllText($commandPath, "@echo off`r`n$commandText`r`ndel `"%~f0`"`r`n", [Text.Encoding]::ASCII)
          Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', $commandPath) -WindowStyle Hidden -ErrorAction Stop
          $commandPath = $null # the detached cmd.exe owns and deletes it
          Write-Response ([ordered]@{
            id = $requestId
            ok = $true
            detached = $true
            stdoutBase64 = ''
            stderrBase64 = ''
          })
          continue
        }
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
        Remove-Item -LiteralPath @($stdoutPath, $stderrPath, $commandPath, $wrapperPath, $exitCodePath | Where-Object { $null -ne $_ }) -Force -ErrorAction SilentlyContinue
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
