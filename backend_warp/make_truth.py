# make_truth.py — deterministic scenario generation shared by JS and Python.
#
# Every scenario is a complete, replayable spec (JSON): seed, N, NE, graph
# arrays, per-tick optic drive, injection params, DA/modulator schedule and
# trace/plasticity schedule. replica.js consumes it verbatim; the Warp harness
# consumes the same file verbatim. Scenarios are saved to backend_warp/data/
# so both sides run bit-identical inputs.
import json
import sys
import numpy as np


def build_graph(N, NE, seed):
    """Scale-free-ish deterministic graph: heavy-tailed fan-out."""
    rng = np.random.default_rng(seed)
    src = rng.integers(0, N, NE).astype(np.int32)
    dst = (src + 1 + rng.integers(0, 32, NE)).astype(np.int32)
    dst = np.mod(dst, N).astype(np.int32)
    w0 = (rng.random(NE) * 10).astype(np.float32)
    sign = (rng.random(NE) < 0.7).astype(np.uint8)
    return src, dst, w0, sign


SCENARIOS = {
    # steady low-rate background firing
    "drive_steady": dict(ticks=50, stim_burst=0.0, motor_drive=0.35, ex_amp=0.3,
                         optic_mode="uniform", optic_val=0.02, da_amp=1.0),
    # optic burst (drives optic layer only)
    "optic_burst": dict(ticks=50, stim_burst=0.0, motor_drive=0.35, ex_amp=0.3,
                        optic_mode="peak", optic_val=0.35, da_amp=1.0),
    # full sensory burst (stim + optic + motor + ex)
    "full_drive": dict(ticks=50, stim_burst=0.8, motor_drive=0.8, ex_amp=0.6,
                       optic_mode="peak", optic_val=0.5, da_amp=1.0),
    # no spikes anywhere (all-zero field, no injections beyond refac decay)
    "no_inject": dict(ticks=50, stim_burst=0.0, motor_drive=0.0, ex_amp=0.0,
                      optic_mode="zero", optic_val=0.0, da_amp=1.0),
    # extreme weights: w0 up to 200 (vs production max 10)
    "extreme_weights": dict(ticks=50, stim_burst=0.3, motor_drive=0.5, ex_amp=0.3,
                            optic_mode="peak", optic_val=0.4, da_amp=1.0, w_scale=20.0),
    # saturating activity: huge motor drive + excitability
    "max_activity": dict(ticks=50, stim_burst=1.0, motor_drive=1.0, ex_amp=1.0,
                         optic_mode="peak", optic_val=1.0, da_amp=1.0),
}


def optic_field(mode, val, N, stim_end, optic_lo, optic_hi):
    f = np.zeros(N, dtype=np.float32)
    if mode == "zero":
        return f
    if mode == "uniform":
        f[optic_lo:optic_hi] = val
        return f
    if mode == "peak":  # one hot column plus decay tail
        width = max(4, (optic_hi - optic_lo) // 16)
        f[optic_lo:optic_lo + width] = val
        return f
    raise ValueError(mode)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "backend_warp/data"
    N, NE = 5000, 30000
    stim_end = 1200          # stim layers 0+1 (production: layers[0]+layers[1])
    optic_lo, optic_hi = stim_end, 4800
    motor_lo, motor_hi = 4800, 5000
    for name, cfg in SCENARIOS.items():
        seed = 17
        src, dst, w0, sign = build_graph(N, NE, seed)
        w_scale = cfg.get("w_scale", 1.0)
        scen = {
            "name": name,
            "N": N, "NE": NE, "seed": seed,
            "stim_range": [0, stim_end],
            "optic_range": [optic_lo, optic_hi],
            "motor_range": [motor_lo, motor_hi],
            "ticks": cfg["ticks"],
            "stim_burst": cfg["stim_burst"],
            "motor_drive": cfg["motor_drive"],
            "ex_amp": cfg["ex_amp"],
            "da_amp": cfg["da_amp"],
            "optic": {
                "mode": cfg["optic_mode"], "value": cfg["optic_val"],
                "field": optic_field(cfg["optic_mode"], cfg["optic_val"], N, stim_end, optic_lo, optic_hi).tolist(),
            },
            "src": src.tolist(), "dst": dst.tolist(),
            "w0": (w0 * w_scale).astype(np.float32).tolist(),
            "sign": sign.tolist(),
        }
        path = f"{out_dir}/scenario_{name}.json"
        with open(path, "w") as fh:
            json.dump(scen, fh)
        print(f"{name}: {path} ({scen['ticks']} ticks, N={N}, NE={NE}, w_scale={w_scale})")


if __name__ == "__main__":
    main()
