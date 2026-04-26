#Requires -Version 5.0
<#
.SYNOPSIS
  PokerBros one-command launcher for Windows.
  Installs Node.js (via winget) and cloudflared if missing,
  then starts the server and opens a free public tunnel.
.EXAMPLE
  .\start.ps1
  Double-click start.bat for the same effect.
#>

$ErrorActionPreference = 'Stop'
$PORT      = if ($env:PORT) { $env:PORT } else { 3000 }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── Helpers ───────────────────────────────────────────────────────────────────
function Step([string]$msg)  { Write-Host "  $msg" -ForegroundColor Cyan }
function Ok([string]$msg)    { Write-Host "  $msg" -ForegroundColor Green }
function Warn([string]$msg)  { Write-Host "  $msg" -ForegroundColor Yellow }
function Err([string]$msg)   { Write-Host "  $msg" -ForegroundColor Red }

function Cleanup {
  Write-Host ""
  Warn "Shutting down..."
  if ($script:tunnelProc -and -not $script:tunnelProc.HasExited) {
    try { $script:tunnelProc.Kill() } catch {}
  }
  if ($script:serverProc -and -not $script:serverProc.HasExited) {
    try { $script:serverProc.Kill() } catch {}
  }
}

$script:serverProc = $null
$script:tunnelProc = $null

Write-Host ""
Ok "♠ ♥  PokerBros  ♦ ♣"
Write-Host "  -----------------------------------------"
Write-Host ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Step "Node.js not found — installing via winget..."
  Write-Host ""

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS `
      --accept-source-agreements --accept-package-agreements
    # Reload PATH so node is usable without reopening the shell
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") +
                ";" +
                [System.Environment]::GetEnvironmentVariable("Path","User")
  } else {
    Err "winget is not available on this machine."
    Err "Please install Node.js from https://nodejs.org/ (LTS) and re-run."
    Write-Host ""
    Read-Host "  Press Enter to exit" | Out-Null
    exit 1
  }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "Node.js install succeeded but 'node' is still not in PATH."
    Err "Open a new terminal and run start.ps1 again."
    Write-Host ""
    Read-Host "  Press Enter to exit" | Out-Null
    exit 1
  }
}

Step "Node.js $(node --version)"

# ── 2. npm dependencies ───────────────────────────────────────────────────────
if (-not (Test-Path "$ScriptDir\node_modules")) {
  Step "Installing npm dependencies..."
  Write-Host ""
  npm install
  Write-Host ""
}

# ── 3. Free port if occupied ──────────────────────────────────────────────────
$occupied = netstat -ano 2>$null |
  Select-String " :$PORT " |
  Where-Object { $_ -match 'LISTENING' }
if ($occupied) {
  $oPid = ($occupied.ToString().Trim() -split '\s+')[-1]
  Step "Freeing port $PORT (PID $oPid)..."
  taskkill /PID $oPid /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 600
}

# ── 4. Start game server ──────────────────────────────────────────────────────
Step "Starting server on port $PORT..."
$script:serverProc = Start-Process `
  -FilePath "node" -ArgumentList "server.js" `
  -WorkingDirectory $ScriptDir `
  -NoNewWindow -PassThru

Start-Sleep -Seconds 1
Write-Host "  Local:   http://localhost:$PORT" -ForegroundColor White
Write-Host ""

# ── 5. Find or download cloudflared ──────────────────────────────────────────
$cfExe = $null

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  $cfExe = "cloudflared"
} elseif (Test-Path "$ScriptDir\cloudflared.exe") {
  $cfExe = "$ScriptDir\cloudflared.exe"
} else {
  Step "cloudflared not found — downloading (one-time setup)..."
  # Pick the right binary for the CPU architecture
  $arch    = (Get-CimInstance Win32_OperatingSystem).OSArchitecture
  $cfFile  = if ($arch -like "*ARM*") {
    "cloudflared-windows-arm64.exe"
  } else {
    "cloudflared-windows-amd64.exe"
  }
  $cfUrl   = "https://github.com/cloudflare/cloudflared/releases/latest/download/$cfFile"
  $cfDest  = "$ScriptDir\cloudflared.exe"

  try {
    Invoke-WebRequest -Uri $cfUrl -OutFile $cfDest -UseBasicParsing
    $cfExe = $cfDest
    Ok "cloudflared downloaded to $cfDest"
    Write-Host ""
  } catch {
    Warn "Could not download cloudflared: $_"
    Warn "Falling back to localtunnel..."
    Write-Host ""
  }
}

# ── 6. Start tunnel ───────────────────────────────────────────────────────────
if ($cfExe) {
  Step "Starting cloudflared tunnel (free, no account needed)..."
  Write-Host "  -----------------------------------------"
  Ok "Your public URL will appear below:"
  Write-Host ""

  # cloudflared runs in the foreground; Ctrl-C stops it, finally kills server
  try {
    & $cfExe tunnel --url "http://localhost:$PORT"
  } finally {
    Cleanup
  }

} else {
  # Locate localtunnel (installed as dev dependency)
  $ltBin = $null
  if     (Test-Path "$ScriptDir\node_modules\.bin\lt.cmd") { $ltBin = "$ScriptDir\node_modules\.bin\lt.cmd" }
  elseif (Get-Command lt  -ErrorAction SilentlyContinue)   { $ltBin = "lt" }
  elseif (Get-Command npx -ErrorAction SilentlyContinue)   { $ltBin = "npx"; $ltArgs = @("--yes","localtunnel","--port",$PORT) }

  if ($ltBin) {
    Step "Starting localtunnel..."
    Write-Host "  -----------------------------------------"
    Warn "Friends may see a bypass page — they click 'Click to Continue'"
    Write-Host ""
    try {
      if ($ltArgs) { & $ltBin @ltArgs }
      else         { & $ltBin --port $PORT }
    } finally {
      Cleanup
    }

  } else {
    Warn "No tunnel tool available. Server is running locally only."
    Write-Host "  http://localhost:$PORT" -ForegroundColor White
    Write-Host ""
    Warn "To get a public URL, install cloudflared and re-run:"
    Write-Host "  winget install Cloudflare.cloudflared"
    Write-Host "  -- or --"
    Write-Host "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    Write-Host ""
    Write-Host "  Press Ctrl+C to stop the server."
    Write-Host ""
    try {
      $script:serverProc.WaitForExit()
    } finally {
      Cleanup
    }
  }
}
