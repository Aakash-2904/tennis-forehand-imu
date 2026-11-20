/* ch_a.js: chapters 1-3 (problem, simulator, sensor + link corruption).
   Classic script. Each chapter owns one WebGL renderer, built from F.sample (no F.mount),
   so dispose() can free everything. World frame (z-up, x to net, y left) maps to three.js y-up via V(). */
(function () {
  'use strict';
  var D2R = Math.PI / 180;
  var MONO = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var SAFE_BOTTOM = 56;
  var GRIP_ROLL = 5, ARM_LEN = 0.62, SENSOR_OFFSET = 0.12, HEAD_OFFSET = 0.45;

  /* ---------------------------------------------------------------- helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(v, d) {
    d = d === undefined ? 1 : d;
    var s = Math.abs(v).toFixed(d), z = +s === 0;
    return (z ? '±' : v > 0 ? '+' : '−') + s;
  }
  function rng(seed) { // mulberry32, deterministic
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function th(theme, k, fb) { return (theme && theme[k]) || fb; }
  function phaseCol(theme, i) {
    var pc = (theme && theme.phaseColors) || [];
    var fb = ['#8a9a94', '#2f7dbf', '#d9502b', '#d9b51f', '#4fae7a'];
    return pc[i % 5] || fb[i % 5];
  }
  function hexA(c, a) { // css colour + alpha, works for #rgb / #rrggbb, otherwise color-mix
    if (/^#[0-9a-f]{6}$/i.test(c)) return 'rgba(' + parseInt(c.substr(1, 2), 16) + ',' + parseInt(c.substr(3, 2), 16) + ',' + parseInt(c.substr(5, 2), 16) + ',' + a + ')';
    if (/^#[0-9a-f]{3}$/i.test(c)) return hexA('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3], a);
    return 'color-mix(in srgb, ' + c + ' ' + Math.round(a * 100) + '%, transparent)';
  }

  // racket-side forward kinematics, same chain as simulate.py forward_kinematics (mount = identity)
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  function mm(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    return C;
  }
  var BM = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  function racketR(alpha, rkElev, roll) { return mm(mm(mm(Rz(alpha * D2R), Rx(-rkElev * D2R)), BM), Rx((roll + GRIP_ROLL) * D2R)); }
  function fk(trunk, shoulder, wrist, armElev, rkElev, roll, armLen) {
    var t = trunk * D2R, phi = (trunk + shoulder) * D2R, ea = armElev * D2R, L = armLen || ARM_LEN;
    var S = [0.2 * Math.sin(t), -0.2 * Math.cos(t), 1.45];
    var H = [S[0] + L * Math.cos(ea) * Math.sin(phi), S[1] - L * Math.cos(ea) * Math.cos(phi), S[2] + L * Math.sin(ea)];
    var R = racketR(trunk + shoulder + wrist, rkElev, roll), xr = [R[0][0], R[1][0], R[2][0]];
    return { S: S, H: H, R: R, xr: xr,
             sensor: [H[0] - SENSOR_OFFSET * xr[0], H[1] - SENSOR_OFFSET * xr[1], H[2] - SENSOR_OFFSET * xr[2]],
             head: [H[0] + HEAD_OFFSET * xr[0], H[1] + HEAD_OFFSET * xr[1], H[2] + HEAD_OFFSET * xr[2]] };
  }
  function fkS(s) { return fk(s.trunk, s.shoulder, s.wrist, s.armElev, s.rkElev, s.roll); }
  function ik(a, b, l1, l2, pole) {
    var d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], d0 = Math.hypot(d[0], d[1], d[2]) || 1e-4;
    var u = [d[0] / d0, d[1] / d0, d[2] / d0], dist = clamp(d0, 1e-4, l1 + l2 - 1e-4);
    var x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    var pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2];
    var p = [pole[0] - u[0] * pd, pole[1] - u[1] * pd, pole[2] - u[2] * pd], pn = Math.hypot(p[0], p[1], p[2]) || 1;
    var k = x * d0 / dist;
    return [a[0] + u[0] * k + p[0] / pn * h, a[1] + u[1] * k + p[1] / pn * h, a[2] + u[2] * k + p[2] / pn * h];
  }

  /* ---------------------------------------------------------------- shared stage scaffold */
  function makeBase(stage, ctx, o) {
    var THREE = ctx.THREE;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    stage.appendChild(canvas);
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false }); }
    catch (e) { stage.removeChild(canvas); throw e; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // linear output: theme hex colours render as written (no sRGB wash-out on the light stage)
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(o.fov || 38, 1, 0.05, 80);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x4a5a52, 0.75); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(3, 7, 4); scene.add(sun);
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font:' + MONO;
    stage.appendChild(overlay);
    var W = 640, H = 400, tmp = new THREE.Vector3();
    function V(w) { return new THREE.Vector3(w[0], w[2], -w[1]); }
    function resize() {
      W = stage.clientWidth || 640; H = stage.clientHeight || 400;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H, false);
      camera.aspect = W / Math.max(1, H); camera.updateProjectionMatrix();
    }
    function el(tag, css, parent) { var e = document.createElement(tag || 'div'); e.style.cssText = css || ''; (parent || overlay).appendChild(e); return e; }
    // position an HTML label at a three.js point; returns false when hidden
    function place(e, v3, dx, dy) {
      tmp.copy(v3).project(camera);
      var x = (tmp.x * 0.5 + 0.5) * W + (dx || 0), y = (-tmp.y * 0.5 + 0.5) * H + (dy || 0);
      var vis = tmp.z < 1 && x > -40 && x < W + 40 && y > 0 && y < H - SAFE_BOTTOM;
      e.style.display = vis ? '' : 'none';
      e.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      return vis;
    }
    function size() { return { w: W, h: H }; }
    function dispose() {
      scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) [].concat(obj.material).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
      });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    // camera that keeps a world-width W0 in view regardless of aspect
    function frameCam(target, dir, needW, needH) {
      var t = Math.tan((camera.fov * D2R) / 2), a = camera.aspect;
      var dist = Math.max(needW / 2 / (t * a), needH / 2 / t);
      camera.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
      camera.lookAt(target);
    }
    resize();
    return { THREE: THREE, renderer: renderer, scene: scene, camera: camera, hemi: hemi, sun: sun, overlay: overlay,
             V: V, el: el, place: place, resize: resize, size: size, dispose: dispose, frameCam: frameCam };
  }

  function card(base, css) {
    return base.el('div', 'position:absolute;box-sizing:border-box;padding:8px 10px;border-radius:8px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' + (css || ''));
  }
  function styleCard(c, theme, edge) {
    c.style.background = hexA(th(theme, 'bg', '#dfe8e3'), 0.86);
    c.style.color = th(theme, 'fg', '#10201a');
    c.style.border = '1px solid ' + th(theme, 'line', '#c6d3cc');
    c.style.borderTop = '3px solid ' + (edge || th(theme, 'accent', '#d9b51f'));
  }
  function bubble(base) {
    return base.el('div', 'position:absolute;left:0;top:0;white-space:nowrap;padding:2px 6px;border-radius:999px;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;will-change:transform');
  }

  // court floor with hard-court lines
  function addCourt(base, theme) {
    var THREE = base.THREE;
    var gm = new THREE.MeshStandardMaterial({ color: th(theme, 'ground', '#3a7a62'), roughness: 0.95 });
    var g = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), gm); g.rotation.x = -Math.PI / 2; base.scene.add(g);
    var lm = new THREE.MeshBasicMaterial({ color: 0xf2f2ee, transparent: true, opacity: 0.85 });
    var l1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 16), lm); l1.position.set(0.55, 0.002, 0); base.scene.add(l1);
    var l2 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.004, 0.05), lm); l2.position.set(4, 0.002, -4.1); base.scene.add(l2);
    return { mat: gm, setTheme: function (t) { gm.color.set(th(t, 'ground', '#3a7a62')); } };
  }

  // racket mesh in its own frame: x_r long axis (butt -> head), y_r across face, z_r face normal; origin at the hand
  function makeRacket(base, mat, strMat) {
    var THREE = base.THREE, g = new THREE.Group();
    var hg = new THREE.CylinderGeometry(0.017, 0.016, 0.25, 8); hg.rotateZ(-Math.PI / 2);
    var handle = new THREE.Mesh(hg, mat); handle.position.x = 0.005; g.add(handle);
    var pts = [], A = 0.165, Bb = 0.125, C0 = HEAD_OFFSET, i, k;
    for (i = 0; i < 36; i++) { var an = i / 36 * Math.PI * 2; pts.push(new THREE.Vector3(C0 + A * Math.cos(an), Bb * Math.sin(an), 0)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 56, 0.011, 6, true), mat));
    [[0.075], [-0.075]].forEach(function (yy) {
      var a = new THREE.Vector3(0.13, 0, 0), b = new THREE.Vector3(0.295, yy[0], 0), d = b.clone().sub(a);
      var c = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, d.length(), 6), mat);
      c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(c);
    });
    var sp = [];
    for (k = -5; k <= 5; k++) { var y = k * 0.021, hx = A * Math.sqrt(1 - y * y / (Bb * Bb)); sp.push(C0 - hx, y, 0, C0 + hx, y, 0); }
    for (k = -7; k <= 7; k++) { var x = k * 0.021, hy = Bb * Math.sqrt(1 - x * x / (A * A)); sp.push(C0 + x, -hy, 0, C0 + x, hy, 0); }
    var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    g.add(new THREE.LineSegments(sg, strMat));
    var M4 = new THREE.Matrix4();
    g.userData.setPose = function (Hw, R) {
      if (Hw) g.position.copy(base.V(Hw));
      M4.makeBasis(base.V([R[0][0], R[1][0], R[2][0]]), base.V([R[0][1], R[1][1], R[2][1]]), base.V([R[0][2], R[1][2], R[2][2]]));
      g.quaternion.setFromRotationMatrix(M4);
    };
    return g;
  }
  function makeAxes(base, len, cols) { // x / y / z arrows as thin cylinders + cones, cols = [x,y,z] colours
    var THREE = base.THREE, g = new THREE.Group(), mats = [];
    var dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    dirs.forEach(function (d, i) {
      var m = new THREE.MeshBasicMaterial({ color: cols[i] }); mats.push(m);
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.035, len * 0.035, len * 0.8, 6), m);
      var cone = new THREE.Mesh(new THREE.ConeGeometry(len * 0.09, len * 0.22, 8), m);
      var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      shaft.quaternion.copy(q); cone.quaternion.copy(q);
      shaft.position.copy(d).multiplyScalar(len * 0.4); cone.position.copy(d).multiplyScalar(len * 0.89);
      g.add(shaft); g.add(cone);
    });
    g.userData.mats = mats;
    return g;
  }
  // pick whichever colour stands out more against the background
  function contrastPick(THREE, a, b, bg) {
    var L = function (c) { var x = new THREE.Color(c); return 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b; };
    var lb = L(bg); return Math.abs(L(a) - lb) >= Math.abs(L(b) - lb) * 0.8 ? a : b;
  }

  /* ================================================================ CHAPTER 1: the problem */
  var BODY1 = "<p><b>We have one tiny sensor and we are trying to understand a whole body.</b></p><p>A forehand uses your hips, chest, shoulder, elbow, forearm and wrist all at once. Our only sensor is a small motion sensor stuck on the bottom of the racket handle. It is like guessing a whole dance from watching only one hand.</p><p>We want to know three things: which part of the swing you are in, the exact moment you hit the ball, and how much you turned your chest.</p><p><small>The 5 swing phases: <b>idle</b> (standing still), <b>backswing</b> (turn and pull back), <b>forward swing</b> (whip toward the ball), <b>follow-through</b> (racket keeps going after the hit), <b>recovery</b> (back to ready).</small></p>";

  function mountProblem(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, { fov: 36 }), THREE = base.THREE, V = base.V;
    var scene = base.scene, court = addCourt(base, theme);

    // dim translucent body
    var bodyMat = new THREE.MeshStandardMaterial({ color: th(theme, 'body', '#d6dcdf'), transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.8 });
    var bodyEdge = new THREE.MeshBasicMaterial({ color: th(theme, 'fg', '#10201a'), wireframe: true, transparent: true, opacity: 0.09 });
    var CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), SPH = new THREE.SphereGeometry(1, 12, 9), UP = new THREE.Vector3(0, 1, 0);
    function capsule(r) {
      var g = { c: new THREE.Mesh(CYL, bodyMat), a: new THREE.Mesh(SPH, bodyMat), b: new THREE.Mesh(SPH, bodyMat), w: new THREE.Mesh(CYL, bodyEdge) };
      scene.add(g.c); scene.add(g.a); scene.add(g.b); scene.add(g.w);
      var d = new THREE.Vector3();
      g.set = function (pa, pb) {
        var a = V(pa), b = V(pb); d.subVectors(b, a); var L = d.length() || 1e-4;
        g.c.position.addVectors(a, b).multiplyScalar(0.5); g.c.scale.set(r, L, r); g.c.quaternion.setFromUnitVectors(UP, d.divideScalar(L));
        g.w.position.copy(g.c.position); g.w.scale.copy(g.c.scale); g.w.quaternion.copy(g.c.quaternion);
        g.a.position.copy(a); g.a.scale.setScalar(r); g.b.position.copy(b); g.b.scale.setScalar(r);
      };
      return g;
    }
    var torso = capsule(0.13), shLine = capsule(0.05), neck = capsule(0.04), rUp = capsule(0.042), rLo = capsule(0.035),
        lUp = capsule(0.04), lLo = capsule(0.033), rTh = capsule(0.06), rSh = capsule(0.045), lTh = capsule(0.06), lSh = capsule(0.045);
    var headM = new THREE.Mesh(SPH, bodyMat); headM.scale.set(0.095, 0.115, 0.095); scene.add(headM);

    // lit, solid racket + glowing IMU
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.45, metalness: 0.1, emissive: '#000000' });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    var racket = makeRacket(base, rkMat, strMat); scene.add(racket);
    var imuMat = new THREE.MeshStandardMaterial({ color: th(theme, 'accent', '#d9b51f'), emissive: th(theme, 'accent', '#d9b51f'), emissiveIntensity: 0.9, roughness: 0.3 });
    var imu = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.042, 0.042), imuMat); imu.position.x = -SENSOR_OFFSET - 0.022; racket.add(imu);
    var imuAxes = makeAxes(base, 0.13, [phaseCol(theme, 2), phaseCol(theme, 4), phaseCol(theme, 1)]); imuAxes.position.x = -SENSOR_OFFSET - 0.022; racket.add(imuAxes);
    var halo = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshBasicMaterial({ color: th(theme, 'accent', '#d9b51f'), transparent: true, opacity: 0.18, depthWrite: false }));
    halo.position.x = -SENSOR_OFFSET - 0.022; racket.add(halo);

    // racket-head trail (only the racket is "seen")
    var TN = 70, tPos = new Float32Array(TN * 3), tCol = new Float32Array(TN * 3);
    var tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    var trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true })); trail.frustumCulled = false; scene.add(trail);

    // hidden joints: pulsing markers with "?" labels
    var JOINTS = [
      { key: 'pelvis', label: 'pelvis yaw', dof: 1 },
      { key: 'thorax', label: 'trunk yaw / tilt', dof: 3 },
      { key: 'shoulder', label: 'shoulder', dof: 3 },
      { key: 'elbow', label: 'elbow flex', dof: 1 },
      { key: 'forearm', label: 'pronation', dof: 1 },
      { key: 'wrist', label: 'wrist', dof: 2 }
    ];
    var qMat = new THREE.MeshBasicMaterial({ color: phaseCol(theme, 2), transparent: true, opacity: 0.85, depthTest: false });
    var ringMat = new THREE.MeshBasicMaterial({ color: phaseCol(theme, 2), transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide });
    var RING = new THREE.RingGeometry(0.045, 0.055, 24);
    JOINTS.forEach(function (j) {
      j.dot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), qMat); j.dot.renderOrder = 5; scene.add(j.dot);
      j.ring = new THREE.Mesh(RING, ringMat); j.ring.renderOrder = 5; scene.add(j.ring);
      j.tag = bubble(base);
      j.lead = base.el('div', 'position:absolute;left:0;top:0;height:1px;transform-origin:0 0;opacity:.7');
    });
    var imuTag = bubble(base);
    var LAYOUT = { pelvis: [-46, 18], thorax: [-46, -10], shoulder: [60, -64], elbow: [78, -34], forearm: [86, -4], wrist: [92, 26] };

    // comparison overlay
    var obs = card(base, 'left:12px;top:12px;width:min(46%,250px)');
    var want = card(base, 'right:12px;top:12px;width:min(46%,250px)');
    var gap = card(base, 'left:50%;transform:translateX(-50%);top:auto;bottom:' + (SAFE_BOTTOM + 8) + 'px;width:min(calc(100% - 24px),440px);text-align:center;padding:6px 10px');

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      bodyMat.color.set(th(t, 'body', '#d6dcdf')); bodyEdge.color.set(th(t, 'fg', '#10201a'));
      var rk = contrastPick(THREE, th(t, 'racket', '#1b2730'), th(t, 'fg', '#e2ebe6'), th(t, 'ground', '#3a7a62'));
      rkMat.color.set(rk); rkMat.emissive.set(rk).multiplyScalar(0.25);
      imuMat.color.set(th(t, 'accent', '#d9b51f')); imuMat.emissive.set(th(t, 'accent', '#d9b51f')); halo.material.color.set(th(t, 'accent', '#d9b51f'));
      imuAxes.userData.mats.forEach(function (m, i) { m.color.set(phaseCol(t, [2, 4, 1][i])); });
      qMat.color.set(phaseCol(t, 2)); ringMat.color.set(phaseCol(t, 2));
      styleCard(obs, t, th(t, 'accent', '#d9b51f')); styleCard(want, t, phaseCol(t, 2)); styleCard(gap, t, th(t, 'line', '#c6d3cc'));
      JOINTS.forEach(function (j) {
        j.tag.style.background = phaseCol(t, 2); j.tag.style.color = '#fff';
      });
      imuTag.style.background = th(t, 'accent', '#d9b51f'); imuTag.style.color = '#10201a';
    }
    applyTheme(theme);

    var want0 = '<div style="font-weight:700;letter-spacing:.08em;margin-bottom:3px">WHAT WE WANT</div>' +
      '<div style="opacity:.75;margin-bottom:4px">10+ body DoF</div>';
    var clock = 0, rate = ctx.reducedMotion ? 0.25 : 0.55, sway = 0, bgCol = new THREE.Color(), tc = new THREE.Color();

    function draw() {
      var t = clock % F.duration, s = F.sample(t, 0), k = fkS(s), nar = base.size().w < 520;
      // camera: gentle sway, framed for the aspect (narrow stages leave room for the cards above)
      var aspect = base.camera.aspect, ca = 0.55 + 0.18 * Math.sin(sway);
      var dir = new THREE.Vector3(Math.sin(ca), 0.32, Math.cos(ca)).normalize();
      base.frameCam(new THREE.Vector3(0.1, nar ? 1.3 : 1.08, 0.2), dir, aspect < 0.9 ? 2.3 : 2.0, nar ? 3.1 : 2.45);
      // body
      var trd = s.trunk * D2R, Ls = [-k.S[0], -k.S[1], 1.45], neckP = [0, 0, 1.45], pz = 0.9 - 0.05 * clamp(-s.trunk / 60, 0, 1);
      var py = 0.4 * trd, hipR = [0.11 * Math.sin(py), -0.11 * Math.cos(py), pz], hipL = [-hipR[0], -hipR[1], pz];
      torso.set([0, 0, pz + 0.08], [0, 0, 1.36]); shLine.set(k.S, Ls); neck.set(neckP, [0, 0, 1.55]);
      headM.position.copy(V([0.02, 0, 1.64]));
      var el = ik(k.S, k.H, 0.32, 0.32, [-0.3 * Math.cos(trd), -0.6, -1]);
      rUp.set(k.S, el); rLo.set(el, k.H);
      var fwd = [Math.cos(trd), Math.sin(trd), 0], lft = [-Math.sin(trd), Math.cos(trd), 0], ext = clamp(-s.trunk / 55, 0, 1);
      var lh = [Ls[0] + fwd[0] * (0.2 + 0.3 * ext) - lft[0] * 0.1, Ls[1] + fwd[1] * (0.2 + 0.3 * ext) - lft[1] * 0.1, 1.15 + 0.15 * ext];
      var lel = ik(Ls, lh, 0.32, 0.32, [-0.4 * Math.cos(trd), 0.6, -1]); lUp.set(Ls, lel); lLo.set(lel, lh);
      var fR = [-0.05, -0.42, 0.06], fL = [0.12, 0.38, 0.06];
      var kR = ik(hipR, fR, 0.46, 0.46, [1, -0.2, 0]), kL = ik(hipL, fL, 0.46, 0.46, [1, 0.25, 0]);
      rTh.set(hipR, kR); rSh.set(kR, fR); lTh.set(hipL, kL); lSh.set(kL, fL);
      racket.userData.setPose(k.H, k.R);
      // joint marker positions
      var pos = { pelvis: [0, 0, pz + 0.02], thorax: [0, 0, 1.25], shoulder: k.S, elbow: el,
                  forearm: [(el[0] + k.H[0]) / 2, (el[1] + k.H[1]) / 2, (el[2] + k.H[2]) / 2], wrist: k.H };
      var narrow = base.size().w < 520, hi = Math.floor(clock * 0.9) % JOINTS.length;
      JOINTS.forEach(function (j, i) {
        var p = V(pos[j.key]), ph = clock * 3.2 + i * 1.05, pulse = 0.5 + 0.5 * Math.sin(ph);
        j.dot.position.copy(p); j.ring.position.copy(p); j.ring.lookAt(base.camera.position);
        var sc = 1 + 0.9 * pulse * (ctx.reducedMotion ? 0.3 : 1); j.ring.scale.setScalar(sc + (i === hi ? 0.6 : 0));
        j.tag.textContent = narrow ? '?' : '? ' + j.label;
        j.tag.style.opacity = (0.55 + 0.45 * pulse).toFixed(2);
        j.tag.style.outline = i === hi ? '2px solid ' + th(theme, 'fg', '#10201a') : 'none';
        // staggered label column with a leader line, so close joints do not pile up
        var L = LAYOUT[j.key], dx = L[0] < 0 ? L[0] - (narrow ? 18 : j.tag.offsetWidth) : L[0], dy = L[1];
        var vis = base.place(j.tag, p, dx, dy - 9);
        if (vis) {
          var lx = L[0] < 0 ? dx + j.tag.offsetWidth : dx, ly = dy;
          var len = Math.hypot(lx, ly), ang = Math.atan2(ly, lx);
          base.place(j.lead, p, 0, 0);
          j.lead.style.width = len.toFixed(1) + 'px';
          j.lead.style.transform += ' rotate(' + ang.toFixed(3) + 'rad)';
          j.lead.style.background = phaseCol(theme, 2);
        } else j.lead.style.display = 'none';
      });
      imuTag.textContent = narrow ? 'IMU' : 'IMU · 12 cm below hand';
      base.place(imuTag, V(k.sensor), 14, 40);
      halo.scale.setScalar(1 + 0.25 * Math.sin(clock * 6));
      // trail
      bgCol.set(th(theme, 'bg', '#dfe8e3'));
      for (var i = 0; i < TN; i++) {
        var age = i / (TN - 1), ti = t - 0.55 * (1 - age), si = F.sample(ti, 0), hp = V(fkS(si).head);
        tPos[3 * i] = hp.x; tPos[3 * i + 1] = hp.y; tPos[3 * i + 2] = hp.z;
        tc.set(phaseCol(theme, si.phase)); tc.lerp(bgCol, 0.85 * (1 - age));
        tCol[3 * i] = tc.r; tCol[3 * i + 1] = tc.g; tCol[3 * i + 2] = tc.b;
      }
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
      // overlay text
      var acc = th(theme, 'accent', '#d9b51f'), mut = th(theme, 'muted', '#56685f');
      if (nar) {
        obs.innerHTML = '<div style="font-weight:700;letter-spacing:.06em">OBSERVE</div>' +
          '<div><b style="color:' + acc + '">3</b> orientation DoF</div><div><b style="color:' + acc + '">3D</b> force · ' + s.accMag.toFixed(1) + ' g</div>';
        want.innerHTML = '<div style="font-weight:700;letter-spacing:.06em">WANT: 10+ DoF</div>' +
          '<div>' + JOINTS.map(function (j, i) { return '<span style="white-space:nowrap' + (i === hi ? ';font-weight:700' : '') + '">' + j.label.split(' ')[0] + '<span style="color:' + phaseCol(theme, 2) + '">?</span></span>'; }).join(' ') + '</div>';
        gap.innerHTML = 'α = trunk + shoulder + wrist = <b>' + fmt(s.alpha, 0) + '°</b><br><span style="color:' + mut + '">only the sum reaches the racket</span>';
      } else {
      obs.innerHTML = '<div style="font-weight:700;letter-spacing:.08em;margin-bottom:3px">WHAT WE OBSERVE</div>' +
        '<div style="opacity:.75;margin-bottom:4px">1 IMU on the butt cap</div>' +
        '<div><b style="color:' + acc + '">3</b> orientation DoF</div>' +
        '<div style="padding-left:8px">elev ' + fmt(s.rkElev, 0) + '° · roll ' + fmt(s.roll, 0) + '°</div>' +
        '<div style="padding-left:8px;color:' + mut + '">heading: drifts, relative only</div>' +
        '<div><b style="color:' + acc + '">3D</b> force · |a| ' + s.accMag.toFixed(1) + ' g</div>' +
        '<div style="color:' + mut + '">+ 3D rate · |ω| ' + Math.round(s.gyroMag) + ' °/s</div>';
      var rows = JOINTS.map(function (j, i) {
        return '<div style="display:flex;justify-content:space-between;gap:6px' + (i === hi ? ';font-weight:700' : '') + '"><span>' + j.label + ' ×' + j.dof +
          '</span><span style="color:' + phaseCol(theme, 2) + '">?</span></div>';
      }).join('');
      want.innerHTML = want0 + rows + '<div style="color:' + mut + ';margin-top:3px">+ X-factor, stance, weight transfer</div>';
      gap.innerHTML = 'racket heading α = trunk + shoulder + wrist = <b>' + fmt(s.alpha, 0) + '°</b>' +
        '<br><span style="color:' + mut + '">trunk ' + fmt(s.trunk, 0) + '° · shoulder ' + fmt(s.shoulder, 0) + '° · wrist ' + fmt(s.wrist, 0) +
        '°: the sensor only sees the sum</span>';
      }
      base.renderer.render(scene, base.camera);
    }
    draw();
    return {
      frame: function (dt) { clock += dt * rate; sway += dt * (ctx.reducedMotion ? 0 : 0.25); draw(); },
      resize: function () { base.resize(); draw(); },
      setTheme: function (t) { applyTheme(t); draw(); },
      dispose: function () { base.dispose(); }
    };
  }

  /* ================================================================ CHAPTER 2: the simulator */
  var BODY2 = "<p><b>There is no real data, so we made our own.</b></p><p>Nobody has published data with both a racket sensor and real body measurements. So we built <b>12 pretend players</b> in software, each hitting 60 forehands. They differ like real people do: some turn their body a lot, some use more arm, some swing faster, some have longer arms.</p><p>Because we built them, we know the right answer for every swing, so we can grade ourselves. <small>The catch: real players will be messier, so these scores are a best case.</small></p>";

  function makePlayers() {
    var r = rng(20240612), out = [];
    function U(a, b) { return a + (b - a) * r(); }
    for (var i = 0; i < 12; i++) {
      var p = { pid: i + 1, coil: U(55, 105), sh_bs: U(5, 35), sh_ft: U(35, 75), wrist_lag: U(8, 28), arm_len: U(0.55, 0.70), tempo: U(0.8, 1.25) };
      p.share = p.sh_bs / (p.coil + p.sh_bs);
      out.push(p);
    }
    return out;
  }
  // a player's angles at time t: F.sample's representative stroke rescaled by the player's ranges
  function playerAngles(F, p, t) {
    var s = F.sample(t, 0);
    var tr = s.trunk < 0 ? s.trunk * p.coil / 80 : s.trunk;
    var sh = s.shoulder < 0 ? s.shoulder * p.sh_bs / 20 : s.shoulder * p.sh_ft / 55;
    var wr = s.wrist < 0 ? s.wrist * p.wrist_lag / 18 : s.wrist;
    return { s: s, trunk: tr, shoulder: sh, wrist: wr, k: fk(tr, sh, wr, s.armElev, s.rkElev, s.roll, p.arm_len) };
  }

  function mountSimulator(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, { fov: 34 }), THREE = base.THREE, V = base.V, scene = base.scene;
    var court = addCourt(base, theme);
    var players = makePlayers();

    /* --- exploded kinematic chain (three.js coordinates, laid out along x) */
    var chainG = new THREE.Group(); scene.add(chainG);
    var NODES = [
      { key: 'trunk', name: 'trunk yaw', axis: 'y' },
      { key: 'shoulder', name: 'shoulder', axis: 'y' },
      { key: 'armElev', name: 'arm elevation', axis: 'z' },
      { key: 'wrist', name: 'wrist lag', axis: 'y' },
      { key: 'racket', name: 'racket', axis: 'r' },
      { key: 'imu', name: 'IMU', axis: 'r' }
    ];
    var ringMat = new THREE.MeshBasicMaterial({ color: '#888', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    var hubMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.5 });
    var linkMat = new THREE.MeshBasicMaterial({ color: '#888', transparent: true, opacity: 0.6 });
    var pulseMat = new THREE.MeshBasicMaterial({ color: '#d9b51f' });
    var RING = new THREE.RingGeometry(0.3, 0.315, 48), HUB = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16);
    var needleMats = [];
    NODES.forEach(function (n, i) {
      n.g = new THREE.Group(); chainG.add(n.g);
      if (n.axis !== 'r') {
        var tilt = new THREE.Group(); n.g.add(tilt); n.tilt = tilt;
        if (n.axis === 'y') tilt.rotation.x = 0.55; // tip horizontal dials toward the camera
        var ring = new THREE.Mesh(RING, ringMat); tilt.add(ring);
        var hub = new THREE.Mesh(HUB, hubMat); tilt.add(hub);
        if (n.axis === 'y') { ring.rotation.x = -Math.PI / 2; } else { hub.rotation.x = Math.PI / 2; }
        var nm = new THREE.MeshBasicMaterial({ color: '#d9502b' }); needleMats.push(nm);
        var spin = new THREE.Group(); tilt.add(spin); n.spin = spin;
        var needle = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.03), nm); needle.position.x = 0.145; spin.add(needle);
        var zeroM = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.008, 0.008), ringMat); zeroM.position.x = 0.15; tilt.add(zeroM);
        if (n.axis === 'y') { needle.rotation.set(0, 0, 0); } else { spin.rotation.set(0, 0, 0); }
        // swept arc (fan) showing the current angle
        n.fanMat = new THREE.MeshBasicMaterial({ color: '#d9502b', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
        n.fan = new THREE.Mesh(new THREE.CircleGeometry(0.29, 40, 0, 0.01), n.fanMat);
        if (n.axis === 'y') n.fan.rotation.x = -Math.PI / 2;
        tilt.add(n.fan);
      }
    });
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.45 });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    var miniRk = makeRacket(base, rkMat, strMat); miniRk.scale.setScalar(0.9); NODES[4].g.add(miniRk);
    var imuMat = new THREE.MeshStandardMaterial({ color: '#d9b51f', emissive: '#d9b51f', emissiveIntensity: 0.6, roughness: 0.35 });
    var imuBox = new THREE.Group(); NODES[5].g.add(imuBox);
    imuBox.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.18), imuMat));
    var imuAxes = makeAxes(base, 0.32, ['#d9502b', '#4fae7a', '#2f7dbf']); imuBox.add(imuAxes);
    // links + energy pulses
    var links = [];
    for (var li = 0; li < NODES.length - 1; li++) {
      var lk = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6), linkMat); chainG.add(lk);
      var pu = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), pulseMat); chainG.add(pu);
      links.push({ m: lk, p: pu });
    }
    var tags = NODES.map(function () { return bubble(base); });
    var arrows = NODES.slice(1).map(function () { var e = base.el('div', 'position:absolute;left:0;top:0;font:13px ui-monospace,monospace'); e.textContent = '→'; return e; });

    /* --- 12 player ribbons */
    var ribG = new THREE.Group(); scene.add(ribG);
    var NS = 110, ribs = [];
    var ribMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
    var padMat = new THREE.MeshStandardMaterial({ color: '#2d6a55', roughness: 0.9, transparent: true, opacity: 0.55 });
    var beadMat = new THREE.MeshBasicMaterial({ color: '#d9b51f' });
    var PAD = new THREE.CircleGeometry(0.42, 32), BEAD = new THREE.SphereGeometry(0.03, 10, 8);
    var SC = 0.38;
    players.forEach(function (p) {
      var g = new THREE.Group(); ribG.add(g);
      var pad = new THREE.Mesh(PAD, padMat); pad.rotation.x = -Math.PI / 2; pad.position.y = 0.004; g.add(pad);
      var pos = new Float32Array(NS * 2 * 3), col = new Float32Array(NS * 2 * 3), idx = [], phases = [];
      var D = F.duration, i;
      for (i = 0; i < NS; i++) {
        var pa = playerAngles(F, p, F.phases[1].t0 - 0.05 + (F.phases[4].t1 - F.phases[1].t0) * i / (NS - 1));
        var h = pa.k.head, hv = V([h[0] * SC, h[1] * SC, (h[2] - 0.55) * SC]);
        var w = 0.012 + 0.03 * clamp(pa.s.gyroMag / 1200, 0, 1); // wider = faster
        pos.set([hv.x, hv.y + w, hv.z, hv.x, hv.y - w, hv.z], i * 6);
        phases.push(pa.s.phase);
        if (i < NS - 1) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
      var mesh = new THREE.Mesh(geo, ribMat.clone()); g.add(mesh);
      var bead = new THREE.Mesh(BEAD, beadMat); g.add(bead);
      var tag = base.el('div', 'position:absolute;left:0;top:0;font:10px ui-monospace,monospace;white-space:nowrap');
      ribs.push({ p: p, g: g, mesh: mesh, geo: geo, phases: phases, bead: bead, tag: tag, D: D * p.tempo, phaseOff: p.pid * 0.37 });
    });

    // overlays
    var read = card(base, 'left:12px;top:12px;width:min(44%,230px)');
    var info = card(base, 'right:12px;top:12px;width:min(46%,250px)');

    function layoutRibbons() {
      var a = base.camera.aspect, cols = a < 1 ? 4 : 6, rows = 12 / cols, sx = a < 1 ? 1.15 : 1.05, sz = 0.95;
      ribs.forEach(function (r, i) {
        var c = i % cols, rr = Math.floor(i / cols);
        r.g.position.set((c - (cols - 1) / 2) * sx, 0, (a < 1 ? 1.6 : 1.25) + rr * sz);
      });
      var spread = a < 1 ? 1.25 : 1.15;
      NODES.forEach(function (n, i) { n.base = new THREE.Vector3((i - 2.5) * spread, 1.3 + (i % 2 ? 0.1 : -0.04), -0.1); });
      return { w: Math.max(cols * sx, 6 * spread + 0.6), rows: rows };
    }
    var lay = layoutRibbons();

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      ringMat.color.set(th(t, 'fg', '#10201a')); linkMat.color.set(th(t, 'muted', '#56685f'));
      var rk = contrastPick(THREE, th(t, 'racket', '#1b2730'), th(t, 'fg', '#e2ebe6'), th(t, 'bg', '#dfe8e3'));
      hubMat.color.set(rk); rkMat.color.set(rk);
      pulseMat.color.set(th(t, 'accent', '#d9b51f')); beadMat.color.set(th(t, 'accent', '#d9b51f'));
      imuMat.color.set(th(t, 'accent', '#d9b51f')); imuMat.emissive.set(th(t, 'accent', '#d9b51f'));
      imuAxes.userData.mats.forEach(function (m, i) { m.color.set(phaseCol(t, [2, 4, 1][i])); });
      padMat.color.set(th(t, 'ground', '#3a7a62')).multiplyScalar(0.8);
      NODES.forEach(function (n, i) { if (n.fanMat) n.fanMat.color.set(phaseCol(t, 1 + (i % 4))); });
      needleMats.forEach(function (m, i) { m.color.set(phaseCol(t, 1 + (i % 4))); });
      var c = new THREE.Color();
      ribs.forEach(function (r) {
        var col = r.geo.attributes.color.array;
        r.phases.forEach(function (ph, i) { c.set(phaseCol(t, ph)); col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6); });
        r.geo.attributes.color.needsUpdate = true;
        r.tag.style.color = th(t, 'fg', '#10201a');
      });
      tags.forEach(function (e) { e.style.background = hexA(th(t, 'bg', '#dfe8e3'), 0.9); e.style.color = th(t, 'fg', '#10201a'); e.style.border = '1px solid ' + th(t, 'line', '#c6d3cc'); });
      arrows.forEach(function (e) { e.style.color = th(t, 'muted', '#56685f'); });
      styleCard(read, t, phaseCol(t, 1)); styleCard(info, t, th(t, 'accent', '#d9b51f'));
    }
    applyTheme(theme);

    var clock = 0, rate = ctx.reducedMotion ? 0.2 : 0.5, sway = 0, tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
    function draw() {
      var t = clock % F.duration, s = F.sample(t, 0), k = fkS(s), narrow = base.size().w < 560;
      // camera: frame chain (middle band) and ribbon grid (front floor), leaving the top for the cards
      var ca = 0.12 * Math.sin(sway);
      base.frameCam(new THREE.Vector3(0, narrow ? 1.35 : 1.05, 0.9), new THREE.Vector3(Math.sin(ca), 0.62, Math.cos(ca)).normalize(), lay.w + 0.4, lay.rows > 2 ? 5.6 : 4.3);
      var vals = { trunk: s.trunk, shoulder: s.shoulder, armElev: s.armElev, wrist: s.wrist };
      var explode = ctx.reducedMotion ? 0 : 0.06 * Math.sin(clock * 0.9);
      NODES.forEach(function (n, i) {
        n.g.position.copy(n.base).addScaledVector(new THREE.Vector3(i - 2.5, 0, 0), explode);
        if (n.spin) {
          var a = vals[n.key] * D2R;
          if (n.axis === 'y') { n.spin.rotation.y = a; n.fan.geometry.dispose(); n.fan.geometry = new THREE.CircleGeometry(0.29, 32, Math.min(0, a), Math.abs(a) + 1e-3); }
          else { n.spin.rotation.z = a; n.fan.geometry.dispose(); n.fan.geometry = new THREE.CircleGeometry(0.29, 32, Math.min(0, a), Math.abs(a) + 1e-3); }
        }
      });
      // racket + IMU nodes show the full racket orientation (heading alpha, elevation, roll)
      var M4 = new THREE.Matrix4(), R = k.R;
      M4.makeBasis(V([R[0][0], R[1][0], R[2][0]]), V([R[0][1], R[1][1], R[2][1]]), V([R[0][2], R[1][2], R[2][2]]));
      miniRk.quaternion.setFromRotationMatrix(M4); // pivot at the hand
      imuBox.quaternion.setFromRotationMatrix(M4);
      // links and kinetic-chain pulses (proximal -> distal, peaking in the forward swing)
      var fwdPhase = s.phase === 2 || s.phase === 1;
      links.forEach(function (l, i) {
        tmpA.copy(NODES[i].g.position); tmpB.copy(NODES[i + 1].g.position);
        var d = tmpB.clone().sub(tmpA), L = d.length();
        l.m.position.copy(tmpA).add(tmpB).multiplyScalar(0.5); l.m.scale.set(1, Math.max(0.01, L - 0.64), 1);
        l.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
        var u = ((clock * (fwdPhase ? 2.4 : 0.8)) - i * 0.18) % 1; if (u < 0) u += 1;
        l.p.position.copy(tmpA).addScaledVector(d, 0.2 + 0.6 * u);
        l.p.scale.setScalar(fwdPhase ? 1.3 : 0.8);
      });
      var lbl = {
        trunk: fmt(s.trunk), shoulder: fmt(s.shoulder), armElev: fmt(s.armElev), wrist: fmt(s.wrist),
        racket: 'α ' + fmt(s.alpha, 0) + '°', imu: '|ω| ' + Math.round(s.gyroMag)
      };
      NODES.forEach(function (n, i) {
        var unit = n.axis === 'r' ? '' : '°';
        tags[i].innerHTML = narrow ? '<b>' + lbl[n.key] + unit + '</b><br><span style="opacity:.75">' + ['trunk', 'shldr', 'arm', 'wrist', 'racket', 'IMU'][i] + '</span>' : '<span style="opacity:.75">' + n.name + '</span> <b>' + lbl[n.key] + unit + '</b>';
        base.place(tags[i], tmpA.copy(n.g.position).add(new THREE.Vector3(0, -0.36, 0)), -tags[i].offsetWidth / 2, narrow && i % 2 ? 26 : 2);
        if (i > 0 && narrow) arrows[i - 1].style.display = 'none';
        else if (i > 0) base.place(arrows[i - 1], tmpA.copy(NODES[i - 1].g.position).lerp(n.g.position, 0.5).add(new THREE.Vector3(0, 0.12, 0)), -5, -10);
      });
      // ribbons
      var hi = Math.floor(clock / 2.6) % 12;
      ribs.forEach(function (r, i) {
        var lt = ((clock * (ctx.reducedMotion ? 0.5 : 1) + r.phaseOff) / r.p.tempo) % F.duration;
        var pa = playerAngles(F, r.p, lt), h = pa.k.head;
        r.bead.position.copy(V([h[0] * SC, h[1] * SC, (h[2] - 0.55) * SC]));
        r.mesh.material.opacity = i === hi ? 1 : 0.55;
        r.g.scale.setScalar(i === hi ? 1.12 : 1);
        r.tag.textContent = 'P' + (r.p.pid < 10 ? '0' : '') + r.p.pid + (narrow ? '' : ' · ' + Math.round(r.p.coil) + '°');
        r.tag.style.fontWeight = i === hi ? '700' : '400';
        base.place(r.tag, tmpA.copy(r.g.position).add(new THREE.Vector3(0, 0, 0.42)), -r.tag.offsetWidth / 2, 2);
      });
      var hp = ribs[hi].p, mut = th(theme, 'muted', '#56685f');
      if (narrow) {
        read.innerHTML = '<div style="font-weight:700;letter-spacing:.06em">CHAIN</div><div>α ' + fmt(s.alpha, 0) + '° =</div><div>' + fmt(s.trunk, 0) + ' ' + fmt(s.shoulder, 0) + ' ' + fmt(s.wrist, 0) + '</div>' +
          '<div style="color:' + mut + '">trunk · shldr · wrist</div>';
        info.innerHTML = '<div style="font-weight:700;letter-spacing:.06em">12×2×30</div><div>P' + (hp.pid < 10 ? '0' : '') + hp.pid + ' coil ' + Math.round(hp.coil) + '°</div>' +
          '<div>share ' + Math.round(100 * hp.share) + '% · ' + hp.tempo.toFixed(2) + '×</div>';
      } else {
      read.innerHTML = '<div style="font-weight:700;letter-spacing:.08em;margin-bottom:3px">CHAIN · LIVE</div>' +
        '<div>' + F.phases[s.phase].name + ' · t ' + t.toFixed(2) + ' s</div>' +
        '<div style="margin-top:3px">α = trunk + shoulder + wrist</div>' +
        '<div><b>' + fmt(s.alpha, 0) + '°</b> = ' + fmt(s.trunk, 0) + ' ' + fmt(s.shoulder, 0) + ' ' + fmt(s.wrist, 0) + '</div>' +
        '<div style="color:' + mut + '">racket elev ' + fmt(s.rkElev, 0) + '° · roll ' + fmt(s.roll, 0) + '°</div>' +
        '<div style="color:' + mut + '">|a| ' + s.accMag.toFixed(1) + ' g · |ω| ' + Math.round(s.gyroMag) + ' °/s</div>';
      info.innerHTML = '<div style="font-weight:700;letter-spacing:.08em;margin-bottom:3px">12 × 2 × 30 = 720 FOREHANDS</div>' +
        '<div>P' + (hp.pid < 10 ? '0' : '') + hp.pid + ' · coil <b>' + Math.round(hp.coil) + '°</b></div>' +
        '<div>shoulder share <b>' + Math.round(100 * hp.share) + '%</b> · tempo <b>' + hp.tempo.toFixed(2) + '×</b></div>' +
        '<div>wrist lag ' + Math.round(hp.wrist_lag) + '° · arm ' + hp.arm_len.toFixed(2) + ' m</div>' +
        '<div style="color:' + mut + ';margin-top:3px">ribbon = racket-head path, width = speed</div>';
      }
      base.renderer.render(scene, base.camera);
    }
    draw();
    return {
      frame: function (dt) { clock += dt * rate; sway += dt * (ctx.reducedMotion ? 0 : 0.3); draw(); },
      resize: function () { base.resize(); lay = layoutRibbons(); draw(); },
      setTheme: function (t) { applyTheme(t); draw(); },
      dispose: function () { base.dispose(); }
    };
  }

  /* ================================================================ CHAPTER 3: sensor + link corruption */
  var BODY3 = "<p><b>Real sensors are messy, so we made ours messy on purpose.</b></p><p>The pretend sensor behaves like a real one. It is a little noisy, it maxes out when the ball hits hard, and its “compass” slowly drifts, so it never knows which way the court faces.</p><p>The Bluetooth link sometimes drops data for a split second. We also mixed in fake “not a swing” moments, like twirling the racket or bouncing the ball, so the system has to learn to ignore them.</p>";

  function mountSensor(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, { fov: 34 }), THREE = base.THREE, V = base.V, scene = base.scene;
    var court = addCourt(base, theme);
    var CT = F.contactTime, PKT = 0.02; // 4 samples @ 200 Hz per packet
    var NP = Math.floor(F.duration / PKT);

    // IMU on the racket (left) and the phone (right), three.js coordinates
    var imuPos = new THREE.Vector3(-2.0, 1.45, 0), phonePos = new THREE.Vector3(2.15, 1.05, 0.1);
    var imuG = new THREE.Group(); imuG.position.copy(imuPos); scene.add(imuG);
    var imuMat = new THREE.MeshStandardMaterial({ color: '#d9b51f', emissive: '#d9b51f', emissiveIntensity: 0.35, roughness: 0.35 });
    var imuBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), imuMat); imuG.add(imuBox);
    var edgeMat = new THREE.LineBasicMaterial({ color: '#10201a' });
    imuBox.add(new THREE.LineSegments(new THREE.EdgesGeometry(imuBox.geometry), edgeMat));
    var axes = makeAxes(base, 0.75, ['#d9502b', '#4fae7a', '#2f7dbf']); imuG.add(axes);
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.5, transparent: true, opacity: 0.55 });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    var rk = makeRacket(base, rkMat, strMat); rk.scale.setScalar(1.5); rk.position.set(0, 0, 0);
    var rkPivot = new THREE.Group(); imuG.add(rkPivot); rkPivot.add(rk); rk.position.x = 0.18; // butt cap at IMU
    var shockMat = new THREE.MeshBasicMaterial({ color: '#d9502b', transparent: true, opacity: 0, depthWrite: false });
    var shock = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), shockMat); imuG.add(shock);

    var phoneG = new THREE.Group(); phoneG.position.copy(phonePos); scene.add(phoneG);
    var phoneMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.4 });
    var phone = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.82, 0.06), phoneMat); phoneG.add(phone);
    var screenMat = new THREE.MeshBasicMaterial({ color: '#2d6a55' });
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.7), screenMat); screen.position.z = 0.031; phoneG.add(screen);
    var flashMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0 });
    var flash = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.7), flashMat); flash.position.z = 0.033; phoneG.add(flash);
    phoneG.rotation.y = -0.35;

    // flight path (quadratic bezier) drawn as dashed-ish dots
    var ctrl = new THREE.Vector3(0.1, 2.55, 0.2);
    function bez(u, out) {
      var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      return out.set(a * imuPos.x + b * ctrl.x + c * phonePos.x, a * imuPos.y + b * ctrl.y + c * phonePos.y, a * imuPos.z + b * ctrl.z + c * phonePos.z);
    }
    var dotsPos = [], tv = new THREE.Vector3();
    for (var di = 2; di < 40; di++) { bez(di / 41, tv); dotsPos.push(tv.x, tv.y, tv.z); }
    var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dotsPos, 3));
    var dotMat = new THREE.PointsMaterial({ color: '#56685f', size: 0.035 });
    scene.add(new THREE.Points(dg, dotMat));

    // corrupted |a| model (g): kinematic specific force + impact ring (15-35 g, 8 samples) + noise, clipped at 16 g
    function impact(t, A) {
      var k = (t - CT) * 200; if (k < 0 || k >= 8) return 0;
      return A * Math.abs(Math.exp(-k / 1.5) * Math.cos(2 * Math.PI * 0.42 * Math.floor(k)));
    }
    function distractor(kind, t) { // additive joint offsets over the first 0.5 s (idle); seamless at the loop seam
      if (t > 0.5) return null;
      var u = t / 0.5, w = Math.pow(Math.sin(Math.PI * u), 2);
      if (kind === 0) return { roll: 360 * (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)) };
      if (kind === 1) return { rkElev: -30 * w + 4 * w * Math.sin(2 * Math.PI * 2.5 * t * 2) };
      return { yaw: -25 * w };
    }
    // per-loop schedule: drops (Gilbert-Elliott bursts + one long 150-400 ms gap), jitter, saturation
    var sched = {};
    function schedule(loop) {
      if (sched[loop]) return sched[loop];
      var r = rng(9001 + loop * 7919), pk = [], i, bad = false, pbg = 0.5, drop = 0.06, pgb = drop * pbg / (1 - drop);
      var A = 15 + 20 * r();
      for (i = 0; i < NP; i++) {
        bad = bad ? r() < 1 - pbg : r() < pgb;
        pk.push({ drop: bad, jit: (r() - 0.5), wob: r() < 0.22, sat: false, amax: 0 });
      }
      var gapLen = Math.round((0.15 + 0.25 * r()) / PKT), avoid = Math.round(CT / PKT);
      var g0 = Math.floor(r() * (NP - gapLen));
      if (Math.abs(g0 + gapLen / 2 - avoid) < gapLen / 2 + 6) g0 = (avoid + gapLen + 10) % (NP - gapLen); // keep the impact visible
      for (i = g0; i < g0 + gapLen; i++) pk[i].drop = true;
      for (i = 0; i < NP; i++) {
        var m = 0;
        for (var j = 0; j < 4; j++) { var ts = (i * 4 + j) / 200; m = Math.max(m, F.sample(ts, 0).accMag + impact(ts, A)); }
        pk[i].amax = m; pk[i].sat = m >= 16;
      }
      var res = { pk: pk, A: A, gap: [g0 * PKT, (g0 + gapLen) * PKT], kind: loop % 3 };
      sched[loop] = res;
      for (var key in sched) if (+key < loop - 2) delete sched[key];
      return res;
    }
    function accAt(T) { // T = global sim time; returns {a (clipped), raw, recv}
      var loop = Math.floor(T / F.duration), t = T - loop * F.duration, sc = schedule(loop);
      var raw = F.sample(t, 0).accMag + impact(t, sc.A) + 0.03 * Math.sin(T * 731) + 0.02 * Math.sin(T * 1913);
      var pi = Math.min(NP - 1, Math.floor(t / PKT));
      return { raw: raw, a: Math.min(raw, 16), recv: !sc.pk[pi].drop };
    }

    // packet pool
    var PSIZE = 72, pool = [], PG = new THREE.BoxGeometry(0.085, 0.085, 0.085);
    var pMats = { ok: new THREE.MeshStandardMaterial({ color: '#2f7dbf', roughness: 0.4 }), jit: new THREE.MeshStandardMaterial({ color: '#d9b51f', roughness: 0.4 }),
                  sat: new THREE.MeshStandardMaterial({ color: '#d9502b', emissive: '#d9502b', emissiveIntensity: 0.5, roughness: 0.4 }),
                  drop: new THREE.MeshStandardMaterial({ color: '#8a9a94', transparent: true, opacity: 0.8, roughness: 0.8 }) };
    for (var pi0 = 0; pi0 < PSIZE; pi0++) { var mm0 = new THREE.Mesh(PG, pMats.ok); mm0.visible = false; scene.add(mm0); pool.push({ m: mm0, live: false }); }

    // overlays: spec chips, legend + counters, |a| trace canvas, heading dial
    var spec = card(base, 'left:12px;top:12px;width:min(48%,260px)');
    var dialBox = card(base, 'right:12px;top:12px;width:132px;padding:6px');
    var dial = document.createElement('canvas'); dial.style.cssText = 'display:block;width:120px;height:120px'; dialBox.appendChild(dial);
    var dialCap = document.createElement('div'); dialCap.style.cssText = 'font:10px/1.35 ui-monospace,monospace;margin-top:3px'; dialBox.appendChild(dialCap);
    var traceBox = card(base, 'left:12px;right:12px;bottom:' + (SAFE_BOTTOM + 6) + 'px;height:104px;padding:4px 6px');
    var trace = document.createElement('canvas'); trace.style.cssText = 'display:block;width:100%;height:94px'; traceBox.appendChild(trace);
    var tagImu = bubble(base), tagPhone = bubble(base), tagDist = bubble(base), tagShock = bubble(base);

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      imuMat.color.set(th(t, 'accent', '#d9b51f')); imuMat.emissive.set(th(t, 'accent', '#d9b51f'));
      edgeMat.color.set(th(t, 'fg', '#10201a'));
      axes.userData.mats.forEach(function (m, i) { m.color.set(phaseCol(t, [2, 4, 1][i])); });
      var rc = contrastPick(THREE, th(t, 'racket', '#1b2730'), th(t, 'fg', '#e2ebe6'), th(t, 'bg', '#dfe8e3'));
      rkMat.color.set(rc); phoneMat.color.set(rc);
      screenMat.color.set(th(t, 'ground', '#3a7a62'));
      shockMat.color.set(phaseCol(t, 2)); dotMat.color.set(th(t, 'muted', '#56685f'));
      pMats.ok.color.set(phaseCol(t, 1)); pMats.jit.color.set(phaseCol(t, 3)); pMats.sat.color.set(phaseCol(t, 2)); pMats.sat.emissive.set(phaseCol(t, 2));
      pMats.drop.color.set(phaseCol(t, 0));
      styleCard(spec, t, th(t, 'accent', '#d9b51f')); styleCard(dialBox, t, phaseCol(t, 1)); styleCard(traceBox, t, phaseCol(t, 2));
      [tagImu, tagPhone].forEach(function (e) { e.style.background = hexA(th(t, 'bg', '#dfe8e3'), 0.9); e.style.color = th(t, 'fg', '#10201a'); e.style.border = '1px solid ' + th(t, 'line', '#c6d3cc'); });
      tagDist.style.background = phaseCol(t, 0); tagDist.style.color = '#fff';
      tagShock.style.background = phaseCol(t, 2); tagShock.style.color = '#fff';
    }
    applyTheme(theme);

    // AHRS heading: arbitrary start + drift (0.3 deg/s here) + random walk 0.3 deg/sqrt(s); session clock x10 for visibility
    var hr = rng(77), psi0 = 360 * hr(), driftRate = 0.3, walk = 0, sess = 0;
    var T = 0, rate = ctx.reducedMotion ? 0.08 : 0.3, emitted = -1, stats = { sent: 0, drop: 0, sat: 0, jit: 0 };
    var lastLoop = -1, Mq = new THREE.Matrix4();

    function spawn(globalIdx) {
      var loop = Math.floor(globalIdx / NP), i = globalIdx - loop * NP, sc = schedule(loop), info = sc.pk[i];
      var slot = null;
      for (var k = 0; k < pool.length; k++) if (!pool[k].live) { slot = pool[k]; break; }
      stats.sent++; if (info.drop) stats.drop++; else if (info.sat) stats.sat++; else if (info.wob) stats.jit++;
      if (!slot) return;
      slot.live = true; slot.age = 0; slot.info = info; slot.dur = 1.5 * (1 + 0.12 * info.jit); slot.fall = null;
      slot.m.material = info.drop ? pMats.drop : info.sat ? pMats.sat : info.wob ? pMats.jit : pMats.ok;
      slot.m.visible = true; slot.m.scale.set(1, info.sat ? 0.55 : 1, 1); slot.m.position.copy(imuPos);
      slot.dropAt = 0.3 + 0.35 * ((i * 37) % 10) / 10; slot.seed = i;
    }
    function stepPackets(dtDisp) {
      pool.forEach(function (p) {
        if (!p.live) return;
        p.age += dtDisp;
        var u = p.age / p.dur;
        if (p.info.drop && u >= p.dropAt) {
          if (!p.fall) { p.fall = { v: new THREE.Vector3(0.15, 0.4, 0.2), pos: p.m.position.clone() }; }
          p.fall.v.y -= 3.2 * dtDisp; p.fall.pos.addScaledVector(p.fall.v, dtDisp);
          if (p.fall.pos.y < 0.045) { p.fall.pos.y = 0.045; p.fall.v.set(0, 0, 0); }
          p.m.position.copy(p.fall.pos); p.m.rotation.x += dtDisp * 3; p.m.rotation.z += dtDisp * 2;
          if (p.age > p.dur * p.dropAt + 1.6) { p.live = false; p.m.visible = false; }
          return;
        }
        if (u >= 1) { p.live = false; p.m.visible = false; flashMat.opacity = Math.min(0.5, flashMat.opacity + 0.12); return; }
        bez(u, p.m.position);
        if (p.info.wob) p.m.position.y += 0.07 * Math.sin(u * 28 + p.seed);
        p.m.rotation.set(u * 4, u * 3, 0);
      });
    }

    var dctx = dial.getContext && dial.getContext('2d'), tctx = trace.getContext && trace.getContext('2d');
    function drawDial(alphaTrue, alphaRep) {
      if (!dctx) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2), S = 120;
      if (dial.width !== S * dpr) { dial.width = S * dpr; dial.height = S * dpr; }
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0); dctx.clearRect(0, 0, S, S);
      var cx = 60, cy = 60, R = 48, fg = th(theme, 'fg', '#10201a'), mut = th(theme, 'muted', '#56685f');
      dctx.strokeStyle = th(theme, 'line', '#c6d3cc'); dctx.lineWidth = 1.5; dctx.beginPath(); dctx.arc(cx, cy, R, 0, 2 * Math.PI); dctx.stroke();
      for (var k = 0; k < 12; k++) { var a = k * Math.PI / 6; dctx.beginPath(); dctx.moveTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5)); dctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); dctx.strokeStyle = mut; dctx.stroke(); }
      function needle(deg, col, w, dash) {
        var a = (deg - 90) * D2R; dctx.setLineDash(dash || []); dctx.strokeStyle = col; dctx.lineWidth = w;
        dctx.beginPath(); dctx.moveTo(cx, cy); dctx.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); dctx.stroke(); dctx.setLineDash([]);
      }
      needle(alphaTrue, mut, 2, [3, 3]); needle(alphaRep, phaseCol(theme, 1), 3);
      var off = ((alphaRep - alphaTrue) % 360 + 540) % 360 - 180;
      dctx.strokeStyle = hexA(phaseCol(theme, 2), 0.8); dctx.lineWidth = 3; dctx.beginPath();
      var a0 = (alphaTrue - 90) * D2R, a1 = (alphaRep - 90) * D2R;
      dctx.arc(cx, cy, R + 4, Math.min(a0, a0 + off * D2R), Math.max(a0, a0 + off * D2R)); dctx.stroke();
      dctx.fillStyle = fg; dctx.beginPath(); dctx.arc(cx, cy, 3, 0, 2 * Math.PI); dctx.fill();
      return a1;
    }
    function drawTrace() {
      if (!tctx) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2), w = trace.clientWidth || 600, h = 94;
      if (trace.width !== Math.round(w * dpr) || trace.height !== Math.round(h * dpr)) { trace.width = Math.round(w * dpr); trace.height = Math.round(h * dpr); }
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.clearRect(0, 0, w, h);
      var fg = th(theme, 'fg', '#10201a'), mut = th(theme, 'muted', '#56685f'), red = phaseCol(theme, 2), blu = phaseCol(theme, 1);
      var top = 16, bot = h - 14, ymax = 24, WIN = 2.4, x0 = 34;
      function Y(g) { return bot - (bot - top) * Math.min(g, ymax) / ymax; }
      tctx.font = '10px ui-monospace, monospace'; tctx.fillStyle = mut;
      tctx.fillText('|a| (g), last ' + WIN.toFixed(1) + ' s of sensor time', x0, 10);
      [0, 8, 16].forEach(function (g) { tctx.fillStyle = mut; tctx.fillText(String(g), 4, Y(g) + 3); tctx.strokeStyle = hexA(mut, 0.25); tctx.lineWidth = 1; tctx.beginPath(); tctx.moveTo(x0, Y(g)); tctx.lineTo(w - 4, Y(g)); tctx.stroke(); });
      tctx.setLineDash([5, 4]); tctx.strokeStyle = red; tctx.beginPath(); tctx.moveTo(x0, Y(16)); tctx.lineTo(w - 4, Y(16)); tctx.stroke(); tctx.setLineDash([]);
      tctx.fillStyle = red; tctx.textAlign = 'right'; tctx.fillText('±16 g clip', w - 6, Y(16) - 3); tctx.textAlign = 'left';
      var N = Math.max(60, Math.floor((w - x0 - 4) / 2)), prevOk = false, gapStart = null, i, rawPeak = 0;
      for (i = 0; i <= N; i++) {
        var tt = T - WIN + WIN * i / N, x = x0 + (w - x0 - 4) * i / N;
        if (tt < 0) { prevOk = false; continue; }
        var s = accAt(tt);
        if (!s.recv) {
          if (gapStart === null) gapStart = x;
          prevOk = false; continue;
        }
        if (gapStart !== null) { shadeGap(gapStart, x); gapStart = null; }
        var y = Y(s.a), clip = s.raw >= 16;
        if (clip) rawPeak = Math.max(rawPeak, s.raw);
        if (prevOk) { tctx.lineTo(x, y); tctx.strokeStyle = clip ? red : blu; tctx.lineWidth = clip ? 3 : 1.6; tctx.stroke(); }
        tctx.beginPath(); tctx.moveTo(x, y); prevOk = true;
      }
      if (gapStart !== null) shadeGap(gapStart, w - 4);
      function shadeGap(a, b) {
        tctx.fillStyle = hexA(mut, 0.16); tctx.fillRect(a, top, b - a, bot - top);
        tctx.strokeStyle = hexA(mut, 0.5); tctx.lineWidth = 1; tctx.strokeRect(a + 0.5, top + 0.5, Math.max(0, b - a - 1), bot - top - 1);
        if (b - a > 26) { tctx.fillStyle = mut; tctx.fillText('lost', a + 3, bot - 4); }
      }
      if (rawPeak > 0) { tctx.fillStyle = red; tctx.fillText('true peak ' + rawPeak.toFixed(0) + ' g, recorded 16 g', x0 + 4, bot + 11); }
    }

    function draw(dtDisp) {
      var loop = Math.floor(T / F.duration), t = T - loop * F.duration, sc = schedule(loop);
      if (loop !== lastLoop) { lastLoop = loop; }
      var s = F.sample(t, 0), dd = distractor(sc.kind, t) || {};
      // camera framing: keep IMU, packets and phone in view above the trace
      var ca = 0.1 * Math.sin(T * 0.6);
      base.frameCam(new THREE.Vector3(0.05, 0.95, 0), new THREE.Vector3(Math.sin(ca), 0.16, Math.cos(ca)).normalize(), 5.8, 4.1);
      var R = racketR(s.alpha + (dd.yaw || 0), s.rkElev + (dd.rkElev || 0), s.roll + (dd.roll || 0));
      Mq.makeBasis(V([R[0][0], R[1][0], R[2][0]]), V([R[0][1], R[1][1], R[2][1]]), V([R[0][2], R[1][2], R[2][2]]));
      imuBox.quaternion.setFromRotationMatrix(Mq); axes.quaternion.copy(imuBox.quaternion); rkPivot.quaternion.copy(imuBox.quaternion);
      // impact flash
      var since = t - CT, sh = since >= 0 && since < 0.08 ? 1 - since / 0.08 : 0;
      shockMat.opacity = 0.45 * sh; shock.scale.setScalar(1 + 1.2 * (1 - sh));
      imuG.position.copy(imuPos); if (sh > 0) imuG.position.x += 0.04 * Math.sin(since * 900) * sh;
      flashMat.opacity = Math.max(0, flashMat.opacity - (dtDisp || 0) * 1.5);
      // packets
      var gIdx = Math.floor(T / PKT);
      if (emitted < 0) emitted = gIdx - 1;
      while (emitted < gIdx) { emitted++; spawn(emitted); }
      stepPackets(dtDisp || 0);
      // heading
      sess += (dtDisp || 0) * 10;
      var hdgTrue = s.alpha + (dd.yaw || 0), drift = driftRate * sess + walk;
      var narrow = base.size().w < 560, mut = th(theme, 'muted', '#56685f');
      drawDial(hdgTrue, hdgTrue + psi0 + drift);
      dialBox.style.width = narrow ? '98px' : '132px'; dial.style.width = dial.style.height = narrow ? '86px' : '120px';
      if (narrow) dialCap.innerHTML = 'AHRS heading<br>drift ' + fmt(drift, 0) + '°';
      else dialCap.innerHTML = '<span style="color:' + phaseCol(theme, 1) + '">━</span> AHRS heading<br><span style="color:' + th(theme, 'muted', '#56685f') + '">┄ true · drift ' + fmt(drift, 0) + '°<br>no magnetometer · clock ×10</span>';
      drawTrace();
      // labels
      tagImu.textContent = narrow ? 'IMU' : 'IMU · butt cap · x y z';
      base.place(tagImu, tv.copy(imuPos).add(new THREE.Vector3(0, -0.55, 0)), -tagImu.offsetWidth / 2, 0);
      tagPhone.textContent = narrow ? 'phone' : 'phone · BLE receiver';
      base.place(tagPhone, tv.copy(phonePos).add(new THREE.Vector3(0, -0.6, 0)), -tagPhone.offsetWidth / 2, 0);
      var dn = ['twirl', 'ball bounce', 'shadow swing'][sc.kind];
      if (t < 0.5 && (dd.roll || dd.rkElev || dd.yaw)) { tagDist.textContent = 'distractor: ' + dn + ' → idle'; base.place(tagDist, tv.copy(imuPos).add(new THREE.Vector3(0, 0.75, 0)), -tagDist.offsetWidth / 2, 0); }
      else tagDist.style.display = 'none';
      if (sh > 0 || (since >= 0 && since < 0.25)) { tagShock.textContent = 'impact ' + sc.A.toFixed(0) + ' g → clipped'; base.place(tagShock, tv.copy(imuPos).add(new THREE.Vector3(0.1, 0.62, 0)), 10, -10); }
      else tagShock.style.display = 'none';
      var dotC = function (c, txt) { return '<span style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:' + c + '"></span>' + txt + '</span>'; };
      var recvPct = stats.sent ? 100 * (1 - stats.drop / stats.sent) : 100;
      if (narrow) spec.innerHTML = '<div>200 Hz · ±16 g · ±2000 dps</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:0 8px;margin-top:2px">' + dotC(phaseCol(theme, 1), 'ok') + dotC(phaseCol(theme, 3), 'jitter') +
        dotC(phaseCol(theme, 2), 'clipped') + dotC(phaseCol(theme, 0), 'lost') + '</div>' +
        '<div>rx ' + recvPct.toFixed(0) + '% · gap ' + Math.round((sc.gap[1] - sc.gap[0]) * 1000) + ' ms</div>';
      else spec.innerHTML = '<div style="font-weight:700;letter-spacing:.08em;margin-bottom:3px">SENSOR + LINK</div>' +
        '<div>200 Hz · ±16 g · ±2000 dps</div>' +
        '<div style="color:' + mut + '">|ω| ' + Math.round(s.gyroMag) + ' °/s of 2000 · 4 samples/packet</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:4px">' + dotC(phaseCol(theme, 1), 'ok') + dotC(phaseCol(theme, 3), 'jitter') +
        dotC(phaseCol(theme, 2), 'saturated') + dotC(phaseCol(theme, 0), 'dropped') + '</div>' +
        '<div style="margin-top:3px">received <b>' + recvPct.toFixed(0) + '%</b> · dropped ' + stats.drop + ' · clipped ' + stats.sat + '</div>' +
        '<div style="color:' + mut + '">long gap this loop: ' + Math.round((sc.gap[1] - sc.gap[0]) * 1000) + ' ms</div>';
      base.renderer.render(scene, base.camera);
    }
    draw(0);
    return {
      frame: function (dt) {
        T += dt * rate;
        walk += 0.3 * Math.sqrt(Math.max(dt, 0) * 10) * (hr() * 2 - 1) * 0.5;
        draw(dt);
      },
      resize: function () { base.resize(); draw(0); },
      setTheme: function (t) { applyTheme(t); draw(0); },
      dispose: function () { base.dispose(); sched = {}; pool = []; }
    };
  }

  var list = (window.Chapters = window.Chapters || []);
  list.push({ id: 'problem', order: 1, kicker: 'Step 1 · The problem', title: 'One sensor, a whole body to explain', body: BODY1, mount: mountProblem });
  list.push({ id: 'simulator', order: 2, kicker: 'Step 2 · The simulator', title: 'Building the data: a kinematic chain, 12 players', body: BODY2, mount: mountSimulator });
  list.push({ id: 'sensor', order: 3, kicker: 'Step 3 · Sensor and link', title: 'What the racket sensor actually delivers', body: BODY3, mount: mountSensor });
})();
