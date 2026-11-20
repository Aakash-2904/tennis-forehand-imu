"""Resampling, gap handling and frame features for the racket IMU stream."""
from __future__ import annotations

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.spatial.transform import Rotation as Rot

from simulate import FS, G, ACC_RANGE, GYR_RANGE

HOP = 2              # one feature frame every 2 samples -> 100 Hz frames
MAX_INTERP_GAP = 10  # samples (50 ms): shorter gaps are interpolated, longer ones masked


def resample(stream: dict, n_grid: int, max_gap: int = MAX_INTERP_GAP, mode: str = "interp"):
    """Put received samples back on a uniform 200 Hz grid.

    mode="interp": linear interpolation (quaternion nlerp with sign continuity),
                   gaps longer than max_gap flagged in `missing`.
    mode="zero":   naive handling - missing samples left as zeros, no flag (ablation).
    """
    t = stream["t"]
    grid = np.arange(n_grid) / FS
    idx = np.clip(np.round(t * FS).astype(int), 0, n_grid - 1)
    have = np.zeros(n_grid, bool)
    have[idx] = True
    # length of the gap each grid point sits in
    gap_len = np.zeros(n_grid, int)
    i = 0
    while i < n_grid:
        if not have[i]:
            j = i
            while j < n_grid and not have[j]:
                j += 1
            gap_len[i:j] = j - i
            i = j
        else:
            i += 1
    q = stream["quat"].copy()
    flip = np.cumsum(np.r_[False, np.sum(q[1:] * q[:-1], 1) < 0]) % 2 == 1
    q[flip] *= -1
    out = {}
    if mode == "zero":
        for k, v in [("acc", stream["acc"]), ("gyr", stream["gyr"]), ("quat", q)]:
            a = np.zeros((n_grid, v.shape[1]))
            a[idx] = v
            if k == "quat":
                a[~have] = [0, 0, 0, 1]
            out[k] = a
        out["missing"] = np.zeros(n_grid, bool)
    else:
        for k, v in [("acc", stream["acc"]), ("gyr", stream["gyr"]), ("quat", q)]:
            out[k] = np.stack([np.interp(grid, t, v[:, c]) for c in range(v.shape[1])], 1)
        out["quat"] /= np.linalg.norm(out["quat"], axis=1, keepdims=True)
        out["missing"] = gap_len > max_gap
    out["gap"] = ~have
    out["sat"] = (np.abs(out["acc"]) >= ACC_RANGE * 0.995).any(1) | \
                 (np.abs(out["gyr"]) >= GYR_RANGE * 0.995).any(1)
    return out


def base_channels(r: dict):
    """Per-sample physical channels that do not depend on absolute heading."""
    R = Rot.from_quat(r["quat"])
    acc, gyr = r["acc"], r["gyr"]
    f_w = R.apply(acc)                       # specific force in world frame
    lin_w = f_w - np.array([0, 0, G])        # gravity removed (contaminated by AHRS tilt error)
    w_w = R.apply(gyr)                       # angular velocity in world frame
    x_w = R.apply([1.0, 0, 0])               # handle->tip axis
    z_w = R.apply([0, 0, 1.0])               # face normal
    gyr_dps = np.rad2deg(gyr)
    ch = {
        "gyr_mag": np.linalg.norm(gyr_dps, axis=1),
        "gyr_x": gyr_dps[:, 0], "gyr_y": gyr_dps[:, 1], "gyr_z": gyr_dps[:, 2],
        "yaw_rate": np.rad2deg(w_w[:, 2]),   # rotation about gravity: heading-free
        "acc_mag": np.linalg.norm(acc, axis=1) / G,
        "acc_x": acc[:, 0] / G, "acc_y": acc[:, 1] / G, "acc_z": acc[:, 2] / G,
        "lin_mag": np.linalg.norm(lin_w, axis=1) / G,
        "lin_vert": lin_w[:, 2] / G,
        "elev": np.rad2deg(np.arcsin(np.clip(x_w[:, 2], -1, 1))),  # tip elevation
        "face_tilt": np.rad2deg(np.arcsin(np.clip(z_w[:, 2], -1, 1))),  # face open/closed vs gravity
        "jerk": np.r_[0, np.linalg.norm(np.diff(acc, axis=0), axis=1)] / G,  # impact energy
        "sat": r["sat"].astype(float),
        "missing": r["missing"].astype(float),
    }
    return ch


def _roll_mean(x, w):
    return uniform_filter1d(x, size=w, mode="nearest")


def frame_features(ch: dict):
    """Multi-scale windowed statistics, sampled every HOP samples (100 Hz frames).

    Windows are centred (offline analysis). A causal variant just shifts them.
    """
    n = len(ch["gyr_mag"])
    centres = np.arange(0, n, HOP)
    feats, names = [], []

    def add(name, x):
        feats.append(x[centres]); names.append(name)

    for k in ["gyr_mag", "yaw_rate", "acc_mag", "lin_mag", "lin_vert", "elev", "face_tilt",
              "gyr_x", "gyr_y", "gyr_z", "acc_x", "acc_y", "acc_z"]:
        add(k, ch[k])
    for w in (5, 21, 61):  # 25 ms, 105 ms, 305 ms
        for k in ["gyr_mag", "yaw_rate", "acc_mag", "elev", "face_tilt", "jerk"]:
            m = _roll_mean(ch[k], w)
            sd = np.sqrt(np.maximum(_roll_mean(ch[k] ** 2, w) - m ** 2, 0))
            add(f"{k}_m{w}", m); add(f"{k}_s{w}", sd)
    # direction of change: past vs future 150 ms (captures where in the swing we are)
    h = 30
    for k in ["yaw_rate", "elev", "gyr_mag", "face_tilt"]:
        m = _roll_mean(ch[k], h)
        past = np.r_[np.full(h // 2, m[0]), m[:-h // 2]]
        fut = np.r_[m[h // 2:], np.full(h // 2, m[-1])]
        add(f"{k}_past", past); add(f"{k}_fut", fut)
    # heading change over the past / next 300 ms from integrating yaw rate (drift-free on that scale)
    yaw = np.cumsum(ch["yaw_rate"]) / FS
    L = 60
    add("dyaw_past", yaw - np.r_[np.full(L, yaw[0]), yaw[:-L]])
    add("dyaw_fut", np.r_[yaw[L:], np.full(L, yaw[-1])] - yaw)
    add("sat_frac", _roll_mean(ch["sat"], 21))
    miss = _roll_mean(ch["missing"], 5)
    X = np.stack(feats, 1).astype(np.float32)
    return X, names, centres, miss[centres] > 0.5


def session_features(stream, n_grid, mode="interp"):
    r = resample(stream, n_grid, mode=mode)
    ch = base_channels(r)
    X, names, centres, miss = frame_features(ch)
    return dict(X=X, names=names, centres=centres, missing=miss, ch=ch, r=r)
