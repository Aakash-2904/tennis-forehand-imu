"""Leave-one-player-out experiment: phase recognition, contact timing, trunk rotation."""
from __future__ import annotations

import time

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from simulate import FS, G, sample_player, simulate_session, corrupt
from features import session_features, HOP
from hmm import PhaseHMM
from metrics import frame_scores, contact_events, match_events

N_PLAYERS = 12
SESSIONS = 2
STROKES = 30
DROP_DEFAULT = 0.04
BOUNDARIES = {"onset": (0, 1), "reversal": (1, 2), "contact": (2, 3),
              "ft_end": (3, 4), "end": (4, 0)}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- data
def make_dataset(seed=7):
    rng = np.random.default_rng(seed)
    players = [sample_player(i, rng) for i in range(N_PLAYERS)]
    data = []
    for p in players:
        for s in range(SESSIONS):
            srng = np.random.default_rng(seed * 1000 + p.pid * 10 + s)
            clean = simulate_session(p, STROKES, srng)
            stream = corrupt(clean, np.random.default_rng(srng.integers(1 << 30)), DROP_DEFAULT)
            feats = featurise(clean, stream)
            data.append(dict(pid=p.pid, sess=s, clean=slim(clean), **feats))
    return players, data


KEEP_CLEAN = ["t", "acc", "gyr", "R_s", "alpha", "ang_trunk", "label", "strokes", "mount"]
KEEP_CH = ["yaw_rate", "elev", "face_tilt", "gyr_mag", "lin_mag", "acc_x", "acc_y", "acc_z", "jerk"]


def slim(clean):
    """Keep only what later steps need (8 GB laptop)."""
    return {k: clean[k] for k in KEEP_CLEAN}


def featurise(clean, stream, mode="interp"):
    f = session_features(stream, len(clean["t"]), mode=mode)
    c = f["centres"]
    return dict(X=f["X"], names=f["names"], centres=c, missing=f["missing"],
                y=clean["label"][c].astype(int),
                ch={k: f["ch"][k].astype(np.float32) for k in KEEP_CH})


# ---------------------------------------------------------------- events
def refine_contact(frames, jerk, win=8):
    """Snap a decoded F->FT boundary to the impact onset: the first sample near the
    boundary whose jerk exceeds half the local peak (the ball hits before the ringing peaks)."""
    out = []
    for fr in frames:
        s = fr * HOP
        lo, hi = max(0, s - win), min(len(jerk), s + win + 1)
        seg = jerk[lo:hi]
        out.append(lo + int(np.flatnonzero(seg >= 0.5 * seg.max())[0]))
    return np.array(out, int)


def event_scores(sess, yp, tol_ms=50):
    true_c = np.array([st["contact"] for st in sess["clean"]["strokes"]])
    pred_c = refine_contact(contact_events(yp), sess["ch"]["jerk"])
    tp, fp, fn, errs = match_events(true_c, pred_c, tol_ms / 1000 * FS)
    res = dict(contact_tp=tp, contact_fp=fp, contact_fn=fn,
               contact_err_ms=(np.array(errs) * 1000 / FS).tolist())
    # all phase boundaries (frame resolution, 10 ms)
    gt = sess["clean"]["strokes"]
    for name, (a, b) in BOUNDARIES.items():
        tb = np.array([st[name] for st in gt]) / HOP
        pb = np.flatnonzero((yp[1:] == b) & (yp[:-1] == a)) + 1
        tp, fp, fn, errs = match_events(tb, pb, 0.2 * FS / HOP)
        res[f"b_{name}_err_ms"] = (np.array(errs) * HOP * 1000 / FS).tolist()
        res[f"b_{name}_miss"] = fn
        res[f"b_{name}_fp"] = fp
    return res


# ---------------------------------------------------------------- rotation
def stroke_windows(y):
    """(onset_frame, end_frame) for each decoded idle->backswing ... recovery->idle cycle."""
    on = np.flatnonzero((y[1:] == 1) & (y[:-1] == 0)) + 1
    off = np.flatnonzero((y[1:] == 0) & (y[:-1] != 0)) + 1
    w = []
    for o in on:
        e = off[off > o]
        if len(e):
            w.append((int(o), int(e[0])))
    return w


