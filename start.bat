@echo off
:: PokerBros launcher — double-click this on Windows
:: Passes through to start.ps1 with execution-policy bypass
title PokerBros
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1"
