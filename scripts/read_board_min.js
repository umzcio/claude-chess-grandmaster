// Minimal board reader, installed once on window so per-move Playwright
// snippets stay short. Run via browser_evaluate:
//
//   () => { window.__readBoard = <contents of this file>; return "installed"; }
//
// then call inside browser_run_code_unsafe with:  page.evaluate(() => window.__readBoard())
//
// Returns { boardFen, lastMove: {from,to}|null, gameOver }.
// boardFen is placement-only (rank 8->1). lastMove comes from the two
// highlighted squares (the one now empty is `from`). gameOver is true when the
// "you won/lost" modal is present. Track the running move history yourself and
// feed it to bestmove.py --moves; this reader is for detecting the opponent's
// reply and the end of the game, not for reconstructing castling/en-passant.
() => {
  const TYPE = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" };
  const board = document.querySelector("wc-chess-board, chess-board, .board");
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  board.querySelectorAll(".piece").forEach((el) => {
    let code = null, s = null;
    el.classList.forEach((c) => {
      if (/^[wb][pnbrqk]$/.test(c)) code = c;
      const m = /^square-(\d)(\d)$/.exec(c);
      if (m) s = { file: +m[1] - 1, rank: +m[2] - 1 };
    });
    if (code && s)
      grid[s.rank][s.file] =
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
  board.querySelectorAll(".highlight, .last-move-highlight").forEach((el) =>
    el.classList.forEach((c) => {
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
}
