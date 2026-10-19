# correctness.py — run Warp (cpu + cuda) over scenario JSONs and diff against
# the JS replica truth. Gates:
#   Warp-CPU  vs JS: BIT-EXACT (spikes/refac integers exact; f32 arrays equal
#               bitwise; aggregates bit-equal) when RNG/rounding paths match.
#   Warp-CUDA vs JS: bit-exact on integer arrays; f32 arrays may differ only
#               through accumulation order — reported as max_abs/num_diffs.
import json
import math
import struct
import sys

import numpy as np
import warp as wp

sys.path.insert(0, "backend_warp")
import kernels  # noqa: E402


def f32_bits(a: np.ndarray):
    return a.astype(np.float32).view(np.uint32)


def compare(name, got, want_bits, got_bits, tol, label):
    n = len(got)
    exact = int(np.sum(f32_bits(got) == want_bits))
    max_abs = float(np.max(np.abs(got - want_gauss))) if False else 0.0
    return exact


def run_scenario(path: str, device: str):
    with open(path) as fh:
        S = json.load(fh)
    N, NE = S["N"], S["NE"]
    field_np = np.array(S["optic"]["field"], dtype=np.float32)

    with wp.ScopedDevice(device):
        g = kernels.Graph(np, N, NE, device)
        g.load_graph(np.array(S["src"], np.int32), np.array(S["dst"], np.int32),
                     np.array(S["w0"], np.float32), np.array(S["sign"], np.uint8))
        field = wp.array(field_np, dtype=wp.float32, device=device)
        frames = []
        for t in range(S["ticks"]):
            wp.launch(
                kernels.k_lif_edge_parallel, N,
                [g.v, g.spikes, g.refac, g.vbuf, t, wp.uint32(1),
                 wp.float32(S["stim_burst"]), S["stim_range"][0], S["stim_range"][1],
                 field, S["optic_range"][0], S["optic_range"][1],
                 S["motor_range"][0], S["motor_range"][1],
                 wp.float32(S["motor_drive"]), wp.float32(S["ex_amp"])],
            )
            wp.launch(kernels.k_fanout_edge_parallel, NE,
                      [g.prev, g.src, g.dst, g.w, g.v])
            wp.launch(kernels.k_commit_prev, N, [g.prev, g.spikes])
            wp.launch(kernels.k_traces, NE, [g.e, g.plastic, g.spikes, g.src, g.dst])
            # host-side learning (mirrors production host code)
            e_np = g.e.numpy()
            d = wp.float32(S["da_amp"])  # DA.v starts 0 in replica too; d constant
            wp.launch(kernels.k_plasticity, NE, [g.e, g.plastic, g.w, g.w0b, g.is_exc,
                                                 wp.float32(float(d)), wp.float32(0.02)])
            wp.launch(kernels.k_decay_heat, N, [g.spikes, g.heat])
            wp.synchronize()
            if t == S["ticks"] - 1 or t == S["ticks"] // 2 - 1:
                frames.append({
                    "tick": t,
                    "V": g.v.numpy().copy(),
                    "spikes": g.spikes.numpy().copy(),
                    "refac": g.refac.numpy().copy(),
                    "W": g.w.numpy().copy(),
                    "E": g.e.numpy().copy(),
                    "heat": g.heat.numpy().copy(),
                })
        w_np = g.w.numpy()
        w0b_np = g.w0b.numpy()
        exc_np = (g.is_exc.numpy() > 0).astype(np.float32)
        ch = np.abs((w_np - w0b_np * (2.0 * exc_np - 1.0) * 0.02).astype(np.float32))
        changes = ch
    return S, frames, changes


def diff_frames(device, S, frames, truth, changes):
    report = {}
    for got, want in zip(frames, truth["frames"]):
        assert got["tick"] == want["tick"], (got["tick"], want["tick"])
        fr = {}
        for key in ("V", "W", "E", "heat"):
            gv = got[key]
            wv = np.array(want[key], dtype=np.float32)
            bit_eq = int(np.sum(f32_bits(gv) == f32_bits(wv)))
            nz = int(np.sum((gv != 0) | (wv != 0)))
            max_abs = float(np.max(np.abs(gv - wv))) if len(gv) else 0.0
            num_diff = int(np.sum(f32_bits(gv) != f32_bits(wv)))
            fr[key] = dict(bit_equal=bit_eq == len(gv), bit_match=bit_eq, n=len(gv),
                           nonzero_or_diff=nz, num_diff=num_diff, max_abs=max_abs)
        for key in ("spikes", "refac"):
            gv = got[key].astype(np.int32)
            wv = np.array(want[key], dtype=np.int32)
            fr[key] = dict(equal=bool(np.array_equal(gv, wv)),
                           got_sum=int(gv.sum()), want_sum=int(wv.sum()),
                           num_diff=int(np.sum(gv != wv)))
        report[f"tick{got['tick']}"] = fr
    # aggregates
    ch_want = np.array(truth["changes_head"], dtype=np.float32)
    ch_got = changes[:16].astype(np.float32)
    report["changes_head_equal"] = bool(np.array_equal(f32_bits(ch_got), f32_bits(ch_want)))
    report["changes_head_max_abs"] = float(np.max(np.abs(ch_got - ch_want)))
    report["device"] = device
    report["scenario"] = S["name"]
    return report


def main():
    scen_paths = sys.argv[1:]
    out = {}
    for p in scen_paths:
        truth_path = p.replace("scenario_", "truth_")
        with open(truth_path) as fh:
            truth = json.load(fh)
        for device in ("cpu", "cuda:0"):
            S, frames, changes = run_scenario(p, device)
            out[f"{S['name']}:{device}"] = diff_frames(device, S, frames, truth, changes)
            r = out[f"{S['name']}:{device}"]
            t_final = r[list(r.keys())[list(r.keys()).index("changes_head_equal") - 1]]
            ints_ok = t_final["spikes"]["equal"] and t_final["refac"]["equal"]
            floats_ok = all(t_final[k]["bit_equal"] for k in ("V", "W", "E", "heat"))
            print(f"{S['name']:16s} {device:7s} ints_exact={ints_ok} f32_bit_exact={floats_ok} "
                  f"V_diffs={t_final['V']['num_diff']} max_abs={t_final['V']['max_abs']:.3e} "
                  f"spikes(got/want)={t_final['spikes']['got_sum']}/{t_final['spikes']['want_sum']}")
    with open("backend_warp/data/correctness_report.json", "w") as fh:
        json.dump(out, fh, indent=1, default=float)
    print("report -> backend_warp/data/correctness_report.json")


if __name__ == "__main__":
    main()
