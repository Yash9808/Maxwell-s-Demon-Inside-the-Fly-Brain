"""Warp kernels mirroring brain_worker.js exactly.

Production source of truth: brain_worker.js brainTick/updateTraces/applyLearning
(read and transcribed line-by-line; constants below are the production values).
A second source of truth for heat/change-ranking: fly_demon_3d.html
(heat[i] = spike ? 1 : heat[i]*0.94; refreshWeightOverlay min-heap top-K by
|W - W0*WS*(exc?1:-1)| with WS=0.02, changeLimit=180, refreshed every 6th frame).

Parity notes
------------
* The worker uses Math.random() for Poisson injection. JS Math.random() is a
  64-bit xorshift128+ whose state is process-local; it cannot be replicated on
  GPU. For bit-comparable correctness runs we swap in an explicit
  SpillRng (32-bit LCG, f32 arithmetic, identical kernel on CPU/CUDA) in BOTH
  the JS replica and Warp. Production-parity runs must therefore use the
  JS-replica injection, not the worker's own RNG.
* All thresholds/comparisons are f32-strict. Warp CPU uses warp.f32 semantics,
  so Warp-CPU-vs-JS agreement is the stricter, exact-parity gate; Warp-CUDA is
  additionally gated on the float-tolerance below.
"""
import warp as wp

TOL = 1e-4          # f32 accumulation-order tolerance for cross-backend gates

# ---- production constants (verbatim from brain_worker.js / fly_demon_3d.html)
LEAK = 0.86         # V[i] *= 0.86 each tick
VTH = 30.0          # spike threshold (V > 30)
REFAC = 3           # refractory ticks after spike
E_DECAY = 0.985     # eligibility trace decay
E_INC = 0.15        # eligibility increment (capped at 1)
DA_DECAY = 0.985    # DA envelope decay
MOD_EMA_DECAY = 0.99
WS = 0.02           # weight scale (applied at init)
HEAT_DECAY = 0.94   # heat[i] = spike ? 1 : heat[i]*0.94
CHANGE_TOP_K = 180  # changeLimit (refreshWeightOverlay min-heap)
STIM_BURST_FRAC = 0.012
STIM_BURST_AMP = 16.0
OPTIC_P = 0.5       # drive * 0.5
OPTIC_AMP = 14.0
MOTOR_P = 0.035     # motorDrive * 0.035
MOTOR_AMP = 8.0
WMAX_LO = -1.0      # clamp bounds: -W0b*WS .. W0b*WS*2 (applied to scaled W)


@wp.func
def lcg_next(state: wp.uint32) -> wp.uint32:
    # 32-bit LCG; f32 arithmetic identical in JS replica and Warp CPU/CUDA.
    return state * wp.uint32(1664525) + wp.uint32(1013904223)


@wp.func
def lcg_uniform(state: wp.uint32) -> wp.float32:
    return wp.float32(state & wp.uint32(0xFFFFFF)) / 16777216.0  # [0,1) f32


@wp.kernel
def k_decay_heat(spike: wp.array(dtype=wp.uint8), heat: wp.array(dtype=wp.float32)):
    """heat[i] = spike ? 1 : heat[i]*0.94  (fly_demon_3d.html render-side op)."""
    i = wp.tid()
    heat[i] = wp.where(spike[i] != wp.uint8(0), 1.0, heat[i] * wp.float32(HEAT_DECAY))


@wp.kernel
def k_decay_passive(heat: wp.array(dtype=wp.float32)):
    """No-spike variant used by synthetic benchmarks."""
    i = wp.tid()
    heat[i] = heat[i] * wp.float32(HEAT_DECAY)


# RNG derivation shared with replica.js (MUST stay identical):
#   base = lcg_next(seed ^ uint32(i) ^ uint32(t))   [per-neuron, per-tick stream]
#   stim:  gate=uni(base);            amp=16*(0.7+0.6*uni(next(base)))
#   optic: gate=uni(next2);           amp=14*(0.5+uni(next3))
#   motor: gate=uni(next4);           amp= 8*(0.5+uni(next5))
#   ex:    gate=uni(next6);           amp=ex*(24+24*uni(next7))
# All gate/amp uniforms are f32-exact ((x & 0xFFFFFF) / 2^24); amp terms are
# computed with explicit f32 rounding at each step in BOTH implementations.

