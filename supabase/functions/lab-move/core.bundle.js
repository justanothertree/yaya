const START$1 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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
const at$4 = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c;
function attacked(p, i, by) {
  const r = Math.floor(i / 8);
  const c = i % 8;
  const own = (ch) => by === "w" ? ch.toUpperCase() : ch.toLowerCase();
  const pr = by === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const j = at$4(pr, c + dc);
    if (j >= 0 && p.sq[j] === own("p")) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    const j = at$4(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("n")) return true;
  }
  for (const [dr, dc] of KING) {
    const j = at$4(r + dr, c + dc);
    if (j >= 0 && p.sq[j] === own("k")) return true;
  }
  for (const [dirs, kinds] of [
    [DIAG, ["b", "q"]],
    [LINE, ["r", "q"]]
  ])
    for (const [dr, dc] of dirs)
      for (let k = 1; ; k++) {
        const j = at$4(r + dr * k, c + dc * k);
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
  const add2 = (from, to, flag = "", promo = "") => out.push({
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
    const kind2 = x.toLowerCase();
    if (kind2 === "p") {
      const dir = s === "w" ? -1 : 1;
      const last = s === "w" ? 0 : 7;
      const pawnTo = (to, flag = "") => {
        if (Math.floor(to / 8) === last)
          for (const q of "qrbn") add2(i, to, flag, s === "w" ? q.toUpperCase() : q);
        else add2(i, to, flag);
      };
      const one = at$4(r + dir, c);
      if (one >= 0 && !p.sq[one]) {
        pawnTo(one);
        const two = at$4(r + 2 * dir, c);
        if (r === (s === "w" ? 6 : 1) && !p.sq[two]) add2(i, two, "double");
      }
      for (const dc of [-1, 1]) {
        const j = at$4(r + dir, c + dc);
        if (j < 0) continue;
        if (sideOf(p.sq[j]) === opp(s)) pawnTo(j);
        else if (j === p.ep) add2(i, j, "ep");
      }
    } else if (kind2 === "n" || kind2 === "k") {
      for (const [dr, dc] of kind2 === "n" ? KNIGHT : KING) {
        const j = at$4(r + dr, c + dc);
        if (j >= 0 && sideOf(p.sq[j]) !== s) add2(i, j);
      }
      if (kind2 === "k") {
        const home = s === "w" ? 60 : 4;
        if (i === home && !attacked(p, i, opp(s))) {
          const k = s === "w" ? "K" : "k";
          const q = s === "w" ? "Q" : "q";
          if (p.castle.includes(k) && !p.sq[i + 1] && !p.sq[i + 2] && !attacked(p, i + 1, opp(s)))
            add2(i, i + 2, "O-O");
          if (p.castle.includes(q) && !p.sq[i - 1] && !p.sq[i - 2] && !p.sq[i - 3] && !attacked(p, i - 1, opp(s)))
            add2(i, i - 2, "O-O-O");
        }
      }
    } else {
      const dirs = kind2 === "b" ? DIAG : kind2 === "r" ? LINE : [...DIAG, ...LINE];
      for (const [dr, dc] of dirs)
        for (let k = 1; ; k++) {
          const j = at$4(r + dr * k, c + dc * k);
          if (j < 0) break;
          const y = sideOf(p.sq[j]);
          if (y === s) break;
          add2(i, j);
          if (y) break;
        }
    }
  }
  return out;
}
function play$c(p, m) {
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
  return pseudo(p).filter((m) => !inCheck(play$c(p, m), p.turn));
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
    const kind2 = m.piece.toUpperCase();
    const takes2 = m.take ? "x" : "";
    if (kind2 === "P")
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
      s = `${kind2}${which}${takes2}${sqName(m.to)}`;
    }
  }
  const after2 = play$c(p, m);
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
    const kind2 = x.toLowerCase();
    const w = white(x);
    v += (w ? 1 : -1) * (VALUE[kind2] + PLACE[kind2][w ? i : 63 - i]);
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
    const next2 = play$c(p, m);
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
    const next2 = play$c(p, m);
    if (inCheck(next2, p.turn)) continue;
    legal2++;
    const v = -search$a(next2, depth - 1, -beta, -alpha, ply + 1, budget2);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  if (!legal2) return inCheck(p) ? -1e5 + ply : 0;
  return alpha;
}
const LEVELS$q = ["easy", "fair", "hard"];
const DEPTH$7 = { easy: 1, fair: 2, hard: 3 };
const CAP = { easy: 1e9, fair: 1e9, hard: 35e3 };
function choose$i(p, level, rand = Math.random, history2 = []) {
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
        const next2 = play$c(p, m);
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
function replay$k(list) {
  const turns = [{ pos: fromFen(START$1), move: null, name: "" }];
  let over2 = null;
  for (const code2 of list) {
    if (over2) return null;
    const p = turns[turns.length - 1].pos;
    const m = moves$6(p).find((x) => uci(x) === code2);
    if (!m) return null;
    const next2 = play$c(p, m);
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
  fresh: () => replay$k([]),
  turn: (g) => g.over ? null : posOf(g).turn === "w" ? 0 : 1,
  legal: (g, code2, by) => !g.over && (by === void 0 || (by === 0 ? "w" : "b") === posOf(g).turn) && g.list.length < MAX_MOVES$4 && moves$6(posOf(g)).some((m) => uci(m) === code2),
  apply: (g, code2) => replay$k([...g.list, code2]) ?? g,
  encode: (g) => ({ moves: g.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES$4) return null;
    if (!list.every((c) => typeof c === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c)))
      return null;
    return replay$k(list);
  },
  readMove: (x) => typeof x === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) ? x : null,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$q,
    choose: (g, level) => uci(choose$i(posOf(g), level, Math.random, history(g)))
  },
  result: (g) => !g.over ? null : g.over.winner === null ? "draw" : g.over.winner === "w" ? 0 : 1,
  begun: (g) => g.list.length > 0
};
const other$g = (w) => w === 1 ? 2 : 1;
const SIZES$7 = [6, 8, 10];
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
  const them = other$g(who);
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
const count$5 = (b) => {
  let d = 0;
  let l = 0;
  for (const c of b.cells)
    if (c === 1) d++;
    else if (c === 2) l++;
  return [d, l];
};
function nextTurn(b, who) {
  if (moves$5(b, other$g(who)).length) return other$g(who);
  if (moves$5(b, who).length) return who;
  return null;
}
const LEVELS$p = ["easy", "fair", "hard"];
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
  const them = other$g(me);
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
  const mine2 = moves$5(b, me).length;
  const theirs = moves$5(b, them).length;
  const mobility = mine2 + theirs ? 100 * (mine2 - theirs) / (mine2 + theirs) : 0;
  return pos + mobility * 0.8;
}
function search$9(b, who, me, depth, alpha, beta, w, exact) {
  const list = moves$5(b, who);
  if (!list.length) {
    if (!moves$5(b, other$g(who)).length) {
      const [d, l] = count$5(b);
      const diff = l - d;
      return diff * 1e3;
    }
    return search$9(b, other$g(who), me, depth, alpha, beta, w, exact);
  }
  if (depth === 0 && !exact) return evaluate(b, me, w);
  list.sort((a, c) => w[c] - w[a]);
  if (who === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(
        best2,
        search$9(place$4(b, m, who), other$g(who), me, depth - 1, alpha, beta, w, exact)
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
      search$9(place$4(b, m, who), other$g(who), me, depth - 1, alpha, beta, w, exact)
    );
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$h(b, who, level, rand = Math.random) {
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
    const v = search$9(place$4(b, m, who), other$g(who), who, depth - 1, -Infinity, Infinity, w, exact);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const toSeat = (w) => w === 1 ? 0 : 1;
const toWho = (s) => s === 0 ? 1 : 2;
function reversiRules(size2) {
  return {
    fresh: () => ({ b: start$1(size2), turn: 1 }),
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
      levels: LEVELS$p,
      choose: (g, level) => choose$h(g.b, 2, level)
    },
    result: (g) => {
      if (g.turn !== null) return null;
      const [d, l] = count$5(g.b);
      return d > l ? 0 : l > d ? 1 : "draw";
    },
    begun: (g) => {
      const [d, l] = count$5(g.b);
      return d + l > 4;
    }
  };
}
function readReversiGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const n = o.n;
  if (!SIZES$7.includes(n)) return null;
  const cells = o.cells;
  if (!Array.isArray(cells) || cells.length !== n * n || !cells.every((c) => c === 0 || c === 1 || c === 2))
    return null;
  const b = { n, cells };
  const [d, l] = count$5(b);
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
const SIZES$6 = [11, 13];
const DIRS$3 = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];
const other$f = (s) => s === 1 ? 2 : 1;
function newGame$d(n = 13) {
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
  for (const sign2 of [1, -1]) {
    let r = r0 + dr * sign2;
    let c = c0 + dc * sign2;
    while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === s) {
      out.push(r * n + c);
      r += dr * sign2;
      c += dc * sign2;
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
    turn: other$f(g.turn),
    winner: won2 ? g.turn : 0,
    line,
    moves: moves2,
    over: won2 || full2
  };
}
const LEVELS$o = ["easy", "fair", "hard"];
function shape(cells, n, i, side) {
  let total2 = 0;
  let fours = 0;
  let threes = 0;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  for (const [dr, dc] of DIRS$3) {
    let count2 = 1;
    let open2 = 0;
    for (const sign2 of [1, -1]) {
      let r = r0 + dr * sign2;
      let c = c0 + dc * sign2;
      while (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === side) {
        count2++;
        r += dr * sign2;
        c += dc * sign2;
      }
      if (r >= 0 && c >= 0 && r < n && c < n && cells[r * n + c] === 0) open2++;
    }
    if (count2 >= 5) total2 += 1e7;
    else if (count2 === 4) {
      total2 += open2 === 2 ? 1e6 : open2 === 1 ? 6e4 : 0;
      if (open2) fours++;
    } else if (count2 === 3) {
      total2 += open2 === 2 ? 5e4 : open2 === 1 ? 2e3 : 0;
      if (open2 === 2) threes++;
    } else if (count2 === 2) total2 += open2 === 2 ? 600 : open2 === 1 ? 80 : 0;
    else total2 += open2 === 2 ? 20 : open2 === 1 ? 4 : 0;
  }
  if (fours >= 2 || fours && threes) total2 += 8e5;
  else if (threes >= 2) total2 += 3e5;
  return total2;
}
function candidates$1(g) {
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
const worth$2 = (g, i, defend) => shape(g.cells, g.n, i, g.turn) + defend * shape(g.cells, g.n, i, other$f(g.turn));
function choose$g(g, level, rand = Math.random) {
  const list = candidates$1(g);
  const me = g.turn;
  for (const i of list) if (shape(g.cells, g.n, i, me) >= 1e7) return i;
  for (const i of list) if (shape(g.cells, g.n, i, other$f(me)) >= 1e7) return i;
  if (level !== "easy") {
    const winNext = list.find((i) => shape(g.cells, g.n, i, me) >= 3e5);
    if (winNext !== void 0) return winNext;
    const threat = list.map((i) => ({ i, v: shape(g.cells, g.n, i, other$f(me)) })).filter((x) => x.v >= 3e5).sort((x, y) => y.v - x.v)[0];
    if (threat) return threat.i;
  }
  const defend = level === "easy" ? 0.5 : 0.95;
  const ranked = list.map((i) => ({ i, v: worth$2(g, i, defend) })).sort((a, b) => b.v - a.v);
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
    const reply = choose$g(after2, "fair", rand);
    const back = place$3(after2, reply);
    if (back.winner) continue;
    const list2 = candidates$1(back);
    const mine2 = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, me)), 0);
    const theirs = list2.reduce((m, j) => Math.max(m, shape(back.cells, back.n, j, other$f(me))), 0);
    const score2 = mine2 - theirs * 0.5;
    if (score2 > bv) {
      bv = score2;
      best = i;
    }
  }
  return best;
}
function gomokuRules(size2) {
  return {
    fresh: () => newGame$d(size2),
    turn: (g) => g.over ? null : g.turn === 1 ? 0 : 1,
    legal: (g, i, by) => !g.over && (by === void 0 || by === g.turn - 1) && Number.isInteger(i) && i >= 0 && i < g.n * g.n && !g.cells[i],
    apply: (g, i) => place$3(g, i),
    encode: (g) => ({ n: g.n, moves: g.moves }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$6.includes(o.n)) return null;
      const n = o.n;
      if (!Array.isArray(o.moves) || o.moves.length > n * n) return null;
      let g = newGame$d(n);
      for (const i of o.moves) {
        if (g.over || !Number.isInteger(i) || i < 0 || i >= n * n || g.cells[i]) return null;
        g = place$3(g, i);
      }
      return g;
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 169 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$o, choose: (g, level) => choose$g(g, level) },
    result: (g) => !g.over ? null : g.winner ? g.winner === 1 ? 0 : 1 : "draw",
    begun: (g) => g.moves.length > 0
  };
}
const other$e = (w) => w === 1 ? 2 : 1;
const owner$1 = (p) => p === 0 ? 0 : p === 1 || p === 3 ? 1 : 2;
const isKing = (p) => p >= 3;
const rowOf = (i) => i >> 2;
const colOf = (i) => 2 * (i & 3) + (rowOf(i) % 2 === 0 ? 1 : 0);
const at$3 = (r, c) => r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0 ? -1 : r * 4 + (c >> 1);
const DRAW_AFTER$2 = 80;
function newGame$c() {
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
      const over2 = at$3(r + dr, c + dc);
      const land2 = at$3(r + 2 * dr, c + 2 * dc);
      if (over2 < 0 || land2 < 0) continue;
      const o = owner$1(board2[over2]);
      if (!o || o === me || taken.includes(over2)) continue;
      if (board2[land2] && land2 !== from) continue;
      further = true;
      const p2 = [...path2, land2];
      const t2 = [...taken, over2];
      if (crowns(piece, land2)) out.push({ path: p2, taken: t2 });
      else walk(land2, p2, t2);
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
      const to = at$3(rowOf(i) + dr, colOf(i) + dc);
      if (to >= 0 && !g.board[to]) steps2.push({ path: [i, to], taken: [] });
    }
  }
  return jumps.length ? jumps : steps2;
}
function play$b(g, m) {
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
    turn: other$e(g.turn),
    quiet: m.taken.length || wasMan ? 0 : g.quiet + 1,
    winner: 0
  };
  if (!moves$4(next2).length) next2.winner = g.turn;
  else if (next2.quiet >= DRAW_AFTER$2) next2.winner = 3;
  return next2;
}
const LEVELS$n = ["easy", "fair", "hard"];
const DEPTH$6 = { easy: 2, fair: 4, hard: 6 };
function value$9(g, me) {
  if (g.winner === me) return 1e5;
  if (g.winner === other$e(me)) return -1e5;
  if (g.winner === 3) return 0;
  let v = 0;
  let mine2 = 0;
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
      mine2++;
    } else {
      v -= x;
      theirs++;
    }
  }
  if (mine2 !== theirs) v += Math.sign(mine2 - theirs) * (24 - mine2 - theirs) * 4;
  return v;
}
function search$8(g, me, depth, alpha, beta) {
  if (g.winner) return value$9(g, me) + depth * (g.winner === me ? 1 : g.winner === 3 ? 0 : -1);
  const list = moves$4(g);
  if (depth <= 0 && (!list[0].taken.length || depth <= -6)) return value$9(g, me);
  if (g.turn === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(best2, search$8(play$b(g, m), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(best, search$8(play$b(g, m), me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$f(g, level, rand = Math.random) {
  const list = moves$4(g);
  if (list.length === 1) return list[0];
  if (level === "easy" && rand() < 0.25) return list[Math.floor(rand() * list.length)];
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const m of list) {
    const v = search$8(play$b(g, m), me, DEPTH$6[level] - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_MOVES$3 = 500;
const same$3 = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fresh$o = () => ({ g: newGame$c(), list: [], last: null });
function replay$j(list) {
  let d = fresh$o();
  for (const path2 of list) {
    const m = moves$4(d.g).find((x) => same$3(x.path, path2));
    if (!m) return null;
    d = { g: play$b(d.g, m), list: [...d.list, m.path], last: m };
  }
  return d;
}
const isPath = (x) => Array.isArray(x) && x.length >= 2 && x.length <= 10 && x.every((i) => Number.isInteger(i) && i >= 0 && i < 32);
const draughtsRules = {
  fresh: fresh$o,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, path2, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && d.list.length < MAX_MOVES$3 && moves$4(d.g).some((m) => same$3(m.path, path2)),
  apply: (d, path2) => {
    const m = moves$4(d.g).find((x) => same$3(x.path, path2));
    return m ? { g: play$b(d.g, m), list: [...d.list, m.path], last: m } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > MAX_MOVES$3 || !list.every(isPath)) return null;
    return replay$j(list);
  },
  readMove: (x) => isPath(x) ? [...x] : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$n, choose: (d, level) => choose$f(d.g, level).path },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
function board(rows, cols) {
  const H2 = (rows + 1) * cols;
  const L = H2 + rows * (cols + 1);
  const boxesOf = Array.from({ length: L }, () => []);
  const linesOf = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const b = r * cols + c;
      const lines = [
        r * cols + c,
        (r + 1) * cols + c,
        H2 + r * (cols + 1) + c,
        H2 + r * (cols + 1) + c + 1
      ];
      linesOf.push(lines);
      for (const l of lines) boxesOf[l].push(b);
    }
  return { rows, cols, boxesOf, linesOf };
}
const lineCount = (b) => b.boxesOf.length;
function newGame$b(rows, cols, first = 0) {
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
const over$6 = (g) => g.score[0] + g.score[1] === g.owner.length;
const open$3 = (g) => {
  const out = [];
  for (let l = 0; l < g.drawn.length; l++) if (!g.drawn[l]) out.push(l);
  return out;
};
function play$a(g, l) {
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
  play$a(h, l);
  if (h.turn === g.turn) return 0;
  let n = 0;
  for (; ; ) {
    let found = -1;
    for (let k = 0; k < h.drawn.length && found < 0; k++) if (takes(h, k)) found = k;
    if (found < 0) return n;
    n += play$a(h, found).length;
  }
}
const LEVELS$m = ["easy", "fair", "hard"];
const pickOf = (list, rand) => list[Math.floor(rand() * list.length)];
function fair(g, rand) {
  const all = open$3(g);
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
  while (!over$6(h)) play$a(h, fair(h, rand));
  return h.score[me] - h.score[me === 0 ? 1 : 0];
}
function choose$e(g, level, rand = Math.random) {
  const all = open$3(g);
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
    play$a(h, l);
    const v = over$6(h) ? h.score[me] - h.score[me === 0 ? 1 : 0] : rollout(h, me, rand);
    if (v > bv) {
      bv = v;
      best = [l];
    } else if (v === bv) best.push(l);
  }
  const take = best.filter((l) => takes(g, l));
  return pickOf(take.length ? take : best, rand);
}
const SIZES$5 = [3, 4, 5, 6];
const after$9 = (d, l) => {
  const g = copy(d.g);
  play$a(g, l);
  return { g, lines: [...d.lines, l] };
};
function replay$i(n, lines) {
  let d = { g: newGame$b(n, n, 0), lines: [] };
  const total2 = lineCount(d.g.b);
  for (const l of lines) {
    if (!Number.isInteger(l) || l < 0 || l >= total2 || d.g.drawn[l]) return null;
    d = after$9(d, l);
  }
  return d;
}
function dotsRules(size2) {
  return {
    fresh: () => ({ g: newGame$b(size2, size2, 0), lines: [] }),
    turn: (d) => over$6(d.g) ? null : d.g.turn,
    legal: (d, l, by) => !over$6(d.g) && (by === void 0 || by === d.g.turn) && Number.isInteger(l) && l >= 0 && l < lineCount(d.g.b) && !d.g.drawn[l],
    apply: (d, l) => after$9(d, l),
    encode: (d) => ({ n: d.g.b.rows, lines: d.lines }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$5.includes(o.n) || !Array.isArray(o.lines)) return null;
      return replay$i(o.n, o.lines);
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 100 ? x : null,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$m, choose: (d, level) => choose$e(copy(d.g), level) },
    result: (d) => {
      if (!over$6(d.g)) return null;
      const [a, b] = d.g.score;
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (d) => d.lines.length > 0
  };
}
const SIZES$4 = { small: [6, 5], classic: [7, 6], wide: [9, 7] };
const other$d = (w) => w === 1 ? 2 : 1;
function newGrid(size2, need = 4) {
  const [cols, rows] = SIZES$4[size2];
  return { cols, rows, need, cells: Array(cols * rows).fill(0), heights: Array(cols).fill(0) };
}
const open$2 = (g) => g.heights.map((h, c) => h < g.rows ? c : -1).filter((c) => c >= 0);
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
const LEVELS$l = ["easy", "fair", "hard"];
const DEPTH$5 = { easy: 1, fair: 3, hard: 6 };
const depthFor = (g, level) => level !== "hard" ? DEPTH$5[level] : g.cols <= 6 ? 8 : g.cols > 7 ? 5 : 6;
const WINDOWS = /* @__PURE__ */ new Map();
function windows(g) {
  const key2 = `${g.cols}x${g.rows}x${g.need}`;
  let list = WINDOWS.get(key2);
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
  WINDOWS.set(key2, list);
  return list;
}
function score$5(g, me) {
  let s = 0;
  const them = other$d(me);
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
const centreFirst = (g) => open$2(g).sort((a, b) => Math.abs(a - (g.cols - 1) / 2) - Math.abs(b - (g.cols - 1) / 2));
function search$7(g, who, me, depth, alpha, beta) {
  const cols = centreFirst(g);
  if (!cols.length) return 0;
  if (depth === 0) return score$5(g, me);
  let best = who === me ? -Infinity : Infinity;
  for (const c of cols) {
    const next2 = drop(g, c, who);
    let v;
    if (lineAt(next2, c)) v = (who === me ? 1 : -1) * (1e5 + depth);
    else v = search$7(next2, other$d(who), me, depth - 1, alpha, beta);
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
function choose$d(g, who, level, rand = Math.random) {
  const cols = centreFirst(g);
  for (const c of cols) if (lineAt(drop(g, c, who), c)) return c;
  if (level === "easy" && rand() < 0.35) {
    const safe2 = cols.filter((c) => {
      const after2 = drop(g, c, who);
      return !open$2(after2).some((d) => lineAt(drop(after2, d, other$d(who)), d));
    });
    const list = safe2.length ? safe2 : cols;
    return list[Math.floor(rand() * list.length)];
  }
  let best = [];
  let bv = -Infinity;
  for (const c of cols) {
    const v = search$7(drop(g, c, who), other$d(who), who, depthFor(g, level) - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [c];
    } else if (v === bv) best.push(c);
  }
  return best[Math.floor(rand() * best.length)];
}
function fourRowRules(size2, need) {
  return {
    fresh: () => ({ g: newGrid(size2, need), turn: 1, winner: 0, line: null, moves: 0 }),
    turn: (s) => s.turn === null ? null : s.turn - 1,
    legal: (s, col) => s.turn !== null && Number.isInteger(col) && col >= 0 && col < s.g.cols && s.g.heights[col] < s.g.rows,
    apply: (s, col) => {
      const who = s.turn;
      const g = drop(s.g, col, who);
      const line = lineAt(g, col);
      const moves2 = s.moves + 1;
      if (line) return { g, turn: null, winner: who, line, moves: moves2 };
      if (full(g)) return { g, turn: null, winner: 0, line: null, moves: moves2 };
      return { g, turn: other$d(who), winner: 0, line: null, moves: moves2 };
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
function fourRowMatchRules(size2, need) {
  const base = fourRowRules(size2, need);
  return {
    ...base,
    legal: (s, col, by) => (by === void 0 || by === (s.turn ?? 0) - 1) && base.legal(s, col),
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$l,
      choose: (s, level) => choose$d(s.g, s.turn ?? 2, level)
    },
    result: (s) => s.turn !== null ? null : s.winner === 0 ? "draw" : s.winner === 1 ? 0 : 1,
    begun: (s) => s.moves > 0
  };
}
function readFourSettings(s) {
  const size2 = s.size ?? "classic";
  const need = s.need ?? 4;
  if (typeof size2 !== "string" || !Object.hasOwn(SIZES$4, size2)) return null;
  if (need !== 4 && need !== 5) return null;
  if (size2 === "small" && need === 5) return null;
  return [size2, need];
}
const ints = (v, n, lo, hi) => Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x) && x >= lo && x <= hi) ? v : null;
function readFourGame(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const { cols, rows, need } = o;
  if (!Object.values(SIZES$4).some(([c, r]) => c === cols && r === rows)) return null;
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
const R$1 = 0.0286;
const POCKET = 0.062;
const POCKETS = [
  { x: 0, y: 0 },
  { x: TW / 2, y: -0.012 },
  { x: TW, y: 0 },
  { x: 0, y: TH },
  { x: TW / 2, y: TH + 0.012 },
  { x: TW, y: TH }
];
const MAX_SPEED$2 = 5.2;
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
      const dx = row * R$1 * Math.sqrt(3) * 1.002;
      const dy = (i - row / 2) * R$1 * 2.004;
      balls.push({ n, x: FOOT.x + dx, y: FOOT.y + dy, vx: 0, vy: 0, down: false });
    }
  return balls.sort((p, q) => p.n - q.n);
}
const near = (b) => POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < POCKET + R$1 * 0.6);
function strike(balls, angle, power, record = false) {
  const bs = balls.map((b) => ({ ...b }));
  const cue = bs.find((b) => b.n === 0);
  const sp = Math.max(0, Math.min(1, power)) * MAX_SPEED$2;
  cue.vx = Math.cos(angle) * sp;
  cue.vy = Math.sin(angle) * sp;
  const log = { first: -1, down: [], rail: false, time: 0, frames: [] };
  const dt = 1 / 600;
  let step2 = 0;
  for (let t = 0; t < 30; t += dt) {
    if (record && step2++ % 10 === 0) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]));
    let moving2 = false;
    for (const b of bs) {
      if (b.down) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v === 0) continue;
      moving2 = true;
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
        if (b.x < R$1 || b.x > TW - R$1) {
          b.x = b.x < R$1 ? R$1 : TW - R$1;
          b.vx = (b.x === R$1 ? 1 : -1) * Math.abs(b.vx) * CUSHION;
          hit2 = true;
        }
        if (b.y < R$1 || b.y > TH - R$1) {
          b.y = b.y < R$1 ? R$1 : TH - R$1;
          b.vy = (b.y === R$1 ? 1 : -1) * Math.abs(b.vy) * CUSHION;
          hit2 = true;
        }
        if (hit2 && log.first >= 0) log.rail = true;
      } else {
        b.x = Math.max(-R$1, Math.min(TW + R$1, b.x));
        b.y = Math.max(-R$1, Math.min(TH + R$1, b.y));
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
        if (d2 >= 4 * R$1 * R$1 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const push = (2 * R$1 - d) / 2;
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
    if (!moving2) break;
  }
  if (record) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]));
  return { balls: bs, log };
}
function newGame$a(seed2, first = 0) {
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
  if (x < R$1 || x > TW - R$1 || y < R$1 || y > TH - R$1) return false;
  return g.balls.every((b) => b.down || b.n === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * R$1 + 2e-3);
}
function place$2(g, x, y) {
  if (!g.inHand || !canPlace(g, x, y)) return g;
  return place_(g, { x, y });
}
function spotFree(balls, n, at2, along) {
  const free = (x, y) => x >= R$1 && x <= TW - R$1 && y >= R$1 && y <= TH - R$1 && balls.every((b) => b.down || b.n === n || Math.hypot(b.x - x, b.y - y) >= 2 * R$1 + 2e-3);
  for (let k = 0; k <= 400; k++)
    for (const way of k ? [1, -1] : [1]) {
      const d = way * k * R$1 * 0.25;
      const p = along === "y" ? { x: at2.x, y: at2.y + d } : { x: at2.x + d, y: at2.y };
      if (free(p.x, p.y)) return p;
    }
  return at2;
}
function shoot$2(g, angle, power, record = false) {
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
  const mine2 = groups[w];
  const keep = !foul && potted.some((n) => mine2 ? groupOf(n) === mine2 : n !== 8);
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
const LEVELS$k = ["easy", "fair", "hard"];
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
    return Math.hypot(ax + dx * u - o.x, ay + dy * u - o.y) >= 2 * R$1;
  });
}
function plan$3(g, level, rand = Math.random) {
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
      const gx = o.x - px / pd * 2 * R$1;
      const gy = o.y - py / pd * 2 * R$1;
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
      const { game, log } = shoot$2(base, c.angle, power);
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
    const slack = d === 1 ? 4 * R$1 : R$1;
    if (bx < -slack || bx > TW + slack || by < -slack || by > TH + slack) return null;
    seen.add(n);
    out.push({ n, x: bx, y: by, vx: 0, vy: 0, down: d === 1 });
  }
  const up = out.filter((b) => !b.down);
  for (let i = 0; i < up.length; i++)
    for (let j = i + 1; j < up.length; j++)
      if (Math.hypot(up[i].x - up[j].x, up[i].y - up[j].y) < R$1) return null;
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
  fresh: () => ({ ...newGame$a(seed(), 0), last: null, prev: null }),
  turn: (g) => g.winner !== null ? null : g.turn,
  legal: (g, m, by) => g.winner === null && (by === void 0 || by === g.turn) && readShot$1(m) !== null && (m.x === void 0 || g.inHand && canPlace(g, m.x, m.y)),
  apply: (g, m) => {
    const base = m.x !== void 0 && g.inHand ? place$2(g, m.x, m.y) : g;
    const { game } = shoot$2(base, m.a, m.p);
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
    levels: LEVELS$k,
    choose: (g, level) => {
      const s = plan$3(g, level);
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
  const mine2 = storeOf(b, side);
  if (rules.captures && owner(board2, at2) === side && board2[at2] === 1) {
    const opp2 = opposite(board2, at2);
    if (board2[opp2] > 0) {
      captured = { from: opp2, seeds: board2[opp2] + 1 };
      board2[mine2] += board2[opp2] + 1;
      board2[opp2] = 0;
      board2[at2] = 0;
    }
  }
  let next2 = at2 === mine2 ? side : side === 0 ? 1 : 0;
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
const score$4 = (b) => [b[storeOf(b, 0)], b[storeOf(b, 1)]];
const LEVELS$j = ["easy", "fair", "hard"];
const DEPTH$4 = { easy: 1, fair: 4, hard: 9 };
function value$8(b, side) {
  const [a, c] = score$4(b);
  const me = c - a;
  return me * 100;
}
function search$6(b, side, me, depth, alpha, beta, rules) {
  const moves2 = legal$1(b, side);
  if (depth === 0 || moves2.length === 0) return value$8(b);
  const ordered = moves2.map((m) => ({ m, s: sow(b, m, side, rules) })).sort((x, y) => Number(y.s.next === side) - Number(x.s.next === side));
  if (side === me) {
    let best2 = -Infinity;
    for (const { s } of ordered) {
      const v = s.over ? value$8(s.board) * 10 : search$6(s.board, s.next, me, depth - 1, alpha, beta, rules);
      best2 = Math.max(best2, v);
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const { s } of ordered) {
    const v = s.over ? value$8(s.board) * 10 : search$6(s.board, s.next, me, depth - 1, alpha, beta, rules);
    best = Math.min(best, v);
    beta = Math.min(beta, v);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$c(b, side, level, rules, rand = Math.random) {
  const moves2 = legal$1(b, side);
  if (moves2.length === 1) return moves2[0];
  if (level === "easy" && rand() < 0.35) return moves2[Math.floor(rand() * moves2.length)];
  let best = [];
  let bv = -Infinity;
  for (const m of moves2) {
    const s = sow(b, m, side, rules);
    const v = s.over ? value$8(s.board) * 10 : search$6(s.board, s.next, side, DEPTH$4[level] - 1, -Infinity, Infinity, rules);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_SOWINGS = 400;
function fresh$n(rules) {
  return { rules, b: start(rules), turn: 0, pits: [], path: [] };
}
function after$8(g, pit) {
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
function replay$h(rules, pits) {
  if (pits.length > MAX_SOWINGS) return null;
  let g = fresh$n(rules);
  for (const p of pits) {
    if (g.turn === null || !Number.isInteger(p) || !legal$1(g.b, g.turn).includes(p))
      return null;
    g = after$8(g, p);
  }
  return g;
}
function mancalaRules(rules) {
  return {
    fresh: () => fresh$n(rules),
    turn: (g) => g.turn,
    legal: (g, pit, by) => g.turn !== null && (by === void 0 || by === g.turn) && g.pits.length < MAX_SOWINGS && Number.isInteger(pit) && legal$1(g.b, g.turn).includes(pit),
    apply: (g, pit) => after$8(g, pit),
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
      return replay$h(r, o.sown);
    },
    readMove: (x) => Number.isInteger(x) && x >= 0 && x < 14 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$j,
      choose: (g, level) => choose$c(g.b, 1, level, g.rules)
    },
    result: (g) => {
      if (g.turn !== null) return null;
      const [a, b] = score$4(g.b);
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (g) => g.pits.length > 0
  };
}
const other$c = (w) => w === 1 ? 2 : 1;
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
const newGame$9 = () => ({
  board: Array(24).fill(0),
  hand: [0, MEN, MEN],
  turn: 1,
  quiet: 0,
  winner: 0
});
const DRAW_AFTER$1 = 50;
const count$4 = (g, w) => g.board.filter((m) => m === w).length + g.hand[w];
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
    const flying = count$4(g, w) === 3;
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
      for (const t of takeable(b, other$c(w))) out.push({ from, to, take: t });
    } else out.push({ from, to, take: -1 });
  }
  return out;
}
function play$9(g, m) {
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
    turn: other$c(w),
    quiet: m.take >= 0 ? 0 : g.quiet + 1,
    winner: 0
  };
  const them = other$c(w);
  if (count$4(next2, them) < 3) next2.winner = w;
  else if (!moves$3(next2).length) next2.winner = w;
  else if (hand[1] === 0 && hand[2] === 0 && next2.quiet >= DRAW_AFTER$1) next2.winner = 3;
  return next2;
}
const LEVELS$i = ["easy", "fair", "hard"];
const DEPTH$3 = { easy: 1, fair: 2, hard: 4 };
function value$7(g, me) {
  if (g.winner === me) return 1e5;
  if (g.winner === other$c(me)) return -1e5;
  if (g.winner === 3) return 0;
  const them = other$c(me);
  let v = (count$4(g, me) - count$4(g, them)) * 100;
  for (const m of MILLS) {
    const mine2 = m.filter((p) => g.board[p] === me).length;
    const theirs = m.filter((p) => g.board[p] === them).length;
    const empty2 = 3 - mine2 - theirs;
    if (mine2 === 2 && empty2 === 1) v += 12;
    if (theirs === 2 && empty2 === 1) v -= 12;
    if (mine2 === 3) v += 6;
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
    return value$7(g, me) + (g.winner ? depth : 0) * (g.winner === me ? 1 : -1);
  const list = moves$3(g);
  list.sort((a, b) => Number(b.take >= 0) - Number(a.take >= 0));
  if (g.turn === me) {
    let best2 = -Infinity;
    for (const m of list) {
      best2 = Math.max(best2, search$5(play$9(g, m), me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of list) {
    best = Math.min(best, search$5(play$9(g, m), me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$b(g, level, rand = Math.random) {
  const list = moves$3(g);
  if (list.length === 1) return list[0];
  if (level === "easy" && rand() < 0.3) return list[Math.floor(rand() * list.length)];
  const me = g.turn;
  let best = [];
  let bv = -Infinity;
  for (const m of list) {
    const v = search$5(play$9(g, m), me, DEPTH$3[level] - 1, -Infinity, Infinity);
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_MOVES$2 = 1e3;
const same$2 = (a, b) => a.from === b.from && a.to === b.to && a.take === b.take;
const fresh$m = () => ({ g: newGame$9(), list: [], last: null });
function readMove$6(x) {
  if (!Array.isArray(x) || x.length !== 3) return null;
  const [from, to, take] = x;
  const ok = (v, none) => Number.isInteger(v) && v >= (none ? -1 : 0) && v < 24;
  return ok(from, true) && ok(to, false) && ok(take, true) ? { from, to, take } : null;
}
function replay$g(list) {
  if (list.length > MAX_MOVES$2) return null;
  let d = fresh$m();
  for (const x of list) {
    const asked = readMove$6(x);
    const m = asked && moves$3(d.g).find((y) => same$2(y, asked));
    if (!m) return null;
    d = { g: play$9(d.g, m), list: [...d.list, m], last: m };
  }
  return d;
}
const morrisRules = {
  fresh: fresh$m,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, m, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && d.list.length < MAX_MOVES$2 && moves$3(d.g).some((x) => same$2(x, m)),
  apply: (d, m) => {
    const real = moves$3(d.g).find((x) => same$2(x, m));
    return real ? { g: play$9(d.g, real), list: [...d.list, real], last: real } : d;
  },
  encode: (d) => ({ moves: d.list.map((m) => [m.from, m.to, m.take]) }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$g(list) : null;
  },
  // the wire carries a move as [from, to, take]; a room's own act carries the object
  readMove: (x) => readMove$6(
    Array.isArray(x) ? x : x && typeof x === "object" ? [x.from, x.to, x.take] : null
  ),
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$i, choose: (d, level) => choose$b(d.g, level) },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const SIZES$3 = [7, 9, 11];
const other$b = (p) => p === 1 ? 2 : 1;
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
const winner$2 = (b) => chain(b.cells, b.n, 1) ? 1 : chain(b.cells, b.n, 2) ? 2 : null;
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
const LEVELS$h = ["easy", "fair", "hard"];
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
        if (b.cells[x] === other$b(p) && b.cells[y] === 0) out.add(y);
        if (b.cells[y] === other$b(p) && b.cells[x] === 0) out.add(x);
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
  const root = node(-1, other$b(p), free.slice());
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
      toMove = other$b(toMove);
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
      toMove = other$b(toMove);
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
    for (let i = 0; i < left2.length; i++) cells[left2[i]] = i % 2 === 0 ? toMove : other$b(toMove);
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
function choose$a(b, p, level, rand = Math.random) {
  const free = [];
  b.cells.forEach((c, i) => {
    if (!c) free.push(i);
  });
  if (free.length === 1) return free[0];
  const now = winningMove(b, p);
  if (now !== null) return now;
  const threat = winningMove(b, other$b(p));
  if (threat !== null && level !== "easy") return threat;
  if (level === "hard") {
    const saves = bridgeSaves(b, p);
    if (saves.length === 1) return saves[0];
    return search$4(b, p, PLAYOUTS$1.hard, rand);
  }
  const wins2 = new Float64Array(b.cells.length);
  const plays2 = new Float64Array(b.cells.length);
  const cells = new Uint8Array(b.cells.length);
  const order2 = free.slice();
  const mine2 = Math.ceil(free.length / 2);
  for (let k = 0; k < PLAYOUTS$1[level]; k++) {
    for (let i = 0; i < cells.length; i++) cells[i] = b.cells[i];
    for (let i = order2.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = order2[i];
      order2[i] = order2[j];
      order2[j] = t;
    }
    for (let i = 0; i < order2.length; i++) cells[order2[i]] = i < mine2 ? p : other$b(p);
    const won2 = chain(cells, b.n, p) !== null;
    for (let i = 0; i < mine2; i++) {
      plays2[order2[i]]++;
      if (won2) wins2[order2[i]]++;
    }
  }
  let best = free[0];
  let bv = -1;
  for (const i of free) {
    const v = plays2[i] ? wins2[i] / plays2[i] : 0;
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}
const SWAP = -1;
const fresh$l = (n, swapRule) => ({
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
function after$7(g, m) {
  const p = g.turn;
  const b = m === SWAP ? swap(g.b) : place$1(g.b, m, p);
  const last = m === SWAP ? b.cells.findIndex((c) => c) : m;
  return { ...g, b, turn: winner$2(b) ? null : other$b(p), moves: [...g.moves, m], last };
}
function replay$f(n, swapRule, moves2) {
  if (moves2.length > n * n + 1) return null;
  let g = fresh$l(n, swapRule);
  for (const m of moves2) {
    if (!isLegal(g, m)) return null;
    g = after$7(g, m);
  }
  return g;
}
function readHexSettings(s) {
  const size2 = s.size ?? 9;
  const swap2 = s.swap ?? false;
  if (!SIZES$3.includes(size2) || typeof swap2 !== "boolean") return null;
  return [size2, swap2];
}
function hexRules(size2, swapRule) {
  return {
    fresh: () => fresh$l(size2, swapRule),
    turn: (g) => g.turn === null ? null : g.turn === 1 ? 0 : 1,
    legal: (g, m, by) => (by === void 0 || by === (g.turn ?? 0) - 1) && isLegal(g, m),
    apply: (g, m) => after$7(g, m),
    encode: (g) => ({ n: g.b.n, swap: g.swapRule, moves: g.moves }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$3.includes(o.n)) return null;
      if (typeof o.swap !== "boolean" || !Array.isArray(o.moves)) return null;
      return replay$f(o.n, o.swap, o.moves);
    },
    readMove: (x) => Number.isInteger(x) && x >= SWAP && x < 121 ? x : null,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$h,
      choose: (g, level) => canSwap(g) && wantsSwap(g.b) ? SWAP : choose$a(g.b, 2, level)
    },
    result: (g) => {
      const w = winner$2(g.b);
      return w === null ? null : w === 1 ? 0 : 1;
    },
    begun: (g) => g.moves.length > 0
  };
}
const other$a = (w) => w === 1 ? 2 : 1;
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
const newGame$8 = () => ({
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
function play$8(g, at2) {
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
  return { cells, boards, next: boards[s] ? -1 : s, turn: other$a(g.turn), winner: winner2, last: at2 };
}
const LEVELS$g = ["easy", "fair", "hard"];
const ITERATIONS = { easy: 0, fair: 1500, hard: 12e3 };
function randomFinish(g, rand) {
  let h = g;
  while (!h.winner) {
    const list = moves$2(h);
    h = play$8(h, list[Math.floor(rand() * list.length)]);
  }
  return h.winner;
}
function choose$9(g, level, rand = Math.random) {
  const list = moves$2(g);
  if (list.length === 1) return list[0];
  for (const m of list) if (play$8(g, m).winner === g.turn) return m;
  if (level === "easy") {
    const take = list.filter((m) => play$8(g, m).boards[Math.floor(m / 9)] === g.turn);
    const pool = take.length && rand() < 0.7 ? take : list;
    return pool[Math.floor(rand() * pool.length)];
  }
  const root = { move: -1, who: other$a(g.turn), kids: [], untried: list.slice(), n: 0, w: 0 };
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
      state = play$8(state, node2.move);
      path2.push(node2);
    }
    if (node2.untried.length) {
      const i = Math.floor(rand() * node2.untried.length);
      const m = node2.untried[i];
      node2.untried[i] = node2.untried[node2.untried.length - 1];
      node2.untried.pop();
      const who = state.turn;
      state = play$8(state, m);
      const kid = { move: m, who, kids: [], untried: moves$2(state), n: 0, w: 0 };
      node2.kids.push(kid);
      node2 = kid;
      path2.push(node2);
    }
    const result2 = state.winner || randomFinish(state, rand);
    for (const nd of path2) {
      nd.n++;
      nd.w += result2 === 3 ? 0.5 : result2 === nd.who ? 1 : 0;
    }
  }
  let best = root.kids[0];
  for (const k of root.kids) if (k.n > best.n) best = k;
  return best.move;
}
const fresh$k = () => ({ g: newGame$8(), list: [] });
function replay$e(list) {
  if (list.length > 81) return null;
  let d = fresh$k();
  for (const at2 of list) {
    if (!Number.isInteger(at2) || !moves$2(d.g).includes(at2)) return null;
    d = { g: play$8(d.g, at2), list: [...d.list, at2] };
  }
  return d;
}
const ultimateRules = {
  fresh: fresh$k,
  turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, at2, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && Number.isInteger(at2) && moves$2(d.g).includes(at2),
  apply: (d, at2) => ({ g: play$8(d.g, at2), list: [...d.list, at2] }),
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$e(list) : null;
  },
  readMove: (x) => Number.isInteger(x) && x >= 0 && x < 81 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$g, choose: (d, level) => choose$9(d.g, level) },
  result: (d) => !d.g.winner ? null : d.g.winner === 3 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const SIZES$2 = [6, 8];
const other$9 = (s) => s === 1 ? 2 : 1;
const forward = (s) => s === 1 ? -1 : 1;
const advance = (n, i, s) => {
  const r = Math.floor(i / n);
  return s === 1 ? n - 1 - r : r;
};
function newGame$7(n = 8, first = 1) {
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
  const them = other$9(s);
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
const count$3 = (b, s) => b.cells.reduce((t, x) => t + (x === s ? 1 : 0), 0);
function play$7(g, m) {
  const cells = g.board.cells.slice();
  const s = g.turn;
  cells[m.to] = s;
  cells[m.from] = 0;
  const board2 = { n: g.board.n, cells };
  const them = other$9(s);
  const through = advance(board2.n, m.to, s) === board2.n - 1;
  const winner2 = through || count$3(board2, them) === 0 ? s : 0;
  return { board: board2, turn: them, winner: winner2, plies: g.plies + 1 };
}
const LEVELS$f = ["easy", "fair", "hard"];
const WIN = 1e6;
function covers(b, i, s) {
  const { n, cells } = b;
  const r = Math.floor(i / n) - forward(s);
  if (r < 0 || r >= n) return false;
  const c = i % n;
  return c > 0 && cells[r * n + c - 1] === s || c < n - 1 && cells[r * n + c + 1] === s;
}
function value$6(b, s) {
  const { n, cells } = b;
  const them = other$9(s);
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
  const key2 = (m) => (m.take ? 1e3 : 0) + advance(n, m.to, s);
  return list.sort((x, y) => key2(y) - key2(x));
}
let nodes = 0;
function search$3(b, s, depth, alpha, beta, ply) {
  if (++nodes > budget) throw CALLED_OFF;
  if (depth <= 0) return value$6(b, s);
  const list = movesOf$1(b, s);
  if (!list.length) return -WIN + ply;
  const n = b.n;
  const them = other$9(s);
  const cells = b.cells;
  let best = -Infinity;
  for (const m of order$1(list, b, s)) {
    if (advance(n, m.to, s) === n - 1) return WIN - ply;
    const was = cells[m.to];
    cells[m.to] = s;
    cells[m.from] = 0;
    const gone = was === them && count$3(b, them) === 0;
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
  const them = other$9(s);
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
        v = was === them && count$3(b, them) === 0 ? WIN : -search$3(b, them, depth - 1, -Infinity, Infinity, 1);
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
function choose$8(g, level, rand = Math.random) {
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
const fresh$j = (n) => ({ g: newGame$7(n, 1), list: [], last: null });
const find$3 = (g, from, to) => moves$1(g).find((m) => m.from === from && m.to === to) ?? null;
function after$6(d, m) {
  return { g: play$7(d.g, m), list: [...d.list, [m.from, m.to]], last: m };
}
function replay$d(n, list) {
  if (list.length > n * n * n) return null;
  let d = fresh$j(n);
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 ? find$3(d.g, x[0], x[1]) : null;
    if (!m) return null;
    d = after$6(d, m);
  }
  return d;
}
function readMove$5(x) {
  const o = x;
  const [from, to] = Array.isArray(o) ? o : o && typeof o === "object" ? [o.from, o.to] : [];
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < 64 && to < 64 ? { from, to, take: false } : null;
}
function readBreakthroughSize(s) {
  const size2 = s.size ?? 8;
  return SIZES$2.includes(size2) ? size2 : null;
}
function breakthroughRules(size2) {
  return {
    fresh: () => fresh$j(size2),
    turn: (d) => d.g.winner ? null : d.g.turn === 1 ? 0 : 1,
    legal: (d, m, by) => !d.g.winner && (by === void 0 || by === d.g.turn - 1) && find$3(d.g, m.from, m.to) !== null,
    apply: (d, m) => {
      const real = find$3(d.g, m.from, m.to);
      return real ? after$6(d, real) : d;
    },
    encode: (d) => ({ n: d.g.board.n, moves: d.list }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$2.includes(o.n) || !Array.isArray(o.moves)) return null;
      return replay$d(o.n, o.moves);
    },
    readMove: readMove$5,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$f, choose: (d, level) => choose$8(d.g, level) },
    result: (d) => !d.g.winner ? null : d.g.winner === 1 ? 0 : 1,
    begun: (d) => d.list.length > 0
  };
}
const SIZES$1 = [7, 9];
const FENCES = { 7: 7, 9: 10 };
const goalRow = (g, w) => w === 0 ? 0 : g.n - 1;
function newGame$6(n = 9, first = 0) {
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
function open$1(g, r, c, dr, dc) {
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
    if (!open$1(g, r, c, dr, dc)) continue;
    const nr = r + dr;
    const nc = c + dc;
    if (nr !== or || nc !== oc) {
      out.push([nr, nc]);
      continue;
    }
    if (open$1(g, nr, nc, dr, dc)) {
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
      if (open$1(g, nr, nc, sr, sc)) out.push([nr + sr, nc + sc]);
  }
  return out;
}
function dist$1(g, w) {
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
        if (!open$1(g, r, c, dr, dc)) continue;
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
        if (!open$1(g, r, c, dr, dc)) continue;
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
  return dist$1(t, 0) < Infinity && dist$1(t, 1) < Infinity ? null : "shut";
}
const fenceOk = (g, o, r, c, w = g.turn) => fenceTrouble(g, o, r, c, w) === null;
function withFence(g, o, r, c) {
  const h = o === "h" ? g.h.slice() : g.h;
  const v = o === "v" ? g.v.slice() : g.v;
  (o === "h" ? h : v)[slot(g, r, c)] = 1;
  return { ...g, h, v };
}
function play$6(g, m) {
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
const LEVELS$e = ["easy", "fair", "hard"];
function judge(g, w, keep = 0.35) {
  if (g.winner !== null) return g.winner === w ? 1e3 - g.plies : -1e3 + g.plies;
  const other2 = w === 0 ? 1 : 0;
  const mine2 = dist$1(g, w);
  const theirs = dist$1(g, other2);
  const tempo = g.turn === w ? 0.5 : -0.5;
  return theirs - mine2 + tempo + keep * (g.left[w] - g.left[other2]);
}
function fenceIdeas(g, against, reach = 4) {
  const way = [g.pos[against], ...path(g, against).slice(0, reach)];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const add2 = (o, r, c) => {
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
      add2("h", gr, c);
      add2("h", gr, c - 1);
    } else {
      const gc = Math.min(c, nc);
      add2("v", r, gc);
      add2("v", r - 1, gc);
    }
  }
  return out;
}
function options$1(g, reach) {
  const out = steps(g).map((to) => ({ kind: "step", to }));
  if (g.left[g.turn] > 0) out.push(...fenceIdeas(g, g.turn === 0 ? 1 : 0, reach));
  return out;
}
function search$2(g, depth, alpha, beta, me, reach, keep) {
  if (depth === 0 || g.winner !== null) return judge(g, me, keep);
  const mine2 = g.turn === me;
  const opts = options$1(g, reach);
  let best = mine2 ? -Infinity : Infinity;
  for (const m of opts) {
    const v = search$2(play$6(g, m), depth - 1, alpha, beta, me, reach, keep);
    if (mine2) {
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
function choose$7(g, level, rand = Math.random) {
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
  const opts = [best, ...options$1(g, reach + 2)];
  for (const m of opts) {
    const v = search$2(play$6(g, m), depth - 1, -Infinity, Infinity, me, reach, keep) + rand() * slack;
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return best;
}
const MAX_MOVES$1 = 600;
const fresh$i = (n) => ({ g: newGame$6(n, 0), list: [], last: null });
function isMove$1(g, m) {
  if (g.winner !== null) return false;
  if (m.kind === "step") return steps(g).some(([r, c]) => r === m.to[0] && c === m.to[1]);
  return fenceOk(g, m.o, m.r, m.c);
}
const packMove = (m) => m.kind === "step" ? ["s", m.to[0], m.to[1]] : [m.o, m.r, m.c];
function readMove$4(x) {
  const o = Array.isArray(x) ? x : x && typeof x === "object" ? packMove(x) : null;
  if (!o || o.length !== 3) return null;
  const [k, r, c] = o;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 8 || c > 8)
    return null;
  if (k === "s") return { kind: "step", to: [r, c] };
  if (k === "h" || k === "v") return { kind: "fence", o: k, r, c };
  return null;
}
function replay$c(n, list) {
  if (list.length > MAX_MOVES$1) return null;
  let d = fresh$i(n);
  for (const x of list) {
    const m = readMove$4(x);
    if (!m || !isMove$1(d.g, m)) return null;
    d = { g: play$6(d.g, m), list: [...d.list, m], last: m };
  }
  return d;
}
function readFencesSize(s) {
  const size2 = s.size ?? 9;
  return SIZES$1.includes(size2) ? size2 : null;
}
function fencesRules(size2) {
  return {
    fresh: () => fresh$i(size2),
    turn: (d) => d.g.winner !== null ? null : d.g.turn,
    legal: (d, m, by) => (by === void 0 || by === d.g.turn) && d.list.length < MAX_MOVES$1 && isMove$1(d.g, m),
    apply: (d, m) => ({ g: play$6(d.g, m), list: [...d.list, m], last: m }),
    encode: (d) => ({ n: d.g.n, moves: d.list.map(packMove) }),
    decode: (x) => {
      const o = x;
      if (!o || !SIZES$1.includes(o.n) || !Array.isArray(o.moves)) return null;
      return replay$c(o.n, o.moves);
    },
    readMove: readMove$4,
    modes: ["versus", "together"],
    computer: { side: 1, levels: LEVELS$e, choose: (d, level) => choose$7(d.g, level) },
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
const at$2 = (q, r) => index.get(`${q},${r}`) ?? -1;
const NEAR = HOLES.map((h) => DIRS.map(([dq, dr]) => at$2(h.q + dq, h.r + dr)));
const HOME = {
  1: HOLES.map((h, i) => h.r >= 5 ? i : -1).filter((i) => i >= 0),
  2: HOLES.map((h, i) => h.r <= -5 ? i : -1).filter((i) => i >= 0)
};
const goalOf = (s) => HOME[s === 1 ? 2 : 1];
const other$8 = (s) => s === 1 ? 2 : 1;
function newGame$5(first = 1) {
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
        const land2 = NEAR[over2][d];
        if (land2 < 0 || cells[land2] && land2 !== from || seen.has(land2) || land2 === from) continue;
        seen.add(land2);
        const p = [...path2, land2];
        out.push({ from, to: land2, path: p });
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
function play$5(g, m) {
  const cells = g.cells.slice();
  cells[m.to] = g.turn;
  cells[m.from] = 0;
  const winner2 = won(cells, g.turn) ? g.turn : 0;
  return { cells, turn: other$8(g.turn), winner: winner2, plies: g.plies + 1 };
}
const progress = (i, s) => s === 1 ? 8 - HOLES[i].r : HOLES[i].r + 8;
const wide = (i) => Math.abs(HOLES[i].q - HOLES[i].s);
const LEVELS$d = ["easy", "fair", "hard"];
function value$5(cells, side) {
  const sum2 = (s) => {
    let t = 0;
    for (let i = 0; i < cells.length; i++)
      if (cells[i] === s) t += (goalOf(s).includes(i) ? 18 : progress(i, s)) * 10 - wide(i);
    return t;
  };
  if (won(cells, side)) return 1e6;
  if (won(cells, other$8(side))) return -1e6;
  return sum2(side) - sum2(other$8(side));
}
const gain = (m, s) => progress(m.to, s) - progress(m.from, s);
function choose$6(g, level, rand = Math.random) {
  const s = g.turn;
  const list = moves(g);
  const apply2 = (cells, m, who) => {
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
    const ranked = list.map((m) => ({ m, v: value$5(apply2(g.cells, m, s), s) })).sort((x, y) => y.v - x.v);
    return ranked[Math.floor(rand() * Math.min(4, ranked.length))].m;
  }
  let best = [];
  let bv = -Infinity;
  for (const m of shortlist(g.cells, s, level === "hard" ? 14 : 40)) {
    const c1 = apply2(g.cells, m, s);
    let v;
    if (won(c1, s)) v = 1e6;
    else if (level === "fair") v = value$5(c1, s);
    else {
      let worst = Infinity;
      for (const r of shortlist(c1, other$8(s), 8)) {
        const c2 = apply2(c1, r, other$8(s));
        let after2 = -Infinity;
        for (const m2 of shortlist(c2, s, 8)) after2 = Math.max(after2, value$5(apply2(c2, m2, s), s));
        worst = Math.min(worst, after2 === -Infinity ? value$5(c2, s) : after2);
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
const fresh$h = () => ({ g: newGame$5(1), list: [], last: null });
const over$5 = (d) => d.g.winner !== 0 || d.list.length >= DRAW_AFTER;
const find$2 = (g, from, to) => moves(g).find((m) => m.from === from && m.to === to) ?? null;
const after$5 = (d, m) => ({
  g: play$5(d.g, m),
  list: [...d.list, [m.from, m.to]],
  last: m
});
function replay$b(list) {
  if (list.length > DRAW_AFTER) return null;
  let d = fresh$h();
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 && !over$5(d) ? find$2(d.g, x[0], x[1]) : null;
    if (!m) return null;
    d = after$5(d, m);
  }
  return d;
}
function readMove$3(x) {
  const o = x;
  const [from, to] = Array.isArray(o) ? o : o && typeof o === "object" ? [o.from, o.to] : [];
  const ok = (v) => Number.isInteger(v) && v >= 0 && v < HOLES.length;
  return ok(from) && ok(to) ? { from, to, path: [] } : null;
}
const halmaRules = {
  fresh: fresh$h,
  turn: (d) => over$5(d) ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, m, by) => !over$5(d) && (by === void 0 || by === d.g.turn - 1) && find$2(d.g, m.from, m.to) !== null,
  apply: (d, m) => {
    const real = find$2(d.g, m.from, m.to);
    return real ? after$5(d, real) : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$b(list) : null;
  },
  readMove: readMove$3,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$d, choose: (d, level) => choose$6(d.g, level) },
  result: (d) => !over$5(d) ? null : d.g.winner === 0 ? "draw" : d.g.winner === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const N$2 = 9;
const other$7 = (w) => w === 1 ? 2 : 1;
const KOMI = 6.5;
const PASS = -1;
const newGame$4 = () => ({
  board: Array(N$2 * N$2).fill(0),
  turn: 1,
  ko: -1,
  passes: 0,
  taken: [0, 0, 0],
  over: false,
  last: -2,
  moves: 0
});
const NEIGH = Array.from({ length: N$2 * N$2 }, (_, i) => {
  const r = Math.floor(i / N$2);
  const c = i % N$2;
  const out = [];
  if (r > 0) out.push(i - N$2);
  if (r < N$2 - 1) out.push(i + N$2);
  if (c > 0) out.push(i - 1);
  if (c < N$2 - 1) out.push(i + 1);
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
function play$4(g, at2) {
  if (g.over) return null;
  const w = g.turn;
  if (at2 === PASS) {
    const passes = g.passes + 1;
    return {
      ...g,
      turn: other$7(w),
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
    if (board2[q] === other$7(w)) {
      const gr = group(board2, q);
      if (gr.liberties === 0) {
        for (const s of gr.stones) board2[s] = 0;
        caught = caught.concat(gr.stones);
      }
    }
  if (group(board2, at2).liberties === 0) return null;
  const mine2 = group(board2, at2);
  const ko = caught.length === 1 && mine2.stones.length === 1 && mine2.liberties === 1 ? caught[0] : -1;
  const taken = [0, g.taken[1], g.taken[2]];
  taken[w] += caught.length;
  return { board: board2, turn: other$7(w), ko, passes: 0, taken, over: false, last: at2, moves: g.moves + 1 };
}
const legal = (g) => g.board.map((_, i) => i).filter((i) => play$4(g, i) !== null);
function score$3(board2) {
  const owner2 = board2.slice();
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < N$2 * N$2; i++) {
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
const winner$1 = (g) => {
  const s = score$3(g.board);
  return s.black > s.white ? 1 : 2;
};
const LEVELS$c = ["easy", "fair", "hard"];
const PLAYOUTS = { easy: 250, fair: 1200, hard: 2500 };
function eye(board2, i, w) {
  return NEIGH[i].every((q) => board2[q] === w);
}
const stamp = new Float64Array(N$2 * N$2);
const stack = new Int32Array(N$2 * N$2);
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
  const empties2 = new Int32Array(N$2 * N$2);
  let last = start2.last;
  for (let k = 0; k < 220 && passes < 2; k++) {
    let n = 0;
    if (last >= 0 && rand() < 0.9) {
      for (const q of [last, ...NEIGH[last]])
        if (board2[q] === other$7(turn)) {
          const lib = lastBreath(board2, q);
          if (lib >= 0) {
            empties2[n++] = lib;
            break;
          }
        }
    }
    if (!n) {
      for (let i = 0; i < N$2 * N$2; i++) if (board2[i] === 0 && !eye(board2, i, turn)) empties2[n++] = i;
    }
    let moved2 = false;
    while (n) {
      const j = Math.floor(rand() * n);
      const at2 = empties2[j];
      empties2[j] = empties2[--n];
      board2[at2] = turn;
      let caught = false;
      for (const q of NEIGH[at2])
        if (board2[q] === other$7(turn) && !breathes(board2, q)) {
          lift(board2, q);
          caught = true;
        }
      if (!caught && !breathes(board2, at2)) {
        board2[at2] = 0;
        continue;
      }
      moved2 = true;
      last = at2;
      break;
    }
    if (!moved2) {
      last = -1;
    }
    passes = moved2 ? 0 : passes + 1;
    turn = other$7(turn);
  }
  let black = 0;
  let white2 = KOMI;
  for (let i = 0; i < N$2 * N$2; i++) {
    const x = board2[i] || (eye(board2, i, 1) ? 1 : eye(board2, i, 2) ? 2 : 0);
    if (x === 1) black++;
    else if (x === 2) white2++;
  }
  return black - white2;
}
function choose$5(g, level, rand = Math.random) {
  const me = g.turn;
  if (g.passes === 1 && winner$1(g) === me) return PASS;
  const options2 = legal(g).filter((i) => !eye(g.board, i, me));
  if (!options2.length) return PASS;
  const stats = options2.map((at2) => {
    const next2 = play$4(g, at2);
    const caught = next2.taken[me] - g.taken[me];
    const mine2 = group(next2.board, at2);
    const saves = NEIGH[at2].some((q) => g.board[q] === me && group(g.board, q).liberties === 1) && mine2.liberties > 1;
    const bias = caught ? 0.03 * Math.min(5, caught) : saves ? 0.05 : mine2.liberties === 1 ? -0.1 : 0;
    return { at: at2, next: next2, n: 0, wins: 0, bias };
  });
  const total2 = PLAYOUTS[level];
  for (let k = 0; k < total2; k++) {
    let pick2 = stats[0];
    let bv = -Infinity;
    for (const s of stats) {
      const v = s.n === 0 ? Infinity : s.wins / s.n + s.bias + 0.7 * Math.sqrt(Math.log(k + 1) / s.n);
      if (v > bv) {
        bv = v;
        pick2 = s;
      }
    }
    pick2.n++;
    const margin = playout(pick2.next, rand) * (me === 1 ? 1 : -1);
    pick2.wins += (margin > 0 ? 0.7 : 0) + 0.3 * (0.5 + 0.5 * Math.tanh(margin / 10));
  }
  const most = Math.max(...stats.map((x) => x.n));
  const best = stats.filter((x) => x.n >= most / 2).reduce((a, x) => x.wins / x.n + x.bias > a.wins / a.n + a.bias ? x : a);
  if (best.wins / Math.max(1, best.n) < 0.08 && g.moves > 30) return PASS;
  return best.at;
}
const MAX_MOVES = 400;
const fresh$g = () => ({ g: newGame$4(), list: [] });
const over$4 = (d) => d.g.over || d.list.length >= MAX_MOVES;
function replay$a(list) {
  if (list.length > MAX_MOVES) return null;
  let d = fresh$g();
  for (const at2 of list) {
    if (over$4(d) || !Number.isInteger(at2) || at2 < PASS || at2 >= N$2 * N$2)
      return null;
    const g = play$4(d.g, at2);
    if (!g) return null;
    d = { g, list: [...d.list, at2] };
  }
  return d;
}
const goRules = {
  fresh: fresh$g,
  turn: (d) => over$4(d) ? null : d.g.turn === 1 ? 0 : 1,
  legal: (d, at2, by) => !over$4(d) && (by === void 0 || by === d.g.turn - 1) && Number.isInteger(at2) && at2 >= PASS && at2 < N$2 * N$2 && play$4(d.g, at2) !== null,
  apply: (d, at2) => {
    const g = play$4(d.g, at2);
    return g ? { g, list: [...d.list, at2] } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$a(list) : null;
  },
  readMove: (x) => Number.isInteger(x) && x >= PASS && x < N$2 * N$2 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$c, choose: (d, level) => choose$5(d.g, level) },
  result: (d) => !over$4(d) ? null : winner$1(d.g) === 1 ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const N$1 = 7;
const onBoard = (r, c) => r >= 0 && c >= 0 && r < N$1 && c < N$1 && (r >= 2 && r <= 4 || c >= 2 && c <= 4);
const POINTS = [];
for (let r = 0; r < N$1; r++) for (let c = 0; c < N$1; c++) if (onBoard(r, c)) POINTS.push(r * N$1 + c);
function dirsAt(i) {
  const r = Math.floor(i / N$1);
  const c = i % N$1;
  const out = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0]
  ];
  if ((r + c) % 2 === 0) out.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  return out.filter(([dr, dc]) => onBoard(r + dr, c + dc));
}
const step$1 = (i, dr, dc) => i + dr * N$1 + dc;
const START_GEESE = POINTS.filter(
  (i) => Math.floor(i / N$1) <= 2 || Math.floor(i / N$1) === 3 && (i % N$1 <= 1 || i % N$1 >= 5)
);
const START_FOX = 3 * N$1 + 3;
const TAKE_TO_WIN = 6;
const IDLE_LIMIT = 16;
const MAX_PLIES = 400;
const newGame$3 = () => ({
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
const over$3 = (g) => g.winner !== null || g.drawn;
function gooseMoves(g) {
  const out = [];
  for (const i of g.geese)
    for (const [dr, dc] of dirsAt(i)) {
      if (dr < 0) continue;
      const j = step$1(i, dr, dc);
      if (!g.geese.has(j) && j !== g.fox) out.push({ path: [i, j], takes: [] });
    }
  return out;
}
function foxMoves(g) {
  const out = [];
  for (const [dr, dc] of dirsAt(g.fox)) {
    const j = step$1(g.fox, dr, dc);
    if (!g.geese.has(j)) out.push({ path: [g.fox, j], takes: [] });
  }
  const jump = (at2, path2, takes2) => {
    for (const [dr, dc] of dirsAt(at2)) {
      const over2 = step$1(at2, dr, dc);
      if (!g.geese.has(over2) || takes2.includes(over2)) continue;
      if (!dirsAt(over2).some(([a, b]) => a === dr && b === dc)) continue;
      const land2 = step$1(over2, dr, dc);
      if (g.geese.has(land2)) continue;
      const next2 = { path: [...path2, land2], takes: [...takes2, over2] };
      out.push(next2);
      jump(land2, next2.path, next2.takes);
    }
  };
  jump(g.fox, [g.fox], []);
  return out;
}
const movesFor = (g) => g.turn === "fox" ? foxMoves(g) : gooseMoves(g);
function play$3(g, m) {
  if (over$3(g)) return g;
  const geese = new Set(g.geese);
  let fox = g.fox;
  let taken = g.taken;
  let idle = g.idle;
  if (g.turn === "geese") {
    geese.delete(m.path[0]);
    geese.add(m.path[m.path.length - 1]);
    idle = m.path[1] - m.path[0] >= N$1 - 1 ? 0 : idle + 1;
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
const LEVELS$b = ["easy", "fair", "hard"];
const DEPTH$1 = { easy: 1, fair: 3, hard: 4 };
function value$4(g) {
  if (g.winner === "geese") return 1e6;
  if (g.winner === "fox") return -1e6;
  if (g.drawn) return 0;
  const reach = foxMoves(g);
  const threatened = new Set(reach.flatMap((m) => m.takes)).size;
  let down = 0;
  for (const i of g.geese) down += Math.floor(i / N$1);
  return 100 * g.geese.size - 4 * room(g) - 9 * reach.length - 25 * threatened + 2 * down - // the clock on the geese, harder the closer it runs
  g.idle * g.idle * 300 / (IDLE_LIMIT * IDLE_LIMIT);
}
function room(g) {
  const seen = /* @__PURE__ */ new Set([g.fox]);
  const todo = [g.fox];
  while (todo.length) {
    const i = todo.pop();
    for (const [dr, dc] of dirsAt(i)) {
      const j = step$1(i, dr, dc);
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
  if (depth === 0 || over$3(g) || looked$1 > BUDGET) return value$4(g);
  const moves2 = movesFor(g);
  if (g.turn === "geese") {
    let best2 = -Infinity;
    for (const m of moves2) {
      best2 = Math.max(best2, search$1(play$3(g, m), depth - 1, alpha, beta));
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const m of [...moves2].sort((a, b) => b.takes.length - a.takes.length)) {
    best = Math.min(best, search$1(play$3(g, m), depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}
function choose$4(g, level, rand = Math.random) {
  const moves2 = movesFor(g);
  const geese = g.turn === "geese";
  const win = moves2.find((m) => play$3(g, m).winner === g.turn);
  if (win) return win;
  looked$1 = 0;
  const scored = moves2.map((m) => ({
    m,
    v: (geese ? 1 : -1) * search$1(play$3(g, m), DEPTH$1[level] - 1, -Infinity, Infinity)
  }));
  scored.sort((a, b) => b.v - a.v);
  if (level === "easy") {
    const top = scored.slice(0, 3);
    return top[Math.floor(rand() * top.length)].m;
  }
  const best = scored.filter((x) => x.v === scored[0].v);
  return best[Math.floor(rand() * best.length)].m;
}
const fresh$f = () => ({ g: newGame$3(), list: [] });
const same$1 = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const find$1 = (g, path2) => over$3(g) ? null : movesFor(g).find((m) => same$1(m.path, path2)) ?? null;
const seatOf$1 = (g) => g.turn === "geese" ? 0 : 1;
function replay$9(list) {
  if (list.length > MAX_PLIES) return null;
  let d = fresh$f();
  for (const path2 of list) {
    const m = Array.isArray(path2) ? find$1(d.g, path2) : null;
    if (!m) return null;
    d = { g: play$3(d.g, m), list: [...d.list, m.path] };
  }
  return d;
}
function readMove$2(x) {
  const path2 = Array.isArray(x) ? x : x?.path;
  if (!Array.isArray(path2) || path2.length < 2 || path2.length > 12) return null;
  if (!path2.every((i) => Number.isInteger(i) && i >= 0 && i < N$1 * N$1)) return null;
  return { path: path2, takes: [] };
}
const foxRules = {
  fresh: fresh$f,
  turn: (d) => over$3(d.g) ? null : seatOf$1(d.g),
  legal: (d, m, by) => (by === void 0 || by === seatOf$1(d.g)) && find$1(d.g, m.path) !== null,
  apply: (d, m) => {
    const real = find$1(d.g, m.path);
    return real ? { g: play$3(d.g, real), list: [...d.list, real.path] } : d;
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = x?.moves;
    return Array.isArray(list) ? replay$9(list) : null;
  },
  readMove: readMove$2,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$b, choose: (d, level) => choose$4(d.g, level) },
  result: (d) => !over$3(d.g) ? null : d.g.drawn ? "draw" : d.g.winner === "geese" ? 0 : 1,
  begun: (d) => d.list.length > 0
};
const other$6 = (s) => s === 1 ? 2 : 1;
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
              const key2 = [...cells].sort((a, b) => a - b).join();
              if (!seen.has(key2)) {
                seen.add(key2);
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
const newGame$2 = (first = 1) => ({
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
    turn: other$6(g.turn),
    winner: won2 ? g.turn : 0,
    line: won2 ?? [],
    moves: moves2,
    over: !!won2 || moves2.length === 64
  };
}
const LEVELS$a = ["easy", "fair", "hard"];
const WORTH = [0, 1, 8, 80, 1e6];
function value$3(cells, side) {
  let v = 0;
  for (const line of LINES) {
    let mine2 = 0;
    let theirs = 0;
    for (const j of line) {
      if (cells[j] === side) mine2++;
      else if (cells[j]) theirs++;
    }
    if (mine2 && !theirs) v += WORTH[mine2];
    else if (theirs && !mine2) v -= WORTH[theirs] * 1.1;
  }
  return v;
}
function winsAt(cells, side) {
  const out = /* @__PURE__ */ new Set();
  for (const line of LINES) {
    let mine2 = 0;
    let gap = -1;
    for (const j of line) {
      if (cells[j] === side) mine2++;
      else if (!cells[j]) gap = j;
    }
    if (mine2 === 3 && gap >= 0 && line.filter((j) => !cells[j]).length === 1) out.add(gap);
  }
  return [...out];
}
const empties = (cells) => [...cells.keys()].filter((i) => !cells[i]);
function search(cells, side, me, depth, alpha, beta) {
  const opts = empties(cells);
  if (!opts.length) return 0;
  if (depth === 0) return value$3(cells, me);
  const win = winsAt(cells, side);
  if (win.length) return side === me ? 1e7 + depth : -1e7 - depth;
  const block = winsAt(cells, other$6(side));
  const list = block.length ? block.slice(0, 1) : order(cells, opts, side).slice(0, 10);
  if (side === me) {
    let best2 = -Infinity;
    for (const i of list) {
      cells[i] = side;
      best2 = Math.max(best2, search(cells, other$6(side), me, depth - 1, alpha, beta));
      cells[i] = 0;
      alpha = Math.max(alpha, best2);
      if (alpha >= beta) break;
    }
    return best2;
  }
  let best = Infinity;
  for (const i of list) {
    cells[i] = side;
    best = Math.min(best, search(cells, other$6(side), me, depth - 1, alpha, beta));
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
      let mine2 = 0;
      let theirs = 0;
      for (const j of LINES[k]) {
        if (cells[j] === side) mine2++;
        else if (cells[j]) theirs++;
      }
      if (!theirs) s += WORTH[mine2] + 1;
      if (!mine2) s += WORTH[theirs];
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
  const foe = other$6(side);
  const can = /* @__PURE__ */ new Set();
  for (const line of LINES) {
    let mine2 = 0;
    let theirs = 0;
    for (const j of line) {
      if (cells[j] === side) mine2++;
      else if (cells[j]) theirs++;
    }
    if (mine2 === 2 && !theirs) {
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
function choose$3(g, level, rand = Math.random) {
  const me = g.turn;
  const cells = g.cells.slice();
  const win = winsAt(cells, me);
  if (win.length) return win[0];
  const block = winsAt(cells, other$6(me));
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
    const v = search(cells, other$6(me), me, DEPTH[level] - 1, -Infinity, Infinity);
    cells[i] = 0;
    if (v > bv) {
      bv = v;
      best = [i];
    } else if (v === bv) best.push(i);
  }
  return best[Math.floor(rand() * best.length)];
}
const cubeRules = {
  fresh: () => newGame$2(1),
  turn: (g) => g.over ? null : g.turn === 1 ? 0 : 1,
  legal: (g, i, by) => !g.over && (by === void 0 || by === g.turn - 1) && Number.isInteger(i) && i >= 0 && i < 64 && !g.cells[i],
  apply: (g, i) => place(g, i),
  encode: (g) => ({ moves: g.moves }),
  decode: (x) => {
    const list = x?.moves;
    if (!Array.isArray(list) || list.length > 64) return null;
    let g = newGame$2(1);
    for (const i of list) {
      if (g.over || !Number.isInteger(i) || i < 0 || i >= 64 || g.cells[i]) return null;
      g = place(g, i);
    }
    return g;
  },
  readMove: (x) => Number.isInteger(x) && x >= 0 && x < 64 ? x : null,
  modes: ["versus", "together"],
  computer: { side: 1, levels: LEVELS$a, choose: (g, level) => choose$3(g, level) },
  result: (g) => !g.over ? null : g.winner === 0 ? "draw" : g.winner === 1 ? 0 : 1,
  begun: (g) => g.moves.length > 0
};
const FIELD_W = 1.6;
const COLS = 320;
const DX = FIELD_W / COLS;
const G = 1;
const MAX_SPEED$1 = 1.75;
const CRATER = 0.06;
const BLAST = 0.11;
const GUN_R = 0.022;
const LIFE = 100;
const STEP$3 = 1 / 240;
function newField(seed2, first = 0) {
  const r = rng(seed2);
  const ground = new Array(COLS + 1).fill(0);
  for (const [waves, size2] of [
    [1, 0.12],
    [2.5, 0.09],
    [5, 0.045],
    [11, 0.015]
  ]) {
    const ph = r() * Math.PI * 2;
    for (let i = 0; i <= COLS; i++)
      ground[i] += size2 * Math.sin(i / COLS * Math.PI * 2 * waves + ph);
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
  const speed = Math.max(0, Math.min(1, charge)) * MAX_SPEED$1;
  let x = start2.x + dir * Math.cos(a) * GUN_R * 1.5;
  let y = start2.y + Math.sin(a) * GUN_R * 1.5;
  let vx = dir * Math.cos(a) * speed;
  let vy = Math.sin(a) * speed;
  const path2 = keep ? [x, y] : [];
  for (let i = 0; i < 20 / STEP$3; i++) {
    vx += f.wind * STEP$3;
    vy -= G * STEP$3;
    x += vx * STEP$3;
    y += vy * STEP$3;
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
function shoot$1(f, angle, charge) {
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
const LEVELS$9 = ["easy", "fair", "hard"];
const HANDS$3 = {
  easy: { angle: 5, charge: 0.06 },
  fair: { angle: 2.2, charge: 0.028 },
  hard: { angle: 0.9, charge: 0.012 }
};
function aim$1(f, from) {
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
const normal$2 = (rand) => (rand() + rand() + rand() + rand() - 2) / 0.577;
function gunner(f, level, rand = Math.random) {
  const a = aim$1(f, f.turn);
  const h = HANDS$3[level];
  return {
    angle: Math.max(5, Math.min(85, a.angle + normal$2(rand) * h.angle)),
    charge: Math.max(0.1, Math.min(1, a.charge + normal$2(rand) * h.charge))
  };
}
const MAX_SHOTS = 200;
const newSeed = () => Math.random() * 2 ** 31 >>> 0;
function fresh$e(seed2 = newSeed()) {
  return { seed: seed2, shots: [], f: newField(seed2, 0), last: null };
}
function after$4(g, s) {
  const by = g.f.turn;
  const r = shoot$1(g.f, s.angle, s.charge);
  return { ...g, shots: [...g.shots, s], f: r.field, last: { by, flight: r.flight, hurt: r.hurt } };
}
const over$2 = (g) => g.f.winner !== null || g.shots.length >= MAX_SHOTS;
function readShot(x) {
  const [angle, charge] = Array.isArray(x) ? x : [x?.angle, x?.charge];
  if (typeof angle !== "number" || typeof charge !== "number") return null;
  if (!(angle >= 5 && angle <= 85 && charge >= 0.1 && charge <= 1)) return null;
  return { angle, charge };
}
function replay$8(seed2, shots2) {
  if (!Number.isInteger(seed2) || seed2 < 0 || seed2 >= 2 ** 31) return null;
  if (shots2.length > MAX_SHOTS) return null;
  let g = fresh$e(seed2);
  for (const x of shots2) {
    const s = readShot(x);
    if (!s || over$2(g)) return null;
    g = after$4(g, s);
  }
  return g;
}
const artilleryRules = {
  fresh: () => fresh$e(),
  turn: (g) => over$2(g) ? null : g.f.turn,
  legal: (g, s, by) => !over$2(g) && (by === void 0 || by === g.f.turn) && readShot(s) !== null,
  apply: (g, s) => after$4(g, s),
  encode: (g) => ({ seed: g.seed, shots: g.shots.map((s) => [s.angle, s.charge]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.shots)) return null;
    return replay$8(o.seed, o.shots);
  },
  readMove: readShot,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$9,
    choose: (g, level) => gunner(g.f, level)
  },
  result: (g) => !over$2(g) ? null : g.f.winner ?? "draw",
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
const STEP$2 = 1 / 500;
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
  for (let i = 0; i < 8 / STEP$2; i++) {
    if (!gutter) {
      if (y > OIL) vx -= shot.hook * 1.1 * STEP$2;
      vy -= 0.25 * STEP$2;
      x += vx * STEP$2;
      y += vy * STEP$2;
      if (Math.abs(x) > LANE_HALF - BALL_R * 0.4 && y < HEAD_PIN - 0.2) {
        gutter = true;
        x = Math.sign(x) * (LANE_HALF + BALL_R);
        vx = 0;
      }
    } else y += vy * STEP$2;
    if (y > HEAD_PIN - 1) {
      for (const p of pins) {
        if (p.gone) continue;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 0) {
          const slow = Math.min(sp, 2.2 * STEP$2);
          p.vx -= p.vx / sp * slow;
          p.vy -= p.vy / sp * slow;
        }
        p.x += p.vx * STEP$2;
        p.y += p.vy * STEP$2;
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
    if (keep && i % Math.round(1 / 60 / STEP$2) === 0)
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
      const mine2 = rolls.slice(i, i + 3);
      const extra = first === 10 || first + (rolls[i + 1] ?? 0) === 10;
      const need = extra ? 3 : 2;
      const done2 = mine2.length >= need;
      running += done2 ? mine2.slice(0, need).reduce((s, x) => s + x, 0) : 0;
      frames.push({ rolls: mine2.slice(0, need), total: done2 ? running : null });
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
const score$2 = (rolls) => {
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
const LEVELS$8 = ["easy", "fair", "hard"];
const HANDS$2 = {
  easy: { x: 0.09, angle: 0.013, speed: 0.6, hook: 0 },
  fair: { x: 0.045, angle: 6e-3, speed: 0.35, hook: 0.5 },
  hard: { x: 0.018, angle: 25e-4, speed: 0.15, hook: 1 }
};
function plan$2(standing, level, rand) {
  const h = HANDS$2[level];
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
    for (let k = 0; k < 6; k++) t += bowl(standing, wobble$1(c.s, level, rand)).felled.length;
    if (t > bv) {
      bv = t;
      best = c.s;
    }
  }
  return best;
}
const normal$1 = (rand) => (rand() + rand() + rand() - 1.5) / 0.5;
function wobble$1(s, level, rand) {
  const h = HANDS$2[level];
  return {
    x: s.x + normal$1(rand) * h.x,
    angle: s.angle + normal$1(rand) * h.angle,
    speed: s.speed + normal$1(rand) * h.speed,
    hook: s.hook
  };
}
const ALL$1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_BALLS = 42;
const fresh$d = () => ({
  balls: [],
  rolls: [[], []],
  up: 0,
  standing: ALL$1,
  last: null
});
function after$3(g, s, keep = true) {
  const by = g.up;
  const roll2 = bowl(g.standing, s, keep);
  const mine2 = [...g.rolls[by], roll2.felled.length];
  const rolls = by === 0 ? [mine2, g.rolls[1]] : [g.rolls[0], mine2];
  const n = next(mine2);
  const frameOver = n.over || n.fresh;
  const up = upNext(rolls, by);
  const standing = frameOver ? ALL$1 : g.standing.filter((p) => !roll2.felled.includes(p));
  return { balls: [...g.balls, s], rolls, up, standing, last: { by, standing: g.standing, roll: roll2 } };
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
function replay$7(balls) {
  if (balls.length > MAX_BALLS) return null;
  let g = fresh$d();
  for (let i = 0; i < balls.length; i++) {
    const s = readBall(balls[i]);
    if (!s || g.up === null) return null;
    g = after$3(g, s, i === balls.length - 1);
  }
  return g;
}
const bowlingRules = {
  fresh: fresh$d,
  turn: (g) => g.up,
  legal: (g, s, by) => g.up !== null && (by === void 0 || by === g.up) && readBall(s) !== null,
  apply: (g, s) => after$3(g, s),
  encode: (g) => ({ balls: g.balls.map((s) => [s.x, s.angle, s.speed, s.hook]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.balls)) return null;
    return replay$7(o.balls);
  },
  readMove: readBall,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$8,
    choose: (g, level) => inside(wobble$1(plan$2(g.standing, level, Math.random), level, Math.random))
  },
  result: (g) => {
    if (g.up !== null) return null;
    const [a, b] = [score$2(g.rolls[0]), score$2(g.rolls[1])];
    return a > b ? 0 : b > a ? 1 : "draw";
  },
  begun: (g) => g.balls.length > 0
};
const HALF_W = 2.375;
const HOG = 8;
const TEE = 14;
const HOUSE_R = 1.83;
const BACK = TEE + HOUSE_R;
const STONE_R = 0.145;
const MU = 0.7;
const SWEPT = 0.8;
const CURL = 0.22;
const CURL_SOFT = 0.35;
const SWEPT_CURL = 0.5;
const STEP$1 = 1 / 120;
const STONES_EACH = 4;
function step(stones, sweep, dt = STEP$1, knocked) {
  for (const s of stones) {
    const v = Math.hypot(s.vx, s.vy);
    if (v === 0) continue;
    const swept = s === sweep;
    const slow = Math.min(v, MU * (swept ? SWEPT : 1) * dt);
    let vx = s.vx - s.vx / v * slow;
    let vy = s.vy - s.vy / v * slow;
    if (s.spin && v > slow) {
      const push = s.spin * CURL * (swept ? SWEPT_CURL : 1) * dt / (v + CURL_SOFT);
      const ux = vx / v;
      const uy = vy / v;
      vx += uy * push;
      vy -= ux * push;
      const nv = Math.hypot(vx, vy);
      const keep = (v - slow) / nv;
      vx *= keep;
      vy *= keep;
    }
    s.vx = vx;
    s.vy = vy;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  for (let a = 0; a < stones.length; a++)
    for (let b = a + 1; b < stones.length; b++)
      if (knock(stones[a], stones[b])) {
        knocked?.add(stones[a]);
        knocked?.add(stones[b]);
      }
  return stones.filter(inPlay);
}
const inPlay = (s) => Math.abs(s.x) < HALF_W - STONE_R && s.y < BACK + STONE_R && s.y > -1;
function knock(p, q) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d >= STONE_R * 2 || d === 0) return false;
  const nx = dx / d;
  const ny = dy / d;
  const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
  const over2 = (STONE_R * 2 - d) / 2;
  p.x -= nx * over2;
  p.y -= ny * over2;
  q.x += nx * over2;
  q.y += ny * over2;
  if (rel <= 0) return true;
  if (Math.hypot(p.vx, p.vy) < Math.hypot(q.vx, q.vy)) p.spin = 0;
  else q.spin = 0;
  const j = rel * (1 + 0.9) / 2;
  p.vx -= j * nx;
  p.vy -= j * ny;
  q.vx += j * nx;
  q.vy += j * ny;
  return true;
}
const moving = (stones) => stones.some((s) => s.vx !== 0 || s.vy !== 0);
function deliver(stones, shot, team) {
  const thrown = {
    x: 0,
    y: 0,
    vx: Math.sin(shot.angle) * shot.speed,
    vy: Math.cos(shot.angle) * shot.speed,
    spin: shot.spin,
    team
  };
  return [...stones.map((s) => ({ ...s })), thrown];
}
function settle(stones, thrown, touched) {
  return stones.filter((s) => s !== thrown || touched || s.y >= HOG);
}
function slide(stones, shot, team, sweeper = null, keep = false) {
  let now = deliver(stones, shot, team);
  const thrown = now[now.length - 1];
  const knocked = /* @__PURE__ */ new Set();
  const frames = [];
  for (let i = 0; i < 40 / STEP$1 && moving(now); i++) {
    const sweep = sweeper && now.includes(thrown) && sweeper(thrown, i) ? thrown : null;
    now = step(now, sweep, STEP$1, knocked);
    if (keep && i % 2 === 0) frames.push(now.map((s) => ({ ...s })));
  }
  for (const s of now) {
    s.vx = 0;
    s.vy = 0;
  }
  const done2 = settle(now, thrown, knocked.has(thrown));
  if (keep) frames.push(done2.map((s) => ({ ...s })));
  return { stones: done2, frames };
}
function spansOf(stones, shot, team, sweeper) {
  const out = [];
  if (!sweeper) return out;
  slide(stones, shot, team, (s, i) => {
    const on = sweeper(s, i);
    if (on) addStep(out, i);
    return on;
  });
  return out;
}
function addStep(spans, i) {
  const last = spans[spans.length - 1];
  if (last && last[1] === i) last[1] = i + 1;
  else spans.push([i, i + 1]);
}
const sweptOn = (spans) => (_s, i) => spans.some(([a, b]) => i >= a && i < b);
const fromButton = (s) => Math.hypot(s.x, s.y - TEE);
const inHouse = (s) => fromButton(s) < HOUSE_R + STONE_R;
function count$2(stones) {
  const ranked = stones.filter(inHouse).sort((a, b) => fromButton(a) - fromButton(b));
  if (!ranked.length) return { team: null, points: 0 };
  const team = ranked[0].team;
  let points2 = 0;
  for (const s of ranked) {
    if (s.team !== team) break;
    points2++;
  }
  return { team, points: points2 };
}
const tables = /* @__PURE__ */ new Map();
function pathOf(speed, spin, swept = false) {
  const key2 = `${speed.toFixed(4)}|${spin}|${swept}`;
  const hit2 = tables.get(key2);
  if (hit2) return hit2;
  let s = [{ x: 0, y: 0, vx: 0, vy: speed, spin, team: 0 }];
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < 40 / STEP$1 && moving(s); i++) {
    s = step(s, swept ? s[0] : null);
    if (!s.length) break;
    pts.push({ x: s[0].x, y: s[0].y });
  }
  if (tables.size > 400) tables.clear();
  tables.set(key2, pts);
  return pts;
}
function drawTo(at2, spin) {
  const want = Math.hypot(at2.x, at2.y);
  let lo = 0.5;
  let hi = 9;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const p2 = pathOf(mid, spin);
    const end2 = p2[p2.length - 1];
    if (Math.hypot(end2.x, end2.y) < want) lo = mid;
    else hi = mid;
  }
  const speed = Math.round((lo + hi) / 2 * 1e4) / 1e4;
  const p = pathOf(speed, spin);
  const end = p[p.length - 1];
  return { speed, spin, angle: Math.atan2(at2.x, at2.y) - Math.atan2(end.x, end.y) };
}
function hitAt$1(at2, spin, speed) {
  const want = Math.hypot(at2.x, at2.y);
  const p = pathOf(speed, spin);
  const through = p.find((q) => Math.hypot(q.x, q.y) >= want) ?? p[p.length - 1];
  return { speed, spin, angle: Math.atan2(at2.x, at2.y) - Math.atan2(through.x, through.y) };
}
const LEVELS$7 = ["easy", "fair", "hard"];
const HANDS$1 = {
  easy: { angle: 0.012, speed: 0.05, sweeps: false },
  fair: { angle: 9e-3, speed: 0.04, sweeps: true },
  hard: { angle: 3e-3, speed: 0.016, sweeps: true }
};
const sweepTo = (target) => (s) => {
  const v = Math.hypot(s.vx, s.vy);
  const goes = v * v / (2 * MU);
  return goes < Math.hypot(target.x - s.x, target.y - s.y) - 0.03;
};
function value$2(stones, team, last) {
  const c = count$2(stones);
  let v = c.team === null ? 0 : c.team === team ? c.points : -c.points;
  if (last) return v;
  for (const s of stones) {
    const sign2 = s.team === team ? 1 : -1;
    if (inHouse(s)) v += sign2 * 0.25 * (1 - fromButton(s) / (HOUSE_R + STONE_R));
    else if (s.y > HOG && s.y < TEE - HOUSE_R && Math.abs(s.x) < 1) v += sign2 * 0.12;
  }
  return v;
}
function candidates(stones, team, level) {
  const out = [];
  const spins = [1, -1];
  const spots = [];
  for (const x of [-1.2, -0.6, 0, 0.6, 1.2])
    for (const dy of [-1.2, -0.6, 0, 0.6]) spots.push({ x, y: TEE + dy, kind: "draw" });
  if (level !== "easy")
    for (const x of [-0.6, 0, 0.6])
      for (const y of [TEE - 3, TEE - 2.4]) spots.push({ x, y, kind: "guard" });
  for (const t of spots)
    for (const spin of spins)
      out.push({ shot: drawTo(t, spin), kind: t.kind, target: { x: t.x, y: t.y } });
  for (const s of stones) {
    if (s.team === team) continue;
    for (const spin of spins)
      for (const speed of level === "easy" ? [6.5] : [5.6, 7])
        for (const off of level === "easy" ? [0] : [-0.09, 0, 0.09])
          out.push({
            shot: hitAt$1({ x: s.x + off, y: s.y }, spin, speed),
            kind: "hit",
            target: { x: s.x, y: s.y }
          });
  }
  return out;
}
const normal = (rand) => (rand() + rand() + rand() + rand() - 2) / 0.577;
function wobble(shot, level, rand) {
  const h = HANDS$1[level];
  return {
    angle: shot.angle + normal(rand) * h.angle,
    speed: shot.speed * (1 + normal(rand) * h.speed),
    spin: shot.spin
  };
}
function choose$2(stones, team, level, last, rand) {
  const scored = candidates(stones, team, level).map((p) => ({
    p,
    v: value$2(slide(stones, p.shot, team, null).stones, team, last)
  }));
  scored.sort((a, b) => b.v - a.v);
  if (level === "easy") return scored[Math.floor(rand() * Math.min(3, scored.length))].p;
  return scored[0].p;
}
const newGame$1 = (ends, hammer = 0) => ({
  ends,
  scores: [],
  hammer,
  stones: [],
  thrown: 0,
  over: false
});
const toThrow = (g) => g.thrown % 2 === 0 ? 1 - g.hammer : g.hammer;
const totals$3 = (g) => g.scores.reduce((t, s) => [t[0] + s[0], t[1] + s[1]], [0, 0]);
function after$2(g, stones) {
  const thrown = g.thrown + 1;
  if (thrown < STONES_EACH * 2) return { game: { ...g, stones, thrown }, ended: null };
  const c = count$2(stones);
  const pts = [0, 0];
  if (c.team !== null) pts[c.team] = c.points;
  const scores2 = [...g.scores, pts];
  const hammer = c.team === null ? g.hammer : c.team === 0 ? 1 : 0;
  const t = scores2.reduce((a, s) => [a[0] + s[0], a[1] + s[1]], [0, 0]);
  const over2 = scores2.length >= g.ends + 1 || scores2.length >= g.ends && t[0] !== t[1];
  return { game: { ...g, scores: scores2, hammer, stones: [], thrown: 0, over: over2 }, ended: c };
}
function winner(g) {
  if (!g.over) return null;
  const [a, b] = totals$3(g);
  return a === b ? "draw" : a > b ? 0 : 1;
}
const CALL_ENDS = 4;
const MAX_THROWS = (CALL_ENDS + 1) * STONES_EACH * 2;
const LAST_STEP = Math.round(40 / STEP$1);
const MAX_SPANS = 400;
const fresh$c = () => ({ throws: [], g: newGame$1(CALL_ENDS, 1), last: null });
function play$2(cg, t, keep = true) {
  const by = toThrow(cg.g);
  const r = slide(cg.g.stones, t.shot, by, t.sweeps.length ? sweptOn(t.sweeps) : null, keep);
  const a = after$2(cg.g, r.stones);
  return {
    throws: [...cg.throws, t],
    g: a.game,
    last: { by, before: cg.g.stones, stones: r.stones, frames: r.frames, ended: a.ended }
  };
}
function readThrow(x) {
  const o = x;
  const [angle, speed, spin, sweeps] = Array.isArray(o) ? o : [o?.shot?.angle, o?.shot?.speed, o?.shot?.spin, o?.sweeps];
  if (typeof angle !== "number" || typeof speed !== "number") return null;
  if (!(Math.abs(angle) <= 0.6 && speed >= 0.3 && speed <= 10)) return null;
  if (spin !== 1 && spin !== -1) return null;
  if (!Array.isArray(sweeps) || sweeps.length > MAX_SPANS) return null;
  let at2 = 0;
  for (const sp of sweeps) {
    if (!Array.isArray(sp) || sp.length !== 2) return null;
    const [a, b] = sp;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < at2 || b <= a || b > LAST_STEP)
      return null;
    at2 = b;
  }
  return {
    shot: { angle, speed, spin },
    sweeps: sweeps.map(([a, b]) => [a, b])
  };
}
function replay$6(throws) {
  if (throws.length > MAX_THROWS) return null;
  let cg = fresh$c();
  for (let i = 0; i < throws.length; i++) {
    const t = readThrow(throws[i]);
    if (!t || cg.g.over) return null;
    cg = play$2(cg, t, i === throws.length - 1);
  }
  return cg;
}
function computerThrow(cg, level, rand) {
  const team = toThrow(cg.g);
  const last = cg.g.thrown === STONES_EACH * 2 - 1;
  const plan2 = choose$2(cg.g.stones, team, level, last, rand);
  const shot = wobble(plan2.shot, level, rand);
  const sweeper = HANDS$1[level].sweeps && plan2.kind !== "hit" ? sweepTo(plan2.target) : null;
  const safe2 = {
    angle: Math.max(-0.6, Math.min(0.6, shot.angle)),
    speed: Math.max(0.3, Math.min(10, shot.speed)),
    spin: shot.spin
  };
  return { shot: safe2, sweeps: spansOf(cg.g.stones, safe2, team, sweeper) };
}
const curlingRules = {
  fresh: fresh$c,
  turn: (cg) => cg.g.over ? null : toThrow(cg.g),
  legal: (cg, t, by) => !cg.g.over && (by === void 0 || by === toThrow(cg.g)) && readThrow(pack(t)) !== null,
  apply: (cg, t) => play$2(cg, t),
  encode: (cg) => ({ throws: cg.throws.map(pack) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.throws)) return null;
    return replay$6(o.throws);
  },
  readMove: readThrow,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$7,
    choose: (cg, level) => computerThrow(cg, level, Math.random)
  },
  result: (cg) => winner(cg.g),
  begun: (cg) => cg.throws.length > 0
};
function pack(t) {
  return [t.shot.angle, t.shot.speed, t.shot.spin, t.sweeps.map(([a, b]) => [a, b])];
}
const MATCH_SPANS = 8;
const roundShot = (s) => ({
  angle: Math.round(s.angle * 1e4) / 1e4,
  speed: Math.round(s.speed * 1e4) / 1e4,
  spin: s.spin
});
function fewerSpans(spans, max) {
  const out = spans.map(([a, b]) => [a, b]);
  while (out.length > max) {
    let k = 0;
    for (let i = 1; i < out.length - 1; i++)
      if (out[i + 1][0] - out[i][1] < out[k + 1][0] - out[k][1]) k = i;
    out.splice(k, 2, [out[k][0], out[k + 1][1]]);
  }
  return out;
}
const fits$1 = (t) => t.sweeps.length <= MATCH_SPANS && t.shot.angle === roundShot(t.shot).angle && t.shot.speed === roundShot(t.shot).speed;
function matchThrow(cg, level, rand) {
  const t = computerThrow(cg, level, rand);
  const shot = roundShot(t.shot);
  const plan2 = t.sweeps.length ? sweptOn(t.sweeps) : null;
  return {
    shot,
    sweeps: fewerSpans(spansOf(cg.g.stones, shot, toThrow(cg.g), plan2), MATCH_SPANS)
  };
}
const curlingMatchRules = {
  ...curlingRules,
  legal: (cg, t, by) => curlingRules.legal(cg, t, by) && fits$1(t),
  readMove: (x) => {
    const t = readThrow(x);
    return t && fits$1(t) ? t : null;
  },
  computer: {
    side: 1,
    levels: LEVELS$7,
    choose: (cg, level) => matchThrow(cg, level, Math.random)
  }
};
const W = 10;
const H = 15;
const BALL = 0.16;
const CUP = 0.27;
const SINK_SPEED = 6.5;
const MAX_SPEED = 13;
const STEP = 1 / 120;
const BOUNCE = 0.72;
const at$1 = (h, tx, ty) => tx < 0 || ty < 0 || tx >= W || ty >= H ? "x" : h.tiles[ty * W + tx];
const tileOf = (h, p) => at$1(h, Math.floor(p.x), Math.floor(p.y));
function readHole(text, name = "Your hole") {
  const flat = /^[xgswto]{150}$/.test(text) ? text : unpack(text);
  if (!flat || flat.length !== W * H || !/^[xgswto]+$/.test(flat)) return null;
  const tees = [...flat.matchAll(/t/g)].map((m) => m.index);
  const cups = [...flat.matchAll(/o/g)].map((m) => m.index);
  if (tees.length !== 1 || cups.length !== 1) return null;
  const centre = (i) => ({ x: i % W + 0.5, y: Math.floor(i / W) + 0.5 });
  const tiles = [...flat].map((c) => c === "t" || c === "o" ? "g" : c);
  const h = { name, tiles, tee: centre(tees[0]), cup: centre(cups[0]) };
  return Number.isFinite(field(h).at(h.tee)) ? h : null;
}
function unpack(s) {
  if (!/^([xgswto]\d*)+$/.test(s)) return null;
  let out = "";
  for (const m of s.matchAll(/([xgswto])(\d*)/g)) {
    const n = m[2] ? Number(m[2]) : 1;
    if (n < 1 || out.length + n > W * H) return null;
    out += m[1].repeat(n);
  }
  return out;
}
const art = (name, rows) => readHole(
  rows.join("").replace(/#/g, "x").replace(/\./g, "g").replace(/T/g, "t").replace(/O/g, "o"),
  name
);
const COURSE = [
  art("The straight", [
    "##########",
    "###....###",
    "###..O.###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###....###",
    "###..T.###",
    "###....###",
    "##########"
  ]),
  art("Dogleg", [
    "##########",
    "#.....####",
    "#..O..####",
    "#.....####",
    "#.....####",
    "###...####",
    "###...####",
    "###...####",
    "###......#",
    "###......#",
    "###......#",
    "######...#",
    "######.T.#",
    "######...#",
    "##########"
  ]),
  art("Bunkers", [
    "##########",
    "##......##",
    "##..O...##",
    "##......##",
    "##ssss..##",
    "##ssss..##",
    "##......##",
    "##......##",
    "##..ssss##",
    "##..ssss##",
    "##......##",
    "##......##",
    "##...T..##",
    "##......##",
    "##########"
  ]),
  art("The pond", [
    "##########",
    "#........#",
    "#...O....#",
    "#........#",
    "#wwwwww..#",
    "#wwwwww..#",
    "#wwwwww..#",
    "#........#",
    "#........#",
    "#..wwwwww#",
    "#..wwwwww#",
    "#........#",
    "#....T...#",
    "#........#",
    "##########"
  ]),
  art("Pinball", [
    "##########",
    "#........#",
    "#...O....#",
    "#..#..#..#",
    "#........#",
    "#.#.##.#.#",
    "#........#",
    "#..#..#..#",
    "#........#",
    "#.#.##.#.#",
    "#........#",
    "#..#..#..#",
    "#........#",
    "#....T...#",
    "##########"
  ]),
  art("Switchback", [
    "##########",
    "#.......O#",
    "#........#",
    "#######..#",
    "#........#",
    "#........#",
    "#..#######",
    "#........#",
    "#........#",
    "#######..#",
    "#........#",
    "#........#",
    "#T.......#",
    "#........#",
    "##########"
  ])
];
const DRAG = { g: 2.1, s: 9, x: 0, w: 0 };
function roll$6(h, from, angle, power, keep = false) {
  const p = Math.max(0, Math.min(1, power));
  let x = from.x;
  let y = from.y;
  let vx = Math.cos(angle) * p * MAX_SPEED;
  let vy = Math.sin(angle) * p * MAX_SPEED;
  const frames = keep ? [x, y] : [];
  for (let i = 1; i <= 12 / STEP; i++) {
    const t = tileOf(h, { x, y });
    const speed = Math.hypot(vx, vy);
    const slow = (DRAG[t] + 0.22 * speed) * STEP;
    if (speed <= slow) {
      vx = 0;
      vy = 0;
    } else {
      vx -= vx / speed * slow;
      vy -= vy / speed * slow;
    }
    x += vx * STEP;
    y += vy * STEP;
    for (let ty = Math.floor(y - BALL); ty <= Math.floor(y + BALL); ty++)
      for (let tx = Math.floor(x - BALL); tx <= Math.floor(x + BALL); tx++) {
        if (at$1(h, tx, ty) !== "x") continue;
        const qx = Math.max(tx, Math.min(tx + 1, x));
        const qy = Math.max(ty, Math.min(ty + 1, y));
        const dx = x - qx;
        const dy = y - qy;
        const d = Math.hypot(dx, dy);
        if (d >= BALL || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        x = qx + nx * BALL;
        y = qy + ny * BALL;
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          vx -= (1 + BOUNCE) * vn * nx;
          vy -= (1 + BOUNCE) * vn * ny;
        }
      }
    if (keep && i % 2 === 0) frames.push(x, y);
    const s = Math.hypot(vx, vy);
    if (Math.hypot(x - h.cup.x, y - h.cup.y) < CUP && s < SINK_SPEED) {
      if (keep) frames.push(h.cup.x, h.cup.y);
      return { end: { ...h.cup }, sunk: true, wet: false, frames };
    }
    if (tileOf(h, { x, y }) === "w") {
      if (keep) frames.push(x, y);
      return { end: { ...from }, sunk: false, wet: true, frames };
    }
    if (s === 0) break;
  }
  if (keep) frames.push(x, y);
  return { end: { x, y }, sunk: false, wet: false, frames };
}
function field(h) {
  const d = new Float64Array(W * H).fill(Infinity);
  const start2 = Math.floor(h.cup.y) * W + Math.floor(h.cup.x);
  d[start2] = 0;
  const done2 = new Uint8Array(W * H);
  for (; ; ) {
    let k = -1;
    for (let i = 0; i < W * H; i++) if (!done2[i] && d[i] < Infinity && (k < 0 || d[i] < d[k])) k = i;
    if (k < 0) break;
    done2[k] = 1;
    const kx = k % W;
    const ky = k / W | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const t = at$1(h, kx + dx, ky + dy);
        if (t === "x" || t === "w") continue;
        if (dx && dy && (at$1(h, kx + dx, ky) !== "g" || at$1(h, kx, ky + dy) !== "g")) continue;
        const step2 = (dx && dy ? Math.SQRT2 : 1) * (t === "s" ? 2.5 : 1);
        const j = (ky + dy) * W + kx + dx;
        if (d[k] + step2 < d[j]) d[j] = d[k] + step2;
      }
  }
  return {
    at(p) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.y);
      const base = at$1(h, tx, ty) === "x" ? Infinity : d[ty * W + tx];
      return base + Math.hypot(p.x - h.cup.x, p.y - h.cup.y) * 0.05;
    }
  };
}
const LEVELS$6 = ["easy", "fair", "hard"];
const HANDS = {
  easy: { angles: 24, powers: 5, aim: 0.09, push: 0.16 },
  fair: { angles: 48, powers: 8, aim: 0.035, push: 0.07 },
  hard: { angles: 96, powers: 12, aim: 0.012, push: 0.025 }
};
function worth$1(h, f, from, r) {
  if (r.sunk) return -100;
  if (r.wet) return f.at(from) + 3;
  return f.at(r.end) + (tileOf(h, r.end) === "s" ? 1.5 : 0);
}
function plan$1(h, from, level) {
  const { angles, powers, aim: aim2, push } = HANDS[level];
  const f = field(h);
  const once = (angle, power) => worth$1(h, f, from, roll$6(h, from, angle, power)) + power * 0.01;
  const tried = [];
  for (let a = 0; a < angles; a++)
    for (let p = 1; p <= powers; p++) {
      const angle = a / angles * Math.PI * 2;
      const power = p / powers;
      tried.push({ angle, power, v: once(angle, power) });
    }
  if (level === "hard") {
    tried.sort((x, y) => x.v - y.v);
    const { angle, power } = tried[0];
    for (let da = -4; da <= 4; da++)
      for (let dp = -3; dp <= 3; dp++) {
        const a2 = angle + da * Math.PI / (angles * 4);
        const p2 = Math.max(0.02, Math.min(1, power + dp / (powers * 4)));
        tried.push({ angle: a2, power: p2, v: once(a2, p2) });
      }
  }
  tried.sort((x, y) => x.v - y.v);
  let best = tried[0];
  let bv = Infinity;
  for (const c of tried.slice(0, 10)) {
    let sum2 = 0;
    for (const da of [-1, 0, 1])
      for (const dp of [-1, 0, 1])
        sum2 += once(c.angle + da * aim2, Math.min(1, c.power * (1 + dp * push)));
    if (sum2 / 9 < bv) {
      bv = sum2 / 9;
      best = c;
    }
  }
  return { angle: best.angle, power: best.power };
}
function stroke(h, from, level, rand = Math.random) {
  const { angle, power } = plan$1(h, from, level);
  const { aim: aim2, push } = HANDS[level];
  const wobble2 = () => (rand() + rand() + rand() - 1.5) / 1.5;
  return {
    angle: angle + wobble2() * aim2,
    power: Math.max(0.03, Math.min(1, power * (1 + wobble2() * push)))
  };
}
const PICK_UP = 8;
const MAX_PUTTS = COURSE.length * 2 * PICK_UP;
const fresh$b = () => ({
  putts: [],
  hole: 0,
  up: 0,
  at: { ...COURSE[0].tee },
  strokes: 0,
  card: COURSE.map(() => [null, null]),
  last: null
});
function play$1(g, p, keep = true) {
  const by = g.up;
  const h = COURSE[g.hole];
  const r = roll$6(h, g.at, p.angle, p.power, keep);
  const n = g.strokes + (r.wet ? 2 : 1);
  const out = r.sunk || n >= PICK_UP;
  const last = { by, hole: g.hole, from: g.at, roll: r, strokes: Math.min(n, PICK_UP), out };
  if (!out) return { ...g, putts: [...g.putts, p], at: r.end, strokes: n, last };
  const card2 = g.card.map(
    (c, i) => i === g.hole ? by === 0 ? [last.strokes, c[1]] : [c[0], last.strokes] : c
  );
  const hole = by === 0 ? g.hole : g.hole + 1;
  const up = by === 0 ? 1 : hole < COURSE.length ? 0 : null;
  return {
    putts: [...g.putts, p],
    hole,
    up,
    at: up === null ? { ...COURSE[COURSE.length - 1].cup } : { ...COURSE[hole].tee },
    strokes: 0,
    card: card2,
    last
  };
}
function readPutt(x) {
  const [angle, power] = Array.isArray(x) ? x : [x?.angle, x?.power];
  if (typeof angle !== "number" || typeof power !== "number") return null;
  if (!(Math.abs(angle) <= 10 && power > 0 && power <= 1)) return null;
  return { angle, power };
}
function replay$5(putts) {
  if (putts.length > MAX_PUTTS) return null;
  let g = fresh$b();
  for (let i = 0; i < putts.length; i++) {
    const p = readPutt(putts[i]);
    if (!p || g.up === null) return null;
    g = play$1(g, p, i === putts.length - 1);
  }
  return g;
}
const totals$2 = (g) => g.card.reduce((t, c) => [t[0] + (c[0] ?? 0), t[1] + (c[1] ?? 0)], [0, 0]);
const puttRules = {
  fresh: fresh$b,
  turn: (g) => g.up,
  legal: (g, p, by) => g.up !== null && (by === void 0 || by === g.up) && readPutt(p) !== null,
  apply: (g, p) => play$1(g, p),
  encode: (g) => ({ putts: g.putts.map((p) => [p.angle, p.power]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.putts)) return null;
    return replay$5(o.putts);
  },
  readMove: readPutt,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$6,
    choose: (g, level) => stroke(COURSE[g.hole], g.at, level)
  },
  result: (g) => {
    if (g.up !== null) return null;
    const [a, b] = totals$2(g);
    return a < b ? 0 : b < a ? 1 : "draw";
  },
  begun: (g) => g.putts.length > 0
};
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const R = {
  bull: 6.35,
  outer: 15.9,
  trebleIn: 99,
  trebleOut: 107,
  doubleIn: 162,
  doubleOut: 170
};
const points = (h) => h.n * h.mult;
const say = (h) => h.mult === 0 ? "a miss" : h.n === 25 ? h.mult === 2 ? "the bull" : "25" : `${h.mult === 3 ? "T" : h.mult === 2 ? "D" : ""}${h.n}`;
function hitAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return { n: 25, mult: 2 };
  if (r <= R.outer) return { n: 25, mult: 1 };
  if (r > R.doubleOut) return { n: 0, mult: 0 };
  const a = (Math.atan2(x, y) + Math.PI * 2) % (Math.PI * 2);
  const n = ORDER[Math.floor((a + Math.PI / 20) % (Math.PI * 2) / (Math.PI / 10))];
  const mult = r >= R.doubleIn ? 2 : r >= R.trebleIn && r <= R.trebleOut ? 3 : 1;
  return { n, mult };
}
function centreOf(t) {
  if (t.n === 25) return { x: 0, y: t.mult === 2 ? 0 : (R.bull + R.outer) / 2 };
  const i = ORDER.indexOf(t.n);
  const a = i * Math.PI / 10;
  const r = t.mult === 3 ? (R.trebleIn + R.trebleOut) / 2 : t.mult === 2 ? (R.doubleIn + R.doubleOut) / 2 : (
    // a single: the fat part, between the treble and the double rings
    (R.trebleOut + R.doubleIn) / 2
  );
  return { x: Math.sin(a) * r, y: Math.cos(a) * r };
}
function land(aim2, sigma, rand) {
  const u = Math.max(1e-12, rand());
  const v = rand();
  const m = Math.sqrt(-2 * Math.log(u)) * sigma;
  return { x: aim2.x + m * Math.cos(2 * Math.PI * v), y: aim2.y + m * Math.sin(2 * Math.PI * v) };
}
const SINGLES = [...ORDER.map((n) => ({ n, mult: 1 })), { n: 25, mult: 1 }];
const DOUBLES = [...ORDER.map((n) => ({ n, mult: 2 })), { n: 25, mult: 2 }];
const TREBLES = ORDER.map((n) => ({ n, mult: 3 }));
const ANY = [...TREBLES, ...SINGLES, ...DOUBLES];
const LIKED = [20, 16, 8, 12, 10, 18, 4, 6, 2, 14, 25, 9, 7, 3, 5, 11, 13, 15, 17, 19, 1];
const doubleRank = (h) => LIKED.indexOf(h.n === 25 ? 25 : h.n);
const setupRank = (h) => h.mult === 3 ? 100 - h.n : h.mult === 1 ? 200 - h.n : 300 - h.n;
const ROUTES = (() => {
  const out = /* @__PURE__ */ new Map();
  const better = (a, b) => {
    if (!b) return true;
    if (a.length !== b.length) return a.length < b.length;
    const da = doubleRank(a[a.length - 1]);
    const db = doubleRank(b[b.length - 1]);
    if (da !== db) return da < db;
    for (let i = 0; i < a.length - 1; i++) {
      const d = setupRank(a[i]) - setupRank(b[i]);
      if (d) return d < 0;
    }
    return false;
  };
  for (const d of DOUBLES) {
    const s = points(d);
    if (better([d], out.get(s))) out.set(s, [d]);
    for (const a of ANY) {
      const s2 = points(a) + s;
      if (better([a, d], out.get(s2))) out.set(s2, [a, d]);
      for (const b of ANY) {
        const s3 = points(a) + points(b) + s;
        if (s3 <= 170 && better([a, b, d], out.get(s3))) out.set(s3, [a, b, d]);
      }
    }
  }
  return out;
})();
const START = 501;
function newLeg(first, start2 = START) {
  return { scores: [start2, start2], turn: first, darts: [], from: start2, history: [], winner: null };
}
function dart(g, h) {
  if (g.winner !== null) return g;
  const w = g.turn;
  const left2 = g.scores[w] - points(h);
  const darts = [...g.darts, h];
  const end = (scores22, bust, winner2) => ({
    ...g,
    scores: scores22,
    turn: winner2 === null ? w === 0 ? 1 : 0 : w,
    darts: [],
    from: winner2 === null ? scores22[w === 0 ? 1 : 0] : scores22[w],
    history: [...g.history, { who: w, darts, total: bust ? 0 : g.from - scores22[w], bust }],
    winner: winner2
  });
  const scores2 = [...g.scores];
  if (left2 < 0 || left2 === 1 || left2 === 0 && h.mult !== 2) {
    scores2[w] = g.from;
    return end(scores2, true, null);
  }
  scores2[w] = left2;
  if (left2 === 0) return end(scores2, false, w);
  if (darts.length === 3) return end(scores2, false, null);
  return { ...g, scores: scores2, darts };
}
const LEVELS$5 = ["easy", "fair", "hard"];
const SPREAD = { easy: 34, fair: 22, hard: 13 };
function expected(aim2, sigma, samples = 300) {
  let t = 0;
  let s = 12345;
  const rand = () => (s = s * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < samples; i++) {
    const p = land(aim2, sigma, rand);
    t += points(hitAt(p.x, p.y));
  }
  return t / samples;
}
const scoringTargets = /* @__PURE__ */ new Map();
function scoringAim(level) {
  const known2 = scoringTargets.get(level);
  if (known2) return known2;
  let best = { ...centreOf({ n: 20, mult: 3 }), label: "T20" };
  let bv = -Infinity;
  for (const t of [...TREBLES, { n: 25, mult: 2 }]) {
    const v = expected(centreOf(t), SPREAD[level]);
    if (v > bv) {
      bv = v;
      best = { ...centreOf(t), label: say(t) };
    }
  }
  scoringTargets.set(level, best);
  return best;
}
function aimFor(g, level) {
  const left2 = g.scores[g.turn];
  const dartsLeft = 3 - g.darts.length;
  const route = ROUTES.get(left2);
  if (route && route.length <= dartsLeft) return { ...centreOf(route[0]), label: say(route[0]) };
  if (left2 <= 60 || route && route.length > dartsLeft) {
    let best = { n: 20, mult: 1 };
    let bv = Infinity;
    for (const s of SINGLES) {
      const rest = left2 - points(s);
      const r = ROUTES.get(rest);
      if (rest < 2 || !r || r.length !== 1) continue;
      const v = doubleRank(r[0]);
      if (v < bv) {
        bv = v;
        best = s;
      }
    }
    if (bv < Infinity) return { ...centreOf(best), label: say(best) };
  }
  return scoringAim(level);
}
const LEGS_TO_WIN = 2;
const FAR = 300;
const MAX_DARTS = 900;
const fresh$a = () => ({
  darts: [],
  leg: newLeg(0),
  legNo: 0,
  legs: [0, 0],
  over: false,
  board: [],
  last: null
});
const tidy = (p) => {
  const r = Math.hypot(p.x, p.y);
  const f = r > FAR ? FAR / r : 1;
  return { x: Math.round(p.x * f * 10) / 10, y: Math.round(p.y * f * 10) / 10 };
};
function play(g, p) {
  const by = g.leg.turn;
  const hit2 = hitAt(p.x, p.y);
  const leg = dart(g.leg, hit2);
  const board2 = [...g.leg.darts.length === 0 ? [] : g.board, { ...p, who: by }];
  const base = { ...g, darts: [...g.darts, p], board: board2 };
  if (leg.winner === null) return { ...base, leg, last: { by, hit: hit2, before: g.leg, legWon: false } };
  const legs = [g.legs[0], g.legs[1]];
  legs[leg.winner]++;
  const over2 = Math.max(...legs) >= LEGS_TO_WIN;
  const legNo = over2 ? g.legNo : g.legNo + 1;
  return {
    ...base,
    leg: over2 ? leg : newLeg(legNo % 2),
    legNo,
    legs,
    over: over2,
    last: { by, hit: hit2, before: g.leg, legWon: true }
  };
}
function readDart(x) {
  const [px, py] = Array.isArray(x) ? x : [x?.x, x?.y];
  if (typeof px !== "number" || typeof py !== "number") return null;
  if (!Number.isFinite(px) || !Number.isFinite(py) || Math.hypot(px, py) > FAR + 0.1) return null;
  return { x: px, y: py };
}
const done$2 = (g) => g.over || g.darts.length >= MAX_DARTS;
function replay$4(darts) {
  if (darts.length > MAX_DARTS) return null;
  let g = fresh$a();
  for (const x of darts) {
    const p = readDart(x);
    if (!p || done$2(g)) return null;
    g = play(g, p);
  }
  return g;
}
const dartsRules = {
  fresh: fresh$a,
  turn: (g) => done$2(g) ? null : g.leg.turn,
  legal: (g, p, by) => !done$2(g) && (by === void 0 || by === g.leg.turn) && readDart(p) !== null,
  apply: (g, p) => play(g, p),
  encode: (g) => ({ darts: g.darts.map((p) => [p.x, p.y]) }),
  decode: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || !Array.isArray(o.darts)) return null;
    return replay$4(o.darts);
  },
  readMove: readDart,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$5,
    choose: (g, level) => tidy(land(aimFor(g.leg, level), SPREAD[level], Math.random))
  },
  result: (g) => !done$2(g) ? null : g.legs[0] > g.legs[1] ? 0 : g.legs[1] > g.legs[0] ? 1 : "draw",
  begun: (g) => g.darts.length > 0
};
const tidied = (p) => {
  const t = tidy(p);
  return t.x === p.x && t.y === p.y;
};
const dartsMatchRules = {
  ...dartsRules,
  legal: (g, p, by) => dartsRules.legal(g, p, by) && tidied(p),
  readMove: (x) => {
    const p = readDart(x);
    return p && tidied(p) ? p : null;
  }
};
const other$5 = (w) => w === 1 ? 2 : 1;
const BAR = -1;
const OFF = 24;
function startPos() {
  const board2 = Array(24).fill(0);
  board2[23] = 2;
  board2[12] = 5;
  board2[7] = 3;
  board2[5] = 5;
  board2[0] = -2;
  board2[11] = -5;
  board2[16] = -3;
  board2[18] = -5;
  return { board: board2, bar: [0, 0, 0], off: [0, 0, 0] };
}
const sign = (w) => w === 1 ? 1 : -1;
const mine = (p, w, i) => p.board[i] * sign(w) > 0;
const dist = (w, i) => w === 1 ? i + 1 : 24 - i;
function pips(p, w) {
  let n = p.bar[w] * 25;
  for (let i = 0; i < 24; i++) if (mine(p, w, i)) n += Math.abs(p.board[i]) * dist(w, i);
  return n;
}
const allHome = (p, w) => p.bar[w] === 0 && p.board.every((c, i) => c * sign(w) <= 0 || dist(w, i) <= 6);
function stepsFor(p, w, die2) {
  const s = sign(w);
  const out = [];
  const land2 = (to) => p.board[to] * s >= -1;
  if (p.bar[w] > 0) {
    const to = w === 1 ? 24 - die2 : die2 - 1;
    if (land2(to)) out.push({ from: BAR, to, die: die2, hit: p.board[to] * s === -1 });
    return out;
  }
  const home = allHome(p, w);
  for (let i = 0; i < 24; i++) {
    if (!mine(p, w, i)) continue;
    const to = i - die2 * s;
    if (to >= 0 && to < 24) {
      if (land2(to)) out.push({ from: i, to, die: die2, hit: p.board[to] * s === -1 });
    } else if (home) {
      const d = dist(w, i);
      const further = p.board.some((c, j) => c * s > 0 && dist(w, j) > d);
      if (d === die2 || d < die2 && !further) out.push({ from: i, to: OFF, die: die2, hit: false });
    }
  }
  return out;
}
function apply(p, w, st) {
  const s = sign(w);
  const board2 = p.board.slice();
  const bar = [0, p.bar[1], p.bar[2]];
  const off = [0, p.off[1], p.off[2]];
  if (st.from === BAR) bar[w]--;
  else board2[st.from] -= s;
  if (st.to === OFF) off[w]++;
  else {
    if (st.hit) {
      board2[st.to] = 0;
      bar[other$5(w)]++;
    }
    board2[st.to] += s;
  }
  return { board: board2, bar, off };
}
const key = (p) => `${p.board.join(",")}|${p.bar[1]},${p.bar[2]}|${p.off[1]},${p.off[2]}`;
function plays(p, w, dice, all = false) {
  const rolls = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice;
  const found = [];
  const walk = (pos, left2, steps2) => {
    let moved2 = false;
    const tried = /* @__PURE__ */ new Set();
    for (let k = 0; k < left2.length; k++) {
      if (tried.has(left2[k])) continue;
      tried.add(left2[k]);
      for (const st of stepsFor(pos, w, left2[k])) {
        moved2 = true;
        walk(apply(pos, w, st), [...left2.slice(0, k), ...left2.slice(k + 1)], [...steps2, st]);
      }
    }
    if (!moved2) found.push({ steps: steps2, pos });
  };
  walk(p, rolls, []);
  const most = Math.max(...found.map((f) => f.steps.length));
  let legal2 = found.filter((f) => f.steps.length === most);
  if (most === 1 && dice[0] !== dice[1]) {
    const big = Math.max(...dice);
    if (legal2.some((f) => f.steps[0].die === big))
      legal2 = legal2.filter((f) => f.steps[0].die === big);
  }
  if (all) return legal2;
  const seen = /* @__PURE__ */ new Set();
  return legal2.filter((f) => {
    const k = key(f.pos);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function result$1(p) {
  for (const w of [1, 2]) {
    if (p.off[w] < 15) continue;
    const l = other$5(w);
    if (p.off[l] > 0) return { winner: w, points: 1 };
    const stuck = p.bar[l] > 0 || p.board.some((c, i) => c * sign(l) > 0 && dist(w, i) <= 6);
    return { winner: w, points: stuck ? 3 : 2 };
  }
  return null;
}
const LEVELS$4 = ["easy", "fair", "hard"];
const contact = (p) => {
  let lowest2 = 24;
  let highest1 = -1;
  for (let i = 0; i < 24; i++) {
    if (p.board[i] > 0) highest1 = Math.max(highest1, i);
    if (p.board[i] < 0) lowest2 = Math.min(lowest2, i);
  }
  return p.bar[1] + p.bar[2] > 0 || highest1 > lowest2;
};
function shots(p, w, i) {
  const them = other$5(w);
  const s = sign(them);
  let n = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const reach = a === b ? [a, 2 * a, 3 * a, 4 * a] : [a, b, a + b];
      const hit2 = reach.some((d) => {
        const from = i + d * s;
        return from >= 0 && from < 24 && p.board[from] * s > 0 || p.bar[them] > 0 && (them === 1 ? 24 : -1) === from;
      });
      if (hit2) n++;
    }
  return n;
}
const CAREFUL = { blot: 2, shot: 0.3, near: 1.3, aim: 0.25, home: 8, prime: 5 };
function value$1(p, w, careful = CAREFUL) {
  const r = result$1(p);
  if (r) return r.winner === w ? 1e3 * r.points : -1e3 * r.points;
  const them = other$5(w);
  let v = (pips(p, them) - pips(p, w)) * 1 + (p.off[w] - p.off[them]) * 4;
  if (!contact(p)) return v * 1.5;
  v -= p.bar[w] * 18;
  v += p.bar[them] * 18;
  let run2 = 0;
  for (let i = 0; i < 24; i++) {
    const c = p.board[i] * sign(w);
    if (c >= 2) {
      const d = dist(w, i);
      v += d <= 6 ? careful?.home ?? 6 : d <= 9 ? 4 : 2;
      run2++;
      if (run2 >= 3) v += (careful?.prime ?? 4) * (run2 - 2);
    } else run2 = 0;
    if (c === 1)
      v -= careful ? careful.blot + shots(p, w, i) * careful.shot * (dist(w, i) <= 12 ? careful.near : 1) : 6;
    const t = -c;
    if (t === 1) v += careful ? 1 + shots(p, them, i) * careful.aim : 3;
  }
  return v;
}
function choose$1(p, w, dice, level, rand = Math.random, weights2 = CAREFUL) {
  const list = plays(p, w, dice);
  if (list.length === 1) return list[0];
  let best = [];
  let bv = -Infinity;
  for (const pl of list) {
    const v = value$1(pl.pos, w, level === "hard" ? weights2 : null) + (level === "easy" ? (rand() - 0.5) * 40 : 0);
    if (v > bv + 1e-9) {
      bv = v;
      best = [pl];
    } else if (Math.abs(v - bv) <= 1e-9) best.push(pl);
  }
  return best[Math.floor(rand() * best.length)];
}
const MAX_TURNS$1 = 300;
const seatOf = (w) => w === 1 ? 0 : 1;
const die = (rand) => 1 + Math.floor(rand() * 6);
const over$1 = (g) => g.drawn || result$1(g.pos) !== null;
const fresh$9 = () => ({
  pos: startPos(),
  turn: null,
  dice: null,
  opening: null,
  turns: [],
  drawn: false
});
function find(p, w, dice, m) {
  const pl = plays(p, w, dice, true).find(
    (x) => x.steps.length === m.length && x.steps.every((s, k) => s.from === m[k][0] && s.to === m[k][1])
  );
  return pl ? pl.steps : null;
}
function after$1(g, w, dice, steps2) {
  let pos = g.pos;
  for (const s of steps2) pos = apply(pos, w, s);
  const turns = [...g.turns, { by: w, dice, steps: steps2 }];
  const done2 = result$1(pos) !== null;
  const drawn = !done2 && turns.length >= MAX_TURNS$1;
  return { ...g, pos, turns, turn: done2 || drawn ? null : other$5(w), dice: null, drawn };
}
function roll$5(g, rand) {
  let cur = g;
  if (!cur.opening) {
    let [a, b] = [die(rand), die(rand)];
    while (a === b) [a, b] = [die(rand), die(rand)];
    const w = a > b ? 1 : 2;
    cur = { ...cur, opening: [a, b], turn: w, dice: w === 1 ? [a, b] : [b, a] };
  }
  for (let k = 0; k < MAX_TURNS$1 && cur.turn !== null; k++) {
    const w = cur.turn;
    const dice = cur.dice ?? [die(rand), die(rand)];
    if (plays(cur.pos, w, dice)[0].steps.length) return { ...cur, dice };
    cur = after$1(cur, w, dice, []);
  }
  return cur;
}
const isDie = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
const isPoint = (v) => Number.isInteger(v) && v >= BAR && v <= OFF;
function readMove$1(x) {
  const list = Array.isArray(x) ? x : x?.steps;
  if (!Array.isArray(list) || list.length > 4) return null;
  const out = [];
  for (const s of list) {
    const [from, to] = Array.isArray(s) ? s : [s?.from, s?.to];
    if (!isPoint(from) || !isPoint(to) || from === OFF || to === BAR) return null;
    out.push([from, to]);
  }
  return out;
}
function replay$3(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  let g = fresh$9();
  if (o.open === null || o.open === void 0) {
    return Array.isArray(o.turns) && !o.turns.length && o.dice == null ? g : null;
  }
  const op = o.open;
  if (!Array.isArray(op) || op.length !== 2 || !isDie(op[0]) || !isDie(op[1]) || op[0] === op[1])
    return null;
  const [a, b] = op;
  const first = a > b ? 1 : 2;
  g = { ...g, opening: [a, b], turn: first };
  if (!Array.isArray(o.turns) || o.turns.length > MAX_TURNS$1) return null;
  for (let k = 0; k < o.turns.length; k++) {
    const t = o.turns[k];
    if (g.turn === null || !Array.isArray(t) || t.length < 2 || t.length % 2) return null;
    if (!isDie(t[0]) || !isDie(t[1])) return null;
    const dice = [t[0], t[1]];
    if (k === 0 && (dice[0] !== Math.max(a, b) || dice[1] !== Math.min(a, b))) return null;
    const pairs = [];
    for (let i = 2; i < t.length; i += 2) pairs.push([t[i], t[i + 1]]);
    const m = readMove$1(pairs);
    if (!m) return null;
    const steps2 = find(g.pos, g.turn, dice, m);
    if (!steps2) return null;
    g = after$1(g, g.turn, dice, steps2);
  }
  if (o.dice != null) {
    const d = o.dice;
    if (g.turn === null || !Array.isArray(d) || d.length !== 2 || !isDie(d[0]) || !isDie(d[1]))
      return null;
    if (!g.turns.length && (d[0] !== Math.max(a, b) || d[1] !== Math.min(a, b))) return null;
    g = { ...g, dice: [d[0], d[1]] };
  } else if (!g.turns.length) g = { ...g, dice: first === 1 ? [a, b] : [b, a] };
  return g;
}
const backgammonRules = {
  fresh: fresh$9,
  turn: (g) => over$1(g) || g.turn === null ? null : seatOf(g.turn),
  legal: (g, m, by) => !over$1(g) && g.turn !== null && g.dice !== null && (by === void 0 || by === seatOf(g.turn)) && find(g.pos, g.turn, g.dice, m) !== null,
  apply: (g, m) => {
    if (g.turn === null || g.dice === null) return g;
    const steps2 = find(g.pos, g.turn, g.dice, m);
    return steps2 ? after$1(g, g.turn, g.dice, steps2) : g;
  },
  roll: roll$5,
  encode: (g) => ({
    open: g.opening,
    turns: g.turns.map((t) => [...t.dice, ...t.steps.flatMap((s) => [s.from, s.to])]),
    dice: g.dice
  }),
  decode: replay$3,
  readMove: readMove$1,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$4,
    choose: (g, level) => g.turn === null || g.dice === null ? [] : choose$1(g.pos, g.turn, g.dice, level).steps.map((s) => [s.from, s.to])
  },
  result: (g) => {
    if (!over$1(g)) return null;
    const r = result$1(g.pos);
    return r ? seatOf(r.winner) : "draw";
  },
  begun: (g) => g.turns.length > 0
};
function worth(g) {
  const r = result$1(g.pos);
  if (!r) return void 0;
  return r.points === 3 ? "a backgammon, 3 points" : r.points === 2 ? "a gammon, 2 points" : "1 point";
}
const FLEETS = {
  classic: [5, 4, 3, 3, 2],
  quick: [4, 3, 2, 2],
  swarm: [3, 3, 2, 2, 2, 1, 1]
};
const SIZES = [8, 10];
function shipCells(n, at2, size2, across) {
  const r = Math.floor(at2 / n);
  const c = at2 % n;
  if (across ? c + size2 > n : r + size2 > n) return null;
  return Array.from({ length: size2 }, (_, k) => across ? at2 + k : at2 + k * n);
}
function fits(n, fleet, cells, apart, ignore = -1) {
  const taken = /* @__PURE__ */ new Set();
  for (const s of fleet) {
    if (s.id === ignore) continue;
    for (const c of s.cells) {
      taken.add(c);
      if (!apart) continue;
      const r = Math.floor(c / n);
      const k = c % n;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = k + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) taken.add(rr * n + cc);
        }
    }
  }
  return cells.every((c) => !taken.has(c));
}
function randomFleet(n, sizes, apart, rand) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const fleet = [];
    let ok = true;
    const order2 = sizes.map((size2, id) => ({ size: size2, id })).sort((a, b) => b.size - a.size);
    for (const { size: size2, id } of order2) {
      let placed2 = false;
      for (let t = 0; t < 400 && !placed2; t++) {
        const across = rand() < 0.5;
        const cells = shipCells(n, Math.floor(rand() * n * n), size2, across);
        if (cells && fits(n, fleet, cells, apart)) {
          fleet.push({ id, size: size2, cells });
          placed2 = true;
        }
      }
      if (!placed2) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet.sort((a, b) => a.id - b.id);
  }
  throw new Error("no room for that fleet");
}
const blankSeen = (n) => ({ n, marks: Array(n * n).fill(0), sunk: [] });
function fire(fleet, seen, at2) {
  if (seen.marks[at2]) throw new Error(`already shot at ${at2}`);
  const ship = fleet.find((s) => s.cells.includes(at2));
  if (!ship) {
    seen.marks[at2] = 1;
    return "miss";
  }
  seen.marks[at2] = 2;
  if (ship.cells.every((c) => seen.marks[c] === 2)) {
    seen.sunk.push({ size: ship.size, cells: ship.cells });
    return "sunk";
  }
  return "hit";
}
const LEVELS$3 = ["easy", "fair", "hard"];
function afloat(sizes, seen) {
  const left2 = [...sizes];
  for (const s of seen.sunk) left2.splice(left2.indexOf(s.size), 1);
  return left2;
}
function wounded(seen) {
  const sunk = new Set(seen.sunk.flatMap((s) => s.cells));
  const out = [];
  seen.marks.forEach((m, i) => {
    if (m === 2 && !sunk.has(i)) out.push(i);
  });
  return out;
}
function density(seen, sizes, apart) {
  const { n } = seen;
  const heat = Array(n * n).fill(0);
  const open2 = wounded(seen);
  const sunkCells = new Set(seen.sunk.flatMap((s) => s.cells));
  const near2 = (c) => {
    if (!apart) return false;
    const r = Math.floor(c / n);
    const k = c % n;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = k + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && sunkCells.has(rr * n + cc)) return true;
      }
    return false;
  };
  for (const size2 of afloat(sizes, seen))
    for (let at2 = 0; at2 < n * n; at2++)
      for (const across of [true, false]) {
        const cells = shipCells(n, at2, size2, across);
        if (!cells) continue;
        if (cells.some((c) => seen.marks[c] === 1 || sunkCells.has(c) || near2(c))) continue;
        const through = cells.filter((c) => open2.includes(c)).length;
        if (open2.length && !through) continue;
        const weight = open2.length ? 1 + through * 40 : 1;
        for (const c of cells) if (!seen.marks[c]) heat[c] += weight;
      }
  return heat;
}
function aim(seen, sizes, apart, level, rand) {
  const { n } = seen;
  const unshot = seen.marks.map((m, i) => m ? -1 : i).filter((i) => i >= 0);
  const pick2 = (list) => list[Math.floor(rand() * list.length)];
  const hits = wounded(seen);
  const around2 = (c) => [c - n, c + n, c % n ? c - 1 : -1, c % n < n - 1 ? c + 1 : -1].filter(
    (x) => x >= 0 && x < n * n && !seen.marks[x]
  );
  if (level === "easy") {
    if (hits.length && rand() < 0.5) {
      const next2 = hits.flatMap(around2);
      if (next2.length) return pick2(next2);
    }
    return pick2(unshot);
  }
  if (level === "fair") {
    if (hits.length) {
      const line = hits.length >= 2;
      const across = line && hits.every((h) => Math.floor(h / n) === Math.floor(hits[0] / n));
      const down = line && hits.every((h) => h % n === hits[0] % n);
      let next2 = hits.flatMap(around2);
      if (across) next2 = next2.filter((c) => Math.floor(c / n) === Math.floor(hits[0] / n));
      else if (down) next2 = next2.filter((c) => c % n === hits[0] % n);
      if (!next2.length) next2 = hits.flatMap(around2);
      if (next2.length) return pick2(next2);
    }
    const smallest = Math.min(...afloat(sizes, seen));
    const checker = unshot.filter(
      (i) => (Math.floor(i / n) + i % n) % Math.max(2, smallest) === 0
    );
    return pick2(checker.length ? checker : unshot);
  }
  const heat = density(seen, sizes, apart);
  let best = [];
  let bh = -1;
  for (const i of unshot) {
    if (heat[i] > bh) {
      bh = heat[i];
      best = [i];
    } else if (heat[i] === bh) best.push(i);
  }
  return pick2(best);
}
function readSeaSettings(s) {
  const size2 = s.size ?? 10;
  const fleet = s.fleet ?? "classic";
  const apart = s.apart ?? true;
  const again = s.again ?? false;
  if (!SIZES.includes(size2)) return null;
  if (typeof fleet !== "string" || !Object.hasOwn(FLEETS, fleet)) return null;
  if (typeof apart !== "boolean" || typeof again !== "boolean") return null;
  return { size: size2, fleet, apart, again };
}
const other$4 = (s) => s === 0 ? 1 : 0;
function fresh$8(set) {
  return {
    set,
    sizes: FLEETS[set.fleet],
    fleets: [null, null],
    placed: [false, false],
    seen: [blankSeen(set.size), blankSeen(set.size)],
    shots: [],
    turn: 0,
    winner: null
  };
}
function readFleet(set, x) {
  const sizes = FLEETS[set.fleet];
  const n = set.size;
  if (!Array.isArray(x) || x.length !== sizes.length) return null;
  const fleet = [];
  for (let id = 0; id < sizes.length; id++) {
    const cells = x[id];
    if (!Array.isArray(cells) || cells.length !== sizes[id]) return null;
    if (!cells.every((c) => Number.isInteger(c) && c >= 0 && c < n * n)) return null;
    const sorted = [...cells].sort((a, b) => a - b);
    const line = sizes[id] === 1 ? [sorted[0]] : shipCells(n, sorted[0], sizes[id], sorted[1] - sorted[0] === 1) ?? [];
    if (line.join() !== sorted.join()) return null;
    if (!fits(n, fleet, sorted, set.apart)) return null;
    fleet.push({ id, size: sizes[id], cells: sorted });
  }
  return fleet;
}
const fleetCells = (f) => f.map((s) => s.cells);
function shoot(g, by, at2) {
  const target = g.fleets[other$4(by)];
  const seen = [
    { ...g.seen[0], marks: [...g.seen[0].marks], sunk: [...g.seen[0].sunk] },
    { ...g.seen[1], marks: [...g.seen[1].marks], sunk: [...g.seen[1].sunk] }
  ];
  const shot = fire(target, seen[by], at2);
  const sunk = shot === "sunk" ? seen[by].sunk[seen[by].sunk.length - 1].cells : void 0;
  const won2 = seen[by].sunk.length === g.sizes.length;
  const again = shot !== "miss" && g.set.again;
  return {
    ...g,
    seen,
    shots: [...g.shots, { by, at: at2, shot, ...sunk ? { sunk } : {} }],
    winner: won2 ? by : null,
    turn: won2 ? null : again ? by : other$4(by)
  };
}
function replayPublic$5(set, x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.placed) || !Array.isArray(o.shots))
    return null;
  if (o.placed.length !== 2 || !o.placed.every((p) => typeof p === "boolean")) return null;
  const n = set.size;
  let g = fresh$8(set);
  g = { ...g, placed: [o.placed[0], o.placed[1]] };
  if (o.shots.length > 2 * n * n) return null;
  for (const raw of o.shots) {
    if (g.turn === null || !Array.isArray(raw) || raw.length < 2) return null;
    const [at2, r] = raw;
    const by = g.turn;
    if (!Number.isInteger(at2) || at2 < 0 || at2 >= n * n || g.seen[by].marks[at2]) return null;
    if (r !== 1 && r !== 2 && r !== 3) return null;
    if (!g.placed[other$4(by)] || !g.placed[by]) return null;
    const seen = [
      { ...g.seen[0], marks: [...g.seen[0].marks], sunk: [...g.seen[0].sunk] },
      { ...g.seen[1], marks: [...g.seen[1].marks], sunk: [...g.seen[1].sunk] }
    ];
    seen[by].marks[at2] = r === 1 ? 1 : 2;
    let sunk;
    if (r === 3) {
      sunk = raw.slice(2);
      const afloat2 = [...g.sizes];
      for (const s of seen[by].sunk) afloat2.splice(afloat2.indexOf(s.size), 1);
      const sorted = [...sunk].sort((a, b) => a - b);
      const line = sorted.length === 1 ? [sorted[0]] : shipCells(n, sorted[0], sorted.length, sorted[1] - sorted[0] === 1) ?? [];
      if (!afloat2.includes(sunk.length) || line.join() !== sorted.join()) return null;
      if (!sunk.includes(at2) || !sunk.every((c) => seen[by].marks[c] === 2)) return null;
      seen[by].sunk.push({ size: sunk.length, cells: sorted });
      sunk = sorted;
    } else if (raw.length !== 2) return null;
    const shot = r === 1 ? "miss" : r === 2 ? "hit" : "sunk";
    const won2 = seen[by].sunk.length === g.sizes.length;
    const again = shot !== "miss" && set.again;
    g = {
      ...g,
      seen,
      shots: [...g.shots, { by, at: at2, shot, ...sunk ? { sunk } : {} }],
      winner: won2 ? by : null,
      turn: won2 ? null : again ? by : other$4(by)
    };
  }
  return g;
}
function readSeaMove(x) {
  const o = x;
  if (!o || typeof o !== "object" || !Number.isInteger(o.at) || o.at < 0) return null;
  if (o.fleet === void 0) return { at: o.at };
  if (!Array.isArray(o.fleet) || o.fleet.length > 10) return null;
  return { at: o.at, fleet: o.fleet };
}
function seaRules(set) {
  const n = set.size;
  const brings = (g, m, by) => g.placed[by] ? m.fleet === void 0 ? "none" : null : m.fleet ? readFleet(set, m.fleet) : null;
  return {
    fresh: () => fresh$8(set),
    turn: (g) => g.turn,
    legal: (g, m, by) => {
      if (g.turn === null || by !== void 0 && by !== g.turn) return false;
      const side = g.turn;
      if (!Number.isInteger(m.at) || m.at < 0 || m.at >= n * n || g.seen[side].marks[m.at])
        return false;
      if (!g.placed[other$4(side)]) return false;
      return brings(g, m, side) !== null;
    },
    apply: (g, m) => {
      if (g.turn === null) return g;
      const side = g.turn;
      const f = brings(g, m, side);
      if (f === null) return g;
      let cur = g;
      if (f !== "none") {
        const fleets = [...g.fleets];
        fleets[side] = f;
        const placed2 = [...g.placed];
        placed2[side] = true;
        cur = { ...g, fleets, placed: placed2 };
      }
      return cur.fleets[other$4(side)] ? shoot(cur, side, m.at) : cur;
    },
    encode: (g) => ({
      placed: g.placed,
      shots: g.shots.map(
        (s) => s.shot === "sunk" ? [s.at, 3, ...s.sunk] : [s.at, s.shot === "hit" ? 2 : 1]
      )
    }),
    decode: (x) => replayPublic$5(set, x),
    readMove: readSeaMove,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: LEVELS$3,
      choose: (g, level) => ({
        at: aim(g.seen[1], g.sizes, set.apart, level, Math.random)
      })
    },
    result: (g) => g.winner,
    begun: (g) => g.shots.length > 0,
    hidden: {
      secret: (g) => ({ fleets: g.fleets.map((f) => f ? fleetCells(f) : null) }),
      join: (g, secret) => {
        const list = secret?.fleets;
        if (!Array.isArray(list) || list.length !== 2) return null;
        const fleets = [null, null];
        for (const s of [0, 1]) {
          if (!g.placed[s]) {
            if (list[s] !== null) return null;
            continue;
          }
          fleets[s] = readFleet(set, list[s]);
          if (!fleets[s]) return null;
        }
        let check = { ...fresh$8(set), placed: g.placed, fleets };
        for (const s of g.shots) {
          check = shoot(check, s.by, s.at);
          const again = check.shots[check.shots.length - 1];
          if (again.shot !== s.shot || (again.sunk ?? []).join() !== (s.sunk ?? []).join())
            return null;
        }
        return { ...g, fleets };
      },
      mine: (g, side) => g.fleets[side] ? fleetCells(g.fleets[side]) : null,
      logged: (m) => ({ at: m.at }),
      accept: (g, brought, mode) => {
        const f = mode === "together" ? randomFleet(n, g.sizes, set.apart, Math.random) : readFleet(set, brought);
        if (!f) return null;
        return { ...g, fleets: [g.fleets[0], f], placed: [g.placed[0], true] };
      }
    }
  };
}
const TARGET$1 = 1e4;
const counts = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
const kind = (face, n) => (face === 1 ? 1e3 : face * 100) * 2 ** (n - 3);
function scoreOf(dice) {
  if (!dice.length) return null;
  const c = counts(dice);
  if (dice.length === 6) {
    if (c.slice(1).every((n) => n === 1)) return 1500;
    if (c.filter((n) => n === 2).length === 3) return 750;
  }
  let total2 = 0;
  for (let f = 1; f <= 6; f++) {
    let n = c[f];
    if (n >= 3) {
      total2 += kind(f, n);
      n = 0;
    }
    if (n > 0) {
      if (f === 1) total2 += 100 * n;
      else if (f === 5) total2 += 50 * n;
      else return null;
    }
  }
  return total2;
}
function options(roll2) {
  const out = [];
  const n = roll2.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const keep = [];
    for (let i = 0; i < n; i++) if (mask & 1 << i) keep.push(i);
    const points2 = scoreOf(keep.map((i) => roll2[i]));
    if (points2 !== null) out.push({ keep, points: points2 });
  }
  return out;
}
const scores$1 = (roll2) => roll2.some((d) => d === 1 || d === 5) || counts(roll2).some((n) => n >= 3) || scoreOf(roll2) !== null;
function bustChance(n) {
  let bust = 0;
  const roll2 = new Array(n).fill(1);
  const total2 = 6 ** n;
  for (let k = 0; k < total2; k++) {
    let x = k;
    for (let i = 0; i < n; i++) {
      roll2[i] = x % 6 + 1;
      x = Math.floor(x / 6);
    }
    if (!scores$1(roll2)) bust++;
  }
  return bust / total2;
}
[0, 1, 2, 3, 4, 5, 6].map((n) => n ? bustChance(n) : 0);
function roll$4(n, rand) {
  return Array.from({ length: n }, () => 1 + Math.floor(rand() * 6));
}
function setAside(t, keep) {
  const pts = scoreOf(keep.map((i) => t.roll[i]));
  if (pts === null || t.bust) return null;
  const free = t.free - keep.length;
  return {
    roll: t.roll.filter((_, i) => !keep.includes(i)),
    points: t.points + pts,
    free: free === 0 ? 6 : free,
    bust: false
  };
}
const DICE_WORTH = [0, 25, 50, 100, 200, 300, 450];
function chooseKeep$1(roll2) {
  let best = null;
  for (const o of options(roll2)) {
    const left2 = roll2.length - o.keep.length;
    const value2 = o.points + DICE_WORTH[left2 === 0 ? 6 : left2];
    if (!best || value2 > best.value) best = { keep: o.keep, value: value2 };
  }
  return best ? best.keep : [];
}
const BANK_AT = [0, 300, 300, 400, 1e3, 2e3, Infinity];
function wantsBank(t, mine2, theirs) {
  if (mine2 + t.points >= TARGET$1) return true;
  const behind = theirs - mine2 > 2500 && theirs > TARGET$1 * 0.7;
  return t.points >= BANK_AT[t.free] * (behind ? 2 : 1);
}
const MAX_TURNS = 400;
const other$3 = (s) => s === 0 ? 1 : 0;
const fresh$7 = () => ({
  scores: [0, 0],
  turn: 0,
  table: null,
  points: 0,
  free: 6,
  log: [],
  turns: 0,
  winner: null
});
function pass(g, banked) {
  const side = g.turn;
  const sc = [...g.scores];
  sc[side] += banked;
  const turns = g.turns + 1;
  const won2 = sc[side] >= TARGET$1;
  const drawn = !won2 && turns >= MAX_TURNS;
  return {
    ...g,
    scores: sc,
    turns,
    table: null,
    points: 0,
    free: 6,
    turn: won2 || drawn ? null : other$3(side),
    winner: won2 ? side : drawn ? "draw" : null
  };
}
function landed$1(g, r) {
  const cur = { ...g, log: [...g.log, { roll: r }] };
  return scores$1(r) ? { ...cur, table: r } : pass(cur, 0);
}
function decide$3(g, d) {
  if (g.turn === null || !g.table) return null;
  const t = setAside({ roll: g.table, points: g.points, free: g.free, bust: false }, d.keep);
  if (!t) return null;
  const cur = { ...g, log: [...g.log, { keep: [...d.keep], bank: d.bank }] };
  if (d.bank) return pass(cur, t.points);
  return { ...cur, table: null, points: t.points, free: t.free };
}
function roll$3(g, rand) {
  let cur = g;
  for (let k = 0; k < MAX_TURNS && cur.turn !== null && cur.table === null; k++)
    cur = landed$1(cur, roll$4(cur.free, rand));
  return cur;
}
const isFace$2 = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
function readDecision(x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.keep) || typeof o.bank !== "boolean")
    return null;
  const keep = o.keep;
  if (!keep.length || keep.length > 6) return null;
  if (!keep.every((i) => Number.isInteger(i) && i >= 0 && i < 6)) return null;
  if (new Set(keep).size !== keep.length) return null;
  return { keep: [...keep].sort((a, b) => a - b), bank: o.bank };
}
function replay$2(x) {
  const list = x?.log;
  if (!Array.isArray(list) || list.length > MAX_TURNS * 20) return null;
  let g = fresh$7();
  for (const e of list) {
    if (g.turn === null || !Array.isArray(e) || !e.length) return null;
    if (e[0] === 0) {
      const d = readDecision({ keep: e.slice(2), bank: e[1] === 1 });
      if (!d || e[1] !== 0 && e[1] !== 1) return null;
      const next2 = decide$3(g, d);
      if (!next2) return null;
      g = next2;
    } else {
      if (g.table !== null || e.length !== g.free || !e.every(isFace$2)) return null;
      g = landed$1(g, e);
    }
  }
  return g;
}
const LEVELS$2 = ["easy", "fair", "hard"];
function choose(g, level) {
  const table = g.table ?? [];
  const side = g.turn ?? 1;
  const keep = level === "hard" ? chooseKeep$1(table) : options(table).sort((a, b) => b.keep.length - a.keep.length || b.points - a.points)[0]?.keep ?? [];
  const t = setAside({ roll: table, points: g.points, free: g.free, bust: false }, keep);
  if (!t) return { keep, bank: true };
  const mine2 = g.scores[side];
  const bank = mine2 + t.points >= TARGET$1 || (level === "easy" ? t.points >= 300 : wantsBank(t, mine2, g.scores[side === 0 ? 1 : 0]));
  return { keep, bank };
}
const diceRules = {
  fresh: fresh$7,
  turn: (g) => g.turn,
  legal: (g, d, by) => g.turn !== null && (by === void 0 || by === g.turn) && decide$3(g, d) !== null,
  apply: (g, d) => decide$3(g, d) ?? g,
  roll: roll$3,
  encode: (g) => ({
    log: g.log.map((e) => "roll" in e ? e.roll : [0, e.bank ? 1 : 0, ...e.keep])
  }),
  decode: replay$2,
  readMove: readDecision,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$2,
    choose: (g, level) => choose(g, level)
  },
  result: (g) => g.winner,
  begun: (g) => g.log.length > 1
};
const CATS = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "full",
  "four",
  "little",
  "big",
  "choice",
  "yacht"
];
const countsOf = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
function score$1(dice, cat) {
  const c = countsOf(dice);
  const sum2 = dice.reduce((s, d) => s + d, 0);
  const face = CATS.indexOf(cat) + 1;
  if (face <= 6) return c[face] * face;
  switch (cat) {
    case "full":
      return c.includes(3) && c.includes(2) ? sum2 : 0;
    case "four": {
      const f = c.findIndex((n) => n >= 4);
      return f > 0 ? 4 * f : 0;
    }
    case "little":
      return [1, 2, 3, 4, 5].every((f) => c[f] === 1) ? 30 : 0;
    case "big":
      return [2, 3, 4, 5, 6].every((f) => c[f] === 1) ? 30 : 0;
    case "choice":
      return sum2;
    default:
      return c.includes(5) ? 50 : 0;
  }
}
const total = (card2) => CATS.reduce((s, k) => s + (card2[k] ?? 0), 0);
const open = (card2) => CATS.filter((k) => card2[k] === void 0);
const code = (c) => c[1] + 6 * (c[2] + 6 * (c[3] + 6 * (c[4] + 6 * (c[5] + 6 * c[6]))));
const decode = (k) => {
  const c = [0];
  for (let f = 1; f <= 6; f++) {
    c.push(k % 6);
    k = Math.floor(k / 6);
  }
  return c;
};
const add$1 = (a, b) => a.map((v, i) => v + b[i]);
const size = (c) => c.reduce((s, v) => s + v, 0);
const ROLLS$1 = (() => {
  const out = [];
  for (let n = 0; n <= 5; n++) {
    const tally = /* @__PURE__ */ new Map();
    for (let seq = 0; seq < 6 ** n; seq++) {
      const c = [0, 0, 0, 0, 0, 0, 0];
      for (let k = 0, s = seq; k < n; k++, s = Math.floor(s / 6)) c[s % 6 + 1]++;
      tally.set(code(c), (tally.get(code(c)) ?? 0) + 1);
    }
    out.push([...tally].map(([k, m]) => ({ c: decode(k), p: m / 6 ** n })));
  }
  return out;
})();
function keeps(c) {
  let out = [[0, 0, 0, 0, 0, 0, 0]];
  for (let f = 1; f <= 6; f++) {
    const next2 = [];
    for (const k of out)
      for (let n = 0; n <= c[f]; n++) {
        const x = [...k];
        x[f] = n;
        next2.push(x);
      }
    out = next2;
  }
  return out;
}
const diceOf = (c) => c.flatMap((n, f) => Array(n).fill(f));
const LEVELS$1 = ["easy", "fair", "hard"];
const PAR = {
  ones: 2,
  twos: 5,
  threes: 8,
  fours: 11,
  fives: 14,
  sixes: 17,
  full: 16,
  four: 12,
  little: 12,
  big: 12,
  choice: 22,
  yacht: 14
};
function bestBox(dice, card2, withPar = true) {
  let best = open(card2)[0];
  let bv = -Infinity;
  for (const k of open(card2)) {
    const v = score$1(dice, k) - (withPar ? PAR[k] : 0);
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  return best;
}
function plan(dice, card2, rolls, withPar = true) {
  const memo = /* @__PURE__ */ new Map();
  const boxes = open(card2);
  const finals = /* @__PURE__ */ new Map();
  const final = (c2) => {
    const key2 = code(c2);
    let v = finals.get(key2);
    if (v === void 0) {
      const d = diceOf(c2);
      v = Math.max(...boxes.map((k) => score$1(d, k) - (withPar ? PAR[k] : 0)));
      finals.set(key2, v);
    }
    return v;
  };
  const worth2 = (c2, r) => {
    if (r === 0) return final(c2);
    const key2 = code(c2) * 4 + r;
    const hit2 = memo.get(key2);
    if (hit2 !== void 0) return hit2;
    let best = -Infinity;
    for (const k of keeps(c2)) best = Math.max(best, average(k, r));
    memo.set(key2, best);
    return best;
  };
  const average = (k, r) => ROLLS$1[5 - size(k)].reduce((s, o) => s + o.p * worth2(add$1(k, o.c), r - 1), 0);
  const c = countsOf(dice);
  if (rolls === 0) return { keep: [...dice], value: final(c) };
  let keep = c;
  let value2 = -Infinity;
  for (const k of keeps(c)) {
    const v = average(k, rolls);
    if (v > value2 + 1e-9) {
      value2 = v;
      keep = k;
    }
  }
  return { keep: diceOf(keep), value: value2 };
}
function holdFor(dice, keep) {
  const left2 = [...keep];
  return dice.map((d) => {
    const i = left2.indexOf(d);
    if (i < 0) return false;
    left2.splice(i, 1);
    return true;
  });
}
function chooseKeep(dice, card2, rolls, level) {
  if (level === "easy") {
    const c = countsOf(dice);
    let f = 6;
    for (let x = 6; x >= 1; x--) if (c[x] > c[f]) f = x;
    return dice.map((d) => d === f);
  }
  const p = level === "fair" ? plan(dice, card2, Math.min(1, rolls), false) : plan(dice, card2, rolls);
  return holdFor(dice, p.keep);
}
const chooseBox = (dice, card2, level) => bestBox(dice, card2, level === "hard");
const newGame = (first = 0) => ({
  cards: [{}, {}],
  turn: first,
  dice: [1, 1, 1, 1, 1],
  held: [false, false, false, false, false],
  rolls: 3,
  over: false
});
function roll$2(g, rand) {
  if (g.over || g.rolls === 0) return g;
  return {
    ...g,
    dice: g.dice.map((d, i) => g.held[i] ? d : 1 + Math.floor(rand() * 6)),
    rolls: g.rolls - 1
  };
}
const hold = (g, held) => g.rolls === 3 || g.rolls === 0 ? g : { ...g, held };
function fill(g, cat) {
  if (g.over || g.rolls === 3 || g.cards[g.turn][cat] !== void 0) return g;
  const cards2 = [{ ...g.cards[0] }, { ...g.cards[1] }];
  cards2[g.turn][cat] = score$1(g.dice, cat);
  const over2 = open(cards2[0]).length === 0 && open(cards2[1]).length === 0;
  const other2 = g.turn === 0 ? 1 : 0;
  return {
    ...g,
    cards: cards2,
    turn: open(cards2[other2]).length ? other2 : g.turn,
    held: [false, false, false, false, false],
    rolls: 3,
    over: over2
  };
}
Object.fromEntries(CATS.map((k) => [k, 0]));
const fresh$6 = () => ({ g: newGame(0), need: false, log: [] });
const waiting$1 = (y) => y.g.rolls === 3 || y.need;
function roll$1(y, rand) {
  if (y.g.over || !waiting$1(y)) return y;
  const g = roll$2(y.g, rand);
  return { g, need: false, log: [...y.log, { roll: g.dice }] };
}
function decide$2(y, m) {
  if (y.g.over || waiting$1(y)) return null;
  if ("hold" in m) {
    if (y.g.rolls === 0 || m.hold.every(Boolean)) return null;
    return { g: hold(y.g, m.hold), need: true, log: [...y.log, { hold: [...m.hold] }] };
  }
  if (y.g.cards[y.g.turn][m.box] !== void 0) return null;
  return { g: fill(y.g, m.box), need: false, log: [...y.log, { box: m.box }] };
}
const isFace$1 = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
function readYachtMove(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  if (Array.isArray(o.hold))
    return o.hold.length === 5 && o.hold.every((h) => typeof h === "boolean") ? { hold: [...o.hold] } : null;
  return typeof o.box === "string" && CATS.includes(o.box) ? { box: o.box } : null;
}
function replay$1(x) {
  const list = x?.log;
  if (!Array.isArray(list) || list.length > 200) return null;
  let y = fresh$6();
  for (const e of list) {
    if (y.g.over || !Array.isArray(e)) return null;
    if (e.length === 5) {
      if (!waiting$1(y) || !e.every(isFace$1)) return null;
      if (y.g.held.some((h, i) => h && y.g.dice[i] !== e[i])) return null;
      const g = { ...y.g, dice: e, rolls: y.g.rolls - 1 };
      y = { g, need: false, log: [...y.log, { roll: g.dice }] };
      continue;
    }
    const m = e[0] === 0 && e.length === 6 && e.slice(1).every((b) => b === 0 || b === 1) ? { hold: e.slice(1).map((b) => b === 1) } : e[0] === 9 && e.length === 2 && Number.isInteger(e[1]) && CATS[e[1]] ? { box: CATS[e[1]] } : null;
    const next2 = m && decide$2(y, m);
    if (!next2) return null;
    y = next2;
  }
  return y;
}
const yachtRules = {
  fresh: fresh$6,
  turn: (y) => y.g.over ? null : y.g.turn,
  legal: (y, m, by) => !y.g.over && (by === void 0 || by === y.g.turn) && decide$2(y, m) !== null,
  apply: (y, m) => decide$2(y, m) ?? y,
  roll: roll$1,
  encode: (y) => ({
    log: y.log.map(
      (e) => "roll" in e ? e.roll : "hold" in e ? [0, ...e.hold.map((h) => h ? 1 : 0)] : [9, CATS.indexOf(e.box)]
    )
  }),
  decode: replay$1,
  readMove: readYachtMove,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS$1,
    choose: (y, level) => {
      const { dice, cards: cards2, rolls } = y.g;
      const card2 = cards2[1];
      if (rolls > 0) {
        const keep = chooseKeep(dice, card2, rolls, level);
        if (!keep.every(Boolean)) return { hold: keep };
      }
      return { box: chooseBox(dice, card2, level) };
    }
  },
  result: (y) => {
    if (!y.g.over) return null;
    const [a, b] = [total(y.g.cards[0]), total(y.g.cards[1])];
    return a > b ? 0 : b > a ? 1 : "draw";
  },
  begun: (y) => y.log.length > 1
};
const ALL = 511;
const tilesOf = (up) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((t) => up & 1 << t - 1);
const sum = (up) => tilesOf(up).reduce((s, t) => s + t, 0);
const oneDieAllowed = (up) => (up & 448) === 0;
function ways(up, roll2) {
  const out = [];
  for (let s = up; s > 0; s = s - 1 & up) if (sum(s) === roll2) out.push(s);
  return out;
}
const ROLLS = {
  1: [1, 2, 3, 4, 5, 6].map((roll2) => ({ roll: roll2, p: 1 / 6 })),
  2: Array.from({ length: 11 }, (_, k) => ({ roll: k + 2, p: (6 - Math.abs(k + 2 - 7)) / 36 }))
};
const EXPECT = (() => {
  const e = new Float64Array(ALL + 1);
  for (let up = 0; up <= ALL; up++) {
    if (up === 0) continue;
    const by = (dice) => ROLLS[dice].reduce((s, { roll: roll2, p }) => {
      const w = ways(up, roll2);
      return s + p * (w.length ? Math.min(...w.map((x) => e[up & ~x])) : sum(up));
    }, 0);
    e[up] = oneDieAllowed(up) ? Math.min(by(1), by(2)) : by(2);
  }
  return e;
})();
(() => {
  const c = new Float64Array(ALL + 1);
  c[0] = 1;
  for (let up = 1; up <= ALL; up++) {
    const by = (dice) => ROLLS[dice].reduce((s, { roll: roll2, p }) => {
      const w = ways(up, roll2);
      return s + p * (w.length ? Math.max(...w.map((x) => c[up & ~x])) : 0);
    }, 0);
    c[up] = oneDieAllowed(up) ? Math.max(by(1), by(2)) : by(2);
  }
  return c;
})();
function bestDice(up) {
  if (!oneDieAllowed(up)) return 2;
  const by = (dice) => ROLLS[dice].reduce((s, { roll: roll2, p }) => {
    const w = ways(up, roll2);
    return s + p * (w.length ? Math.min(...w.map((x) => EXPECT[up & ~x])) : sum(up));
  }, 0);
  return by(1) < by(2) ? 1 : 2;
}
const LEVELS = ["easy", "fair", "hard"];
function chooseWay(up, roll2, level, rand) {
  const w = ways(up, roll2);
  if (!w.length) return 0;
  if (level === "easy") return w[Math.floor(rand() * w.length)];
  if (level === "fair")
    return [...w].sort(
      (a, b) => tilesOf(a).length - tilesOf(b).length || Math.max(...tilesOf(b)) - Math.max(...tilesOf(a))
    )[0];
  return w.reduce((best, x) => EXPECT[up & ~x] < EXPECT[up & ~best] ? x : best);
}
const chooseDice = (up, level) => !oneDieAllowed(up) ? 2 : level === "hard" ? bestDice(up) : level === "fair" ? 1 : 2;
const fresh$5 = () => ({
  up: [ALL, ALL],
  turn: 0,
  due: "roll",
  n: 2,
  dice: [],
  log: []
});
function done$1(g) {
  const next2 = g.turn === 0 ? 1 : null;
  return { ...g, turn: next2, due: "roll", n: 2, dice: [] };
}
function after(g, up) {
  const side = g.turn;
  if (up[side] === 0) return done$1({ ...g, up });
  const one = oneDieAllowed(up[side]);
  return { ...g, up, dice: [], due: one ? "dice" : "roll", n: 2 };
}
function landed(g, dice) {
  const cur = { ...g, log: [...g.log, { roll: dice }] };
  const total2 = dice.reduce((s, d) => s + d, 0);
  return ways(g.up[g.turn], total2).length ? { ...cur, dice, due: "shut" } : done$1(cur);
}
function roll(g, rand) {
  let cur = g;
  for (let k = 0; k < 4 && cur.turn !== null && cur.due === "roll"; k++) {
    const dice = Array.from({ length: cur.n }, () => 1 + Math.floor(rand() * 6));
    cur = landed(cur, dice);
  }
  return cur;
}
function decide$1(g, m) {
  if (g.turn === null) return null;
  const side = g.turn;
  if ("dice" in m) {
    if (g.due !== "dice" || m.dice !== 1 && m.dice !== 2) return null;
    return { ...g, due: "roll", n: m.dice, log: [...g.log, { dice: m.dice }] };
  }
  if (g.due !== "shut") return null;
  const total2 = g.dice.reduce((s, d) => s + d, 0);
  if ((m.shut & g.up[side]) !== m.shut || m.shut === 0 || sum(m.shut) !== total2) return null;
  const up = [...g.up];
  up[side] &= ~m.shut;
  return after({ ...g, log: [...g.log, { shut: m.shut }] }, up);
}
function readShutMove(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  if (o.dice === 1 || o.dice === 2) return { dice: o.dice };
  return Number.isInteger(o.shut) && o.shut > 0 && o.shut <= ALL ? { shut: o.shut } : null;
}
const isFace = (v) => Number.isInteger(v) && v >= 1 && v <= 6;
function replay(x) {
  const list = x?.log;
  if (!Array.isArray(list) || list.length > 120) return null;
  let g = fresh$5();
  for (const e of list) {
    if (g.turn === null || !Array.isArray(e) || !e.length) return null;
    if (e[0] === 0 || e[0] === 9) {
      const m = e.length === 2 ? readShutMove(e[0] === 0 ? { shut: e[1] } : { dice: e[1] }) : null;
      const next2 = m && decide$1(g, m);
      if (!next2) return null;
      g = next2;
      continue;
    }
    if (g.due !== "roll" || e.length !== g.n || !e.every(isFace)) return null;
    g = landed(g, e);
  }
  return g;
}
const shutRules = {
  fresh: fresh$5,
  turn: (g) => g.turn,
  legal: (g, m, by) => g.turn !== null && (by === void 0 || by === g.turn) && decide$1(g, m) !== null,
  apply: (g, m) => decide$1(g, m) ?? g,
  roll,
  encode: (g) => ({
    log: g.log.map((e) => "roll" in e ? e.roll : "shut" in e ? [0, e.shut] : [9, e.dice])
  }),
  decode: replay,
  readMove: readShutMove,
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => g.due === "dice" ? { dice: chooseDice(g.up[1], level) } : {
      shut: chooseWay(
        g.up[1],
        g.dice.reduce((s, d) => s + d, 0),
        level,
        Math.random
      )
    }
  },
  result: (g) => {
    if (g.turn !== null) return null;
    const [a, b] = [sum(g.up[0]), sum(g.up[1])];
    return a < b ? 0 : b < a ? 1 : "draw";
  },
  begun: (g) => g.log.length > 1
};
const LENGTHS = [3, 4, 5];
const COLOUR_COUNTS = [4, 5, 6, 7, 8];
const TRIES = [6, 8, 10, 12];
function mark(secret, guess2) {
  let exact = 0;
  const a = new Array(10).fill(0);
  const b = new Array(10).fill(0);
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess2[i]) exact++;
    a[secret[i]]++;
    b[guess2[i]]++;
  }
  let both = 0;
  for (let c = 0; c < 10; c++) both += Math.min(a[c], b[c]);
  return { exact, near: both - exact };
}
function allCodes(rules) {
  const out = [];
  const walk = (prefix) => {
    if (prefix.length === rules.length) {
      out.push(prefix);
      return;
    }
    for (let c = 0; c < rules.colours; c++)
      if (rules.repeats || !prefix.includes(c)) walk([...prefix, c]);
  };
  walk([]);
  return out;
}
const valid = (code2, rules) => code2.length === rules.length && code2.every((c) => Number.isInteger(c) && c >= 0 && c < rules.colours) && (rules.repeats || new Set(code2).size === code2.length);
function consistent(pool, history2) {
  return pool.filter(
    (s) => history2.every(({ guess: guess2, mark: m }) => {
      const k = mark(s, guess2);
      return k.exact === m.exact && k.near === m.near;
    })
  );
}
function randomCode(rules, rand) {
  const code2 = [];
  while (code2.length < rules.length) {
    const c = Math.floor(rand() * rules.colours);
    if (rules.repeats || !code2.includes(c)) code2.push(c);
  }
  return code2;
}
function guessFor(possible, level, rand) {
  if (possible.length <= 2 || level === "lucky")
    return possible[Math.floor(rand() * possible.length)];
  const candidates2 = possible.length > 300 ? Array.from({ length: 300 }, () => possible[Math.floor(rand() * possible.length)]) : possible;
  const judge2 = possible.length > 1500 ? candidates2 : possible;
  let best = candidates2[0];
  let bestWorst = Infinity;
  for (const g of candidates2) {
    const buckets = /* @__PURE__ */ new Map();
    let worst = 0;
    for (const s of judge2) {
      const m = mark(s, g);
      const k = m.exact * 16 + m.near;
      const n = (buckets.get(k) ?? 0) + 1;
      buckets.set(k, n);
      if (n > worst) worst = n;
      if (worst >= bestWorst) break;
    }
    if (worst < bestWorst) {
      bestWorst = worst;
      best = g;
    }
  }
  return best;
}
({
  spread: Array(13).fill(0)
});
function readCodeSettings(s) {
  const length = s.length ?? 4;
  const colours = s.colours ?? 6;
  const repeats = s.repeats ?? true;
  const tries = s.tries ?? 10;
  if (!LENGTHS.includes(length)) return null;
  if (!COLOUR_COUNTS.includes(colours)) return null;
  if (typeof repeats !== "boolean" || !TRIES.includes(tries)) return null;
  return { length, colours, repeats, tries };
}
const other$2 = (s) => s === 0 ? 1 : 0;
const count$1 = (g, s) => g.guesses.filter((x) => x.by === s).length;
const cracked = (g, s) => {
  const i = g.guesses.findIndex((x) => x.by === s && x.mark.exact === g.rules.length);
  return i < 0 ? null : g.guesses.slice(0, i + 1).filter((x) => x.by === s).length;
};
const done = (g, s) => cracked(g, s) !== null || count$1(g, s) >= g.rules.tries;
function whoseGuess(g) {
  if (done(g, 0) && done(g, 1)) return null;
  for (const s of [0, 1]) {
    const k = cracked(g, s);
    if (k !== null && count$1(g, other$2(s)) >= k) return null;
  }
  if (done(g, 0)) return 1;
  if (done(g, 1)) return 0;
  return count$1(g, 1) < count$1(g, 0) ? 1 : 0;
}
const fresh$4 = (rules) => ({
  rules,
  codes: [null, null],
  placed: [false, false],
  guesses: []
});
function guessed(g, by, guess2) {
  return { ...g, guesses: [...g.guesses, { by, guess: guess2, mark: mark(g.codes[other$2(by)], guess2) }] };
}
const readCode = (rules, x) => Array.isArray(x) && valid(x, rules) ? [...x] : null;
function readCodeMove(x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.guess) || o.guess.length > 5) return null;
  if (!o.guess.every((c) => Number.isInteger(c) && c >= 0 && c < 8)) return null;
  if (o.code === void 0) return { guess: [...o.guess] };
  if (!Array.isArray(o.code) || o.code.length > 5) return null;
  return { guess: [...o.guess], code: [...o.code] };
}
function replayPublic$4(rules, x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.placed) || !Array.isArray(o.guesses))
    return null;
  if (o.placed.length !== 2 || !o.placed.every((p) => typeof p === "boolean")) return null;
  let g = { ...fresh$4(rules), placed: [o.placed[0], o.placed[1]] };
  for (const e of o.guesses) {
    const by = whoseGuess(g);
    if (by === null || !Array.isArray(e) || e.length !== rules.length + 2) return null;
    const guess2 = readCode(rules, e.slice(0, rules.length));
    const [exact, near2] = e.slice(rules.length);
    if (!guess2 || !Number.isInteger(exact) || !Number.isInteger(near2)) return null;
    if (exact < 0 || near2 < 0 || exact + near2 > rules.length) return null;
    if (!g.placed[0] || !g.placed[1]) return null;
    g = { ...g, guesses: [...g.guesses, { by, guess: guess2, mark: { exact, near: near2 } }] };
  }
  if (o.codes !== void 0) {
    const codes = o.codes;
    if (whoseGuess(g) !== null || !Array.isArray(codes) || codes.length !== 2) return null;
    const both = codes.map((c) => readCode(rules, c));
    if (!both[0] || !both[1]) return null;
    const joined = rejoin$1(g, [both[0], both[1]]);
    if (!joined) return null;
    g = joined;
  }
  return g;
}
function rejoin$1(g, codes) {
  for (const s of [0, 1]) if (g.placed[s] !== (codes[s] !== null)) return null;
  let check = { ...fresh$4(g.rules), placed: g.placed, codes };
  for (const x of g.guesses) {
    check = guessed(check, x.by, x.guess);
    const m = check.guesses[check.guesses.length - 1].mark;
    if (m.exact !== x.mark.exact || m.near !== x.mark.near) return null;
  }
  return check;
}
function codeRules(rules) {
  const brings = (g, m, by) => g.placed[by] ? m.code === void 0 ? "none" : null : m.code ? readCode(rules, m.code) : null;
  return {
    fresh: () => fresh$4(rules),
    turn: whoseGuess,
    legal: (g, m, by) => {
      const s = whoseGuess(g);
      if (s === null || by !== void 0 && by !== s) return false;
      if (!readCode(rules, m.guess) || !g.placed[other$2(s)]) return false;
      return brings(g, m, s) !== null;
    },
    apply: (g, m) => {
      const s = whoseGuess(g);
      if (s === null) return g;
      const c = brings(g, m, s);
      if (c === null) return g;
      let cur = g;
      if (c !== "none") {
        const codes = [...g.codes];
        codes[s] = c;
        const placed2 = [...g.placed];
        placed2[s] = true;
        cur = { ...g, codes, placed: placed2 };
      }
      return cur.codes[other$2(s)] ? guessed(cur, s, m.guess) : cur;
    },
    encode: (g) => ({
      placed: g.placed,
      guesses: g.guesses.map((x) => [...x.guess, x.mark.exact, x.mark.near]),
      // once the race is over both codes are shown; before, neither is ever here
      ...whoseGuess(g) === null && g.codes[0] && g.codes[1] ? { codes: g.codes } : {}
    }),
    decode: (x) => replayPublic$4(rules, x),
    readMove: readCodeMove,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: ["easy", "fair", "hard"],
      choose: (g, level) => {
        const pool = allCodes(rules);
        const tried = g.guesses.filter((x) => x.by === 1);
        if (level === "easy") {
          const seen2 = new Set(tried.map((x) => x.guess.join()));
          const left2 = pool.filter((c) => !seen2.has(c.join()));
          return { guess: left2[Math.floor(Math.random() * left2.length)] };
        }
        const heed = level === "hard" ? tried : tried.slice(-3);
        const seen = new Set(tried.map((x) => x.guess.join()));
        const possible = consistent(pool, heed).filter((c) => !seen.has(c.join()));
        return { guess: guessFor(possible, level === "hard" ? "clever" : "lucky", Math.random) };
      }
    },
    result: (g) => {
      if (whoseGuess(g) !== null) return null;
      const [a, b] = [cracked(g, 0), cracked(g, 1)];
      if (a === null && b === null) return "draw";
      if (b === null || a !== null && a < b) return 0;
      if (a === null || b < a) return 1;
      return "draw";
    },
    begun: (g) => g.guesses.length > 0,
    hidden: {
      secret: (g) => ({ codes: g.codes }),
      join: (g, secret) => {
        const codes = secret?.codes;
        if (!Array.isArray(codes) || codes.length !== 2) return null;
        const read = codes.map((c) => c === null ? null : readCode(rules, c));
        if (codes.some((c, i) => c !== null && read[i] === null)) return null;
        return rejoin$1(g, [read[0], read[1]]);
      },
      mine: (g, side) => g.codes[side],
      logged: (m) => ({ guess: m.guess }),
      accept: (g, brought, mode) => {
        const c = mode === "together" ? randomCode(rules, Math.random) : readCode(rules, brought);
        if (!c) return null;
        return { ...g, codes: [g.codes[0], c], placed: [g.placed[0], true] };
      }
    }
  };
}
const crackedIn = (g, s) => cracked(g, s);
const N = 5;
const TALL = 4;
const CELLS = N * N;
const at = (x, z) => z * N + x;
const emptyBuild = () => new Array(CELLS).fill(0);
function shadowsOf(b) {
  const front = new Array(N).fill(0);
  const side = new Array(N).fill(0);
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const h = b[at(x, z)];
      front[x] = Math.max(front[x], h);
      side[z] = Math.max(side[z], h);
    }
  return { front, side, top: b.map((h) => h > 0) };
}
function matches(b, clue, show2) {
  const s = shadowsOf(b);
  const same2 = (a, c) => a.every((v, i) => v === c[i]);
  return (!show2.front || same2(s.front, clue.front)) && (!show2.side || same2(s.side, clue.side)) && (!show2.top || same2(s.top, clue.top));
}
const blocks = (b) => b.reduce((a, h) => a + h, 0);
function fewest(clue, show2) {
  const b = emptyBuild();
  const can = (x, z) => !show2.top || clue.top[at(x, z)];
  const cap = (x, z) => Math.min(show2.front ? clue.front[x] : TALL, show2.side ? clue.side[z] : TALL);
  if (show2.top) {
    for (let i = 0; i < CELLS; i++) if (clue.top[i]) b[i] = 1;
  }
  for (let v = TALL; v >= 1; v--) {
    const cols = show2.front ? [...Array(N).keys()].filter((x) => clue.front[x] === v) : [];
    const rows = show2.side ? [...Array(N).keys()].filter((z) => clue.side[z] === v) : [];
    const colDone = (x) => [...Array(N).keys()].some((z) => b[at(x, z)] >= v);
    const rowDone = (z) => [...Array(N).keys()].some((x) => b[at(x, z)] >= v);
    const pair = /* @__PURE__ */ new Map();
    const open2 = (x, z) => can(x, z) && cap(x, z) >= v;
    const claim = (x, seen) => {
      for (const z of rows) {
        if (seen.has(z) || rowDone(z) || !open2(x, z)) continue;
        seen.add(z);
        const y = pair.get(z);
        if (y === void 0 || claim(y, seen)) {
          pair.set(z, x);
          return true;
        }
      }
      return false;
    };
    for (const x of cols) if (!colDone(x)) claim(x, /* @__PURE__ */ new Set());
    for (const [z, x] of pair) b[at(x, z)] = v;
    for (const x of cols)
      if (!colDone(x)) {
        const z = [...Array(N).keys()].find((zz) => can(x, zz) && cap(x, zz) >= v);
        if (z !== void 0) b[at(x, z)] = v;
      }
    for (const z of rows)
      if (!rowDone(z)) {
        const x = [...Array(N).keys()].find((xx) => can(xx, z) && cap(xx, z) >= v);
        if (x !== void 0) b[at(x, z)] = v;
      }
  }
  return b;
}
const ROUNDS = [1, 3, 5];
function readBoxSettings(s) {
  const rounds = s.rounds ?? 3;
  return ROUNDS.includes(rounds) ? { rounds } : null;
}
const other$1 = (s) => s === 0 ? 1 : 0;
const isBuild = (x) => Array.isArray(x) && x.length === CELLS && x.every((h) => Number.isInteger(h) && h >= 0 && h <= TALL);
const readShow = (x) => {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const { front, side, top } = o;
  if (typeof front !== "boolean" || typeof side !== "boolean" || typeof top !== "boolean")
    return null;
  return front || side || top ? { front, side, top } : null;
};
function readBox(x) {
  const o = x;
  if (!o || typeof o !== "object" || !isBuild(o.build) || blocks(o.build) === 0) return null;
  const show2 = readShow(o.show);
  return show2 ? { build: [...o.build], show: show2 } : null;
}
const clueOf = (b) => ({ show: { ...b.show }, shadows: shadowsOf(b.build) });
const overPar = (rebuild, c) => blocks(rebuild) - blocks(fewest(c.shadows, c.show));
function whoseMove$3(g) {
  const k = g.rebuilds[0].length + g.rebuilds[1].length;
  return k >= 2 * g.rounds ? null : k % 2 === 0 ? 0 : 1;
}
const waiting = (g, s) => g.clues[other$1(s)][g.rebuilds[s].length] ?? null;
const owesBox = (g, s) => g.clues[s].length === g.rebuilds[other$1(s)].length && g.rebuilds[other$1(s)].length < g.rounds;
const totals$1 = (g) => [0, 1].map(
  (s) => g.rebuilds[s].reduce((a, b, i) => a + overPar(b, g.clues[other$1(s)][i]), 0)
);
const fresh$3 = (rounds) => ({
  rounds,
  boxes: [[], []],
  clues: [[], []],
  rebuilds: [[], []]
});
function readMove(x) {
  const o = x;
  if (!o || typeof o !== "object" || !isBuild(o.rebuild)) return null;
  if (o.box === void 0) return { rebuild: [...o.rebuild] };
  const box = readBox(o.box);
  return box ? { rebuild: [...o.rebuild], box } : null;
}
function placed(g, s, box, clue) {
  const boxes = [[...g.boxes[0]], [...g.boxes[1]]];
  const clues = [[...g.clues[0]], [...g.clues[1]]];
  boxes[s].push(box);
  clues[s].push(clue);
  return { ...g, boxes, clues };
}
function moved$2(g, m, s) {
  const c = waiting(g, s);
  if (!c || !matches(m.rebuild, c.shadows, c.show)) return null;
  if (owesBox(g, s) !== (m.box !== void 0)) return null;
  const rebuilds = [[...g.rebuilds[0]], [...g.rebuilds[1]]];
  rebuilds[s].push([...m.rebuild]);
  const cur = { ...g, rebuilds };
  return m.box ? placed(cur, s, m.box, clueOf(m.box)) : cur;
}
const showBits = (s) => (s.front ? 1 : 0) | (s.side ? 2 : 0) | (s.top ? 4 : 0);
const bitsShow = (n) => ({ front: !!(n & 1), side: !!(n & 2), top: !!(n & 4) });
const digits = (b) => b.join("");
const undigit = (x) => typeof x === "string" && x.length === CELLS && /^[0-4]+$/.test(x) ? [...x].map(Number) : null;
function writeClue(c) {
  return {
    show: showBits(c.show),
    ...c.show.front ? { front: c.shadows.front } : {},
    ...c.show.side ? { side: c.shadows.side } : {},
    ...c.show.top ? { top: c.shadows.top.map((t) => t ? 1 : 0).join("") } : {}
  };
}
const isLine = (x) => Array.isArray(x) && x.length === N && x.every((h) => Number.isInteger(h) && h >= 0 && h <= TALL);
function readClue(x) {
  const o = x;
  if (!o || typeof o !== "object" || !Number.isInteger(o.show)) return null;
  const bits = o.show;
  if (bits < 1 || bits > 7) return null;
  const show2 = bitsShow(bits);
  const keys = Object.keys(o).filter((k) => k !== "show");
  const want = ["front", "side", "top"].filter((k) => show2[k]);
  if (keys.length !== want.length || !want.every((k) => k in o)) return null;
  if (show2.front && !isLine(o.front)) return null;
  if (show2.side && !isLine(o.side)) return null;
  if (show2.top && !(typeof o.top === "string" && /^[01]{25}$/.test(o.top))) return null;
  const shadows = {
    front: show2.front ? [...o.front] : new Array(N).fill(0),
    side: show2.side ? [...o.side] : new Array(N).fill(0),
    top: show2.top ? [...o.top].map((c) => c === "1") : new Array(CELLS).fill(false)
  };
  if (show2.front && show2.side && Math.max(...shadows.front) !== Math.max(...shadows.side))
    return null;
  if (show2.front && Math.max(...shadows.front) === 0) return null;
  if (show2.side && Math.max(...shadows.side) === 0) return null;
  if (show2.top && !shadows.top.some(Boolean)) return null;
  return { show: show2, shadows };
}
const same = (a, b) => JSON.stringify(writeClue(a)) === JSON.stringify(writeClue(b));
function replayPublic$3(rounds, x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.clues) || !Array.isArray(o.rebuilds))
    return null;
  if (o.clues.length !== 2 || o.rebuilds.length !== 2) return null;
  const clues = o.clues.map(
    (l) => Array.isArray(l) && l.length <= rounds ? l.map(readClue) : null
  );
  const rebuilds = o.rebuilds.map(
    (l) => Array.isArray(l) && l.length <= rounds ? l.map(undigit) : null
  );
  if (clues.some((l) => !l || l.some((c) => !c))) return null;
  if (rebuilds.some((l) => !l || l.some((b) => !b))) return null;
  const C = clues;
  const B = rebuilds;
  let g = fresh$3(rounds);
  if (C[1].length) g = placed(g, 1, null, C[1][0]);
  for (; ; ) {
    const s = whoseMove$3(g);
    if (s === null || g.rebuilds[s].length >= B[s].length) break;
    const box = owesBox(g, s) ? C[s][g.clues[s].length] : void 0;
    if (owesBox(g, s) && !box) return null;
    const c = waiting(g, s);
    if (!c || !matches(B[s][g.rebuilds[s].length], c.shadows, c.show)) return null;
    const rb = [[...g.rebuilds[0]], [...g.rebuilds[1]]];
    rb[s].push(B[s][g.rebuilds[s].length]);
    g = { ...g, rebuilds: rb };
    if (box) g = placed(g, s, null, box);
  }
  for (const s of [0, 1])
    if (g.rebuilds[s].length !== B[s].length || g.clues[s].length !== C[s].length) return null;
  if (o.boxes !== void 0) {
    const boxes = o.boxes;
    if (whoseMove$3(g) !== null || !Array.isArray(boxes) || boxes.length !== 2) return null;
    const read = boxes.map((l) => Array.isArray(l) ? l.map(readBox) : null);
    if (read.some((l) => !l || l.some((b) => !b))) return null;
    const joined = rejoin(g, read);
    if (!joined) return null;
    g = joined;
  }
  return g;
}
function rejoin(g, boxes) {
  for (const s of [0, 1]) {
    if (boxes[s].length !== g.clues[s].length) return null;
    for (let i = 0; i < boxes[s].length; i++) {
      const b = boxes[s][i];
      if (!b || !same(clueOf(b), g.clues[s][i])) return null;
    }
  }
  return { ...g, boxes: [[...boxes[0]], [...boxes[1]]] };
}
function randomBox(rand) {
  const build = emptyBuild();
  const stacks = 3 + Math.floor(rand() * 5);
  for (let k = 0; k < stacks; k++) build[Math.floor(rand() * CELLS)] = 1 + Math.floor(rand() * TALL);
  const top = rand() < 0.5;
  return { build, show: { front: true, side: true, top } };
}
function fullest(c) {
  const b = emptyBuild();
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      if (c.show.top && !c.shadows.top[at(x, z)]) continue;
      b[at(x, z)] = Math.min(
        c.show.front ? c.shadows.front[x] : TALL,
        c.show.side ? c.shadows.side[z] : TALL
      );
    }
  return b;
}
function rebuildFor(c, level, rand) {
  if (level === "hard") return fewest(c.shadows, c.show);
  const full2 = fullest(c);
  if (level === "easy") return full2;
  let b = full2;
  const order2 = [...Array(CELLS).keys()].sort(() => rand() - 0.5);
  for (const i of order2)
    for (let h = 0; h < b[i]; h++) {
      const t = b.slice();
      t[i] = h;
      if (matches(t, c.shadows, c.show)) {
        b = t;
        break;
      }
    }
  return b;
}
function boxRules(rounds) {
  return {
    fresh: () => fresh$3(rounds),
    turn: whoseMove$3,
    legal: (g, m, by) => {
      const s = whoseMove$3(g);
      if (s === null || by !== void 0 && by !== s) return false;
      return moved$2(g, m, s) !== null;
    },
    apply: (g, m) => {
      const s = whoseMove$3(g);
      return s === null ? g : moved$2(g, m, s) ?? g;
    },
    encode: (g) => ({
      clues: g.clues.map((l) => l.map(writeClue)),
      rebuilds: g.rebuilds.map((l) => l.map(digits)),
      // once it is over every box is shown; before, none is ever here
      ...whoseMove$3(g) === null && g.boxes.every((l) => l.every(Boolean)) ? { boxes: g.boxes } : {}
    }),
    decode: (x) => replayPublic$3(rounds, x),
    readMove,
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: ["easy", "fair", "hard"],
      choose: (g, level) => {
        const c = waiting(g, 1);
        const rebuild = c ? rebuildFor(c, level, Math.random) : emptyBuild();
        return owesBox(g, 1) ? { rebuild, box: randomBox(Math.random) } : { rebuild };
      }
    },
    result: (g) => {
      if (whoseMove$3(g) !== null) return null;
      const [a, b] = totals$1(g);
      return a < b ? 0 : b < a ? 1 : "draw";
    },
    begun: (g) => g.rebuilds[0].length > 0,
    hidden: {
      secret: (g) => ({ boxes: g.boxes }),
      join: (g, secret) => {
        const boxes = secret?.boxes;
        if (!Array.isArray(boxes) || boxes.length !== 2) return null;
        const read = boxes.map((l) => Array.isArray(l) ? l.map(readBox) : null);
        if (read.some((l) => !l || l.some((b) => !b))) return null;
        return rejoin(g, read);
      },
      mine: (g, side) => g.boxes[side],
      logged: (m) => ({ rebuild: m.rebuild }),
      accept: (g, brought, mode) => {
        const box = mode === "together" ? randomBox(Math.random) : readBox(brought);
        return box ? placed(g, 1, box, clueOf(box)) : null;
      }
    }
  };
}
const MOVES = [0, 1, 2];
const NAMES = ["rock", "paper", "scissors"];
const beats = (m) => (m + 1) % 3;
const result = (a, b) => a === b ? 0 : beats(b) === a ? 1 : -1;
const GUESSERS = [
  { name: "most", key: () => "", why: (_, m) => `you play ${NAMES[m]} most` },
  {
    name: "after-yours",
    key: (h) => h.length >= 1 ? `${h[h.length - 1].me}` : null,
    why: (h, m) => `after ${NAMES[h[h.length - 1].me]} you usually play ${NAMES[m]}`
  },
  {
    name: "after-your-two",
    key: (h) => h.length >= 2 ? `${h[h.length - 2].me}${h[h.length - 1].me}` : null,
    why: (h, m) => `after ${NAMES[h[h.length - 2].me]} then ${NAMES[h[h.length - 1].me]} you usually play ${NAMES[m]}`
  },
  {
    name: "after-mine",
    key: (h) => h.length >= 1 ? `${h[h.length - 1].it}` : null,
    why: (h, m) => `when I have just played ${NAMES[h[h.length - 1].it]} you usually play ${NAMES[m]}`
  },
  {
    name: "after-result",
    key: (h) => {
      if (!h.length) return null;
      const last = h[h.length - 1];
      return `${result(last.me, last.it)}${last.me}`;
    },
    why: (h, m) => {
      const last = h[h.length - 1];
      const r = result(last.me, last.it);
      return `after you ${r > 0 ? "win" : r < 0 ? "lose" : "draw"} with ${NAMES[last.me]} you usually play ${NAMES[m]}`;
    }
  }
];
const FADE = 0.958;
function guess(g, h) {
  const k = g.key(h);
  if (k === null) return null;
  const counts2 = [0, 0, 0];
  for (let i = 0; i < h.length; i++) {
    const before = h.slice(0, i);
    if (g.key(before) !== k) continue;
    counts2[h[i].me] += Math.pow(FADE, h.length - 1 - i);
  }
  const top = Math.max(...counts2);
  if (top < 0.5) return null;
  const best = MOVES.filter((m) => counts2[m] === top);
  return best.length === 1 ? best[0] : null;
}
function scores(h) {
  return GUESSERS.map((g) => {
    let s = 0;
    for (let i = 1; i < h.length; i++) {
      const p = guess(g, h.slice(0, i));
      if (p === null) continue;
      s = s * FADE + (p === h[i].me ? 1 : -0.5);
    }
    return s;
  });
}
function pick(h, rand) {
  const s = scores(h);
  let best = -1;
  for (let i = 0; i < GUESSERS.length; i++) {
    if (s[i] <= 0.5) continue;
    if (guess(GUESSERS[i], h) === null) continue;
    if (best < 0 || s[i] > s[best]) best = i;
  }
  if (best < 0) return { it: Math.floor(rand() * 3), expected: null, reason: null };
  const expected2 = guess(GUESSERS[best], h);
  return { it: beats(expected2), expected: expected2, reason: GUESSERS[best].why(h, expected2) };
}
const recent = (h) => h.slice(-45);
const FIRST_TOS = [3, 5, 10];
const capOf = (firstTo) => firstTo * 20;
function readRpsSettings(s) {
  const firstTo = s.firstTo ?? 3;
  return FIRST_TOS.includes(firstTo) ? { firstTo } : null;
}
const isMove = (x) => x === 0 || x === 1 || x === 2;
const wins = (g) => {
  const w = [0, 0];
  for (const [a, b] of g.rounds) {
    const r = result(a, b);
    if (r > 0) w[0]++;
    else if (r < 0) w[1]++;
  }
  return w;
};
const over = (g) => Math.max(...wins(g)) >= g.firstTo || g.rounds.length >= capOf(g.firstTo);
const whoseMove$2 = (g) => over(g) ? null : g.sealed ? 1 : 0;
const fresh$2 = (firstTo) => ({ firstTo, rounds: [], sealed: false, pending: null });
function replayPublic$2(firstTo, x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.rounds) || typeof o.sealed !== "boolean")
    return null;
  if (Object.keys(o).length !== 2) return null;
  let g = fresh$2(firstTo);
  for (const r of o.rounds) {
    if (whoseMove$2(g) === null || !Array.isArray(r) || r.length !== 2) return null;
    if (!isMove(r[0]) || !isMove(r[1])) return null;
    g = { ...g, rounds: [...g.rounds, [r[0], r[1]]] };
  }
  if (o.sealed && whoseMove$2(g) === null) return null;
  return { ...g, sealed: o.sealed };
}
function answerFor(rounds, level, rand) {
  if (level === "easy") {
    const last = rounds[rounds.length - 1];
    if (last && rand() < 0.75) return beats(last[1]);
    return Math.floor(rand() * 3);
  }
  if (level === "fair") return Math.floor(rand() * 3);
  const h = rounds.map(([me, it]) => ({ me, it }));
  return pick(recent(h), rand).it;
}
function rpsRules(firstTo) {
  return {
    fresh: () => fresh$2(firstTo),
    turn: whoseMove$2,
    legal: (g, m, by) => {
      const s = whoseMove$2(g);
      return s !== null && (by === void 0 || by === s) && isMove(m.play);
    },
    apply: (g, m) => {
      const s = whoseMove$2(g);
      if (s === null || !isMove(m.play)) return g;
      if (s === 0) return { ...g, sealed: true, pending: m.play };
      if (g.pending === null) return { ...g, sealed: false };
      return { ...g, rounds: [...g.rounds, [g.pending, m.play]], sealed: false, pending: null };
    },
    encode: (g) => ({ rounds: g.rounds, sealed: g.sealed }),
    decode: (x) => replayPublic$2(firstTo, x),
    readMove: (x) => {
      const o = x;
      return o && typeof o === "object" && Object.keys(o).length === 1 && isMove(o.play) ? { play: o.play } : null;
    },
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: ["easy", "fair", "hard"],
      // ⚠️ the rounds and nothing else: the sealed move is in `g` here, and must not be read
      choose: (g, level) => ({ play: answerFor(g.rounds, level, Math.random) })
    },
    result: (g) => {
      if (whoseMove$2(g) !== null) return null;
      const [a, b] = wins(g);
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (g) => g.rounds.length > 0 || g.sealed,
    hidden: {
      secret: (g) => ({ pending: g.pending }),
      join: (g, secret) => {
        const p = secret?.pending;
        if (p !== null && !isMove(p)) return null;
        if (g.sealed !== (p !== null)) return null;
        return { ...g, pending: p };
      },
      // the challenger may see the move they sealed; nobody else anything
      mine: (g, side) => side === 0 ? g.pending : null,
      logged: () => ({}),
      // nothing to bring: nothing is sealed until the first round's move
      accept: (g) => g
    }
  };
}
const rankOf = (c) => c >> 2;
const suitOf = (c) => c & 3;
function shuffled(rand) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const gRank = (c) => rankOf(c) === 12 ? 0 : rankOf(c) + 1;
const value = (c) => Math.min(10, gRank(c) + 1);
const deadwood = (cs) => cs.reduce((a, c) => a + value(c), 0);
function allMelds(cards2) {
  const out = [];
  const byRank = /* @__PURE__ */ new Map();
  for (const c of cards2) byRank.set(gRank(c), [...byRank.get(gRank(c)) ?? [], c]);
  for (const same2 of byRank.values()) {
    if (same2.length >= 3) {
      if (same2.length === 4) {
        out.push(same2);
        for (let k = 0; k < 4; k++) out.push(same2.filter((_, j) => j !== k));
      } else out.push(same2);
    }
  }
  for (let s = 0; s < 4; s++) {
    const suit = cards2.filter((c) => suitOf(c) === s).sort((a, b) => gRank(a) - gRank(b));
    for (let i = 0; i < suit.length; i++)
      for (let j = i + 2; j < suit.length; j++) {
        const run2 = suit.slice(i, j + 1);
        if (run2.every((c, k) => k === 0 || gRank(c) === gRank(run2[k - 1]) + 1)) out.push(run2);
        else break;
      }
  }
  return out;
}
function arrange(cards2) {
  const melds = allMelds(cards2);
  let best = { melds: [], dead: cards2, points: deadwood(cards2) };
  const go = (from, used, chosen) => {
    const dead = cards2.filter((c) => !used.has(c));
    const pts = deadwood(dead);
    if (pts < best.points) best = { melds: chosen.slice(), dead, points: pts };
    for (let k = from; k < melds.length; k++) {
      const m = melds[k];
      if (m.some((c) => used.has(c))) continue;
      for (const c of m) used.add(c);
      chosen.push(m);
      go(k + 1, used, chosen);
      chosen.pop();
      for (const c of m) used.delete(c);
    }
  };
  go(0, /* @__PURE__ */ new Set(), []);
  return best;
}
function layOff(melds, dead) {
  const ms = melds.map((m) => m.slice());
  let left2 = dead.slice();
  const laid2 = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of left2) {
      const m = ms.find((m2) => {
        const set = m2.every((x) => gRank(x) === gRank(m2[0]));
        if (set) return gRank(c) === gRank(m2[0]) && m2.length < 4;
        const lo = m2.reduce((a, x) => gRank(x) < gRank(a) ? x : a);
        const hi = m2.reduce((a, x) => gRank(x) > gRank(a) ? x : a);
        return suitOf(c) === suitOf(m2[0]) && (gRank(c) === gRank(lo) - 1 || gRank(c) === gRank(hi) + 1);
      });
      if (m) {
        m.push(c);
        laid2.push(c);
        left2 = left2.filter((x) => x !== c);
        changed = true;
        break;
      }
    }
  }
  return { left: left2, laid: laid2 };
}
function deal$1(seed2, first = 0) {
  const d = shuffled(rng(seed2));
  return {
    hands: [d.slice(0, 10), d.slice(10, 20)],
    pile: [d[20]],
    stock: d.slice(21),
    turn: first,
    phase: "draw",
    took: null,
    picked: [[], []],
    over: null
  };
}
function draw(h, from) {
  if (h.over || h.phase !== "draw") return h;
  const me = h.turn;
  const card2 = from === "stock" ? h.stock[0] : h.pile[h.pile.length - 1];
  if (card2 === void 0) return h;
  const hands = h.hands.map((x, i) => i === me ? [...x, card2] : x);
  const picked = h.picked.map(
    (x, i) => i === me && from === "pile" ? [...x, card2] : x
  );
  return {
    ...h,
    hands,
    stock: from === "stock" ? h.stock.slice(1) : h.stock,
    pile: from === "pile" ? h.pile.slice(0, -1) : h.pile,
    phase: "discard",
    took: from === "pile" ? card2 : null,
    picked
  };
}
function discard$1(h, card2, knock2 = false) {
  if (h.over || h.phase !== "discard" || card2 === h.took || !h.hands[h.turn].includes(card2))
    return h;
  const me = h.turn;
  const them = me === 0 ? 1 : 0;
  const mine2 = h.hands[me].filter((c) => c !== card2);
  const hands = h.hands.map((x, i) => i === me ? mine2 : x);
  const after2 = {
    ...h,
    hands,
    pile: [...h.pile, card2],
    turn: them,
    phase: "draw",
    took: null
  };
  if (knock2) {
    const a = arrange(mine2);
    if (a.points > 10) return h;
    const d = arrange(hands[them]);
    const gin = a.points === 0;
    const off = gin ? { left: d.dead } : layOff(a.melds, d.dead);
    const theirs = deadwood(off.left);
    const shown = [];
    shown[me] = { melds: a.melds, dead: a.dead };
    shown[them] = { melds: d.melds, dead: off.left };
    let r;
    if (gin) r = { winner: me, points: 25 + theirs, how: "gin", knocker: me, shown };
    else if (theirs <= a.points)
      r = { winner: them, points: 25 + a.points - theirs, how: "undercut", knocker: me, shown };
    else r = { winner: me, points: theirs - a.points, how: "knock", knocker: me, shown };
    return { ...after2, over: r };
  }
  if (after2.stock.length <= 2) {
    const shown = [0, 1].map((i) => {
      const x = arrange(hands[i]);
      return { melds: x.melds, dead: x.dead };
    });
    return { ...after2, over: { winner: null, points: 0, how: "void", knocker: null, shown } };
  }
  return after2;
}
function bestDiscard(h, cards2, forbid, level) {
  const them = h.turn === 0 ? 1 : 0;
  const seen = /* @__PURE__ */ new Set([...cards2, ...h.pile]);
  const unseen = level === "hard" ? Array.from({ length: 52 }, (_, c) => c).filter((c) => !seen.has(c)) : [];
  let best = { card: cards2.find((c) => c !== forbid), points: Infinity, score: Infinity };
  for (const c of cards2) {
    if (c === forbid) continue;
    const rest = cards2.filter((x) => x !== c);
    const points2 = arrange(rest).points;
    let score2 = points2 - value(c) * 0.01;
    if (level === "hard") {
      const outs = unseen.filter((u) => arrange([...rest, u]).points < points2).length;
      const wanted = h.picked[them].some(
        (a) => gRank(a) === gRank(c) || suitOf(a) === suitOf(c) && Math.abs(gRank(a) - gRank(c)) <= 2
      );
      score2 += -outs * 0.35 + (wanted ? 1.5 : 0);
    }
    if (score2 < best.score) best = { card: c, points: points2, score: score2 };
  }
  return { card: best.card, points: best.points };
}
function chooseDraw(h, level) {
  const hand = h.hands[h.turn];
  const top = h.pile[h.pile.length - 1];
  if (top === void 0) return "stock";
  if (level !== "hard")
    return arrange([...hand, top]).melds.some((m) => m.includes(top)) ? "pile" : "stock";
  return bestDiscard(h, [...hand, top], top, level).points < arrange(hand).points ? "pile" : "stock";
}
function chooseDiscard$1(h, level, rand = Math.random) {
  const held = h.hands[h.turn];
  if (level === "easy" || level === "fair" && rand() >= 0.5) {
    const dead = arrange(held).dead.filter((c) => c !== h.took);
    const pool = dead.length ? dead : held.filter((c) => c !== h.took);
    const card2 = pool[Math.floor(rand() * pool.length)];
    return { card: card2, knock: arrange(held.filter((c) => c !== card2)).points <= 10 };
  }
  const choice = bestDiscard(h, held, h.took, level === "fair" ? "easy" : level);
  return { card: choice.card, knock: choice.points <= 10 };
}
const TARGETS = [50, 100];
const MAX_HANDS$1 = 25;
function readGinSettings(s) {
  const target = s.target ?? 50;
  return TARGETS.includes(target) ? { target } : null;
}
const totals = (g) => {
  const t = [0, 0];
  for (const r of g.done) if (r.winner !== null) t[r.winner] += r.points;
  return t;
};
const matchOver = (g) => Math.max(...totals(g)) >= g.target || g.done.length >= MAX_HANDS$1;
const whoseMove$1 = (g) => g.between ? null : g.turn;
const fresh$1 = (target) => ({
  target,
  done: [],
  first: 1,
  between: true,
  pile: [],
  turn: 0,
  phase: "draw",
  took: null,
  picked: [[], []],
  stockLeft: 0,
  hands: [null, null],
  stock: null
});
function dealt$1(g, rand) {
  const first = g.first === 0 ? 1 : 0;
  const h = deal$1(Math.floor(rand() * 2 ** 32), first);
  return {
    ...g,
    first,
    between: false,
    pile: h.pile,
    turn: h.turn,
    phase: h.phase,
    took: null,
    picked: [[], []],
    stockLeft: h.stock.length,
    hands: h.hands,
    stock: h.stock
  };
}
const known = (g) => !!g.hands[0] && !!g.hands[1] && !!g.stock;
const toHand = (g) => ({
  hands: [g.hands[0], g.hands[1]],
  stock: g.stock,
  pile: g.pile,
  turn: g.turn,
  phase: g.phase,
  took: g.took,
  picked: g.picked,
  over: null
});
function fromHand(g, h) {
  const next2 = {
    ...g,
    pile: h.pile,
    turn: h.turn,
    phase: h.phase,
    took: h.took,
    picked: h.picked,
    stockLeft: h.stock.length,
    hands: h.hands,
    stock: h.stock
  };
  return h.over ? { ...next2, done: [...g.done, h.over], between: true } : next2;
}
const isCard$1 = (x) => Number.isInteger(x) && x >= 0 && x < 52;
function moved$1(g, m, s) {
  if (whoseMove$1(g) !== s) return null;
  if ("draw" in m) {
    if (g.phase !== "draw") return null;
    if (m.draw === "pile" ? !g.pile.length : g.stockLeft === 0) return null;
    if (!known(g)) return g;
    return fromHand(g, draw(toHand(g), m.draw));
  }
  if (g.phase !== "discard" || m.discard === g.took || g.pile.includes(m.discard)) return null;
  if (!known(g)) return g;
  const hand = g.hands[s];
  if (!hand.includes(m.discard)) return null;
  if (m.knock && arrange(hand.filter((c) => c !== m.discard)).points > 10) return null;
  return fromHand(g, discard$1(toHand(g), m.discard, m.knock));
}
const cardList = (x, max = 52) => Array.isArray(x) && x.length <= max && x.every(isCard$1) && new Set(x).size === x.length;
const isMeld = (m) => allMelds(m).some((x) => x.length === m.length);
function readResult(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const { winner: winner2, points: points2, how, knocker, shown } = o;
  if (!["gin", "knock", "undercut", "void"].includes(how)) return null;
  if (!Array.isArray(shown) || shown.length !== 2) return null;
  const laid2 = shown.map((s) => {
    const v = s;
    if (!v || !Array.isArray(v.melds) || !cardList(v.dead, 11)) return null;
    if (!v.melds.every((m) => cardList(m, 10) && m.length >= 3 && isMeld(m))) return null;
    return { melds: v.melds.map((m) => [...m]), dead: [...v.dead] };
  });
  if (!laid2[0] || !laid2[1]) return null;
  const all = laid2.flatMap((l) => [...l.melds.flat(), ...l.dead]);
  if (new Set(all).size !== all.length) return null;
  const r = { winner: winner2, points: points2, how, knocker, shown: laid2 };
  if (how === "void") return winner2 === null && points2 === 0 && knocker === null ? r : null;
  if (knocker !== 0 && knocker !== 1) return null;
  const mine2 = deadwood(laid2[knocker].dead);
  const theirs = deadwood(laid2[knocker === 0 ? 1 : 0].dead);
  const other2 = knocker === 0 ? 1 : 0;
  const want = how === "gin" ? mine2 === 0 && winner2 === knocker && points2 === 25 + theirs : how === "undercut" ? mine2 > 0 && mine2 <= 10 && theirs <= mine2 && winner2 === other2 && points2 === 25 + mine2 - theirs : mine2 > 0 && mine2 <= 10 && theirs > mine2 && winner2 === knocker && points2 === theirs - mine2;
  return want ? r : null;
}
function replayPublic$1(target, x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.done)) return null;
  const done2 = o.done.map(readResult);
  if (done2.some((r) => r === null) || done2.length > MAX_HANDS$1) return null;
  const { first, between, pile, turn, phase, took, picked, stockLeft } = o;
  if (first !== 0 && first !== 1 || typeof between !== "boolean") return null;
  if (turn !== 0 && turn !== 1 || phase !== "draw" && phase !== "discard") return null;
  if (!cardList(pile) || took !== null && !isCard$1(took)) return null;
  if (!Array.isArray(picked) || picked.length !== 2 || !picked.every((p) => cardList(p)))
    return null;
  if (!Number.isInteger(stockLeft) || stockLeft < 0) return null;
  const g = {
    target,
    done: done2,
    first,
    between,
    pile: [...pile],
    turn,
    phase,
    took,
    picked: [[...picked[0]], [...picked[1]]],
    stockLeft,
    hands: [null, null],
    stock: null
  };
  if (g.between) {
    return matchOver(g) && g.done.length > 0 ? g : null;
  }
  if (matchOver(g)) return null;
  if (g.stockLeft + g.pile.length + 20 + (g.phase === "discard" ? 1 : 0) !== 52) return null;
  if (g.took !== null && (g.phase !== "discard" || g.pile.includes(g.took))) return null;
  return g;
}
function ginRules(target) {
  return {
    fresh: () => fresh$1(target),
    turn: whoseMove$1,
    legal: (g, m, by) => {
      const s = whoseMove$1(g);
      return s !== null && (by === void 0 || by === s) && moved$1(g, m, s) !== null;
    },
    apply: (g, m) => {
      const s = whoseMove$1(g);
      return s === null ? g : moved$1(g, m, s) ?? g;
    },
    // a hand that ended is followed by the next, dealt by the server, unless the match is won
    roll: (g, rand) => g.between && !matchOver(g) ? dealt$1(g, rand) : g,
    encode: (g) => ({
      done: g.done,
      first: g.first,
      between: g.between,
      pile: g.pile,
      turn: g.turn,
      phase: g.phase,
      took: g.took,
      picked: g.picked,
      stockLeft: g.stockLeft
    }),
    decode: (x) => replayPublic$1(target, x),
    readMove: (x) => {
      const o = x;
      if (!o || typeof o !== "object") return null;
      const keys = Object.keys(o).sort().join();
      if (keys === "draw" && (o.draw === "stock" || o.draw === "pile")) return { draw: o.draw };
      if (keys === "discard,knock" && isCard$1(o.discard) && typeof o.knock === "boolean")
        return { discard: o.discard, knock: o.knock };
      return null;
    },
    modes: ["versus", "together"],
    computer: {
      side: 1,
      levels: ["easy", "fair", "hard"],
      choose: (g, level) => {
        const h = toHand(g);
        const l = level;
        if (g.phase === "draw") return { draw: chooseDraw(h, l) };
        const c = chooseDiscard$1(h, l, Math.random);
        return { discard: c.card, knock: c.knock };
      }
    },
    result: (g) => {
      if (whoseMove$1(g) !== null) return null;
      const [a, b] = totals(g);
      return a > b ? 0 : b > a ? 1 : "draw";
    },
    begun: (g) => g.done.length > 0 || g.pile.length > 1 || g.phase === "discard",
    hidden: {
      secret: (g) => ({ hands: g.hands, stock: g.stock }),
      join: (g, secret) => {
        const o = secret;
        if (!o || !Array.isArray(o.hands) || o.hands.length !== 2) return null;
        if (g.between) return { ...g };
        const [a, b] = o.hands;
        if (!cardList(a, 11) || !cardList(b, 11) || !cardList(o.stock)) return null;
        for (const s of [0, 1])
          if ([a, b][s].length !== (g.phase === "discard" && g.turn === s ? 11 : 10)) return null;
        if (o.stock.length !== g.stockLeft) return null;
        const all = [...a, ...b, ...o.stock, ...g.pile];
        if (all.length !== 52 || new Set(all).size !== 52) return null;
        if (g.took !== null && ![a, b][g.turn].includes(g.took)) return null;
        return { ...g, hands: [[...a], [...b]], stock: [...o.stock] };
      },
      mine: (g, side) => g.hands[side],
      // nothing in a move is hidden: a stock draw names no card, and a discard is face up
      logged: (m) => m,
      accept: (g) => dealt$1(g, Math.random)
    }
  };
}
const other = (w) => w === 0 ? 1 : 0;
const TARGET = 121;
const JACK = 10;
function parts(hand, starter, crib = false) {
  const all = [...hand, starter];
  const out = [];
  for (let m = 1; m < 1 << all.length; m++) {
    const set = all.filter((_, i) => m & 1 << i);
    if (set.length > 1 && set.reduce((s2, c) => s2 + value(c), 0) === 15)
      out.push({ what: "fifteen", cards: set, points: 2 });
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (gRank(all[i]) === gRank(all[j]))
        out.push({ what: "pair", cards: [all[i], all[j]], points: 2 });
  const byRank = /* @__PURE__ */ new Map();
  for (const c of all) byRank.set(gRank(c), [...byRank.get(gRank(c)) ?? [], c]);
  for (let lo = 0; lo < 13; lo++) {
    if (!byRank.has(lo) || byRank.has(lo - 1)) continue;
    let hi = lo;
    while (byRank.has(hi + 1)) hi++;
    if (hi - lo + 1 < 3) continue;
    let ways2 = [[]];
    for (let r = lo; r <= hi; r++) ways2 = ways2.flatMap((w) => byRank.get(r).map((c) => [...w, c]));
    for (const w of ways2) out.push({ what: "run", cards: w, points: w.length });
  }
  const s = suitOf(hand[0]);
  if (hand.every((c) => suitOf(c) === s)) {
    if (suitOf(starter) === s) out.push({ what: "flush", cards: all, points: 5 });
    else if (!crib) out.push({ what: "flush", cards: [...hand], points: 4 });
  }
  const nob = hand.find((c) => gRank(c) === JACK && suitOf(c) === suitOf(starter));
  if (nob !== void 0) out.push({ what: "nobs", cards: [nob], points: 1 });
  return out;
}
const score = (hand, starter, crib = false) => parts(hand, starter, crib).reduce((s, p) => s + p.points, 0);
function pegScore(pile) {
  const why = [];
  let points2 = 0;
  const count2 = pile.reduce((s, c) => s + value(c), 0);
  if (count2 === 15) {
    points2 += 2;
    why.push("fifteen");
  }
  if (count2 === 31) {
    points2 += 2;
    why.push("thirty-one");
  }
  const last = pile[pile.length - 1];
  let same2 = 1;
  while (same2 < pile.length && gRank(pile[pile.length - 1 - same2]) === gRank(last)) same2++;
  if (same2 >= 2) {
    const p = [0, 0, 2, 6, 12][same2];
    points2 += p;
    why.push(["", "", "a pair", "three of a kind", "four of a kind"][same2]);
  }
  for (let k = pile.length; k >= 3; k--) {
    const ranks = pile.slice(-k).map(gRank);
    const set = new Set(ranks);
    if (set.size === k && Math.max(...ranks) - Math.min(...ranks) === k - 1) {
      points2 += k;
      why.push(`a run of ${k}`);
      break;
    }
  }
  return { points: points2, why };
}
function deal(seed2, dealer, scores2 = [0, 0]) {
  const deck = shuffled(rng(seed2));
  const pone = other(dealer);
  const hands = [[], []];
  for (let i = 0; i < 12; i++) hands[i % 2 === 0 ? pone : dealer].push(deck[i]);
  return {
    dealer,
    hands,
    kept: [[], []],
    crib: [],
    starter: deck[12],
    phase: "discard",
    pile: [],
    played: [],
    turn: pone,
    scores: [...scores2],
    winner: null,
    said: ""
  };
}
const add = (r, w, points2) => {
  if (!points2 || r.winner !== null) return r;
  const scores2 = [...r.scores];
  scores2[w] = Math.min(TARGET, scores2[w] + points2);
  return scores2[w] >= TARGET ? { ...r, scores: scores2, winner: w, phase: "over" } : { ...r, scores: scores2 };
};
function discard(r, mine2, theirs) {
  if (r.phase !== "discard") return r;
  const out = [mine2, theirs];
  for (const w of [0, 1])
    if (new Set(out[w]).size !== 2 || !out[w].every((c) => r.hands[w].includes(c))) return r;
  const hands = r.hands.map((h, w) => h.filter((c) => !out[w].includes(c)));
  let next2 = {
    ...r,
    hands,
    kept: [[...hands[0]], [...hands[1]]],
    crib: [...mine2, ...theirs],
    phase: "peg",
    said: ""
  };
  if (gRank(r.starter) === JACK) next2 = { ...add(next2, r.dealer, 2), said: "heels" };
  return next2;
}
const count = (r) => r.pile.reduce((s, c) => s + value(c), 0);
const canPlay = (r, w) => r.hands[w].filter((c) => count(r) + value(c) <= 31);
function peg(r, card2) {
  if (r.phase !== "peg" || r.winner !== null) return r;
  const w = r.turn;
  if (!canPlay(r, w).includes(card2)) return r;
  const pile = [...r.pile, card2];
  const hands = r.hands.map((h, i) => i === w ? h.filter((c) => c !== card2) : h);
  const { points: points2, why } = pegScore(pile);
  let next2 = add({ ...r, pile, hands, played: [...r.played, { card: card2, by: w }] }, w, points2);
  const said = [...why];
  if (next2.winner !== null) return { ...next2, said: said.join(" and ") };
  const total2 = pile.reduce((s, c) => s + value(c), 0);
  const fresh2 = (lead) => {
    const leader = next2.hands[lead].length ? lead : other(lead);
    next2 = { ...next2, pile: [], turn: leader };
  };
  if (!hands[0].length && !hands[1].length) {
    if (total2 !== 31) {
      next2 = add(next2, w, 1);
      said.push("the last card");
    }
    next2 = { ...next2, pile: [], phase: next2.winner === null ? "show" : "over" };
  } else if (total2 === 31) fresh2(other(w));
  else if (canPlay(next2, other(w)).length) next2 = { ...next2, turn: other(w) };
  else if (canPlay(next2, w).length) next2 = { ...next2, turn: w };
  else {
    next2 = add(next2, w, 1);
    said.push("a go");
    if (next2.winner === null) fresh2(other(w));
  }
  return { ...next2, said: said.join(" and ") };
}
function show(r) {
  if (r.phase !== "show") return r;
  const pone = other(r.dealer);
  let next2 = add(r, pone, score(r.kept[pone], r.starter));
  next2 = add(next2, r.dealer, score(r.kept[r.dealer], r.starter));
  next2 = add(next2, r.dealer, score(r.crib, r.starter, true));
  return { ...next2, phase: next2.winner === null ? "done" : "over" };
}
const PAIRS = [];
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) PAIRS.push([i, j]);
function cribWorth(d, unseen, rand) {
  const N2 = 120;
  let t = 0;
  for (let k = 0; k < N2; k++) {
    const a = Math.floor(rand() * unseen.length);
    let b = Math.floor(rand() * (unseen.length - 1));
    if (b >= a) b++;
    let c = Math.floor(rand() * (unseen.length - 2));
    if (c >= Math.min(a, b)) c++;
    if (c >= Math.max(a, b)) c++;
    t += score([...d, unseen[a], unseen[b]], unseen[c], true);
  }
  return t / N2;
}
function chooseDiscard(r, w, level, rand = Math.random) {
  const h = r.hands[w];
  if (level === "easy") {
    const [i, j] = PAIRS[Math.floor(rand() * PAIRS.length)];
    return [h[i], h[j]];
  }
  const unseen = [];
  for (let c = 0; c < 52; c++) if (!h.includes(c)) unseen.push(c);
  let best = PAIRS[0];
  let bv = -Infinity;
  for (const [i, j] of PAIRS) {
    const keep = h.filter((_, k) => k !== i && k !== j);
    let v = 0;
    for (const s of unseen) v += score(keep, s);
    v /= unseen.length;
    if (level === "hard") v += (r.dealer === w ? 1 : -1) * cribWorth([h[i], h[j]], unseen, rand);
    v += rand() * 1e-6;
    if (v > bv) {
      bv = v;
      best = [i, j];
    }
  }
  return [h[best[0]], h[best[1]]];
}
function choosePeg(r, level, rand = Math.random) {
  const w = r.turn;
  const ok = canPlay(r, w);
  if (level !== "hard") return ok[Math.floor(rand() * ok.length)];
  const seen = /* @__PURE__ */ new Set([
    ...r.hands[w],
    ...r.kept[w],
    ...r.played.map((p) => p.card),
    r.starter
  ]);
  const unseen = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) unseen.push(c);
  let best = ok[0];
  let bv = -Infinity;
  for (const c of ok) {
    const pile = [...r.pile, c];
    let v = pegScore(pile).points;
    const after2 = pile.reduce((s, x) => s + value(x), 0);
    let reply = 0;
    for (const u of unseen) if (after2 + value(u) <= 31) reply += pegScore([...pile, u]).points;
    v -= reply / unseen.length * Math.min(4, r.hands[other(w)].length);
    v += rand() * 1e-6;
    if (v > bv) {
      bv = v;
      best = c;
    }
  }
  return best;
}
const MAX_HANDS = 40;
const isCard = (x) => Number.isInteger(x) && x >= 0 && x < 52;
const cards = (x, n) => Array.isArray(x) && (n === void 0 || x.length === n) && x.every(isCard) && new Set(x).size === x.length;
const dealerOf = (hand) => hand % 2 === 0 ? 1 : 0;
const fresh = () => ({
  past: [],
  r: {
    dealer: 1,
    hands: [[], []],
    kept: [[], []],
    crib: [],
    starter: 0,
    phase: "discard",
    pile: [],
    played: [],
    turn: 0,
    scores: [0, 0],
    winner: null,
    said: ""
  },
  throws: [null, null],
  thrown: [false, false],
  known: false
});
function dealt(g, rand) {
  const r = deal(Math.floor(rand() * 2 ** 32), dealerOf(g.past.length), g.r.scores);
  return { ...g, r, throws: [null, null], thrown: [false, false], known: true };
}
function whoseMove(g) {
  const { r } = g;
  if (r.winner !== null || r.phase === "over" || g.past.length >= MAX_HANDS) return null;
  if (r.phase === "discard") {
    const pone = other(r.dealer);
    return g.thrown[pone] ? g.thrown[r.dealer] ? null : r.dealer : pone;
  }
  return r.phase === "peg" ? r.turn : null;
}
const laid = (r) => ({
  dealer: r.dealer,
  starter: r.starter,
  kept: [[...r.kept[0]], [...r.kept[1]]],
  crib: [...r.crib],
  played: r.played.map((p) => ({ ...p }))
});
function moved(g, m, s) {
  if (whoseMove(g) !== s) return null;
  const { r } = g;
  if ("throw" in m) {
    if (r.phase !== "discard" || g.thrown[s] || !cards(m.throw, 2)) return null;
    const thrown = [...g.thrown];
    thrown[s] = true;
    if (!g.known) return { ...g, thrown };
    if (!m.throw.every((c) => r.hands[s].includes(c))) return null;
    const throws = [...g.throws];
    throws[s] = [...m.throw];
    if (!thrown[0] || !thrown[1]) return { ...g, thrown, throws };
    const next22 = discard(r, throws[0], throws[1]);
    return { ...g, r: next22, thrown, throws: [null, null] };
  }
  if (r.phase !== "peg" || r.played.some((p) => p.card === m.peg)) return null;
  if (!g.known) return g;
  const next2 = peg(r, m.peg);
  if (next2 === r) return null;
  if (next2.phase === "show") {
    const counted = show(next2);
    return { ...g, r: counted, past: [...g.past, laid(counted)] };
  }
  return { ...g, r: next2 };
}
function readLaid(x) {
  const o = x;
  if (!o || typeof o !== "object") return null;
  const { dealer, starter, kept, crib, played } = o;
  if (dealer !== 0 && dealer !== 1 || !isCard(starter)) return null;
  if (!Array.isArray(kept) || kept.length !== 2 || !cards(kept[0], 4) || !cards(kept[1], 4))
    return null;
  if (!cards(crib, 4) || !Array.isArray(played) || played.length > 8) return null;
  const p = played.map((e) => {
    const v = e;
    return v && isCard(v.card) && (v.by === 0 || v.by === 1) ? { card: v.card, by: v.by } : null;
  });
  if (p.some((e) => !e)) return null;
  return {
    dealer,
    starter,
    kept: [[...kept[0]], [...kept[1]]],
    crib: [...crib],
    played: p
  };
}
function replayHand(h, scores2) {
  const six = [
    [...h.kept[0], ...h.crib.slice(0, 2)],
    [...h.kept[1], ...h.crib.slice(2)]
  ];
  const all = [...six[0], ...six[1], h.starter];
  if (new Set(all).size !== 13) return null;
  let r = {
    dealer: h.dealer,
    hands: six,
    kept: [[], []],
    crib: [],
    starter: h.starter,
    phase: "discard",
    pile: [],
    played: [],
    turn: other(h.dealer),
    scores: [...scores2],
    winner: null,
    said: ""
  };
  r = discard(r, [h.crib[0], h.crib[1]], [h.crib[2], h.crib[3]]);
  for (const p of h.played) {
    if (r.phase !== "peg" || r.turn !== p.by) return null;
    const next2 = peg(r, p.card);
    if (next2 === r) return null;
    r = next2;
  }
  if (r.phase === "show") r = show(r);
  return r.phase === "done" || r.phase === "over" ? r : null;
}
function replayPublic(x) {
  const o = x;
  if (!o || typeof o !== "object" || !Array.isArray(o.past) || o.past.length > MAX_HANDS)
    return null;
  const past = o.past.map(readLaid);
  if (past.some((h) => !h)) return null;
  let scores2 = [0, 0];
  let end = null;
  for (let k = 0; k < past.length; k++) {
    const h = past[k];
    if (h.dealer !== dealerOf(k) || end && end.phase === "over") return null;
    end = replayHand(h, scores2);
    if (!end) return null;
    scores2 = end.scores;
  }
  const { dealer, phase, turn, starter, pile, played, thrown, winner: winner2 } = o;
  if (!Array.isArray(o.scores) || o.scores.length !== 2) return null;
  const sc = o.scores;
  if (!sc.every((v) => Number.isInteger(v) && v >= 0 && v <= TARGET))
    return null;
  if (turn !== 0 && turn !== 1 || winner2 !== null && winner2 !== 0 && winner2 !== 1) return null;
  if (!Array.isArray(thrown) || thrown.length !== 2 || !thrown.every((t) => typeof t === "boolean"))
    return null;
  if (!cards(pile) || !Array.isArray(played)) return null;
  const pl = played.map((e) => {
    const v = e;
    return v && isCard(v.card) && (v.by === 0 || v.by === 1) ? { card: v.card, by: v.by } : null;
  });
  if (pl.some((e) => !e) || pl.length > 8) return null;
  const g = fresh();
  if (end && (end.phase === "over" || past.length >= MAX_HANDS)) {
    if (phase !== end.phase || winner2 !== end.winner) return null;
    return { ...g, past, r: { ...end }, known: true };
  }
  if (dealer !== dealerOf(past.length)) return null;
  if (phase !== "discard" && phase !== "peg" && phase !== "over") return null;
  const s0 = sc[0];
  const s1 = sc[1];
  if (s0 < scores2[0] || s1 < scores2[1]) return null;
  if (phase === "discard") {
    if (starter !== null || pl.length || pile.length || s0 !== scores2[0] || s1 !== scores2[1])
      return null;
  } else if (!isCard(starter) || !thrown[0] || !thrown[1]) return null;
  if (phase === "over" && (winner2 === null || [s0, s1][winner2] !== TARGET)) return null;
  if (phase !== "over" && winner2 !== null) return null;
  return {
    ...g,
    past,
    thrown: [thrown[0], thrown[1]],
    r: {
      ...g.r,
      dealer,
      phase,
      turn,
      starter: starter ?? 0,
      pile: [...pile],
      played: pl,
      scores: [s0, s1],
      winner: winner2
    }
  };
}
const cribRules = {
  fresh,
  turn: whoseMove,
  legal: (g, m, by) => {
    const s = whoseMove(g);
    return s !== null && (by === void 0 || by === s) && moved(g, m, s) !== null;
  },
  apply: (g, m) => {
    const s = whoseMove(g);
    return s === null ? g : moved(g, m, s) ?? g;
  },
  // a hand counted is followed by the next, the deal passing, unless the game is won
  roll: (g, rand) => g.r.phase === "done" && g.past.length < MAX_HANDS ? dealt(g, rand) : g,
  encode: (g) => {
    const r = g.r;
    return {
      past: g.past,
      dealer: r.dealer,
      phase: r.phase,
      turn: r.turn,
      starter: r.phase === "discard" ? null : r.starter,
      pile: r.pile,
      played: r.played,
      scores: r.scores,
      winner: r.winner,
      thrown: g.thrown
    };
  },
  decode: replayPublic,
  readMove: (x) => {
    const o = x;
    if (!o || typeof o !== "object" || Object.keys(o).length !== 1) return null;
    if ("throw" in o && cards(o.throw, 2)) return { throw: [o.throw[0], o.throw[1]] };
    if ("peg" in o && isCard(o.peg)) return { peg: o.peg };
    return null;
  },
  modes: ["versus", "together"],
  computer: {
    side: 1,
    levels: ["easy", "fair", "hard"],
    choose: (g, level) => g.r.phase === "discard" ? { throw: chooseDiscard(g.r, whoseMove(g) ?? 1, level, Math.random) } : { peg: choosePeg(g.r, level, Math.random) }
  },
  result: (g) => {
    if (whoseMove(g) !== null) return null;
    const [a, b] = g.r.scores;
    return g.r.winner ?? (a > b ? 0 : b > a ? 1 : "draw");
  },
  begun: (g) => g.past.length > 0 || g.thrown.some(Boolean),
  hidden: {
    secret: (g) => ({
      hands: g.r.hands,
      kept: g.r.kept,
      crib: g.r.crib,
      starter: g.r.starter,
      throws: g.throws
    }),
    join: (g, secret) => {
      const o = secret;
      if (!o || !Array.isArray(o.hands) || !Array.isArray(o.kept) || !Array.isArray(o.throws))
        return null;
      const r = g.r;
      let scores2 = [0, 0];
      let end = null;
      for (const h of g.past) {
        end = replayHand(h, scores2);
        if (!end) return null;
        scores2 = end.scores;
      }
      if (end && (end.phase === "over" || g.past.length >= MAX_HANDS)) return { ...g, known: true };
      if (!isCard(o.starter) || !cards(o.crib)) return null;
      const [h0, h1] = o.hands;
      const [k0, k1] = o.kept;
      const [t0, t1] = o.throws;
      if (!cards(h0) || !cards(h1)) return null;
      if (r.phase !== "discard" && r.starter !== o.starter) return null;
      if (r.phase === "discard") {
        for (const [s, t] of [
          [0, t0],
          [1, t1]
        ]) {
          if (g.thrown[s] !== (t !== null) || t !== null && !cards(t, 2)) return null;
          if ([h0, h1][s].length !== 6 || t !== null && !t.every((c) => [h0, h1][s].includes(c)))
            return null;
        }
        if ((/* @__PURE__ */ new Set([...h0, ...h1, o.starter])).size !== 13) return null;
        return {
          ...g,
          r: { ...r, hands: [[...h0], [...h1]], starter: o.starter, scores: scores2 },
          throws: [
            t0 === null ? null : [...t0],
            t1 === null ? null : [...t1]
          ],
          known: true
        };
      }
      if (!cards(k0, 4) || !cards(k1, 4) || !cards(o.crib, 4) || t0 !== null || t1 !== null)
        return null;
      const replayed = replayCurrent(
        { dealer: r.dealer, starter: o.starter, kept: [k0, k1], crib: o.crib, played: r.played },
        scores2
      );
      if (!replayed) return null;
      const same2 = JSON.stringify([
        replayed.pile,
        replayed.turn,
        replayed.scores,
        replayed.phase,
        replayed.winner
      ]) === JSON.stringify([r.pile, r.turn, r.scores, r.phase, r.winner]) && JSON.stringify(replayed.hands) === JSON.stringify([h0, h1]);
      return same2 ? { ...g, r: replayed, known: true } : null;
    },
    mine: (g, side) => ({
      hand: g.r.hands[side],
      kept: g.r.phase === "discard" ? null : g.r.kept[side],
      thrown: g.throws[side] ?? (g.r.phase === "discard" ? null : g.r.crib.slice(side * 2, side * 2 + 2))
    }),
    // a throw is face down: the history keeps that it happened, never which two
    logged: (m) => "throw" in m ? { throw: "face down" } : m,
    accept: (g) => dealt(g, Math.random)
  }
};
function replayCurrent(h, scores2) {
  const six = [
    [...h.kept[0], ...h.crib.slice(0, 2)],
    [...h.kept[1], ...h.crib.slice(2)]
  ];
  if ((/* @__PURE__ */ new Set([...six[0], ...six[1], h.starter])).size !== 13) return null;
  let r = {
    dealer: h.dealer,
    hands: six,
    kept: [[], []],
    crib: [],
    starter: h.starter,
    phase: "discard",
    pile: [],
    played: [],
    turn: other(h.dealer),
    scores: [...scores2],
    winner: null,
    said: ""
  };
  r = discard(r, [h.crib[0], h.crib[1]], [h.crib[2], h.crib[3]]);
  for (const p of h.played) {
    if (r.phase !== "peg" && r.phase !== "over" || r.turn !== p.by) return null;
    if (r.phase === "over") return null;
    const next2 = peg(r, p.card);
    if (next2 === r) return null;
    r = next2;
  }
  return { ...r, said: "" };
}
const GAMES = {
  reversi: (s) => {
    const size2 = s.size ?? 8;
    if (!SIZES$7.includes(size2)) return null;
    return {
      rules: reversiRules(size2),
      score: (g) => count$5(g.b).join("–")
    };
  },
  chess: () => ({ rules: chessRules }),
  pool: () => ({ rules: poolRules }),
  gomoku: (s) => {
    const size2 = s.size ?? 13;
    return SIZES$6.includes(size2) ? { rules: gomokuRules(size2) } : null;
  },
  draughts: () => ({ rules: draughtsRules }),
  dots: (s) => {
    const size2 = s.size ?? 4;
    if (!SIZES$5.includes(size2)) return null;
    return { rules: dotsRules(size2), score: (d) => d.g.score.join("–") };
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
      score: (g) => score$4(g.b).join("–")
    };
  },
  morris: () => ({ rules: morrisRules }),
  hex: (s) => {
    const read = readHexSettings(s);
    return read ? { rules: hexRules(...read) } : null;
  },
  ultimate: () => ({ rules: ultimateRules }),
  breakthrough: (s) => {
    const size2 = readBreakthroughSize(s);
    return size2 === null ? null : { rules: breakthroughRules(size2) };
  },
  fences: (s) => {
    const size2 = readFencesSize(s);
    return size2 === null ? null : { rules: fencesRules(size2) };
  },
  halma: () => ({ rules: halmaRules }),
  go: () => ({
    rules: goRules,
    // area by colour, white's with its komi: the count the toy shows at the end
    score: (d) => {
      const s = score$3(d.g.board);
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
    score: (g) => `${score$2(g.rolls[0])}–${score$2(g.rolls[1])}`
  }),
  curling: () => ({
    rules: curlingMatchRules,
    // the ends' points added up, yellow's first
    score: (cg) => totals$3(cg.g).join("–")
  }),
  putt: () => ({
    rules: puttRules,
    // strokes over the round, the first ball's first: the lower wins
    score: (g) => totals$2(g).join("–")
  }),
  darts: () => ({
    rules: dartsMatchRules,
    // legs won, the first thrower's first
    score: (g) => g.legs.join("–")
  }),
  backgammon: () => ({
    rules: backgammonRules,
    // what the game was worth: a single game, a gammon or a backgammon
    score: (g) => worth(g) ?? ""
  }),
  seabattle: (s) => {
    const set = readSeaSettings(s);
    return set === null ? null : {
      rules: seaRules(set),
      // ships each side sank, the challenger's first
      score: (g) => `${g.seen[0].sunk.length}–${g.seen[1].sunk.length}`
    };
  },
  dice: () => ({
    rules: diceRules,
    // the two scores banked, the challenger's first
    score: (g) => g.scores.map((n) => n.toLocaleString("en-GB")).join("–")
  }),
  yacht: () => ({
    rules: yachtRules,
    // the two cards' totals, the challenger's first
    score: (y) => `${total(y.g.cards[0])}–${total(y.g.cards[1])}`
  }),
  shut: () => ({
    rules: shutRules,
    // what each box left up, the challenger's first: the lower wins
    score: (g) => `${sum(g.up[0])}–${sum(g.up[1])}`
  }),
  codebreaker: (s) => {
    const rules = readCodeSettings(s);
    if (rules === null) return null;
    const took = (g, side) => crackedIn(g, side) ?? "uncracked";
    return { rules: codeRules(rules), score: (g) => `${took(g, 0)}–${took(g, 1)}` };
  },
  shadowbox: (s) => {
    const set = readBoxSettings(s);
    if (set === null) return null;
    return { rules: boxRules(set.rounds), score: (g) => totals$1(g).join("–") };
  },
  rps: (s) => {
    const set = readRpsSettings(s);
    if (set === null) return null;
    return { rules: rpsRules(set.firstTo), score: (g) => wins(g).join("–") };
  },
  gin: (s) => {
    const set = readGinSettings(s);
    if (set === null) return null;
    return { rules: ginRules(set.target), score: (g) => totals(g).join("–") };
  },
  cribbage: () => ({
    rules: cribRules,
    // each side's pegs, the challenger's first
    score: (g) => g.r.scores.join("–")
  })
};
const refuse = (status, error) => ({ kind: "refuse", status, error });
function readAsk(body) {
  const o = body;
  if (!o || typeof o !== "object") return null;
  const match = o.match;
  if (typeof match !== "string" || !/^[0-9a-f-]{36}$/i.test(match)) return null;
  if (o.op === "accept")
    return { match, ask: "brought" in o ? { op: "accept", brought: o.brought } : { op: "accept" } };
  if (o.op === "mine") return { match, ask: { op: "mine" } };
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
  const rows = then.length ? [
    { m, then },
    { m, replies: then.length },
    { m: null, replies: then.length }
  ] : [{ m }, { m: null }];
  return rows.find((r) => jsonbBytes(r) <= HISTORY_BYTES) ?? rows[rows.length - 1];
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
  const roll2 = (g2) => rules.roll ? rules.roll(g2, Math.random) : g2;
  const answer = (g02) => {
    let g2 = g02;
    const then2 = [];
    if (row.mode !== "together") return { g: g2, then: then2 };
    const cpu = rules.computer;
    while (rules.turn(g2) === cpu.side && then2.length < MAX_REPLIES) {
      const reply = cpu.choose(g2, level);
      if (!rules.legal(g2, reply, cpu.side)) return null;
      g2 = roll2(rules.apply(g2, reply, cpu.side));
      then2.push(reply);
    }
    return { g: g2, then: then2 };
  };
  const { hidden } = rules;
  const whole = (r) => {
    const g2 = rules.decode(r.state);
    return g2 === null || !hidden ? g2 : hidden.join(g2, r.secret);
  };
  if (ask.op === "mine") {
    if (!hidden) return refuse(422, "this toy keeps nothing hidden");
    if (row.status === "invited") return { kind: "mine", data: null };
    const g2 = whole(row);
    if (g2 === null) return refuse(500, "this match’s board cannot be read");
    return { kind: "mine", data: hidden.mine(g2, row.mode === "together" ? 0 : seat) };
  }
  if (ask.op === "accept") {
    if (row.status !== "invited") return refuse(409, "that invitation is no longer open");
    if (seat !== 1) return refuse(403, "only the friend who was challenged can accept");
    let g2 = rules.fresh(row.mode);
    if (hidden) {
      const h = hidden.accept(g2, ask.brought, row.mode);
      if (h === null) return refuse(400, "accepting this match needs your side set out first");
      g2 = h;
      const t2 = rules.turn(g2);
      return {
        kind: "begin",
        state: rules.encode(g2),
        turn: row.mode === "together" || t2 === null || t2 === "any" ? 0 : t2,
        secret: hidden.secret(g2)
      };
    }
    if (!rules.roll) return { kind: "begin", state: rules.encode(g2), turn: 0 };
    const opened = answer(rules.roll(g2, Math.random));
    if (!opened) return refuse(500, "the computer could not move");
    const t = rules.turn(opened.g);
    return {
      kind: "begin",
      state: rules.encode(opened.g),
      turn: row.mode === "together" || t === null || t === "any" ? 0 : t
    };
  }
  if (row.status !== "active") return refuse(409, "that match is not going");
  if (row.turn !== seat) return refuse(409, "it is not your turn");
  if (ask.at !== row.seq) return refuse(409, "the match has moved on");
  const g0 = whole(row);
  if (g0 === null) return refuse(500, "this match’s board cannot be read");
  const move = rules.readMove(ask.move);
  if (move === null) return refuse(400, "that is not a move in this toy");
  const side = row.mode === "together" ? 0 : seat;
  if (rules.turn(g0) !== side) return refuse(500, "this match’s turn and board disagree");
  if (!rules.legal(g0, move, side)) return refuse(400, "that move is not allowed there");
  const answered = answer(roll2(rules.apply(g0, move, side)));
  if (!answered) return refuse(500, "the computer could not move");
  const { g, then } = answered;
  const over2 = rules.turn(g) === null;
  const winner2 = over2 ? rules.result?.(g) ?? "draw" : null;
  return {
    kind: "commit",
    at: row.seq,
    // anything hidden in a move (the challenger's fleet, with their first shot) is not history
    move: hidden ? historyRow(hidden.logged(move), then.map(hidden.logged)) : historyRow(move, then),
    state: rules.encode(g),
    ...hidden ? { secret: hidden.secret(g) } : {},
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
