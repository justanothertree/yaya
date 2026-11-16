const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FILES = "abcdefgh";
const sqName = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const sqOf = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
const white = (p) => p !== "" && p === p.toUpperCase();
const sideOf = (p) => p === "" ? null : white(p) ? "w" : "b";
const opp = (s) => s === "w" ? "b" : "w";
function fromFen(fen) {
  const [board2, turn, castle, ep, half, full2] = fen.split(" ");
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
    full: Number(full2 ?? 1)
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
const at$2 = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c;
function attacked(p, i, by) {
  const r = Math.floor(i / 8);
  const c = i % 8;
  const own = (ch) => by === "w" ? ch.toUpperCase() : ch.toLowerCase();
  const pr = by === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const j = at$2(pr, c + dc);
    if (j >= 0 && p.sq[j] === own("p")) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const j = at$2(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("n")) return true;
  }
  for (const [dr, dc] of KING) {
    const j = at$2(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("k")) return true;
  }
  for (const [dirs, kinds] of [
    [DIAG, ["b", "q"]],
    [LINE, ["r", "q"]]
  ])
    for (const [dr, dc] of dirs)
      for (let k = 1; ; k++) {
        const j = at$2(r + dr * k, c + dc * k);
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
      const one = at$2(r + dir, c);
      if (one >= 0 && !p.sq[one]) {
        pawnTo(one);
        const two = at$2(r + 2 * dir, c);
        if (r === (s === "w" ? 6 : 1) && !p.sq[two]) add(i, two, "double");
      }
      for (const dc of [-1, 1]) {
        const j = at$2(r + dir, c + dc);
        if (j < 0) continue;
        if (sideOf(p.sq[j]) === opp(s)) pawnTo(j);
        else if (j === p.ep) add(i, j, "ep");
      }
    } else if (kind === "n" || kind === "k") {
      for (const [dr, dc] of kind === "n" ? KNIGHT : KING) {
        const j = at$2(r + dr, c + dc);
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
          const j = at$2(r + dr * k, c + dc * k);
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
function play$9(p, m) {
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
function moves$6(p) {
  return pseudo(p).filter((m) => !inCheck(play$9(p, m), p.turn));
}
const posKey = (p) => toFen(p).split(" ").slice(0, 4).join(" ");
function outcome(p, history2 = []) {
  if (!moves$6(p).length)
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
      const rivals = moves$6(p).filter(
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
  const after2 = play$9(p, m);
  if (inCheck(after2)) s += moves$6(after2).length ? "+" : "#";
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
const order$2 = (list) => list.sort(
  (a, b) => (b.take ? VALUE[b.take.toLowerCase()] * 10 - VALUE[b.piece.toLowerCase()] : 0) + (b.promo ? 800 : 0) - ((a.take ? VALUE[a.take.toLowerCase()] * 10 - VALUE[a.piece.toLowerCase()] : 0) + (a.promo ? 800 : 0))
);
const STOP = new Error("out of time");
function quiet(p, alpha, beta, budget2) {
  if (++budget2.n > budget2.cap) throw STOP;
  const stand = evaluate$1(p);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of order$2(pseudo(p).filter((x) => x.take || x.promo))) {
    const next2 = play$9(p, m);
    if (inCheck(next2, p.turn)) continue;
    const v = -quiet(next2, -beta, -alpha, budget2);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}
function search$a(p, depth, alpha, beta, ply, budget2) {
  if (p.half >= 100) return 0;
  if (depth <= 0) {
    if (!moves$6(p).length) return inCheck(p) ? -1e5 + ply : 0;
    return quiet(p, alpha, beta, budget2);
  }
  if (++budget2.n > budget2.cap) throw STOP;
  let legal2 = 0;
  for (const m of order$2(pseudo(p))) {
    const next2 = play$9(p, m);
    if (inCheck(next2, p.turn)) continue;
    legal2++;
    const v = -search$a(next2, depth - 1, -beta, -alpha, ply + 1, budget2);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  if (!legal2) return inCheck(p) ? -1e5 + ply : 0;
  return alpha;
}
const LEVELS$i = ["easy", "fair", "hard"];
const DEPTH$7 = { easy: 1, fair: 2, hard: 3 };
const CAP = { easy: 1e9, fair: 1e9, hard: 35e3 };
function choose$f(p, level, rand = Math.random, history2 = []) {
  const list = order$2(moves$6(p));
  if (level === "easy" && rand() < 0.2) return list[Math.floor(rand() * list.length)];
  let settled = [list[0]];
  const budget2 = { n: 0, cap: CAP[level] };
  for (let depth = 1; depth <= DEPTH$7[level]; depth++) {
    let best = [];
    let bv = -Infinity;
    try {
      const first = [...settled, ...list.filter((m) => !settled.includes(m))];
      for (const m of first) {
        const next2 = play$9(p, m);
        const repeats = history2.filter((h) => h === posKey(next2)).length >= 2;
        const v = repeats ? 0 : -search$a(next2, depth - 1, -Infinity, -bv + 1, 1, budget2);
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
const MAX_MOVES$4 = 600;
const uci = (m) => `${sqName(m.from)}${sqName(m.to)}${m.promo.toLowerCase()}`;
function replay$d(list) {
  const turns = [{ pos: fromFen(START), move: null, name: "" }];
  let over2 = null;
  for (const code of list) {
    if (over2) return null;
    const p = turns[turns.length - 1].pos;
    const m = moves$6(p).find((x) => uci(x) === code);
    if (!m) return null;
    const next2 = play$9(p, m);
    turns.push({ pos: next2, move: m, name: san(p, m) });
    over2 = outcome(
      next2,
      turns.map((t) => posKey(t.pos))
    );
  }
  return { list: [...list], turns, over: over2 };
}
const posOf = (g) => g.turns[g.turns.length - 1].pos;
const history = (g) => g.turns.map((t) => posKey(t.pos));
const chessRules = {
  fresh: () => replay$d([]),
  turn: (g) => g.over ? null : posOf(g).turn === "w" ? 0 : 1,
  legal: (g, code, by) => !g.over && (by === void 0 || (by === 0 ? "w" : "b") === posOf(g).turn) && g.list.length < MAX_MOVES$4 && moves$6(posOf(g)).some((m) => uci(m) === code),
  apply: (g, code) => replay$d([...g.list, code]) ?? g,
  encode: (g) => ({ moves: g.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES$4) return null;
    if (!list.every((c) => typeof c === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c)))
      return null;
    return replay$d(list);
  },
  readMove: (x) => typeof x === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) ? x : null,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$i,
    choose: (g, level) => uci(choose$f(posOf(g), level, Math.random, history(g)))
  },
  result: (g) => !g.over ? null : g.over.winner === null ? "draw" : g.over.winner === "w" ? 0 : 1,
  begun: (g) => g.list.length > 0
};
const other$a = (w) => w === 1 ? 2 : 1;
const SIZES$6 = [6, 8, 10];
function start$1(n) {
  const cells = Array(n * n).fill(0);
  const m = n / 2;
  cells[(m - 1) * n + m - 1] = 2;
  cells[m * n + m] = 2;
  cells[(m - 1) * n + m] = 1;
  cells[m * n + m - 1] = 1;
  return { n, cells };
}
const DIRS$4 = [
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
  const them = other$a(who);
  const out = [];
  for (const [dr, dc] of DIRS$4) {
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
function moves$5(b, who) {
  const out = [];
  for (let i = 0; i < b.cells.length; i++)
    if (b.cells[i] === 0 && flips(b, i, who).length) out.push(i);
  return out;
}
function place$4(b, i, who) {
  const f = flips(b, i, who);
  if (!f.length) throw new Error(`${i} is not a move for ${who}`);
  const cells = b.cells.slice();
  cells[i] = who;
  for (const k of f) cells[k] = who;
  return { n: b.n, cells };
}
const count$2 = (b) => {
  let d = 0;
  let l = 0;
  for (const c of b.cells)
    if (c === 1) d++;
    else if (c === 2) l++;
  return [d, l];
};
function nextTurn(b, who) {
  if (moves$5(b, other$a(who)).length) return other$a(who);
  if (moves$5(b, who).length) return who;
  return null;
}
const LEVELS$h = ["easy", "fair", "hard"];
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
  const them = other$a(me);
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
  const mine = moves$5(b, me).length;
  const theirs = moves$5(b, them).length;
  const mobility = mine + theirs ? 100 * (mine - theirs) / (mine + theirs) : 0;
  return pos + mobility * 0.8;
}
function search$9(b, who, me, depth, alpha, beta, w, exact) {
  const list = moves$5(b, who);
  if (!list.length) {
    if (!moves$5(b, other$a(who)).length) {
      const [d, l] = count$2(b);
      const diff = l - d;
      return diff * 1e3;
    }
    return search$9(b, other$a(who), me, depth, alpha, beta, w, exact);
  }
  if (depth === 0 && !exact) return evaluate(b, me, w);
  list.sort((a, c) => w[c] - w[a]);
  if (who === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(
        best2,
        search$9(place$4(b, m, who), other$a(who), me, depth - 1, alpha, beta, w, exact)
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
      search$9(place$4(b, m, who), other$a(who), me, depth - 1, alpha, beta, w, exact)
    );
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$e(b, who, level, rand = Math.random) {
  const list = moves$5(b, who);
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
  const empty2 = b.cells.filter((c) => c === 0).length;
  const exact = level === "hard" && empty2 <= (b.n <= 6 ? 14 : 10);
  const depth = level === "fair" ? 2 : b.n <= 6 ? 6 : 4;
  let best = [];
  let bv = -Infinity;
  for (const m of list.sort((a, c) => w[c] - w[a])) {
    const v = search$9(place$4(b, m, who), other$a(who), who, depth - 1, -Infinity, Infinity, w, exact);
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
    fresh: () => ({ b: start$1(size), turn: 1 }),
    turn: (g) => g.turn === null ? null : toSeat(g.turn),
    legal: (g, i, by) => g.turn !== null && (by === void 0 || toWho(by) === g.turn) && Number.isInteger(i) && moves$5(g.b, g.turn).includes(i),
    apply: (g, i) => {
      const b = place$4(g.b, i, g.turn);
      return { b, turn: nextTurn(b, g.turn) };
    },
    encode: (g) => ({ n: g.b.n, cells: g.b.cells, turn: g.turn ?? 0 }),
    decode: readReversiGame,
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$h,
      choose: (g, level) => choose$e(g.b, 2, level)
    },
    result: (g) => {
      if (g.turn !== null) return null;
      const [d, l] = count$2(g.b);
      return d > l ? 0 : l > d ? 1 : "draw";
    },
    begun: (g) => {
      const [d, l] = count$2(g.b);
      return d + l > 4;
    }
  };
}
function readReversiGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const n = o.n;
  if (!SIZES$6.includes(n)) return null;
  const cells = o.cells;
  if (!Array.isArray(cells) || cells.length !== n * n || !cells.every((c) => c === 0 || c === 1 || c === 2))
    return null;
  const b = { n, cells };
  const [d, l] = count$2(b);
  if (d + l < 4) return null;
  const t = o.turn;
  if (t !== 0 && t !== 1 && t !== 2) return null;
  if (t === 0) {
    if (moves$5(b, 1).length || moves$5(b, 2).length) return null;
    return { b, turn: null };
  }
  if (!moves$5(b, t).length) return null;
  return { b, turn: t };
}
const SIZES$5 = [11, 13];
const DIRS$3 = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];
const other$9 = (s) => s === 1 ? 2 : 1;
function newGame$b(n = 13) {
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
function place$3(g, i) {
  if (g.over || g.cells[i]) return g;
  const cells = g.cells.slice();
  cells[i] = g.turn;
  let line = [];
  for (const [dr, dc] of DIRS$3) {
    const r = run(cells, g.n, i, dr, dc);
    if (r.length >= 5) line = r;
  }
  const moves2 = [...g.moves, i];
  const won2 = line.length >= 5;
  const full2 = moves2.length === g.n * g.n;
  return {
    ...g,
    cells,
    turn: other$9(g.turn),
    winner: won2 ? g.turn : 0,
    line,
    moves: moves2,
    over: won2 || full2
  };
}
const LEVELS$g = ["easy", "fair", "hard"];
function shape(cells, n, i, side) {
  let total = 0;
  let fours = 0;
  let threes = 0;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  for (const [dr, dc] of DIRS$3) {
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
const worth = (g, i, defend) => shape(g.cells, g.n, i, g.turn) + defend * shape(g.cells, g.n, i, other$9(g.turn));
function choose$d(g, level, rand = Math.random) {
  const list = candidates(g);
  const me = g.turn;
  for (const i of list) if (shape(g.cells, g.n, i, me) >= 1e7) return i;
  for (const i of list) if (shape(g.cells, g.n, i, other$9(me)) >= 1e7) return i;
  if (level !== "easy") {
    const winNext = list.find((i) => shape(g.cells, g.n, i, me) >= 3e5);
    if (winNext !== void 0) return winNext;
    const threat = list.map((i) => ({ i, v: shape(g.cells, g.n, i, other$9(me)) })).filter((x) => x.v >= 3e5).sort((x, y) => y.v - x.v)[0];
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
    const after2 = place$3(g, i);
    if (after2.winner === me) return i;
    if (after2.over) continue;
    const reply = choose$d(after2, "fair", rand);
    const back = place$3(after2, reply);
    if (back.winner) continue;
    const list2 = candidates(back);
    const mine = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, me)), 0);
    const theirs = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, other$9(me))), 0);
    const score2 = mine - theirs * 0.5;
    if (score2 > bv) {
      bv = score2;
      best = i;
    }
  }
  return best;
}
function gomokuRules(size) {
  return {
    fresh: () => newGame$b(size),
    turn: (g) => g.over ? null : g.turn === 1 ? 0 : 1,
    legal: (g, i, by) => !g.over && (by === void 0 || by === g.turn - 1) && Number.isInteger(i) && i >= 0 && i < g.n * g.n && !g.cells[i],
    apply: (g, i) => place$3(g, i),
    encode: (g) => ({ n: g.n, moves: g.moves }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$5.includes(o.n)) return null;
      const n = o.n;
      if (!Array.isArray(o.moves) || o.moves.length > n * n) return null;
      let g = newGame$b(n);
      for (const i of o.moves) {
        if (g.over || !Number.isInteger(i) || i < 0 || i >= n * n || g.cells[i]) return null;
        g = place$3(g, i);
      }
      return g;
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 169 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$g, choose: (g, level) => choose$d(g, level) },
    result: (g) => !g.over ? null : g.winner ? g.winner === 1 ? 0 : 1 : "draw",
    begun: (g) => g.moves.length > 0
  };
}
const other$8 = (w) => w === 1 ? 2 : 1;
const owner$1 = (p) => p === 0 ? 0 : p === 1 || p === 3 ? 1 : 2;
const isKing = (p) => p >= 3;
const rowOf = (i) => i >> 2;
const colOf = (i) => 2 * (i & 3) + (rowOf(i) % 2 === 0 ? 1 : 0);
const at$1 = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0 ? -1 : r * 4 + (c >> 1);
const DRAW_AFTER$2 = 80;
function newGame$a() {
  const board2 = Array(32).fill(0);
  for (let i = 0; i < 12; i++) board2[i] = 2;
  for (let i = 20; i < 32; i++) board2[i] = 1;
  return { board: board2, turn: 1, quiet: 0, winner: 0 };
}
const forward$1 = (w) => w === 1 ? -1 : 1;
const dirsOf = (p) => {
  const all = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];
  if (isKing(p)) return all;
  const f = forward$1(owner$1(p));
  return all.filter(([dr]) => dr === f);
};
const crowns = (p, to) => !isKing(p) && rowOf(to) === (owner$1(p) === 1 ? 0 : 7);
function jumpsFrom(board2, from, piece) {
  const out = [];
  const me = owner$1(piece);
  const walk = (sq, path2, taken) => {
    let further = false;
    for (const [dr, dc] of dirsOf(piece)) {
      const r = rowOf(sq);
      const c = colOf(sq);
      const over2 = at$1(r + dr, c + dc);
      const land = at$1(r + 2 * dr, c + 2 * dc);
      if (over2 < 0 || land < 0) continue;
      const o = owner$1(board2[over2]);
      if (!o || o === me || taken.includes(over2)) continue;
      if (board2[land] && land !== from) continue;
      further = true;
      const p2 = [...path2, land];
      const t2 = [...taken, over2];
      if (crowns(piece, land)) out.push({ path: p2, taken: t2 });
      else walk(land, p2, t2);
    }
    if (!further && taken.length) out.push({ path: path2, taken });
  };
  walk(from, [from], []);
  return out;
}
function moves$4(g) {
  if (g.winner) return [];
  const jumps = [];
  const steps2 = [];
  for (let i = 0; i < 32; i++) {
    const p = g.board[i];
    if (owner$1(p) !== g.turn) continue;
    jumps.push(...jumpsFrom(g.board, i, p));
    if (jumps.length) continue;
    for (const [dr, dc] of dirsOf(p)) {
      const to = at$1(rowOf(i) + dr, colOf(i) + dc);
      if (to >= 0 && !g.board[to]) steps2.push({ path: [i, to], taken: [] });
    }
  }
  return jumps.length ? jumps : steps2;
}
function play$8(g, m) {
  const board2 = g.board.slice();
  const from = m.path[0];
  const to = m.path[m.path.length - 1];
  let piece = board2[from];
  const wasMan = !isKing(piece);
  if (crowns(piece, to)) piece = piece + 2;
  board2[from] = 0;
  for (const t of m.taken) board2[t] = 0;
  board2[to] = piece;
  const next2 = {
    board: board2,
    turn: other$8(g.turn),
    quiet: m.taken.length || wasMan ? 0 : g.quiet + 1,
    winner: 0
  };
  if (!moves$4(next2).length) next2.winner = g.turn;
  else if (next2.quiet >= DRAW_AFTER$2) next2.winner = 3;
  return next2;
}
const LEVELS$f = ["easy", "fair", "hard"];
const DEPTH$6 = { easy: 2, fair: 4, hard: 6 };
function value$6(g, me) {
  if (g.winner === me) return 1e5;
  if (g.winner === other$8(me)) return -1e5;
  if (g.winner === 3) return 0;
  let v = 0;
  let mine = 0;
  let theirs = 0;
  for (let i = 0; i < 32; i++) {
    const p = g.board[i];
    const o = owner$1(p);
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
function search$8(g, me, depth, alpha, beta) {
  if (g.winner) return value$6(g, me) + depth * (g.winner === me ? 1 : g.winner === 3 ? 0 : -1);
  const list = moves$4(g);
  if (depth <= 0 && (!list[0].taken.length || depth <= -6)) return value$6(g, me);
  if (g.turn === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(best2, search$8(play$8(g, m), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(best, search$8(play$8(g, m), me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$c(g, level, rand = Math.random) {
  const list = moves$4(g);
  if (list.length === 1) return list[0];
  if (level === "easy" && rand() < 0.25) return list[Math.floor(rand() * list.length)];
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const m of list) {
    const v = search$8(play$8(g, m), me, DEPTH$6[level] - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_MOVES$3 = 500;
const same$2 = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fresh$b = () => ({ g: newGame$a(), list: [], last: null });
function replay$c(list) {
  let d = fresh$b();
  for (const path2 of list) {
    const m = moves$4(d.g).find((x) => same$2(x.path, path2));
    if (!m) return null;
    d = { g: play$8(d.g, m), list: [...d.list, m.path], last: m };
  }
  return d;
}
const isPath = (x) => Array.isArray(x) && x.length >= 2 && x.length <= 10 && x.every((i) => Number.isInteger(i) && i >= 0 && i < 32);
const draughtsRules = {
  fresh: fresh$b,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, path2, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && d.list.length < MAX_MOVES$3 && moves$4(d.g).some((m) => same$2(m.path, path2)),
  apply: (d, path2) => {
    const m = moves$4(d.g).find((x) => same$2(x.path, path2));
    return m ? { g: play$8(d.g, m), list: [...d.list, m.path], last: m } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES$3 || !list.every(isPath)) return null;
    return replay$c(list);
  },
  readMove: (x) => isPath(x) ? [...x] : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$f, choose: (d, level) => choose$c(d.g, level).path },
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
function newGame$9(rows, cols, first = 0) {
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
const over$4 = (g) => g.score[0] + g.score[1] === g.owner.length;
const open$2 = (g) => {
  const out = [];
  for (let l = 0; l < g.drawn.length; l++) if (!g.drawn[l]) out.push(l);
  return out;
};
function play$7(g, l) {
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
  play$7(h, l);
  if (h.turn === g.turn) return 0;
  let n = 0;
  for (; ; ) {
    let found = -1;
    for (let k = 0; k < h.drawn.length && found < 0; k++) if (takes(h, k)) found = k;
    if (found < 0) return n;
    n += play$7(h, found).length;
  }
}
const LEVELS$e = ["easy", "fair", "hard"];
const pickOf = (list, rand) => list[Math.floor(rand() * list.length)];
function fair(g, rand) {
  const all = open$2(g);
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
  while (!over$4(h)) play$7(h, fair(h, rand));
  return h.score[me] - h.score[me === 0 ? 1 : 0];
}
function choose$b(g, level, rand = Math.random) {
  const all = open$2(g);
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
    play$7(h, l);
    const v = over$4(h) ? h.score[me] - h.score[me === 0 ? 1 : 0] : rollout(h, me, rand);
    if (v > bv) {
      bv = v;
      best = [l];
    } else if (v === bv) best.push(l);
  }
  const take = best.filter((l) => takes(g, l));
  return pickOf(take.length ? take : best, rand);
}
const SIZES$4 = [3, 4, 5, 6];
const after$6 = (d, l) => {
  const g = copy(d.g);
  play$7(g, l);
  return { g, lines: [...d.lines, l] };
};
function replay$b(n, lines) {
  let d = { g: newGame$9(n, n, 0), lines: [] };
  const total = lineCount(d.g.b);
  for (const l of lines) {
    if (!Number.isInteger(l) || l < 0 || l >= total || d.g.drawn[l]) return null;
    d = after$6(d, l);
  }
  return d;
}
function dotsRules(size) {
  return {
    fresh: () => ({ g: newGame$9(size, size, 0), lines: [] }),
    turn: (d) => over$4(d.g) ? null : d.g.turn,
    legal: (d, l, by) => !over$4(d.g) && (by === void 0 || by === d.g.turn) && Number.isInteger(l) && l >= 0 && l < lineCount(d.g.b) && !d.g.drawn[l],
    apply: (d, l) => after$6(d, l),
    encode: (d) => ({ n: d.g.b.rows, lines: d.lines }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$4.includes(o.n) || !Array.isArray(o.lines)) return null;
      return replay$b(o.n, o.lines);
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$e, choose: (d, level) => choose$b(copy(d.g), level) },
    result: (d) => {
      if (!over$4(d.g)) return null;
      const [a, b] = d.g.score;
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (d) => d.lines.length > 0
  };
}
const SIZES$3 = { small: [6, 5], classic: [7, 6], wide: [9, 7] };
const other$7 = (w) => w === 1 ? 2 : 1;
function newGrid(size, need = 4) {
  const [cols, rows] = SIZES$3[size];
  return { cols, rows, need, cells: Array(cols * rows).fill(0), heights: Array(cols).fill(0) };
}
const open$1 = (g) => g.heights.map((h, c) => h < g.rows ? c : -1).filter((c) => c >= 0);
const full = (g) => g.heights.every((h) => h >= g.rows);
function drop(g, col, who) {
  if (col < 0 || col >= g.cols || g.heights[col] >= g.rows) throw new Error(`column ${col} is full`);
  const cells = g.cells.slice();
  const heights = g.heights.slice();
  cells[heights[col] * g.cols + col] = who;
  heights[col]++;
  return { ...g, cells, heights };
}
const DIRS$2 = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];
function lineAt(g, col) {
  const r0 = g.heights[col] - 1;
  if (r0 < 0) return null;
  const who = g.cells[r0 * g.cols + col];
  for (const [dc, dr] of DIRS$2) {
    const line = [r0 * g.cols + col];
    for (const s of [1, -1]) {
      let c = col + dc * s;
      let r = r0 + dr * s;
      while (c >= 0 && c < g.cols && r >= 0 && r < g.rows && g.cells[r * g.cols + c] === who) {
        line.push(r * g.cols + c);
        c += dc * s;
        r += dr * s;
      }
    }
    if (line.length >= g.need) return line.sort((a, b) => a - b);
  }
  return null;
}
const LEVELS$d = ["easy", "fair", "hard"];
const DEPTH$5 = { easy: 1, fair: 3, hard: 6 };
const depthFor = (g, level) => level !== "hard" ? DEPTH$5[level] : g.cols <= 6 ? 8 : g.cols > 7 ? 5 : 6;
const WINDOWS = /* @__PURE__ */ new Map();
function windows(g) {
  const key = `${g.cols}x${g.rows}x${g.need}`;
  let list = WINDOWS.get(key);
  if (list) return list;
  list = [];
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++)
      for (const [dc, dr] of DIRS$2) {
        const w = [];
        for (let k = 0; k < g.need; k++) {
          const cc = c + dc * k;
          const rr = r + dr * k;
          if (cc < 0 || cc >= g.cols || rr < 0 || rr >= g.rows) break;
          w.push(rr * g.cols + cc);
        }
        if (w.length === g.need) list.push(w);
      }
  WINDOWS.set(key, list);
  return list;
}
function score$3(g, me) {
  let s = 0;
  const them = other$7(me);
  for (const w of windows(g)) {
    let a = 0;
    let b = 0;
    for (const i of w) {
      if (g.cells[i] === me) a++;
      else if (g.cells[i] === them) b++;
    }
    if (a && b) continue;
    if (a) s += a === g.need - 1 ? 50 : a === g.need - 2 ? 6 : 1;
    else if (b) s -= b === g.need - 1 ? 60 : b === g.need - 2 ? 6 : 1;
  }
  const mid = Math.floor(g.cols / 2);
  for (let r = 0; r < g.rows; r++) if (g.cells[r * g.cols + mid] === me) s += 3;
  return s;
}
const centreFirst = (g) => open$1(g).sort((a, b) => Math.abs(a - (g.cols - 1) / 2) - Math.abs(b - (g.cols - 1) / 2));
function search$7(g, who, me, depth, alpha, beta) {
  const cols = centreFirst(g);
  if (!cols.length) return 0;
  if (depth === 0) return score$3(g, me);
  let best = who === me ? -Infinity : Infinity;
  for (const c of cols) {
    const next2 = drop(g, c, who);
    let v;
    if (lineAt(next2, c)) v = (who === me ? 1 : -1) * (1e5 + depth);
    else v = search$7(next2, other$7(who), me, depth - 1, alpha, beta);
    if (who === me) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (alpha >= beta) break;
  }
  return best;
}
function choose$a(g, who, level, rand = Math.random) {
  const cols = centreFirst(g);
  for (const c of cols) if (lineAt(drop(g, c, who), c)) return c;
  if (level === "easy" && rand() < 0.35) {
    const safe2 = cols.filter((c) => {
      const after2 = drop(g, c, who);
      return !open$1(after2).some((d) => lineAt(drop(after2, d, other$7(who)), d));
    });
    const list = safe2.length ? safe2 : cols;
    return list[Math.floor(rand() * list.length)];
  }
  let best = [];
  let bv = -Infinity;
  for (const c of cols) {
    const v = search$7(drop(g, c, who), other$7(who), who, depthFor(g, level) - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [c];
    } else if (v === bv) best.push(c);
  }
  return best[Math.floor(rand() * best.length)];
}
function fourRowRules(size, need) {
  return {
    fresh: () => ({ g: newGrid(size, need), turn: 1, winner: 0, line: null, moves: 0 }),
    turn: (s) => s.turn === null ? null : s.turn - 1,
    legal: (s, col) => s.turn !== null && Number.isInteger(col) && col >= 0 && col < s.g.cols && s.g.heights[col] < s.g.rows,
    apply: (s, col) => {
      const who = s.turn;
      const g = drop(s.g, col, who);
      const line = lineAt(g, col);
      const moves2 = s.moves + 1;
      if (line) return { g, turn: null, winner: who, line, moves: moves2 };
      if (full(g)) return { g, turn: null, winner: 0, line: null, moves: moves2 };
      return { g, turn: other$7(who), winner: 0, line: null, moves: moves2 };
    },
    encode: (s) => ({
      cols: s.g.cols,
      rows: s.g.rows,
      need: s.g.need,
      cells: s.g.cells,
      heights: s.g.heights,
      turn: s.turn ?? 0,
      winner: s.winner,
      line: s.line,
      moves: s.moves
    }),
    decode: readFourGame,
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 9 ? x : null
  };
}
function fourRowMatchRules(size, need) {
  const base = fourRowRules(size, need);
  return {
    ...base,
    legal: (s, col, by) => (by === void 0 || by === (s.turn ?? 0) - 1) && base.legal(s, col),
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$d,
      choose: (s, level) => choose$a(s.g, s.turn ?? 2, level)
    },
    result: (s) => s.turn !== null ? null : s.winner === 0 ? "draw" : s.winner === 1 ? 0 : 1,
    begun: (s) => s.moves > 0
  };
}
function readFourSettings(s) {
  const size = s.size ?? "classic";
  const need = s.need ?? 4;
  if (typeof size !== "string" || !Object.hasOwn(SIZES$3, size)) return null;
  if (need !== 4 && need !== 5) return null;
  if (size === "small" && need === 5) return null;
  return [size, need];
}
const ints = (v, n, lo, hi) => Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x) && x >= lo && x <= hi) ? v : null;
function readFourGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const { cols, rows, need } = o;
  if (!Object.values(SIZES$3).some(([c, r]) => c === cols && r === rows)) return null;
  const C = cols;
  const R2 = rows;
  if (need !== 4 && need !== 5 || need > Math.min(C, R2)) return null;
  const cells = ints(o.cells, C * R2, 0, 2);
  const heights = ints(o.heights, C, 0, R2);
  if (!cells || !heights) return null;
  for (let c = 0; c < C; c++)
    for (let r = 0; r < R2; r++) if (cells[r * C + c] !== 0 !== r < heights[c]) return null;
  const n1 = cells.filter((d) => d === 1).length;
  const n2 = cells.filter((d) => d === 2).length;
  if (n1 - n2 !== 0 && n1 - n2 !== 1) return null;
  if (o.moves !== n1 + n2) return null;
  const winner2 = o.winner;
  if (winner2 !== 0 && winner2 !== 1 && winner2 !== 2) return null;
  const turnRaw = o.turn;
  if (turnRaw !== 0 && turnRaw !== 1 && turnRaw !== 2) return null;
  const turn = turnRaw === 0 ? null : turnRaw;
  if (turn !== null && (winner2 !== 0 || turn !== (n1 === n2 ? 1 : 2))) return null;
  const line = o.line === null ? null : ints(o.line, Array.isArray(o.line) ? o.line.length : -1, 0, C * R2 - 1);
  if (o.line !== null && !line) return null;
  if (winner2 !== 0) {
    if (turn !== null || !line || line.length < need) return null;
    if (!line.every((i) => cells[i] === winner2)) return null;
  } else if (line !== null || turn === null && n1 + n2 !== C * R2) return null;
  return {
    g: { cols: C, rows: R2, need, cells, heights },
    turn,
    winner: winner2,
    line,
    moves: n1 + n2
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
const MAX_SPEED$1 = 5.2;
const ROLL = 0.32;
const CUSHION = 0.78;
const BALL_E = 0.95;
const groupOf = (n) => n >= 1 && n <= 7 ? "solids" : n >= 9 ? "stripes" : null;
const HEAD_X = TW * 0.25;
const FOOT = { x: TW * 0.73, y: TH / 2 };
function rack$1(seed2) {
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
  const sp = Math.max(0, Math.min(1, power)) * MAX_SPEED$1;
  cue.vx = Math.cos(angle) * sp;
  cue.vy = Math.sin(angle) * sp;
  const log = { first: -1, down: [], rail: false, time: 0, frames: [] };
  const dt = 1 / 600;
  let step2 = 0;
  for (let t = 0; t < 30; t += dt) {
    if (record && step2++ % 10 === 0) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]));
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
        let hit2 = false;
        if (b.x < R || b.x > TW - R) {
          b.x = b.x < R ? R : TW - R;
          b.vx = (b.x === R ? 1 : -1) * Math.abs(b.vx) * CUSHION;
          hit2 = true;
        }
        if (b.y < R || b.y > TH - R) {
          b.y = b.y < R ? R : TH - R;
          b.vy = (b.y === R ? 1 : -1) * Math.abs(b.vy) * CUSHION;
          hit2 = true;
        }
        if (hit2 && log.first >= 0) log.rail = true;
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
function newGame$8(seed2, first = 0) {
  return {
    balls: rack$1(seed2),
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
function place$2(g, x, y) {
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
function shoot$1(g, angle, power, record = false) {
  const legal2 = targets(g);
  const { balls, log } = strike(g.balls, angle, power, record);
  const w = g.turn;
  const them = w === 0 ? 1 : 0;
  const groups = [...g.groups];
  const scratch = log.down.includes(0);
  const potted = log.down.filter((n) => n !== 0);
  let foul = null;
  if (scratch) foul = "the cue ball went in";
  else if (log.first < 0) foul = "nothing was hit";
  else if (!legal2.includes(log.first))
    foul = `the first ball hit was the ${log.first === 8 ? "black" : `${log.first}`}`;
  else if (!potted.length && !log.rail) foul = "nothing reached a cushion";
  if (potted.includes(8)) {
    if (!g.broken) {
      const spot = balls.find((b) => b.n === 8);
      Object.assign(spot, { ...spotFree(balls, 8, FOOT, "x"), down: false, vx: 0, vy: 0 });
    } else {
      const earned = !foul && groups[w] !== null && left({ ...g, balls }, groups[w]) === 0 && legal2.includes(8);
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
const LEVELS$c = ["easy", "fair", "hard"];
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
function plan$1(g, level, rand = Math.random) {
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
  const legal2 = targets(base);
  const cands = [];
  for (const n of legal2) {
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
      const { game, log } = shoot$1(base, c.angle, power);
      const won2 = game.winner === base.turn;
      const lost = game.winner !== null && !won2;
      const keep = game.turn === base.turn && !game.inHand;
      const value2 = (won2 ? 100 : lost ? -100 : keep ? 10 : game.inHand ? -6 : 0) - log.time * 0.1;
      if (!best || value2 > best.value) best = { angle: c.angle, power, value: value2 };
    }
    if (best && best.value >= 9) break;
  }
  if (!best) {
    const o = base.balls.filter((b) => legal2.includes(b.n)).sort(
      (a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y)
    )[0];
    best = { angle: o ? Math.atan2(o.y - cue.y, o.x - cue.x) : 0, power: 0.6, value: 0 };
  }
  const wobble2 = (rand() * 2 - 1) * skill.wobble;
  return { angle: best.angle + wobble2, power: best.power, place: place2 };
}
const finite = (x) => typeof x === "number" && Number.isFinite(x);
function readShot$1(x) {
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
  const last = o.last === null ? null : readShot$1(o.last);
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
  fresh: () => ({ ...newGame$8(seed(), 0), last: null, prev: null }),
  turn: (g) => g.winner !== null ? null : g.turn,
  legal: (g, m, by) => g.winner === null && (by === void 0 || by === g.turn) && readShot$1(m) !== null && (m.x === void 0 || g.inHand && canPlace(g, m.x, m.y)),
  apply: (g, m) => {
    const base = m.x !== void 0 && g.inHand ? place$2(g, m.x, m.y) : g;
    const { game } = shoot$1(base, m.a, m.p);
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
  readMove: readShot$1,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$c,
    choose: (g, level) => {
      const s = plan$1(g, level);
      return s.place ? { a: s.angle, p: s.power, ...s.place } : { a: s.angle, p: s.power };
    }
  },
  result: (g) => g.winner,
  begun: (g) => g.broken
};
const DEFAULT_RULES = { pits: 6, seeds: 4, captures: true };
const PIT_CHOICES = [4, 5, 6];
const SEED_CHOICES = [3, 4, 5, 6];
const pitsOf = (b) => (b.length - 2) / 2;
const storeOf = (b, side) => side === 0 ? pitsOf(b) : 2 * pitsOf(b) + 1;
const opposite = (b, i) => 2 * pitsOf(b) - i;
const pitsFor = (b, side) => {
  const n = pitsOf(b);
  return Array.from({ length: n }, (_, k) => side === 0 ? k : n + 1 + k);
};
const owner = (b, i) => i === storeOf(b, 0) || i === storeOf(b, 1) ? null : i < pitsOf(b) ? 0 : 1;
function start(rules) {
  const b = Array(2 * rules.pits + 2).fill(rules.seeds);
  b[rules.pits] = 0;
  b[2 * rules.pits + 1] = 0;
  return b;
}
const legal$1 = (b, side) => pitsFor(b, side).filter((i) => b[i] > 0);
function sow(b, pit, side, rules) {
  if (owner(b, pit) !== side || b[pit] === 0) throw new Error(`side ${side} cannot sow from ${pit}`);
  const board2 = [...b];
  const skip = storeOf(b, side === 0 ? 1 : 0);
  let hand = board2[pit];
  board2[pit] = 0;
  let at2 = pit;
  const path2 = [];
  while (hand > 0) {
    at2 = (at2 + 1) % board2.length;
    if (at2 === skip) continue;
    board2[at2]++;
    path2.push(at2);
    hand--;
  }
  let captured = null;
  const mine = storeOf(b, side);
  if (rules.captures && owner(board2, at2) === side && board2[at2] === 1) {
    const opp2 = opposite(board2, at2);
    if (board2[opp2] > 0) {
      captured = { from: opp2, seeds: board2[opp2] + 1 };
      board2[mine] += board2[opp2] + 1;
      board2[opp2] = 0;
      board2[at2] = 0;
    }
  }
  let next2 = at2 === mine ? side : side === 0 ? 1 : 0;
  const over2 = legal$1(board2, 0).length === 0 || legal$1(board2, 1).length === 0;
  if (over2) {
    for (const s of [0, 1])
      for (const i of pitsFor(board2, s)) {
        board2[storeOf(board2, s)] += board2[i];
        board2[i] = 0;
      }
    next2 = side;
  }
  return { board: board2, path: path2, next: next2, captured, over: over2 };
}
const score$2 = (b) => [b[storeOf(b, 0)], b[storeOf(b, 1)]];
const LEVELS$b = ["easy", "fair", "hard"];
const DEPTH$4 = { easy: 1, fair: 4, hard: 9 };
function value$5(b, side) {
  const [a, c] = score$2(b);
  const me = c - a;
  return me * 100;
}
function search$6(b, side, me, depth, alpha, beta, rules) {
  const moves2 = legal$1(b, side);
  if (depth === 0 || moves2.length === 0) return value$5(b);
  const ordered = moves2.map((m) => ({ m, s: sow(b, m, side, rules) })).sort((x, y) => Number(y.s.next === side) - Number(x.s.next === side));
  if (side === me) {
    let best2 = -Infinity;
    for (const { s } of ordered) {
      const v = s.over ? value$5(s.board) * 10 : search$6(s.board, s.next, me, depth - 1, alpha, beta, rules);
      best2 = Math.max(best2, v);
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const { s } of ordered) {
    const v = s.over ? value$5(s.board) * 10 : search$6(s.board, s.next, me, depth - 1, alpha, beta, rules);
    best = Math.min(best, v);
    beta = Math.min(beta, v);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$9(b, side, level, rules, rand = Math.random) {
  const moves2 = legal$1(b, side);
  if (moves2.length === 1) return moves2[0];
  if (level === "easy" && rand() < 0.35) return moves2[Math.floor(rand() * moves2.length)];
  let best = [];
  let bv = -Infinity;
  for (const m of moves2) {
    const s = sow(b, m, side, rules);
    const v = s.over ? value$5(s.board) * 10 : search$6(s.board, s.next, side, DEPTH$4[level] - 1, -Infinity, Infinity, rules);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_SOWINGS = 400;
function fresh$a(rules) {
  return { rules, b: start(rules), turn: 0, pits: [], path: [] };
}
function after$5(g, pit) {
  const s = sow(g.b, pit, g.turn, g.rules);
  return { ...g, b: s.board, turn: s.over ? null : s.next, pits: [...g.pits, pit], path: s.path };
}
function readRules(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  if (!PIT_CHOICES.includes(o.pits)) return null;
  if (!SEED_CHOICES.includes(o.seeds)) return null;
  if (typeof o.captures !== "boolean") return null;
  return { pits: o.pits, seeds: o.seeds, captures: o.captures };
}
function readMancalaSettings(s) {
  return readRules({
    pits: s.pits ?? DEFAULT_RULES.pits,
    seeds: s.seeds ?? DEFAULT_RULES.seeds,
    captures: s.captures ?? DEFAULT_RULES.captures
  });
}
function replay$a(rules, pits) {
  if (pits.length > MAX_SOWINGS) return null;
  let g = fresh$a(rules);
  for (const p of pits) {
    if (g.turn === null || !Number.isInteger(p) || !legal$1(g.b, g.turn).includes(p))
      return null;
    g = after$5(g, p);
  }
  return g;
}
function mancalaRules(rules) {
  return {
    fresh: () => fresh$a(rules),
    turn: (g) => g.turn,
    legal: (g, pit, by) => g.turn !== null && (by === void 0 || by === g.turn) && g.pits.length < MAX_SOWINGS && Number.isInteger(pit) && legal$1(g.b, g.turn).includes(pit),
    apply: (g, pit) => after$5(g, pit),
    encode: (g) => ({
      pits: g.rules.pits,
      seeds: g.rules.seeds,
      captures: g.rules.captures,
      sown: g.pits
    }),
    decode: (x) => {
      const o = x;
      const r = readRules(o);
      if (!r || !Array.isArray(o.sown)) return null;
      return replay$a(r, o.sown);
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 14 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$b,
      choose: (g, level) => choose$9(g.b, 1, level, g.rules)
    },
    result: (g) => {
      if (g.turn !== null) return null;
      const [a, b] = score$2(g.b);
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (g) => g.pits.length > 0
  };
}
const other$6 = (w) => w === 1 ? 2 : 1;
const MEN = 9;
const ring = (s) => Array.from({ length: 8 }, (_, k) => s * 8 + k);
const NEIGHBOURS$1 = Array.from({ length: 24 }, () => []);
const join = (a, b) => {
  NEIGHBOURS$1[a].push(b);
  NEIGHBOURS$1[b].push(a);
};
for (let s = 0; s < 3; s++) {
  const r = ring(s);
  for (let k = 0; k < 8; k++) join(r[k], r[(k + 1) % 8]);
}
for (let k = 1; k < 8; k += 2) {
  join(k, 8 + k);
  join(8 + k, 16 + k);
}
const MILLS = [];
for (let s = 0; s < 3; s++)
  for (let k = 0; k < 8; k += 2) MILLS.push([s * 8 + k, s * 8 + k + 1, s * 8 + (k + 2) % 8]);
for (let k = 1; k < 8; k += 2) MILLS.push([k, 8 + k, 16 + k]);
const newGame$7 = () => ({
  board: Array(24).fill(0),
  hand: [0, MEN, MEN],
  turn: 1,
  quiet: 0,
  winner: 0
});
const DRAW_AFTER$1 = 50;
const count$1 = (g, w) => g.board.filter((m) => m === w).length + g.hand[w];
const inMill = (board2, p) => board2[p] !== 0 && MILLS.some((m) => m.includes(p) && m.every((q) => board2[q] === board2[p]));
const makesMill = (board2, p, w) => MILLS.some((m) => m.includes(p) && m.every((q) => q === p || board2[q] === w));
function takeable(board2, them) {
  const theirs = board2.map((m, i) => m === them ? i : -1).filter((i) => i >= 0);
  const loose = theirs.filter((i) => !inMill(board2, i));
  return loose.length ? loose : theirs;
}
function moves$3(g) {
  if (g.winner) return [];
  const w = g.turn;
  const out = [];
  const steps2 = [];
  if (g.hand[w] > 0) {
    for (let p = 0; p < 24; p++) if (!g.board[p]) steps2.push([-1, p]);
  }
  if (g.hand[w] === 0) {
    const flying = count$1(g, w) === 3;
    for (let p = 0; p < 24; p++) {
      if (g.board[p] !== w) continue;
      for (const q of flying ? [...Array(24).keys()] : NEIGHBOURS$1[p])
        if (!g.board[q]) steps2.push([p, q]);
    }
  }
  for (const [from, to] of steps2) {
    const b = g.board.slice();
    if (from >= 0) b[from] = 0;
    if (makesMill(b, to, w)) {
      b[to] = w;
      for (const t of takeable(b, other$6(w))) out.push({ from, to, take: t });
    } else out.push({ from, to, take: -1 });
  }
  return out;
}
function play$6(g, m) {
  const w = g.turn;
  const board2 = g.board.slice();
  const hand = [0, g.hand[1], g.hand[2]];
  if (m.from < 0) hand[w]--;
  else board2[m.from] = 0;
  board2[m.to] = w;
  if (m.take >= 0) board2[m.take] = 0;
  const next2 = {
    board: board2,
    hand,
    turn: other$6(w),
    quiet: m.take >= 0 ? 0 : g.quiet + 1,
    winner: 0
  };
  const them = other$6(w);
  if (count$1(next2, them) < 3) next2.winner = w;
  else if (!moves$3(next2).length) next2.winner = w;
  else if (hand[1] === 0 && hand[2] === 0 && next2.quiet >= DRAW_AFTER$1) next2.winner = 3;
  return next2;
}
const LEVELS$a = ["easy", "fair", "hard"];
const DEPTH$3 = { easy: 1, fair: 2, hard: 4 };
function value$4(g, me) {
  if (g.winner === me) return 1e5;
  if (g.winner === other$6(me)) return -1e5;
  if (g.winner === 3) return 0;
  const them = other$6(me);
  let v = (count$1(g, me) - count$1(g, them)) * 100;
  for (const m of MILLS) {
    const mine = m.filter((p) => g.board[p] === me).length;
    const theirs = m.filter((p) => g.board[p] === them).length;
    const empty2 = 3 - mine - theirs;
    if (mine === 2 && empty2 === 1) v += 12;
    if (theirs === 2 && empty2 === 1) v -= 12;
    if (mine === 3) v += 6;
    if (theirs === 3) v -= 6;
  }
  for (let p = 0; p < 24; p++) {
    if (!g.board[p]) continue;
    const free = NEIGHBOURS$1[p].filter((q) => !g.board[q]).length;
    v += (g.board[p] === me ? 1 : -1) * free * 2;
  }
  return v;
}
function search$5(g, me, depth, alpha, beta) {
  if (depth === 0 || g.winner)
    return value$4(g, me) + (g.winner ? depth : 0) * (g.winner === me ? 1 : -1);
  const list = moves$3(g);
  list.sort((a, b) => Number(b.take >= 0) - Number(a.take >= 0));
  if (g.turn === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(best2, search$5(play$6(g, m), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(best, search$5(play$6(g, m), me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$8(g, level, rand = Math.random) {
  const list = moves$3(g);
  if (list.length === 1) return list[0];
  if (level === "easy" && rand() < 0.3) return list[Math.floor(rand() * list.length)];
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const m of list) {
    const v = search$5(play$6(g, m), me, DEPTH$3[level] - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_MOVES$2 = 1e3;
const same$1 = (a, b) => a.from === b.from && a.to === b.to && a.take === b.take;
const fresh$9 = () => ({ g: newGame$7(), list: [], last: null });
function readMove$4(x) {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const [from, to, take] = x;
  const ok = (v, none) => Number.isInteger(v) && v >= (none ? -1 : 0) && v < 24;
  return ok(from, true) && ok(to, false) && ok(take, true) ? { from, to, take } : null;
}
function replay$9(list) {
  if (list.length > MAX_MOVES$2) return null;
  let d = fresh$9();
  for (const x of list) {
    const asked = readMove$4(x);
    const m = asked && moves$3(d.g).find((y) => same$1(y, asked));
    if (!m) return null;
    d = { g: play$6(d.g, m), list: [...d.list, m], last: m };
  }
  return d;
}
const morrisRules = {
  fresh: fresh$9,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, m, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && d.list.length < MAX_MOVES$2 && moves$3(d.g).some((x) => same$1(x, m)),
  apply: (d, m) => {
    const real = moves$3(d.g).find((x) => same$1(x, m));
    return real ? { g: play$6(d.g, real), list: [...d.list, real], last: real } : d;
  },
  encode: (d) => ({ moves: d.list.map((m) => [m.from, m.to, m.take]) }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$9(list) : null;
  },
  // the wire carries a move as [from, to, take]; a room's own act carries the object
  readMove: (x) => readMove$4(
    Array.isArray(x) ? x : x && typeof x === "object" ? [x.from, x.to, x.take] : null
  ),
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$a, choose: (d, level) => choose$8(d.g, level) },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const SIZES$2 = [7, 9, 11];
const other$5 = (p) => p === 1 ? 2 : 1;
const empty = (n) => ({ n, cells: Array(n * n).fill(0) });
function around(n, i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const out = [];
  for (const [dr, dc] of [
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0]
  ]) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
  }
  return out;
}
const NEIGHBOURS = /* @__PURE__ */ new Map();
function neighbours(n) {
  let list = NEIGHBOURS.get(n);
  if (!list) {
    list = Array.from({ length: n * n }, (_, i) => around(n, i));
    NEIGHBOURS.set(n, list);
  }
  return list;
}
function chain(cells, n, p) {
  const near2 = neighbours(n);
  const from = new Int32Array(n * n).fill(-2);
  const queue = [];
  for (let k = 0; k < n; k++) {
    const i = p === 1 ? k : k * n;
    if (cells[i] === p) {
      from[i] = -1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const atEnd = p === 1 ? Math.floor(i / n) === n - 1 : i % n === n - 1;
    if (atEnd) {
      const path2 = [];
      for (let k = i; k !== -1; k = from[k]) path2.push(k);
      return path2.reverse();
    }
    for (const j of near2[i])
      if (cells[j] === p && from[j] === -2) {
        from[j] = i;
        queue.push(j);
      }
  }
  return null;
}
const winner$1 = (b) => chain(b.cells, b.n, 1) ? 1 : chain(b.cells, b.n, 2) ? 2 : null;
function place$1(b, i, p) {
  if (b.cells[i] !== 0) throw new Error(`cell ${i} is taken`);
  const cells = b.cells.slice();
  cells[i] = p;
  return { n: b.n, cells };
}
function swap(b) {
  const at2 = b.cells.findIndex((c2) => c2 !== 0);
  if (at2 < 0 || b.cells.filter((c2) => c2 !== 0).length !== 1)
    throw new Error("swap only after one stone");
  const r = Math.floor(at2 / b.n);
  const c = at2 % b.n;
  const cells = Array(b.n * b.n).fill(0);
  cells[c * b.n + r] = 2;
  return { n: b.n, cells };
}
function wantsSwap(b) {
  const at2 = b.cells.findIndex((c2) => c2);
  const r = Math.floor(at2 / b.n);
  const c = at2 % b.n;
  const mid = (b.n - 1) / 2;
  return Math.abs(r - mid) + Math.abs(c - mid) <= b.n / 3;
}
const LEVELS$9 = ["easy", "fair", "hard"];
const PLAYOUTS$1 = { easy: 60, fair: 300, hard: 2e4 };
function winningMove(b, p) {
  const cells = b.cells.slice();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) continue;
    cells[i] = p;
    const won2 = chain(cells, b.n, p);
    cells[i] = 0;
    if (won2) return i;
  }
  return null;
}
function bridgeSaves(b, p) {
  const near2 = neighbours(b.n);
  const out = /* @__PURE__ */ new Set();
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i] !== p) continue;
    for (const a of near2[i])
      for (const j of near2[a]) {
        if (j <= i || b.cells[j] !== p || near2[i].includes(j)) continue;
        const common = near2[i].filter((k) => near2[j].includes(k));
        if (common.length !== 2) continue;
        const [x, y] = common;
        if (b.cells[x] === other$5(p) && b.cells[y] === 0) out.add(y);
        if (b.cells[y] === other$5(p) && b.cells[x] === 0) out.add(x);
      }
  }
  return [...out];
}
const node = (move, by, untried) => ({
  move,
  by,
  children: [],
  untried,
  n: 0,
  w: 0,
  an: 0,
  aw: 0
});
function search$4(b, p, iterations, rand) {
  const free = [];
  b.cells.forEach((c, i) => {
    if (!c) free.push(i);
  });
  const root = node(-1, other$5(p), free.slice());
  const cells = new Uint8Array(b.cells.length);
  const K = 600;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < cells.length; i++) cells[i] = b.cells[i];
    let at2 = root;
    let toMove = p;
    const path2 = [root];
    while (!at2.untried.length && at2.children.length) {
      let best2 = at2.children[0];
      let bv = -Infinity;
      const logN = Math.log(at2.n + 1);
      for (const c of at2.children) {
        const q = c.n ? c.w / c.n : 0.5;
        const amaf = c.an ? c.aw / c.an : 0.5;
        const beta = Math.sqrt(K / (3 * c.n + K));
        const v = beta * amaf + (1 - beta) * q + 0.25 * Math.sqrt(logN / (c.n + 1));
        if (v > bv) {
          bv = v;
          best2 = c;
        }
      }
      at2 = best2;
      cells[at2.move] = at2.by;
      toMove = other$5(toMove);
      path2.push(at2);
    }
    if (at2.untried.length) {
      const k = Math.floor(rand() * at2.untried.length);
      const move = at2.untried[k];
      at2.untried[k] = at2.untried[at2.untried.length - 1];
      at2.untried.pop();
      const fresh2 = node(
        move,
        toMove,
        free.filter((i) => cells[i] === 0 && i !== move)
      );
      at2.children.push(fresh2);
      at2 = fresh2;
      cells[move] = toMove;
      toMove = other$5(toMove);
      path2.push(at2);
    }
    const left2 = [];
    for (let i = 0; i < cells.length; i++) if (!cells[i]) left2.push(i);
    for (let i = left2.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = left2[i];
      left2[i] = left2[j];
      left2[j] = t;
    }
    for (let i = 0; i < left2.length; i++) cells[left2[i]] = i % 2 === 0 ? toMove : other$5(toMove);
    const redWon = chain(cells, b.n, 1) !== null;
    for (const nd of path2) {
      nd.n++;
      if (nd.by === 1 === redWon) nd.w++;
      for (const c of nd.children)
        if (cells[c.move] === c.by) {
          c.an++;
          if (c.by === 1 === redWon) c.aw++;
        }
    }
  }
  let best = root.children[0];
  for (const c of root.children) if (c.n > best.n) best = c;
  return best.move;
}
function choose$7(b, p, level, rand = Math.random) {
  const free = [];
  b.cells.forEach((c, i) => {
    if (!c) free.push(i);
  });
  if (free.length === 1) return free[0];
  const now = winningMove(b, p);
  if (now !== null) return now;
  const threat = winningMove(b, other$5(p));
  if (threat !== null && level !== "easy") return threat;
  if (level === "hard") {
    const saves = bridgeSaves(b, p);
    if (saves.length === 1) return saves[0];
    return search$4(b, p, PLAYOUTS$1.hard, rand);
  }
  const wins = new Float64Array(b.cells.length);
  const plays = new Float64Array(b.cells.length);
  const cells = new Uint8Array(b.cells.length);
  const order2 = free.slice();
  const mine = Math.ceil(free.length / 2);
  for (let k = 0; k < PLAYOUTS$1[level]; k++) {
    for (let i = 0; i < cells.length; i++) cells[i] = b.cells[i];
    for (let i = order2.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order2[i];
      order2[i] = order2[j];
      order2[j] = t;
    }
    for (let i = 0; i < order2.length; i++) cells[order2[i]] = i < mine ? p : other$5(p);
    const won2 = chain(cells, b.n, p) !== null;
    for (let i = 0; i < mine; i++) {
      plays[order2[i]]++;
      if (won2) wins[order2[i]]++;
    }
  }
  let best = free[0];
  let bv = -1;
  for (const i of free) {
    const v = plays[i] ? wins[i] / plays[i] : 0;
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}
const SWAP = -1;
const fresh$8 = (n, swapRule) => ({
  b: empty(n),
  turn: 1,
  swapRule,
  moves: [],
  last: null
});
const canSwap = (g) => g.swapRule && g.moves.length === 1 && g.turn === 2;
function isLegal(g, m) {
  if (g.turn === null || !Number.isInteger(m)) return false;
  if (m === SWAP) return canSwap(g);
  return m >= 0 && m < g.b.cells.length && g.b.cells[m] === 0;
}
function after$4(g, m) {
  const p = g.turn;
  const b = m === SWAP ? swap(g.b) : place$1(g.b, m, p);
  const last = m === SWAP ? b.cells.findIndex((c) => c) : m;
  return { ...g, b, turn: winner$1(b) ? null : other$5(p), moves: [...g.moves, m], last };
}
function replay$8(n, swapRule, moves2) {
  if (moves2.length > n * n + 1) return null;
  let g = fresh$8(n, swapRule);
  for (const m of moves2) {
    if (!isLegal(g, m)) return null;
    g = after$4(g, m);
  }
  return g;
}
function readHexSettings(s) {
  const size = s.size ?? 9;
  const swap2 = s.swap ?? false;
  if (!SIZES$2.includes(size) || typeof swap2 !== "boolean") return null;
  return [size, swap2];
}
function hexRules(size, swapRule) {
  return {
    fresh: () => fresh$8(size, swapRule),
    turn: (g) => g.turn === null ? null : g.turn === 1 ? 0 : 1,
    legal: (g, m, by) => (by === void 0 || by === (g.turn ?? 0) - 1) && isLegal(g, m),
    apply: (g, m) => after$4(g, m),
    encode: (g) => ({ n: g.b.n, swap: g.swapRule, moves: g.moves }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$2.includes(o.n)) return null;
      if (typeof o.swap !== "boolean" || !Array.isArray(o.moves)) return null;
      return replay$8(o.n, o.swap, o.moves);
    },
    readMove: (x) => Number.isInteger(x) && x >= SWAP && x < 121 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$9,
      choose: (g, level) => canSwap(g) && wantsSwap(g.b) ? SWAP : choose$7(g.b, 2, level)
    },
    result: (g) => {
      const w = winner$1(g.b);
      return w === null ? null : w === 1 ? 0 : 1;
    },
    begun: (g) => g.moves.length > 0
  };
}
const other$4 = (w) => w === 1 ? 2 : 1;
const LINES$1 = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];
const newGame$6 = () => ({
  cells: Array(81).fill(0),
  boards: Array(9).fill(0),
  next: -1,
  turn: 1,
  winner: 0,
  last: -1
});
function lineOf(get, who) {
  return LINES$1.some(([a, b, c]) => get(a) === who && get(b) === who && get(c) === who);
}
function moves$2(g) {
  if (g.winner) return [];
  const out = [];
  for (let b = 0; b < 9; b++) {
    if (g.boards[b] || g.next >= 0 && g.next !== b) continue;
    for (let s = 0; s < 9; s++) if (!g.cells[b * 9 + s]) out.push(b * 9 + s);
  }
  return out;
}
function play$5(g, at2) {
  const b = Math.floor(at2 / 9);
  const s = at2 % 9;
  if (g.winner || g.cells[at2] || g.boards[b] || g.next >= 0 && g.next !== b)
    throw new Error(`${at2} is not a move now`);
  const cells = g.cells.slice();
  cells[at2] = g.turn;
  const boards = g.boards.slice();
  if (lineOf((k) => cells[b * 9 + k], g.turn)) boards[b] = g.turn;
  else if ([...Array(9).keys()].every((k) => cells[b * 9 + k])) boards[b] = 3;
  let winner2 = 0;
  if (lineOf((k) => boards[k], g.turn)) winner2 = g.turn;
  else if (boards.every((x) => x)) winner2 = 3;
  return { cells, boards, next: boards[s] ? -1 : s, turn: other$4(g.turn), winner: winner2, last: at2 };
}
const LEVELS$8 = ["easy", "fair", "hard"];
const ITERATIONS = { easy: 0, fair: 1500, hard: 12e3 };
function randomFinish(g, rand) {
  let h = g;
  while (!h.winner) {
    const list = moves$2(h);
    h = play$5(h, list[Math.floor(rand() * list.length)]);
  }
  return h.winner;
}
function choose$6(g, level, rand = Math.random) {
  const list = moves$2(g);
  if (list.length === 1) return list[0];
  for (const m of list) if (play$5(g, m).winner === g.turn) return m;
  if (level === "easy") {
    const take = list.filter((m) => play$5(g, m).boards[Math.floor(m / 9)] === g.turn);
    const pool = take.length && rand() < 0.7 ? take : list;
    return pool[Math.floor(rand() * pool.length)];
  }
  const root = { move: -1, who: other$4(g.turn), kids: [], untried: list.slice(), n: 0, w: 0 };
  for (let it = 0; it < ITERATIONS[level]; it++) {
    let node2 = root;
    let state = g;
    const path2 = [root];
    while (!node2.untried.length && node2.kids.length) {
      const logN = Math.log(node2.n);
      let best2 = node2.kids[0];
      let bv = -Infinity;
      for (const k of node2.kids) {
        const v = k.w / k.n + 1.2 * Math.sqrt(logN / k.n);
        if (v > bv) {
          bv = v;
          best2 = k;
        }
      }
      node2 = best2;
      state = play$5(state, node2.move);
      path2.push(node2);
    }
    if (node2.untried.length) {
      const i = Math.floor(rand() * node2.untried.length);
      const m = node2.untried[i];
      node2.untried[i] = node2.untried[node2.untried.length - 1];
      node2.untried.pop();
      const who = state.turn;
      state = play$5(state, m);
      const kid = { move: m, who, kids: [], untried: moves$2(state), n: 0, w: 0 };
      node2.kids.push(kid);
      node2 = kid;
      path2.push(node2);
    }
    const result = state.winner || randomFinish(state, rand);
    for (const nd of path2) {
      nd.n++;
      nd.w += result === 3 ? 0.5 : result === nd.who ? 1 : 0;
    }
  }
  let best = root.kids[0];
  for (const k of root.kids) if (k.n > best.n) best = k;
  return best.move;
}
const fresh$7 = () => ({ g: newGame$6(), list: [] });
function replay$7(list) {
  if (list.length > 81) return null;
  let d = fresh$7();
  for (const at2 of list) {
    if (!Number.isInteger(at2) || !moves$2(d.g).includes(at2)) return null;
    d = { g: play$5(d.g, at2), list: [...d.list, at2] };
  }
  return d;
}
const ultimateRules = {
  fresh: fresh$7,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, at2, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && Number.isInteger(at2) && moves$2(d.g).includes(at2),
  apply: (d, at2) => ({ g: play$5(d.g, at2), list: [...d.list, at2] }),
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$7(list) : null;
  },
  readMove: (x) => Number.isInteger(x) && x >= 0 && x < 81 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$8, choose: (d, level) => choose$6(d.g, level) },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const SIZES$1 = [6, 8];
const other$3 = (s) => s === 1 ? 2 : 1;
const forward = (s) => s === 1 ? -1 : 1;
const advance = (n, i, s) => {
  const r = Math.floor(i / n);
  return s === 1 ? n - 1 - r : r;
};
function newGame$5(n = 8, first = 1) {
  const cells = new Int8Array(n * n);
  for (let i = 0; i < 2 * n; i++) {
    cells[i] = 2;
    cells[n * n - 1 - i] = 1;
  }
  return { board: { n, cells }, turn: first, winner: 0, plies: 0 };
}
function movesOf$1(b, s) {
  const { n, cells } = b;
  const out = [];
  const f = forward(s);
  const them = other$3(s);
  for (let i = 0; i < n * n; i++) {
    if (cells[i] !== s) continue;
    const r = Math.floor(i / n) + f;
    if (r < 0 || r >= n) continue;
    const c = i % n;
    for (const dc of [-1, 0, 1]) {
      const cc = c + dc;
      if (cc < 0 || cc >= n) continue;
      const to = r * n + cc;
      const there = cells[to];
      if (there === 0) out.push({ from: i, to, take: false });
      else if (dc !== 0 && there === them) out.push({ from: i, to, take: true });
    }
  }
  return out;
}
const moves$1 = (g) => g.winner ? [] : movesOf$1(g.board, g.turn);
const count = (b, s) => b.cells.reduce((t, x) => t + (x === s ? 1 : 0), 0);
function play$4(g, m) {
  const cells = g.board.cells.slice();
  const s = g.turn;
  cells[m.to] = s;
  cells[m.from] = 0;
  const board2 = { n: g.board.n, cells };
  const them = other$3(s);
  const through = advance(board2.n, m.to, s) === board2.n - 1;
  const winner2 = through || count(board2, them) === 0 ? s : 0;
  return { board: board2, turn: them, winner: winner2, plies: g.plies + 1 };
}
const LEVELS$7 = ["easy", "fair", "hard"];
const WIN = 1e6;
function covers(b, i, s) {
  const { n, cells } = b;
  const r = Math.floor(i / n) - forward(s);
  if (r < 0 || r >= n) return false;
  const c = i % n;
  return c > 0 && cells[r * n + c - 1] === s || c < n - 1 && cells[r * n + c + 1] === s;
}
function value$3(b, s) {
  const { n, cells } = b;
  const them = other$3(s);
  let v = 0;
  let threat = 0;
  for (let i = 0; i < n * n; i++) {
    const p = cells[i];
    if (!p) continue;
    const side = p;
    const a = advance(n, i, side);
    if (side === s && a === n - 2) return WIN / 2;
    let x = 100 + a * a * 3;
    const safe2 = covers(b, i, side);
    if (safe2) x += 10;
    if (covers(b, i, side === s ? them : s) && !safe2) x -= side === s ? 20 : 45;
    if (a === 0) x += 6;
    if (side === them && a === n - 2) threat++;
    v += side === s ? x : -x;
  }
  if (threat) {
    let stopped = 0;
    for (let i = 0; i < n * n; i++)
      if (cells[i] === them && advance(n, i, them) === n - 2 && covers(b, i, s)) stopped++;
    if (stopped < threat || threat > 1) return -WIN / 2;
  }
  return v;
}
const DEPTH$2 = { easy: 1, fair: 3, hard: 4 };
const HARD_BUDGET = 2e5;
const CALLED_OFF = new Error("called off");
let budget = Infinity;
const EASY_NOISE = 60;
function order$1(list, b, s) {
  const n = b.n;
  const key = (m) => (m.take ? 1e3 : 0) + advance(n, m.to, s);
  return list.sort((x, y) => key(y) - key(x));
}
let nodes = 0;
function search$3(b, s, depth, alpha, beta, ply) {
  if (++nodes > budget) throw CALLED_OFF;
  if (depth <= 0) return value$3(b, s);
  const list = movesOf$1(b, s);
  if (!list.length) return -WIN + ply;
  const n = b.n;
  const them = other$3(s);
  const cells = b.cells;
  let best = -Infinity;
  for (const m of order$1(list, b, s)) {
    if (advance(n, m.to, s) === n - 1) return WIN - ply;
    const was = cells[m.to];
    cells[m.to] = s;
    cells[m.from] = 0;
    const gone = was === them && count(b, them) === 0;
    const v = gone ? WIN - ply : -search$3(b, them, depth - 1, -beta, -alpha, ply + 1);
    cells[m.from] = s;
    cells[m.to] = was;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function rootValues(g, depth, limit2) {
  const b = { n: g.board.n, cells: g.board.cells.slice() };
  const s = g.turn;
  const them = other$3(s);
  nodes = 0;
  budget = limit2;
  const out = [];
  try {
    for (const m of order$1(moves$1(g), b, s)) {
      let v;
      if (advance(b.n, m.to, s) === b.n - 1) v = WIN;
      else {
        const was = b.cells[m.to];
        b.cells[m.to] = s;
        b.cells[m.from] = 0;
        v = was === them && count(b, them) === 0 ? WIN : -search$3(b, them, depth - 1, -Infinity, Infinity, 1);
        b.cells[m.from] = s;
        b.cells[m.to] = was;
      }
      out.push({ m, v });
    }
  } catch (e) {
    if (e === CALLED_OFF) return null;
    throw e;
  } finally {
    budget = Infinity;
  }
  return out;
}
function choose$5(g, level, rand = Math.random) {
  const list = moves$1(g);
  if (list.length === 1) return list[0];
  let scored = rootValues(g, DEPTH$2[level], Infinity);
  if (level === "hard") scored = rootValues(g, 5, HARD_BUDGET) ?? scored;
  let best = [];
  let bv = -Infinity;
  for (const { m, v: raw } of scored) {
    const v = level === "easy" && Math.abs(raw) < WIN / 4 ? raw + (rand() * 2 - 1) * EASY_NOISE : raw;
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const fresh$6 = (n) => ({ g: newGame$5(n, 1), list: [], last: null });
const find$2 = (g, from, to) => moves$1(g).find((m) => m.from === from && m.to === to) ?? null;
function after$3(d, m) {
  return { g: play$4(d.g, m), list: [...d.list, [m.from, m.to]], last: m };
}
function replay$6(n, list) {
  if (list.length > n * n * n) return null;
  let d = fresh$6(n);
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 ? find$2(d.g, x[0], x[1]) : null;
    if (!m) return null;
    d = after$3(d, m);
  }
  return d;
}
function readMove$3(x) {
  const o = x;
  const [from, to] = Array.isArray(o) ? o : o && typeof o === "object" ? [o.from, o.to] : [];
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < 64 && to < 64 ? { from, to, take: false } : null;
}
function readBreakthroughSize(s) {
  const size = s.size ?? 8;
  return SIZES$1.includes(size) ? size : null;
}
function breakthroughRules(size) {
  return {
    fresh: () => fresh$6(size),
    turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
    legal: (d, m, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && find$2(d.g, m.from, m.to) !== null,
    apply: (d, m) => {
      const real = find$2(d.g, m.from, m.to);
      return real ? after$3(d, real) : d;
    },
    encode: (d) => ({ n: d.g.board.n, moves: d.list }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$1.includes(o.n) || !Array.isArray(o.moves)) return null;
      return replay$6(o.n, o.moves);
    },
    readMove: readMove$3,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$7, choose: (d, level) => choose$5(d.g, level) },
    result: (d) => !d.g.winner ? null : d.g.winner === 1 ? 0 : 1,
    begun: (d) => d.list.length > 0
  };
}
const SIZES = [7, 9];
const FENCES = { 7: 7, 9: 10 };
const goalRow = (g, w) => w === 0 ? 0 : g.n - 1;
function newGame$4(n = 9, first = 0) {
  const mid = n >> 1;
  return {
    n,
    pos: [
      [n - 1, mid],
      [0, mid]
    ],
    left: [FENCES[n], FENCES[n]],
    h: new Uint8Array((n - 1) * (n - 1)),
    v: new Uint8Array((n - 1) * (n - 1)),
    turn: first,
    winner: null,
    plies: 0
  };
}
const inside$1 = (g, r, c) => r >= 0 && c >= 0 && r < g.n && c < g.n;
const slot = (g, r, c) => r * (g.n - 1) + c;
const hAt = (g, r, c) => r >= 0 && c >= 0 && r < g.n - 1 && c < g.n - 1 && g.h[slot(g, r, c)] === 1;
const vAt = (g, r, c) => r >= 0 && c >= 0 && r < g.n - 1 && c < g.n - 1 && g.v[slot(g, r, c)] === 1;
function open(g, r, c, dr, dc) {
  const nr = r + dr;
  const nc = c + dc;
  if (!inside$1(g, nr, nc)) return false;
  if (dr === 1) return !hAt(g, r, c) && !hAt(g, r, c - 1);
  if (dr === -1) return !hAt(g, nr, c) && !hAt(g, nr, c - 1);
  if (dc === 1) return !vAt(g, r, c) && !vAt(g, r - 1, c);
  return !vAt(g, r, nc) && !vAt(g, r - 1, nc);
}
const DIRS$1 = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];
function steps(g, w = g.turn) {
  const [r, c] = g.pos[w];
  const [or, oc] = g.pos[w === 0 ? 1 : 0];
  const out = [];
  for (const [dr, dc] of DIRS$1) {
    if (!open(g, r, c, dr, dc)) continue;
    const nr = r + dr;
    const nc = c + dc;
    if (nr !== or || nc !== oc) {
      out.push([nr, nc]);
      continue;
    }
    if (open(g, nr, nc, dr, dc)) {
      out.push([nr + dr, nc + dc]);
      continue;
    }
    for (const [sr, sc] of dr ? [
      [0, -1],
      [0, 1]
    ] : [
      [-1, 0],
      [1, 0]
    ])
      if (open(g, nr, nc, sr, sc)) out.push([nr + sr, nc + sc]);
  }
  return out;
}
function dist(g, w) {
  return distFrom(g, g.pos[w], goalRow(g, w));
}
function distFrom(g, from, goal) {
  const n = g.n;
  if (from[0] === goal) return 0;
  const seen = new Int8Array(n * n);
  let frontier = [from[0] * n + from[1]];
  seen[frontier[0]] = 1;
  for (let d = 1; frontier.length; d++) {
    const next2 = [];
    for (const k of frontier) {
      const r = k / n | 0;
      const c = k % n;
      for (const [dr, dc] of DIRS$1) {
        if (!open(g, r, c, dr, dc)) continue;
        const nk = (r + dr) * n + c + dc;
        if (seen[nk]) continue;
        if (r + dr === goal) return d;
        seen[nk] = 1;
        next2.push(nk);
      }
    }
    frontier = next2;
  }
  return Infinity;
}
function path(g, w) {
  const n = g.n;
  const goal = goalRow(g, w);
  const [r0, c0] = g.pos[w];
  if (r0 === goal) return [];
  const from = new Int16Array(n * n).fill(-1);
  const start2 = r0 * n + c0;
  from[start2] = start2;
  let frontier = [start2];
  while (frontier.length) {
    const next2 = [];
    for (const k of frontier) {
      const r = k / n | 0;
      const c = k % n;
      for (const [dr, dc] of DIRS$1) {
        if (!open(g, r, c, dr, dc)) continue;
        const nk = (r + dr) * n + c + dc;
        if (from[nk] >= 0) continue;
        from[nk] = k;
        if (r + dr === goal) {
          const out = [];
          for (let x = nk; x !== start2; x = from[x]) out.unshift([x / n | 0, x % n]);
          return out;
        }
        next2.push(nk);
      }
    }
    frontier = next2;
  }
  return [];
}
function fenceTrouble(g, o, r, c, w = g.turn) {
  if (g.winner !== null) return "over";
  if (g.left[w] <= 0) return "spent";
  if (r < 0 || c < 0 || r >= g.n - 1 || c >= g.n - 1) return "off";
  if (hAt(g, r, c) || vAt(g, r, c)) return "cross";
  if (o === "h" ? hAt(g, r, c - 1) || hAt(g, r, c + 1) : vAt(g, r - 1, c) || vAt(g, r + 1, c))
    return "overlap";
  const t = withFence(g, o, r, c);
  return dist(t, 0) < Infinity && dist(t, 1) < Infinity ? null : "shut";
}
const fenceOk = (g, o, r, c, w = g.turn) => fenceTrouble(g, o, r, c, w) === null;
function withFence(g, o, r, c) {
  const h = o === "h" ? g.h.slice() : g.h;
  const v = o === "v" ? g.v.slice() : g.v;
  (o === "h" ? h : v)[slot(g, r, c)] = 1;
  return { ...g, h, v };
}
function play$3(g, m) {
  if (g.winner !== null) return g;
  const w = g.turn;
  const other2 = w === 0 ? 1 : 0;
  if (m.kind === "step") {
    if (!steps(g, w).some(([r, c]) => r === m.to[0] && c === m.to[1])) return g;
    const pos = w === 0 ? [m.to, g.pos[1]] : [g.pos[0], m.to];
    const won2 = m.to[0] === goalRow(g, w);
    return { ...g, pos, turn: other2, winner: won2 ? w : null, plies: g.plies + 1 };
  }
  if (!fenceOk(g, m.o, m.r, m.c, w)) return g;
  const t = withFence(g, m.o, m.r, m.c);
  const left2 = w === 0 ? [g.left[0] - 1, g.left[1]] : [g.left[0], g.left[1] - 1];
  return { ...t, left: left2, turn: other2, plies: g.plies + 1 };
}
const LEVELS$6 = ["easy", "fair", "hard"];
function judge(g, w, keep = 0.35) {
  if (g.winner !== null) return g.winner === w ? 1e3 - g.plies : -1e3 + g.plies;
  const other2 = w === 0 ? 1 : 0;
  const mine = dist(g, w);
  const theirs = dist(g, other2);
  const tempo = g.turn === w ? 0.5 : -0.5;
  return theirs - mine + tempo + keep * (g.left[w] - g.left[other2]);
}
function fenceIdeas(g, against, reach = 4) {
  const way = [g.pos[against], ...path(g, against).slice(0, reach)];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add = (o, r, c) => {
    const k = `${o}${r},${c}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (fenceOk(g, o, r, c)) out.push({ kind: "fence", o, r, c });
  };
  for (let i = 0; i + 1 < way.length; i++) {
    const [r, c] = way[i];
    const [nr, nc] = way[i + 1];
    if (nr !== r) {
      const gr = Math.min(r, nr);
      add("h", gr, c);
      add("h", gr, c - 1);
    } else {
      const gc = Math.min(c, nc);
      add("v", r, gc);
      add("v", r - 1, gc);
    }
  }
  return out;
}
function options(g, reach) {
  const out = steps(g).map((to) => ({ kind: "step", to }));
  if (g.left[g.turn] > 0) out.push(...fenceIdeas(g, g.turn === 0 ? 1 : 0, reach));
  return out;
}
function search$2(g, depth, alpha, beta, me, reach, keep) {
  if (depth === 0 || g.winner !== null) return judge(g, me, keep);
  const mine = g.turn === me;
  const opts = options(g, reach);
  let best = mine ? -Infinity : Infinity;
  for (const m of opts) {
    const v = search$2(play$3(g, m), depth - 1, alpha, beta, me, reach, keep);
    if (mine) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}
const TUNING = {
  fair: [2, 1.2, 3, 0.35],
  hard: [3, 0.01, 3, 1.5]
};
function choose$4(g, level, rand = Math.random) {
  const me = g.turn;
  const other2 = me === 0 ? 1 : 0;
  const walk = () => {
    const way = path(g, me);
    const ok = steps(g);
    const want = ok.find(([r, c]) => way.some(([wr, wc]) => wr === r && wc === c));
    if (want) return { kind: "step", to: want };
    let best2 = ok[0];
    let bd = Infinity;
    for (const s of ok) {
      const d = distFrom(g, s, goalRow(g, me));
      if (d < bd) {
        bd = d;
        best2 = s;
      }
    }
    return { kind: "step", to: best2 };
  };
  const goal = steps(g).find(([r]) => r === goalRow(g, me));
  if (goal) return { kind: "step", to: goal };
  if (level === "easy") {
    if (g.left[me] > 0 && rand() < 0.25) {
      const ideas = fenceIdeas(g, other2, 6);
      if (ideas.length) return ideas[Math.floor(rand() * ideas.length)];
    }
    return walk();
  }
  const [reach, slack, depth, keep] = TUNING[level];
  let best = walk();
  let bv = -Infinity;
  const opts = [best, ...options(g, reach + 2)];
  for (const m of opts) {
    const v = search$2(play$3(g, m), depth - 1, -Infinity, Infinity, me, reach, keep) + rand() * slack;
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return best;
}
const MAX_MOVES$1 = 600;
const fresh$5 = (n) => ({ g: newGame$4(n, 0), list: [], last: null });
function isMove(g, m) {
  if (g.winner !== null) return false;
  if (m.kind === "step") return steps(g).some(([r, c]) => r === m.to[0] && c === m.to[1]);
  return fenceOk(g, m.o, m.r, m.c);
}
const packMove = (m) => m.kind === "step" ? ["s", m.to[0], m.to[1]] : [m.o, m.r, m.c];
function readMove$2(x) {
  const o = Array.isArray(x) ? x : x && typeof x === "object" ? packMove(x) : null;
  if (!o || o.length !== 3) return null;
  const [k, r, c] = o;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 8 || c > 8)
    return null;
  if (k === "s") return { kind: "step", to: [r, c] };
  if (k === "h" || k === "v") return { kind: "fence", o: k, r, c };
  return null;
}
function replay$5(n, list) {
  if (list.length > MAX_MOVES$1) return null;
  let d = fresh$5(n);
  for (const x of list) {
    const m = readMove$2(x);
    if (!m || !isMove(d.g, m)) return null;
    d = { g: play$3(d.g, m), list: [...d.list, m], last: m };
  }
  return d;
}
function readFencesSize(s) {
  const size = s.size ?? 9;
  return SIZES.includes(size) ? size : null;
}
function fencesRules(size) {
  return {
    fresh: () => fresh$5(size),
    turn: (d) => d.g.winner !== null ? null : d.g.turn,
    legal: (d, m, by) => (by === void 0 || by === d.g.turn) && d.list.length < MAX_MOVES$1 && isMove(d.g, m),
    apply: (d, m) => ({ g: play$3(d.g, m), list: [...d.list, m], last: m }),
    encode: (d) => ({ n: d.g.n, moves: d.list.map(packMove) }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES.includes(o.n) || !Array.isArray(o.moves)) return null;
      return replay$5(o.n, o.moves);
    },
    readMove: readMove$2,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$6, choose: (d, level) => choose$4(d.g, level) },
    result: (d) => d.g.winner === null ? null : d.g.winner,
    begun: (d) => d.list.length > 0
  };
}
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1]
];
const HOLES = (() => {
  const out = [];
  for (let r = -8; r <= 8; r++)
    for (let q = -8; q <= 8; q++) {
      const s = -q - r;
      const up = q >= -4 && r >= -4 && s >= -4;
      const down = q <= 4 && r <= 4 && s <= 4;
      if (up || down) out.push({ q, r, s });
    }
  return out;
})();
const index = new Map(HOLES.map((h, i) => [`${h.q},${h.r}`, i]));
const at = (q, r) => index.get(`${q},${r}`) ?? -1;
const NEAR = HOLES.map((h) => DIRS.map(([dq, dr]) => at(h.q + dq, h.r + dr)));
const HOME = {
  1: HOLES.map((h, i) => h.r >= 5 ? i : -1).filter((i) => i >= 0),
  2: HOLES.map((h, i) => h.r <= -5 ? i : -1).filter((i) => i >= 0)
};
const goalOf = (s) => HOME[s === 1 ? 2 : 1];
const other$2 = (s) => s === 1 ? 2 : 1;
function newGame$3(first = 1) {
  const cells = new Int8Array(HOLES.length);
  for (const i of HOME[1]) cells[i] = 1;
  for (const i of HOME[2]) cells[i] = 2;
  return { cells, turn: first, winner: 0, plies: 0 };
}
function movesFrom(cells, from) {
  const out = [];
  for (const n of NEAR[from]) if (n >= 0 && !cells[n]) out.push({ from, to: n, path: [from, n] });
  const seen = /* @__PURE__ */ new Set([from]);
  let frontier = [[from]];
  while (frontier.length) {
    const next2 = [];
    for (const path2 of frontier) {
      const here = path2[path2.length - 1];
      for (let d = 0; d < 6; d++) {
        const over2 = NEAR[here][d];
        if (over2 < 0 || !cells[over2] || over2 === from) continue;
        const land = NEAR[over2][d];
        if (land < 0 || cells[land] && land !== from || seen.has(land) || land === from) continue;
        seen.add(land);
        const p = [...path2, land];
        out.push({ from, to: land, path: p });
        next2.push(p);
      }
    }
    frontier = next2;
  }
  return out;
}
function movesOf(cells, side) {
  const out = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === side) out.push(...movesFrom(cells, i));
  return out;
}
const moves = (g) => g.winner ? [] : movesOf(g.cells, g.turn);
function won(cells, side) {
  const goal = goalOf(side);
  return goal.every((i) => cells[i]) && goal.some((i) => cells[i] === side);
}
const DRAW_AFTER = 400;
function play$2(g, m) {
  const cells = g.cells.slice();
  cells[m.to] = g.turn;
  cells[m.from] = 0;
  const winner2 = won(cells, g.turn) ? g.turn : 0;
  return { cells, turn: other$2(g.turn), winner: winner2, plies: g.plies + 1 };
}
const progress = (i, s) => s === 1 ? 8 - HOLES[i].r : HOLES[i].r + 8;
const wide = (i) => Math.abs(HOLES[i].q - HOLES[i].s);
const LEVELS$5 = ["easy", "fair", "hard"];
function value$2(cells, side) {
  const sum = (s) => {
    let t = 0;
    for (let i = 0; i < cells.length; i++)
      if (cells[i] === s) t += (goalOf(s).includes(i) ? 18 : progress(i, s)) * 10 - wide(i);
    return t;
  };
  if (won(cells, side)) return 1e6;
  if (won(cells, other$2(side))) return -1e6;
  return sum(side) - sum(other$2(side));
}
const gain = (m, s) => progress(m.to, s) - progress(m.from, s);
function choose$3(g, level, rand = Math.random) {
  const s = g.turn;
  const list = moves(g);
  const apply = (cells, m, who) => {
    const c = cells.slice();
    c[m.to] = who;
    c[m.from] = 0;
    return c;
  };
  const shortlist = (cells, who, k) => {
    const ms = movesOf(cells, who);
    ms.sort((a, b) => gain(b, who) - gain(a, who) || wide(a.to) - wide(b.to));
    return ms.slice(0, k);
  };
  if (level === "easy") {
    const ranked = list.map((m) => ({ m, v: value$2(apply(g.cells, m, s), s) })).sort((x, y) => y.v - x.v);
    return ranked[Math.floor(rand() * Math.min(4, ranked.length))].m;
  }
  let best = [];
  let bv = -Infinity;
  for (const m of shortlist(g.cells, s, level === "hard" ? 14 : 40)) {
    const c1 = apply(g.cells, m, s);
    let v;
    if (won(c1, s)) v = 1e6;
    else if (level === "fair") v = value$2(c1, s);
    else {
      let worst = Infinity;
      for (const r of shortlist(c1, other$2(s), 8)) {
        const c2 = apply(c1, r, other$2(s));
        let after2 = -Infinity;
        for (const m2 of shortlist(c2, s, 8)) after2 = Math.max(after2, value$2(apply(c2, m2, s), s));
        worst = Math.min(worst, after2 === -Infinity ? value$2(c2, s) : after2);
      }
      v = worst;
    }
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const fresh$4 = () => ({ g: newGame$3(1), list: [], last: null });
const over$3 = (d) => d.g.winner !== 0 || d.list.length >= DRAW_AFTER;
const find$1 = (g, from, to) => moves(g).find((m) => m.from === from && m.to === to) ?? null;
const after$2 = (d, m) => ({
  g: play$2(d.g, m),
  list: [...d.list, [m.from, m.to]],
  last: m
});
function replay$4(list) {
  if (list.length > DRAW_AFTER) return null;
  let d = fresh$4();
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 && !over$3(d) ? find$1(d.g, x[0], x[1]) : null;
    if (!m) return null;
    d = after$2(d, m);
  }
  return d;
}
function readMove$1(x) {
  const o = x;
  const [from, to] = Array.isArray(o) ? o : o && typeof o === "object" ? [o.from, o.to] : [];
  const ok = (v) => Number.isInteger(v) && v >= 0 && v < HOLES.length;
  return ok(from) && ok(to) ? { from, to, path: [] } : null;
}
const halmaRules = {
  fresh: fresh$4,
  turn: (d) => over$3(d) ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, m, by) => !over$3(d) && (by === void 0 || by === d.g.turn - 1) && find$1(d.g, m.from, m.to) !== null,
  apply: (d, m) => {
    const real = find$1(d.g, m.from, m.to);
    return real ? after$2(d, real) : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$4(list) : null;
  },
  readMove: readMove$1,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$5, choose: (d, level) => choose$3(d.g, level) },
  result: (d) => !over$3(d) ? null : d.g.winner === 0 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const N$1 = 9;
const other$1 = (w) => w === 1 ? 2 : 1;
const KOMI = 6.5;
const PASS = -1;
const newGame$2 = () => ({
  board: Array(N$1 * N$1).fill(0),
  turn: 1,
  ko: -1,
  passes: 0,
  taken: [0, 0, 0],
  over: false,
  last: -2,
  moves: 0
});
const NEIGH = Array.from({ length: N$1 * N$1 }, (_, i) => {
  const r = Math.floor(i / N$1);
  const c = i % N$1;
  const out = [];
  if (r > 0) out.push(i - N$1);
  if (r < N$1 - 1) out.push(i + N$1);
  if (c > 0) out.push(i - 1);
  if (c < N$1 - 1) out.push(i + 1);
  return out;
});
function group(board2, i) {
  const colour = board2[i];
  const seen = /* @__PURE__ */ new Set([i]);
  const libs = /* @__PURE__ */ new Set();
  const todo = [i];
  while (todo.length) {
    const p = todo.pop();
    for (const q of NEIGH[p]) {
      if (board2[q] === 0) libs.add(q);
      else if (board2[q] === colour && !seen.has(q)) {
        seen.add(q);
        todo.push(q);
      }
    }
  }
  return { stones: [...seen], liberties: libs.size };
}
function play$1(g, at2) {
  if (g.over) return null;
  const w = g.turn;
  if (at2 === PASS) {
    const passes = g.passes + 1;
    return {
      ...g,
      turn: other$1(w),
      ko: -1,
      passes,
      over: passes >= 2,
      last: PASS,
      moves: g.moves + 1
    };
  }
  if (g.board[at2] !== 0 || at2 === g.ko) return null;
  const board2 = g.board.slice();
  board2[at2] = w;
  let caught = [];
  for (const q of NEIGH[at2])
    if (board2[q] === other$1(w)) {
      const gr = group(board2, q);
      if (gr.liberties === 0) {
        for (const s of gr.stones) board2[s] = 0;
        caught = caught.concat(gr.stones);
      }
    }
  if (group(board2, at2).liberties === 0) return null;
  const mine = group(board2, at2);
  const ko = caught.length === 1 && mine.stones.length === 1 && mine.liberties === 1 ? caught[0] : -1;
  const taken = [0, g.taken[1], g.taken[2]];
  taken[w] += caught.length;
  return { board: board2, turn: other$1(w), ko, passes: 0, taken, over: false, last: at2, moves: g.moves + 1 };
}
const legal = (g) => g.board.map((_, i) => i).filter((i) => play$1(g, i) !== null);
function score$1(board2) {
  const owner2 = board2.slice();
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < N$1 * N$1; i++) {
    if (board2[i] !== 0 || seen.has(i)) continue;
    const region = [];
    const touches = /* @__PURE__ */ new Set();
    const todo = [i];
    seen.add(i);
    while (todo.length) {
      const p = todo.pop();
      region.push(p);
      for (const q of NEIGH[p]) {
        if (board2[q] === 0) {
          if (!seen.has(q)) {
            seen.add(q);
            todo.push(q);
          }
        } else touches.add(board2[q]);
      }
    }
    if (touches.size === 1) for (const p of region) owner2[p] = [...touches][0];
  }
  const black = owner2.filter((x) => x === 1).length;
  const white2 = owner2.filter((x) => x === 2).length + KOMI;
  return { black, white: white2, owner: owner2 };
}
const winner = (g) => {
  const s = score$1(g.board);
  return s.black > s.white ? 1 : 2;
};
const LEVELS$4 = ["easy", "fair", "hard"];
const PLAYOUTS = { easy: 250, fair: 1200, hard: 2500 };
function eye(board2, i, w) {
  return NEIGH[i].every((q) => board2[q] === w);
}
const stamp = new Float64Array(N$1 * N$1);
const stack = new Int32Array(N$1 * N$1);
let gen = 0;
function breathes(board2, i) {
  gen++;
  const colour = board2[i];
  let top = 0;
  stack[top++] = i;
  stamp[i] = gen;
  while (top) {
    const p = stack[--top];
    for (const q of NEIGH[p]) {
      if (board2[q] === 0) return true;
      if (board2[q] === colour && stamp[q] !== gen) {
        stamp[q] = gen;
        stack[top++] = q;
      }
    }
  }
  return false;
}
function lastBreath(board2, i) {
  gen++;
  const colour = board2[i];
  let top = 0;
  let found = -1;
  stack[top++] = i;
  stamp[i] = gen;
  while (top) {
    const p = stack[--top];
    for (const q of NEIGH[p]) {
      if (board2[q] === 0) {
        if (found >= 0 && found !== q) return -1;
        found = q;
      } else if (board2[q] === colour && stamp[q] !== gen) {
        stamp[q] = gen;
        stack[top++] = q;
      }
    }
  }
  return found;
}
function lift(board2, i) {
  const colour = board2[i];
  let top = 0;
  stack[top++] = i;
  board2[i] = 0;
  while (top) {
    const p = stack[--top];
    for (const q of NEIGH[p])
      if (board2[q] === colour) {
        board2[q] = 0;
        stack[top++] = q;
      }
  }
}
function playout(start2, rand) {
  const board2 = Int8Array.from(start2.board);
  let turn = start2.turn;
  let passes = 0;
  const empties2 = new Int32Array(N$1 * N$1);
  let last = start2.last;
  for (let k = 0; k < 220 && passes < 2; k++) {
    let n = 0;
    if (last >= 0 && rand() < 0.9) {
      for (const q of [last, ...NEIGH[last]])
        if (board2[q] === other$1(turn)) {
          const lib = lastBreath(board2, q);
          if (lib >= 0) {
            empties2[n++] = lib;
            break;
          }
        }
    }
    if (!n) {
      for (let i = 0; i < N$1 * N$1; i++) if (board2[i] === 0 && !eye(board2, i, turn)) empties2[n++] = i;
    }
    let moved = false;
    while (n) {
      const j = Math.floor(rand() * n);
      const at2 = empties2[j];
      empties2[j] = empties2[--n];
      board2[at2] = turn;
      let caught = false;
      for (const q of NEIGH[at2])
        if (board2[q] === other$1(turn) && !breathes(board2, q)) {
          lift(board2, q);
          caught = true;
        }
      if (!caught && !breathes(board2, at2)) {
        board2[at2] = 0;
        continue;
      }
      moved = true;
      last = at2;
      break;
    }
    if (!moved) {
      last = -1;
    }
    passes = moved ? 0 : passes + 1;
    turn = other$1(turn);
  }
  let black = 0;
  let white2 = KOMI;
  for (let i = 0; i < N$1 * N$1; i++) {
    const x = board2[i] || (eye(board2, i, 1) ? 1 : eye(board2, i, 2) ? 2 : 0);
    if (x === 1) black++;
    else if (x === 2) white2++;
  }
  return black - white2;
}
function choose$2(g, level, rand = Math.random) {
  const me = g.turn;
  if (g.passes === 1 && winner(g) === me) return PASS;
  const options2 = legal(g).filter((i) => !eye(g.board, i, me));
  if (!options2.length) return PASS;
  const stats = options2.map((at2) => {
    const next2 = play$1(g, at2);
    const caught = next2.taken[me] - g.taken[me];
    const mine = group(next2.board, at2);
    const saves = NEIGH[at2].some((q) => g.board[q] === me && group(g.board, q).liberties === 1) && mine.liberties > 1;
    const bias = caught ? 0.03 * Math.min(5, caught) : saves ? 0.05 : mine.liberties === 1 ? -0.1 : 0;
    return { at: at2, next: next2, n: 0, wins: 0, bias };
  });
  const total = PLAYOUTS[level];
  for (let k = 0; k < total; k++) {
    let pick = stats[0];
    let bv = -Infinity;
    for (const s of stats) {
      const v = s.n === 0 ? Infinity : s.wins / s.n + s.bias + 0.7 * Math.sqrt(Math.log(k + 1) / s.n);
      if (v > bv) {
        bv = v;
        pick = s;
      }
    }
    pick.n++;
    const margin = playout(pick.next, rand) * (me === 1 ? 1 : -1);
    pick.wins += (margin > 0 ? 0.7 : 0) + 0.3 * (0.5 + 0.5 * Math.tanh(margin / 10));
  }
  const most = Math.max(...stats.map((x) => x.n));
  const best = stats.filter((x) => x.n >= most / 2).reduce((a, x) => x.wins / x.n + x.bias > a.wins / a.n + a.bias ? x : a);
  if (best.wins / Math.max(1, best.n) < 0.08 && g.moves > 30) return PASS;
  return best.at;
}
const MAX_MOVES = 400;
const fresh$3 = () => ({ g: newGame$2(), list: [] });
const over$2 = (d) => d.g.over || d.list.length >= MAX_MOVES;
function replay$3(list) {
  if (list.length > MAX_MOVES) return null;
  let d = fresh$3();
  for (const at2 of list) {
    if (over$2(d) || !Number.isInteger(at2) || at2 < PASS || at2 >= N$1 * N$1)
      return null;
    const g = play$1(d.g, at2);
    if (!g) return null;
    d = { g, list: [...d.list, at2] };
  }
  return d;
}
const goRules = {
  fresh: fresh$3,
  turn: (d) => over$2(d) ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, at2, by) => !over$2(d) && (by === void 0 || by === d.g.turn - 1) && Number.isInteger(at2) && at2 >= PASS && at2 < N$1 * N$1 && play$1(d.g, at2) !== null,
  apply: (d, at2) => {
    const g = play$1(d.g, at2);
    return g ? { g, list: [...d.list, at2] } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$3(list) : null;
  },
  readMove: (x) => Number.isInteger(x) && x >= PASS && x < N$1 * N$1 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$4, choose: (d, level) => choose$2(d.g, level) },
  result: (d) => !over$2(d) ? null : winner(d.g) === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const N = 7;
const onBoard = (r, c) => r >= 0 && c >= 0 && r < N && c < N && (r >= 2 && r <= 4 || c >= 2 && c <= 4);
const POINTS = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (onBoard(r, c)) POINTS.push(r * N + c);
function dirsAt(i) {
  const r = Math.floor(i / N);
  const c = i % N;
  const out = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0]
  ];
  if ((r + c) % 2 === 0) out.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  return out.filter(([dr, dc]) => onBoard(r + dr, c + dc));
}
const step = (i, dr, dc) => i + dr * N + dc;
const START_GEESE = POINTS.filter(
  (i) => Math.floor(i / N) <= 2 || Math.floor(i / N) === 3 && (i % N <= 1 || i % N >= 5)
);
const START_FOX = 3 * N + 3;
const TAKE_TO_WIN = 6;
const IDLE_LIMIT = 16;
const MAX_PLIES = 400;
const newGame$1 = () => ({
  geese: new Set(START_GEESE),
  fox: START_FOX,
  turn: "geese",
  taken: 0,
  plies: 0,
  idle: 0,
  winner: null,
  drawn: false,
  last: []
});
const over$1 = (g) => g.winner !== null || g.drawn;
function gooseMoves(g) {
  const out = [];
  for (const i of g.geese)
    for (const [dr, dc] of dirsAt(i)) {
      if (dr < 0) continue;
      const j = step(i, dr, dc);
      if (!g.geese.has(j) && j !== g.fox) out.push({ path: [i, j], takes: [] });
    }
  return out;
}
function foxMoves(g) {
  const out = [];
  for (const [dr, dc] of dirsAt(g.fox)) {
    const j = step(g.fox, dr, dc);
    if (!g.geese.has(j)) out.push({ path: [g.fox, j], takes: [] });
  }
  const jump = (at2, path2, takes2) => {
    for (const [dr, dc] of dirsAt(at2)) {
      const over2 = step(at2, dr, dc);
      if (!g.geese.has(over2) || takes2.includes(over2)) continue;
      if (!dirsAt(over2).some(([a, b]) => a === dr && b === dc)) continue;
      const land = step(over2, dr, dc);
      if (g.geese.has(land)) continue;
      const next2 = { path: [...path2, land], takes: [...takes2, over2] };
      out.push(next2);
      jump(land, next2.path, next2.takes);
    }
  };
  jump(g.fox, [g.fox], []);
  return out;
}
const movesFor = (g) => g.turn === "fox" ? foxMoves(g) : gooseMoves(g);
function play(g, m) {
  if (over$1(g)) return g;
  const geese = new Set(g.geese);
  let fox = g.fox;
  let taken = g.taken;
  let idle = g.idle;
  if (g.turn === "geese") {
    geese.delete(m.path[0]);
    geese.add(m.path[m.path.length - 1]);
    idle = m.path[1] - m.path[0] >= N - 1 ? 0 : idle + 1;
  } else {
    fox = m.path[m.path.length - 1];
    for (const t of m.takes) geese.delete(t);
    taken += m.takes.length;
  }
  const next2 = {
    geese,
    fox,
    turn: g.turn === "fox" ? "geese" : "fox",
    taken,
    plies: g.plies + 1,
    idle,
    winner: null,
    drawn: false,
    last: m.path
  };
  if (taken >= TAKE_TO_WIN || idle >= IDLE_LIMIT) next2.winner = "fox";
  else if (next2.turn === "fox" && !foxMoves(next2).length) next2.winner = "geese";
  else if (next2.turn === "geese" && !gooseMoves(next2).length) next2.winner = "fox";
  else if (next2.plies >= MAX_PLIES) next2.drawn = true;
  return next2;
}
const LEVELS$3 = ["easy", "fair", "hard"];
const DEPTH$1 = { easy: 1, fair: 3, hard: 4 };
function value$1(g) {
  if (g.winner === "geese") return 1e6;
  if (g.winner === "fox") return -1e6;
  if (g.drawn) return 0;
  const reach = foxMoves(g);
  const threatened = new Set(reach.flatMap((m) => m.takes)).size;
  let down = 0;
  for (const i of g.geese) down += Math.floor(i / N);
  return 100 * g.geese.size - 4 * room(g) - 9 * reach.length - 25 * threatened + 2 * down - // the clock on the geese, harder the closer it runs
  g.idle * g.idle * 300 / (IDLE_LIMIT * IDLE_LIMIT);
}
function room(g) {
  const seen = /* @__PURE__ */ new Set([g.fox]);
  const todo = [g.fox];
  while (todo.length) {
    const i = todo.pop();
    for (const [dr, dc] of dirsAt(i)) {
      const j = step(i, dr, dc);
      if (!g.geese.has(j) && !seen.has(j)) {
        seen.add(j);
        todo.push(j);
      }
    }
  }
  return seen.size - 1;
}
let looked$1 = 0;
const BUDGET = 6e4;
function search$1(g, depth, alpha, beta) {
  looked$1++;
  if (depth === 0 || over$1(g) || looked$1 > BUDGET) return value$1(g);
  const moves2 = movesFor(g);
  if (g.turn === "geese") {
    let best2 = -Infinity;
    for (const m of moves2) {
      best2 = Math.max(best2, search$1(play(g, m), depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of [...moves2].sort((a, b) => b.takes.length - a.takes.length)) {
    best = Math.min(best, search$1(play(g, m), depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$1(g, level, rand = Math.random) {
  const moves2 = movesFor(g);
  const geese = g.turn === "geese";
  const win = moves2.find((m) => play(g, m).winner === g.turn);
  if (win) return win;
  looked$1 = 0;
  const scored = moves2.map((m) => ({
    m,
    v: (geese ? 1 : -1) * search$1(play(g, m), DEPTH$1[level] - 1, -Infinity, Infinity)
  }));
  scored.sort((a, b) => b.v - a.v);
  if (level === "easy") {
    const top = scored.slice(0, 3);
    return top[Math.floor(rand() * top.length)].m;
  }
  const best = scored.filter((x) => x.v === scored[0].v);
  return best[Math.floor(rand() * best.length)].m;
}
const fresh$2 = () => ({ g: newGame$1(), list: [] });
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const find = (g, path2) => over$1(g) ? null : movesFor(g).find((m) => same(m.path, path2)) ?? null;
const seatOf = (g) => g.turn === "geese" ? 0 : 1;
function replay$2(list) {
  if (list.length > MAX_PLIES) return null;
  let d = fresh$2();
  for (const path2 of list) {
    const m = Array.isArray(path2) ? find(d.g, path2) : null;
    if (!m) return null;
    d = { g: play(d.g, m), list: [...d.list, m.path] };
  }
  return d;
}
function readMove(x) {
  const path2 = Array.isArray(x) ? x : x?.path;
  if (!Array.isArray(path2) || path2.length < 2 || path2.length > 12) return null;
  if (!path2.every((i) => Number.isInteger(i) && i >= 0 && i < N * N)) return null;
  return { path: path2, takes: [] };
}
const foxRules = {
  fresh: fresh$2,
  turn: (d) => over$1(d.g) ? null : seatOf(d.g),
  legal: (d, m, by) => (by === void 0 || by === seatOf(d.g)) && find(d.g, m.path) !== null,
  apply: (d, m) => {
    const real = find(d.g, m.path);
    return real ? { g: play(d.g, real), list: [...d.list, real.path] } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$2(list) : null;
  },
  readMove,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$3, choose: (d, level) => choose$1(d.g, level) },
  result: (d) => !over$1(d.g) ? null : d.g.drawn ? "draw" : d.g.winner === "geese" ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const other = (s) => s === 1 ? 2 : 1;
const idx = (l, r, c) => l * 16 + r * 4 + c;
const LINES = (() => {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const ds = [-1, 0, 1];
  for (const dl of ds)
    for (const dr of ds)
      for (const dc of ds) {
        if (!dl && !dr && !dc) continue;
        for (let l = 0; l < 4; l++)
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) {
              const cells = [];
              for (let k = 0; k < 4; k++) {
                const L = l + dl * k;
                const R2 = r + dr * k;
                const C = c + dc * k;
                if (L < 0 || L > 3 || R2 < 0 || R2 > 3 || C < 0 || C > 3) break;
                cells.push(idx(L, R2, C));
              }
              if (cells.length < 4) continue;
              const key = [...cells].sort((a, b) => a - b).join();
              if (!seen.has(key)) {
                seen.add(key);
                out.push(cells);
              }
            }
      }
  return out;
})();
const THROUGH = Array.from(
  { length: 64 },
  (_, i) => LINES.map((l, k) => l.includes(i) ? k : -1).filter((k) => k >= 0)
);
const newGame = (first = 1) => ({
  cells: new Int8Array(64),
  turn: first,
  winner: 0,
  line: [],
  moves: [],
  over: false
});
function place(g, i) {
  if (g.over || g.cells[i]) return g;
  const cells = g.cells.slice();
  cells[i] = g.turn;
  const won2 = THROUGH[i].map((k) => LINES[k]).find((l) => l.every((j) => cells[j] === g.turn));
  const moves2 = [...g.moves, i];
  return {
    cells,
    turn: other(g.turn),
    winner: won2 ? g.turn : 0,
    line: won2 ?? [],
    moves: moves2,
    over: !!won2 || moves2.length === 64
  };
}
const LEVELS$2 = ["easy", "fair", "hard"];
const WORTH = [0, 1, 8, 80, 1e6];
function value(cells, side) {
  let v = 0;
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const j of line) {
      if (cells[j] === side) mine++;
      else if (cells[j]) theirs++;
    }
    if (mine && !theirs) v += WORTH[mine];
    else if (theirs && !mine) v -= WORTH[theirs] * 1.1;
  }
  return v;
}
function winsAt(cells, side) {
  const out = /* @__PURE__ */ new Set();
  for (const line of LINES) {
    let mine = 0;
    let gap = -1;
    for (const j of line) {
      if (cells[j] === side) mine++;
      else if (!cells[j]) gap = j;
    }
    if (mine === 3 && gap >= 0 && line.filter((j) => !cells[j]).length === 1) out.add(gap);
  }
  return [...out];
}
const empties = (cells) => [...cells.keys()].filter((i) => !cells[i]);
function search(cells, side, me, depth, alpha, beta) {
  const opts = empties(cells);
  if (!opts.length) return 0;
  if (depth === 0) return value(cells, me);
  const win = winsAt(cells, side);
  if (win.length) return side === me ? 1e7 + depth : -1e7 - depth;
  const block = winsAt(cells, other(side));
  const list = block.length ? block.slice(0, 1) : order(cells, opts, side).slice(0, 10);
  if (side === me) {
    let best2 = -Infinity;
    for (const i of list) {
      cells[i] = side;
      best2 = Math.max(best2, search(cells, other(side), me, depth - 1, alpha, beta));
      cells[i] = 0;
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const i of list) {
    cells[i] = side;
    best = Math.min(best, search(cells, other(side), me, depth - 1, alpha, beta));
    cells[i] = 0;
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function order(cells, opts, side) {
  const score2 = (i) => {
    let s = 0;
    for (const k of THROUGH[i]) {
      let mine = 0;
      let theirs = 0;
      for (const j of LINES[k]) {
        if (cells[j] === side) mine++;
        else if (cells[j]) theirs++;
      }
      if (!theirs) s += WORTH[mine] + 1;
      if (!mine) s += WORTH[theirs];
    }
    return s;
  };
  return opts.map((i) => ({ i, s: score2(i) })).sort((a, b) => b.s - a.s).map((x) => x.i);
}
function forcedWin(cells, side, depth = 8, budget2 = 2e4) {
  looked = 0;
  limit = budget2;
  return forced(cells, side, depth);
}
let looked = 0;
let limit = 0;
function forced(cells, side, depth) {
  if (depth <= 0 || ++looked > limit) return -1;
  const foe = other(side);
  const can = /* @__PURE__ */ new Set();
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const j of line) {
      if (cells[j] === side) mine++;
      else if (cells[j]) theirs++;
    }
    if (mine === 2 && !theirs) {
      for (const j of line) if (!cells[j]) can.add(j);
    }
  }
  for (const i of can) {
    cells[i] = side;
    const threats = winsAt(cells, side);
    if (!threats.length) {
      cells[i] = 0;
      continue;
    }
    if (threats.length >= 2 && !winsAt(cells, foe).length) {
      cells[i] = 0;
      return i;
    }
    const block = threats[0];
    cells[block] = foe;
    const counter = winsAt(cells, foe).length > 0;
    const on = counter ? -1 : forced(cells, side, depth - 1);
    cells[block] = 0;
    cells[i] = 0;
    if (on >= 0) return i;
  }
  return -1;
}
const DEPTH = { easy: 1, fair: 2, hard: 4 };
function choose(g, level, rand = Math.random) {
  const me = g.turn;
  const cells = g.cells.slice();
  const win = winsAt(cells, me);
  if (win.length) return win[0];
  const block = winsAt(cells, other(me));
  if (block.length) return block[0];
  if (level === "fair") {
    const f = forcedWin(cells, me, 4, 3e3);
    if (f >= 0) return f;
  }
  if (level === "hard") {
    const force = forcedWin(cells, me);
    if (force >= 0) return force;
  }
  const opts = order(cells, empties(cells), me);
  if (level === "easy") {
    const top = opts.slice(0, 5);
    return top[Math.floor(rand() * top.length)];
  }
  let best = [];
  let bv = -Infinity;
  for (const i of opts.slice(0, 12)) {
    cells[i] = me;
    const v = search(cells, other(me), me, DEPTH[level] - 1, -Infinity, Infinity);
    cells[i] = 0;
    if (v > bv) {
      bv = v;
      best = [i];
    } else if (v === bv) best.push(i);
  }
  return best[Math.floor(rand() * best.length)];
}
const cubeRules = {
  fresh: () => newGame(1),
  turn: (g) => g.over ? null : g.turn === 1 ? 0 : 1,
  legal: (g, i, by) => !g.over && (by === void 0 || by === g.turn - 1) && Number.isInteger(i) && i >= 0 && i < 64 && !g.cells[i],
  apply: (g, i) => place(g, i),
  encode: (g) => ({ moves: g.moves }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > 64) return null;
    let g = newGame(1);
    for (const i of list) {
      if (g.over || !Number.isInteger(i) || i < 0 || i >= 64 || g.cells[i]) return null;
      g = place(g, i);
    }
    return g;
  },
  readMove: (x) => Number.isInteger(x) && x >= 0 && x < 64 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$2, choose: (g, level) => choose(g, level) },
  result: (g) => !g.over ? null : g.winner === 0 ? "draw" : g.winner === 1 ? 0 : 1,
  begun: (g) => g.moves.length > 0
};
const FIELD_W = 1.6;
const COLS = 320;
const DX = FIELD_W / COLS;
const G = 1;
const MAX_SPEED = 1.75;
const CRATER = 0.06;
const BLAST = 0.11;
const GUN_R = 0.022;
const LIFE = 100;
const STEP$1 = 1 / 240;
function newField(seed2, first = 0) {
  const r = rng(seed2);
  const ground = new Array(COLS + 1).fill(0);
  for (const [waves, size] of [
    [1, 0.12],
    [2.5, 0.09],
    [5, 0.045],
    [11, 0.015]
  ]) {
    const ph = r() * Math.PI * 2;
    for (let i = 0; i <= COLS; i++)
      ground[i] += size * Math.sin(i / COLS * Math.PI * 2 * waves + ph);
  }
  for (let i = 0; i <= COLS; i++) ground[i] = Math.max(0.06, Math.min(0.62, 0.3 + ground[i]));
  const guns = [
    { x: 0.14 + r() * 0.12, life: LIFE },
    { x: FIELD_W - 0.14 - r() * 0.12, life: LIFE }
  ];
  for (const g of guns) {
    const c = Math.round(g.x / DX);
    const h = ground[c];
    for (let i = c - 4; i <= c + 4; i++) if (i >= 0 && i <= COLS) ground[i] = h;
  }
  return {
    ground,
    guns,
    wind: windFrom(r),
    turn: first,
    winner: null,
    seed: Math.floor(r() * 2 ** 31)
  };
}
const windFrom = (r) => Math.round((r() * 2 - 1) * 0.35 * 100) / 100;
function groundAt(f, x) {
  if (x <= 0) return f.ground[0];
  if (x >= FIELD_W) return f.ground[COLS];
  const u = x / DX;
  const i = Math.floor(u);
  const t = u - i;
  return f.ground[i] * (1 - t) + f.ground[Math.min(COLS, i + 1)] * t;
}
const gunAt = (f, w) => ({ x: f.guns[w].x, y: groundAt(f, f.guns[w].x) + GUN_R });
function fly(f, from, angle, charge, keep = false) {
  const start2 = gunAt(f, from);
  const dir = from === 0 ? 1 : -1;
  const a = angle * Math.PI / 180;
  const speed = Math.max(0, Math.min(1, charge)) * MAX_SPEED;
  let x = start2.x + dir * Math.cos(a) * GUN_R * 1.5;
  let y = start2.y + Math.sin(a) * GUN_R * 1.5;
  let vx = dir * Math.cos(a) * speed;
  let vy = Math.sin(a) * speed;
  const path2 = keep ? [x, y] : [];
  for (let i = 0; i < 20 / STEP$1; i++) {
    vx += f.wind * STEP$1;
    vy -= G * STEP$1;
    x += vx * STEP$1;
    y += vy * STEP$1;
    if (keep && i % 4 === 0) path2.push(x, y);
    if (x < -0.05 || x > FIELD_W + 0.05) return { burst: null, struck: null, path: path2 };
    for (const w of [0, 1]) {
      const g = gunAt(f, w);
      if (Math.hypot(x - g.x, y - g.y) < GUN_R * 1.2 && (w !== from || i > 20)) {
        if (keep) path2.push(x, y);
        return { burst: { x, y }, struck: w, path: path2 };
      }
    }
    if (y <= groundAt(f, x)) {
      if (keep) path2.push(x, y);
      return { burst: { x, y: groundAt(f, x) }, struck: null, path: path2 };
    }
  }
  return { burst: null, struck: null, path: path2 };
}
function harm(f, burst, w, struck) {
  if (struck) return 45;
  const g = gunAt(f, w);
  const d = Math.hypot(burst.x - g.x, burst.y - g.y);
  return d >= BLAST ? 0 : Math.round(38 * (1 - d / BLAST));
}
function shoot(f, angle, charge) {
  if (f.winner !== null)
    return { field: f, flight: { burst: null, struck: null, path: [] }, hurt: [0, 0] };
  const flight = fly(f, f.turn, angle, charge, true);
  const hurt = [0, 0];
  let ground = f.ground;
  if (flight.burst) {
    const b = flight.burst;
    for (const w of [0, 1]) hurt[w] = harm(f, b, w, flight.struck === w);
    ground = f.ground.map((h, i) => {
      const dx = i * DX - b.x;
      if (Math.abs(dx) >= CRATER) return h;
      const bottom = b.y - Math.sqrt(CRATER * CRATER - dx * dx);
      return Math.max(0.02, Math.min(h, bottom));
    });
  }
  const guns = f.guns.map((g, w) => ({
    ...g,
    life: Math.max(0, g.life - hurt[w])
  }));
  const dead = guns.findIndex((g) => g.life <= 0);
  const winner2 = dead < 0 ? null : guns[0].life <= 0 && guns[1].life <= 0 ? f.turn : dead === 0 ? 1 : 0;
  const r = rng(f.seed);
  const wind = Math.max(
    -0.35,
    Math.min(0.35, Math.round((f.wind + (r() * 2 - 1) * 0.12) * 100) / 100)
  );
  return {
    field: {
      ...f,
      ground,
      guns,
      wind,
      turn: f.turn === 0 ? 1 : 0,
      winner: winner2,
      seed: Math.floor(r() * 2 ** 31)
    },
    flight,
    hurt
  };
}
const LEVELS$1 = ["easy", "fair", "hard"];
const HANDS$1 = {
  easy: { angle: 5, charge: 0.06 },
  fair: { angle: 2.2, charge: 0.028 },
  hard: { angle: 0.9, charge: 0.012 }
};
function aim(f, from) {
  const target = gunAt(f, from === 0 ? 1 : 0);
  let best = { angle: 45, charge: 0.7 };
  let bd = Infinity;
  const tryOne = (angle2, charge2) => {
    const fl = fly(f, from, angle2, charge2);
    if (!fl.burst) return;
    const d = fl.struck === (from === 0 ? 1 : 0) ? 0 : Math.hypot(fl.burst.x - target.x, fl.burst.y - target.y);
    if (d < bd) {
      bd = d;
      best = { angle: angle2, charge: charge2 };
    }
  };
  for (let a = 20; a <= 80; a += 3) for (let c = 0.3; c <= 1.0001; c += 0.04) tryOne(a, c);
  const { angle, charge } = best;
  for (let da = -3; da <= 3; da += 0.75)
    for (let dc = -0.04; dc <= 0.0401; dc += 8e-3) tryOne(angle + da, charge + dc);
  return best;
}
const normal$1 = (rand) => (rand() + rand() + rand() + rand() - 2) / 0.577;
function gunner(f, level, rand = Math.random) {
  const a = aim(f, f.turn);
  const h = HANDS$1[level];
  return {
    angle: Math.max(5, Math.min(85, a.angle + normal$1(rand) * h.angle)),
    charge: Math.max(0.1, Math.min(1, a.charge + normal$1(rand) * h.charge))
  };
}
const MAX_SHOTS = 200;
const newSeed = () => Math.random() * 2 ** 31 >>> 0;
function fresh$1(seed2 = newSeed()) {
  return { seed: seed2, shots: [], f: newField(seed2, 0), last: null };
}
function after$1(g, s) {
  const by = g.f.turn;
  const r = shoot(g.f, s.angle, s.charge);
  return { ...g, shots: [...g.shots, s], f: r.field, last: { by, flight: r.flight, hurt: r.hurt } };
}
const over = (g) => g.f.winner !== null || g.shots.length >= MAX_SHOTS;
function readShot(x) {
  const [angle, charge] = Array.isArray(x) ? x : [x?.angle, x?.charge];
  if (typeof angle !== "number" || typeof charge !== "number") return null;
  if (!(angle >= 5 && angle <= 85 && charge >= 0.1 && charge <= 1)) return null;
  return { angle, charge };
}
function replay$1(seed2, shots) {
  if (!Number.isInteger(seed2) || seed2 < 0 || seed2 >= 2 ** 31) return null;
  if (shots.length > MAX_SHOTS) return null;
  let g = fresh$1(seed2);
  for (const x of shots) {
    const s = readShot(x);
    if (!s || over(g)) return null;
    g = after$1(g, s);
  }
  return g;
}
const artilleryRules = {
  fresh: () => fresh$1(),
  turn: (g) => over(g) ? null : g.f.turn,
  legal: (g, s, by) => !over(g) && (by === void 0 || by === g.f.turn) && readShot(s) !== null,
  apply: (g, s) => after$1(g, s),
  encode: (g) => ({ seed: g.seed, shots: g.shots.map((s) => [s.angle, s.charge]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.shots)) return null;
    return replay$1(o.seed, o.shots);
  },
  readMove: readShot,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$1,
    choose: (g, level) => gunner(g.f, level)
  },
  result: (g) => !over(g) ? null : g.f.winner ?? "draw",
  begun: (g) => g.shots.length > 0
};
const LANE_HALF = 0.527;
const HEAD_PIN = 18.29;
const OIL = 12;
const PIT = HEAD_PIN + 1.2;
const BALL_R = 0.109;
const PIN_R = 0.06;
const FALLING_R = 0.07;
const BALL_M = 7;
const PIN_M = 1.5;
const STEP = 1 / 500;
const SPACING = 0.3048;
const KICKBACK = LANE_HALF + 0.24;
function rack(standing = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const row = SPACING * Math.sin(Math.PI / 3);
  const spots = {
    1: [0, 0],
    2: [-0.5, 1],
    3: [0.5, 1],
    4: [-1, 2],
    5: [0, 2],
    6: [1, 2],
    7: [-1.5, 3],
    8: [-0.5, 3],
    9: [0.5, 3],
    10: [1.5, 3]
  };
  return standing.map((n) => ({
    n,
    x: spots[n][0] * SPACING,
    y: HEAD_PIN + spots[n][1] * row,
    vx: 0,
    vy: 0,
    down: false,
    gone: false
  }));
}
function bowl(standing, shot, keep = false) {
  const pins = rack(standing);
  let x = shot.x;
  let y = 0.3;
  let vx = Math.sin(shot.angle) * shot.speed;
  let vy = Math.cos(shot.angle) * shot.speed;
  let gutter = false;
  const frames = [];
  for (let i = 0; i < 8 / STEP; i++) {
    if (!gutter) {
      if (y > OIL) vx -= shot.hook * 1.1 * STEP;
      vy -= 0.25 * STEP;
      x += vx * STEP;
      y += vy * STEP;
      if (Math.abs(x) > LANE_HALF - BALL_R * 0.4 && y < HEAD_PIN - 0.2) {
        gutter = true;
        x = Math.sign(x) * (LANE_HALF + BALL_R);
        vx = 0;
      }
    } else y += vy * STEP;
    if (y > HEAD_PIN - 1) {
      for (const p of pins) {
        if (p.gone) continue;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0) {
          const slow = Math.min(sp, 2.2 * STEP);
          p.vx -= p.vx / sp * slow;
          p.vy -= p.vy / sp * slow;
        }
        p.x += p.vx * STEP;
        p.y += p.vy * STEP;
        if (Math.abs(p.x) > KICKBACK) {
          p.x = Math.sign(p.x) * KICKBACK;
          p.vx = -p.vx * 0.5;
        }
        if (p.y > PIT || p.y < HEAD_PIN - 2) p.gone = true;
      }
      if (!gutter)
        for (const p of pins) {
          if (p.gone) continue;
          const push = hit(p, BALL_M, { x, y }, { vx, vy }, BALL_R + PIN_R);
          vx += push[0];
          vy += push[1];
        }
      for (let a = 0; a < pins.length; a++)
        for (let b = a + 1; b < pins.length; b++) {
          const p = pins[a];
          const q = pins[b];
          if (p.gone || q.gone) continue;
          const reach = (p.down ? FALLING_R : PIN_R) + (q.down ? FALLING_R : PIN_R);
          pinPin(p, q, reach);
        }
      for (const p of pins) if (!p.down && Math.hypot(p.vx, p.vy) > 0.3) p.down = true;
    }
    if (keep && i % Math.round(1 / 60 / STEP) === 0)
      frames.push({ ball: [x, y], pins: pins.map((p) => [p.x, p.y, p.down || p.gone]) });
    if (y > PIT + 0.5 && pins.every((p) => p.gone || Math.hypot(p.vx, p.vy) < 0.02)) break;
  }
  return { felled: pins.filter((p) => p.down || p.gone).map((p) => p.n), gutter, frames };
}
function hit(p, mass, at2, v, reach) {
  const dx = p.x - at2.x;
  const dy = p.y - at2.y;
  const d = Math.hypot(dx, dy);
  if (d >= reach || d === 0) return [0, 0];
  const nx = dx / d;
  const ny = dy / d;
  const rel = (v.vx - p.vx) * nx + (v.vy - p.vy) * ny;
  if (rel <= 0) return [0, 0];
  const e = 0.8;
  const j = (1 + e) * rel / (1 / mass + 1 / PIN_M);
  p.vx += j / PIN_M * nx;
  p.vy += j / PIN_M * ny;
  p.x = at2.x + nx * reach;
  p.y = at2.y + ny * reach;
  p.down = true;
  return [-j / mass * nx, -j / mass * ny];
}
function pinPin(p, q, reach) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d >= reach || d === 0) return;
  const nx = dx / d;
  const ny = dy / d;
  const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
  if (rel <= 0) return;
  const j = 1.6 * rel / 2;
  p.vx -= j * nx;
  p.vy -= j * ny;
  q.vx += j * nx;
  q.vy += j * ny;
  const over2 = (reach - d) / 2;
  p.x -= nx * over2;
  p.y -= ny * over2;
  q.x += nx * over2;
  q.y += ny * over2;
  if (Math.hypot(p.vx, p.vy) > 0.3) p.down = true;
  if (Math.hypot(q.vx, q.vy) > 0.3) q.down = true;
}
function card(rolls) {
  const frames = [];
  let i = 0;
  let running = 0;
  for (let f = 0; f < 10; f++) {
    if (i >= rolls.length) {
      frames.push({ rolls: [], total: null });
      continue;
    }
    const first = rolls[i];
    if (f === 9) {
      const mine = rolls.slice(i, i + 3);
      const extra = first === 10 || first + (rolls[i + 1] ?? 0) === 10;
      const need = extra ? 3 : 2;
      const done = mine.length >= need;
      running += done ? mine.slice(0, need).reduce((s, x) => s + x, 0) : 0;
      frames.push({ rolls: mine.slice(0, need), total: done ? running : null });
      break;
    }
    if (first === 10) {
      const b = rolls.slice(i + 1, i + 3);
      running += b.length === 2 ? 10 + b[0] + b[1] : 0;
      frames.push({ rolls: [10], total: b.length === 2 ? running : null });
      i += 1;
      continue;
    }
    const second = rolls[i + 1];
    if (second === void 0) {
      frames.push({ rolls: [first], total: null });
      i += 1;
      continue;
    }
    if (first + second === 10) {
      const b = rolls[i + 2];
      running += b === void 0 ? 0 : 10 + b;
      frames.push({ rolls: [first, second], total: b === void 0 ? null : running });
    } else {
      running += first + second;
      frames.push({ rolls: [first, second], total: running });
    }
    i += 2;
  }
  return frames;
}
const score = (rolls) => {
  const c = card(rolls);
  let last = 0;
  for (const f of c) if (f.total !== null) last = f.total;
  return last;
};
function next(rolls) {
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return { over: false, fresh: true };
    if (rolls[i] === 10) {
      i += 1;
      continue;
    }
    if (i + 1 >= rolls.length) return { over: false, fresh: false };
    i += 2;
  }
  const tenth = rolls.slice(i);
  if (tenth.length === 0) return { over: false, fresh: true };
  if (tenth.length === 1) return { over: false, fresh: tenth[0] === 10 };
  if (tenth.length === 2) {
    if (tenth[0] === 10) return { over: false, fresh: tenth[1] === 10 };
    if (tenth[0] + tenth[1] === 10) return { over: false, fresh: true };
    return { over: true, fresh: true };
  }
  return { over: true, fresh: true };
}
function upNext(rolls, by) {
  const n = next(rolls[by]);
  const other2 = by === 0 ? 1 : 0;
  if (!n.over && !n.fresh) return by;
  if (!next(rolls[other2]).over) return other2;
  return n.over ? null : by;
}
const LEVELS = ["easy", "fair", "hard"];
const HANDS = {
  easy: { x: 0.09, angle: 0.013, speed: 0.6, hook: 0 },
  fair: { x: 0.045, angle: 6e-3, speed: 0.35, hook: 0.5 },
  hard: { x: 0.018, angle: 25e-4, speed: 0.15, hook: 1 }
};
function plan(standing, level, rand) {
  const h = HANDS[level];
  const speed = 7.6;
  const hooks = standing.length < 10 && h.hook > 0 ? [0, h.hook] : [h.hook];
  const tried = [];
  const tryOne = (s) => tried.push({ s, v: bowl(standing, s).felled.length });
  for (const hook of hooks)
    for (let xi = -6; xi <= 6; xi++)
      for (let ai = -6; ai <= 6; ai++) tryOne({ x: xi * 0.06, angle: ai * 6e-3, speed, hook });
  tried.sort((a, b) => b.v - a.v);
  let best = tried[0].s;
  let bv = -Infinity;
  for (const c of tried.slice(0, 6)) {
    let t = 0;
    for (let k = 0; k < 6; k++) t += bowl(standing, wobble(c.s, level, rand)).felled.length;
    if (t > bv) {
      bv = t;
      best = c.s;
    }
  }
  return best;
}
const normal = (rand) => (rand() + rand() + rand() - 1.5) / 0.5;
function wobble(s, level, rand) {
  const h = HANDS[level];
  return {
    x: s.x + normal(rand) * h.x,
    angle: s.angle + normal(rand) * h.angle,
    speed: s.speed + normal(rand) * h.speed,
    hook: s.hook
  };
}
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_BALLS = 42;
const fresh = () => ({
  balls: [],
  rolls: [[], []],
  up: 0,
  standing: ALL,
  last: null
});
function after(g, s, keep = true) {
  const by = g.up;
  const roll = bowl(g.standing, s, keep);
  const mine = [...g.rolls[by], roll.felled.length];
  const rolls = by === 0 ? [mine, g.rolls[1]] : [g.rolls[0], mine];
  const n = next(mine);
  const frameOver = n.over || n.fresh;
  const up = upNext(rolls, by);
  const standing = frameOver ? ALL : g.standing.filter((p) => !roll.felled.includes(p));
  return { balls: [...g.balls, s], rolls, up, standing, last: { by, standing: g.standing, roll } };
}
function readBall(x) {
  const a = Array.isArray(x) ? x : [
    x?.x,
    x?.angle,
    x?.speed,
    x?.hook
  ];
  if (a.length !== 4 || !a.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [bx, angle, speed, hook] = a;
  if (Math.abs(bx) > LANE_HALF || Math.abs(angle) > 0.1) return null;
  if (speed < 5 || speed > 10 || Math.abs(hook) > 1) return null;
  return { x: bx, angle, speed, hook };
}
const inside = (s) => ({
  x: Math.max(-LANE_HALF, Math.min(LANE_HALF, s.x)),
  angle: Math.max(-0.1, Math.min(0.1, s.angle)),
  speed: Math.max(5, Math.min(10, s.speed)),
  hook: Math.max(-1, Math.min(1, s.hook))
});
function replay(balls) {
  if (balls.length > MAX_BALLS) return null;
  let g = fresh();
  for (let i = 0; i < balls.length; i++) {
    const s = readBall(balls[i]);
    if (!s || g.up === null) return null;
    g = after(g, s, i === balls.length - 1);
  }
  return g;
}
const bowlingRules = {
  fresh,
  turn: (g) => g.up,
  legal: (g, s, by) => g.up !== null && (by === void 0 || by === g.up) && readBall(s) !== null,
  apply: (g, s) => after(g, s),
  encode: (g) => ({ balls: g.balls.map((s) => [s.x, s.angle, s.speed, s.hook]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.balls)) return null;
    return replay(o.balls);
  },
  readMove: readBall,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => inside(wobble(plan(g.standing, level, Math.random), level, Math.random))
  },
  result: (g) => {
    if (g.up !== null) return null;
    const [a, b] = [score(g.rolls[0]), score(g.rolls[1])];
    return a > b ? 0 : b > a ? 1 : "draw";
  },
  begun: (g) => g.balls.length > 0
};
const GAMES = {
  reversi: (s) => {
    const size = s.size ?? 8;
    if (!SIZES$6.includes(size)) return null;
    return {
      rules: reversiRules(size),
      score: (g) => count$2(g.b).join("–")
    };
  },
  chess: () => ({ rules: chessRules }),
  pool: () => ({ rules: poolRules }),
  gomoku: (s) => {
    const size = s.size ?? 13;
    return SIZES$5.includes(size) ? { rules: gomokuRules(size) } : null;
  },
  draughts: () => ({ rules: draughtsRules }),
  dots: (s) => {
    const size = s.size ?? 4;
    if (!SIZES$4.includes(size)) return null;
    return { rules: dotsRules(size), score: (d) => d.g.score.join("–") };
  },
  fourrow: (s) => {
    const read = readFourSettings(s);
    return read ? { rules: fourRowMatchRules(...read) } : null;
  },
  mancala: (s) => {
    const read = readMancalaSettings(s);
    if (!read) return null;
    return {
      rules: mancalaRules(read),
      score: (g) => score$2(g.b).join("–")
    };
  },
  morris: () => ({ rules: morrisRules }),
  hex: (s) => {
    const read = readHexSettings(s);
    return read ? { rules: hexRules(...read) } : null;
  },
  ultimate: () => ({ rules: ultimateRules }),
  breakthrough: (s) => {
    const size = readBreakthroughSize(s);
    return size === null ? null : { rules: breakthroughRules(size) };
  },
  fences: (s) => {
    const size = readFencesSize(s);
    return size === null ? null : { rules: fencesRules(size) };
  },
  halma: () => ({ rules: halmaRules }),
  go: () => ({
    rules: goRules,
    // area by colour, white's with its komi: the count the toy shows at the end
    score: (d) => {
      const s = score$1(d.g.board);
      return `${s.black}–${s.white}`;
    }
  }),
  fox: () => ({ rules: foxRules }),
  cube: () => ({ rules: cubeRules }),
  artillery: () => ({
    rules: artilleryRules,
    // what each gun has left, left gun first
    score: (g) => `${g.f.guns[0].life}–${g.f.guns[1].life}`
  }),
  bowling: () => ({
    rules: bowlingRules,
    // the two scorecards' totals, the first bowler's first
    score: (g) => `${score(g.rolls[0])}–${score(g.rolls[1])}`
  })
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
  const winner2 = over2 ? rules.result?.(g) ?? "draw" : null;
  return {
    kind: "commit",
    at: row.seq,
    move: historyRow(move, then),
    state: rules.encode(g),
    // versus: whoever the board says; together: the other friend takes the team's next move
    turn: over2 ? null : row.mode === "together" ? 1 - seat : rules.turn(g),
    result: winner2 === null ? null : { winner: winner2, ...game.score ? { score: game.score(g).slice(0, 40) } : {} }
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