@wp.kernel
def k_lif_edge_parallel(
    v: wp.array(dtype=wp.float32),
    spikes: wp.array(dtype=wp.uint8),
    refac: wp.array(dtype=wp.uint8),
    vbuf: wp.array(dtype=wp.float32),
    t: wp.int32,
    seed: wp.uint32,
    stim_burst: wp.float32,
    stim_lo: wp.int32, stim_hi: wp.int32,
    optic_field: wp.array(dtype=wp.float32),
    optic_lo: wp.int32, optic_hi: wp.int32,
    motor_lo: wp.int32, motor_hi: wp.int32,
    motor_drive: wp.float32,
    ex_amp: wp.float32,
):
    """Production injectors + LIF (fan-out is a separate kernel, matching the
    production 1-tick-delay order: injection+LIF, then prev-spike fan-out,
    then prev<-spikes).

    Each thread writes ONLY its own vbuf[i] (one f32 add per firing injector
    stage, in production stage order), so vbuf construction is deterministic;
    the LIF read consumes (v + vbuf) exactly as production consumes
    V += injectors then V *= 0.86.
    """
    i = wp.tid()
    st1 = lcg_next(seed ^ wp.uint32(i) ^ wp.uint32(t))
    # --- stim burst (layers 0+1 range): p = STIM_BURST_FRAC * burst
    if (i >= stim_lo) and (i < stim_hi):
        if stim_burst > wp.float32(0.0):
            if lcg_uniform(st1) < wp.float32(STIM_BURST_FRAC) * stim_burst:
                us = lcg_uniform(lcg_next(st1))
                wp.atomic_add(vbuf, i, wp.float32(STIM_BURST_AMP) * (wp.float32(0.7) + wp.float32(0.6) * us))
    st2 = lcg_next(st1)
    # --- optic: p = drive[i] * OPTIC_P (drive 0 => no draw effect, gate false)
    if (i >= optic_lo) and (i < optic_hi):
        drive = optic_field[i]
        if drive > wp.float32(0.0):
            if lcg_uniform(st2) < drive * wp.float32(OPTIC_P):
                uo = lcg_uniform(lcg_next(st2))
                wp.atomic_add(vbuf, i, wp.float32(OPTIC_AMP) * (wp.float32(0.5) + uo))
    st3 = lcg_next(st2)
    # --- motor drive + excitability
    if (i >= motor_lo) and (i < motor_hi):
        if lcg_uniform(st3) < motor_drive * wp.float32(MOTOR_P):
            um = lcg_uniform(lcg_next(st3))
            wp.atomic_add(vbuf, i, wp.float32(MOTOR_AMP) * (wp.float32(0.5) + um))
    st4 = lcg_next(st3)
    if ex_amp > wp.float32(0.03):
        if lcg_uniform(st4) < wp.float32(0.008):
            ue = lcg_uniform(lcg_next(st4))
            wp.atomic_add(vbuf, i, ex_amp * (wp.float32(24.0) + wp.float32(24.0) * ue))
    # --- LIF (then reset vbuf[i]; same-thread ownership => race-free)
    if refac[i] > wp.uint8(0):
        refac[i] = refac[i] - wp.uint8(1)
        spikes[i] = wp.uint8(0)
    else:
        vi = (v[i] + vbuf[i]) * wp.float32(LEAK)
        v[i] = vi
        if vi > wp.float32(VTH):
            spikes[i] = wp.uint8(1)
            refac[i] = wp.uint8(REFAC)
        else:
            spikes[i] = wp.uint8(0)
    vbuf[i] = wp.float32(0.0)


