/*
 * read_board.js — read the current chess.com position from the live DOM.
 *
 * Injected into the chess.com page via Playwright's browser_evaluate. Returns
 * a JSON-able object describing the position. It NEVER decides a move; it just
 * reports what is on the board so bestmove.py (Stockfish) can decide.
 *
 * chess.com renders each piece as <div class="piece wp square-52"> where:
 *   - the 2-char code (wp,bn,...) is colour+type
 *   - square-FR encodes file F (1-8 = a-h) and rank R (1-8)
 * This piece convention is stable and is the reliable backbone of the read.
 *
 * Returns:
 * {
 *   ok: true,
 *   boardFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",  // placement only
 *   fen: "<full best-effort FEN with side/castling/ep>",
 *   orientation: "white" | "black",   // whose pieces are at the bottom = us
 *   sideToMove: "w" | "b",
 *   plyCount: <int>,                  // half-moves played (drives side to move)
 *   lastMove: { from: "e2", to: "e4" } | null,
 *   gameOver: <bool>,                 // a result/“game over” modal is showing
 *   diagnostics: { ... }              // which selectors matched — for tuning
 * }
 *
 * If the board element can't be found it returns { ok:false, error, diagnostics }.
 *
 * This file is a single arrow-function expression so it can be passed verbatim
 * as the `function` argument to Playwright's browser_evaluate.
 */
() => {
  const TYPE = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" };

  const board =
    document.querySelector("wc-chess-board") ||
    document.querySelector("chess-board") ||
    document.querySelector(".board");
  if (!board) {
    return { ok: false, error: "board_not_found",
             diagnostics: { html: document.title } };
  }

  // --- orientation: chess.com adds .flipped when you play Black ---
  const flipped = board.classList.contains("flipped");
  const orientation = flipped ? "black" : "white";

  // --- pieces -> 8x8 grid ---
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const pieces = board.querySelectorAll(".piece");
  let pieceCount = 0;
  pieces.forEach((el) => {
    let code = null, sq = null;
    el.classList.forEach((c) => {
      if (/^[wb][pnbrqk]$/.test(c)) code = c;
      const m = /^square-(\d)(\d)$/.exec(c);
      if (m) sq = { file: +m[1] - 1, rank: +m[2] - 1 };
    });
    if (code && sq) {
      const isWhite = code[0] === "w";
      const letter = TYPE[code[1]];
      grid[sq.rank][sq.file] = isWhite ? letter.toUpperCase() : letter;
      pieceCount++;
    }
  });

  // FEN placement is written rank 8 -> 1, file a -> h.
  const ranks = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = grid[r][f];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  const boardFen = ranks.join("/");

  // --- ply count -> side to move. Counting move nodes is far more robust
  //     than parsing their SAN text (which uses figurine glyphs). ---
  const nodeSelectors = [
    "wc-vertical-move-list .node",
    ".move-list .node",
    ".main-line-row .node",
    "[data-ply]",
    ".node",
  ];
  let plyCount = 0, nodeSelectorUsed = null;
  for (const sel of nodeSelectors) {
    const n = document.querySelectorAll(sel).length;
    if (n > 0) { plyCount = n; nodeSelectorUsed = sel; break; }
  }
  const sideToMove = plyCount % 2 === 0 ? "w" : "b";
  const fullmove = Math.floor(plyCount / 2) + 1;

  // --- last move from highlighted squares (used for en-passant detection) ---
  const sqName = (file, rank) => "abcdefgh"[file] + (rank + 1);
  let lastMove = null;
  const hi = board.querySelectorAll(".highlight, .last-move-highlight");
  const hiSquares = [];
  hi.forEach((el) => {
    el.classList.forEach((c) => {
      const m = /^square-(\d)(\d)$/.exec(c);
      if (m) hiSquares.push({ file: +m[1] - 1, rank: +m[2] - 1 });
    });
  });
  if (hiSquares.length >= 2) {
    // Order from/to by which highlighted square is now empty vs occupied.
    const [a, b] = hiSquares;
    const aEmpty = !grid[a.rank][a.file];
    const from = aEmpty ? a : b;
    const to = aEmpty ? b : a;
    lastMove = { from: sqName(from.file, from.rank), to: sqName(to.file, to.rank) };
  }

  // --- best-effort castling rights: present if king + rook are on home squares ---
  let castle = "";
  if (grid[0][4] === "K") {
    if (grid[0][7] === "R") castle += "K";
    if (grid[0][0] === "R") castle += "Q";
  }
  if (grid[7][4] === "k") {
    if (grid[7][7] === "r") castle += "k";
    if (grid[7][0] === "r") castle += "q";
  }
  if (!castle) castle = "-";

  // --- en passant: only if last move was a pawn double-step ---
  let ep = "-";
  if (lastMove) {
    const ff = "abcdefgh".indexOf(lastMove.from[0]);
    const fr = +lastMove.from[1] - 1;
    const tr = +lastMove.to[1] - 1;
    const movedPawn = grid[tr] && (grid[tr][ff] === "P" || grid[tr][ff] === "p");
    if (movedPawn && Math.abs(tr - fr) === 2) {
      ep = sqName(ff, (tr + fr) / 2);
    }
  }

  const fen = `${boardFen} ${sideToMove} ${castle} ${ep} 0 ${fullmove}`;

  // --- game over modal ---
  const gameOver = !!document.querySelector(
    ".game-over-modal-content, .game-over-header-header, [class*='game-over']"
  );

  return {
    ok: true,
    boardFen,
    fen,
    orientation,
    sideToMove,
    plyCount,
    lastMove,
    gameOver,
    diagnostics: {
      pieceCount,
      nodeSelectorUsed,
      flipped,
      hiSquaresFound: hiSquares.length,
      boardTag: board.tagName.toLowerCase(),
    },
  };
}
