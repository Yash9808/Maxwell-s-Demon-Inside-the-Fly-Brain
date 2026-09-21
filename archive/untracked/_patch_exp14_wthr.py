import io

p = "experiment_worker.js"
d = io.open(p, "r", encoding="utf-8", newline="").read()
NL = "\r\n" if "\r\n" in d else "\n"
def nl(s):
    return s.replace("\r\n", "\n").replace("\n", NL) if NL else s

def rep(old, new, n=1):
    global d
    old, new = nl(old), nl(new)
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:80])
    d = d.replace(old, new)

# app_state throttling: a state message carries nParticles*3 numbers every
# 8th physics step (~7.5 Hz per sim speed) — in fast-forward that floods the
# main thread. Throttle to ~25 msgs/s wall-clock, and always send the last
# state when the run finishes so the 3D scene ends on the final configuration.
rep("""        onState: (st) => postMessage({ type: \"app_state\", expId, state: st }),""",
"""        onState: (st) => {
          const now = Date.now();
          if (now - lastAppState >= 40) { lastAppState = now;
            postMessage({ type: \"app_state\", expId, state: st }); }
        },""")

rep("""    const nTrials = train + test;
    try {
      const res = coreFn({""",
"""    const nTrials = train + test;
    let lastAppState = 0;
    try {
      const res = coreFn({""")

io.open(p, "w", encoding="utf-8", newline="").write(d)
print("worker app_state throttle added")
