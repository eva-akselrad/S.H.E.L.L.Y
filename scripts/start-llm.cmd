@echo off
rem Starts the lock (proxy) and the Cloudflare tunnel for SHELLY's local LLM. Ollama itself starts with Windows.
rem Put a shortcut to this file in shell:startup to run it at login.
cd /d "%~dp0.."
start "SHELLY LLM proxy" /min node scripts\llm-proxy.mjs
start "SHELLY LLM tunnel" /min cloudflared tunnel --config "%USERPROFILE%\.cloudflared\shelly-llm.yml" run shelly-llm
