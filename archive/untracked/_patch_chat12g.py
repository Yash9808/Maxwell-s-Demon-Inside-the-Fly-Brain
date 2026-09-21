import io

p = "fly_demon_3d.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def crlf(s):
    return s.replace("\r\n", "\n").replace("\n", "\r\n")

def rep(old, new, n=1):
    global d
    old, new = crlf(old), crlf(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# setStatus with cls === "" must not add an empty token (DOMTokenList throws)
rep(r'''    card.classList.remove("running", "done", "error");
    if (cls !== "idle") card.classList.add(cls);''',
r'''    card.classList.remove("running", "done", "error");
    if (cls && cls !== "idle") card.classList.add(cls);''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat12g applied")
