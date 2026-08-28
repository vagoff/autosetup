# Общая функция логирования для всех first-logon скриптов (DRY) — пишет
# строку в COM-порт хоста через System.IO.Ports.SerialPort. Единственный
# канал диагностики, не зависящий ни от сети гостя, ни от guest agent, ни
# от того, смотрит ли кто-то на экран через SPICE в этот момент.
#
# Порт открывается и закрывается на каждый вызов (не держим открытым
# между вызовами) — так безопаснее: не нужно думать про освобождение
# хендла, если скрипт упадёт где-то посередине.
#
# Не самостоятельный шаг — этот файл подставляется как префикс перед
# каждым реальным guest-скриптом в build-first-logon-commands.js.
function Write-ComLog {
  param([Parameter(Mandatory)][string]$Message)
  $port = New-Object System.IO.Ports.SerialPort('{{COM_PORT}}', {{COM_BAUD_RATE}}, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
  $port.Encoding = [System.Text.Encoding]::ASCII
  $port.Open()
  try {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $port.WriteLine("[$stamp] $Message")
  } finally {
    $port.Close()
  }
}
