"""Figures for the notebook, plan and website."""
from __future__ import annotations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import ListedColormap  # noqa: E402

from simulate import FS, G, PHASES, sample_player, simulate_session, corrupt  # noqa: E402
from features import session_features, HOP  # noqa: E402

PH_COL = ["#d9dde3", "#3b82c4", "#e0703a", "#2f9e6b", "#9b6fc4"]
M_COL = {"LR": "#8a94a6", "HGB": "#3b82c4", "LR+HMM": "#e0a03a", "HGB+HMM": "#2f9e6b"}
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.alpha": 0.25, "figure.dpi": 130,
                     "savefig.bbox": "tight", "font.family": "DejaVu Sans"})


def _shade(ax, lab, t):
    b = np.flatnonzero(np.diff(lab)) + 1
    s, e = np.r_[0, b], np.r_[b, len(lab)]
    for i, j in zip(s, e):
        if lab[i] != 0:
            ax.axvspan(t[i], t[min(j, len(t) - 1)], color=PH_COL[lab[i]], alpha=0.18, lw=0)


def fig_signals(root):
    rng = np.random.default_rng(11)
    p = sample_player(0, np.random.default_rng(7))
    clean = simulate_session(p, 3, rng, distract=False)
    st = corrupt(clean, np.random.default_rng(1), 0.04, long_gaps=False)
    f = session_features(st, len(clean["t"]))
    ch = f["ch"]
    s0 = clean["strokes"][1]
    a, b = s0["onset"] - 60, s0["end"] + 40
    t = (np.arange(a, b) - s0["contact"]) / FS * 1000
    lab = clean["label"][a:b]
    fig, axs = plt.subplots(5, 1, figsize=(8.5, 9), sharex=True)
    rows = [("gyr_mag", "|gyro| (dps)", None), ("yaw_rate", "yaw rate about\ngravity (dps)", None),
            ("acc_mag", "|accel| (g)", 16), ("elev", "tip elevation (deg)", None)]
    for ax, (k, yl, sat) in zip(axs, rows):
        ax.plot(t, ch[k][a:b], color="#1f2937", lw=1.2)
        if sat:
            ax.axhline(sat, color="#c0392b", ls="--", lw=1)
            ax.text(t[0], sat * 1.02, "sensor range ±16 g (clipped)", color="#c0392b", fontsize=8,
                    va="bottom")
        ax.set_ylabel(yl)
        _shade(ax, lab, t)
        ax.axvline(0, color="#c0392b", lw=1)
    ax = axs[4]
    ax.plot(t, clean["alpha"][a:b], color="#1f2937", lw=1.6, label="racket heading α (observable sum)")
    ax.plot(t, clean["ang_trunk"][a:b], color=PH_COL[1], lw=1.4, label="trunk / shoulder-line yaw θₜ (target)")
    ax.plot(t, clean["ang_shoulder"][a:b], color=PH_COL[2], lw=1.2, ls="--", label="shoulder joint θₛ")
    ax.plot(t, clean["ang_wrist"][a:b], color=PH_COL[3], lw=1.2, ls=":", label="wrist lag θ_w")
    _shade(ax, lab, t)
    ax.axvline(0, color="#c0392b", lw=1)
    ax.set_ylabel("angle (deg)")
    ax.set_xlabel("time relative to ball contact (ms)")
    ax.legend(fontsize=8, loc="upper left", ncol=2, frameon=False)
    handles = [plt.Rectangle((0, 0), 1, 1, color=PH_COL[i], alpha=0.4) for i in range(1, 5)]
    axs[0].legend(handles, PHASES[1:], ncol=4, fontsize=8, loc="upper left", frameon=False)
    fig.suptitle("One simulated forehand as the racket sensor sees it", fontsize=12)
    fig.tight_layout()
    fig.savefig(root / "figures" / "signals.png")
    plt.close(fig)


def fig_timeline(root, res):
    ex = res["excerpt"]
    y = np.array(ex["y"])
    n = 2400  # 24 s
    s = 300
    keys = ["y", "LR", "HGB", "LR+HMM", "HGB+HMM"]
    lab = {"y": "ground truth", "LR": "LogReg (frame)", "HGB": "GBoost (frame)",
           "LR+HMM": "LogReg + HMM", "HGB+HMM": "GBoost + HMM"}
    M = np.array([np.array(ex[k])[s:s + n] for k in keys])
    fig, ax = plt.subplots(figsize=(10, 2.6))
    ax.imshow(M, aspect="auto", cmap=ListedColormap(PH_COL), vmin=0, vmax=4, interpolation="nearest",
              extent=[0, n / 100, len(keys), 0])
    ax.set_yticks(np.arange(len(keys)) + 0.5)
    ax.set_yticklabels([lab[k] for k in keys])
    ax.set_xlabel("time (s), held-out player 0")
    ax.grid(False)
    handles = [plt.Rectangle((0, 0), 1, 1, color=PH_COL[i]) for i in range(5)]
    ax.legend(handles, PHASES, ncol=5, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, 1.28),
              frameon=False)
    fig.savefig(root / "figures" / "timeline.png")
    plt.close(fig)


def fig_robustness(root, summ):
    rob = summ["robustness"]
    rates = sorted({float(k.split("_")[0]) for k in rob})
    fig, ax = plt.subplots(figsize=(6.2, 3.6))
    for mode, ls in [("interp", "-"), ("zero", "--")]:
        for m in ["HGB", "HGB+HMM"]:
            v = [rob[f"{r}_{mode}"][m] for r in rates]
            name = f"{m}, " + ("interpolate ≤50 ms + mask" if mode == "interp" else "zero-fill (naive)")
            ax.plot(np.array(rates) * 100, v, ls, marker="o", color=M_COL[m], label=name, lw=1.8)
    ax.set_xlabel("packet loss on held-out player (%)  [+ random 150–400 ms dropouts]")
    ax.set_ylabel("frame macro-F1 (%)")
    ax.legend(fontsize=8, frameon=False)
    ax.set_title("Robustness to bursty BLE packet loss", fontsize=11)
    fig.savefig(root / "figures" / "robustness.png")
    plt.close(fig)


