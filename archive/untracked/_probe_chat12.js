/**
 * _probe_chat12.js — reproduce the chat design call against local Ollama
 * exactly as the page does, and dump the raw response shape.
 */
"use strict";
const payload = {
  model: "Qwen3-VL:latest",
  temperature: 0.4,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: 'You design experiments for a 2D Maxwell-demon sorting lab. Reply with ONLY minified JSON: {"name":string,"hypothesis":string,"conditions":[2-4 ids from classical_demon|ann|drosophila|never_gate|random],"nParticles":int 40-640,"noise":number 0-0.4,"trainTrials":int 8-60,"testTrials":int 4-12}' },
    { role: "user", content: "Study idea from the scientist: Compare the classical demon against a random gate in a small, clean world with few particles - which sorts better?\nDesign the experiment." }
  ]
};

async function tryPost(body, tag) {
  const t0 = Date.now();
  const r = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  console.log("==", tag, "http", r.status, "in", ((Date.now() - t0) / 1000).toFixed(1) + "s,", txt.length, "bytes");
  try {
    const j = JSON.parse(txt);
    const ch = j.choices && j.choices[0];
    console.log("  choice keys:", ch && Object.keys(ch));
    console.log("  message keys:", ch && ch.message && Object.keys(ch.message));
    console.log("  content len:", ch && ch.message && (ch.message.content || "").length,
                "| finish_reason:", ch && ch.finish_reason,
                "| reasoning len:", ch && ch.message && ch.message.reasoning ? ch.message.reasoning.length : "n/a");
    console.log("  content head:", JSON.stringify((ch && ch.message && ch.message.content || "").slice(0, 200)));
    if (j.error) console.log("  API error:", JSON.stringify(j.error).slice(0, 300));
  } catch (e) {
    console.log("  non-JSON body head:", txt.slice(0, 300));
  }
}

(async () => {
  await tryPost(payload, "with json_object");
  const p2 = Object.assign({}, payload); delete p2.response_format;
  await tryPost(p2, "without json_object");
})().catch(e => { console.error("probe failed:", e.message); process.exit(1); });
