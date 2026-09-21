import io

p = "_check_chat12.py"
d = io.open(p, "r", encoding="utf-8", newline="").read()
anchor = "# ---- plots page untouched by this patch ------------------------------------"
add = """# ---- answer mode (patch 12e) ------------------------------------------------
ck('id="chatAnswer"' in d, "lab: answer readout box present")
ck("chatIndexBrain" in d and "window.__chatBrainIndex" in d, "lab: brain index built from done rows")
ck("layerRates" in d, "lab: index reads measured layerRates")
ck("testRegions" in d, "lab: index keeps test-phase breakdown")
ck("function chatGo" in d, "lab: question/design router installed")
ck('chatGoBtn.addEventListener("click", chatGo)' in d, "lab: button routes through chatGo")
ck("no finished runs yet" in d, "lab: honest guard before any data")

"""
assert d.count(anchor) == 1
d = d.replace(anchor, add + anchor)
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("checker extended")
