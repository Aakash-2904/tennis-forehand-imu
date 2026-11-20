"""Frame, segment and event metrics for phase recognition."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import f1_score


def segments(y):
    b = np.flatnonzero(np.diff(y)) + 1
    s = np.r_[0, b]
    e = np.r_[b, len(y)]
    return [(int(y[i]), int(i), int(j)) for i, j in zip(s, e)]


def edit_score(yt, yp, ignore=None):
    """Normalised Levenshtein over segment label sequences (Lea et al. 2016), 0-100."""
    a = [c for c, _, _ in segments(yt) if c != ignore]
    b = [c for c, _, _ in segments(yp) if c != ignore]
    m, n = len(a), len(b)
    D = np.zeros((m + 1, n + 1))
    D[:, 0] = np.arange(m + 1)
    D[0, :] = np.arange(n + 1)
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (a[i - 1] != b[j - 1]))
    return 100 * (1 - D[m, n] / max(m, n, 1))


def f1_at_iou(yt, yp, iou=0.5, classes=(1, 2, 3, 4)):
    """Segmental F1@IoU over the four swing phases."""
    st, sp = segments(yt), segments(yp)
    tp = fp = 0
    n_true = sum(1 for c, _, _ in st if c in classes)
    used = set()
    for c, s, e in sp:
        if c not in classes:
            continue
        best, bi = 0, None
        for i, (c2, s2, e2) in enumerate(st):
            if c2 != c or i in used:
                continue
            inter = max(0, min(e, e2) - max(s, s2))
            u = max(e, e2) - min(s, s2)
            if inter / u > best:
                best, bi = inter / u, i
        if best >= iou:
            tp += 1; used.add(bi)
        else:
            fp += 1
    fn = n_true - tp
    return 100 * 2 * tp / max(2 * tp + fp + fn, 1)


def contact_events(y, frm=3, prev=2):
    """Frame indices where forward swing turns into follow-through."""
    return np.flatnonzero((y[1:] == frm) & (y[:-1] == prev)) + 1


def match_events(true_t, pred_t, tol):
    """Greedy one-to-one matching within tol. Returns (tp, fp, fn, abs errors)."""
    pred_t = list(pred_t)
    errs, tp = [], 0
    for t in true_t:
        if not pred_t:
            break
        d = np.abs(np.array(pred_t) - t)
        i = int(np.argmin(d))
        if d[i] <= tol:
            errs.append(d[i]); tp += 1; pred_t.pop(i)
    return tp, len(pred_t), len(true_t) - tp, errs


def frame_scores(yt, yp):
    return dict(macro_f1=100 * f1_score(yt, yp, average="macro"),
                per_class=(100 * f1_score(yt, yp, average=None, labels=range(5))).tolist(),
                edit=edit_score(yt, yp), f1_50=f1_at_iou(yt, yp))
