"""Hybrid HMM: a phase grammar with minimum durations over classifier posteriors.

A forehand has a fixed order, idle -> backswing -> forward swing -> follow-through
-> recovery -> idle, and each phase lasts a bounded time. Each phase k becomes a
chain of n_k states (its minimum duration in frames). The last state has a self-loop
tuned to the mean duration, so durations follow a shifted geometric distribution.
Emissions are scaled likelihoods p(k|x)/p(k) from any frame classifier, as in hybrid
speech recognisers. Frames lost to long gaps get a flat emission, so the grammar
bridges them instead of guessing.
"""
from __future__ import annotations

import numpy as np

NEXT = {0: 1, 1: 2, 2: 3, 3: 4, 4: 0}


class PhaseHMM:
    def __init__(self, n_classes=5, min_frac=0.6, abort_p=1e-4):
        self.K = n_classes
        self.min_frac = min_frac
        self.abort_p = abort_p

    def fit(self, label_seqs, post_train=None):
        """Estimate durations and priors from training label sequences (frames)."""
        durs = {k: [] for k in range(self.K)}
        counts = np.zeros(self.K)
        for y in label_seqs:
            counts += np.bincount(y, minlength=self.K)
            b = np.flatnonzero(np.diff(y)) + 1
            starts = np.r_[0, b]
            ends = np.r_[b, len(y)]
            for s, e in zip(starts[1:-1], ends[1:-1]):  # drop truncated edge segments
                durs[int(y[s])].append(e - s)
        self.prior = counts / counts.sum()
        self.n_states, self.self_p = [], []
        for k in range(self.K):
            d = np.array(durs[k]) if durs[k] else np.array([10])
            n = max(1, int(self.min_frac * np.percentile(d, 5)))
            mean = max(d.mean(), n + 1)
            p = 1 - 1 / (mean - n + 1)
            self.n_states.append(n)
            self.self_p.append(p)
        self.durs = durs
        self._build()
        return self

    def _build(self):
        cls, first, last = [], [], []
        for k, n in enumerate(self.n_states):
            first.append(len(cls))
            cls.extend([k] * n)
            last.append(len(cls) - 1)
        S = len(cls)
        A = np.zeros((S, S))
        for k in range(self.K):
            f, l = first[k], last[k]
            for s in range(f, l):
                A[s, s + 1] = 1.0
            p = self.self_p[k]
            A[l, l] = p
            A[l, first[NEXT[k]]] = 1 - p
            if k == 1:  # allow an aborted backswing to fall back to idle
                A[l, first[0]] += self.abort_p
                A[l] /= A[l].sum()
        self.state_class = np.array(cls)
        self.first = first
        with np.errstate(divide="ignore"):
            self.logA = np.log(A)
        self.S = S

    def decode(self, post, missing=None, weight=1.0):
        """Viterbi over frames, sparse: every state has at most 3 predecessors."""
        T = len(post)
        le = weight * (np.log(np.clip(post, 1e-8, 1)) - np.log(self.prior))
        if missing is not None:
            le[missing] = 0.0
        E = le[:, self.state_class]
        if not hasattr(self, "_pred"):
            P = 3
            pi = np.zeros((self.S, P), dtype=int)
            pl = np.full((self.S, P), -np.inf)
            for i in range(self.S):
                js = np.flatnonzero(np.isfinite(self.logA[:, i]))
                pi[i, :len(js)] = js
                pl[i, :len(js)] = self.logA[js, i]
            self._pred = (pi, pl)
        pi, pl = self._pred
        delta = np.full(self.S, -np.inf)
        delta[self.first[0]] = 0.0
        delta = delta + E[0]
        back = np.zeros((T, self.S), dtype=np.int16)
        rows = np.arange(self.S)
        for t in range(1, T):
            sc = delta[pi] + pl
            a = np.argmax(sc, 1)
            back[t] = pi[rows, a]
            delta = sc[rows, a] + E[t]
        path = np.zeros(T, dtype=int)
        path[-1] = int(np.argmax(delta))
        for t in range(T - 1, 0, -1):
            path[t - 1] = back[t, path[t]]
        return self.state_class[path]