ROT_FEATS = ["psi", "psi_min", "psi_max", "tau", "elev", "face_tilt", "gyr_mag", "lin_mag",
             "radius", "acc_x", "acc_y", "acc_z", "ph1", "ph2", "ph3", "ph4"]


def rotation_rows(sess, y_seg, oracle=False):
    """Per-frame rows inside each decoded stroke. Target: trunk yaw change since onset."""
    ch, c = sess["ch"], sess["centres"]
    cl = sess["clean"]
    if oracle:  # a perfect racket sensor: exact pose, exact forces, no noise
        from scipy.spatial.transform import Rotation as Rot
        R = cl["R_s"]
        x_w, z_w = R.apply([1.0, 0, 0]), R.apply([0, 0, 1.0])
        yaw_inc = cl["alpha"]
        elev = np.rad2deg(np.arcsin(x_w[:, 2]))
        face = np.rad2deg(np.arcsin(z_w[:, 2]))
        gm = np.rad2deg(np.linalg.norm(cl["gyr"], axis=1))
        lin = np.linalg.norm(R.apply(cl["acc"]) - [0, 0, G], axis=1) / G
        acc = cl["acc"] / G
    else:
        yaw_inc = np.cumsum(ch["yaw_rate"]) / FS     # integrated heading-free yaw
        elev, face, gm, lin = ch["elev"], ch["face_tilt"], ch["gyr_mag"], ch["lin_mag"]
        acc = np.stack([ch["acc_x"], ch["acc_y"], ch["acc_z"]], 1)
    trunk = cl["ang_trunk"]
    rows, target, stroke_ref = [], [], []
    for k, (o, e) in enumerate(stroke_windows(y_seg)):
        so, se = c[o], c[min(e, len(c) - 1)]
        idx = c[o:e]
        psi = yaw_inc[idx] - yaw_inc[so]
        w = np.deg2rad(gm[idx])
        radius = np.clip(lin[idx] * G / (w ** 2 + 4.0), 0, 3)  # centripetal a = w^2 r
        ph = np.eye(5)[y_seg[o:e]][:, 1:]
        tau = (idx - so) / FS
        X = np.column_stack([psi, np.minimum.accumulate(psi), np.maximum.accumulate(psi), tau,
                             elev[idx], face[idx], gm[idx], lin[idx], radius, acc[idx], ph])
        rows.append(X)
        target.append(trunk[idx] - trunk[so])
        stroke_ref.append(np.full(len(idx), k))
    if not rows:
        return np.zeros((0, len(ROT_FEATS))), np.zeros(0), np.zeros(0, int)
    return np.vstack(rows), np.concatenate(target), np.concatenate(stroke_ref)


def rot_metrics(yt, yp, sid):
    rmse = float(np.sqrt(np.mean((yt - yp) ** 2)))
    peak_err = [abs(yp[sid == s].min() - yt[sid == s].min()) for s in np.unique(sid)]
    r = float(np.corrcoef(yt, yp)[0, 1]) if len(yt) > 2 else np.nan
    return dict(rmse=rmse, peak_coil_mae=float(np.mean(peak_err)), r=r)


