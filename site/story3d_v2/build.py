"""Concatenate the story into one self-contained HTML page: ../forehand3d_v2.html"""
from pathlib import Path

here = Path(__file__).parent
parts = [(here / "shell_head.html").read_text(encoding="utf-8")]
parts.append("<script>window.SUMMARY=" + (here / "summary_small.json").read_text(encoding="utf-8") + ";</script>")
if (here / "rot_sample.json").exists():
    parts.append("<script>window.ROTSAMPLE=" + (here / "rot_sample.json").read_text(encoding="utf-8") + ";</script>")
if (here / "sample_strokes.json").exists():
    parts.append("<script>window.SAMPLES=" + (here / "sample_strokes.json").read_text(encoding="utf-8") + ";</script>")
if (here / "sample_stroke.json").exists():
    parts.append("<script>window.SAMPLE=" + (here / "sample_stroke.json").read_text(encoding="utf-8") + ";</script>")
import os, subprocess
ok = [p.name for p in sorted(here.glob("ch_*.js")) if subprocess.run(["node", "--check", str(p)], capture_output=True).returncode == 0]
print("chapters:", ok)
for name in ["scene.js", *ok, "shell.js"]:
    src = (here / name).read_text(encoding="utf-8").replace("</script", "<\\/script")
    parts.append(f"<script>/* {name} */\n{src}\n</script>")
out = here.parent / "forehand3d_v2.html"
out.write_text("\n".join(parts), encoding="utf-8")
print(out, out.stat().st_size, "bytes")
