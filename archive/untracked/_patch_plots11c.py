import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()

BS = chr(92)
WB = BS + "b"          # regex word boundary as literal text

NEW_FN = (
    'function regionForRateName(nm){\n'
    '  const s = (nm || "").toLowerCase();\n'
    '  if (/antennal|' + WB + 'pn' + WB + '|olfact/.test(s)) return "antennal";\n'
    '  if (/kenyon|mushroom|hidden|' + WB + 'mb' + WB + '/.test(s)) return "mb";\n'
    '  if (/optic|medulla|lobula|lamina/.test(s)) return "optic";\n'
    '  if (/motor|descend|vnc|neck/.test(s)) return "motor";\n'
    '  if (/lateral horn|' + WB + 'lh' + WB + '/.test(s)) return "lh";\n'
    '  if (/central complex|ellipsoid|fan-shaped|' + WB + 'CX' + WB + '|' + WB + 'eb' + WB + '|'
    + WB + 'pb' + WB + '|' + WB + 'fb' + WB + '/i.test(s)) return "cx";\n'
    '  return "central";\n'
    '}\n'
)

i = d.find("function regionForRateName")
assert i >= 0, "function not found"
END = 'return "central";\n}'
j = d.find(END, i)
assert j > i, "end anchor not found"
j += len(END)

d = d[:i] + NEW_FN + d[j:]
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("regionForRateName rebuilt: word-boundary escaping fixed, hidden->mb added")
