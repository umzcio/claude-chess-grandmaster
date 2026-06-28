// Playwright move executor for chess.com, run via browser_run_code_unsafe's
// `filename` option. Reads the move to play from `window.__chessMove`, which the
// caller sets first with a small browser_evaluate:
//   () => { window.__chessMove = { from: "e2", to: "e4", promo: null }; }
// promo is one of "q","r","b","n" for a promotion, else null. (The Playwright
// code sandbox has no `require`/`fs`, so the move is passed via the page.)
//
// Returns: { myMoveLanded, afterOpponent: { boardFen, lastMove, gameOver } }
//
// How it makes a move: chess.com routes all input through the <wc-chess-board>
// element and ignores synthetic JS events, so we use REAL Playwright mouse
// clicks (page.mouse.click) at the pixel center of each square — trusted input
// the board accepts. Square centers are derived from the board's bounding rect
// and orientation (.flipped when we play Black).
async (page) => {
  const { from: FROM, to: TO, promo: PROMO } =
    await page.evaluate(() => window.__chessMove);

  const geom = await page.evaluate(() => {
    const b = document.querySelector('wc-chess-board, chess-board, .board');
    const r = b.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width,
             flipped: b.classList.contains('flipped') };
  });
  const sq = geom.width / 8;
  const center = (n) => {
    const f = 'abcdefgh'.indexOf(n[0]), rk = (+n[1]) - 1;
    return {
      x: geom.flipped ? geom.left + (7 - f + 0.5) * sq : geom.left + (f + 0.5) * sq,
      y: geom.flipped ? geom.top + (rk + 0.5) * sq : geom.top + (7 - rk + 0.5) * sq,
    };
  };

  const from = center(FROM), to = center(TO);
  await page.mouse.click(from.x, from.y);
  await page.waitForTimeout(180);
  await page.mouse.click(to.x, to.y);
  await page.waitForTimeout(250);
  if (PROMO) {
    await page.locator(`.promotion-piece.w${PROMO}, .promotion-piece.b${PROMO}`)
      .first().click({ timeout: 2000 }).catch(() => {});
  }

  const readBoard = () => page.evaluate(() => {
    const TYPE = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" };
    const board = document.querySelector("wc-chess-board, chess-board, .board");
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    board.querySelectorAll(".piece").forEach(el => {
      let code = null, s = null;
      el.classList.forEach(c => {
        if (/^[wb][pnbrqk]$/.test(c)) code = c;
        const m = /^square-(\d)(\d)$/.exec(c);
        if (m) s = { file: +m[1] - 1, rank: +m[2] - 1 };
      });
      if (code && s) grid[s.rank][s.file] =
        code[0] === "w" ? TYPE[code[1]].toUpperCase() : TYPE[code[1]];
    });
    const ranks = [];
    for (let r = 7; r >= 0; r--) {
      let row = "", e = 0;
      for (let f = 0; f < 8; f++) {
        const p = grid[r][f];
        if (p) { if (e) { row += e; e = 0; } row += p; } else e++;
      }
      if (e) row += e; ranks.push(row);
    }
    const sqName = (f, r) => "abcdefgh"[f] + (r + 1);
    const hi = [];
    board.querySelectorAll(".highlight, .last-move-highlight").forEach(el =>
      el.classList.forEach(c => {
        const m = /^square-(\d)(\d)$/.exec(c);
        if (m) hi.push({ file: +m[1] - 1, rank: +m[2] - 1 });
      }));
    let lastMove = null;
    if (hi.length >= 2) {
      const [a, b] = hi;
      const aEmpty = !grid[a.rank][a.file];
      const fr = aEmpty ? a : b, t = aEmpty ? b : a;
      lastMove = { from: sqName(fr.file, fr.rank), to: sqName(t.file, t.rank) };
    }
    const gameOver = !!document.querySelector(
      ".game-over-modal-content, [class*='game-over']");
    return { boardFen: ranks.join("/"), lastMove, gameOver };
  });

  const mine = await readBoard();
  let reply = mine;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    reply = await readBoard();
    if (reply.gameOver) break;
    if (reply.lastMove && reply.lastMove.to !== TO) break; // opponent moved
  }
  return { myMoveLanded: mine.lastMove, afterOpponent: reply };
}
