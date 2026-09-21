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

# 1) answer readout box --------------------------------------------------------
rep(r'''  #chatBtnRow { display:flex; gap:6px; margin-top:6px; }
  #chatBtnRow button { flex:1; }''',
r'''  #chatBtnRow { display:flex; gap:6px; margin-top:6px; }
  #chatBtnRow button { flex:1; }
  #chatAnswer { display:none; margin-top:6px; padding:8px; background:#0a1120;
                border:1px solid #2a3d5e; border-radius:8px; font-size:12px;
                color:var(--txt); white-space:pre-wrap; max-height:200px;
                overflow:auto; }''')

# 2) the box itself + honest button label --------------------------------------
rep(r'''      <div id="chatBtnRow"><button id="chatGo" class="primary">✨ Design &amp; run</button></div>''',
r'''      <div id="chatBtnRow"><button id="chatGo" class="primary">✨ Ask / design &amp; run</button></div>
      <div id="chatAnswer"></div>''')

# 3) index brain activity from every finished run (drives answer mode) ---------
rep(r'''      renderVerdicts(expId, (m.summary && m.summary.curve) || m.curve || []);''',
r'''      renderVerdicts(expId, (m.summary && m.summary.curve) || m.curve || []);
      chatIndexBrain(expId, m.rows || []);''')

# 4) router + answer mode ------------------------------------------------------
rep(r'''  const CHAT_ALIASES = {''',
r'''  // ---- question / answer mode ----------------------------------------------
  // Questions ("where is the most active region during e2, e5, e8?") are
  // answered from the measured layer rates of finished runs — never from the
  // model's imagination. Rows are indexed on every done (chatIndexBrain).
  const chatBrain = window.__chatBrainIndex = { byExp: {} };
  const CHAT_REGION_RULES = [
    [/\boptic\b/i, "optic lobe"],
    [/antennal|\bPN\b/i, "antennal lobe"],
    [/kenyon|hidden/i, "mushroom body"],
    [/MB output|motor/i, "motor output"],
  ];
  function chatIndexBrain(expId, rows) {
    const acc = {};
    let nRows = 0;
    for (const r of rows) {
      if (!r || !r.layerRates) continue;
      nRows++;
      const ph = r.phase === "test" ? "test" : "train";
      for (const [layer, v] of Object.entries(r.layerRates)) {
        let reg = null;
        for (const [re, name] of CHAT_REGION_RULES) if (re.test(layer)) { reg = name; break; }
        if (!reg || !Number.isFinite(v)) continue;
        const a = acc[reg] = acc[reg] || { sum: 0, n: 0, tSum: 0, tN: 0 };
        a.sum += v; a.n++;
        if (ph === "test") { a.tSum += v; a.tN++; }
      }
    }
    const regions = {};
    for (const [k, a] of Object.entries(acc)) regions[k] = a.n ? a.sum / a.n : 0;
    const top = Object.entries(regions).sort((x, y) => y[1] - x[1]).map(e => e[0]);
    const head = cards[expId] && cards[expId].querySelector(".exp-head b");
    chatBrain.byExp[expId] = {
      label: head ? head.textContent : expId,
      regions, top,
      testRegions: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.tN ? a.tSum / a.tN : 0])),
      conds: [...new Set(rows.map(r => r.condition))].length,
      rows: nRows,
    };
  }
  window.__chatIndexBrain = chatIndexBrain;   // debug/test hook (page convention)
  async function chatAnswer(q) {
    if ((!chatState || !chatState.model) && chatModelsEl.value) {
      chatState = { prov: chatProvEl.value, model: chatModelsEl.value,
                    host: chatHostEl.value.trim() || undefined };
      chatConnectBtn.textContent = "Connected \u2713";
    }
    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }
    const have = Object.keys(chatBrain.byExp);
    if (!have.length) {
      setStatus("chat", "error", "no finished runs yet — run an experiment (or run all six), then ask again");
      return;
    }
    const digest = have.map(id => {
      const b = chatBrain.byExp[id];
      const regs = Object.entries(b.regions).sort((x, y) => y[1] - x[1])
        .map(e => e[0] + " " + e[1].toFixed(3)).join(", ");
      const tRegs = Object.entries(b.testRegions).sort((x, y) => y[1] - x[1])
        .map(e => e[0] + " " + e[1].toFixed(3)).join(", ");
      return id + " [" + b.label + ", " + b.conds + " conditions, " + b.rows + " brain rows]" +
             "\n  mean activity by region: " + regs +
             "\n  test-phase only: " + tRegs +
             "\n  most active overall: " + (b.top[0] || "n/a");
    }).join("\n");
    const ans = document.getElementById("chatAnswer");
    ans.style.display = "block";
    ans.textContent = "asking " + chatState.model + "\u2026";
    setStatus("chat", "running", "analysing\u2026 (" + chatState.model + ")");
    chatGoBtn.disabled = true;
    try {
      const url = chatState.prov === "openai" ? "https://api.openai.com/v1/chat/completions"
                                              : chatBase() + "/v1/chat/completions";
      const headers = { "Content-Type": "application/json" };
      if (chatState.key) headers.Authorization = "Bearer " + chatState.key;
      const r = await chatFetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ model: chatState.model, temperature: 0.2,
          messages: [
            { role: "system", content: "You answer questions about finished experiments in a fly-brain Maxwell-demon lab. Use ONLY the measured data digest provided; name the regions and experiments explicitly; 2-5 plain sentences; no markdown headers; if the data does not cover something, say so." },
            { role: "user", content: "Question: " + q +
              "\n\nMeasured mean layer/region activity per finished experiment (mean spikes/step, 0-1 scale):\n" + digest }
          ] })
      }, 120000);
      if (!r.ok) throw new Error("model API http " + r.status);
      const j = await r.json();
      const msg0 = (j.choices && j.choices[0] && j.choices[0].message) || {};
      const txt = ((msg0.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim()) ||
                  (msg0.reasoning || "").trim();
      if (!txt) throw new Error("empty reply from model");
      ans.textContent = "\uD83D\uDCAC " + txt;
      setStatus("chat", "", "answered \u00b7 " + chatState.model);
    } catch (e) {
      ans.textContent = "\u26A0 " + String(e.message || e);
      setStatus("chat", "error", "answer failed: " + String(e.message || e).slice(0, 80));
    } finally {
      chatGoBtn.disabled = false;
    }
  }
  function chatGo() {
    const q = chatIdeaEl.value.trim();
    if (!q) { setStatus("chat", "error", "type a question or a study idea first"); return; }
    // questions get answered from measured data; anything else designs a run
    const isQuestion = /^(where|which|what|how|why|when|who|is|are|does|do|can)\b/i.test(q) || /\?\s*$/.test(q);
    if (isQuestion) chatAnswer(q);
    else chatDesign();
  }

  const CHAT_ALIASES = {''')

# 5) the button now routes -----------------------------------------------------
rep(r'''  chatGoBtn.addEventListener("click", chatDesign);''',
r'''  chatGoBtn.addEventListener("click", chatGo);''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("chat12e applied")