# ---------------------------------------------------------------- main loop
def run(seed=7, robustness_rates=(0.0, 0.05, 0.1, 0.2, 0.3), log_every=1):
    players, data = make_dataset(seed)
    log("dataset ready:", len(data), "sessions,", sum(len(d["y"]) for d in data), "frames")
    names = data[0]["names"]
    results = dict(folds=[], names=names, players=[vars(p) for p in players])
    excerpts = {}
    for p in players:
        tr = [d for d in data if d["pid"] != p.pid]
        te = [d for d in data if d["pid"] == p.pid]
        Xtr = np.vstack([d["X"][::2] for d in tr])
        ytr = np.concatenate([d["y"][::2] for d in tr])
        lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=400, C=1.0))
        lr.fit(Xtr, ytr)
        hgb = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.1,
                                             max_leaf_nodes=31, random_state=0)
        hgb.fit(Xtr, ytr)
        hmm = PhaseHMM().fit([d["y"] for d in tr])
        fold = dict(pid=p.pid, sessions=[])

        # --- rotation models (trained on true segmentation of training players)
        rx, ry, rxo, ryo = [], [], [], []
        for d in tr:
            a, b, _ = rotation_rows(d, d["y"]); rx.append(a); ry.append(b)
            a, b, _ = rotation_rows(d, d["y"], oracle=True); rxo.append(a); ryo.append(b)
        rx, ry, rxo, ryo = np.vstack(rx), np.concatenate(ry), np.vstack(rxo), np.concatenate(ryo)
        k_share = float(np.sum(rx[:, 0] * ry) / np.sum(rx[:, 0] ** 2))
        reg = HistGradientBoostingRegressor(max_iter=200, random_state=0).fit(rx[::2], ry[::2])
        reg_o = HistGradientBoostingRegressor(max_iter=200, random_state=0).fit(rxo[::2], ryo[::2])

        rot_pred = dict(true=[], proxy=[], hgb=[], oracle=[], sid=[], sess=[])
        for d in te:
            P_lr, P_hgb = lr.predict_proba(d["X"]), hgb.predict_proba(d["X"])
            preds = {"LR": P_lr.argmax(1), "HGB": P_hgb.argmax(1),
                     "LR+HMM": hmm.decode(P_lr, d["missing"]),
                     "HGB+HMM": hmm.decode(P_hgb, d["missing"])}
            sres = dict(sess=d["sess"])
            for m, yp in preds.items():
                sres[m] = dict(**frame_scores(d["y"], yp), **event_scores(d, yp))
            fold["sessions"].append(sres)
            if p.pid == 0 and d["sess"] == 0:
                excerpts = dict(y=d["y"].tolist(), **{m: v.tolist() for m, v in preds.items()})
            # rotation, end-to-end on the HGB+HMM segmentation
            Xr, yr, sid = rotation_rows(d, preds["HGB+HMM"])
            Xo, yo, sido = rotation_rows(d, preds["HGB+HMM"], oracle=True)
            rot_pred["true"].append(yr); rot_pred["proxy"].append(k_share * Xr[:, 0])
            rot_pred["hgb"].append(reg.predict(Xr)); rot_pred["oracle"].append(reg_o.predict(Xo))
            rot_pred["sid"].append(sid + 1000 * d["sess"]); rot_pred["sess"].append(np.full(len(yr), d["sess"]))
        rp = {k: np.concatenate(v) for k, v in rot_pred.items()}
        rot = {m: rot_metrics(rp["true"], rp[m], rp["sid"]) for m in ["proxy", "hgb", "oracle"]}
        # per-player calibration: 5 strokes with ground truth (e.g. a short video/mocap clip)
        strokes = np.unique(rp["sid"])
        cal = np.isin(rp["sid"], strokes[:5])
        ev = ~cal
        for m in ["proxy", "hgb"]:
            A = np.column_stack([rp[m][cal], np.ones(cal.sum())])
            coef = np.linalg.lstsq(A, rp["true"][cal], rcond=None)[0]
            yc = coef[0] * rp[m] + coef[1]
            rot[m + "_cal5"] = rot_metrics(rp["true"][ev], yc[ev], rp["sid"][ev])
        rot["k_share"] = k_share
        rot["true_share"] = p.coil / (p.coil + p.sh_bs + 5)
        fold["rotation"] = rot
        if p.pid == 0:
            sel = np.isin(rp["sid"], strokes[:4])
            results["rot_excerpt"] = {k: rp[k][sel].tolist() for k in ["true", "proxy", "hgb", "oracle"]}

        # --- robustness to packet loss on this player's sessions
        rob = {}
        for rate in robustness_rates:
            for mode in ["interp", "zero"]:
                sc = {"HGB": [], "HGB+HMM": []}
                for d in te:
                    st = corrupt(d["clean"], np.random.default_rng(int(rate * 1000) + d["sess"]), rate)
                    f = featurise(d["clean"], st, mode)
                    P = hgb.predict_proba(f["X"])
                    sc["HGB"].append(frame_scores(f["y"], P.argmax(1))["macro_f1"])
                    sc["HGB+HMM"].append(frame_scores(f["y"], hmm.decode(P, f["missing"]))["macro_f1"])
                rob[f"{rate}_{mode}"] = {k: float(np.mean(v)) for k, v in sc.items()}
        fold["robustness"] = rob
        results["folds"].append(fold)
        s0 = fold["sessions"][0]
        log(f"player {p.pid:2d}: F1 LR {s0['LR']['macro_f1']:.1f} HGB {s0['HGB']['macro_f1']:.1f} "
            f"HGB+HMM {s0['HGB+HMM']['macro_f1']:.1f} | edit HGB {s0['HGB']['edit']:.1f} "
            f"HGB+HMM {s0['HGB+HMM']['edit']:.1f} | rot RMSE hgb {rot['hgb']['rmse']:.1f} "
            f"oracle {rot['oracle']['rmse']:.1f} cal5 {rot['hgb_cal5']['rmse']:.1f}")
    results["excerpt"] = excerpts
    results["hmm"] = dict(n_states=hmm.n_states, self_p=hmm.self_p, S=int(hmm.S))
    results["feature_importance_names"] = names
    return results


