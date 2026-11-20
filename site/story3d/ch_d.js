/* Chapter 11 · Posture from the racket.
   Roots the kinematic chain at the racket-butt sensor and rebuilds the upper body backwards with a
   damped least-squares IK (fixed stance, two arm segments, joint limits, minimum-effort + smoothness cost).
   The solver is pure JS (no THREE) and exposed as chapter.compute(F) so it can be tested in node. */
(function () {
  'use strict';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  /* constants from src/simulate.py / scene.js */
  var SENSOR_OFFSET = 0.12, HEAD_OFFSET = 0.45, GRIP_ROLL = 5, ARM_LEN = 0.62;
  var B = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  /* body priors used by the trial */
  var LH = 0.06, LU = 0.35, LF = ARM_LEN + 0.04 - LU; // wrist -> grip 6 cm; upper arm + forearm = arm_len + 4 cm (reach margin)
  var PELVIS = [0, 0, 1.0], SH_OFF = [0, -0.2, 0.45]; // fixed stance; shoulder exactly where simulate.py puts it
  var NF = 100;                                      // precomputed frames per loop
  var DRIFT_ACC = 0.05;                              // m/s^2 accelerometer bias after gravity removal
  var DRIFT_DIR = unit([0.55, -0.45, 0.7]);
  var SHARES = [0.2, 0.35, 0.5, 0.65, 0.8];          // trunk-share priors for the ambiguity family
  // joint limits (deg): trunk yaw, shoulder swing, shoulder elevation (+ = down), humeral rotation,
  // elbow flexion, pronation, wrist flexion, wrist deviation
  var LIM = [[-110, 110], [-120, 150], [-110, 95], [-90, 90], [3, 150], [-85, 85], [-90, 90], [-45, 45]]
    .map(function (l) { return [l[0] * D2R, l[1] * D2R]; });
  var NQ = 8;

  /* ------------------------------------------------------------------ small linear algebra */
  function mm(A, C) {
    var O = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) O[i][j] = A[i][0] * C[0][j] + A[i][1] * C[1][j] + A[i][2] * C[2][j];
    return O;
  }
  function mT(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
  function mv(A, v) { return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  function Ry(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function unit(a) { var n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp3(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  function rotvec(M) {
    var c = clamp((M[0][0] + M[1][1] + M[2][2] - 1) / 2, -1, 1), ang = Math.acos(c);
    var v = [M[2][1] - M[1][2], M[0][2] - M[2][0], M[1][0] - M[0][1]];
    var k = ang < 1e-8 ? 0.5 : ang / (2 * Math.sin(ang));
    return scl(v, k);
  }
  function solveLin(A, b) { // Gaussian elimination with partial pivoting (A is n x n, copied)
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var p = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      var tmp = M[i]; M[i] = M[p]; M[p] = tmp;
      var d = M[i][i] || 1e-12;
      for (k = i + 1; k < n; k++) { var f = M[k][i] / d; for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (M[i][i] || 1e-12); }
    return x;
  }
  // racket orientation exactly as simulate.py / scene.js: Rz(alpha) Rx(-rk_elev) B Rx(roll + grip_roll)
  function racketR(alphaDeg, rkElevDeg, rollDeg) {
    return mm(mm(mm(Rz(alphaDeg * D2R), Rx(-rkElevDeg * D2R)), B), Rx((rollDeg + GRIP_ROLL) * D2R));
  }
  // two-link elbow placement (same as scene.js ik) for the true reference body
  function elbowIK(a, b, l1, l2, pole) {
    var d = sub(b, a), dist0 = norm(d), u = scl(d, 1 / (dist0 || 1));
    var dist = clamp(dist0, 1e-4, l1 + l2 - 1e-4);
    var x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    var perp = sub(pole, scl(u, dot(pole, u))), pn = norm(perp);
    perp = pn < 1e-6 ? [0, 0, -1] : scl(perp, 1 / pn);
    return add(add(a, scl(u, x * dist0 / dist)), scl(perp, hgt));
  }

  /* ------------------------------------------------------------------ forward model of the trial's skeleton */
  // q = [trunk yaw, shoulder swing, shoulder elevation, humeral rotation, elbow flexion, pronation, wrist flex, wrist dev]
  function fk(q, G) {
    var Rt = Rz(q[0]), S = add(PELVIS, mv(Rt, SH_OFF));
    var R1 = mm(Rt, Rz(q[1])), R2 = mm(R1, Rx(q[2])), Rua = mm(R2, Ry(q[3]));
    var E = add(S, mv(Rua, [0, -LU, 0]));
    var R4 = mm(Rua, Rx(-q[4])), Rfa = mm(R4, Ry(q[5]));  // positive flexion lifts the forearm, elbow hangs below
    var W = add(E, mv(Rfa, [0, -LF, 0]));
    var R6 = mm(Rfa, Rx(q[6])), Rh = mm(R6, Rz(q[7]));
    var H = add(W, mv(Rh, [0, -LH, 0]));
    function col(M, c) { return [M[0][c], M[1][c], M[2][c]]; }
    // world joint axes and pivots, for the geometric Jacobian
    var axes = [[0, 0, 1], col(Rt, 2), col(R1, 0), col(R2, 1), scl(col(Rua, 0), -1), col(R4, 1), col(Rfa, 0), col(R6, 2)];
    var piv = [PELVIS, S, S, S, E, E, W, W];
    return { S: S, E: E, W: W, H: H, R: mm(Rh, G), Rt: Rt, axes: axes, piv: piv };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function residual(q, G, obs) {
    var f = fk(q, G), dp = sub(f.H, obs.H), dr = rotvec(mm(f.R, mT(obs.R)));
    return [dp[0], dp[1], dp[2], dr[0], dr[1], dr[2]];
  }
  /* Equality-constrained weighted least squares, solved by damped SQP:
       min (q - ref)' W (q - ref)   s.t.  hand position and orientation = observation, q inside joint limits.
     Linearised step: dq = -d + W^-1 J' (J W^-1 J' + mu I)^-1 (J d - r), d = q - ref.
     A joint that hits a limit is clamped and locked for the rest of the frame; the last iterations are
     task-only damped least squares to polish the reach. */
  function solveFrame(obs, qInit, ref, wdiag, G) {
    var q = qInit.slice(), locked = [], i, j, k, it, sqpDone = false, iters = 0;
    for (i = 0; i < NQ; i++) { locked.push(false); q[i] = clamp(q[i], LIM[i][0], LIM[i][1]); }
    for (it = 0; it < 45; it++) {
      var f = fk(q, G), dp = sub(f.H, obs.H), dr = rotvec(mm(f.R, mT(obs.R)));
      var r = [dp[0], dp[1], dp[2], dr[0], dr[1], dr[2]], rn = Math.sqrt(r.reduce(function (s, v) { return s + v * v; }, 0));
      var polish = sqpDone || it >= 25;
      iters = it + 1;
      if (polish && rn < 1e-10) break;
      var J = [[], [], [], [], [], []];
      for (j = 0; j < NQ; j++) {   // revolute joint: d(hand)/dq = axis x (hand - pivot), d(rotation)/dq = axis
        var ax = f.axes[j], lin = cross(ax, sub(f.H, f.piv[j]));
        J[0][j] = lin[0]; J[1][j] = lin[1]; J[2][j] = lin[2]; J[3][j] = ax[0]; J[4][j] = ax[1]; J[5][j] = ax[2];
      }
      var winv = [], d = [];
      for (j = 0; j < NQ; j++) { winv.push(locked[j] ? 0 : 1 / wdiag[j]); d.push(locked[j] || polish ? 0 : q[j] - ref[j]); }
      var M = [], rhs = [];
      for (k = 0; k < 6; k++) {
        M.push([]);
        var jd = 0; for (j = 0; j < NQ; j++) jd += J[k][j] * d[j];
        rhs.push(jd - r[k]);
        for (var l = 0; l < 6; l++) {
          var s = 0; for (j = 0; j < NQ; j++) s += J[k][j] * winv[j] * J[l][j];
          M[k].push(s + (k === l ? 1e-7 : 0));
        }
      }
      var y = solveLin(M, rhs), dq = [], mx = 0;
      for (j = 0; j < NQ; j++) {
        var s2 = 0; for (k = 0; k < 6; k++) s2 += J[k][j] * y[k];
        dq.push(winv[j] * s2 - d[j]); mx = Math.max(mx, Math.abs(dq[j]));
      }
      var sc = mx > 0.25 ? 0.25 / mx : 1;
      if (mx < 1e-5 && rn < 1e-8) sqpDone = true;     // cost stationary on the constraint -> polish the reach
      for (j = 0; j < NQ; j++) {
        var nv = q[j] + sc * dq[j];
        if (nv < LIM[j][0] || nv > LIM[j][1]) { nv = clamp(nv, LIM[j][0], LIM[j][1]); locked[j] = true; }
        q[j] = nv;
      }
    }
    solveFrame.iters = (solveFrame.iters || 0) + iters;
    return q;
  }

  /* ------------------------------------------------------------------ the whole trial, precomputed */
  function compute(F) {
    var DUR = F.duration, ph = F.phases;
    var tAnchor = ph[1].t0, tReset = ph[4].t1;   // ready-rest anchor (stroke onset) and re-anchor after recovery
    var frames = [], i, k;
    for (i = 0; i < NF; i++) {
      var t = i * DUR / NF, s = F.sample(t, 0);
      var R = racketR(s.alpha, s.rkElev, s.roll), xr = [R[0][0], R[1][0], R[2][0]];
      var tau = (t >= tAnchor && t < tReset) ? t - tAnchor : 0;
      var drift = scl(DRIFT_DIR, 0.5 * DRIFT_ACC * tau * tau);  // double-integrated bias: quadratic in time
      var sensObs = add(s.sensorPos, drift);
      var th = s.trunk * D2R;
      var Strue = [0.2 * Math.sin(th), -0.2 * Math.cos(th), 1.45];
      frames.push({ t: t, s: s, R: R, xr: xr, drift: drift,
        Htrue: add(s.sensorPos, scl(xr, SENSOR_OFFSET)), Strue: Strue,
        obs: { sensor: sensObs, H: add(sensObs, scl(xr, SENSOR_OFFSET)), R: R } });
    }
    // grip calibration in the ready pose (wrist straight, arm in the plane x = 0 as at REST)
    var f0 = frames[0], T = sub(f0.Htrue, f0.Strue), dT = norm(T), L2 = LF + LH;
    var q4r = Math.acos(clamp((dT * dT - LU * LU - L2 * L2) / (2 * LU * L2), -1, 1));
    var thT = Math.atan2(-T[2], -T[1]);                        // d(a) = [0, -cos a, -sin a]
    var q2r = thT + Math.atan2(L2 * Math.sin(q4r), LU + L2 * Math.cos(q4r));
    var qRest = [0, 0, q2r, 0, q4r, 0, 0, 0];
    var G = mm(mT(Rx(q2r - q4r)), f0.R);                       // racket in hand frame, fixed by the grip
    var GtHand = mv(mT(G), [0, -LH, 0]);                       // wrist -> grip vector, racket frame
    // true reference body (from F.sample): shoulder, elbow (2-link, scene.js pole), wrist via the same grip
    frames.forEach(function (fr) {
      var th = fr.s.trunk * D2R;
      fr.Wtrue = sub(fr.Htrue, mv(fr.R, GtHand));
      fr.Etrue = elbowIK(fr.Strue, fr.Wtrue, LU, LF, [-0.3 * Math.cos(th), -0.6, -1]);
      fr.reachTrue = norm(sub(fr.Wtrue, fr.Strue));
      fr.Wobs = sub(fr.obs.H, mv(fr.R, GtHand));
    });
    function run(neutralFn, wn, ws) {
      var out = [], prev = qRest;
      for (var i = 0; i < NF; i++) {
        var nt = neutralFn(frames[i]), ref = [], w = [];
        for (var j = 0; j < NQ; j++) { w.push(wn[j] + ws); ref.push((wn[j] * nt[j] + ws * prev[j]) / (wn[j] + ws)); }
        var q = solveFrame(frames[i].obs, prev, ref, w, G);
        out.push(q); prev = q;
      }
      return out;
    }
    var WS = 2;
    // most plausible: closest to the calibrated ready pose (minimum effort) + temporal smoothness
    var best = run(function () { return qRest; }, [1, 1, 1, 1, 1, 1, 1, 1], WS);
    // ambiguity family: trunk yaw pulled toward share * racket yaw (racket yaw itself is observable)
    var family = SHARES.map(function (sh) {
      return run(function (fr) { var n = qRest.slice(); n[0] = sh * fr.s.alpha * D2R; return n; },
        [25, 1, 1, 1, 1, 1, 1, 1], WS);
    });
    function joints(q, fr) {
      var f = fk(q, G);
      return { S: f.S, E: f.E, W: f.W, H: f.H, R: f.R, trunk: q[0] * R2D,
               SL: add(PELVIS, mv(f.Rt, [0, 0.2, 0.45])),
               sensor: sub(f.H, scl([f.R[0][0], f.R[1][0], f.R[2][0]], SENSOR_OFFSET)) };
    }
    var bestJ = best.map(function (q, i) { return joints(q, frames[i]); });
    var famJ = family.map(function (qs) { return qs.map(function (q, i) { return joints(q, frames[i]); }); });
    // reach check: every solution must reproduce the observed racket pose
    var maxPos = 0, maxRot = 0;
    [best].concat(family).forEach(function (qs) {
      qs.forEach(function (q, i) {
        var r = residual(q, G, frames[i].obs);
        maxPos = Math.max(maxPos, norm([r[0], r[1], r[2]]));
        maxRot = Math.max(maxRot, norm([r[3], r[4], r[5]]));
      });
    });
    // per-joint errors of the most plausible solution vs the true body, and spread across the family
    var keys = [['hand', 'H', 'Htrue'], ['wrist', 'W', 'Wtrue'], ['elbow', 'E', 'Etrue'], ['shoulder', 'S', 'Strue']];
    var stats = [];
    keys.forEach(function (kk) {
      var se = 0, sp = 0;
      for (var i = 0; i < NF; i++) {
        var e = norm(sub(bestJ[i][kk[1]], frames[i][kk[2]])); se += e * e;
        var m = 0;
        for (var a = 0; a < famJ.length; a++) for (var b = a + 1; b < famJ.length; b++)
          m = Math.max(m, norm(sub(famJ[a][i][kk[1]], famJ[b][i][kk[1]])));
        sp += m * m;
      }
      stats.push({ name: kk[0], unit: 'cm', rmse: 100 * Math.sqrt(se / NF), spread: 100 * Math.sqrt(sp / NF) });
    });
    var st = 0, sp2 = 0;
    for (i = 0; i < NF; i++) {
      var e2 = bestJ[i].trunk - frames[i].s.trunk; st += e2 * e2;
      var lo = Infinity, hi = -Infinity;
      for (k = 0; k < famJ.length; k++) { lo = Math.min(lo, famJ[k][i].trunk); hi = Math.max(hi, famJ[k][i].trunk); }
      sp2 += (hi - lo) * (hi - lo);
    }
    stats.push({ name: 'trunk yaw', unit: '°', rmse: Math.sqrt(st / NF), spread: Math.sqrt(sp2 / NF) });
    // achieved trunk share at the deepest coil (min racket yaw)
    var iMin = 0; for (i = 1; i < NF; i++) if (frames[i].s.alpha < frames[iMin].s.alpha) iMin = i;
    var shares = [best].concat(family).map(function (qs) { return qs[iMin][0] * R2D / frames[iMin].s.alpha; });
    var trueShare = frames[iMin].s.trunk / frames[iMin].s.alpha;
    var maxDrift = 0; frames.forEach(function (fr) { maxDrift = Math.max(maxDrift, norm(fr.drift)); });
    var maxReach = 0; frames.forEach(function (fr) { maxReach = Math.max(maxReach, fr.reachTrue); });
    return { frames: frames, best: best, family: family, bestJ: bestJ, famJ: famJ, stats: stats, G: G, qRest: qRest,
             maxPosErr: maxPos, maxRotErrDeg: maxRot * R2D, shares: shares, trueShare: trueShare,
             maxDrift: maxDrift, maxReachTrue: maxReach, armReach: LU + LF, NF: NF, DUR: DUR, iMin: iMin };
  }

  /* ------------------------------------------------------------------ narration (drift number from the same formula) */
  var driftEndCm = '6';
  try {
    var F0 = typeof window !== 'undefined' && window.Forehand3D;
    if (F0) { var tt = F0.phases[4].t1 - F0.phases[1].t0; driftEndCm = (100 * 0.5 * DRIFT_ACC * tt * tt).toFixed(1); }
  } catch (e) { /* keep fallback */ }

  var BODY = "<p><b>Experiment: try to draw the person anyway.</b></p><p>We start from the racket and work backwards: the hand must be holding the handle, the arm has a fixed length, and joints can only bend so far. From all the poses that fit, we pick the smoothest, most natural one.</p><p>It looks believable, but it is a <b>guess, not a measurement</b>. The hand and wrist are fairly reliable; the elbow, shoulder and chest are guesses. The position also slowly drifts during the swing. The dashed outline shows the true body, so you can see where the guess goes wrong. A wrist sensor plus a chest sensor would turn the guess into a measurement.</p>";

  /* ------------------------------------------------------------------ chapter */
  (window.Chapters = window.Chapters || []).push({
    id: 'posture',
    order: 11,
    kicker: 'Trial · Posture from the racket',
    title: 'Rebuilding the upper body from the sensor',
    body: BODY,
    compute: compute,
    _internals: { fk: fk, residual: residual, solveFrame: solveFrame, racketR: racketR, LIM: LIM, LU: LU, LF: LF, LH: LH },
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, theme = ctx.theme || {};
      var R = compute(F);
      var MONO = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      var disposables = [], listeners = [];
      function track(o) { disposables.push(o); return o; }
      function on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); listeners.push([el, ev, fn, opt]); }
      function col(c, fb) { var C = new THREE.Color(fb); try { if (c) C.set(c); } catch (e) { /* keep */ } return C; }

      var renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      var canvas = renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
      stage.appendChild(canvas);
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(36, 1, 0.05, 40);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.8));
      var sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(2, 5, 3); scene.add(sun);
      function V(w) { return new THREE.Vector3(w[0], w[2], -w[1]); }

      var groundMat = track(new THREE.MeshStandardMaterial({ roughness: 0.95 }));
      var ground = new THREE.Mesh(track(new THREE.CircleGeometry(1.6, 48)), groundMat);
      ground.rotation.x = -Math.PI / 2; scene.add(ground);

      var SPH = track(new THREE.SphereGeometry(1, 14, 10)), CYL = track(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true));
      var UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
      function bone(parent, mat, r) {
        var m = new THREE.Mesh(CYL, mat); parent.add(m);
        return { mesh: m, set: function (a, b) {
          tmp.subVectors(b, a); var len = tmp.length() || 1e-4;
          m.position.addVectors(a, b).multiplyScalar(0.5); m.scale.set(r, len, r);
          m.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
        } };
      }

      /* skeleton description: names of points, bones, confidence along the chain */
      var CONF = { sensor: 1, H: 1, W: 0.9, E: 0.55, S: 0.35, neck: 0.22, SL: 0.18, pelvis: 0.18, head: 0.18,
                   hipR: 0.15, hipL: 0.15, kneeR: 0.12, kneeL: 0.12, footR: 0.12, footL: 0.12, rkHead: 1 };
      var BONES = [['sensor', 'H'], ['H', 'W'], ['W', 'E'], ['E', 'S'], ['S', 'neck'], ['neck', 'SL'], ['neck', 'pelvis'], ['neck', 'head'],
                   ['pelvis', 'hipR'], ['pelvis', 'hipL'], ['hipR', 'kneeR'], ['kneeR', 'footR'], ['hipL', 'kneeL'], ['kneeL', 'footL']];
      var FAM_BONES = [['H', 'W'], ['W', 'E'], ['E', 'S'], ['S', 'neck'], ['neck', 'SL']];
      var FIXED = { neck: [0, 0, 1.45], pelvis: [0, 0, 0.95], hipR: [0, -0.11, 0.92], hipL: [0, 0.11, 0.92],
                    kneeR: [0.06, -0.2, 0.5], kneeL: [0.1, 0.22, 0.5], footR: [-0.05, -0.32, 0.06], footL: [0.12, 0.34, 0.06] };
      function pointsOf(j, trunkDeg) {
        var hy = 0.6 * trunkDeg * D2R, p = {};
        for (var k in FIXED) p[k] = FIXED[k];
        p.head = [0.02 * Math.cos(hy), 0.02 * Math.sin(hy), 1.62];
        p.S = j.S; p.SL = j.SL; p.E = j.E; p.W = j.W; p.H = j.H; p.sensor = j.sensor;
        return p;
      }
      var bestPts = R.bestJ.map(function (j) { return pointsOf(j, j.trunk); });
      var famPts = R.famJ.map(function (seq) { return seq.map(function (j) { return pointsOf(j, j.trunk); }); });
      var truePts = R.frames.map(function (fr) {
        var p = pointsOf({ S: fr.Strue, E: fr.Etrue, W: fr.Wtrue, H: fr.Htrue, sensor: fr.s.sensorPos,
                           SL: [-fr.Strue[0], -fr.Strue[1], 1.45] }, fr.s.trunk);
        p.rkHead = fr.s.headPos; p.obsSensor = fr.obs.sensor;
        return p;
      });
      function lerpPts(seq, u) {
        var x = u * R.NF, i0 = Math.floor(x) % R.NF, i1 = (i0 + 1) % R.NF, f = x - Math.floor(x), a = seq[i0], b = seq[i1], o = {};
        for (var k in a) o[k] = lerp3(a[k], b[k], f);
        return o;
      }

      /* most plausible skeleton: spheres + cylinders, coloured by confidence */
      var bestGrp = new THREE.Group(); scene.add(bestGrp);
      var jointMeshes = {}, jointMats = {}, boneObjs = [];
      Object.keys(CONF).forEach(function (k) {
        if (k === 'rkHead') return;
        var m = track(new THREE.MeshStandardMaterial({ roughness: 0.4, transparent: true }));
        jointMats[k] = m;
        var mesh = new THREE.Mesh(SPH, m); bestGrp.add(mesh); jointMeshes[k] = mesh;
      });
      BONES.forEach(function (b) {
        var m = track(new THREE.MeshStandardMaterial({ roughness: 0.5, transparent: true }));
        var o = bone(bestGrp, m, 0.009); o.a = b[0]; o.b = b[1]; o.mat = m; boneObjs.push(o);
      });
      var halo = new THREE.Mesh(SPH, track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending })));
      bestGrp.add(halo);
      var pulse = new THREE.Mesh(SPH, track(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })));
      bestGrp.add(pulse);

      /* observed racket (drifted position, exact orientation) */
      var rkMat = track(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 }));
      var RING = 40, ringGeo = track(new THREE.BufferGeometry());
      ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING + 6) * 3), 3));
      var ringLine = new THREE.LineSegments(ringGeo, rkMat); ringLine.frustumCulled = false; scene.add(ringLine);
      var handleMat = track(new THREE.MeshStandardMaterial({ roughness: 0.5 }));
      var handle = bone(scene, handleMat, 0.014);

      /* ambiguity family: translucent arm chains */
      var famGrp = new THREE.Group(); scene.add(famGrp);
      var fams = famPts.map(function () {
        var m = track(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.6 }));
        var bones = FAM_BONES.map(function (b) { var o = bone(famGrp, m, 0.006); o.a = b[0]; o.b = b[1]; return o; });
        var js = ['E', 'S', 'SL'].map(function (k) { var mm2 = new THREE.Mesh(SPH, m); mm2.scale.setScalar(0.016); famGrp.add(mm2); return { k: k, mesh: mm2 }; });
        return { mat: m, bones: bones, joints: js };
      });

      /* true body: dashed outline + points, plus the drift vector */
      var trueGrp = new THREE.Group(); scene.add(trueGrp);
      var TB = BONES.concat([['H', 'rkHead']]);
      var tGeo = track(new THREE.BufferGeometry());
      tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TB.length * 6), 3));
      var tMat = track(new THREE.LineDashedMaterial({ dashSize: 0.025, gapSize: 0.018, transparent: true, opacity: 0.85 }));
      var tLines = new THREE.LineSegments(tGeo, tMat); tLines.frustumCulled = false; trueGrp.add(tLines);
      var TP = ['sensor', 'H', 'W', 'E', 'S', 'SL', 'neck'];
      var tpGeo = track(new THREE.BufferGeometry());
      tpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TP.length * 3), 3));
      var tpMat = track(new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, transparent: true, opacity: 0.9 }));
      var tPts = new THREE.Points(tpGeo, tpMat); tPts.frustumCulled = false; trueGrp.add(tPts);
      var dGeo = track(new THREE.BufferGeometry());
      dGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      var dMat = track(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }));
      var dLine = new THREE.LineSegments(dGeo, dMat); dLine.frustumCulled = false; scene.add(dLine);

      /* ---------------------------------------------------------------- HTML overlay */
      function div(css, parent) { var d = document.createElement('div'); d.style.cssText = css; (parent || stage).appendChild(d); return d; }
      var labelLayer = div('position:absolute;inset:0;pointer-events:none;overflow:hidden;font:' + MONO);
      var LABELS = [['sensor', 'sensor · root'], ['H', 'hand · grip'], ['W', 'wrist · grip'], ['E', 'elbow · inferred'],
                    ['S', 'shoulder · guessed'], ['neck', 'trunk · guessed']];
      var labelEls = LABELS.map(function (l) {
        var d = div('position:absolute;left:0;top:0;white-space:nowrap;font-size:10.5px;padding:1px 4px;border-radius:3px;transform:translate(8px,-50%)', labelLayer);
        d.textContent = l[1]; return { k: l[0], el: d };
      });
      var toggles = div('position:absolute;top:8px;left:8px;display:flex;gap:6px;flex-wrap:wrap;max-width:46%;font:' + MONO);
      var famOn = true, trueOn = true;
      function mkBtn(label, get, set) {
        var b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'font:' + MONO + ';padding:4px 8px;border-radius:4px;cursor:pointer;pointer-events:auto';
        function upd() { b.textContent = label + (get() ? ' on' : ' off'); b.setAttribute('aria-pressed', get() ? 'true' : 'false'); styleBtn(b, get()); }
        on(b, 'click', function () { set(!get()); upd(); });
        b._upd = upd; toggles.appendChild(b); upd(); return b;
      }
      function styleBtn(b, active) {
        b.style.background = active ? (theme.accent || '#7cf7d4') : 'transparent';
        b.style.color = active ? (theme.bg || '#10141a') : (theme.fg || '#e6e6e6');
        b.style.border = '1px solid ' + (active ? (theme.accent || '#7cf7d4') : (theme.line || '#445'));
      }
      var btnFam = mkBtn('family', function () { return famOn; }, function (v) { famOn = v; });
      var btnTrue = mkBtn('true body', function () { return trueOn; }, function (v) { trueOn = v; });

      var panel = div('position:absolute;top:8px;right:8px;width:184px;max-width:46%;padding:8px 9px;border-radius:6px;font:' + MONO + ';font-size:11px;line-height:1.35;pointer-events:none');
      var cmMax = 0, degMax = 0;
      R.stats.forEach(function (s) {
        if (s.unit === 'cm') cmMax = Math.max(cmMax, s.rmse, s.spread); else degMax = Math.max(degMax, s.rmse, s.spread);
      });
      var head = div('margin-bottom:6px', panel);
      head.innerHTML = 'per-joint error<br><span data-k="rm">■ RMSE vs true</span> <span data-k="sp">□ family spread</span>';
      var rows = R.stats.map(function (s) {
        var mx = s.unit === 'cm' ? cmMax : degMax, row = div('margin:5px 0', panel);
        var top = div('display:flex;justify-content:space-between;gap:6px', row);
        top.innerHTML = '<span>' + s.name + '</span><span>' + s.rmse.toFixed(1) + ' / ' + s.spread.toFixed(1) + ' ' + s.unit + '</span>';
        var tr1 = div('height:5px;margin-top:2px;border-radius:2px;position:relative', row);
        var b1 = div('position:absolute;left:0;top:0;bottom:0;border-radius:2px;width:' + Math.max(1.5, 100 * s.rmse / (mx || 1)).toFixed(1) + '%', tr1);
        var tr2 = div('height:5px;margin-top:2px;border-radius:2px;position:relative', row);
        var b2 = div('position:absolute;left:0;top:0;bottom:0;border-radius:2px;box-sizing:border-box;width:' + Math.max(1.5, 100 * s.spread / (mx || 1)).toFixed(1) + '%', tr2);
        return { tr1: tr1, tr2: tr2, b1: b1, b2: b2 };
      });
      var foot = div('margin-top:6px;font-size:10px', panel);
      foot.innerHTML = SHARES.length + ' family priors, trunk share ' + Math.round(SHARES[0] * 100) + '–' + Math.round(SHARES[SHARES.length - 1] * 100) +
        '%. All ' + (SHARES.length + 1) + ' solutions hit the racket pose within ' + (R.maxPosErr * 1000).toFixed(3) + ' mm / ' + R.maxRotErrDeg.toFixed(3) + '°.' +
        '<br>Best guess: trunk share ' + Math.round(100 * R.shares[0]) + '% (true ' + Math.round(100 * R.trueShare) + '%).';
      var nonid = ctx.summary && ctx.summary.nonident;
      if (nonid && isFinite(nonid.peak_trunk_A)) {
        foot.innerHTML += '<br>Moving 40% of trunk into shoulder: gyro differs by ' + Number(nonid.gyr_max_diff_dps).toExponential(0) +
          ' dps, peak coil ' + nonid.peak_trunk_A.toFixed(1) + '° vs ' + nonid.peak_trunk_B.toFixed(1) + '°.';
      }

      /* ---------------------------------------------------------------- theme */
      var famColors = [];
      function applyTheme(th) {
        theme = th || theme;
        var bg = col(theme.bg, '#10141a'), fg = col(theme.fg, '#e6e6e6'), muted = col(theme.muted, '#8a94a6'), acc = col(theme.accent, '#7cf7d4');
        scene.background = bg;
        groundMat.color.copy(col(theme.ground, '#2b5d4a'));
        Object.keys(jointMats).forEach(function (k) {
          var c = CONF[k], m = jointMats[k];
          m.color.copy(muted).lerp(acc, c); m.opacity = 0.25 + 0.75 * c;
          m.emissive = m.emissive || new THREE.Color(); m.emissive.copy(acc).multiplyScalar(k === 'sensor' ? 0.9 : 0.25 * c);
        });
        boneObjs.forEach(function (o) {
          var c = Math.min(CONF[o.a], CONF[o.b]); o.mat.color.copy(muted).lerp(acc, c); o.mat.opacity = 0.2 + 0.7 * c;
        });
        halo.material.color.copy(acc); pulse.material.color.copy(acc).lerp(new THREE.Color(1, 1, 1), 0.35);
        rkMat.color.copy(col(theme.racket, '#e4572e')); handleMat.color.copy(col(theme.racket, '#e4572e'));
        var pc = theme.phaseColors || [];
        famColors = [pc[1] || '#4cc9f0', pc[2] || '#f72585', pc[3] || '#ffb703', pc[4] || '#80ed99', theme.racket || '#e4572e'];
        fams.forEach(function (f, i) { f.mat.color.copy(col(famColors[i % famColors.length], '#4cc9f0')); });
        tMat.color.copy(fg); tpMat.color.copy(fg); dMat.color.copy(col(theme.racket, '#e4572e'));
        var panelBg = 'rgba(' + Math.round(bg.r * 255) + ',' + Math.round(bg.g * 255) + ',' + Math.round(bg.b * 255) + ',0.78)';
        panel.style.background = panelBg; panel.style.color = theme.fg || '#e6e6e6';
        panel.style.border = '1px solid ' + (theme.line || '#445');
        head.querySelector('[data-k="rm"]').style.color = theme.accent || '#7cf7d4';
        head.querySelector('[data-k="sp"]').style.color = theme.muted || '#8a94a6';
        foot.style.color = theme.muted || '#8a94a6';
        rows.forEach(function (r) {
          r.tr1.style.background = r.tr2.style.background = theme.line || 'rgba(128,128,128,0.25)';
          r.b1.style.background = theme.accent || '#7cf7d4';
          r.b2.style.background = 'transparent'; r.b2.style.border = '1px solid ' + (theme.muted || '#8a94a6');
        });
        labelEls.forEach(function (l) {
          var c = CONF[l.k]; l.el.style.background = panelBg;
          l.el.style.color = c > 0.8 ? (theme.accent || '#7cf7d4') : (theme.fg || '#e6e6e6');
          l.el.style.opacity = (0.55 + 0.45 * c).toFixed(2);
        });
        styleBtn(btnFam, famOn); styleBtn(btnTrue, trueOn);
      }
      applyTheme(theme);

      /* ---------------------------------------------------------------- orbit */
      var cam = { theta: 0.75, phi: 1.22, r: 3.1 }, target = new THREE.Vector3(0.15, 1.15, 0.1), drag = null;
      function placeCam() {
        var sp = Math.sin(cam.phi);
        camera.position.set(target.x + cam.r * sp * Math.sin(cam.theta), target.y + cam.r * Math.cos(cam.phi), target.z + cam.r * sp * Math.cos(cam.theta));
        camera.lookAt(target);
      }
      on(canvas, 'pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.style.cursor = 'grabbing'; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } });
      on(canvas, 'pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        cam.theta -= (e.clientX - drag.x) * 0.008; cam.phi = clamp(cam.phi - (e.clientY - drag.y) * 0.006, 0.15, 1.55);
        drag.x = e.clientX; drag.y = e.clientY;
      });
      function endDrag() { drag = null; canvas.style.cursor = 'grab'; }
      on(canvas, 'pointerup', endDrag); on(canvas, 'pointercancel', endDrag);
      on(canvas, 'wheel', function (e) { e.preventDefault(); cam.r = clamp(cam.r * Math.exp(e.deltaY * 0.0012), 1.4, 8); }, { passive: false });

      /* ---------------------------------------------------------------- per-frame update */
      var clock = 0, speed = ctx.reducedMotion ? 0.25 : 1, W = 1, Hh = 1;
      var CHAIN = ['sensor', 'H', 'W', 'E', 'S', 'neck', 'pelvis'];
      var proj = new THREE.Vector3();
      function frame(dt) {
        clock += (dt || 0) * speed;
        var u = (clock % R.DUR) / R.DUR, b = lerpPts(bestPts, u), tp = lerpPts(truePts, u), k;
        // pulse travels sensor -> hand -> wrist -> elbow -> shoulder -> trunk during the first half of each loop
        var pp = u < 0.5 ? (u / 0.5) * (CHAIN.length - 1) : -10;
        var glow = {};
        CHAIN.forEach(function (n, i) { glow[n] = Math.max(0, 1 - Math.abs(pp - i)); });
        for (k in jointMeshes) {
          var base = k === 'sensor' ? 0.03 : (k === 'H' || k === 'W' || k === 'E' || k === 'S') ? 0.022 : 0.017;
          jointMeshes[k].position.copy(V(b[k])); jointMeshes[k].scale.setScalar(base * (1 + 0.9 * (glow[k] || 0)));
        }
        boneObjs.forEach(function (o) { o.set(V(b[o.a]), V(b[o.b])); });
        halo.position.copy(V(b.sensor));
        halo.scale.setScalar(0.06 + 0.012 * Math.sin(clock * 6));
        if (pp >= 0) {
          var i0 = Math.min(CHAIN.length - 2, Math.floor(pp)), f = pp - i0;
          pulse.visible = true; pulse.position.copy(V(lerp3(b[CHAIN[i0]], b[CHAIN[i0 + 1]], f))); pulse.scale.setScalar(0.03);
        } else pulse.visible = false;
        // observed racket from the observation itself (drifted sensor + exact orientation)
        var fi = Math.round(u * R.NF) % R.NF, fr = R.frames[fi], Rr = fr.R;
        var Hobs = lerp3(R.frames[Math.floor(u * R.NF) % R.NF].obs.H, R.frames[(Math.floor(u * R.NF) + 1) % R.NF].obs.H, u * R.NF - Math.floor(u * R.NF));
        var Sobs = sub(Hobs, scl(fr.xr, SENSOR_OFFSET));
        handle.set(V(Sobs), V(Hobs));
        var ra = ringGeo.attributes.position.array, idx = 0;
        function rp(x, y) { var w = add(Hobs, mv(Rr, [x, y, 0])); var v = V(w); ra[idx++] = v.x; ra[idx++] = v.y; ra[idx++] = v.z; }
        for (var i = 0; i < RING / 2; i++) {
          var a0 = (2 * i) / RING * 2 * Math.PI, a1 = (2 * i + 1) / RING * 2 * Math.PI, a2 = (2 * i + 2) / RING * 2 * Math.PI;
          rp(HEAD_OFFSET + 0.165 * Math.cos(a0), 0.125 * Math.sin(a0)); rp(HEAD_OFFSET + 0.165 * Math.cos(a1), 0.125 * Math.sin(a1));
          rp(HEAD_OFFSET + 0.165 * Math.cos(a1), 0.125 * Math.sin(a1)); rp(HEAD_OFFSET + 0.165 * Math.cos(a2), 0.125 * Math.sin(a2));
        }
        rp(0.12, 0); rp(HEAD_OFFSET - 0.15, 0.06); rp(0.12, 0); rp(HEAD_OFFSET - 0.15, -0.06); rp(0, 0); rp(0.12, 0);
        ringGeo.attributes.position.needsUpdate = true;
        // family
        famGrp.visible = famOn;
        if (famOn) fams.forEach(function (fm, i) {
          var p = lerpPts(famPts[i], u);
          fm.bones.forEach(function (o) { o.set(V(p[o.a]), V(p[o.b])); });
          fm.joints.forEach(function (j) { j.mesh.position.copy(V(p[j.k])); });
        });
        // true body + drift vector
        trueGrp.visible = trueOn; dLine.visible = trueOn;
        if (trueOn) {
          var ta = tGeo.attributes.position.array, n = 0;
          TB.forEach(function (bb) { var va = V(tp[bb[0]]), vb = V(tp[bb[1]]); ta[n++] = va.x; ta[n++] = va.y; ta[n++] = va.z; ta[n++] = vb.x; ta[n++] = vb.y; ta[n++] = vb.z; });
          tGeo.attributes.position.needsUpdate = true; tLines.computeLineDistances();
          var pa = tpGeo.attributes.position.array; n = 0;
          TP.forEach(function (kk) { var v = V(tp[kk]); pa[n++] = v.x; pa[n++] = v.y; pa[n++] = v.z; });
          tpGeo.attributes.position.needsUpdate = true;
          var da = dGeo.attributes.position.array, v1 = V(tp.sensor), v2 = V(tp.obsSensor);
          da[0] = v1.x; da[1] = v1.y; da[2] = v1.z; da[3] = v2.x; da[4] = v2.y; da[5] = v2.z;
          dGeo.attributes.position.needsUpdate = true;
        }
        placeCam();
        renderer.render(scene, camera);
        // labels (skip when crowded on narrow stages: only sensor/elbow/shoulder below 520 px)
        labelEls.forEach(function (l) {
          if (W < 520 && (l.k === 'H' || l.k === 'W' || l.k === 'neck')) { l.el.style.display = 'none'; return; }
          proj.copy(V(b[l.k])).project(camera);
          var x = (proj.x * 0.5 + 0.5) * W, y = (-proj.y * 0.5 + 0.5) * Hh;
          var vis = proj.z < 1 && x > 0 && x < W - 40 && y > 30 && y < Hh - 60;
          l.el.style.display = vis ? 'block' : 'none';
          if (vis) l.el.style.transform = 'translate(' + (x + 8).toFixed(0) + 'px,' + (y - 8).toFixed(0) + 'px)';
        });
      }
      function resize() {
        W = stage.clientWidth || 640; Hh = stage.clientHeight || 400;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, Hh, false);
        camera.aspect = W / Math.max(1, Hh);
        cam.r = W < 520 ? 3.8 : 3.1;
        camera.updateProjectionMatrix();
        frame(0);
      }
      resize();

      return {
        frame: frame,
        resize: resize,
        setTheme: function (th) { applyTheme(th); frame(0); },
        dispose: function () {
          listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
          listeners = [];
          disposables.forEach(function (d) { try { d.dispose(); } catch (e) { /* ignore */ } });
          disposables = [];
          renderer.dispose(); try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
          [canvas, labelLayer, toggles, panel].forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
        }
      };
    }
  });
})();
