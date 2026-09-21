"""
Rank every user-facing sentence on the site by length.

  python scripts/prose-inventory.py out.txt [min-words]

⚠️ A MEASUREMENT, NOT A LIST, for the reason docs/rpc-inventory.md is queries rather than a
table: a hand-kept list of "the wordy bits" is wrong within a month, and this cannot go stale.
It is how the September copy pass found what to cut, and how to check nothing has crept back.

⚠️ IT SORTS THE COPY INTO THREE, because the same sentence is right in one place and wrong in
another. Copy INSIDE a room is held to "if you can see it, do not say it" — the map, the
landmarks and the size of the field are all on the screen already. A MENU card describes
somewhere you have not been yet, so it is allowed to describe. And Evan's own instruments —
import, reconcile, usage, tax, admin — keep every word: those notes are there to remember how
the system works, and he is the only reader.

⚠️ IT COUNTS BOTH BRANCHES OF A TERNARY even though only one is ever on screen, so the totals
read high. Lines with a `?` and a quoted string are usually that.

Comments are stripped first: the ⚠️ notes keep the long voice on purpose.
"""
import io, os, re, glob, sys
ADMIN = ('ImportPanel','ReconcilePanel','UsagePanel','AdminPanel','MessagesPanel',
         'FundPanel','TaxView','Investments','dev/')
MENU  = ('GamesRoom','HeroPlay','site/','EvanCook')   # describes a room you have not been in
MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 15
rows = []
for path in glob.glob('src/**/*.tsx', recursive=True):
    norm = path.replace(os.sep, '/')
    src = io.open(path, encoding='utf-8').read()
    s = re.sub(r'\{/\*.*?\*/\}', ' ', src, flags=re.S)
    s = re.sub(r'/\*.*?\*/', ' ', s, flags=re.S)
    s = re.sub(r'^\s*//.*$', ' ', s, flags=re.M)
    s = s.replace("{' '}", ' ')
    s = re.sub(r"\{'([^']{1,80})'\}", r'\1', s)
    s = re.sub(r'</?(strong|em|code|b|i|a|kbd|span)\b[^>]*>', '', s)
    for m in re.finditer(r'>([^<>]{60,})<', s):
        t = ' '.join(m.group(1).split())
        if re.search(r'[=;]|=>|const |return ', t): continue
        if t.count('{') > 2: continue
        if not re.search(r'\b(the|a|you|your|it|and|is|to)\b', t): continue
        w = len(t.split())
        if w < MIN: continue
        kind = ('admin' if any(a in norm for a in ADMIN)
                else 'menu' if any(a in norm for a in MENU) else 'room')
        rows.append((w, kind, os.path.basename(path), t))
rows.sort(key=lambda r: -r[0])
out = io.open(sys.argv[1], 'w', encoding='utf-8')
for kind, title in (('room','IN A ROOM — the cut applies here'),
                    ('menu','MENU / LANDING — describes somewhere you have not been'),
                    ('admin',"EVAN'S OWN INSTRUMENTS — left alone on purpose")):
    sel = [r for r in rows if r[1] == kind]
    out.write('\n===== %s : %d runs, %d words =====\n\n' % (title, len(sel), sum(r[0] for r in sel)))
    for w, _, f, t in sel:
        out.write('%3dw  %-22s %s\n' % (w, f, t))
out.close()
tot = {k: (sum(1 for r in rows if r[1]==k), sum(r[0] for r in rows if r[1]==k)) for k in ('room','menu','admin')}
print('threshold %d+ words | room %d/%dw · menu %d/%dw · admin %d/%dw'
      % (MIN, *tot['room'], *tot['menu'], *tot['admin']))
