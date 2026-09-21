"""_check_chat13.py — audit the lab-group reorganization (IDs unchanged)."""
import io, re

fail = []
def ck(cond, what):
    print(("PASS " if cond else "FAIL ") + what)
    if not cond: fail.append(what)

d = io.open("fly_demon_3d.html", encoding="utf-8", newline="").read()

# every experiment id still present exactly once as a card
for eid in ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]:
    ck(len(re.findall(r'data-exp="%s"' % eid, d)) == 1, "card id unique: " + eid)
ck(len(re.findall(r'id="chatCard" data-exp="chat"', d)) == 1, "chat card id unique")

# five labs, in order
labs = re.findall(r'<details class="exp-lab" data-lab="([a-z]+)"( open)?>', d)
ck([l[0] for l in labs] == ["demon", "information", "flybrain", "quantum", "realdemons"],
   "labs present in order: " + ", ".join(l[0] for l in labs))
ck(labs[0][1] == " open" and labs[1][1] == " open" and labs[2][1] == " open"
   and labs[3][1] == "" and labs[4][1] == "", "first three labs open, future labs collapsed")

# membership: each card sits inside the right details block
def in_lab(eid, lab):
    i = d.find('data-lab="%s"' % lab)
    j = d.find("</details>", i)
    seg = d[i:j]
    return ('data-exp="%s"' % eid) in seg
for eid, lab in [("e1", "demon"), ("e6", "demon"), ("e7", "demon"),
                 ("e2", "information"), ("e8", "information"),
                 ("e3", "flybrain"), ("e4", "flybrain"), ("e5", "flybrain")]:
    ck(in_lab(eid, lab), "%s lives in %s" % (eid, lab))
for lab in ["quantum", "realdemons"]:
    i = d.find('data-lab="%s"' % lab)
    j = d.find("</details>", i)
    ck('data-exp=' not in d[i:j] and "exp-soon" in d[i:j], lab + " has only a Future placeholder")
ck(not in_lab("chat", "realdemons") and d.find('id="chatCard"') > d.find('data-lab="realdemons"'),
   "chat card stays outside the labs, before expNote")
ck(d.find('id="chatCard"') < d.find('id="expNote"'), "chat card still before expNote")

# summary labels
for lab, label in [("demon", "DEMON LAB"), ("information", "INFORMATION LAB"),
                   ("flybrain", "FLY BRAIN"), ("quantum", "QUANTUM LAB"),
                   ("realdemons", "REAL DEMONS")]:
    i = d.find('data-lab="%s"' % lab)
    ck(label in d[i:i + 300], lab + " summary reads " + label)

# classic script balance unchanged by the markup move
blocks = re.findall(r"<script>(.*?)</script>", d, re.S)
for bi, b in enumerate(blocks):
    t = re.sub(r"`(?:[^`\\]|\\.)*`", "``", b, flags=re.S)
    t = re.sub(r'"(?:[^"\\\n]|\\.)*"|\'(?:[^\'\\\n]|\\.)*\'', '""', t, flags=re.S)
    t = re.sub(r"//[^\n]*|/\*.*?\*/", "", t, flags=re.S)
    ck(t.count("{") == t.count("}") and t.count("(") == t.count(")"),
       "classic block %d balanced" % bi)

print("----")
print("FAILURES: %d" % len(fail))
raise SystemExit(1 if fail else 0)