@wp.kernel
def k_fanout_edge_parallel(
    prev: wp.array(dtype=wp.uint8),
    src: wp.array(dtype=wp.int32),
    dst: wp.array(dtype=wp.int32),
    w: wp.array(dtype=wp.float32),
    v: wp.array(dtype=wp.float32),
):
    """I[j] += W[i] for every edge with prev[src]==1 (atomic scatter)."""
    i = wp.tid()
    if prev[src[i]] != wp.uint8(0):
        wp.atomic_add(v, dst[i], w[i])


@wp.kernel
def k_commit_prev(
    prev: wp.array(dtype=wp.uint8),
    spikes: wp.array(dtype=wp.uint8),
):
    """prev.set(spikes) — production commits current spikes for next tick's
    1-tick-delay fan-out. One commit per tick, after fan-out."""
    i = wp.tid()
    prev[i] = spikes[i]


@wp.kernel
def k_fanout_csr(
    indptr: wp.array(dtype=wp.int32),
    indices: wp.array(dtype=wp.int32),
    wcsr: wp.array(dtype=wp.float32),
    prev: wp.array(dtype=wp.uint8),
    v: wp.array(dtype=wp.float32),
):
    """CSR row-per-neuron fan-out (coalesced; no atomics)."""
    j = wp.tid()
    if prev[j] != wp.uint8(0):
        for k in range(indptr[j], indptr[j + 1]):
            wp.atomic_add(v, indices[k], wcsr[k])


@wp.kernel
def k_traces(
    e: wp.array(dtype=wp.float32),
    plastic: wp.array(dtype=wp.uint8),
    spikes: wp.array(dtype=wp.uint8),
    src: wp.array(dtype=wp.int32),
    dst: wp.array(dtype=wp.int32),
):
    """brain_worker.js updateTraces verbatim: E = E*0.985; if plastic &&
    spikes[src] && spikes[dst] (both CURRENT tick) -> min(E+0.15, 1)."""
    i = wp.tid()
    ei = e[i] * wp.float32(E_DECAY)
    if (plastic[i] != wp.uint8(0)) and (spikes[src[i]] != wp.uint8(0)) and (spikes[dst[i]] != wp.uint8(0)):
        ei = wp.min(ei + wp.float32(E_INC), 1.0)
    e[i] = ei


@wp.kernel
def k_plasticity(
    e: wp.array(dtype=wp.float32),
    plastic: wp.array(dtype=wp.uint8),
    w: wp.array(dtype=wp.float32),
    w0b: wp.array(dtype=wp.float32),
    is_exc: wp.array(dtype=wp.uint8),
    d: wp.float32,
    w_scale: wp.float32,
):
    """applyLearning body: d = lr*DA*G is host-side scalar; per-edge gated update.

    clamp bounds are -W0b*WS .. W0b*WS*2 exactly as production
    (W0b = w0 pre-sign baseline; bounds are symmetric in sign)."""
    i = wp.tid()
    ei = e[i]
    if (ei < 0.01) or (plastic[i] == wp.uint8(0)):
        return
    wmax = w0b[i] * w_scale
    # production increment: d * e * WS * W0b[i]  (brain_worker.js applyLearning)
    inc = d * ei * w_scale * w0b[i]
    w[i] = wp.clamp(w[i] + inc, -wmax, wmax * 2.0)


@wp.kernel
def k_changes(
    w: wp.array(dtype=wp.float32),
    w0: wp.array(dtype=wp.float32),
    is_exc: wp.array(dtype=wp.uint8),
    w_scale: wp.float32,
    changes: wp.array(dtype=wp.float32),
):
    """change[i] = |W - W0*WS*(exc?1:-1)|  (refreshWeightOverlay scan)."""
    i = wp.tid()
    base = w0[i] * w_scale
    if is_exc[i] == wp.uint8(0):
        base = -base
    changes[i] = wp.abs(w[i] - base)


# ---------------- alternative production-style kernels (RNG-free) -----------
# For bit-parity vs the JS replica we also run the tick with the STIMULUS
# deterministic variant used in stage-f probes: zero pad, no Poisson burst.

