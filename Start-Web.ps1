param([int]$Port=8765,[switch]$Lan)
$ErrorActionPreference='Stop'
$ProjectRoot=$PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
$PythonCommand=Get-Command python -ErrorAction Stop
$BindAddress=if($Lan){'0.0.0.0'}else{'127.0.0.1'}
Write-Host "LiangCe Web: http://localhost:$Port"
if($Lan){Write-Host 'Use this computer LAN IP and the same port on your phone.'}
& $PythonCommand.Source web_server.py --host $BindAddress --port $Port
