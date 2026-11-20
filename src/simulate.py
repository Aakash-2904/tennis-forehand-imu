"""Physics-based simulator of a racket-butt IMU during forehand drills.

No public dataset pairs racket IMU streams with body kinematics and phase labels,
so the first experiment runs on simulated data with known ground truth.
The simulator is a kinematic chain:

    trunk yaw (theta_t) -> shoulder horizontal rotation (theta_s) -> arm elevation
    -> wrist lag (theta_w) -> racket elevation / roll -> rigid racket -> IMU at butt cap

Racket heading is alpha = theta_t + theta_s + theta_w. The racket orientation only
sees the sum. Only the lever-arm effect on the sensor's linear acceleration carries
any information about how that sum is split, and that information is weak.
This is the identifiability problem the experiment is about.

World frame: x toward the net, y to the player's left, z up. Right-handed player.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.signal import butter, filtfilt
from scipy.spatial.transform import Rotation as Rot

FS = 200            # sensor output rate (Hz), typical of racket-butt sensors
FS_SIM = 1000       # internal kinematics rate (Hz)
G = 9.81
PHASES = ["idle/ready", "backswing", "forward swing", "follow-through", "recovery"]
SENSOR_OFFSET = 0.12   # m from the hand down the handle to the butt-cap sensor
HEAD_OFFSET = 0.45     # m from the hand to the centre of the string bed
ACC_RANGE = 16 * G     # +-16 g accelerometer
GYR_RANGE = np.deg2rad(2000)  # +-2000 dps gyroscope

# Racket frame at alpha = 0: long axis (x_r) points along -y, face normal (z_r) along +x.
_B = np.array([[0.0, 0.0, 1.0],
               [-1.0, 0.0, 0.0],
               [0.0, -1.0, 0.0]])


@dataclass
class Player:
    pid: int
    coil: float          # trunk yaw at end of backswing (deg, turned away)
    trunk_contact: float # trunk yaw at contact (deg)
    trunk_ft: float      # trunk yaw at end of follow-through (deg)
    sh_bs: float         # shoulder horizontal rotation at end of backswing (deg)
    sh_ft: float         # shoulder rotation across the body at finish (deg)
    wrist_lag: float     # peak wrist lag during forward swing (deg)
    arm_len: float       # shoulder-to-hand length (m)
    tempo: float         # multiplier on backswing / follow-through / recovery durations
    fwd_dur: float       # forward-swing duration (s)
    grip_roll: float     # constant face roll from grip (deg), eastern ~0, semi-western ~+20
    ft_high: float       # arm elevation at finish (deg)
    lead: float          # trunk leads the racket by this much (s), kinetic chain


def sample_player(pid: int, rng: np.random.Generator) -> Player:
    """Players differ mainly in how they split racket rotation between trunk and arm."""
    return Player(
        pid=pid,
        coil=rng.uniform(55, 105),
        trunk_contact=rng.uniform(-5, 10),
        trunk_ft=rng.uniform(40, 80),
        sh_bs=rng.uniform(5, 35),
        sh_ft=rng.uniform(35, 75),
        wrist_lag=rng.uniform(8, 28),
        arm_len=rng.uniform(0.55, 0.70),
        tempo=rng.uniform(0.8, 1.25),
        fwd_dur=rng.uniform(0.10, 0.15),
        grip_roll=rng.uniform(-15, 25),
        ft_high=rng.uniform(20, 60),
        lead=rng.uniform(0.03, 0.08),
    )


def _lowpass(x, fc, fs, order=4):
    b, a = butter(order, fc / (fs / 2))
    return filtfilt(b, a, x, axis=0)


def stroke_knots(p: Player, T0: float, rng: np.random.Generator, jitter=0.07):
    """Keyframes (time, deg) per joint for one forehand starting at T0."""
    # rally balls vary: some strokes are hit harder (bigger, faster swings) than others
    intensity = rng.uniform(0.75, 1.1)
    j = lambda v: intensity * v * (1 + jitter * rng.standard_normal())
    ready = rng.uniform(0.35, 0.8)
    bs = 0.6 * p.tempo * (1 + 0.08 * rng.standard_normal())
    fwd = p.fwd_dur / np.sqrt(intensity) * (1 + 0.06 * rng.standard_normal())
    ft = 0.32 * p.tempo * (1 + 0.08 * rng.standard_normal())
    rec = 0.55 * p.tempo * (1 + 0.10 * rng.standard_normal())
    t1 = T0 + ready
    t2 = t1 + bs
    t3 = t2 + fwd
    t4 = t3 + ft
    t5 = t4 + rec
    L = p.lead
    fth = j(p.ft_high)
    k = {
        "trunk": [(T0, 0), (t1, 0), (t2 - L, -j(p.coil)), (t3 - 0.5 * L, j(p.trunk_contact)),
                  (t4 - 0.5 * L, j(p.trunk_ft)), (t5, 0)],
        "shoulder": [(T0, 0), (t1, 0), (t2 - 0.4 * L, -j(p.sh_bs)), (t3, 5),
                     (t4, j(p.sh_ft)), (t5, 0)],
        "wrist": [(T0, 0), (t1, 0), (t2, -5), (t2 + 0.6 * fwd, -j(p.wrist_lag)),
                  (t3, -0.3 * p.wrist_lag), (t4, 15), (t5, 0)],
        "arm_elev": [(T0, -40), (t1, -40), (t2, -25), (t3, -30), (t4, fth), (t5, -40)],
        "rk_elev": [(T0, 35), (t1, 35), (t2, 25), (t2 + 0.6 * fwd, -25), (t3, -5),
                    (t4, fth + 30), (t5, 35)],
        "roll": [(T0, 0), (t1, 0), (t2, -25), (t3, 0), (t4, 70), (t5, 0)],
    }
    times = dict(T0=T0, onset=t1, contact=t3, end=t5, t2=t2, t4=t4)
    return k, times


REST = {"trunk": 0, "shoulder": 0, "wrist": 0, "arm_elev": -40, "rk_elev": 35, "roll": 0}


def _distractor(kind, t0, dur, t):
    """Additive joint offsets (deg) for idle-time racket handling, labelled idle."""
    u = np.clip((t - t0) / dur, 0, 1)
    w = np.sin(np.pi * u) ** 2  # smooth on/off window
    if kind == "twirl":      # spinning the racket in the hand
        return {"roll": 360 * (u - np.sin(2 * np.pi * u) / (2 * np.pi))}
    if kind == "bounce":     # bouncing a ball on the strings
        return {"arm_elev": 6 * w * np.sin(2 * np.pi * 2.5 * (t - t0)),
                "rk_elev": -30 * w + 4 * w * np.sin(2 * np.pi * 2.5 * (t - t0))}
    if kind == "shadow":     # small aborted half-swing / repositioning
        return {"trunk": -25 * w, "shoulder": -10 * w}
    return {}


def build_angles(p: Player, n_strokes: int, rng: np.random.Generator, distract=True):
    """Dense (1 kHz) joint-angle trajectories for a drill session, in degrees."""
    knots = {j: [] for j in REST}
    strokes, distractors = [], []
    T = 1.0
    for s in range(n_strokes):
        k, times = stroke_knots(p, T, rng)
        for jn in knots:
            knots[jn].extend(k[jn])
        strokes.append(times)
        idle = rng.uniform(0.6, 2.6)
        if distract and idle > 1.4 and rng.random() < 0.45:
            kind = rng.choice(["twirl", "bounce", "shadow"])
            dur = {"twirl": 0.5, "bounce": 1.0, "shadow": 0.8}[kind]
            distractors.append((kind, times["end"] + 0.2, dur))
        T = times["end"] + idle
    T_end = T + 0.5
    for jn in knots:
        knots[jn] = [(0.0, REST[jn])] + knots[jn] + [(T_end, REST[jn])]

    n = int(T_end * FS_SIM)
    t = np.arange(n) / FS_SIM
    ang = {}
    for jn, kv in knots.items():
        tt, vv = np.array(kv).T
        ang[jn] = PchipInterpolator(tt, vv)(t)
    for kind, t0, dur in distractors:
        for jn, add in _distractor(kind, t0, dur, t).items():
            ang[jn] = ang[jn] + add
    # postural sway, then smooth to human-motion bandwidth
    for jn, amp in [("trunk", 2.0), ("arm_elev", 2.0), ("rk_elev", 2.5), ("roll", 3.0)]:
        sway = _lowpass(rng.standard_normal(n), 0.6, FS_SIM, order=2)
        ang[jn] = ang[jn] + amp * sway / (sway.std() + 1e-9)
    for jn in ang:
        ang[jn] = _lowpass(ang[jn], 20, FS_SIM)
    return t, ang, strokes, distractors


def simulate_session(p: Player, n_strokes: int, rng: np.random.Generator,
                     mount_deg: float = 3.0, distract=True):
    """Clean (noise-free) session: kinematics, ideal IMU signals and ground truth."""
    t, ang, strokes, distractors = build_angles(p, n_strokes, rng, distract)
    n = len(t)
    mount = Rot.from_rotvec(np.deg2rad(mount_deg) * rng.standard_normal(3))
    kin = forward_kinematics(p, ang, mount)

    # downsample to the sensor rate
    step = FS_SIM // FS
    idx = np.arange(0, n, step)
    out = {k: v[idx] for k, v in kin.items() if k != "R_s"}
    out["R_s"] = kin["R_s"][idx]
    out["t"] = t[idx]
    for jn in ang:
        out["ang_" + jn] = ang[jn][idx]
    out["mount"] = mount
    out["player"] = asdict(p)

    # ground-truth labels defined kinematically (as one would from mocap)
    N = len(idx)
    label = np.zeros(N, dtype=np.int8)
    stroke_id = -np.ones(N, dtype=np.int32)
    alpha = out["alpha"]
    gt_strokes = []
    for si, st in enumerate(strokes):
        i1 = int(round(st["onset"] * FS))
        i3 = int(round(st["contact"] * FS))
        i5 = int(round(st["end"] * FS))
        ib = i1 + int(np.argmin(alpha[i1:i3]))          # racket reversal
        i4 = i3 + int(np.argmax(alpha[i3:i5]))          # end of follow-through
        label[i1:ib] = 1
        label[ib:i3] = 2
        label[i3:i4] = 3
        label[i4:i5] = 4
        stroke_id[i1:i5] = si
        gt_strokes.append(dict(onset=i1, reversal=ib, contact=i3, ft_end=i4, end=i5))
    out["label"] = label
    out["stroke_id"] = stroke_id
    out["strokes"] = gt_strokes
    out["distractors"] = distractors
    return out


def forward_kinematics(p: Player, ang: dict, mount: Rot):
    d = {k: np.deg2rad(v) for k, v in ang.items()}
    th_t, th_s, th_w = d["trunk"], d["shoulder"], d["wrist"]
    ea, er, beta = d["arm_elev"], d["rk_elev"], d["roll"] + np.deg2rad(p.grip_roll)
    n = len(th_t)
    S = np.stack([0.2 * np.sin(th_t), -0.2 * np.cos(th_t), np.full(n, 1.45)], 1)
    phi = th_t + th_s
    u_arm = np.stack([np.cos(ea) * np.sin(phi), -np.cos(ea) * np.cos(phi), np.sin(ea)], 1)
    H = S + p.arm_len * u_arm
    alpha = th_t + th_s + th_w
    ez, ex = np.array([0, 0, 1.0]), np.array([1.0, 0, 0])
    R_rk = (Rot.from_rotvec(np.outer(alpha, ez)) * Rot.from_rotvec(np.outer(-er, ex))
            * Rot.from_matrix(_B) * Rot.from_rotvec(np.outer(beta, ex)))
    x_r = R_rk.apply(ex)
    P = H - SENSOR_OFFSET * x_r
    head = H + HEAD_OFFSET * x_r
    R_s = R_rk * mount
    dt = 1.0 / FS_SIM
    acc_w = np.gradient(np.gradient(P, dt, axis=0), dt, axis=0)
    f_w = acc_w + np.array([0, 0, G])
    f_b = R_s.inv().apply(f_w)
    rv = (R_s[:-2].inv() * R_s[2:]).as_rotvec() / (2 * dt)
    gyr = np.vstack([rv[:1], rv, rv[-1:]])
    head_speed = np.linalg.norm(np.gradient(head, dt, axis=0), axis=1)
    return dict(acc=f_b, gyr=gyr, R_s=R_s, alpha=np.rad2deg(alpha), pos=P,
                head_speed=head_speed, hand=H)


def corrupt(clean: dict, rng: np.random.Generator, drop_rate: float = 0.04,
            long_gaps: bool = True, impact: bool = True):
    """Turn a clean session into what a BLE racket sensor would actually deliver.

    Adds impact shock and ringing, sensor noise and bias, saturation, AHRS heading
    drift and dynamic tilt error, timestamp jitter, and bursty packet loss.
    Returns only the samples that were received (irregular timestamps).
    """
    acc = clean["acc"].copy()
    gyr = clean["gyr"].copy()
    N = len(acc)
    mount = clean["mount"]
    if impact:
        normal_s = mount.inv().apply([0, 0, 1.0])
        long_s = mount.inv().apply([1.0, 0, 0])
        for st in clean["strokes"]:
            c = st["contact"]
            A = rng.uniform(15, 35) * G
            off = rng.normal(0, 0.025)  # off-centre hit (m) -> twist about long axis
            for k in range(8):
                if c + k >= N:
                    break
                ring = np.exp(-k / 1.5) * np.cos(2 * np.pi * 0.42 * k)
                acc[c + k] += -A * ring * normal_s
                gyr[c + k] += np.deg2rad(400) * (off / 0.025) * ring * long_s
    # sensor errors
    g_bias = np.deg2rad(1.5) * rng.standard_normal(3)
    g_walk = np.cumsum(np.deg2rad(0.02) * rng.standard_normal((N, 3)), 0)
    gyr = gyr * (1 + 0.01 * rng.standard_normal(3)) + g_bias + g_walk \
        + np.deg2rad(0.8) * rng.standard_normal((N, 3))
    acc = acc * (1 + 0.01 * rng.standard_normal(3)) + 0.03 * G * rng.standard_normal(3) \
        + 0.25 * rng.standard_normal((N, 3))
    acc = np.clip(acc, -ACC_RANGE, ACC_RANGE)
    gyr = np.clip(gyr, -GYR_RANGE, GYR_RANGE)

    # on-board 6-axis AHRS: unknown heading offset, heading drift, tilt error under load
    dt = 1.0 / FS
    psi = rng.uniform(0, 2 * np.pi) + np.deg2rad(rng.normal(0, 0.5)) * clean["t"] \
        + np.cumsum(np.deg2rad(0.3) * np.sqrt(dt) * rng.standard_normal(N))
    lin = np.abs(np.linalg.norm(clean["acc"], axis=1) - G) / G
    b, a = butter(1, 1.0 / (FS / 2))
    from scipy.signal import lfilter
    tilt = np.deg2rad(0.6) * lfilter(b, a, lin)  # causal lag, like a complementary filter
    tilt_axis = rng.uniform(0, 2 * np.pi)
    ax = np.stack([np.cos(tilt_axis) * np.ones(N), np.sin(tilt_axis) * np.ones(N), np.zeros(N)], 1)
    R_rep = Rot.from_rotvec(np.outer(psi, [0, 0, 1.0])) * Rot.from_rotvec(ax * tilt[:, None]) \
        * clean["R_s"]
    q = R_rep.as_quat()  # x, y, z, w

    # timestamps: clock skew + jitter
    t = clean["t"] * (1 + 50e-6 * rng.standard_normal()) + 0.0003 * rng.standard_normal(N)

    # bursty BLE packet loss (Gilbert-Elliott), 4 samples per packet
    keep = np.ones(N, bool)
    pkt = 4
    n_pkt = int(np.ceil(N / pkt))
    if drop_rate > 0:
        p_bg = 1 / 2.0
        p_gb = drop_rate * p_bg / (1 - drop_rate)
        bad = False
        for i in range(n_pkt):
            bad = (rng.random() < (1 - p_bg)) if bad else (rng.random() < p_gb)
            if bad:
                keep[i * pkt:(i + 1) * pkt] = False
    if long_gaps:
        for _ in range(rng.poisson(1.0)):
            s0 = rng.integers(0, N)
            keep[s0:s0 + int(rng.uniform(0.15, 0.4) * FS)] = False
    return dict(t=t[keep], acc=acc[keep], gyr=gyr[keep], quat=q[keep], n_grid=N,
                received_frac=keep.mean())
