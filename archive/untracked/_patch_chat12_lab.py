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

# 1) CSS for the chat card (reuses the app's palette / exp-card look) ----------
rep(r'''  #contactClose { background:none; border:none; color:var(--dim); font-size:20px;
                  cursor:pointer; line-height:1; padding:2px 6px; }
</style>''',
r'''  #contactClose { background:none; border:none; color:var(--dim); font-size:20px;
                  cursor:pointer; line-height:1; padding:2px 6px; }
  /* ---- Chat: design an experiment with an LLM (patch 12) ---- */
  #chatCard select, #chatCard textarea, #chatCard input {
    width:100%; box-sizing:border-box; background:#0a1120; color:var(--txt);
    border:1px solid #2a3d5e; border-radius:8px; padding:6px 8px;
    font:inherit; font-size:12px; }
  #chatCard select:focus, #chatCard textarea:focus, #chatCard input:focus {
    outline:none; border-color:#3b82f6; }
  #chatCfg { display:none; margin:6px 0 2px; padding:8px;
             border:1px dashed #2a3d5e; border-radius:8px;
             flex-direction:column; gap:6px; }
  #chatCfg.open { display:flex; }
  #chatIdea { min-height:56px; resize:vertical; margin-top:6px; }
  #chatRec { font-size:11px; color:#8fd48f; }
  #chatRec.warn { color:#e3b341; }
  #chatBtnRow { display:flex; gap:6px; margin-top:6px; }
  #chatBtnRow button { flex:1; }
</style>''')

# 2) the Chat card, after E8 --------------------------------------------------
rep(r'''    <div class="sub" id="expNote"''',
r'''    <div class="exp-card" id="chatCard" data-exp="chat" title="Chat: describe a study and an LLM (GPT API, local Ollama or LM Studio) designs a runnable experiment — it then runs through the same background worker and live plots as E1-E8.">
      <div class="exp-head"><b>💬 Chat · design an experiment</b></div>
      <div class="exp-desc">Pick a provider and connect — local Ollama / LM Studio are auto-detected and the best installed model is recommended. Then describe your study and the model designs + runs it.</div>
      <div class="row" style="margin-top:6px">
        <select id="chatProv" style="flex:1" title="GPT via OpenAI API key, or a local LLM: Ollama, LM Studio, or a Pi on your LAN via the host override">
          <option value="openai">GPT · OpenAI API</option>
          <option value="ollama">Ollama · local</option>
          <option value="lmstudio">LM Studio · local</option>
        </select>
        <button id="chatConnect" title="detect models / connect">Connect</button>
      </div>
      <div id="chatCfg">
        <input id="chatKey" type="password" placeholder="OpenAI API key (sk-…)" autocomplete="off" style="display:none">
        <div class="sub" id="chatKeyHint" style="display:none">Get a key: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a> — stored only in this browser.</div>
        <input id="chatHost" placeholder="host:port override — e.g. 192.168.1.42:11434 for a Pi running Ollama" style="display:none">
        <select id="chatModels" style="display:none"></select>
        <input id="chatModelTxt" placeholder="gpt-4.1-mini" style="display:none">
        <div class="sub" id="chatRec"></div>
        <div class="row"><button id="chatSave" class="primary" style="flex:1">Save &amp; connect</button></div>
      </div>
      <textarea id="chatIdea" placeholder="e.g. Does a 4-step memory beat a fixed threshold in dense, noisy worlds? Compare demon variants and a random control…"></textarea>
      <div id="chatBtnRow"><button id="chatGo" class="primary">✨ Design &amp; run</button></div>
      <canvas class="exp-spark" width="220" height="44"></canvas>
      <div class="exp-meta"><span class="exp-eta">LLM-designed</span><span class="exp-status" id="chatStatus">not connected</span></div>
      <div class="exp-verdicts"></div>
    </div>
    <div class="sub" id="expNote"''')

