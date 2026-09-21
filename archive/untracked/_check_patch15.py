# Extract every <script> block from fly_demon_3d.html and syntax-check it
# with node (--check for classic scripts, module mode for type="module").
import io, os, re, subprocess, sys

P = "fly_demon_3d.html"
src = io.open(P, encoding="utf-8").read()
blocks = []
for m in re.finditer(r"<script([^>]*)>(.*?)</script>", src, re.S):
    attrs, body = m.group(1), m.group(2)
    if "src=" in attrs:            # external script tags: nothing inline to check
        continue
    blocks.append(("module" if "module" in attrs else "classic", body))

print("inline script blocks:", len(blocks))
bad = 0
os.makedirs("_tmp_scripts", exist_ok=True)
for i, (kind, body) in enumerate(blocks):
    ext = ".mjs" if kind == "module" else ".js"
    path = os.path.join("_tmp_scripts", "blk%02d%s" % (i, ext))
    io.open(path, "w", encoding="utf-8").write(body)
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if r.returncode != 0:
        bad += 1
        print("SYNTAX FAIL block %02d (%s):\n%s" % (i, kind, (r.stderr or "")[:1500]))
    else:
        print("ok block %02d (%s, %d lines)" % (i, kind, body.count("\n") + 1))

sys.exit(1 if bad else 0)
