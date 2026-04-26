# PokerBros

Self-hosted Texas Hold'em for you and your friends. Run it on your machine, share a free tunnel link, and play from anywhere — no account, no subscription, no ads.

## Features

**Game**
- Texas Hold'em with proper betting rounds (pre-flop → flop → turn → river → showdown)
- Up to 9 players per table
- Side-pot calculation for all-in situations
- Cards shuffled with Fisher-Yates for uniform randomness
- Auto-advance through streets; host can end a hand early

**Betting & Structure**
- Configurable small blind / big blind / starting chips
- Antes (posted by every player each hand)
- UTG Straddle (posts 2× BB, acts last pre-flop)
- Bomb Pots (everyone posts a forced bet; hand starts at the flop)
- 7-2 Bounty (winner holding 7-2 collects a bonus from each player)

**Timing**
- Per-turn decision clock with configurable duration
- Time bank — extra seconds that auto-activate when the clock expires
- Time bank refills every N hands
- Auto-start next hand after a configurable delay

**Special Rules**
- Rabbit Hunting — shows the undealt board cards after an uncontested pot
- Reveal All-In — hole cards shown automatically when all remaining players are all-in
- Deal to Away — optionally include sitting-out players in hands

**Host Controls**
- Start / end hands, deal next hand
- Set blinds, starting chips live
- Add / set / rebuy chips per player
- Sit players out or back in
- Rename players, add private notes
- Kick players
- Schedule a Bomb Pot for the next hand
- Full settings modal covering all options above

**UI / Preferences** (per client, saved in localStorage)
- 2-color or 4-color deck (diamonds blue, clubs green)
- Chip display: dollar amount, BB multiples, or hidden
- Table felt color (green / blue / red / purple / black)
- Sound effects via Web Audio API — no audio files required
- Toggleable secondary sounds and chat beep

---

## Quick Start

The launcher script handles everything: it checks for Node.js, installs npm packages, downloads cloudflared if needed, starts the server, and opens a public tunnel — all in one step.

### Windows

Double-click **`start.bat`**, or run in PowerShell:

```powershell
.\start.ps1
```

The script will:
1. Install Node.js via **winget** if it isn't already installed
2. Run `npm install` if `node_modules` is missing
3. Download `cloudflared.exe` next to the script (one-time, ~35 MB) if cloudflared isn't in PATH
4. Start the server and print the public URL

> **First run only:** Windows may show a SmartScreen prompt for `start.bat` because it's a downloaded file.  
> Click **More info → Run anyway** — the script only runs PowerShell.

### macOS / Linux

```bash
./start.sh
```

The script checks for Node.js, runs `npm install` if needed, and starts a cloudflared tunnel. If cloudflared isn't installed:

```bash
# macOS
brew install cloudflared

# Debian / Ubuntu
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
```

If cloudflared is not found, the script falls back to [localtunnel](https://github.com/localtunnel/localtunnel) (included as a dev dependency).

### Manual / Development

```bash
npm install
npm start        # plain node
npm run dev      # nodemon — auto-restarts on file changes
```

---

## How to Play

1. Run the launcher. The public URL is printed in the terminal.
2. Open the URL (or `http://localhost:3000` locally), enter your name, click **Create Game** — you become the host.
3. Share the room link with friends via the **Copy Link** button.
4. Friends open the link, enter their names, and join.
5. Host clicks **Deal Cards** to start.

Press **Ctrl+C** in the terminal to stop the server and close the tunnel.

### Settings modal (host)

| Tab | What it controls |
|---|---|
| **Game Rules** | Blinds, antes, straddle, special rules, bomb pots, bounty, table management |
| **Timing** | Decision clock, time bank, auto-start between hands |
| **Preferences** | Deck style, chip display, table color, sounds *(saved per browser)* |
| **Players** | Live player list with chip management, notes, kick, rename |

---

## Project Structure

```
.
├── server.js               # Express + Socket.io server
├── start.sh                # Launcher — macOS / Linux / WSL
├── start.ps1               # Launcher — Windows (PowerShell)
├── start.bat               # Launcher — Windows (double-click wrapper)
├── src/
│   ├── Deck.js             # 52-card deck, Fisher-Yates shuffle
│   ├── HandEvaluator.js    # Best 5-of-7 evaluation
│   ├── PokerGame.js        # Game state machine, all rules
│   └── RoomManager.js      # Multi-room lifecycle management
└── public/
    ├── index.html          # Landing page (create / join)
    ├── game.html           # Game table + settings modal HTML
    ├── style.css           # Dark theme, felt table, card styles
    ├── game.js             # Table rendering, socket events
    ├── settings.js         # Settings modal logic, client prefs
    └── sounds.js           # Web Audio API sound effects
```

## License

[Apache 2.0](LICENSE)
