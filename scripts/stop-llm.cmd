@echo off
rem Shuts down SHELLY's local AI: the voice (Kokoro), the lock (proxy), the Cloudflare tunnel,
rem and unloads the model from the GPU. Only SHELLY's own processes are touched; your other
rem tunnels and anything else using Ollama or Node keep running. Start again with start-llm.cmd.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$names = @{ 'python.exe'='tts-server.py'; 'node.exe'='llm-proxy.mjs'; 'cloudflared.exe'='shelly-llm.yml' };" ^
  "foreach ($n in $names.Keys) { Get-CimInstance Win32_Process -Filter \"Name='$n'\" | Where-Object { $_.CommandLine -like \"*$($names[$n])*\" } | ForEach-Object { Write-Host ('Stopping ' + $n + ' (' + $_.ProcessId + ')'); Stop-Process -Id $_.ProcessId -Force } }"
ollama stop shelly-qwen3 >nul 2>&1
echo SHELLY's local AI is stopped. SHELLY falls back to its built-in text and the Cloudflare voice.
