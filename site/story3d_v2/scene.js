/* Forehand3D: racket-butt IMU forehand kinematics + three.js (r128) scene.
   Classic script, no modules. Kinematics ported from src/simulate.py
   (stroke_knots, REST, forward_kinematics). World frame: x -> net, y -> player's left, z up. */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ constants */
  var G = 9.81, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var SENSOR_OFFSET = 0.12, HEAD_OFFSET = 0.45;
  // racket frame at alpha = 0: long axis x_r along -y, face normal z_r along +x
  var B = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  var PHASE_NAMES = ['idle/ready', 'backswing', 'forward swing', 'follow-through', 'recovery', 'idle/ready'];

  // representative mid-range player, intensity 1, no jitter
  var P = { coil: 80, trunk_contact: 3, trunk_ft: 60, sh_bs: 20, sh_ft: 55, wrist_lag: 18,
            arm_len: 0.62, tempo: 1, fwd_dur: 0.125, grip_roll: 5, ft_high: 40, lead: 0.055 };
  var REST = { trunk: 0, shoulder: 0, wrist: 0, arm_elev: -40, rk_elev: 35, roll: 0 };

  var READY = 0.5, TAIL = 0.35;
  var t1 = READY, fwd = P.fwd_dur, t2 = t1 + 0.6 * P.tempo, t3 = t2 + fwd,
      t4 = t3 + 0.32 * P.tempo, t5 = t4 + 0.55 * P.tempo, DUR = t5 + TAIL, L = P.lead, fth = P.ft_high;

  // knots exactly as stroke_knots (T0 = 0), padded with REST at the loop end so start == end
  var KN = {
    trunk:    [[0, REST.trunk], [t1, 0], [t2 - L, -P.coil], [t3 - 0.5 * L, P.trunk_contact], [t4 - 0.5 * L, P.trunk_ft], [t5, 0], [DUR, REST.trunk]],
    shoulder: [[0, REST.shoulder], [t1, 0], [t2 - 0.4 * L, -P.sh_bs], [t3, 5], [t4, P.sh_ft], [t5, 0], [DUR, REST.shoulder]],
    wrist:    [[0, REST.wrist], [t1, 0], [t2, -5], [t2 + 0.6 * fwd, -P.wrist_lag], [t3, -0.3 * P.wrist_lag], [t4, 15], [t5, 0], [DUR, REST.wrist]],
    arm_elev: [[0, REST.arm_elev], [t1, -40], [t2, -25], [t3, -30], [t4, fth], [t5, -40], [DUR, REST.arm_elev]],
    rk_elev:  [[0, REST.rk_elev], [t1, 35], [t2, 25], [t2 + 0.6 * fwd, -25], [t3, -5], [t4, fth + 30], [t5, 35], [DUR, REST.rk_elev]],
    roll:     [[0, REST.roll], [t1, 0], [t2, -25], [t3, 0], [t4, 70], [t5, 0], [DUR, REST.roll]]
  };

  /* ------------------------------------------------------------------ PCHIP (Fritsch-Carlson, scipy-style end slopes) */
  function pchip(knots) {
    var n = knots.length, x = [], y = [], h = [], del = [], d = new Array(n), i;
    for (i = 0; i < n; i++) { x.push(knots[i][0]); y.push(knots[i][1]); }
    for (i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); del.push((y[i + 1] - y[i]) / h[i]); }
    for (i = 1; i < n - 1; i++) {
      if (del[i - 1] * del[i] <= 0) d[i] = 0;
      else {
        var w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
      }
    }
    function endD(h0, h1, m0, m1) {
      var dd = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
      if (dd * m0 <= 0) return 0;
      if (m0 * m1 <= 0 && Math.abs(dd) > Math.abs(3 * m0)) return 3 * m0;
      return dd;
    }
    if (n === 2) { d[0] = d[1] = del[0]; }
    else { d[0] = endD(h[0], h[1], del[0], del[1]); d[n - 1] = endD(h[n - 2], h[n - 3], del[n - 2], del[n - 3]); }
    return function (t) {
      if (t <= x[0]) return y[0];
      if (t >= x[n - 1]) return y[n - 1];
      var k = 0; while (k < n - 2 && t > x[k + 1]) k++;
      var hk = h[k], s = (t - x[k]) / hk, s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * y[k] + (s3 - 2 * s2 + s) * hk * d[k] +
             (-2 * s3 + 3 * s2) * y[k + 1] + (s3 - s2) * hk * d[k + 1];
    };
  }
  var F = {}; for (var jn in KN) F[jn] = pchip(KN[jn]);

  /* ------------------------------------------------------------------ small linear algebra */
  function mm(A, Bm) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      C[i][j] = A[i][0] * Bm[0][j] + A[i][1] * Bm[1][j] + A[i][2] * Bm[2][j];
    return C;
  }
  function mT(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function lerp3(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function wrapT(t) { t = t % DUR; return t < 0 ? t + DUR : t; }

  /* ------------------------------------------------------------------ kinematics */
  // share moves a fraction of trunk yaw into the shoulder; trunk + shoulder (and alpha) unchanged
  function angles(t, share) {
    t = wrapT(t); share = share || 0;
    var tr = F.trunk(t), sh = F.shoulder(t);
    return { trunk: (1 - share) * tr, shoulder: sh + share * tr, wrist: F.wrist(t),
             armElev: F.arm_elev(t), rkElev: F.rk_elev(t), roll: F.roll(t) };
  }
  // simulate.py forward_kinematics chain (mount = identity); racket orientation depends only on alpha, rk_elev, roll
  function pose(t, share) {
    var a = angles(t, share);
    var th = a.trunk * D2R, phi = (a.trunk + a.shoulder) * D2R, ea = a.armElev * D2R, er = a.rkElev * D2R,
        beta = (a.roll + P.grip_roll) * D2R, alpha = a.trunk + a.shoulder + a.wrist;
    var S = [0.2 * Math.sin(th), -0.2 * Math.cos(th), 1.45];
    var uArm = [Math.cos(ea) * Math.sin(phi), -Math.cos(ea) * Math.cos(phi), Math.sin(ea)];
    var H = add(S, scl(uArm, P.arm_len));
    var R = mm(mm(mm(Rz(alpha * D2R), Rx(-er)), B), Rx(beta));
    var xr = [R[0][0], R[1][0], R[2][0]];
    return { a: a, alpha: alpha, S: S, H: H, R: R, xr: xr,
             sensor: sub(H, scl(xr, SENSOR_OFFSET)), head: add(H, scl(xr, HEAD_OFFSET)) };
  }
  function rotvec(M) {
    var c = clamp((M[0][0] + M[1][1] + M[2][2] - 1) / 2, -1, 1), ang = Math.acos(c);
    var v = [M[2][1] - M[1][2], M[0][2] - M[2][0], M[1][0] - M[0][1]];
    var k = ang < 1e-8 ? 0.5 : ang / (2 * Math.sin(ang));
    return scl(v, k);
  }

  // phase boundaries as simulate.py labels them:
  // reversal = argmin alpha in [onset, contact], follow-through end = argmax alpha in [contact, end]
  function argExt(a, b, sign) {
    var best = a, bv = Infinity;
    for (var t = a; t <= b; t += 0.001) { var v = sign * pose(t, 0).alpha; if (v < bv) { bv = v; best = t; } }
    return best;
  }
  var tRev = argExt(t1, t3, 1), tFt = argExt(t3, t5, -1);
  var cuts = [0, t1, tRev, t3, tFt, t5, DUR];
  var PHASES = [];
  for (var pi = 0; pi < 6; pi++) PHASES.push({ name: PHASE_NAMES[pi], t0: cuts[pi], t1: cuts[pi + 1] });

  function phaseIndex(t) {
    t = wrapT(t);
    for (var i = 0; i < PHASES.length; i++) if (t < PHASES[i].t1) return i;
    return PHASES.length - 1;
  }

  var FD_H = 0.002;
  function sample(t, share) {
    share = clamp(share || 0, 0, 0.6);
    var p0 = pose(t, share), pm = pose(t - FD_H, share), pp = pose(t + FD_H, share);
    var acc = scl(add(sub(pp.sensor, scl(p0.sensor, 2)), pm.sensor), 1 / (FD_H * FD_H));
    var f = add(acc, [0, 0, G]);                                   // specific force (accelerometer), world frame
    var w = scl(rotvec(mm(pp.R, mT(pm.R))), 1 / (2 * FD_H));     // world-frame angular velocity, rad/s
    return { t: t, phase: phaseIndex(t), trunk: p0.a.trunk, shoulder: p0.a.shoulder, wrist: p0.a.wrist,
             alpha: p0.alpha, armElev: p0.a.armElev, rkElev: p0.a.rkElev, roll: p0.a.roll,
             gyroYaw: w[2] * R2D, gyroMag: norm(w) * R2D, accMag: norm(f) / G, linAcc: norm(acc) / G,
             sensorPos: p0.sensor, headPos: p0.head };
  }

  // whole-body pose (world coords) for the mannequin
  function bodyPose(t, share) {
    var p = pose(t, share), th = p.a.trunk * D2R;
    var fwdV = [Math.cos(th), Math.sin(th), 0], leftV = [-Math.sin(th), Math.cos(th), 0];
    var neck = [0, 0, 1.45], Lsh = [-p.S[0], -p.S[1], 1.45];
    // left arm: extends toward the ball during the coil, tucks in after contact (driven by un-shared trunk)
    var trRaw = F.trunk(wrapT(t));
    var ext = smooth(-trRaw / 55), after = smooth(trRaw / 30);
    var reach = add(Lsh, add(scl(fwdV, 0.5), add(scl(leftV, -0.16), [0, 0, -0.1])));
    var rest = add(neck, add(scl(fwdV, 0.24), add(scl(leftV, 0.1), [0, 0, -0.34])));
    var tuck = add(neck, add(scl(fwdV, 0.16), add(scl(leftV, 0.2), [0, 0, -0.2])));
    var Lhand = lerp3(lerp3(rest, reach, ext), tuck, after * (1 - ext));
    var bend = 0.05 * smooth(-trRaw / 60);
    var pelvisYaw = 0.4 * th, pz = 0.9 - bend;
    var hipR = [0.11 * Math.sin(pelvisYaw), -0.11 * Math.cos(pelvisYaw), pz],
        hipL = [-hipR[0], -hipR[1], pz];
    return { p: p, th: th, pelvisYaw: pelvisYaw, Rsh: p.S, Lsh: Lsh, Rhand: p.H, Lhand: Lhand,
             hipR: hipR, hipL: hipL, footR: [-0.05, -0.42, 0.06], footL: [0.12, 0.38, 0.06], pz: pz };
  }
  // two-link IK: elbow/knee position from root, end, segment lengths and a pole direction
  function ik(a, b, l1, l2, pole) {
    var d = sub(b, a), dist0 = norm(d), u = scl(d, 1 / (dist0 || 1));
    var dist = clamp(dist0, 1e-4, l1 + l2 - 1e-4);
    var x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    var pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2];
    var perp = sub(pole, scl(u, pd)), pn = norm(perp);
    perp = pn < 1e-6 ? [0, 0, -1] : scl(perp, 1 / pn);
    return add(add(a, scl(u, x * dist0 / dist)), scl(perp, hgt));
  }

  /* ------------------------------------------------------------------ rendering */
  function mount(el, opts) {
    var THREE = root.THREE;
    if (!THREE) throw new Error('Forehand3D.mount needs THREE (r128) loaded first');
    opts = opts || {};
    var canvas;
    if (el && el.tagName && el.tagName.toLowerCase() === 'canvas') canvas = el;
    else {
      canvas = document.createElement('canvas');
      canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%';
      el.appendChild(canvas);
    }
    canvas.style.touchAction = 'none';

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color('#10141a');
    var camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

    var hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.7); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(2.5, 6, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    var sc = sun.shadow.camera; sc.left = -2.5; sc.right = 2.5; sc.top = 2.5; sc.bottom = -2.5; sc.near = 1; sc.far = 15;
    sun.shadow.bias = -0.0008;
    sun.target.position.set(0, 0.8, 0); scene.add(sun); scene.add(sun.target);

    function V(w) { return new THREE.Vector3(w[0], w[2], -w[1]); } // world (z-up) -> three (y-up), proper rotation

    // court
    var groundMat = new THREE.MeshStandardMaterial({ color: '#2b5d4a', roughness: 0.95 });
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    var lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
    var baseline = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 14), lineMat);
    baseline.position.set(0.55, 0.002, 0); scene.add(baseline);
    var centerMark = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.004, 0.05), lineMat);
    centerMark.position.set(0.675, 0.002, -2.0); scene.add(centerMark);

    // shared low-poly primitives (capsule = open cylinder + 2 spheres)
    var CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    var SPH = new THREE.SphereGeometry(1, 10, 8);
    var UP = new THREE.Vector3(0, 1, 0);
    var tmpD = new THREE.Vector3();

    function capsule(parent, mat, r, shadow) {
      var g = { cyl: new THREE.Mesh(CYL, mat), s0: new THREE.Mesh(SPH, mat), s1: new THREE.Mesh(SPH, mat), r: r };
      [g.cyl, g.s0, g.s1].forEach(function (m) { m.castShadow = !!shadow; parent.add(m); });
      g.set = function (a, b) {
        tmpD.subVectors(b, a); var len = tmpD.length() || 1e-4;
        g.cyl.position.addVectors(a, b).multiplyScalar(0.5);
        g.cyl.scale.set(g.r, len, g.r);
        g.cyl.quaternion.setFromUnitVectors(UP, tmpD.divideScalar(len));
        g.s0.position.copy(a); g.s0.scale.setScalar(g.r);
        g.s1.position.copy(b); g.s1.scale.setScalar(g.r);
      };
      return g;
    }

    function makeMaterials(ghost) {
      function m(col) {
        return ghost
          ? new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.26, depthWrite: false, roughness: 0.7, flatShading: true })
          : new THREE.MeshStandardMaterial({ color: col, roughness: 0.62, metalness: 0.05, flatShading: true });
      }
      return { body: m('#d9dde3'), dark: m('#9aa3ae'), racket: m('#e4572e'),
               strings: new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: ghost ? 0.12 : 0.35 }) };
    }

    // racket built directly in the racket frame: x_r long axis (butt -> head), y_r across the face, z_r face normal
    function makeRacket(parent, mats, withImu, shadow) {
      var g = new THREE.Group(); parent.add(g);
      function seg(a, b, r) { capsule(g, mats.racket, r, shadow).set(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])); }
      var handleGeo = new THREE.CylinderGeometry(0.017, 0.016, 0.25, 8); handleGeo.rotateZ(-Math.PI / 2);
      var handle = new THREE.Mesh(handleGeo, mats.dark); handle.position.x = 0.005; handle.castShadow = !!shadow; g.add(handle);
      var capGeo = new THREE.CylinderGeometry(0.021, 0.021, 0.012, 8); capGeo.rotateZ(-Math.PI / 2);
      var cap = new THREE.Mesh(capGeo, mats.racket); cap.position.x = -SENSOR_OFFSET; g.add(cap);
      seg([0.13, 0, 0], [0.30, 0.075, 0], 0.009);
      seg([0.13, 0, 0], [0.30, -0.075, 0], 0.009);
      var A = 0.165, Bb = 0.125, C0 = HEAD_OFFSET, pts = [];
      for (var i = 0; i < 40; i++) { var an = i / 40 * Math.PI * 2; pts.push(new THREE.Vector3(C0 + A * Math.cos(an), Bb * Math.sin(an), 0)); }
      var ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.011, 6, true), mats.racket);
      ring.castShadow = !!shadow; g.add(ring);
      var sp = [], k;
      for (k = -5; k <= 5; k++) {   // mains (along x_r), clipped to the ellipse
        var yy = k * 0.021; if (Math.abs(yy) < Bb) { var hx = A * Math.sqrt(1 - yy * yy / (Bb * Bb)); sp.push(C0 - hx, yy, 0, C0 + hx, yy, 0); }
      }
      for (k = -7; k <= 7; k++) {   // crosses (along y_r)
        var xx = k * 0.021; if (Math.abs(xx) < A) { var hy = Bb * Math.sqrt(1 - xx * xx / (A * A)); sp.push(C0 + xx, -hy, 0, C0 + xx, hy, 0); }
      }
      var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      g.add(new THREE.LineSegments(sg, mats.strings));
      var imu = null;
      if (withImu) {
        var ox = -SENSOR_OFFSET - 0.022;
        imu = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.034, 0.034),
          new THREE.MeshStandardMaterial({ color: '#7cf7d4', emissive: '#7cf7d4', emissiveIntensity: 1.3, roughness: 0.3 }));
        imu.position.x = ox; g.add(imu);
        var o = new THREE.Vector3(ox, 0, 0);
        g.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), o, 0.09, 0xff5555, 0.025, 0.014));
        g.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), o, 0.09, 0x55ff77, 0.025, 0.014));
        g.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), o, 0.09, 0x5599ff, 0.025, 0.014));
      }
      var M4 = new THREE.Matrix4();
      return {
        group: g, imu: imu,
        set: function (Hw, R) {
          g.position.copy(V(Hw));
          M4.makeBasis(V([R[0][0], R[1][0], R[2][0]]), V([R[0][1], R[1][1], R[2][1]]), V([R[0][2], R[1][2], R[2][2]]));
          g.quaternion.setFromRotationMatrix(M4);
        }
      };
    }

    function makeFigure(ghost) {
      var mats = makeMaterials(ghost), shadow = !ghost, grp = new THREE.Group(); scene.add(grp);
      var torsoGrp = new THREE.Group(); grp.add(torsoGrp);
      var torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.78, 1, 10), mats.body);
      torso.castShadow = shadow; torsoGrp.add(torso);
      var chest = new THREE.Mesh(SPH, mats.body); chest.scale.set(0.12, 0.1, 0.19); chest.position.y = 1.36; chest.castShadow = shadow; torsoGrp.add(chest);
      var pelvisGrp = new THREE.Group(); grp.add(pelvisGrp);
      var pelvis = new THREE.Mesh(SPH, mats.dark); pelvis.scale.set(0.11, 0.09, 0.17); pelvis.castShadow = shadow; pelvisGrp.add(pelvis);
      var neck = capsule(grp, mats.body, 0.04, shadow);
      var head = new THREE.Mesh(SPH, mats.body); head.scale.set(0.095, 0.115, 0.095); head.castShadow = shadow; grp.add(head);
      var visor = new THREE.Mesh(SPH, mats.dark); visor.scale.set(0.04, 0.03, 0.07); grp.add(visor);
      var shLine = capsule(grp, mats.body, 0.055, shadow);
      var rUp = capsule(grp, mats.body, 0.042, shadow), rLo = capsule(grp, mats.body, 0.035, shadow);
      var lUp = capsule(grp, mats.body, 0.04, shadow), lLo = capsule(grp, mats.body, 0.033, shadow);
      var rTh = capsule(grp, mats.dark, 0.062, shadow), rSh = capsule(grp, mats.dark, 0.046, shadow);
      var lTh = capsule(grp, mats.dark, 0.062, shadow), lSh = capsule(grp, mats.dark, 0.046, shadow);
      var hands = [new THREE.Mesh(SPH, mats.body), new THREE.Mesh(SPH, mats.body)];
      hands.forEach(function (h) { h.scale.setScalar(0.042); h.castShadow = shadow; grp.add(h); });
      var footGeo = new THREE.BoxGeometry(0.26, 0.07, 0.1);
      var feet = [new THREE.Mesh(footGeo, mats.dark), new THREE.Mesh(footGeo, mats.dark)];
      feet.forEach(function (f) { f.castShadow = shadow; grp.add(f); });
      var racket = makeRacket(grp, mats, !ghost, shadow);
      var UA = 0.32, FA = 0.32, TH = 0.46, SHN = 0.46;

      function update(t, share) {
        var b = bodyPose(t, share), p = b.p, th = b.th, hy = th * 0.6;
        torsoGrp.rotation.y = th;
        var tH = 1.4 - b.pz; torso.scale.set(0.11, tH, 0.18); torso.position.y = b.pz + 0.06 + tH / 2;
        pelvisGrp.position.copy(V([0, 0, b.pz])); pelvisGrp.rotation.y = b.pelvisYaw;
        neck.set(V([0, 0, 1.45]), V([0, 0, 1.55]));
        head.position.copy(V([0.02 * Math.cos(hy), 0.02 * Math.sin(hy), 1.64])); head.rotation.y = hy;
        visor.position.copy(V([0.09 * Math.cos(hy), 0.09 * Math.sin(hy), 1.66])); visor.rotation.y = hy;
        var Rs = V(b.Rsh), Ls = V(b.Lsh);
        shLine.set(Rs, Ls);
        var rEl = ik(b.Rsh, b.Rhand, UA, FA, [-0.3 * Math.cos(th), -0.6, -1]);
        rUp.set(Rs, V(rEl)); rLo.set(V(rEl), V(b.Rhand)); hands[0].position.copy(V(b.Rhand));
        var lEl = ik(b.Lsh, b.Lhand, UA, FA, [-0.4 * Math.cos(th), 0.6, -1]);
        lUp.set(Ls, V(lEl)); lLo.set(V(lEl), V(b.Lhand)); hands[1].position.copy(V(b.Lhand));
        var kneeR = ik(b.hipR, b.footR, TH, SHN, [1, -0.2, 0]), kneeL = ik(b.hipL, b.footL, TH, SHN, [1, 0.25, 0]);
        rTh.set(V(b.hipR), V(kneeR)); rSh.set(V(kneeR), V(b.footR));
        lTh.set(V(b.hipL), V(kneeL)); lSh.set(V(kneeL), V(b.footL));
        feet[0].position.copy(V([b.footR[0] + 0.06, b.footR[1], 0.035])); feet[0].rotation.y = 0.15;
        feet[1].position.copy(V([b.footL[0] + 0.06, b.footL[1], 0.035])); feet[1].rotation.y = -0.35;
        racket.set(p.H, p.R);
      }
      function setColors(body, rk, accent) {
        if (ghost) {
          if (accent) { mats.body.color.set(accent); mats.dark.color.set(accent); mats.racket.color.set(accent); }
          return;
        }
        if (body) { mats.body.color.set(body); mats.dark.color.set(body).multiplyScalar(0.68); }
        if (rk) mats.racket.color.set(rk);
        if (accent && racket.imu) { racket.imu.material.color.set(accent); racket.imu.material.emissive.set(accent); }
      }
      return { group: grp, update: update, setColors: setColors };
    }

    var fig = makeFigure(false), ghostFig = makeFigure(true);
    ghostFig.group.visible = false; ghostFig.setColors(null, null, '#7cf7d4');

    // ball
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#d8f04a', roughness: 0.8, emissive: '#2a3008' }));
    ball.castShadow = true; scene.add(ball);

    // racket-head trail, vertex-coloured by phase, older points faded toward the background
    var TN = 80, TRAIL_S = 0.6;
    var tPos = new Float32Array(TN * 3), tCol = new Float32Array(TN * 3);
    var tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    var trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    trail.frustumCulled = false; scene.add(trail);
    var trailOn = true, ghostOn = false;

    var theme = { bg: new THREE.Color('#10141a'),
                  phase: ['#8a94a6', '#4cc9f0', '#f72585', '#ffb703', '#80ed99'].map(function (c) { return new THREE.Color(c); }) };
    var tmpC = new THREE.Color();

    // camera presets + hand-written orbit (spherical about a target, three.js y-up)
    var PRESETS = {
      side:   { theta: 0.15, phi: 1.38, r: 4.6, target: [0.25, 1.05, 0] },          // from the player's right (world -y)
      behind: { theta: -Math.PI / 2 - 0.25, phi: 1.3, r: 4.4, target: [0.3, 1.05, 0] }, // from behind (world -x)
      top:    { theta: -Math.PI / 2, phi: 0.06, r: 5.2, target: [0.2, 0.6, 0] }
    };
    var cam = { theta: 0.15, phi: 1.38, r: 4.6, target: new THREE.Vector3(0.25, 1.05, 0) }, goal = null;
    function setCamera(name) {
      var pr = PRESETS[name];
      if (!pr) { goal = null; return; } // 'free': keep current orbit
      goal = { theta: pr.theta, phi: pr.phi, r: pr.r, target: new THREE.Vector3(pr.target[0], pr.target[1], pr.target[2]) };
      while (goal.theta - cam.theta > Math.PI) goal.theta -= 2 * Math.PI;
      while (goal.theta - cam.theta < -Math.PI) goal.theta += 2 * Math.PI;
    }
    function stepCamera() {
      var moving = false;
      if (goal) {
        var k = 0.16;
        cam.theta += (goal.theta - cam.theta) * k; cam.phi += (goal.phi - cam.phi) * k; cam.r += (goal.r - cam.r) * k;
        cam.target.lerp(goal.target, k);
        if (Math.abs(goal.theta - cam.theta) + Math.abs(goal.phi - cam.phi) + Math.abs(goal.r - cam.r) + cam.target.distanceTo(goal.target) < 1e-3) {
          cam.theta = goal.theta; cam.phi = goal.phi; cam.r = goal.r; cam.target.copy(goal.target); goal = null;
        } else moving = true;
      }
      var sp = Math.sin(cam.phi);
      camera.position.set(cam.target.x + cam.r * sp * Math.sin(cam.theta), cam.target.y + cam.r * Math.cos(cam.phi),
                          cam.target.z + cam.r * sp * Math.cos(cam.theta));
      camera.lookAt(cam.target);
      return moving;
    }
    var pointers = {}, pinchD = 0;
    function pdist() {
      var k = Object.keys(pointers); if (k.length < 2) return 0;
      var a = pointers[k[0]], b = pointers[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y);
    }
    canvas.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; pinchD = pdist();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', function (e) {
      var pt = pointers[e.pointerId]; if (!pt) return;
      var n = Object.keys(pointers).length;
      if (n === 1) {
        goal = null;
        cam.theta -= (e.clientX - pt.x) * 0.008;
        cam.phi = clamp(cam.phi - (e.clientY - pt.y) * 0.006, 0.05, 1.55);
      }
      pt.x = e.clientX; pt.y = e.clientY;
      if (n >= 2) { var d = pdist(); if (pinchD > 0 && d > 0) { goal = null; cam.r = clamp(cam.r * pinchD / d, 1.5, 14); } pinchD = d; }
      kick();
    });
    function up(e) { delete pointers[e.pointerId]; pinchD = pdist(); }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); goal = null; cam.r = clamp(cam.r * Math.exp(e.deltaY * 0.0012), 1.5, 14); kick();
    }, { passive: false });

    // redraw with the last (t, share) when the page is paused but the camera moves
    var lastT = 0, lastShare = 0, rafPending = false;
    function kick() {
      if (rafPending || typeof requestAnimationFrame === 'undefined') return;
      rafPending = true;
      requestAnimationFrame(function () { rafPending = false; draw(lastT, lastShare); });
    }

    function updateBall(t, share) {
      var pc = pose(t3, share).head, dt = wrapT(t) - t3, w;
      if (dt < -0.6 || dt > 0.55) { ball.visible = false; return; }
      ball.visible = true;
      if (dt <= 0) {  // incoming from the net side, small arc, arrives at the string bed at contact
        var u = 1 + dt / 0.6;
        w = [pc[0] + 9 * (1 - u), pc[1] + 1.2 * (1 - u), pc[2] + 0.9 * Math.sin(Math.PI * (1 - u)) * (1 - u)];
      } else {        // outgoing, slightly cross-court, rising then dropping
        var v = dt / 0.55;
        w = [pc[0] + 10 * v, pc[1] - 0.8 * v, pc[2] + 1.6 * v - 1.4 * v * v];
      }
      ball.position.copy(V(w));
    }
    function updateTrail(t, share) {
      trail.visible = trailOn; if (!trailOn) return;
      for (var i = 0; i < TN; i++) {
        var age = i / (TN - 1), ti = t - TRAIL_S * (1 - age), v = V(pose(ti, share).head);
        tPos[3 * i] = v.x; tPos[3 * i + 1] = v.y; tPos[3 * i + 2] = v.z;
        tmpC.copy(theme.bg).lerp(theme.phase[phaseIndex(ti) % 5], 0.2 + 0.8 * age);
        tCol[3 * i] = tmpC.r; tCol[3 * i + 1] = tmpC.g; tCol[3 * i + 2] = tmpC.b;
      }
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
    }
    function draw(t, share) {
      share = clamp(share || 0, 0, 0.6);
      fig.update(t, share);
      ghostFig.group.visible = ghostOn;
      if (ghostOn) ghostFig.update(t, share > 0.2 ? 0 : 0.4);
      updateBall(t, share); updateTrail(t, share);
      var moving = stepCamera();
      renderer.render(scene, camera);
      if (moving) kick();
    }
    function resize() {
      var pe = canvas.parentElement;
      var w = canvas.clientWidth || (pe && pe.clientWidth) || 640, h = canvas.clientHeight || (pe && pe.clientHeight) || 400;
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
      draw(lastT, lastShare);
    }
    function setTheme(th) {
      th = th || {};
      if (th.bg) { theme.bg.set(th.bg); scene.background = theme.bg.clone(); }
      if (th.ground) groundMat.color.set(th.ground);
      if (th.phaseColors) th.phaseColors.forEach(function (c, i) { if (i < 5 && c) theme.phase[i] = new THREE.Color(c); });
      fig.setColors(th.body, th.racket, th.accent);
      if (th.accent) ghostFig.setColors(null, null, th.accent);
      draw(lastT, lastShare);
    }

    if (root.addEventListener) root.addEventListener('resize', function () { resize(); });
    if (opts.camera) setCamera(opts.camera);
    if (opts.theme) setTheme(opts.theme);
    if (opts.ghost) ghostOn = true;
    if (opts.trail === false) trailOn = false;
    resize();

    return {
      render: function (t, share) { lastT = t; lastShare = share || 0; draw(lastT, lastShare); },
      setGhost: function (on) { ghostOn = !!on; draw(lastT, lastShare); },
      setTrail: function (on) { trailOn = !!on; draw(lastT, lastShare); },
      setCamera: function (name) { setCamera(name); draw(lastT, lastShare); },
      resize: resize,
      setTheme: setTheme
    };
  }

  root.Forehand3D = { duration: DUR, phases: PHASES, contactTime: t3, sample: sample, mount: mount };
})(typeof window !== 'undefined' ? window : this);