def summarise(res):
    models = ["LR", "HGB", "LR+HMM", "HGB+HMM"]
    out = {}
    for m in models:
        rows = [s[m] for f in res["folds"] for s in f["sessions"]]
        tp = sum(r["contact_tp"] for r in rows); fp = sum(r["contact_fp"] for r in rows)
        fn = sum(r["contact_fn"] for r in rows)
        errs = np.concatenate([r["contact_err_ms"] for r in rows])
        per_player = [np.mean([s[m]["macro_f1"] for s in f["sessions"]]) for f in res["folds"]]
        o = dict(macro_f1=np.mean([r["macro_f1"] for r in rows]),
                 macro_f1_sd_players=float(np.std(per_player)),
                 per_player_f1=per_player,
                 per_class=np.mean([r["per_class"] for r in rows], 0).tolist(),
                 edit=np.mean([r["edit"] for r in rows]),
                 f1_50=np.mean([r["f1_50"] for r in rows]),
                 contact_p=100 * tp / max(tp + fp, 1), contact_r=100 * tp / max(tp + fn, 1),
                 contact_mae_ms=float(errs.mean()) if len(errs) else np.nan,
                 contact_p90_ms=float(np.percentile(errs, 90)) if len(errs) else np.nan)
        o["contact_f1"] = 2 * o["contact_p"] * o["contact_r"] / max(o["contact_p"] + o["contact_r"], 1e-9)
        for b in BOUNDARIES:
            e = np.concatenate([r[f"b_{b}_err_ms"] for r in rows])
            miss = sum(r[f"b_{b}_miss"] for r in rows)
            o[f"b_{b}_mae_ms"] = float(e.mean()) if len(e) else np.nan
            o[f"b_{b}_miss_pct"] = 100 * miss / max(miss + len(e), 1)
        out[m] = {k: (float(v) if isinstance(v, (float, np.floating)) else v) for k, v in o.items()}
    rot = {}
    for m in ["proxy", "hgb", "oracle", "proxy_cal5", "hgb_cal5"]:
        rot[m] = {k: float(np.mean([f["rotation"][m][k] for f in res["folds"]]))
                  for k in ["rmse", "peak_coil_mae", "r"]}
        rot[m]["rmse_per_player"] = [f["rotation"][m]["rmse"] for f in res["folds"]]
    rot["k_share"] = [f["rotation"]["k_share"] for f in res["folds"]]
    rot["true_share"] = [f["rotation"]["true_share"] for f in res["folds"]]
    rob = {}
    for key in res["folds"][0]["robustness"]:
        rob[key] = {m: float(np.mean([f["robustness"][key][m] for f in res["folds"]]))
                    for m in ["HGB", "HGB+HMM"]}
    return dict(phase=out, rotation=rot, robustness=rob)
