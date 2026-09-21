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

# 1) no forced json_object: reasoning-style local models spend the whole
#    budget thinking and return empty content (measured on this machine)
rep(r'''        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [''',
r'''        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          messages: [''')

# 2) tolerant extraction: content first, then the reasoning stream (think-first
#    models often answer there); parse candidates from the end — final wins
rep(r'''      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const txt = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a)
        throw new Error("model did not return JSON — replied: " + raw.replace(/\s+/g, " ").slice(0, 70));
      const spec = JSON.parse(txt.slice(a, b + 1));''',
r'''      const msg0 = (j.choices && j.choices[0] && j.choices[0].message) || {};
      const raw = msg0.content || "";
      const txt = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
      // scan for complete top-level JSON objects (string-aware); thinking
      // models may put the final design only inside their reasoning stream
      const objs = (s) => {
        const out = []; let depth = 0, start = -1, inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') { inStr = true; continue; }
          if (ch === "{") { if (!depth) start = i; depth++; }
          else if (ch === "}") { if (depth) { depth--; if (!depth && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } } }
        }
        return out;
      };
      const cands = objs(txt).concat(objs(msg0.reasoning || ""));
      let spec = null;
      for (let i = cands.length - 1; i >= 0 && !spec; i--) {
        try { const o = JSON.parse(cands[i]); if (o && (o.conditions || o.name)) spec = o; } catch (e) {}
      }
      if (!spec)
        throw new Error("model did not return a design — replied: " +
                        (raw || msg0.reasoning || "").replace(/\s+/g, " ").slice(0, 70));''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat12d applied")
