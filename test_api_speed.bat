@echo off
REM Mobipium API 速度测试 (Windows)
REM 使用方法: 双击运行或 cmd /c test_api_speed.bat

set TOKEN=18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9
set API_URL=https://affiliates.mobipium.com/api/cpa/findmyoffers

echo ==========================================
echo Mobipium API Speed Test (Windows)
echo ==========================================
echo Start: %date% %time%
echo.

echo [Test 1] Single Request Latency (5 times)
for %%i in (1 2 3 4 5) do (
    powershell -Command "$sw = [Diagnostics.Stopwatch]::StartNew(); Invoke-WebRequest -Uri '%API_URL%?mwsd=%TOKEN%&limit=1&pages=1' -UseBasicParsing | Out-Null; $sw.Stop(); Write-Host ('Run ' + %%i + ': ' + $sw.Elapsed.TotalSeconds + 's')"
)
echo.

echo [Test 2] Sequential 10 requests
powershell -Command "$sw = [Diagnostics.Stopwatch]::StartNew(); for($i=1; $i -le 10; $i++) { Invoke-WebRequest -Uri '%API_URL%?mwsd=%TOKEN%&limit=100&pages=' + $i -UseBasicParsing | Out-Null }; $sw.Stop(); Write-Host ('Total: ' + $sw.Elapsed.TotalSeconds + 's')"
echo.

echo [Test 3] Concurrent 10 requests (parallel)
powershell -Command "$sw = [Diagnostics.Stopwatch]::StartNew(); $jobs = 1..10 | ForEach-Object { Start-Job -ScriptBlock { param($url,$token) Invoke-WebRequest -Uri ($url + '?mwsd=' + $token + '&limit=100&pages=' + $args[0]) -UseBasicParsing | Out-Null } -ArgumentList $_, $env:API_URL, $env:TOKEN }; $jobs | Wait-Job | Receive-Job; $sw.Stop(); Write-Host ('Total: ' + $sw.Elapsed.TotalSeconds + 's')"
echo.

echo ==========================================
echo End: %date% %time%
echo ==========================================
pause
