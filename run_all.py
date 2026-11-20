"""Run the full experiment and write results/ and figures/.

    .venv\\Scripts\\python run_all.py
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))

import experiment as E  # noqa: E402
import nonident  # noqa: E402
import figures  # noqa: E402


def main():
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "figures").mkdir(exist_ok=True)
    res = E.run()
    summ = E.summarise(res)
    ni = nonident.run()
    summ["nonident"] = {k: v for k, v in ni.items() if not isinstance(v, list)}
    summ["hmm"] = res["hmm"]
    json.dump(summ, open(ROOT / "results" / "summary.json", "w"), indent=2, default=float)
    json.dump(dict(excerpt=res["excerpt"], rot_excerpt=res["rot_excerpt"], nonident=ni,
                   players=res["players"]),
              open(ROOT / "results" / "traces.json", "w"), default=float)
    figures.make_all(ROOT, summ, res, ni)
    E.log("done")


if __name__ == "__main__":
    main()