def fig_per_player(root, summ):
    ph = summ["phase"]
    fig, ax = plt.subplots(figsize=(7, 3.2))
    x = np.arange(len(ph["LR"]["per_player_f1"]))
    w = 0.2
    for i, m in enumerate(["LR", "HGB", "LR+HMM", "HGB+HMM"]):
        ax.bar(x + (i - 1.5) * w, ph[m]["per_player_f1"], w, color=M_COL[m], label=m)
    ax.set_ylim(min(min(ph[m]["per_player_f1"]) for m in ph) - 3, 100)
    ax.set_xticks(x)
    ax.set_xlabel("held-out player")
    ax.set_ylabel("macro-F1 (%)")
    ax.legend(ncol=4, fontsize=8, frameon=False, loc="lower center")
    ax.set_title("Leave-one-player-out: every bar is a player the model never saw", fontsize=11)
    fig.savefig(root / "figures" / "per_player.png")
    plt.close(fig)


def fig_rotation(root, summ, res):
    rx = res["rot_excerpt"]
    rot = summ["rotation"]
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.6), gridspec_kw=dict(width_ratios=[1.6, 1]))
    ax = axs[0]
    t = np.arange(len(rx["true"])) / 100
    ax.plot(t, rx["true"], color="#1f2937", lw=2, label="true trunk yaw")
    ax.plot(t, rx["proxy"], color=M_COL["LR"], lw=1.2, label="k × racket yaw (proxy)")
    ax.plot(t, rx["hgb"], color=M_COL["HGB"], lw=1.2, label="GBoost regressor")
    ax.plot(t, rx["oracle"], color=M_COL["LR+HMM"], lw=1.2, ls="--", label="regressor on a PERFECT sensor")
    ax.set_xlabel("frames inside 4 detected strokes (s, concatenated)")
    ax.set_ylabel("trunk yaw change (deg)")
    ax.legend(fontsize=8, frameon=False, ncol=2)
    ax.set_title("Held-out player 0", fontsize=11)
    ax = axs[1]
    names = ["proxy", "hgb", "oracle", "proxy_cal5", "hgb_cal5"]
    lbl = ["proxy", "GBoost", "perfect\nsensor", "proxy\n+5 GT", "GBoost\n+5 GT"]
    vals = [rot[n]["rmse"] for n in names]
    cols = [M_COL["LR"], M_COL["HGB"], M_COL["LR+HMM"], "#6b7280", M_COL["HGB+HMM"]]
    ax.bar(range(5), vals, color=cols)
    for i, v in enumerate(vals):
        ax.text(i, v + 0.3, f"{v:.1f}", ha="center", fontsize=9)
    ax.set_xticks(range(5))
    ax.set_xticklabels(lbl, fontsize=8)
    ax.set_ylabel("RMSE (deg), mean over players")
    ax.set_title("Noise is not the bottleneck", fontsize=11)
    fig.savefig(root / "figures" / "rotation.png")
    plt.close(fig)


def fig_nonident(root, ni):
    t = np.array(ni["t"]) * 1000
    fig, axs = plt.subplots(1, 3, figsize=(12, 3.4))
    ax = axs[0]
    ax.plot(t, ni["trunkA"], color=PH_COL[1], lw=1.8, label="A trunk")
    ax.plot(t, ni["trunkB"], color=PH_COL[1], lw=1.8, ls="--", label="B trunk")
    ax.plot(t, ni["shA"], color=PH_COL[2], lw=1.4, label="A shoulder")
    ax.plot(t, ni["shB"], color=PH_COL[2], lw=1.4, ls="--", label="B shoulder")
    ax.set_title("Two different bodies…", fontsize=11)
    ax.set_ylabel("deg"); ax.set_xlabel("ms from backswing onset")
    ax.legend(fontsize=8, frameon=False)
    ax = axs[1]
    ax.plot(t, ni["gyrA"], color="#1f2937", lw=2.2, label="A")
    ax.plot(t, ni["gyrB"], color="#e0703a", lw=1.2, ls="--", label="B")
    ax.set_title(f"…identical gyro (max diff {ni['gyr_max_diff_dps']:.1e} dps)", fontsize=11)
    ax.set_ylabel("|gyro| (dps)"); ax.set_xlabel("ms from backswing onset")
    ax.legend(fontsize=8, frameon=False)
    ax = axs[2]
    ax.plot(t, ni["dAB"], color=PH_COL[1], lw=1.4, label=f"A vs B (trunk split), rms {ni['dAB_rms']:.2f} g")
    ax.plot(t, ni["dAL"], color=PH_COL[3], lw=1.4, label=f"A vs arm +6 cm, rms {ni['dAL_rms']:.2f} g")
    ax.axhline(ni["noise_g"], color="#c0392b", ls=":", lw=1.2, label="per-sample noise")
    ax.set_title("Accel differences: confounded", fontsize=11)
    ax.set_ylabel("|Δ accel| (g)"); ax.set_xlabel("ms from backswing onset")
    ax.legend(fontsize=8, frameon=False)
    fig.savefig(root / "figures" / "nonident.png")
    plt.close(fig)


def make_all(root, summ, res, ni):
    fig_signals(root)
    fig_timeline(root, res)
    fig_robustness(root, summ)
    fig_per_player(root, summ)
    fig_rotation(root, summ, res)
    fig_nonident(root, ni)
