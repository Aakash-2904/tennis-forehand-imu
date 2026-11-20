"""Constructive proof that trunk rotation is not identifiable from racket orientation.

Take one simulated forehand (player A). Build player B by moving part of the trunk
rotation into the shoulder: trunk_B = c * trunk_A, shoulder_B = shoulder_A + (1-c) * trunk_A.
Racket heading alpha = trunk + shoulder + wrist is the same at every instant, so the
racket orientation and the gyroscope signal are bit-identical. Only the sensor's linear
acceleration differs, through the changed lever arm. We compare that difference with
(i) sensor noise and (ii) the difference caused by an unknown nuisance parameter
(arm length 0.60 m vs 0.66 m) that the model does not know either.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial.transform import Rotation as Rot

from simulate import FS_SIM, G, Player, build_angles, forward_kinematics, sample_player


def run(seed=3, c=0.6):
    rng = np.random.default_rng(seed)
    p = sample_player(0, rng)
    p.arm_len = 0.60
    t, ang, strokes, _ = build_angles(p, 1, rng, distract=False)
    mount = Rot.identity()
    angB = dict(ang)
    angB["trunk"] = c * ang["trunk"]
    angB["shoulder"] = ang["shoulder"] + (1 - c) * ang["trunk"]
    kA = forward_kinematics(p, ang, mount)
    kB = forward_kinematics(p, angB, mount)
    pL = Player(**{**vars(p), "arm_len": 0.66})
    kL = forward_kinematics(pL, ang, mount)
    st = strokes[0]
    i0, i1 = int(st["onset"] * FS_SIM), int(st["end"] * FS_SIM)
    sl = slice(i0 - 200, i1 + 200)
    gyr_diff = np.rad2deg(np.abs(kA["gyr"][sl] - kB["gyr"][sl]).max())
    dAB = np.linalg.norm(kA["acc"][sl] - kB["acc"][sl], axis=1) / G
    dAL = np.linalg.norm(kA["acc"][sl] - kL["acc"][sl], axis=1) / G
    noise_g = 0.25 * np.sqrt(3) / G  # per-sample accel noise magnitude
    step = FS_SIM // 200
    return dict(
        t=(t[sl][::step] - t[i0]).tolist(),
        trunkA=ang["trunk"][sl][::step].tolist(), trunkB=angB["trunk"][sl][::step].tolist(),
        shA=ang["shoulder"][sl][::step].tolist(), shB=angB["shoulder"][sl][::step].tolist(),
        alphaA=kA["alpha"][sl][::step].tolist(), alphaB=kB["alpha"][sl][::step].tolist(),
        gyrA=np.rad2deg(np.linalg.norm(kA["gyr"][sl], axis=1))[::step].tolist(),
        gyrB=np.rad2deg(np.linalg.norm(kB["gyr"][sl], axis=1))[::step].tolist(),
        dAB=dAB[::step].tolist(), dAL=dAL[::step].tolist(), noise_g=noise_g,
        gyr_max_diff_dps=float(gyr_diff),
        dAB_rms=float(np.sqrt(np.mean(dAB ** 2))), dAL_rms=float(np.sqrt(np.mean(dAL ** 2))),
        peak_trunk_A=float(ang["trunk"][sl].min()), peak_trunk_B=float(angB["trunk"][sl].min()),
        c=c,
    )
