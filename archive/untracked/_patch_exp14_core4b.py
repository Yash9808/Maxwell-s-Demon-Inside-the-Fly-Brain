import io

p = "_patch_exp14_core4.py"
d = io.open(p, "r", encoding="utf-8", newline="").read()
i = d.find("# E10 particle loop + onState must use vRng")
j = d.find("# ---- E11: paired seeds per variant")
assert 0 <= i < j, (i, j)
d2 = d[:i] + d[j:]
assert d2 != d
io.open(p, "w", encoding="utf-8", newline="").write(d2)
print("no-op block removed from patcher")
