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

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for the tunnel (free, no account needed)

Install cloudflared on macOS:
```bash
brew install cloudflared
```

### Run
```bash
npm install
./start.sh
```

`start.sh` starts the server on port 3000, then opens a cloudflared HTTPS tunnel. The public URL is printed in the terminal — share it with your friends.

If cloudflared isn't found, the script falls back to [localtunnel](https://github.com/localtunnel/localtunnel) (included as a dev dependency).

### Development
```bash
npm run dev   # nodemon — auto-restarts on file changes
```

## How to Play

1. Open the tunnel URL (or `http://localhost:3000` locally).
2. Enter your name and click **Create Game** — you become the host.
3. Share the room link (the **Copy Link** button copies it automatically).
4. Friends open the link, enter their names, and join.
5. The host clicks **Deal Cards** to start the first hand.

The host's **⚙ Settings** modal has three tabs:

| Tab | What it controls |
|---|---|
| **Game Rules** | Blinds, antes, straddle, special rules, bomb pots, bounty, table management |
| **Timing** | Decision clock, time bank, auto-start |
| **Preferences** | Deck style, chip display, table color, sounds *(per client)* |
| **Players** | Live player list with chip management and notes |

## Project Structure

```
.
├── server.js               # Express + Socket.io server
├── start.sh                # Start server + cloudflared tunnel
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
