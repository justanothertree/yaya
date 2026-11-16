const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FILES = "abcdefgh";
const sqName = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const sqOf = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
const white = (p) => p !== "" && p === p.toUpperCase();
const sideOf = (p) => p === "" ? null : white(p) ? "w" : "b";
const opp = (s) => s === "w" ? "b" : "w";
function fromFen(fen) {
  const [board2, turn, castle, ep, half, full] = fen.split(" ");
  const sq = [];
  for (const ch of board2) {
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
const at$1 = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c;
function attacked(p, i, by) {
  const r = Math.floor(i / 8);
  const c = i % 8;
  const own = (ch) => by === "w" ? ch.toUpperCase() : ch.toLowerCase();
  const pr = by === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const j = at$1(pr, c + dc);
    if (j >= 0 && p.sq[j] === own("p")) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const j = at$1(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("n")) return true;
  }
  for (const [dr, dc] of KING) {
    const j = at$1(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("k")) return true;
  }
  for (const [dirs, kinds] of [
    [DIAG, ["b", "q"]],
    [LINE, ["r", "q"]]
  ])
    for (const [dr, dc] of dirs)
      for (let k = 1; ; k++) {
        const j = at$1(r + dr * k, c + dc * k);
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
      const one = at$1(r + dir, c);
      if (one >= 0 && !p.sq[one]) {
        pawnTo(one);
        const two = at$1(r + 2 * dir, c);
        if (r === (s === "w" ? 6 : 1) && !p.sq[two]) add(i, two, "double");
      }
      for (const dc of [-1, 1]) {
        const j = at$1(r + dir, c + dc);
        if (j < 0) continue;
        if (sideOf(p.sq[j]) === opp(s)) pawnTo(j);
        else if (j === p.ep) add(i, j, "ep");
      }
    } else if (kind === "n" || kind === "k") {
      for (const [dr, dc] of kind === "n" ? KNIGHT : KING) {
        const j = at$1(r + dr, c + dc);
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
          const j = at$1(r + dr * k, c + dc * k);
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
function play$2(p, m) {
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
function moves$2(p) {
  return pseudo(p).filter((m) => !inCheck(play$2(p, m), p.turn));
}
const posKey = (p) => toFen(p).split(" ").slice(0, 4).join(" ");
function outcome(p, history2 = []) {
  if (!moves$2(p).length)
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
    const takes2 = m.take ? "x" : "";
    if (kind === "P")
      s = `${m.take ? sqName(m.from)[0] : ""}${takes2}${sqName(m.to)}${m.promo ? `=${m.promo.toUpperCase()}` : ""}`;
    else {
      const rivals = moves$2(p).filter(
        (o) => o.piece === m.piece && o.to === m.to && o.from !== m.from
      );
      let which = "";
      if (rivals.length) {
        const sameFile = rivals.some((o) => o.from % 8 === m.from % 8);
        const sameRank = rivals.some((o) => Math.floor(o.from / 8) === Math.floor(m.from / 8));
        which = !sameFile ? sqName(m.from)[0] : !sameRank ? sqName(m.from)[1] : sqName(m.from);
      }
      s = `${kind}${which}${takes2}${sqName(m.to)}`;
    }
  }
  const after2 = play$2(p, m);
  if (inCheck(after2)) s += moves$2(after2).length ? "+" : "#";
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
    const next = play$2(p, m);
    if (inCheck(next, p.turn)) continue;
    const v = -quiet(next, -beta, -alpha, budget);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function search$2(p, depth, alpha, beta, ply, budget) {
  if (p.half >= 100) return 0;
  if (depth <= 0) {
    if (!moves$2(p).length) return inCheck(p) ? -1e5 + ply : 0;
    return quiet(p, alpha, beta, budget);
  }
  if (++budget.n > budget.cap) throw STOP;
  let legal = 0;
  for (const m of order(pseudo(p))) {
    const next = play$2(p, m);
    if (inCheck(next, p.turn)) continue;
    legal++;
    const v = -search$2(next, depth - 1, -beta, -alpha, ply + 1, budget);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  if (!legal) return inCheck(p) ? -1e5 + ply : 0;
  return alpha;
}
const LEVELS$5 = ["easy", "fair", "hard"];
const DEPTH$1 = { easy: 1, fair: 2, hard: 3 };
const CAP = { easy: 1e9, fair: 1e9, hard: 35e3 };
function choose$4(p, level, rand = Math.random, history2 = []) {
  const list = order(moves$2(p));
  if (level === "easy" && rand() < 0.2) return list[Math.floor(rand() * list.length)];
  let settled = [list[0]];
  const budget = { n: 0, cap: CAP[level] };
  for (let depth = 1; depth <= DEPTH$1[level]; depth++) {
    let best = [];
    let bv = -Infinity;
    try {
      const first = [...settled, ...list.filter((m) => !settled.includes(m))];
      for (const m of first) {
        const next = play$2(p, m);
        const repeats = history2.filter((h) => h === posKey(next)).length >= 2;
        const v = repeats ? 0 : -search$2(next, depth - 1, -Infinity, -bv + 1, 1, budget);
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
const MAX_MOVES$1 = 600;
const uci = (m) => `${sqName(m.from)}${sqName(m.to)}${m.promo.toLowerCase()}`;
function replay$2(list) {
  const turns = [{ pos: fromFen(START), move: null, name: "" }];
  let over2 = null;
  for (const code of list) {
    if (over2) return null;
    const p = turns[turns.length - 1].pos;
    const m = moves$2(p).find((x) => uci(x) === code);
    if (!m) return null;
    const next = play$2(p, m);
    turns.push({ pos: next, move: m, name: san(p, m) });
    over2 = outcome(
      next,
      turns.map((t) => posKey(t.pos))
    );
  }
  return { list: [...list], turns, over: over2 };
}
const posOf = (g) => g.turns[g.turns.length - 1].pos;
const history = (g) => g.turns.map((t) => posKey(t.pos));
const chessRules = {
  fresh: () => replay$2([]),
  turn: (g) => g.over ? null : posOf(g).turn === "w" ? 0 : 1,
  legal: (g, code, by) => !g.over && (by === void 0 || (by === 0 ? "w" : "b") === posOf(g).turn) && g.list.length < MAX_MOVES$1 && moves$2(posOf(g)).some((m) => uci(m) === code),
  apply: (g, code) => replay$2([...g.list, code]) ?? g,
  encode: (g) => ({ moves: g.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES$1) return null;
    if (!list.every((c) => typeof c === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c)))
      return null;
    return replay$2(list);
  },
  readMove: (x) => typeof x === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) ? x : null,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$5,
    choose: (g, level) => uci(choose$4(posOf(g), level, Math.random, history(g)))
  },
  result: (g) => !g.over ? null : g.over.winner === null ? "draw" : g.over.winner === "w" ? 0 : 1,
  begun: (g) => g.list.length > 0
};
const other$2 = (w) => w === 1 ? 2 : 1;
const SIZES$2 = [6, 8, 10];
function start(n) {
  const cells = Array(n * n).fill(0);
  const m = n / 2;
  cells[(m - 1) * n + m - 1] = 2;
  cells[m * n + m] = 2;
  cells[(m - 1) * n + m] = 1;
  cells[m * n + m - 1] = 1;
  return { n, cells };
}
const DIRS$1 = [
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
  const them = other$2(who);
  const out = [];
  for (const [dr, dc] of DIRS$1) {
    let r = r0 + dr;
    let c = c0 + dc;
    const run2 = [];
    while (r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === them) {
      run2.push(r * n + c);
      r += dr;
      c += dc;
    }
    if (run2.length && r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === who)
      out.push(...run2);
  }
  return out;
}
function moves$1(b, who) {
  const out = [];
  for (let i = 0; i < b.cells.length; i++)
    if (b.cells[i] === 0 && flips(b, i, who).length) out.push(i);
  return out;
}
function place$2(b, i, who) {
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
  if (moves$1(b, other$2(who)).length) return other$2(who);
  if (moves$1(b, who).length) return who;
  return null;
}
const LEVELS$4 = ["easy", "fair", "hard"];
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
  const them = other$2(me);
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
  const mine = moves$1(b, me).length;
  const theirs = moves$1(b, them).length;
  const mobility = mine + theirs ? 100 * (mine - theirs) / (mine + theirs) : 0;
  return pos + mobility * 0.8;
}
function search$1(b, who, me, depth, alpha, beta, w, exact) {
  const list = moves$1(b, who);
  if (!list.length) {
    if (!moves$1(b, other$2(who)).length) {
      const [d, l] = count(b);
      const diff = l - d;
      return diff * 1e3;
    }
    return search$1(b, other$2(who), me, depth, alpha, beta, w, exact);
  }
  if (depth === 0 && !exact) return evaluate(b, me, w);
  list.sort((a, c) => w[c] - w[a]);
  if (who === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(
        best2,
        search$1(place$2(b, m, who), other$2(who), me, depth - 1, alpha, beta, w, exact)
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
      search$1(place$2(b, m, who), other$2(who), me, depth - 1, alpha, beta, w, exact)
    );
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$3(b, who, level, rand = Math.random) {
  const list = moves$1(b, who);
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
    const v = search$1(place$2(b, m, who), other$2(who), who, depth - 1, -Infinity, Infinity, w, exact);
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
    legal: (g, i, by) => g.turn !== null && (by === void 0 || toWho(by) === g.turn) && Number.isInteger(i) && moves$1(g.b, g.turn).includes(i),
    apply: (g, i) => {
      const b = place$2(g.b, i, g.turn);
      return { b, turn: nextTurn(b, g.turn) };
    },
    encode: (g) => ({ n: g.b.n, cells: g.b.cells, turn: g.turn ?? 0 }),
    decode: readReversiGame,
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$4,
      choose: (g, level) => choose$3(g.b, 2, level)
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
  if (!SIZES$2.includes(n)) return null;
  const cells = o.cells;
  if (!Array.isArray(cells) || cells.length !== n * n || !cells.every((c) => c === 0 || c === 1 || c === 2))
    return null;
  const b = { n, cells };
  const [d, l] = count(b);
  if (d + l < 4) return null;
  const t = o.turn;
  if (t !== 0 && t !== 1 && t !== 2) return null;
  if (t === 0) {
    if (moves$1(b, 1).length || moves$1(b, 2).length) return null;
    return { b, turn: null };
  }
  if (!moves$1(b, t).length) return null;
  return { b, turn: t };
}
const SIZES$1 = [11, 13];
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];
const other$1 = (s) => s === 1 ? 2 : 1;
function newGame$3(n = 13) {
  return {
    n,
    cells: new Int8Array(n * n),
    turn: 1,
    winner: 0,
    line: [],
    moves: [],
    over: false
  };
}
function run(cells, n, i, dr, dc) {
  const s = cells[i];
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const out = [i];
  for (const sign of [1, -1]) {
    let r = r0 + dr * sign;
    let c = c0 + dc * sign;
    while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === s) {
      out.push(r * n + c);
      r += dr * sign;
      c += dc * sign;
    }
  }
  return out.sort((a, b) => a - b);
}
function place$1(g, i) {
  if (g.over || g.cells[i]) return g;
  const cells = g.cells.slice();
  cells[i] = g.turn;
  let line = [];
  for (const [dr, dc] of DIRS) {
    const r = run(cells, g.n, i, dr, dc);
    if (r.length >= 5) line = r;
  }
  const moves2 = [...g.moves, i];
  const won = line.length >= 5;
  const full = moves2.length === g.n * g.n;
  return {
    ...g,
    cells,
    turn: other$1(g.turn),
    winner: won ? g.turn : 0,
    line,
    moves: moves2,
    over: won || full
  };
}
const LEVELS$3 = ["easy", "fair", "hard"];
function shape(cells, n, i, side) {
  let total = 0;
  let fours = 0;
  let threes = 0;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  for (const [dr, dc] of DIRS) {
    let count2 = 1;
    let open2 = 0;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === side) {
        count2++;
        r += dr * sign;
        c += dc * sign;
      }
      if (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === 0) open2++;
    }
    if (count2 >= 5) total += 1e7;
    else if (count2 === 4) {
      total += open2 === 2 ? 1e6 : open2 === 1 ? 6e4 : 0;
      if (open2) fours++;
    } else if (count2 === 3) {
      total += open2 === 2 ? 5e4 : open2 === 1 ? 2e3 : 0;
      if (open2 === 2) threes++;
    } else if (count2 === 2) total += open2 === 2 ? 600 : open2 === 1 ? 80 : 0;
    else total += open2 === 2 ? 20 : open2 === 1 ? 4 : 0;
  }
  if (fours >= 2 || fours && threes) total += 8e5;
  else if (threes >= 2) total += 3e5;
  return total;
}
function candidates(g) {
  const { n, cells } = g;
  if (!g.moves.length) return [Math.floor(n / 2) * n + Math.floor(n / 2)];
  const out = [];
  for (let i = 0; i < n * n; i++) {
    if (cells[i]) continue;
    const r = Math.floor(i / n);
    const c = i % n;
    let near2 = false;
    for (let dr = -2; dr <= 2 && !near2; dr++)
      for (let dc = -2; dc <= 2 && !near2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < n && cc < n && cells[rr * n + cc]) near2 = true;
      }
    if (near2) out.push(i);
  }
  return out;
}
const worth = (g, i, defend) => shape(g.cells, g.n, i, g.turn) + defend * shape(g.cells, g.n, i, other$1(g.turn));
function choose$2(g, level, rand = Math.random) {
  const list = candidates(g);
  const me = g.turn;
  for (const i of list) if (shape(g.cells, g.n, i, me) >= 1e7) return i;
  for (const i of list) if (shape(g.cells, g.n, i, other$1(me)) >= 1e7) return i;
  if (level !== "easy") {
    const winNext = list.find((i) => shape(g.cells, g.n, i, me) >= 3e5);
    if (winNext !== void 0) return winNext;
    const threat = list.map((i) => ({ i, v: shape(g.cells, g.n, i, other$1(me)) })).filter((x) => x.v >= 3e5).sort((x, y) => y.v - x.v)[0];
    if (threat) return threat.i;
  }
  const defend = level === "easy" ? 0.5 : 0.95;
  const ranked = list.map((i) => ({ i, v: worth(g, i, defend) })).sort((a, b) => b.v - a.v);
  if (level === "easy") {
    const k = rand() < 0.4 ? Math.min(4, ranked.length) : 1;
    return ranked[Math.floor(rand() * k)].i;
  }
  if (level === "fair") {
    const top = ranked.filter((x) => x.v === ranked[0].v);
    return top[Math.floor(rand() * top.length)].i;
  }
  let best = ranked[0].i;
  let bv = -Infinity;
  for (const { i } of ranked.slice(0, 10)) {
    const after2 = place$1(g, i);
    if (after2.winner === me) return i;
    if (after2.over) continue;
    const reply = choose$2(after2, "fair", rand);
    const back = place$1(after2, reply);
    if (back.winner) continue;
    const list2 = candidates(back);
    const mine = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, me)), 0);
    const theirs = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, other$1(me))), 0);
    const score = mine - theirs * 0.5;
    if (score > bv) {
      bv = score;
      best = i;
    }
  }
  return best;
}
function gomokuRules(size) {
  return {
    fresh: () => newGame$3(size),
    turn: (g) => g.over ? null : g.turn === 1 ? 0 : 1,
    legal: (g, i, by) => !g.over && (by === void 0 || by === g.turn - 1) && Number.isInteger(i) && i >= 0 && i < g.n * g.n && !g.cells[i],
    apply: (g, i) => place$1(g, i),
    encode: (g) => ({ n: g.n, moves: g.moves }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$1.includes(o.n)) return null;
      const n = o.n;
      if (!Array.isArray(o.moves) || o.moves.length > n * n) return null;
      let g = newGame$3(n);
      for (const i of o.moves) {
        if (g.over || !Number.isInteger(i) || i < 0 || i >= n * n || g.cells[i]) return null;
        g = place$1(g, i);
      }
      return g;
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 169 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$3, choose: (g, level) => choose$2(g, level) },
    result: (g) => !g.over ? null : g.winner ? g.winner === 1 ? 0 : 1 : "draw",
    begun: (g) => g.moves.length > 0
  };
}
const other = (w) => w === 1 ? 2 : 1;
const owner = (p) => p === 0 ? 0 : p === 1 || p === 3 ? 1 : 2;
const isKing = (p) => p >= 3;
const rowOf = (i) => i >> 2;
const colOf = (i) => 2 * (i & 3) + (rowOf(i) % 2 === 0 ? 1 : 0);
const at = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0 ? -1 : r * 4 + (c >> 1);
const DRAW_AFTER = 80;
function newGame$2() {
  const board2 = Array(32).fill(0);
  for (let i = 0; i < 12; i++) board2[i] = 2;
  for (let i = 20; i < 32; i++) board2[i] = 1;
  return { board: board2, turn: 1, quiet: 0, winner: 0 };
}
const forward = (w) => w === 1 ? -1 : 1;
const dirsOf = (p) => {
  const all = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];
  if (isKing(p)) return all;
  const f = forward(owner(p));
  return all.filter(([dr]) => dr === f);
};
const crowns = (p, to) => !isKing(p) && rowOf(to) === (owner(p) === 1 ? 0 : 7);
function jumpsFrom(board2, from, piece) {
  const out = [];
  const me = owner(piece);
  const walk = (sq, path, taken) => {
    let further = false;
    for (const [dr, dc] of dirsOf(piece)) {
      const r = rowOf(sq);
      const c = colOf(sq);
      const over2 = at(r + dr, c + dc);
      const land = at(r + 2 * dr, c + 2 * dc);
      if (over2 < 0 || land < 0) continue;
      const o = owner(board2[over2]);
      if (!o || o === me || taken.includes(over2)) continue;
      if (board2[land] && land !== from) continue;
      further = true;
      const p2 = [...path, land];
      const t2 = [...taken, over2];
      if (crowns(piece, land)) out.push({ path: p2, taken: t2 });
      else walk(land, p2, t2);
    }
    if (!further && taken.length) out.push({ path, taken });
  };
  walk(from, [from], []);
  return out;
}
function moves(g) {
  if (g.winner) return [];
  const jumps = [];
  const steps = [];
  for (let i = 0; i < 32; i++) {
    const p = g.board[i];
    if (owner(p) !== g.turn) continue;
    jumps.push(...jumpsFrom(g.board, i, p));
    if (jumps.length) continue;
    for (const [dr, dc] of dirsOf(p)) {
      const to = at(rowOf(i) + dr, colOf(i) + dc);
      if (to >= 0 && !g.board[to]) steps.push({ path: [i, to], taken: [] });
    }
  }
  return jumps.length ? jumps : steps;
}
function play$1(g, m) {
  const board2 = g.board.slice();
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  let piece = board2[from];
  const wasMan = !isKing(piece);
  if (crowns(piece, to)) piece = piece + 2;
  board2[from] = 0;
  for (const t of m.taken) board2[t] = 0;
  board2[to] = piece;
  const next = {
    board: board2,
    turn: other(g.turn),
    quiet: m.taken.length || wasMan ? 0 : g.quiet + 1,
    winner: 0
  };
  if (!moves(next).length) next.winner = g.turn;
  else if (next.quiet >= DRAW_AFTER) next.winner = 3;
  return next;
}
const LEVELS$2 = ["easy", "fair", "hard"];
const DEPTH = { easy: 2, fair: 4, hard: 6 };
function value(g, me) {
  if (g.winner === me) return 1e5;
  if (g.winner === other(me)) return -1e5;
  if (g.winner === 3) return 0;
  let v = 0;
  let mine = 0;
  let theirs = 0;
  for (let i = 0; i < 32; i++) {
    const p = g.board[i];
    const o = owner(p);
    if (!o) continue;
    const r = rowOf(i);
    const c = colOf(i);
    let x = isKing(p) ? 170 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2 : 100 + (o === 1 ? 7 - r : r) * 3;
    if (!isKing(p) && r === (o === 1 ? 7 : 0)) x += 6;
    if (o === me) {
      v += x;
      mine++;
    } else {
      v -= x;
      theirs++;
    }
  }
  if (mine !== theirs) v += Math.sign(mine - theirs) * (24 - mine - theirs) * 4;
  return v;
}
function search(g, me, depth, alpha, beta) {
  if (g.winner) return value(g, me) + depth * (g.winner === me ? 1 : g.winner === 3 ? 0 : -1);
  const list = moves(g);
  if (depth <= 0 && (!list[0].taken.length || depth <= -6)) return value(g, me);
  if (g.turn === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(best2, search(play$1(g, m), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(best, search(play$1(g, m), me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$1(g, level, rand = Math.random) {
  const list = moves(g);
  if (list.length === 1) return list[0];
  if (level === "easy" && rand() < 0.25) return list[Math.floor(rand() * list.length)];
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const m of list) {
    const v = search(play$1(g, m), me, DEPTH[level] - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_MOVES = 500;
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fresh = () => ({ g: newGame$2(), list: [], last: null });
function replay$1(list) {
  let d = fresh();
  for (const path of list) {
    const m = moves(d.g).find((x) => same(x.path, path));
    if (!m) return null;
    d = { g: play$1(d.g, m), list: [...d.list, m.path], last: m };
  }
  return d;
}
const isPath = (x) => Array.isArray(x) && x.length >= 2 && x.length <= 10 && x.every((i) => Number.isInteger(i) && i >= 0 && i < 32);
const draughtsRules = {
  fresh,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, path, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && d.list.length < MAX_MOVES && moves(d.g).some((m) => same(m.path, path)),
  apply: (d, path) => {
    const m = moves(d.g).find((x) => same(x.path, path));
    return m ? { g: play$1(d.g, m), list: [...d.list, m.path], last: m } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES || !list.every(isPath)) return null;
    return replay$1(list);
  },
  readMove: (x) => isPath(x) ? [...x] : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$2, choose: (d, level) => choose$1(d.g, level).path },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
function board(rows, cols) {
  const H = (rows + 1) * cols;
  const L = H + rows * (cols + 1);
  const boxesOf = Array.from({ length: L }, () => []);
  const linesOf = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const b = r * cols + c;
      const lines = [
        r * cols + c,
        (r + 1) * cols + c,
        H + r * (cols + 1) + c,
        H + r * (cols + 1) + c + 1
      ];
      linesOf.push(lines);
      for (const l of lines) boxesOf[l].push(b);
    }
  return { rows, cols, boxesOf, linesOf };
}
const lineCount = (b) => b.boxesOf.length;
function newGame$1(rows, cols, first = 0) {
  const b = board(rows, cols);
  return {
    b,
    drawn: new Uint8Array(lineCount(b)),
    by: new Int8Array(lineCount(b)).fill(-1),
    owner: new Int8Array(rows * cols).fill(-1),
    score: [0, 0],
    turn: first,
    moves: 0
  };
}
const copy = (g) => ({
  ...g,
  drawn: g.drawn.slice(),
  by: g.by.slice(),
  owner: g.owner.slice(),
  score: [g.score[0], g.score[1]]
});
const sides = (g, box) => {
  let n = 0;
  for (const l of g.b.linesOf[box]) n += g.drawn[l];
  return n;
};
const over = (g) => g.score[0] + g.score[1] === g.owner.length;
const open = (g) => {
  const out = [];
  for (let l = 0; l < g.drawn.length; l++) if (!g.drawn[l]) out.push(l);
  return out;
};
function play(g, l) {
  if (g.drawn[l]) throw new Error(`line ${l} is already drawn`);
  g.drawn[l] = 1;
  g.by[l] = g.turn;
  g.moves++;
  const closed = [];
  for (const box of g.b.boxesOf[l])
    if (sides(g, box) === 4) {
      g.owner[box] = g.turn;
      g.score[g.turn]++;
      closed.push(box);
    }
  if (!closed.length) g.turn = g.turn === 0 ? 1 : 0;
  return closed;
}
const takes = (g, l) => !g.drawn[l] && g.b.boxesOf[l].some((box) => sides(g, box) === 3);
const safe = (g, l) => !g.drawn[l] && g.b.boxesOf[l].every((box) => sides(g, box) < 2);
function gives(g, l) {
  const h = copy(g);
  play(h, l);
  if (h.turn === g.turn) return 0;
  let n = 0;
  for (; ; ) {
    let found = -1;
    for (let k = 0; k < h.drawn.length && found < 0; k++) if (takes(h, k)) found = k;
    if (found < 0) return n;
    n += play(h, found).length;
  }
}
const LEVELS$1 = ["easy", "fair", "hard"];
const pickOf = (list, rand) => list[Math.floor(rand() * list.length)];
function fair(g, rand) {
  const all = open(g);
  const take = all.filter((l) => takes(g, l));
  if (take.length) return pickOf(take, rand);
  const ok = all.filter((l) => safe(g, l));
  if (ok.length) return pickOf(ok, rand);
  let best = [];
  let bn = Infinity;
  for (const l of all) {
    const n = gives(g, l);
    if (n < bn) {
      bn = n;
      best = [l];
    } else if (n === bn) best.push(l);
  }
  return pickOf(best, rand);
}
function rollout(g, me, rand) {
  const h = copy(g);
  while (!over(h)) play(h, fair(h, rand));
  return h.score[me] - h.score[me === 0 ? 1 : 0];
}
function choose(g, level, rand = Math.random) {
  const all = open(g);
  if (level === "easy") {
    const take2 = all.filter((l) => takes(g, l));
    if (take2.length && rand() < 0.75) return pickOf(take2, rand);
    const ok = all.filter((l) => safe(g, l));
    return ok.length && rand() < 0.6 ? pickOf(ok, rand) : pickOf(all, rand);
  }
  if (level === "fair") return fair(g, rand);
  const safeLeft = all.filter((l) => safe(g, l)).length;
  if (safeLeft > 4 || all.length > 40) return fair(g, rand);
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const l of all) {
    const h = copy(g);
    play(h, l);
    const v = over(h) ? h.score[me] - h.score[me === 0 ? 1 : 0] : rollout(h, me, rand);
    if (v > bv) {
      bv = v;
      best = [l];
    } else if (v === bv) best.push(l);
  }
  const take = best.filter((l) => takes(g, l));
  return pickOf(take.length ? take : best, rand);
}
const SIZES = [3, 4, 5, 6];
const after = (d, l) => {
  const g = copy(d.g);
  play(g, l);
  return { g, lines: [...d.lines, l] };
};
function replay(n, lines) {
  let d = { g: newGame$1(n, n, 0), lines: [] };
  const total = lineCount(d.g.b);
  for (const l of lines) {
    if (!Number.isInteger(l) || l < 0 || l >= total || d.g.drawn[l]) return null;
    d = after(d, l);
  }
  return d;
}
function dotsRules(size) {
  return {
    fresh: () => ({ g: newGame$1(size, size, 0), lines: [] }),
    turn: (d) => over(d.g) ? null : d.g.turn,
    legal: (d, l, by) => !over(d.g) && (by === void 0 || by === d.g.turn) && Number.isInteger(l) && l >= 0 && l < lineCount(d.g.b) && !d.g.drawn[l],
    apply: (d, l) => after(d, l),
    encode: (d) => ({ n: d.g.b.rows, lines: d.lines }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES.includes(o.n) || !Array.isArray(o.lines)) return null;
      return replay(o.n, o.lines);
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$1, choose: (d, level) => choose(copy(d.g), level) },
    result: (d) => {
      if (!over(d.g)) return null;
      const [a, b] = d.g.score;
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (d) => d.lines.length > 0
  };
}
function rng(seed2) {
  let s = seed2 >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}
const TW = 2.24;
const TH = 1.12;
const R = 0.0286;
const POCKET = 0.062;
const POCKETS = [
  { x: 0, y: 0 },
  { x: TW / 2, y: -0.012 },
  { x: TW, y: 0 },
  { x: 0, y: TH },
  { x: TW / 2, y: TH + 0.012 },
  { x: TW, y: TH }
];
const MAX_SPEED = 5.2;
const ROLL = 0.32;
const CUSHION = 0.78;
const BALL_E = 0.95;
const groupOf = (n) => n >= 1 && n <= 7 ? "solids" : n >= 9 ? "stripes" : null;
const HEAD_X = TW * 0.25;
const FOOT = { x: TW * 0.73, y: TH / 2 };
function rack(seed2) {
  const rand = rng(seed2);
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const solid = rest.findIndex((n) => n < 8);
  const a = rest.splice(solid, 1)[0];
  const stripe = rest.findIndex((n) => n > 8);
  const b = rest.splice(stripe, 1)[0];
  let k = 0;
  const balls = [{ n: 0, x: HEAD_X, y: TH / 2, vx: 0, vy: 0, down: false }];
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) {
      let n;
      if (row === 2 && i === 1) n = 8;
      else if (row === 4 && i === 0) n = a;
      else if (row === 4 && i === 4) n = b;
      else n = rest[k++];
      const dx = row * R * Math.sqrt(3) * 1.002;
      const dy = (i - row / 2) * R * 2.004;
      balls.push({ n, x: FOOT.x + dx, y: FOOT.y + dy, vx: 0, vy: 0, down: false });
    }
  return balls.sort((p, q) => p.n - q.n);
}
const near = (b) => POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < POCKET + R * 0.6);
function strike(balls, angle, power, record = false) {
  const bs = balls.map((b) => ({ ...b }));
  const cue = bs.find((b) => b.n === 0);
  const sp = Math.max(0, Math.min(1, power)) * MAX_SPEED;
  cue.vx = Math.cos(angle) * sp;
  cue.vy = Math.sin(angle) * sp;
  const log = { first: -1, down: [], rail: false, time: 0, frames: [] };
  const dt = 1 / 600;
  let step = 0;
  for (let t = 0; t < 30; t += dt) {
    if (record && step++ % 10 === 0) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]));
    let moving = false;
    for (const b of bs) {
      if (b.down) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v === 0) continue;
      moving = true;
      const slow = Math.max(0, v - ROLL * dt) / v;
      b.vx *= slow;
      b.vy *= slow;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (Math.hypot(b.vx, b.vy) < 4e-3) b.vx = b.vy = 0;
      const p = POCKETS.find((q) => Math.hypot(b.x - q.x, b.y - q.y) < POCKET);
      if (p) {
        b.down = true;
        b.vx = b.vy = 0;
        log.down.push(b.n);
        continue;
      }
      if (!near(b)) {
        let hit = false;
        if (b.x < R || b.x > TW - R) {
          b.x = b.x < R ? R : TW - R;
          b.vx = (b.x === R ? 1 : -1) * Math.abs(b.vx) * CUSHION;
          hit = true;
        }
        if (b.y < R || b.y > TH - R) {
          b.y = b.y < R ? R : TH - R;
          b.vy = (b.y === R ? 1 : -1) * Math.abs(b.vy) * CUSHION;
          hit = true;
        }
        if (hit && log.first >= 0) log.rail = true;
      } else {
        b.x = Math.max(-R, Math.min(TW + R, b.x));
        b.y = Math.max(-R, Math.min(TH + R, b.y));
      }
    }
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.down) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.down) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const push = (2 * R - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        if (rel <= 0) continue;
        const jn = rel * (1 + BALL_E) / 2;
        a.vx -= jn * nx;
        a.vy -= jn * ny;
        b.vx += jn * nx;
        b.vy += jn * ny;
        if (log.first < 0 && (a.n === 0 || b.n === 0)) log.first = a.n === 0 ? b.n : a.n;
      }
    }
    log.time = t;
    if (!moving) break;
  }
  if (record) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]));
  return { balls: bs, log };
}
function newGame(seed2, first = 0) {
  return {
    balls: rack(seed2),
    turn: first,
    groups: [null, null],
    inHand: false,
    broken: false,
    winner: null,
    said: ""
  };
}
const left = (g, grp) => g.balls.filter((b) => !b.down && groupOf(b.n) === grp).length;
function targets(g, w = g.turn) {
  const grp = g.groups[w];
  if (!grp)
    return g.balls.filter((b) => !b.down && b.n !== 0 && (b.n !== 8 || !g.broken)).map((b) => b.n);
  if (left(g, grp) === 0) return [8];
  return g.balls.filter((b) => !b.down && groupOf(b.n) === grp).map((b) => b.n);
}
function canPlace(g, x, y) {
  if (x < R || x > TW - R || y < R || y > TH - R) return false;
  return g.balls.every((b) => b.down || b.n === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * R + 2e-3);
}
function place(g, x, y) {
  if (!g.inHand || !canPlace(g, x, y)) return g;
  return place_(g, { x, y });
}
function spotFree(balls, n, at2, along) {
  const free = (x, y) => x >= R && x <= TW - R && y >= R && y <= TH - R && balls.every((b) => b.down || b.n === n || Math.hypot(b.x - x, b.y - y) >= 2 * R + 2e-3);
  for (let k = 0; k <= 400; k++)
    for (const way of k ? [1, -1] : [1]) {
      const d = way * k * R * 0.25;
      const p = along === "y" ? { x: at2.x, y: at2.y + d } : { x: at2.x + d, y: at2.y };
      if (free(p.x, p.y)) return p;
    }
  return at2;
}
function shoot(g, angle, power, record = false) {
  const legal = targets(g);
  const { balls, log } = strike(g.balls, angle, power, record);
  const w = g.turn;
  const them = w === 0 ? 1 : 0;
  const groups = [...g.groups];
  const scratch = log.down.includes(0);
  const potted = log.down.filter((n) => n !== 0);
  let foul = null;
  if (scratch) foul = "the cue ball went in";
  else if (log.first < 0) foul = "nothing was hit";
  else if (!legal.includes(log.first))
    foul = `the first ball hit was the ${log.first === 8 ? "black" : `${log.first}`}`;
  else if (!potted.length && !log.rail) foul = "nothing reached a cushion";
  if (potted.includes(8)) {
    if (!g.broken) {
      const spot = balls.find((b) => b.n === 8);
      Object.assign(spot, { ...spotFree(balls, 8, FOOT, "x"), down: false, vx: 0, vy: 0 });
    } else {
      const earned = !foul && groups[w] !== null && left({ ...g, balls }, groups[w]) === 0 && legal.includes(8);
      return {
        game: {
          ...g,
          balls,
          groups,
          broken: true,
          winner: earned ? w : them,
          inHand: false,
          said: earned ? "The black goes down — game!" : `The black went down ${foul ? `on a foul (${foul})` : "too early"} — that loses.`
        },
        log
      };
    }
  }
  if (!foul && g.broken && !groups[w]) {
    const first = potted.map(groupOf).find(Boolean);
    if (first) {
      groups[w] = first;
      groups[them] = first === "solids" ? "stripes" : "solids";
    }
  }
  if (scratch) {
    const cue = balls.find((b) => b.n === 0);
    Object.assign(cue, {
      down: false,
      ...spotFree(balls, 0, { x: HEAD_X, y: TH / 2 }, "y"),
      vx: 0,
      vy: 0
    });
  }
  const mine = groups[w];
  const keep = !foul && potted.some((n) => mine ? groupOf(n) === mine : n !== 8);
  const game = {
    balls,
    turn: keep ? w : them,
    groups,
    inHand: !!foul,
    broken: true,
    winner: null,
    said: foul ? `Foul — ${foul}. Ball in hand.` : keep ? `${potted.length === 1 ? "Down" : `${potted.length} down`} — shoot again.` : potted.length ? "Down, but not one of theirs to keep the turn." : "Nothing down."
  };
  return { game, log };
}
const LEVELS = ["easy", "fair", "hard"];
const SKILL = {
  easy: { wobble: 0.035, tries: 3 },
  fair: { wobble: 0.012, tries: 10 },
  hard: { wobble: 3e-3, tries: 28 }
};
const place_ = (g, at2) => ({
  ...g,
  balls: g.balls.map((b) => b.n === 0 ? { ...b, x: at2.x, y: at2.y, down: false } : b)
});
function clear(balls, ax, ay, bx, by, skip) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  return balls.every((o) => {
    if (o.down || skip.includes(o.n)) return true;
    const u = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / len2));
    return Math.hypot(ax + dx * u - o.x, ay + dy * u - o.y) >= 2 * R;
  });
}
function plan(g, level, rand = Math.random) {
  const skill = SKILL[level];
  let base = g;
  let place2;
  if (g.inHand) {
    const spot = [
      { x: HEAD_X, y: TH / 2 },
      { x: TW / 2, y: TH / 2 },
      { x: TW * 0.4, y: TH * 0.3 },
      { x: TW * 0.4, y: TH * 0.7 },
      { x: TW * 0.6, y: TH * 0.3 },
      { x: TW * 0.6, y: TH * 0.7 }
    ].filter((s) => canPlace(g, s.x, s.y));
    place2 = spot[Math.floor(rand() * spot.length)];
    if (place2) base = place_(g, place2);
  }
  const cue = base.balls.find((b) => b.n === 0);
  const legal = targets(base);
  const cands = [];
  for (const n of legal) {
    const o = base.balls.find((b) => b.n === n);
    for (const p of POCKETS) {
      const px = p.x - o.x;
      const py = p.y - o.y;
      const pd = Math.hypot(px, py);
      const gx = o.x - px / pd * 2 * R;
      const gy = o.y - py / pd * 2 * R;
      const cx = gx - cue.x;
      const cy = gy - cue.y;
      const cd = Math.hypot(cx, cy);
      const cut = Math.acos(Math.max(-1, Math.min(1, (cx * px + cy * py) / (cd * pd))));
      if (cut > 1.2) continue;
      if (!clear(base.balls, cue.x, cue.y, gx, gy, [0, n]) || !clear(base.balls, o.x, o.y, p.x, p.y, [n]))
        continue;
      cands.push({ angle: Math.atan2(cy, cx), score: -cut * 2 - cd - pd * 0.6 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let best = null;
  for (const c of cands.slice(0, skill.tries)) {
    for (const power of [0.35, 0.55, 0.8]) {
      const { game, log } = shoot(base, c.angle, power);
      const won = game.winner === base.turn;
      const lost = game.winner !== null && !won;
      const keep = game.turn === base.turn && !game.inHand;
      const value2 = (won ? 100 : lost ? -100 : keep ? 10 : game.inHand ? -6 : 0) - log.time * 0.1;
      if (!best || value2 > best.value) best = { angle: c.angle, power, value: value2 };
    }
    if (best && best.value >= 9) break;
  }
  if (!best) {
    const o = base.balls.filter((b) => legal.includes(b.n)).sort(
      (a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y)
    )[0];
    best = { angle: o ? Math.atan2(o.y - cue.y, o.x - cue.x) : 0, power: 0.6, value: 0 };
  }
  const wobble = (rand() * 2 - 1) * skill.wobble;
  return { angle: best.angle + wobble, power: best.power, place: place2 };
}
const finite = (x) => typeof x === "number" && Number.isFinite(x);
function readShot(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  if (!finite(o.a) || Math.abs(o.a) > 8 || !finite(o.p) || o.p <= 0 || o.p > 1) return null;
  const spot = o.x !== void 0 || o.y !== void 0;
  if (spot && (!finite(o.x) || !finite(o.y))) return null;
  return spot ? { a: o.a, p: o.p, x: o.x, y: o.y } : { a: o.a, p: o.p };
}
const packBalls = (bs) => bs.map((b) => [b.n, b.x, b.y, b.down ? 1 : 0]);
function readBalls(x) {
  if (!Array.isArray(x) || x.length !== 16) return null;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const b of x) {
    if (!Array.isArray(b) || b.length !== 4) return null;
    const [n, bx, by, d] = b;
    if (!Number.isInteger(n) || n < 0 || n > 15 || seen.has(n)) return null;
    if (!finite(bx) || !finite(by) || d !== 0 && d !== 1) return null;
    const slack = d === 1 ? 4 * R : R;
    if (bx < -slack || bx > TW + slack || by < -slack || by > TH + slack) return null;
    seen.add(n);
    out.push({ n, x: bx, y: by, vx: 0, vy: 0, down: d === 1 });
  }
  const up = out.filter((b) => !b.down);
  for (let i = 0; i < up.length; i++)
    for (let j = i + 1; j < up.length; j++)
      if (Math.hypot(up[i].x - up[j].x, up[i].y - up[j].y) < R) return null;
  return out.sort((p, q) => p.n - q.n);
}
const GROUPS = ["solids", "stripes", null];
function readPoolGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const balls = readBalls(o.balls);
  if (!balls) return null;
  const g = o.groups;
  if (!Array.isArray(g) || g.length !== 2 || !g.every((v) => GROUPS.includes(v)))
    return null;
  const groups = g;
  if (groups[0] === null !== (groups[1] === null)) return null;
  if (groups[0] !== null && groups[0] === groups[1]) return null;
  if (o.turn !== 0 && o.turn !== 1) return null;
  if (o.winner !== null && o.winner !== 0 && o.winner !== 1) return null;
  if (typeof o.inHand !== "boolean" || typeof o.broken !== "boolean") return null;
  if (typeof o.said !== "string" || o.said.length > 200) return null;
  const cue = balls.find((b) => b.n === 0);
  const black = balls.find((b) => b.n === 8);
  if ((cue.down || black.down) && o.winner === null) return null;
  const last = o.last === null ? null : readShot(o.last);
  if (o.last !== null && !last) return null;
  const prev = o.prev === null ? null : readBalls(o.prev);
  if (o.prev !== null && !prev) return null;
  return {
    balls,
    groups,
    turn: o.turn,
    winner: o.winner,
    inHand: o.inHand,
    broken: o.broken,
    said: o.said,
    last,
    prev
  };
}
const seed = () => Math.floor(Math.random() * 2 ** 31);
const poolRules = {
  fresh: () => ({ ...newGame(seed(), 0), last: null, prev: null }),
  turn: (g) => g.winner !== null ? null : g.turn,
  legal: (g, m, by) => g.winner === null && (by === void 0 || by === g.turn) && readShot(m) !== null && (m.x === void 0 || g.inHand && canPlace(g, m.x, m.y)),
  apply: (g, m) => {
    const base = m.x !== void 0 && g.inHand ? place(g, m.x, m.y) : g;
    const { game } = shoot(base, m.a, m.p);
    return { ...game, last: m, prev: base.balls };
  },
  encode: (g) => ({
    balls: packBalls(g.balls),
    groups: g.groups,
    turn: g.turn,
    winner: g.winner,
    inHand: g.inHand,
    broken: g.broken,
    said: g.said,
    last: g.last,
    prev: g.prev ? packBalls(g.prev) : null
  }),
  decode: readPoolGame,
  readMove: readShot,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => {
      const s = plan(g, level);
      return s.place ? { a: s.angle, p: s.power, ...s.place } : { a: s.angle, p: s.power };
    }
  },
  result: (g) => g.winner,
  begun: (g) => g.broken
};
const GAMES = {
  reversi: (s) => {
    const size = s.size ?? 8;
    if (!SIZES$2.includes(size)) return null;
    return {
      rules: reversiRules(size),
      score: (g) => count(g.b).join("–")
    };
  },
  chess: () => ({ rules: chessRules }),
  pool: () => ({ rules: poolRules }),
  gomoku: (s) => {
    const size = s.size ?? 13;
    return SIZES$1.includes(size) ? { rules: gomokuRules(size) } : null;
  },
  draughts: () => ({ rules: draughtsRules }),
  dots: (s) => {
    const size = s.size ?? 4;
    if (!SIZES.includes(size)) return null;
    return { rules: dotsRules(size), score: (d) => d.g.score.join("–") };
  }
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
const HISTORY_BYTES = 180;
const jsonbBytes = (x) => new TextEncoder().encode(JSON.stringify(x).replace(/([,:])/g, "$1 ")).length;
function historyRow(m, then) {
  if (!then.length) return { m };
  const whole = { m, then };
  return jsonbBytes(whole) <= HISTORY_BYTES ? whole : { m, replies: then.length };
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
  const over2 = rules.turn(g) === null;
  const winner = over2 ? rules.result?.(g) ?? "draw" : null;
  return {
    kind: "commit",
    at: row.seq,
    move: historyRow(move, then),
    state: rules.encode(g),
    // versus: whoever the board says; together: the other friend takes the team's next move
    turn: over2 ? null : row.mode === "together" ? 1 - seat : rules.turn(g),
    result: winner === null ? null : { winner, ...game.score ? { score: game.score(g).slice(0, 40) } : {} }
  };
}
export {
  GAMES,
  HISTORY_BYTES,
  decide,
  historyRow,
  jsonbBytes,
  readAsk
};
