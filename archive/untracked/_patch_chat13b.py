import io

p = "fly_demon_3d.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
bad = "\U0001F994 FLY BRAIN"     # hedgehog — wrong emoji
good = "\U0001FAB0 FLY BRAIN"    # fly
c = d.count(bad)
assert c == 1, "anchor x%d" % c
d = d.replace(bad, good)
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("fly emoji fixed")
