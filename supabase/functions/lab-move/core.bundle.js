const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FILES = "abcdefgh";
const sqName = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const sqOf = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
const white = (p) => p !== "" && p === p.toUpperCase();
const sideOf = (p) => p === "" ? null : white(p) ? "w" : "b";
const opp = (s) => s === "w" ? "b" : "w";
function fromFen(fen) {
  const [board, turn, castle, ep, half, full] = fen.split(" ");
  const sq = [];
  for (const ch of board) {
    if (ch === "/") continue;
    if (/\d/.test(ch)) for (let k = 0; k < Number(ch); k++) sq.push("");
    else sq.push(ch);
  }
  return {
    sq,
    turn,
    castle: castle === "-" ? "" : castle,
    ep: ep === "-" ? -1 : sqOf(ep),
    half: Number(half ?? 0),
    full: Number(full ?? 1)
  };
}
function toFen(p) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = "";
    let gap = 0;
    for (let c = 0; c < 8; c++) {
      const x = p.sq[r * 8 + c];
      if (!x) gap++;
      else {
        if (gap) row += gap;
        gap = 0;
        row += x;
      }
    }
    if (gap) row += gap;
    rows.push(row);
  }
  return `${rows.join("/")} ${p.turn} ${p.castle || "-"} ${p.ep >= 0 ? sqName(p.ep) : "-"} ${p.half} ${p.full}`;
}
const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1]
];
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1]
];
const DIAG = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1]
];
const LINE = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
const at = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c;
function attacked(p, i, by) {
  const r = Math.floor(i / 8);
  const c = i % 8;
  const own = (ch) => by === "w" ? ch.toUpperCase() : ch.toLowerCase();
  const pr = by === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const j = at(pr, c + dc);
    if (j >= 0 && p.sq[j] === own("p")) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const j = at(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("n")) return true;
  }
  for (const [dr, dc] of KING) {
    const j = at(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("k")) return true;
  }
  for (const [dirs, kinds] of [
    [DIAG, ["b", "q"]],
    [LINE, ["r", "q"]]
  ])
    for (const [dr, dc] of dirs)
      for (let k = 1; ; k++) {
        const j = at(r + dr * k, c + dc * k);
        if (j < 0) break;
        const x = p.sq[j];
        if (!x) continue;
        if (kinds.some((t) => x === own(t))) return true;
        break;
      }
  return false;
}
const kingSq = (p, s) => p.sq.indexOf(s === "w" ? "K" : "k");
const inCheck = (p, s = p.turn) => attacked(p, kingSq(p, s), opp(s));
function pseudo(p) {
  const out = [];
  const s = p.turn;
  const add = (from, to, flag = "", promo = "") => out.push({
    from,
    to,
    piece: p.sq[from],
    take: flag === "ep" ? s === "w" ? "p" : "P" : p.sq[to],
    promo,
    flag
  });
  for (let i = 0; i < 64; i++) {
    const x = p.sq[i];
    if (sideOf(x) !== s) continue;
    const r = Math.floor(i / 8);
    const c = i % 8;
    const kind = x.toLowerCase();
    if (kind === "p") {
      const dir = s === "w" ? -1 : 1;
      const last = s === "w" ? 0 : 7;
      const pawnTo = (to, flag = "") => {
        if (Math.floor(to / 8) === last)
          for (const q of "qrbn") add(i, to, flag, s === "w" ? q.toUpperCase() : q);
        else add(i, to, flag);
      };
      const one = at(r + dir, c);
      if (one >= 0 && !p.sq[one]) {
        pawnTo(one);
        const two = at(r + 2 * dir, c);
        if (r === (s === "w" ? 6 : 1) && !p.sq[two]) add(i, two, "double");
      }
      for (const dc of [-1, 1]) {
        const j = at(r + dir, c + dc);
        if (j < 0) continue;
        if (sideOf(p.sq[j]) === opp(s)) pawnTo(j);
        else if (j === p.ep) add(i, j, "ep");
      }
    } else if (kind === "n" || kind === "k") {
      for (const [dr, dc] of kind === "n" ? KNIGHT : KING) {
        const j = at(r + dr, c + dc);
        if (j >= 0 && sideOf(p.sq[j]) !== s) add(i, j);
      }
      if (kind === "k") {
        const home = s === "w" ? 60 : 4;
        if (i === home && !attacked(p, i, opp(s))) {
          const k = s === "w" ? "K" : "k";
          const q = s === "w" ? "Q" : "q";
          if (p.castle.includes(k) && !p.sq[i + 1] && !p.sq[i + 2] && !attacked(p, i + 1, opp(s)))
            add(i, i + 2, "O-O");
          if (p.castle.includes(q) && !p.sq[i - 1] && !p.sq[i - 2] && !p.sq[i - 3] && !attacked(p, i - 1, opp(s)))
            add(i, i - 2, "O-O-O");
        }
      }
    } else {
      const dirs = kind === "b" ? DIAG : kind === "r" ? LINE : [...DIAG, ...LINE];
      for (const [dr, dc] of dirs)
        for (let k = 1; ; k++) {
          const j = at(r + dr * k, c + dc * k);
          if (j < 0) break;
          const y = sideOf(p.sq[j]);
          if (y === s) break;
          add(i, j);
          if (y) break;
        }
    }
  }
  return out;
}
function play(p, m) {
  const sq = p.sq.slice();
  const s = p.turn;
  sq[m.to] = m.promo || m.piece;
  sq[m.from] = "";
  if (m.flag === "ep") sq[m.to + (s === "w" ? 8 : -8)] = "";
  if (m.flag === "O-O") {
    sq[m.from + 1] = sq[m.from + 3];
    sq[m.from + 3] = "";
  }
  if (m.flag === "O-O-O") {
    sq[m.from - 1] = sq[m.from - 4];
    sq[m.from - 4] = "";
  }
  let castle = p.castle;
  const lose = (i, rights) => {
    if (m.from === i || m.to === i) castle = castle.replace(new RegExp(`[${rights}]`, "g"), "");
  };
  lose(60, "KQ");
  lose(4, "kq");
  lose(63, "K");
  lose(56, "Q");
  lose(7, "k");
  lose(0, "q");
  return {
    sq,
    turn: opp(s),
    castle,
    ep: m.flag === "double" ? (m.from + m.to) / 2 : -1,
    half: m.piece.toLowerCase() === "p" || m.take ? 0 : p.half + 1,
    full: p.full + (s === "b" ? 1 : 0)
  };
}
function moves$1(p) {
  return pseudo(p).filter((m) => !inCheck(play(p, m), p.turn));
}
const posKey = (p) => toFen(p).split(" ").slice(0, 4).join(" ");
function outcome(p, history2 = []) {
  if (!moves$1(p).length)
    return inCheck(p) ? { winner: opp(p.turn), why: "checkmate" } : { winner: null, why: "stalemate" };
  if (p.half >= 100) return { winner: null, why: "fifty moves" };
  const k = posKey(p);
  if (history2.filter((h) => h === k).length >= 3) return { winner: null, why: "repetition" };
  const rest = p.sq.filter((x) => x && x.toLowerCase() !== "k").map((x) => x.toLowerCase());
  if (!rest.length || rest.length === 1 && (rest[0] === "b" || rest[0] === "n"))
    return { winner: null, why: "too little to mate" };
  return null;
}
function san(p, m) {
  let s;
  if (m.flag === "O-O" || m.flag === "O-O-O") s = m.flag;
  else {
    const kind = m.piece.toUpperCase();
    const takes = m.take ? "x" : "";
    if (kind === "P")
      s = `${m.take ? sqName(m.from)[0] : ""}${takes}${sqName(m.to)}${m.promo ? `=${m.promo.toUpperCase()}` : ""}`;
    else {
      const rivals = moves$1(p).filter(
        (o) => o.piece === m.piece && o.to === m.to && o.from !== m.from
      );
      let which = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => o.from % 8 === m.from % 8);
        const sameRank = rivals.some((o) => Math.floor(o.from / 8) === Math.floor(m.from / 8));
        which = !sameFile ? sqName(m.from)[0] : !sameRank ? sqName(m.from)[1] : sqName(m.from);
      }
      s = `${kind}${which}${takes}${sqName(m.to)}`;
    }
  }
  const after = play(p, m);
  if (inCheck(after)) s += moves$1(after).length ? "+" : "#";
  return s;
}
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PLACE = {
  p: [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    50,
    50,
    50,
    50,
    50,
    50,
    50,
    50,
    10,
    10,
    20,
    30,
    30,
    20,
    10,
    10,
    5,
    5,
    10,
    25,
    25,
    10,
    5,
    5,
    0,
    0,
    0,
    20,
    20,
    0,
    0,
    0,
    5,
    -5,
    -10,
    0,
    0,
    -10,
    -5,
    5,
    5,
    10,
    10,
    -20,
    -20,
    10,
    10,
    5,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ],
  n: [
    -50,
    -40,
    -30,
    -30,
    -30,
    -30,
    -40,
    -50,
    -40,
    -20,
    0,
    0,
    0,
    0,
    -20,
    -40,
    -30,
    0,
    10,
    15,
    15,
    10,
    0,
    -30,
    -30,
    5,
    15,
    20,
    20,
    15,
    5,
    -30,
    -30,
    0,
    15,
    20,
    20,
    15,
    0,
    -30,
    -30,
    5,
    10,
    15,
    15,
    10,
    5,
    -30,
    -40,
    -20,
    0,
    5,
    5,
    0,
    -20,
    -40,
    -50,
    -40,
    -30,
    -30,
    -30,
    -30,
    -40,
    -50
  ],
  b: [
    -20,
    -10,
    -10,
    -10,
    -10,
    -10,
    -10,
    -20,
    -10,
    0,
    0,
    0,
    0,
    0,
    0,
    -10,
    -10,
    0,
    5,
    10,
    10,
    5,
    0,
    -10,
    -10,
    5,
    5,
    10,
    10,
    5,
    5,
    -10,
    -10,
    0,
    10,
    10,
    10,
    10,
    0,
    -10,
    -10,
    10,
    10,
    10,
    10,
    10,
    10,
    -10,
    -10,
    5,
    0,
    0,
    0,
    0,
    5,
    -10,
    -20,
    -10,
    -10,
    -10,
    -10,
    -10,
    -10,
    -20
  ],
  r: [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    5,
    10,
    10,
    10,
    10,
    10,
    10,
    5,
    -5,
    0,
    0,
    0,
    0,
    0,
    0,
    -5,
    -5,
    0,
    0,
    0,
    0,
    0,
    0,
    -5,
    -5,
    0,
    0,
    0,
    0,
    0,
    0,
    -5,
    -5,
    0,
    0,
    0,
    0,
    0,
    0,
    -5,
    -5,
    0,
    0,
    0,
    0,
    0,
    0,
    -5,
    0,
    0,
    0,
    5,
    5,
    0,
    0,
    0
  ],
  q: [
    -20,
    -10,
    -10,
    -5,
    -5,
    -10,
    -10,
    -20,
    -10,
    0,
    0,
    0,
    0,
    0,
    0,
    -10,
    -10,
    0,
    5,
    5,
    5,
    5,
    0,
    -10,
    -5,
    0,
    5,
    5,
    5,
    5,
    0,
    -5,
    0,
    0,
    5,
    5,
    5,
    5,
    0,
    -5,
    -10,
    5,
    5,
    5,
    5,
    5,
    0,
    -10,
    -10,
    0,
    5,
    0,
    0,
    0,
    0,
    -10,
    -20,
    -10,
    -10,
    -5,
    -5,
    -10,
    -10,
    -20
  ],
  k: [
    -30,
    -40,
    -40,
    -50,
    -50,
    -40,
    -40,
    -30,
    -30,
    -40,
    -40,
    -50,
    -50,
    -40,
    -40,
    -30,
    -30,
    -40,
    -40,
    -50,
    -50,
    -40,
    -40,
    -30,
    -30,
    -40,
    -40,
    -50,
    -50,
    -40,
    -40,
    -30,
    -20,
    -30,
    -30,
    -40,
    -40,
    -30,
    -30,
    -20,
    -10,
    -20,
    -20,
    -20,
    -20,
    -20,
    -20,
    -10,
    20,
    20,
    0,
    0,
    0,
    0,
    20,
    20,
    20,
    30,
    10,
    0,
    0,
    10,
    30,
    20
  ]
};
function evaluate$1(p) {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const x = p.sq[i];
    if (!x) continue;
    const kind = x.toLowerCase();
    const w = white(x);
    v += (w ? 1 : -1) * (VALUE[kind] + PLACE[kind][w ? i : 63 - i]);
  }
  return p.turn === "w" ? v : -v;
}
const order = (list) => list.sort(
  (a, b) => (b.take ? VALUE[b.take.toLowerCase()] * 10 - VALUE[b.piece.toLowerCase()] : 0) + (b.promo ? 800 : 0) - ((a.take ? VALUE[a.take.toLowerCase()] * 10 - VALUE[a.piece.toLowerCase()] : 0) + (a.promo ? 800 : 0))
);
const STOP = new Error("out of time");
function quiet(p, alpha, beta, budget) {
  if (++budget.n > budget.cap) throw STOP;
  const stand = evaluate$1(p);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of order(pseudo(p).filter((x) => x.take || x.promo))) {
    const next = play(p, m);
    if (inCheck(next, p.turn)) continue;
    const v = -quiet(next, -beta, -alpha, budget);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function search$1(p, depth, alpha, beta, ply, budget) {
  if (p.half >= 100) return 0;
  if (depth <= 0) {
    if (!moves$1(p).length) return inCheck(p) ? -1e5 + ply : 0;
    return quiet(p, alpha, beta, budget);
  }
  if (++budget.n > budget.cap) throw STOP;
  let legal = 0;
  for (const m of order(pseudo(p))) {
    const next = play(p, m);
    if (inCheck(next, p.turn)) continue;
    legal++;
    const v = -search$1(next, depth - 1, -beta, -alpha, ply + 1, budget);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  if (!legal) return inCheck(p) ? -1e5 + ply : 0;
  return alpha;
}
const LEVELS$1 = ["easy", "fair", "hard"];
const DEPTH = { easy: 1, fair: 2, hard: 3 };
const CAP = { easy: 1e9, fair: 1e9, hard: 35e3 };
function choose$1(p, level, rand = Math.random, history2 = []) {
  const list = order(moves$1(p));
  if (level === "easy" && rand() < 0.2) return list[Math.floor(rand() * list.length)];
  let settled = [list[0]];
  const budget = { n: 0, cap: CAP[level] };
  for (let depth = 1; depth <= DEPTH[level]; depth++) {
    let best = [];
    let bv = -Infinity;
    try {
      const first = [...settled, ...list.filter((m) => !settled.includes(m))];
      for (const m of first) {
        const next = play(p, m);
        const repeats = history2.filter((h) => h === posKey(next)).length >= 2;
        const v = repeats ? 0 : -search$1(next, depth - 1, -Infinity, -bv + 1, 1, budget);
        if (v > bv) {
          bv = v;
          best = [m];
        } else if (v === bv) best.push(m);
      }
    } catch (e) {
      if (e !== STOP) throw e;
      break;
    }
    settled = best;
  }
  return settled[Math.floor(rand() * settled.length)];
}
const MAX_MOVES = 600;
const uci = (m) => `${sqName(m.from)}${sqName(m.to)}${m.promo.toLowerCase()}`;
function replay(list) {
  const turns = [{ pos: fromFen(START), move: null, name: "" }];
  let over = null;
  for (const code of list) {
    if (over) return null;
    const p = turns[turns.length - 1].pos;
    const m = moves$1(p).find((x) => uci(x) === code);
    if (!m) return null;
    const next = play(p, m);
    turns.push({ pos: next, move: m, name: san(p, m) });
    over = outcome(
      next,
      turns.map((t) => posKey(t.pos))
    );
  }
  return { list: [...list], turns, over };
}
const posOf = (g) => g.turns[g.turns.length - 1].pos;
const history = (g) => g.turns.map((t) => posKey(t.pos));
const chessRules = {
  fresh: () => replay([]),
  turn: (g) => g.over ? null : posOf(g).turn === "w" ? 0 : 1,
  legal: (g, code, by) => !g.over && (by === void 0 || (by === 0 ? "w" : "b") === posOf(g).turn) && g.list.length < MAX_MOVES && moves$1(posOf(g)).some((m) => uci(m) === code),
  apply: (g, code) => replay([...g.list, code]) ?? g,
  encode: (g) => ({ moves: g.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES) return null;
    if (!list.every((c) => typeof c === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c)))
      return null;
    return replay(list);
  },
  readMove: (x) => typeof x === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) ? x : null,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$1,
    choose: (g, level) => uci(choose$1(posOf(g), level, Math.random, history(g)))
  },
  result: (g) => !g.over ? null : g.over.winner === null ? "draw" : g.over.winner === "w" ? 0 : 1,
  begun: (g) => g.list.length > 0
};
const other = (w) => w === 1 ? 2 : 1;
const SIZES = [6, 8, 10];
function start(n) {
  const cells = Array(n * n).fill(0);
  const m = n / 2;
  cells[(m - 1) * n + m - 1] = 2;
  cells[m * n + m] = 2;
  cells[(m - 1) * n + m] = 1;
  cells[m * n + m - 1] = 1;
  return { n, cells };
}
const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1]
];
function flips(b, i, who) {
  if (b.cells[i] !== 0) return [];
  const { n } = b;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const them = other(who);
  const out = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const run = [];
    while (r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === them) {
      run.push(r * n + c);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === who)
      out.push(...run);
  }
  return out;
}
function moves(b, who) {
  const out = [];
  for (let i = 0; i < b.cells.length; i++)
    if (b.cells[i] === 0 && flips(b, i, who).length) out.push(i);
  return out;
}
function place(b, i, who) {
  const f = flips(b, i, who);
  if (!f.length) throw new Error(`${i} is not a move for ${who}`);
  const cells = b.cells.slice();
  cells[i] = who;
  for (const k of f) cells[k] = who;
  return { n: b.n, cells };
}
const count = (b) => {
  let d = 0;
  let l = 0;
  for (const c of b.cells)
    if (c === 1) d++;
    else if (c === 2) l++;
  return [d, l];
};
function nextTurn(b, who) {
  if (moves(b, other(who)).length) return other(who);
  if (moves(b, who).length) return who;
  return null;
}
const LEVELS = ["easy", "fair", "hard"];
function weights(n) {
  const w = [];
  const last = n - 1;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const edgeR = r === 0 || r === last;
      const edgeC = c === 0 || c === last;
      const nearR = r === 1 || r === last - 1;
      const nearC = c === 1 || c === last - 1;
      let v = 1;
      if (edgeR && edgeC) v = 100;
      else if (nearR && nearC || edgeR && nearC || nearR && edgeC)
        v = edgeR || edgeC ? -20 : -40;
      else if (edgeR || edgeC) v = 10;
      w.push(v);
    }
  return w;
}
function cornerOf(n, i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const rr = r <= 1 ? 0 : r >= n - 2 ? n - 1 : -1;
  const cc = c <= 1 ? 0 : c >= n - 2 ? n - 1 : -1;
  return rr < 0 || cc < 0 ? null : rr * n + cc;
}
function evaluate(b, me, w) {
  const them = other(me);
  let pos = 0;
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i];
    if (c === 0) continue;
    let v = w[i];
    if (v < 0) {
      const k = cornerOf(b.n, i);
      if (k !== null && b.cells[k] !== 0) v = 5;
    }
    pos += c === me ? v : -v;
  }
  const mine = moves(b, me).length;
  const theirs = moves(b, them).length;
  const mobility = mine + theirs ? 100 * (mine - theirs) / (mine + theirs) : 0;
  return pos + mobility * 0.8;
}
function search(b, who, me, depth, alpha, beta, w, exact) {
  const list = moves(b, who);
  if (!list.length) {
    if (!moves(b, other(who)).length) {
      const [d, l] = count(b);
      const diff = l - d;
      return diff * 1e3;
    }
    return search(b, other(who), me, depth, alpha, beta, w, exact);
  }
  if (depth === 0 && !exact) return evaluate(b, me, w);
  list.sort((a, c) => w[c] - w[a]);
  if (who === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(
        best2,
        search(place(b, m, who), other(who), me, depth - 1, alpha, beta, w, exact)
      );
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(
      best,
      search(place(b, m, who), other(who), me, depth - 1, alpha, beta, w, exact)
    );
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose(b, who, level, rand = Math.random) {
  const list = moves(b, who);
  if (list.length <= 1) return list[0];
  if (level === "easy") {
    if (rand() < 0.35) return list[Math.floor(rand() * list.length)];
    let best2 = [];
    let bn = -1;
    for (const m of list) {
      const k = flips(b, m, who).length;
      if (k > bn) {
        bn = k;
        best2 = [m];
      } else if (k === bn) best2.push(m);
    }
    return best2[Math.floor(rand() * best2.length)];
  }
  const w = weights(b.n);
  const empty = b.cells.filter((c) => c === 0).length;
  const exact = level === "hard" && empty <= (b.n <= 6 ? 14 : 10);
  const depth = level === "fair" ? 2 : b.n <= 6 ? 6 : 4;
  let best = [];
  let bv = -Infinity;
  for (const m of list.sort((a, c) => w[c] - w[a])) {
    const v = search(place(b, m, who), other(who), who, depth - 1, -Infinity, Infinity, w, exact);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const toSeat = (w) => w === 1 ? 0 : 1;
const toWho = (s) => s === 0 ? 1 : 2;
function reversiRules(size) {
  return {
    fresh: () => ({ b: start(size), turn: 1 }),
    turn: (g) => g.turn === null ? null : toSeat(g.turn),
    legal: (g, i, by) => g.turn !== null && (by === void 0 || toWho(by) === g.turn) && Number.isInteger(i) && moves(g.b, g.turn).includes(i),
    apply: (g, i) => {
      const b = place(g.b, i, g.turn);
      return { b, turn: nextTurn(b, g.turn) };
    },
    encode: (g) => ({ n: g.b.n, cells: g.b.cells, turn: g.turn ?? 0 }),
    decode: readReversiGame,
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS,
      choose: (g, level) => choose(g.b, 2, level)
    },
    result: (g) => {
      if (g.turn !== null) return null;
      const [d, l] = count(g.b);
      return d > l ? 0 : l > d ? 1 : "draw";
    },
    begun: (g) => {
      const [d, l] = count(g.b);
      return d + l > 4;
    }
  };
}
function readReversiGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const n = o.n;
  if (!SIZES.includes(n)) return null;
  const cells = o.cells;
  if (!Array.isArray(cells) || cells.length !== n * n || !cells.every((c) => c === 0 || c === 1 || c === 2))
    return null;
  const b = { n, cells };
  const [d, l] = count(b);
  if (d + l < 4) return null;
  const t = o.turn;
  if (t !== 0 && t !== 1 && t !== 2) return null;
  if (t === 0) {
    if (moves(b, 1).length || moves(b, 2).length) return null;
    return { b, turn: null };
  }
  if (!moves(b, t).length) return null;
  return { b, turn: t };
}
const GAMES = {
  reversi: (s) => {
    const size = s.size ?? 8;
    if (!SIZES.includes(size)) return null;
    return {
      rules: reversiRules(size),
      score: (g) => count(g.b).join("–")
    };
  },
  chess: () => ({ rules: chessRules })
};
const refuse = (status, error) => ({ kind: "refuse", status, error });
function readAsk(body) {
  const o = body;
  if (!o || typeof o !== "object") return null;
  const match = o.match;
  if (typeof match !== "string" || !/^[0-9a-f-]{36}$/i.test(match)) return null;
  if (o.op === "accept") return { match, ask: { op: "accept" } };
  if (o.op === "move" && Number.isInteger(o.at) && o.at >= 0 && "move" in o)
    return { match, ask: { op: "move", at: o.at, move: o.move } };
  return null;
}
function levelOf(game, settings) {
  const levels = game.rules.computer?.levels;
  if (!levels) return null;
  const asked = settings.level ?? levels[0];
  return typeof asked === "string" && levels.includes(asked) ? asked : null;
}
const MAX_REPLIES = 64;
function decide(row, me, ask, games = GAMES) {
  const seat = !row ? null : me === row.player_a ? 0 : me === row.player_b ? 1 : null;
  if (!row || seat === null) return refuse(404, "no such match");
  const make = Object.hasOwn(games, row.demo_id) ? games[row.demo_id] : void 0;
  const settings = row.settings ?? {};
  const game = make?.(settings) ?? null;
  if (!game) return refuse(422, "this match is on a toy or settings that cannot be played by turns");
  const { rules } = game;
  if (row.mode !== "versus" && row.mode !== "together")
    return refuse(422, "a match is versus or together");
  if (!(rules.modes ?? ["versus"]).includes(row.mode))
    return refuse(422, `this toy has no ${row.mode} game`);
  const level = row.mode === "together" ? levelOf(game, settings) : null;
  if (row.mode === "together" && level === null)
    return refuse(422, "this match asks for a computer level the toy does not have");
  if (ask.op === "accept") {
    if (row.status !== "invited") return refuse(409, "that invitation is no longer open");
    if (seat !== 1) return refuse(403, "only the friend who was challenged can accept");
    const g2 = rules.fresh(row.mode);
    return { kind: "begin", state: rules.encode(g2), turn: 0 };
  }
  if (row.status !== "active") return refuse(409, "that match is not going");
  if (row.turn !== seat) return refuse(409, "it is not your turn");
  if (ask.at !== row.seq) return refuse(409, "the match has moved on");
  const g0 = rules.decode(row.state);
  if (g0 === null) return refuse(500, "this match’s board cannot be read");
  const move = rules.readMove(ask.move);
  if (move === null) return refuse(400, "that is not a move in this toy");
  const side = row.mode === "together" ? 0 : seat;
  if (rules.turn(g0) !== side) return refuse(500, "this match’s turn and board disagree");
  if (!rules.legal(g0, move, side)) return refuse(400, "that move is not allowed there");
  let g = rules.apply(g0, move, side);
  const then = [];
  if (row.mode === "together") {
    const cpu = rules.computer;
    while (rules.turn(g) === cpu.side && then.length < MAX_REPLIES) {
      const reply = cpu.choose(g, level);
      if (!rules.legal(g, reply, cpu.side)) return refuse(500, "the computer could not move");
      g = rules.apply(g, reply, cpu.side);
      then.push(reply);
    }
  }
  const over = rules.turn(g) === null;
  const winner = over ? rules.result?.(g) ?? "draw" : null;
  return {
    kind: "commit",
    at: row.seq,
    move: then.length ? { m: move, then } : { m: move },
    state: rules.encode(g),
    // versus: whoever the board says; together: the other friend takes the team's next move
    turn: over ? null : row.mode === "together" ? 1 - seat : rules.turn(g),
    result: winner === null ? null : { winner, ...game.score ? { score: game.score(g).slice(0, 40) } : {} }
  };
}
export {
  GAMES,
  decide,
  readAsk
};