# 3) startNext: chat experiments go through run_custom ------------------------
rep(r'''    worker.postMessage({ type: "run", expId,
                         circuit: window.__expCircuit || null, opts: {} });''',
r'''    if (expId === "chat" && window.__chatSpec) {
      worker.postMessage({ type: "run_custom", expId,
                           spec: window.__chatSpec,
                           circuit: window.__expCircuit || null, opts: {} });
    } else {
      worker.postMessage({ type: "run", expId,
                           circuit: window.__expCircuit || null, opts: {} });
    }''')

# 4) the chat wiring itself, at the end of the experiment-list IIFE ------------
rep(r'''      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }
})();''',
r'''      CH.postMessage({ kind: "plots", type: "session_end" });
    }
  }

  // ---- Chat: design a new experiment with an LLM (patch 12) ------------------
  // Providers: GPT via an OpenAI API key, or a local runtime — Ollama
  // (auto-detected on :11434; models listed and the best one recommended
  // straight from your installed list) or LM Studio (:1234, OpenAI-
  // compatible). A host override covers a Raspberry Pi / another box on LAN.
  const chatEl = (id) => document.getElementById(id);
  const chatProvEl = chatEl("chatProv"), chatConnectBtn = chatEl("chatConnect");
  const chatCfg = chatEl("chatCfg"), chatKeyEl = chatEl("chatKey");
  const chatKeyHint = chatEl("chatKeyHint"), chatHostEl = chatEl("chatHost");
  const chatModelsEl = chatEl("chatModels"), chatModelTxtEl = chatEl("chatModelTxt");
  const chatRec = chatEl("chatRec"), chatSaveBtn = chatEl("chatSave");
  const chatIdeaEl = chatEl("chatIdea"), chatGoBtn = chatEl("chatGo");
  const CHAT_STORE = "flydemon.chat.";
  let chatState = null;                       // { prov, model, key?, host? }
  try { chatState = JSON.parse(localStorage.getItem(CHAT_STORE + "state") || "null"); } catch (e) {}
  const chatFetch = (url, opts, ms) => new Promise((resolve, reject) => {
    const ctl = (typeof AbortController === "function") ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), ms || 4000);
    fetch(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {}))
      .then(r => { clearTimeout(t); resolve(r); },
            e => { clearTimeout(t); reject(e); });
  });
  function chatBase() {
    const h = (chatState && chatState.host) || chatHostEl.value.trim();
    const port = chatState && chatState.prov === "ollama" ? 11434 : 1234;
    return "http://" + (h || "127.0.0.1:" + port);
  }
  async function chatDetect() {
    const p = chatProvEl.value;
    chatCfg.classList.add("open");
    chatKeyEl.style.display = p === "openai" ? "block" : "none";
    chatKeyHint.style.display = p === "openai" ? "block" : "none";
    chatModelTxtEl.style.display = p === "openai" ? "block" : "none";
    chatHostEl.style.display = p === "openai" ? "none" : "block";
    chatModelsEl.style.display = p === "openai" ? "none" : "block";
    chatRec.classList.remove("warn");
    if (p === "openai") {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(CHAT_STORE + "openai") || "null"); } catch (e) {}
      chatKeyEl.value = (st && st.key) || "";
      chatModelTxtEl.value = (st && st.model) || "gpt-4.1-mini";
      chatRec.textContent = "Enter your key, check the model id, then Save & connect.";
      return;
    }
    chatRec.textContent = "detecting local models…";
    chatModelsEl.innerHTML = "";
    chatState = { prov: p, model: null, host: chatHostEl.value.trim() || undefined };
    try {
      if (p === "ollama") {
        const r = await chatFetch(chatBase() + "/api/tags", {}, 3500);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const models = (j.models || []).map(m => ({
          id: m.name,
          ps: (m.details && m.details.parameter_size) || "?",
          q: (m.details && m.details.quantization_level) || ""
        }));
        if (!models.length) {
          chatRec.classList.add("warn");
          chatRec.textContent = "Ollama is reachable but has no models — pull one first (e.g. `ollama pull llama3.1:8b` in PowerShell).";
          return;
        }
        // rank the installed list: mid-size instruct models (7-16B) with
        // clean quants design experiments best for the VRAM they cost
        const score = (m) => {
          const b = parseFloat(m.ps) || 0;
          const s = (b >= 7 && b <= 16) ? 0 : (b >= 4 && b <= 34) ? 1 : 2;
          const qi = ["F16", "BF16", "Q8_0", "Q6_K", "Q5_K_M", "Q4_K_M", "Q4_0"].indexOf(m.q);
          return s + (qi < 0 ? 3 : qi) * 0.01;
        };
        models.sort((a, b) => score(a) - score(b));
        chatModelsEl.innerHTML = models.map(m =>
          `<option value="${m.id}">${m.id} · ${m.ps}${m.q ? " · " + m.q : ""}</option>`).join("");
        const best = models[0];
        chatRec.textContent = models.length + " model" + (models.length > 1 ? "s" : "") +
          " recognised from your Ollama list — recommended: " + best.id +
          " (" + best.ps + (best.q ? " " + best.q : "") + "), the best quality/size balance here for experiment design.";
      } else {
        const r = await chatFetch(chatBase() + "/v1/models", {}, 3500);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const ids = (j.data || []).map(m => m.id).filter(Boolean);
        if (!ids.length) throw new Error("no models loaded");
        chatModelsEl.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join("");
        chatRec.textContent = ids.length + " model" + (ids.length > 1 ? "s" : "") +
          " loaded in LM Studio — pick one (larger designs better, answers slower).";
      }
    } catch (e) {
      chatModelsEl.style.display = "none";
      chatRec.classList.add("warn");
      chatRec.textContent = p === "ollama"
        ? "Ollama not detected on " + chatBase() + " — start it (`ollama serve` in PowerShell), or run it on a Pi / other PC and use the host override."
        : "LM Studio not detected on " + chatBase() + " — start the local server (Developer → Start Server), or use the host override.";
    }
  }
  chatSaveBtn.addEventListener("click", () => {
    const p = chatProvEl.value;
    if (p === "openai") {
      const key = chatKeyEl.value.trim(), model = chatModelTxtEl.value.trim() || "gpt-4.1-mini";
      if (!key || key.indexOf("sk-") !== 0) {
        setStatus("chat", "error", "that key doesn't look right — OpenAI keys start with sk-");
        return;
      }
      chatState = { prov: p, model, key };
      try { localStorage.setItem(CHAT_STORE + "openai", JSON.stringify({ key, model })); } catch (e) {}
    } else {
      const model = chatModelsEl.value;
      if (!model) { setStatus("chat", "error", "no local model selected — is the runtime running?"); return; }
      chatState = { prov: p, model, host: chatHostEl.value.trim() || undefined };
      try { localStorage.setItem(CHAT_STORE + p, JSON.stringify({ model, host: chatState.host })); } catch (e) {}
    }
    try { localStorage.setItem(CHAT_STORE + "state",
      JSON.stringify({ prov: chatState.prov, model: chatState.model, host: chatState.host })); } catch (e) {}
    chatCfg.classList.remove("open");
    chatConnectBtn.textContent = "Connected ✓";
    setStatus("chat", "", "connected · " + chatState.model);
  });
  chatConnectBtn.addEventListener("click", chatDetect);
  chatProvEl.addEventListener("change", () => {
    chatState = null;
    chatConnectBtn.textContent = "Connect";
    chatCfg.classList.remove("open");
    try { localStorage.removeItem(CHAT_STORE + "state"); } catch (e) {}
  });
  const CHAT_ALIASES = {
    classical_demon: "classical_demon", classical: "classical_demon", demon: "classical_demon",
    classic: "classical_demon", physical: "classical_demon", adaptive: "classical_demon",
    ann: "ann", mlp: "ann", neural: "ann", network: "ann",
    drosophila: "drosophila", fly: "drosophila", fly_brain: "drosophila", mb: "drosophila",
    mushroom: "drosophila", mushroom_body: "drosophila",
    never_gate: "never_gate", nevergate: "never_gate", never: "never_gate",
    random: "random", control: "random", baseline: "random",
  };
  const CHAT_SYSTEM = "You design experiments for a 2D Maxwell-demon sorting lab used in a fly-brain AI research demo. Available controllers: classical_demon (adaptive-threshold physical gate), ann (small reward-trained MLP), drosophila (PN-KC-MB dopamine network), never_gate (never opens the door; control), random. Physics knobs: nParticles 40-640, noise 0-0.4. Reply with ONLY minified JSON, no markdown: {\"name\":string <=60 chars,\"hypothesis\":string <=200 chars,\"conditions\":[2-4 distinct controller ids],\"nParticles\":int,\"noise\":number,\"trainTrials\":int 8-60,\"testTrials\":int 4-12}";
  async function chatDesign() {
    if (!chatState || !chatState.model) {
      setStatus("chat", "error", "connect a model first");
      chatDetect();
      return;
    }
    const idea = chatIdeaEl.value.trim();
    if (!idea) { setStatus("chat", "error", "describe the study first"); return; }
    if (current === "chat" || queue.includes("chat")) { setStatus("chat", "error", "already queued/running"); return; }
    setStatus("chat", "running", "designing… (" + chatState.model + ")");
    chatGoBtn.disabled = true;
    try {
      const url = chatState.prov === "openai" ? "https://api.openai.com/v1/chat/completions"
                                              : chatBase() + "/v1/chat/completions";
      const headers = { "Content-Type": "application/json" };
      if (chatState.key) headers.Authorization = "Bearer " + chatState.key;
      const r = await chatFetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ model: chatState.model, temperature: 0.4,
          messages: [
            { role: "system", content: CHAT_SYSTEM },
            { role: "user", content: "Study idea from the scientist: " + idea +
                                     "\nDesign the experiment: pick the 2-4 conditions that best test it and set the physics." }
          ] })
      }, 120000);
      if (!r.ok) throw new Error("model API http " + r.status);
      const j = await r.json();
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a) throw new Error("model did not return JSON");
      const spec = JSON.parse(txt.slice(a, b + 1));
      const ids = [];
      for (const c of (Array.isArray(spec.conditions) ? spec.conditions : [])) {
        const k = CHAT_ALIASES[String(c).toLowerCase().trim()];
        if (k && !ids.includes(k)) ids.push(k);
      }
      if (!ids.length) throw new Error("no usable conditions in the design");
      window.__chatSpec = {
        name: String(spec.name || idea.slice(0, 48)).slice(0, 60),
        hypothesis: String(spec.hypothesis || "").slice(0, 200),
        conditions: ids,
        nParticles: Math.max(40, Math.min(640, Math.round(Number(spec.nParticles) || 320))),
        noise: Math.max(0, Math.min(0.4, Number(spec.noise) || 0.12)),
        trainTrials: Math.max(8, Math.min(60, Math.round(Number(spec.trainTrials) || 40))),
        testTrials: Math.max(4, Math.min(12, Math.round(Number(spec.testTrials) || 8)))
      };
      queue.push("chat");
      openPlots();
      const toast = (typeof msg === "function") ? msg : (window.__labMsg || (() => {}));
      toast("💬 " + chatState.model + " designed: " + window.__chatSpec.name + " — queued", 4000);
      setStatus("chat", "running", "queued… " + ids.join(" vs "));
      startNext();
    } catch (e) {
      setStatus("chat", "error", "design failed: " + String(e.message || e).slice(0, 90));
    } finally {
      chatGoBtn.disabled = false;
    }
  }
  chatGoBtn.addEventListener("click", chatDesign);
  if (chatState && chatState.prov) {
    chatProvEl.value = chatState.prov;
    chatConnectBtn.textContent = "Connected ✓";
    setStatus("chat", "", "connected · " + chatState.model);
  }
})();''')

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("lab patch applied:", p)
