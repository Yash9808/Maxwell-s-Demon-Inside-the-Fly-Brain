import io, re

p = "fly_demon_3d.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d
NL = "\r\n"

def crlf(s):
    return s.replace("\r\n", "\n").replace("\n", "\r\n")

def rep(old, new, n=1):
    global d
    old, new = crlf(old), crlf(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# 1) CSS for the lab groups ----------------------------------------------------
rep("  .exp-card { background:",
"""  /* ---- lab groups (patch 13): experiments organized by department ---- */
  .exp-lab { border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
             margin-top: 8px; background: rgba(255,255,255,.02); padding-bottom: 7px; }
  .exp-lab > summary { list-style: none; cursor: pointer; padding: 6px 10px;
             font-size: 12px; user-select: none; display: flex; align-items: center; }
  .exp-lab > summary::-webkit-details-marker { display: none; }
  .exp-lab > summary::after { content: "\\25BE"; margin-left: auto; color: #8b949e; }
  .exp-lab > summary:hover { background: rgba(255,255,255,.04); }
  .exp-lab > .exp-card { margin-left: 7px; margin-right: 7px; }
  .exp-lab > .exp-card:first-of-type { margin-top: 0; }
  .exp-soon { color: #8b949e; font-size: 11px; padding: 2px 10px 0; font-style: italic; }
  .exp-card { background:""")

# 2) extract every card block verbatim (IDs and content untouched) -------------
blocks = {}
for eid in ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]:
    m = re.search(r'<div class="exp-card" data-exp="%s"[\s\S]*?\n    </div>' % eid, d)
    assert m, "card not found: " + eid
    blocks[eid] = m.group(0)
m = re.search(r'<div class="exp-card" id="chatCard"[\s\S]*?\n    </div>', d)
assert m, "chat card not found"
chat_block = m.group(0)
for eid, b in blocks.items():
    assert d.count(b) == 1, "card not unique: " + eid
assert d.count(chat_block) == 1

# 3) remove them from the flat list --------------------------------------------
for b in list(blocks.values()) + [chat_block]:
    d = d.replace(b, "", 1)

# 4) rebuild as lab groups (same IDs, new hierarchy) ---------------------------
def group(lab_id, emoji_title, ids, extra=None, open_=True):
    out = '    <details class="exp-lab" data-lab="%s"%s>%s' % (
        lab_id, " open" if open_ else "", NL)
    out += '      <summary>%s</summary>%s' % (emoji_title, NL)
    for eid in ids:
        out += blocks[eid] + NL
    if extra:
        out += '      <div class="exp-soon">%s</div>%s' % (extra, NL)
    out += '    </details>' + NL
    return out

labs = ""
labs += group("demon", "\U0001F9EA DEMON LAB", ["e1", "e6", "e7"])
labs += group("information", "\U0001F9E0 INFORMATION LAB", ["e2", "e8"])
labs += group("flybrain", "\U0001F994 FLY BRAIN", ["e3", "e4", "e5"])
labs += group("quantum", "\u269B QUANTUM LAB", [], "Future experiments \u2014 coming soon", open_=False)
labs += group("realdemons", "\U0001F52C REAL DEMONS", [], "Future real-world demon setups \u2014 coming soon", open_=False)
labs += chat_block + NL

assert d.count('<div class="sub" id="expNote"') == 1
d = d.replace('<div class="sub" id="expNote"', labs + '<div class="sub" id="expNote"', 1)

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat13 labs reorganization applied")
