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

# chatDesign: adopt the currently selected detected model if the user skipped
# "Save & connect" (Connect alone already lists and recommends models)
rep(r'''    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }''',
r'''    if ((!chatState || !chatState.model) && chatModelsEl.value) {
      chatState = { prov: chatProvEl.value, model: chatModelsEl.value,
                    host: chatHostEl.value.trim() || undefined };
      chatConnectBtn.textContent = "Connected \u2713";
    }
    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat12b applied")
