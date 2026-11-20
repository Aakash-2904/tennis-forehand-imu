"""Render site/index.html from site/template.html and results/summary.json."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
S = json.load(open(ROOT / "results" / "summary.json"))
ph, rot, rob, ni = S["phase"], S["rotation"], S["robustness"], S["nonident"]
best = "HGB+HMM"
f = lambda x, d=1: f"{x:.{d}f}"

rows = []
names = {"LR": "LogReg, frame-wise (baseline)", "HGB": "GBoost, frame-wise",
         "LR+HMM": "LogReg + HMM", "HGB+HMM": "GBoost + HMM"}
for m in ["LR", "HGB", "LR+HMM", "HGB+HMM"]:
    r = ph[m]
    rows.append(f'<tr{" class=best" if m == best else ""}><td>{names[m]}</td><td class="n">{f(r["macro_f1"])}</td>'
                f'<td class="n">{f(r["macro_f1_sd_players"])}</td><td class="n">{f(r["edit"])}</td><td class="n">{f(r["f1_50"])}</td>'
                f'<td class="n">{f(r["contact_p"])} / {f(r["contact_r"])}</td><td class="n">{f(r["contact_mae_ms"])} ms</td>'
                f'<td class="n">{f(r["b_onset_mae_ms"], 0)} ms</td><td class="n">{f(r["b_reversal_mae_ms"], 0)} ms</td></tr>')
rrows = []
rn = [("proxy", "k × racket yaw"), ("hgb", "GBoost regressor"), ("oracle", "GBoost, perfect sensor"),
      ("proxy_cal5", "proxy + 5 GT strokes"), ("hgb_cal5", "GBoost + 5 GT strokes")]
for m, n in rn:
    r = rot[m]
    rrows.append(f'<tr{" class=best" if m == "hgb_cal5" else ""}><td>{n}</td><td class="n">{f(r["rmse"])}°</td>'
                 f'<td class="n">{f(r["peak_coil_mae"])}°</td><td class="n">{f(r["r"], 2)}</td></tr>')
vals = {
    "fwd_ms": "125", "hmm_f1": f(ph[best]["macro_f1"]), "contact_r": f(ph[best]["contact_r"]),
    "contact_mae": f(ph[best]["contact_mae_ms"]), "rot_rmse": f(rot["hgb"]["rmse"]), "rot_oracle": f(rot["oracle"]["rmse"]),
    "rot_cal": f(rot["hgb_cal5"]["rmse"]), "ni_delta": f(ni["peak_trunk_B"] - ni["peak_trunk_A"], 0),
    "ni_gyr": f"{ni['gyr_max_diff_dps']:.0e}", "ni_a": f(ni["peak_trunk_A"]), "ni_b": f(ni["peak_trunk_B"]),
    "ni_dab": f(ni["dAB_rms"], 2), "ni_dal": f(ni["dAL_rms"], 2), "ni_moved": f(100 * (1 - ni["c"]), 0),
    "rob_zero_30": f(rob["0.3_zero"]["HGB"]), "rob_zero_hmm_30": f(rob["0.3_zero"]["HGB+HMM"]),
    "rob_interp_30": f(rob["0.3_interp"]["HGB"]), "rob_interp_hmm_30": f(rob["0.3_interp"]["HGB+HMM"]),
    "phase_rows": "\n".join(rows), "rot_rows": "\n".join(rrows),
    "runtime": "about 8 minutes on a laptop CPU", "hmm_states": str(S["hmm"]["S"]),
}
html = (ROOT / "site" / "template.html").read_text(encoding="utf-8")
for k, v in vals.items():
    html = html.replace("{{" + k + "}}", v)
assert "{{" not in html, html[html.index("{{"):html.index("{{") + 40]
(ROOT / "site" / "index.html").write_text(html, encoding="utf-8")
shutil.copytree(ROOT / "figures", ROOT / "site" / "figures", dirs_exist_ok=True)
print("wrote site/index.html")
