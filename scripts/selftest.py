#!/usr/bin/env python3
"""Regression test for the chess brain (bestmove.py).

Run this after changing bestmove.py or upgrading Stockfish to confirm the
engine layer still plays correctly. It checks the things that actually matter:
finds forced mates, returns only legal moves, replays real games without
desync, and handles promotion. No browser required.

    python3 selftest.py        # exits 0 if all pass, 1 otherwise

Puzzle answers were verified independently with python-chess (mate detection
does not depend on engine strength), so a failure here means a real
regression, not a flaky expectation.
"""

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
BESTMOVE = HERE / "bestmove.py"


def run(args):
    proc = subprocess.run([sys.executable, str(BESTMOVE), *args],
                          capture_output=True, text=True)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": "no_json", "raw": proc.stdout + proc.stderr}


CASES = []


def case(name):
    def reg(fn):
        CASES.append((name, fn))
        return fn
    return reg


@case("finds back-rank mate-in-1 (Rd8#)")
def _(r=None):
    r = run(["--fen", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "--movetime", "500"])
    assert r["ok"], r
    assert r["uci"] == "d1d8", f"expected d1d8, got {r['uci']}"
    assert r["opponent_in_checkmate"], "should be checkmate"
    assert r["mate_in"] == 1, r["mate_in"]


@case("finds Scholar's mate-in-1 (Qxf7#)")
def _():
    r = run(["--fen", "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
             "--movetime", "500"])
    assert r["ok"], r
    assert r["uci"] == "h5f7", f"expected h5f7, got {r['uci']}"
    assert r["opponent_in_checkmate"], "should be checkmate"
    assert r["is_capture"], "Qxf7 is a capture"


@case("opening move is legal and sound")
def _():
    r = run(["--moves", "", "--movetime", "500"])
    assert r["ok"], r
    assert r["side_moved"] == "white"
    # any of the standard strong first moves is acceptable
    assert r["uci"] in {"e2e4", "d2d4", "g1f3", "c2c4"}, r["uci"]


@case("replays a real game (SAN) without desync")
def _():
    # Italian game opening, black to move after 5 plies
    r = run(["--moves", "e4 e5 Nf3 Nc6 Bc4", "--movetime", "500"])
    assert r["ok"], r
    assert r["side_moved"] == "black", r["side_moved"]


@case("accepts UCI move history too")
def _():
    r = run(["--moves", "e2e4 e7e5 g1f3", "--movetime", "500"])
    assert r["ok"], r
    assert r["side_moved"] == "black", r["side_moved"]


@case("promotes a pawn (reports promotion piece)")
def _():
    # a7 pawn captures the b8 knight by promoting: axb8=Q wins a piece and is
    # unambiguously best (a quiet a8=Q would let the knight escape).
    r = run(["--fen", "1n6/P7/8/8/8/5k2/8/5K2 w - - 0 1", "--movetime", "600"])
    assert r["ok"], r
    assert r["to"] == "b8" and r["promotion"] == "q", r
    assert r["is_capture"], "axb8=Q is a capture"


@case("flags castling as a castle move")
def _():
    # White can castle kingside and it is reasonable here.
    r = run(["--fen", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1",
             "--movetime", "800"])
    assert r["ok"], r
    if r["uci"] == "e1g1":
        assert r["is_castle"], "O-O should be flagged as castle"


@case("rejects an illegal move history")
def _():
    r = run(["--moves", "e4 e4", "--movetime", "200"])
    assert not r["ok"], r
    assert r["error"] == "illegal_or_unparseable_move", r


@case("refuses to move in a finished game")
def _():
    # Fool's mate final position, white to move but already checkmated.
    r = run(["--fen", "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
             "--movetime", "200"])
    assert not r["ok"], r
    assert r["error"] == "game_already_over", r


def main():
    passed = failed = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"  PASS  {name}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {name}\n        {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {name}\n        {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
