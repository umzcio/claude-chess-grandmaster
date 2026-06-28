---
name: chess-grandmaster
description: >-
  Play a game of chess on chess.com at grandmaster strength by driving the
  browser with Playwright and choosing every move with the Stockfish engine.
  Use this whenever the user wants to play, watch, or beat a chess.com bot
  (Martin, Nelson, Jimmy, Noam, etc.), asks you to "play chess", "play a chess
  game", "beat a bot on chess.com", or wants help winning a chess match online
  — even if they don't name Stockfish or this skill explicitly. Do NOT use it
  for analyzing a single position in the abstract, explaining chess rules, or
  for playing rated games against human opponents.
---

# Chess Grandmaster

Play and win a chess game on chess.com against a bot, at full engine strength.

## The one idea that makes this work

You are the **hands and eyes**, not the brain. Language models are bad at chess
— they lose track of the board and miss one-move tactics, which is why Claude
can lose to even the weakest bots when it plays "from its head." So in this
skill **you never decide a chess move yourself.** Every move comes from
Stockfish, a real engine that is far stronger than any chess.com bot. Your job
is to read the position off the page, ask Stockfish, and play what it says.

If you ever feel tempted to "just play the obvious move" without calling the
engine — don't. That temptation is exactly the failure mode this skill exists
to prevent.

Bundled files do the work:
- `scripts/bestmove.py` — the brain. Give it the moves so far, it returns
  Stockfish's best move. Deterministic; never guesses.
- `scripts/play_move.js` — executes a move on the board with real Playwright
  mouse clicks and returns the opponent's reply. The piece that does the
  clicking; run it via `browser_run_code_unsafe`.
- `scripts/read_board_min.js` — compact board reader installed on `window` for
  fast per-move reads (opponent reply + game-over detection).
- `scripts/read_board.js` — fuller DOM reader; use it for the first read to get
  orientation and the starting FEN.
- `scripts/selftest.py` — regression test for the brain (no browser needed).

## Prerequisites (check once, install if missing)

The engine and library must be present. Check, and install only what's missing:

```bash
command -v stockfish || brew install stockfish
python3 -c "import chess" 2>/dev/null || python3 -m pip install --user chess
```

Then confirm the brain is healthy before playing:

```bash
python3 ~/.claude/skills/chess-grandmaster/scripts/selftest.py
```

If the self-test fails, stop and fix that first — a broken brain means a lost
game. Don't proceed to the browser.

## Setting up the game

1. **Ask which bot** if the user hasn't said (Martin is the easiest; the user's
   story is they once *lost* to Martin, so beating it cleanly is the point).
2. **Open the browser** with Playwright and navigate to
   `https://www.chess.com/play/computer`.
3. **Login is optional.** chess.com lets you play bots as a **Guest** — no
   sign-in required — so you can start immediately. Offer the user the choice:
   play as Guest now, or log in first (so the game saves to their account). If
   they want to log in, pause and let them do it in the browser, then continue;
   don't type their credentials.
4. **Select the named bot and start.** The bots are grouped by category
   (Martin is under *Beginner*). Snapshot refs in this picker go stale fast, so
   click by text with `browser_evaluate` rather than a captured ref — find the
   element whose text matches the category/bot and `.click()` it. Then start the
   game. If the user already started it, skip this.
5. **Note our color.** Read the board (below) — `orientation` tells you whether
   we are White (we move first) or Black (wait for the bot's first move). When
   playing Black the board carries `.flipped` and the click math inverts
   automatically.

## The move loop

Repeat until the game ends:

### 1. Read the position

Run `read_board.js` in the page (pass its contents as the `function` argument to
`browser_evaluate`) for the first read — to confirm `orientation` (our color)
and the starting `fen`.

```
browser_evaluate(function = <contents of scripts/read_board.js>)
```

**Turn detection — track the move history yourself.** On the Play-Computer page
the move-list selectors did NOT match in testing, so `plyCount`/`sideToMove`
read as 0/white and are unreliable there. Don't depend on them. Instead keep
your own running list of UCI moves and detect the opponent's reply by the
board's `lastMove` highlight (the `play_move.js` loop already waits for
`lastMove.to` to change to something other than your own move). This proved
fully reliable across a whole game. If `gameOver` is true, stop and report.

### 2. Get Stockfish's move

Prefer feeding the **move history** when you have it, because replaying it gives
Stockfish a provably-correct position (castling rights, en passant, the lot).
You build the history by recording each move as it's played (see step 4) — keep
a running list of UCI moves for the game.

```bash
python3 ~/.claude/skills/chess-grandmaster/scripts/bestmove.py --moves "e2e4 e7e5 g1f3 ..."
```

For the very first read, or if you ever lose the running history, fall back to
the FEN that `read_board.js` reconstructed from the pieces:

```bash
python3 ~/.claude/skills/chess-grandmaster/scripts/bestmove.py --fen "<fen from read_board.js>"
```

`bestmove.py` returns JSON with `uci`, `san`, `from`, `to`, `promotion`,
`is_castle`, `is_capture`, `eval`, `mate_in`, and `opponent_in_checkmate`.

### 3. Narrate (the user is watching)

Before playing, say what you're doing in one line so the user can follow the
logic, e.g. *"Move 12: playing **Nxe5** — wins a pawn, Stockfish eval +1.8."*
If `mate_in` is set, say so (*"forced mate in 3"*). Keep it to one line per move.

### 4. Play the move on the board