@wp.kernel
def k_lif_pure(
    v: wp.array(dtype=wp.float32),
    spikes: wp.array(dtype=wp.uint8),
    refac: wp.array(dtype=wp.uint8),
    vbuf: wp.array(dtype=wp.float32),
):
    i = wp.tid()
    if refac[i] > wp.uint8(0):
        refac[i] = refac[i] - wp.uint8(1)
        spikes[i] = wp.uint8(0)
    else:
        vi = (v[i] + vbuf[i]) * wp.float32(LEAK)
        if vi > wp.float32(VTH):
            v[i] = vi
            spikes[i] = wp.uint8(1)
            refac[i] = wp.uint8(REFAC)
        else:
            v[i] = vi
            spikes[i] = wp.uint8(0)


class Graph:
    """Circuit state on a device. All arrays are warp arrays."""

    def __init__(self, np, N: int, NE: int, device: str):
        self.np = np
        self.N, self.NE = N, NE
        self.device = device
        with wp.ScopedDevice(device):
            self.v = wp.zeros(N, dtype=wp.float32)
            self.vbuf = wp.zeros(N, dtype=wp.float32)
            self.spikes = wp.zeros(N, dtype=wp.uint8)
            self.refac = wp.zeros(N, dtype=wp.uint8)
            self.prev = wp.zeros(N, dtype=wp.uint8)
            self.heat = wp.zeros(N, dtype=wp.float32)
            self.src = wp.empty(NE, dtype=wp.int32)
            self.dst = wp.empty(NE, dtype=wp.int32)
            self.w = wp.empty(NE, dtype=wp.float32)
            self.w0b = wp.empty(NE, dtype=wp.float32)
            self.is_exc = wp.empty(NE, dtype=wp.uint8)
            self.plastic = wp.full(NE, 1, dtype=wp.uint8)
            self.e = wp.zeros(NE, dtype=wp.float32)
            self.changes = wp.zeros(NE, dtype=wp.float32)
            # CSR (built by init_csr)
            self.indptr = None
            self.indices = None
            self.wcsr = None

    def load_graph(self, src, dst, w0, sign):
        wp.copy(self.src, wp.array(src, dtype=wp.int32, device=self.device))
        wp.copy(self.dst, wp.array(dst, dtype=wp.int32, device=self.device))
        wp.copy(self.w0b, wp.array(w0, dtype=wp.float32, device=self.device))
        wp.copy(self.is_exc, wp.array(sign, dtype=wp.uint8, device=self.device))
        # W = w0 * (sign?1:-1) * WS exactly as buildSim — production JS multiplies
        # in double precision and rounds once to f32, so compute in f64 here.
        signed = w0.astype("float64") * (2.0 * sign.astype("float64") - 1.0)
        wscaled = (signed * WS).astype("float32")
        wp.copy(self.w, wp.array(wscaled, dtype=wp.float32, device=self.device))

    def build_csr(self, src, dst, w0, sign):
        """Group edges by source: indptr[j], indices[k], wcsr[k]."""
        order = self.np.argsort(src, kind="stable")
        indices = dst[order]
        signed = w0.astype("float64") * (2.0 * sign.astype("float64") - 1.0)
        wscaled = (signed * WS).astype("float32")
        wcsr = wscaled[order]
        indptr = self.np.zeros(self.N + 1, dtype="int32")
        self.np.add.at(indptr, src + 1, 1)
        indptr = self.np.cumsum(indptr).astype("int32")
        self.indptr = wp.array(indptr, dtype=wp.int32, device=self.device)
        self.indices = wp.array(indices, dtype=wp.int32, device=self.device)
        self.wcsr = wp.array(wcsr, dtype=wp.float32, device=self.device)
        return indptr, indices, wcsr

    def to_host(self):
        return {
            "v": self.v.numpy().copy(),
            "spikes": self.spikes.numpy().copy(),
            "refac": self.refac.numpy().copy(),
            "w": self.w.numpy().copy(),
            "e": self.e.numpy().copy(),
            "heat": self.heat.numpy().copy(),
        }
