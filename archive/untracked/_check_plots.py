import re
data = open('experiment_plots.html','rb').read()
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m, "script block not found"
open('_check_plots.js','wb').write(m.group(1))
print("extracted", len(m.group(1)), "bytes")