**Do NOT try to click piece/hint elements with `browser_click`.** It looks like
it should work, but it doesn't: chess.com routes all input through the single
`<wc-chess-board>` element, which sits on top of the pieces and intercepts the
click, and it ignores synthetic JS-dispatched events (they're untrusted). Both
were tried live and both failed.

What works is a **real mouse click at the pixel center of each square**, issued
through Playwright's actual mouse via `browser_run_code_unsafe` (which hands you
the `page` object). chess.com accepts these because they're trusted input, and
it figures out the square from the cursor coordinates.

One-time setup at the start of the game, install a board reader on `window` so
later calls stay short (run via `browser_evaluate`):

```js
() => { window.__readBoard = () => { /* contents of scripts/read_board_min.js */ }; }
```

Then each move, run this with `browser_run_code_unsafe` (set `m` to the engine's
move; `promo` is `"q"`/`"r"`/`"b"`/`"n"` for a promotion, else `null`):

```js
async (page) => {
  const m = { from: "e2", to: "e4", promo: null };
  const g = await page.evaluate(() => {
    const b = document.querySelector('wc-chess-board, chess-board, .board');
    const r = b.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, fl: b.classList.contains('flipped') };
  });
  const s = g.w / 8;
  const C = (n) => { const f = 'abcdefgh'.indexOf(n[0]), k = +n[1] - 1;
    return { x: g.fl ? g.l + (7 - f + .5) * s : g.l + (f + .5) * s,
             y: g.fl ? g.t + (k + .5) * s : g.t + (7 - k + .5) * s }; };
  const a = C(m.from), b = C(m.to);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(180);
  await page.mouse.click(b.x, b.y); await page.waitForTimeout(250);
  if (m.promo) await page.locator(`.promotion-piece.w${m.promo}, .promotion-piece.b${m.promo}`)
    .first().click({ timeout: 2000 }).catch(() => {});
  const mine = await page.evaluate(() => window.__readBoard());
  let rep = mine;                                  // wait for opponent's reply
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    rep = await page.evaluate(() => window.__readBoard());
    if (rep.gameOver || (rep.lastMove && rep.lastMove.to !== m.to)) break;
  }
  return { landed: mine.lastMove, after: rep };
}
```

`scripts/play_move.js` is this same routine packaged for `browser_run_code_unsafe`'s
`filename` option — it reads the move from `window.__chessMove` (set it first with
a tiny `browser_evaluate`, since the Playwright sandbox has no filesystem access).
Either approach works; hardcoding `m` inline is simplest. Both return `landed`
(confirms your move) and `after` (the board + the opponent's reply via
`lastMove`), so one call plays your move AND captures the response.

The coordinate math is orientation-aware: when we play Black the board has the
`.flipped` class and the mapping inverts. It handles every move type — captures,
**castling** (just the king's two-square move, e.g. `e1g1`), and **en passant**
(move the pawn diagonally to the empty target square) — because it's the same
two clicks regardless. All of these were confirmed working in a live game.

**Promotion:** set `promo` to the engine's `promotion` field; the snippet clicks
the picker piece after the move. Almost always a queen.

After playing, append the engine's `uci` to your running move history, and read
the opponent's reply from `after.lastMove` (append that too).

### 5. Verify, capture the reply, and loop

The play snippet already does both: `landed` confirms your piece reached `to`,
and `after` carries the opponent's reply via `lastMove`. Check that `landed.to`
equals your intended square — if it doesn't, the click missed; **retry the move
once**. If it still won't land, take a `browser_snapshot`, tell the user what you
see, and ask rather than flailing (stop after 2–3 tries).

Append your move and the opponent's reply to your running history, then go back
to step 2 for the next move. When `after.gameOver` is true, stop and report.

## First move is a quick sanity check

The move-execution method (real mouse clicks at square centers) and the
piece/square classes (`.piece`, `square-FR`) were proven across a full live game
— captures, castling, en passant, promotion, and checkmate detection all worked.
You shouldn't need to recalibrate. As a light check, after the **first** move
confirm `landed.to` matches what you intended; if it's off, the board geometry
read is wrong (rare) — re-read the board rect and verify orientation
(`.flipped`). Once the first move round-trips, the rest is mechanical.

The one selector that did NOT work on the Play-Computer page is the move list
(`plyCount` stays 0) — which is why you track history yourself (step 1). If a
future chess.com update breaks the piece classes too, dump the live DOM with
`browser_evaluate` (`document.querySelector('wc-chess-board').outerHTML.slice(0,2000)`)
and adjust.

## When the game ends

Report the result plainly: win/loss/draw, final move, and the bot's name —
e.g. *"Checkmate. Beat Martin in 23 moves. ♟️"* If the user wants another game,
loop back to setup.

## Troubleshooting

- **`stockfish_not_found` / `python_chess_not_installed`** — run the install
  commands in Prerequisites.
- **`illegal_or_unparseable_move`** from `bestmove.py` — your running move
  history desynced from the real game. Stop using `--moves`; read the board and
  use `--fen` instead, then rebuild history from there.
- **Board scrape and your history disagree** — trust the board read (`--fen`).
  The pieces on screen are ground truth; your bookkeeping is not.
- **Move won't register after a retry** — don't loop forever. Snapshot, explain,
  and ask the user. (See the rabbit-hole guidance: stop after 2–3 failed tries.)
- **Bot plays instantly and it's suddenly our turn again** — fine; just read and
  move. Always re-read right before computing so you never play on a stale board.

## Fair play

This skill is for **bots only** — they're unrated and engine help against them
breaks no rules. Do not use it for rated games against human opponents;
chess.com's fair-play system bans engine assistance, and that's not a line to
cross. If the user asks to beat a human, decline and explain why.
```
