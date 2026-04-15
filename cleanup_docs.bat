@echo off
REM Delete docs directory files
del /F "docs\demo.md" 2>nul
del /F "docs\PASSWORD_CONFIG.md" 2>nul
del /F "docs\LOCKED_IPS_API_REFERENCE.md" 2>nul
del /F "docs\LOCKED_IPS_ADMIN_FEATURE.md" 2>nul
del /F "docs\LOCKED_IPS_FINAL_SUMMARY.md" 2>nul

REM Delete root directory files
del /F "CHANGES_SUMMARY.md" 2>nul
del /F "IMPLEMENTATION_SUMMARY.md" 2>nul
del /F "LOCKED_IPS_FINAL_SUMMARY.md" 2>nul
del /F "README_LOCKED_IPS.md" 2>nul
del /F "VERIFICATION_CHECKLIST.md" 2>nul

echo Cleanup completed
