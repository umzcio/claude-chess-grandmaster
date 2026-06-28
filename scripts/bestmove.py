#!/usr/bin/env python3
"""Compute the best chess move with Stockfish.

This is the *brain* of the chess-grandmaster skill. The language model never
chooses a chess move itself -- it calls this script, which delegates to a real
engine. That single design choice is the whole reason the skill plays well:
LLMs hallucinate board state and miss one-move tactics, while Stockfish does
not.

The position can be supplied two ways:

  --moves "e2e4 e7e5 g1f3 ..."   (the full game so far, UCI or SAN, space-sep)
  --fen   "<fen string>"          (a single position)

Prefer --moves when driving a live game. Replaying the move list lets
python-chess derive the *exact* position -- castling rights, en-passant
square, side to move, move clocks -- which a snapshot of the pieces cannot
give you. Getting those wrong makes the engine suggest illegal or weak moves,
so the move list is the source of truth and a scraped board is only a
cross-check.

Output is a single line of JSON, e.g.:

  {"ok": true, "uci": "e2e4", "san": "e4", "from": "e2", "to": "e4",
   "promotion": null, "is_castle": false, "is_capture": false,
   "is_en_passant": false, "gives_check": false, "eval": "+0.30",
   "mate_in": null, "fen_after": "...", "side_moved": "white"}

On any problem it prints {"ok": false, "error": "...", ...} and exits non-zero,
so the caller can react (e.g. install Stockfish) instead of guessing.
"""

import argparse
import json
import shutil
import sys

try:
    import chess
    import chess.engine
except ImportError:
    print(json.dumps({"ok": False, "error": "python_chess_not_installed",
                      "fix": "pip install chess"}))
    sys.exit(1)


def fail(error, **extra):
    print(json.dumps({"ok": False, "error": error, **extra}))
    sys.exit(1)


def find_stockfish():
    path = shutil.which("stockfish")
    if not path:
        fail("stockfish_not_found", fix="brew install stockfish")
    return path


def build_board(moves, fen):
    """Construct the position. Returns a chess.Board or fails loudly."""
    if fen:
        try:
            return chess.Board(fen)
        except ValueError as e:
            fail("bad_fen", detail=str(e))
    board = chess.Board()
    if moves:
        for token in moves.split():
            pushed = False
            # Live boards hand us UCI ("e2e4"); humans paste SAN ("Nf3").
            # Try UCI first, fall back to SAN, so either works.
            for parse in (board.push_uci, board.push_san):
                try:
                    parse(token)
                    pushed = True
                    break
                except ValueError:
                    continue
            if not pushed:
                fail("illegal_or_unparseable_move", move=token,
                     fen_so_far=board.fen())
    return board


def format_eval(pov_score):
    """Human-readable eval from the moving side's perspective.

    Positive = good for the side about to move. Mate scores become "#3" etc.
    """
    mate = pov_score.mate()
    if mate is not None:
        return (f"#{mate}" if mate > 0 else f"#-{abs(mate)}"), mate
    cp = pov_score.score()
    if cp is None:
        return "0.00", None
    return f"{cp/100:+.2f}", None


def main():
    p = argparse.ArgumentParser(description="Best chess move via Stockfish.")
    p.add_argument("--moves", help="game so far, space-separated UCI or SAN")
    p.add_argument("--fen", help="position as FEN (alternative to --moves)")
    p.add_argument("--movetime", type=int, default=2000,
                   help="thinking time in ms (default 2000; plenty to crush "
                        "any chess.com bot)")
    p.add_argument("--depth", type=int, default=None,
                   help="search to fixed depth instead of by time")
    args = p.parse_args()

    if not args.moves and not args.fen:
        # Empty --moves is legitimate: it means "opening position, you move".
        if args.moves is None and args.fen is None:
            fail("no_position_given",
                 fix="pass --moves (may be empty string) or --fen")

    board = build_board(args.moves, args.fen)

    if board.is_game_over():
        fail("game_already_over", result=board.result(),
             reason=str(board.outcome()))

    engine_path = find_stockfish()
    side_to_move = "white" if board.turn == chess.WHITE else "black"

    try:
        with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
            limit = (chess.engine.Limit(depth=args.depth) if args.depth
                     else chess.engine.Limit(time=args.movetime / 1000))
            info = engine.analyse(board, limit)
    except Exception as e:  # engine crash, bad binary, timeout
        fail("engine_error", detail=str(e))

    best = info["pv"][0]
    pov = info["score"].pov(board.turn)
    eval_str, mate_in = format_eval(pov)

    # Special-move flags must be read *before* the move is pushed.
    result = {
        "ok": True,
        "uci": best.uci(),
        "san": board.san(best),
        "from": chess.square_name(best.from_square),
        "to": chess.square_name(best.to_square),
        "promotion": (chess.piece_symbol(best.promotion).lower()
                      if best.promotion else None),
        "is_castle": board.is_castling(best),
        "is_capture": board.is_capture(best),
        "is_en_passant": board.is_en_passant(best),
        "gives_check": board.gives_check(best),
        "side_moved": side_to_move,
        "eval": eval_str,
        "mate_in": mate_in,
    }
    board.push(best)
    result["fen_after"] = board.fen()
    result["opponent_in_checkmate"] = board.is_checkmate()
    print(json.dumps(result))


if __name__ == "__main__":
    main()
