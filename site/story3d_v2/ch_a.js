/* ch_a.js (v2, simplified): chapters 1-3 (problem, simulator, sensor).
   Classic script. Each chapter owns one WebGL renderer built from F.sample (no F.mount),
   so dispose() frees everything. World frame (z-up, x to net, y left) maps to three.js y-up via V().
   v2 rules: one idea per scene, one short caption, at most 4 plain labels, slow steady motion, one accent colour. */
(function () {
  'use strict';
  var D2R = Math.PI / 180;
  var SANS = '13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var SAFE_BOTTOM = 56;
  var GRIP_ROLL = 5, ARM_LEN = 0.62, SENSOR_OFFSET = 0.12, HEAD_OFFSET = 0.45;

  /* ---------------------------------------------------------------- helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function th(theme, k, fb) { return (theme && theme[k]) || fb; }
  function hexA(c, a) {
    if (/^#[0-9a-f]{6}$/i.test(c)) return 'rgba(' + parseInt(c.substr(1, 2), 16) + ',' + parseInt(c.substr(3, 2), 16) + ',' + parseInt(c.substr(5, 2), 16) + ',' + a + ')';
    if (/^#[0-9a-f]{3}$/i.test(c)) return hexA('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3], a);
    return 'color-mix(in srgb, ' + c + ' ' + Math.round(a * 100) + '%, transparent)';
  }
  function rng(seed) { // mulberry32, deterministic
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // pick whichever colour stands out more against the background
  function contrastPick(THREE, a, b, bg) {
    var L = function (c) { var x = new THREE.Color(c); return 0.2126 * x.r + 0.7152 * x.g + 0.0722 * x.b; };
    var lb = L(bg); return Math.abs(L(a) - lb) >= Math.abs(L(b) - lb) * 0.8 ? a : b;
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
    return { S: S, H: H, R: R,
             sensor: [H[0] - SENSOR_OFFSET * xr[0], H[1] - SENSOR_OFFSET * xr[1], H[2] - SENSOR_OFFSET * xr[2]],
             head: [H[0] + HEAD_OFFSET * xr[0], H[1] + HEAD_OFFSET * xr[1], H[2] + HEAD_OFFSET * xr[2]] };
  }
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
  function makeBase(stage, ctx, fov) {
    var THREE = ctx.THREE;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    stage.appendChild(canvas);
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false }); }
    catch (e) { stage.removeChild(canvas); throw e; }
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(fov || 36, 1, 0.05, 80);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a52, 0.75));
    var sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(3, 7, 4); scene.add(sun);
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font:' + SANS;
    stage.appendChild(overlay);
    var W = 640, H = 400, tmp = new THREE.Vector3();
    function V(w) { return new THREE.Vector3(w[0], w[2], -w[1]); }
    function resize() {
      W = stage.clientWidth || 640; H = stage.clientHeight || 400;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H, false);
      camera.aspect = W / Math.max(1, H); camera.updateProjectionMatrix();
    }
    function el(css) { var e = document.createElement('div'); e.style.cssText = css || ''; overlay.appendChild(e); return e; }
    // position an HTML label (centred above) at a three.js point; hidden when off-screen or in the bottom band
    function place(e, v3, dy) {
      tmp.copy(v3).project(camera);
      var x = (tmp.x * 0.5 + 0.5) * W - e.offsetWidth / 2, y = (-tmp.y * 0.5 + 0.5) * H + (dy || 0);
      var vis = tmp.z < 1 && x > -20 && x < W - 10 && y > 0 && y < H - SAFE_BOTTOM - 20;
      e.style.display = vis ? '' : 'none';
      e.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    }
    function dispose() {
      scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) [].concat(obj.material).forEach(function (m) { m.dispose(); });
      });
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    // steady camera: fits a needW x needH world box around target for any aspect
    function frameCam(target, dir, needW, needH) {
      var t = Math.tan((camera.fov * D2R) / 2), a = camera.aspect;
      var dist = Math.max(needW / 2 / (t * a), needH / 2 / t);
      camera.position.set(target.x + dir.x * dist, target.y + dir.y * dist, target.z + dir.z * dist);
      camera.lookAt(target);
    }
    resize();
    return { THREE: THREE, renderer: renderer, scene: scene, camera: camera, V: V, el: el, place: place,
             resize: resize, width: function () { return W; }, dispose: dispose, frameCam: frameCam };
  }

  // the single caption box (top-left, <=3 short lines)
  function fmtDeg(v) { var a = Math.abs(v).toFixed(0); return (+a === 0 ? '±' : v > 0 ? '+' : '−') + a + '°'; }
  function makeCaption(base, html) {
    var c = base.el('position:absolute;left:12px;top:12px;box-sizing:border-box;max-width:min(calc(100% - 24px),300px);padding:8px 12px;border-radius:8px;font:' + SANS);
    c.innerHTML = html;
    c.setTheme = function (t) {
      c.style.background = hexA(th(t, 'bg', '#dfe8e3'), 0.9);
      c.style.color = th(t, 'fg', '#10201a');
      c.style.border = '1px solid ' + th(t, 'line', '#c6d3cc');
      c.style.borderLeft = '3px solid ' + th(t, 'accent', '#d9b51f');
    };
    return c;
  }
  // a plain floating label; accent=true gives it the accent outline
  function makeLabel(base, text, accent) {
    var e = base.el('position:absolute;left:0;top:0;white-space:nowrap;padding:1px 8px;border-radius:999px;font:12px system-ui,-apple-system,"Segoe UI",sans-serif;will-change:transform');
    e.textContent = text;
    e.setTheme = function (t) {
      e.style.background = hexA(th(t, 'bg', '#dfe8e3'), 0.88);
      e.style.color = th(t, 'fg', '#10201a');
      e.style.border = (accent ? '2px solid ' + th(t, 'accent', '#d9b51f') : '1px solid ' + th(t, 'line', '#c6d3cc'));
      e.style.fontWeight = accent ? '600' : '400';
    };
    return e;
  }

  function addCourt(base, theme) {
    var THREE = base.THREE;
    var gm = new THREE.MeshStandardMaterial({ color: th(theme, 'ground', '#3a7a62'), roughness: 0.95 });
    var g = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), gm); g.rotation.x = -Math.PI / 2; base.scene.add(g);
    return { setTheme: function (t) { gm.color.set(th(t, 'ground', '#3a7a62')); } };
  }

  // racket mesh in its own frame: x_r long axis (butt -> head), z_r face normal; origin at the hand
  function makeRacket(base, mat, strMat) {
    var THREE = base.THREE, g = new THREE.Group(), k;
    var hg = new THREE.CylinderGeometry(0.017, 0.016, 0.25, 8); hg.rotateZ(-Math.PI / 2);
    var handle = new THREE.Mesh(hg, mat); handle.position.x = 0.005; g.add(handle);
    var pts = [], A = 0.165, Bb = 0.125, C0 = HEAD_OFFSET;
    for (k = 0; k < 36; k++) { var an = k / 36 * Math.PI * 2; pts.push(new THREE.Vector3(C0 + A * Math.cos(an), Bb * Math.sin(an), 0)); }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 56, 0.011, 6, true), mat));
    [0.075, -0.075].forEach(function (yy) {
      var a = new THREE.Vector3(0.13, 0, 0), b = new THREE.Vector3(0.295, yy, 0), d = b.clone().sub(a);
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

  // simple capsule figure + racket inside one group (group position = where the player stands)
  function makeFigure(base, bodyMat, rkMat, strMat) {
    var THREE = base.THREE, V = base.V, root = new THREE.Group();
    var CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), SPH = new THREE.SphereGeometry(1, 12, 9), UP = new THREE.Vector3(0, 1, 0);
    function capsule(r) {
      var c = new THREE.Mesh(CYL, bodyMat), a = new THREE.Mesh(SPH, bodyMat), b = new THREE.Mesh(SPH, bodyMat), d = new THREE.Vector3();
      root.add(c); root.add(a); root.add(b);
      return function (pa, pb) {
        var va = V(pa), vb = V(pb); d.subVectors(vb, va); var L = d.length() || 1e-4;
        c.position.addVectors(va, vb).multiplyScalar(0.5); c.scale.set(r, L, r); c.quaternion.setFromUnitVectors(UP, d.divideScalar(L));
        a.position.copy(va); a.scale.setScalar(r); b.position.copy(vb); b.scale.setScalar(r);
      };
    }
    var torso = capsule(0.13), shLine = capsule(0.05), neck = capsule(0.04), rUp = capsule(0.042), rLo = capsule(0.035),
        lUp = capsule(0.04), lLo = capsule(0.033), rTh = capsule(0.06), rSh = capsule(0.045), lTh = capsule(0.06), lSh = capsule(0.045);
    var headM = new THREE.Mesh(SPH, bodyMat); headM.scale.set(0.095, 0.115, 0.095); root.add(headM);
    var racket = makeRacket(base, rkMat, strMat); root.add(racket);
    function pose(trunk, k) {
      var trd = trunk * D2R, Ls = [-k.S[0], -k.S[1], 1.45], pz = 0.9 - 0.05 * clamp(-trunk / 60, 0, 1);
      var py = 0.4 * trd, hipR = [0.11 * Math.sin(py), -0.11 * Math.cos(py), pz], hipL = [-hipR[0], -hipR[1], pz];
      torso([0, 0, pz + 0.08], [0, 0, 1.36]); shLine(k.S, Ls); neck([0, 0, 1.45], [0, 0, 1.55]);
      headM.position.copy(V([0.02, 0, 1.64]));
      var el = ik(k.S, k.H, 0.32, 0.32, [-0.3 * Math.cos(trd), -0.6, -1]);
      rUp(k.S, el); rLo(el, k.H);
      var fwd = [Math.cos(trd), Math.sin(trd), 0], lft = [-Math.sin(trd), Math.cos(trd), 0], ext = clamp(-trunk / 55, 0, 1);
      var lh = [Ls[0] + fwd[0] * (0.2 + 0.3 * ext) - lft[0] * 0.1, Ls[1] + fwd[1] * (0.2 + 0.3 * ext) - lft[1] * 0.1, 1.15 + 0.15 * ext];
      var lel = ik(Ls, lh, 0.32, 0.32, [-0.4 * Math.cos(trd), 0.6, -1]); lUp(Ls, lel); lLo(lel, lh);
      var fR = [-0.05, -0.42, 0.06], fL = [0.12, 0.38, 0.06];
      var kR = ik(hipR, fR, 0.46, 0.46, [1, -0.2, 0]), kL = ik(hipL, fL, 0.46, 0.46, [1, 0.25, 0]);
      rTh(hipR, kR); rSh(kR, fR); lTh(hipL, kL); lSh(kL, fL);
      racket.userData.setPose(k.H, k.R);
    }
    return { root: root, racket: racket, pose: pose };
  }

  function racketColour(THREE, t) { return contrastPick(THREE, th(t, 'racket', '#1b2730'), th(t, 'fg', '#e2ebe6'), th(t, 'ground', '#3a7a62')); }

  /* ================================================================ CHAPTER 1: the problem
     One idea: the sensor sees only the racket; the body that drives it stays hidden. */
  var BODY1 = "<p><b>We have one tiny sensor and we are trying to understand a whole body.</b></p><p>A forehand uses your hips, chest, shoulder, elbow, forearm and wrist all at once. Our only sensor is a small motion sensor stuck on the bottom of the racket handle. It is like guessing a whole dance from watching only one hand.</p><p>We want to know three things: which part of the swing you are in, the exact moment you hit the ball, and how much you turned your chest.</p><p><small>The 5 swing phases: <b>idle</b> (standing still), <b>backswing</b> (turn and pull back), <b>forward swing</b> (whip toward the ball), <b>follow-through</b> (racket keeps going after the hit), <b>recovery</b> (back to ready).</small></p>";

  function mountProblem(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, 36), THREE = base.THREE, V = base.V, scene = base.scene;
    var court = addCourt(base, theme);
    // body faded (we cannot see it), racket solid, sensor in the accent colour
    var bodyMat = new THREE.MeshStandardMaterial({ color: th(theme, 'body', '#d6dcdf'), transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.8 });
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.5 });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    var fig = makeFigure(base, bodyMat, rkMat, strMat); scene.add(fig.root);
    var imuMat = new THREE.MeshStandardMaterial({ color: th(theme, 'accent', '#d9b51f'), emissive: th(theme, 'accent', '#d9b51f'), emissiveIntensity: 0.5, roughness: 0.35 });
    var imu = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.05), imuMat); imu.position.x = -SENSOR_OFFSET - 0.022; fig.racket.add(imu);

    var cap = makeCaption(base, 'The sensor only feels the racket.<br>The chest, shoulder and wrist that move it stay hidden.');
    var lbl = { sensor: makeLabel(base, 'sensor', true), chest: makeLabel(base, 'chest'), shoulder: makeLabel(base, 'shoulder'), wrist: makeLabel(base, 'wrist') };
    // live sum bar: the racket heading is trunk + shoulder + wrist, and only the sum reaches the sensor
    var sumBar = base.el('position:absolute;left:50%;bottom:68px;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);' +
      'padding:7px 14px;border-radius:8px;text-align:center;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace');
    sumBar.setTheme = function (t) {
      sumBar.style.background = hexA(th(t, 'bg', '#dfe8e3'), 0.9);
      sumBar.style.color = th(t, 'fg', '#10201a');
      sumBar.style.border = '1px solid ' + th(t, 'line', '#c6d3cc');
      sumBar.muted = th(t, 'muted', '#56685f');
      sumBar.accent = th(t, 'accent', '#d9b51f');
    };

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      bodyMat.color.set(th(t, 'body', '#d6dcdf'));
      rkMat.color.set(racketColour(THREE, t));
      imuMat.color.set(th(t, 'accent', '#d9b51f')); imuMat.emissive.set(th(t, 'accent', '#d9b51f'));
      cap.setTheme(t); sumBar.setTheme(t); for (var k in lbl) lbl[k].setTheme(t);
    }
    applyTheme(theme);

    // start just before contact so the paused (reduced-motion) frame is meaningful; slow, steady playback
    var clock = F.contactTime - 0.15, rate = ctx.reducedMotion ? 0.12 : 0.33;
    var dir = new THREE.Vector3(Math.sin(0.55), 0.3, Math.cos(0.55)).normalize();
    function draw() {
      var s = F.sample(clock % F.duration, 0), k = fk(s.trunk, s.shoulder, s.wrist, s.armElev, s.rkElev, s.roll);
      var narrow = base.width() < 520;
      base.frameCam(new THREE.Vector3(0.1, narrow ? 1.2 : 1.08, 0.2), dir, base.camera.aspect < 0.9 ? 2.3 : 2.0, narrow ? 2.9 : 2.5);
      fig.pose(s.trunk, k);
      base.place(lbl.sensor, V(k.sensor), 18);
      base.place(lbl.chest, V([0, 0, 1.22]), -10);
      base.place(lbl.shoulder, V(k.S), -30);
      base.place(lbl.wrist, V(k.H), -30);
      // show the total as the sum of the rounded parts, so the numbers on screen always add up
      var rt = Math.round(s.trunk), rs = Math.round(s.shoulder), rw = Math.round(s.wrist);
      sumBar.innerHTML = 'racket heading α = trunk + shoulder + wrist = <b>' + fmtDeg(rt + rs + rw) + '</b>' +
        '<br><span style="color:' + sumBar.muted + '">trunk ' + fmtDeg(rt) + ' · shoulder ' + fmtDeg(rs) + ' · wrist ' + fmtDeg(rw) +
        '</span>' +
        '<br><span style="font-family:system-ui,-apple-system,sans-serif;color:' + sumBar.accent + '">The sensor gets the total α, but not the trunk, shoulder and wrist parts separately.</span>';
      base.renderer.render(scene, base.camera);
    }
    draw();
    return {
      frame: function (dt) { clock += dt * rate; draw(); },
      resize: function () { base.resize(); draw(); },
      setTheme: function (t) { applyTheme(t); draw(); },
      dispose: function () { base.dispose(); }
    };
  }

  /* ================================================================ CHAPTER 2: the simulator
     One idea: pretend players swing differently. Three of the twelve, side by side, in step. */
  var BODY2 = "<p><b>There is no real data, so we made our own.</b></p><p>Nobody has published data with both a racket sensor and real body measurements. So we built <b>12 pretend players</b> in software, each hitting 60 forehands. They differ like real people do: some turn their body a lot, some use more arm, some swing faster, some have longer arms.</p><p>Because we built them, we know the right answer for every swing, so we can grade ourselves. <small>The catch: real players will be messier, so these scores are a best case.</small></p>";

  // three clearly different players (values inside the simulator's ranges)
  var PLAYERS = [
    { name: 'big turn', coil: 105, sh_bs: 8, sh_ft: 45, wrist_lag: 18, arm_len: 0.62 },
    { name: 'more arm', coil: 55, sh_bs: 35, sh_ft: 75, wrist_lag: 18, arm_len: 0.62 },
    { name: 'long arms', coil: 80, sh_bs: 20, sh_ft: 55, wrist_lag: 28, arm_len: 0.70 }
  ];
  // the representative stroke rescaled by a player's ranges (same idea as the simulator's per-player draw)
  function playerPose(F, p, t) {
    var s = F.sample(t, 0);
    var tr = s.trunk < 0 ? s.trunk * p.coil / 80 : s.trunk;
    var sh = s.shoulder < 0 ? s.shoulder * p.sh_bs / 20 : s.shoulder * p.sh_ft / 55;
    var wr = s.wrist < 0 ? s.wrist * p.wrist_lag / 18 : s.wrist;
    return { trunk: tr, k: fk(tr, sh, wr, s.armElev, s.rkElev, s.roll, p.arm_len) };
  }

  function mountSimulator(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, 34), THREE = base.THREE, V = base.V, scene = base.scene;
    var court = addCourt(base, theme);
    var bodyMat = new THREE.MeshStandardMaterial({ color: th(theme, 'body', '#d6dcdf'), roughness: 0.8 });
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.5 });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    var pathMat = new THREE.LineBasicMaterial({ color: th(theme, 'accent', '#d9b51f') });
    var SPACING = 1.7;
    var figs = PLAYERS.map(function (p, i) {
      var f = makeFigure(base, bodyMat, rkMat, strMat);
      f.root.position.set((i - 1) * SPACING, 0, 0); scene.add(f.root);
      // the racket-head path of this player's whole swing, drawn once (accent): the visible difference
      var pts = [], N = 90, a = F.phases[1].t0, b = F.phases[3].t1;
      for (var j = 0; j < N; j++) pts.push(V(playerPose(F, p, a + (b - a) * j / (N - 1)).k.head));
      var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), pathMat); f.root.add(line);
      f.label = makeLabel(base, p.name, false); f.p = p;
      return f;
    });
    var cap = makeCaption(base, '12 pretend players, 60 swings each.<br>Here are 3: they turn, reach and swing differently.<br>The bright line is each racket head’s path.');

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      bodyMat.color.set(th(t, 'body', '#d6dcdf'));
      rkMat.color.set(racketColour(THREE, t));
      pathMat.color.set(th(t, 'accent', '#d9b51f'));
      cap.setTheme(t); figs.forEach(function (f) { f.label.setTheme(t); });
    }
    applyTheme(theme);

    var clock = F.contactTime - 0.15, rate = ctx.reducedMotion ? 0.12 : 0.3, tmp = new THREE.Vector3();
    var dir = new THREE.Vector3(0.25, 0.55, 1).normalize();
    function draw() {
      var t = clock % F.duration, narrow = base.camera.aspect < 0.9;
      base.frameCam(new THREE.Vector3(0.2, narrow ? 1.25 : 1.0, 0), dir, 3 * SPACING + 0.6, narrow ? 3.4 : 2.7);
      figs.forEach(function (f) {
        var pp = playerPose(F, f.p, t);
        f.pose(pp.trunk, pp.k);
        base.place(f.label, tmp.copy(f.root.position).add(new THREE.Vector3(0, 0.02, 0.75)), 4);
      });
      base.renderer.render(scene, base.camera);
    }
    draw();
    return {
      frame: function (dt) { clock += dt * rate; draw(); },
      resize: function () { base.resize(); draw(); },
      setTheme: function (t) { applyTheme(t); draw(); },
      dispose: function () { base.dispose(); }
    };
  }

  /* ================================================================ CHAPTER 3: sensor and link
     One idea: readings travel from the sensor to the phone, and a few get lost on the way. */
  var BODY3 = "<p><b>Real sensors are messy, so we made ours messy on purpose.</b></p><p>The pretend sensor behaves like a real one. It is a little noisy, it maxes out when the ball hits hard, and its “compass” slowly drifts, so it never knows which way the court faces.</p><p>The Bluetooth link sometimes drops data for a split second. We also mixed in fake “not a swing” moments, like twirling the racket or bouncing the ball, so the system has to learn to ignore them.</p>";

  function mountSensor(stage, ctx) {
    var F = ctx.F, theme = ctx.theme, base = makeBase(stage, ctx, 34), THREE = base.THREE, V = base.V, scene = base.scene;
    var court = addCourt(base, theme);
    var imuPos = new THREE.Vector3(-1.9, 1.35, 0), phonePos = new THREE.Vector3(1.9, 1.05, 0);

    // sensor (accent) on the butt cap of a racket that follows the swing, slowly
    var imuG = new THREE.Group(); imuG.position.copy(imuPos); scene.add(imuG);
    var imuMat = new THREE.MeshStandardMaterial({ color: th(theme, 'accent', '#d9b51f'), emissive: th(theme, 'accent', '#d9b51f'), emissiveIntensity: 0.3, roughness: 0.35 });
    var imuBox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), imuMat); imuG.add(imuBox);
    var rkMat = new THREE.MeshStandardMaterial({ color: '#1b2730', roughness: 0.5 });
    var strMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    var rkPivot = new THREE.Group(); imuG.add(rkPivot);
    var rk = makeRacket(base, rkMat, strMat); rk.scale.setScalar(1.4); rk.position.x = 0.15; rkPivot.add(rk);

    // phone
    var phoneG = new THREE.Group(); phoneG.position.copy(phonePos); phoneG.rotation.y = -0.35; scene.add(phoneG);
    var phone = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.82, 0.06), rkMat); phoneG.add(phone);
    var screenMat = new THREE.MeshBasicMaterial({ color: th(theme, 'body', '#d6dcdf') });
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.7), screenMat); screen.position.z = 0.031; phoneG.add(screen);

    // flight arc
    var ctrl = new THREE.Vector3(0, 2.4, 0);
    function bez(u, out) {
      var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      return out.set(a * imuPos.x + b * ctrl.x + c * phonePos.x, a * imuPos.y + b * ctrl.y + c * phonePos.y, a * imuPos.z + b * ctrl.z + c * phonePos.z);
    }

    // packets: one calm stream; about 1 in 8 is lost and drops to the ground in grey
    var okMat = new THREE.MeshStandardMaterial({ color: th(theme, 'accent', '#d9b51f'), roughness: 0.4 });
    var lostMat = new THREE.MeshStandardMaterial({ color: th(theme, 'muted', '#8a9a94'), roughness: 0.8, transparent: true, opacity: 0.85 });
    var PG = new THREE.BoxGeometry(0.1, 0.1, 0.1), pool = [], r = rng(9001), i;
    for (i = 0; i < 14; i++) { var m = new THREE.Mesh(PG, okMat); m.visible = false; scene.add(m); pool.push({ m: m, live: false }); }
    var EVERY = 0.3, TRAVEL = 2.4, since = EVERY;
    function spawn() {
      for (var k = 0; k < pool.length; k++) if (!pool[k].live) {
        var p = pool[k], lost = r() < 0.13;
        p.live = true; p.age = 0; p.lost = lost; p.fall = null; p.m.material = okMat; p.m.visible = true; p.m.rotation.set(0, 0, 0);
        bez(0, p.m.position); return;
      }
    }
    function step(dt) {
      since += dt;
      while (since >= EVERY) { since -= EVERY; spawn(); }
      pool.forEach(function (p) {
        if (!p.live) return;
        p.age += dt;
        var u = p.age / TRAVEL;
        if (p.lost && u >= 0.5) { // falls gently to the ground, rests, then disappears
          if (!p.fall) { p.fall = { vy: 0 }; p.m.material = lostMat; }
          p.fall.vy -= 2.0 * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.fall.vy * dt);
          if (p.age > TRAVEL * 0.5 + 2.5) { p.live = false; p.m.visible = false; }
          return;
        }
        if (u >= 1) { p.live = false; p.m.visible = false; return; }
        bez(u, p.m.position);
      });
    }

    var cap = makeCaption(base, 'The sensor sends its readings to a phone.<br>Now and then a piece gets lost on the way (grey).');
    var tagImu = makeLabel(base, 'sensor', true), tagPhone = makeLabel(base, 'phone'), tagLost = makeLabel(base, 'lost');

    function applyTheme(t) {
      theme = t; court.setTheme(t);
      scene.background = new THREE.Color(th(t, 'bg', '#dfe8e3'));
      imuMat.color.set(th(t, 'accent', '#d9b51f')); imuMat.emissive.set(th(t, 'accent', '#d9b51f'));
      rkMat.color.set(contrastPick(THREE, th(t, 'racket', '#1b2730'), th(t, 'fg', '#e2ebe6'), th(t, 'bg', '#dfe8e3')));
      screenMat.color.set(th(t, 'body', '#d6dcdf'));
      okMat.color.set(th(t, 'accent', '#d9b51f')); lostMat.color.set(th(t, 'muted', '#8a9a94'));
      cap.setTheme(t); tagImu.setTheme(t); tagPhone.setTheme(t); tagLost.setTheme(t);
    }
    applyTheme(theme);

    var clock = F.contactTime - 0.3, rate = ctx.reducedMotion ? 0.1 : 0.25, flow = ctx.reducedMotion ? 0.4 : 1, Mq = new THREE.Matrix4();
    var dir = new THREE.Vector3(0, 0.18, 1).normalize();
    // warm up so the first (or reduced-motion paused) frame already shows a stream with a lost piece
    for (i = 0; i < 60; i++) step(0.05);
    function draw() {
      var s = F.sample(clock % F.duration, 0), R = racketR(s.alpha, s.rkElev, s.roll);
      base.frameCam(new THREE.Vector3(0, 1.1, 0), dir, 5.4, base.camera.aspect < 0.9 ? 4.6 : 3.6);
      Mq.makeBasis(V([R[0][0], R[1][0], R[2][0]]), V([R[0][1], R[1][1], R[2][1]]), V([R[0][2], R[1][2], R[2][2]]));
      imuBox.quaternion.setFromRotationMatrix(Mq); rkPivot.quaternion.copy(imuBox.quaternion);
      base.place(tagImu, new THREE.Vector3(imuPos.x, imuPos.y - 0.45, 0), 0);
      base.place(tagPhone, new THREE.Vector3(phonePos.x, phonePos.y - 0.6, 0), 0);
      // label the most recent lost piece resting on the ground, if any
      var lp = null;
      pool.forEach(function (p) { if (p.live && p.fall && p.m.position.y <= 0.06 && (!lp || p.age < lp.age)) lp = p; });
      if (lp) base.place(tagLost, lp.m.position, -34); else tagLost.style.display = 'none';
      base.renderer.render(scene, base.camera);
    }
    draw();
    return {
      frame: function (dt) { clock += dt * rate; step(dt * flow); draw(); },
      resize: function () { base.resize(); draw(); },
      setTheme: function (t) { applyTheme(t); draw(); },
      dispose: function () { base.dispose(); pool = []; }
    };
  }

  var list = (window.Chapters = window.Chapters || []);
  list.push({ id: 'problem', order: 1, kicker: 'Step 1 · The problem', title: 'One sensor, a whole body to explain', body: BODY1, mount: mountProblem });
  list.push({ id: 'simulator', order: 2, kicker: 'Step 2 · The simulator', title: 'Building the data: a kinematic chain, 12 players', body: BODY2, mount: mountSimulator });
  list.push({ id: 'sensor', order: 3, kicker: 'Step 3 · Sensor and link', title: 'What the racket sensor actually delivers', body: BODY3, mount: mountSensor });
})();
