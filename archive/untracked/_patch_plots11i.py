import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()

def body(s):
    k = d.find("{", s)
    depth = 0
    for m in range(k, len(d)):
        if d[m] == "{": depth += 1
        elif d[m] == "}":
            depth -= 1
            if depth == 0: return m + 1
    raise AssertionError("unbalanced")

i = d.find("function collectBrainDeltas")
j = d.find("function collectBrainDeltas", i + 10)
assert i > 0 and j > i, (i, j)
end = body(i)
# remove the first (redundant) copy plus its trailing blank line
seg = d[i:end]
assert "const dr = l - e;" in seg, "expected the redundant (dr) copy first"
d = d[:i] + d[end:]
if d[i:i+2] == "\r\n" or d[i:i+1] == "\n":
    d = d[i:i] + d[i:].lstrip("\r\n").rjust(0) if False else d[:i] + d[end:].lstrip("\n")
io.open(p, "w", encoding="utf-8", newline="").write(d)
assert d.count("function collectBrainDeltas") == 1, d.count("function collectBrainDeltas")
print("redundant collectBrainDeltas removed; one definition remains")
