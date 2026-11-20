"""Export the simulated dataset (seed 7, same as run_all.py) to plain files in data/.

    py -3.11 export_dataset.py

Re-runs the exact random-number sequence of src/experiment.make_dataset(7), but one
session at a time, appending to gzipped CSVs so memory stays low.
Writes data/raw_imu.csv.gz, data/labels.csv.gz, data/frame_features.csv.gz, data/players.csv.
"""
import gzip
import sys
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))

from simulate import FS, G, sample_player, simulate_session, corrupt  # noqa: E402
from features import session_features  # noqa: E402
import experiment as E  # noqa: E402

SEED = 7
OUT = ROOT / "data"
FMT = "%.7g"


def append(df, path, first):
    with gzip.open(path, "wt" if first else "at", newline="") as fh:
        df.to_csv(fh, index=False, header=first, float_format=FMT)


def f32(x):
    return np.asarray(x, dtype=np.float32)


def main():
    OUT.mkdir(exist_ok=True)
    paths = {k: OUT / f"{k}.csv.gz" for k in ["raw_imu", "labels", "frame_features"]}
    rows = {k: 0 for k in paths}
    rng = np.random.default_rng(SEED)
    players = [sample_player(i, rng) for i in range(E.N_PLAYERS)]
    pd.DataFrame([asdict(p) for p in players]).rename(columns={"pid": "player"}).to_csv(
        OUT / "players.csv", index=False, float_format="%.4f")
    first = True
    for p in players:
        for s in range(E.SESSIONS):
            t0 = time.time()
            # identical RNG chain to experiment.make_dataset
            srng = np.random.default_rng(SEED * 1000 + p.pid * 10 + s)
            clean = simulate_session(p, E.STROKES, srng)
            stream = corrupt(clean, np.random.default_rng(srng.integers(1 << 30)), E.DROP_DEFAULT)
            f = session_features(stream, len(clean["t"]))
            y = clean["label"][f["centres"]].astype(int)

            # 1. raw stream: only the samples that arrived, irregular timestamps
            t = stream["t"]
            lost = np.r_[0, np.maximum(np.round(np.diff(t) * FS).astype(int) - 1, 0)]
            raw = pd.DataFrame({"player": p.pid, "session": s, "t": t})
            for i, a in enumerate("xyz"):
                raw[f"acc_{a}"] = f32(stream["acc"][:, i] / G)
            for i, a in enumerate("xyz"):
                raw[f"gyr_{a}"] = f32(np.rad2deg(stream["gyr"][:, i]))
            for i, a in enumerate("xyzw"):
                raw[f"quat_{a}"] = f32(stream["quat"][:, i])
            raw["lost_before"] = lost
            append(raw, paths["raw_imu"], first)

            # 2. ground truth on the clean 200 Hz grid
            n = len(clean["t"])
            q = clean["R_s"].as_quat()
            lab = pd.DataFrame({"player": p.pid, "session": s, "sample": np.arange(n),
                                "t": clean["t"], "phase": clean["label"].astype(int),
                                "stroke_id": clean["stroke_id"],
                                "trunk_angle_deg": f32(clean["ang_trunk"]),
                                "shoulder_angle_deg": f32(clean["ang_shoulder"]),
                                "wrist_angle_deg": f32(clean["ang_wrist"]),
                                "racket_heading_deg": f32(clean["alpha"]),
                                "head_speed_ms": f32(clean["head_speed"])})
            for i, a in enumerate("xyz"):
                lab[f"clean_acc_{a}"] = f32(clean["acc"][:, i] / G)
            for i, a in enumerate("xyz"):
                lab[f"clean_gyr_{a}"] = f32(np.rad2deg(clean["gyr"][:, i]))
            for i, a in enumerate("xyzw"):
                lab[f"clean_quat_{a}"] = f32(q[:, i])
            append(lab, paths["labels"], first)

            # 3. the 60 model features per 10 ms frame
            c = f["centres"]
            ff = pd.DataFrame({"player": p.pid, "session": s, "frame": np.arange(len(c)),
                               "sample": c, "t": c / FS, "phase": y,
                               "missing": f["missing"].astype(int)})
            ff = pd.concat([ff, pd.DataFrame(f["X"], columns=f["names"])], axis=1)
            append(ff, paths["frame_features"], first)

            rows["raw_imu"] += len(raw); rows["labels"] += len(lab); rows["frame_features"] += len(ff)
            print(f"player {p.pid:2d} session {s}: {len(raw)} raw / {n} grid / {len(ff)} frames "
                  f"({100 * stream['received_frac']:.1f}% received) {time.time() - t0:.1f}s", flush=True)
            first = False
            del clean, stream, f, raw, lab, ff
    for k, pth in paths.items():
        print(f"{pth.name}: {rows[k]} rows, {pth.stat().st_size / 1e6:.1f} MB")
    print(f"players.csv: {len(players)} rows")


if __name__ == "__main__":
    main()
