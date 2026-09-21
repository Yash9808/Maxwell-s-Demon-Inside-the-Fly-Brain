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

# 1) ask every provider for strict JSON (OpenAI & Ollama & LM Studio all
#    honour response_format json_object; local grammars make this bulletproof)
rep(r'''        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          messages: [''',
r'''        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [''')

# 2) parse defensively: strip <think> reasoning (deepseek-r1 et al) and quote
#    a snippet in the failure message so chatty models are diagnosable
rep(r'''      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a) throw new Error("model did not return JSON");''',
r'''      const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const txt = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a)
        throw new Error("model did not return JSON — replied: " + raw.replace(/\s+/g, " ").slice(0, 70));''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat12c applied")
