@echo off
rem Starts the local voice (Kokoro), the lock (proxy) and the Cloudflare tunnel for SHELLY's local AI.
rem Ollama itself starts with Windows. Put a shortcut to this file in shell:startup to run it at login.
cd /d "%~dp0.."
start "SHELLY voice (Kokoro)" /min "%USERPROFILE%\.shelly-tts\venv\Scripts\python.exe" scripts\tts-server.py
start "SHELLY LLM proxy" /min node scripts\llm-proxy.mjs
start "SHELLY LLM tunnel" /min cloudflared tunnel --config "%USERPROFILE%\.cloudflared\shelly-llm.yml" run shelly-llm
