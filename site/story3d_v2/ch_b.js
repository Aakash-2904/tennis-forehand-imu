/* ch_b.js (v2, simplified): chapters 4-6 of the Forehand 3D story.
   4 features : the racket swings; four plain signals underneath (turn speed, tip up/down, face tilt, ball jolt)
   5 models   : two colour bars, per-moment guesses (flickery) vs with the swing-order rule (clean)
   6 gaps     : one signal with a dropout, filled with zeros vs marked unknown and bridged
   Classic script. One WebGL renderer per chapter, steady camera, one caption box, few labels. */
(function () {
  'use strict';
  var W = window, D2R = Math.PI / 180;
  var SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  var SPEED = 0.6; // calmer than real time

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) { // mulberry32, deterministic
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function absMax(a) { var m = 1e-9; for (var i = 0; i < a.length; i++) if (isFinite(a[i])) m = Math.max(m, Math.abs(a[i])); return m; }

  /* ---------------------------------------------------------------- signals, computed once from F.sample */
  var SIG = null;
  function signals(F) {
    if (SIG && SIG.F === F) return SIG;
    var fs = 200, D = F.duration, N = Math.floor(D * fs), i;
    var turn = new Float32Array(N), yaw = new Float32Array(N), tip = new Float32Array(N), tilt = new Float32Array(N),
      acc = new Float32Array(N), jolt = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var s = F.sample(i / fs, 0);
      turn[i] = s.gyroMag; yaw[i] = s.gyroYaw; tip[i] = s.rkElev; tilt[i] = s.roll; acc[i] = s.accMag;
    }
    var ci = Math.round(F.contactTime * fs); // ball-hit shock, as in simulate.py
    for (var k = 0; k < 40 && ci + k < N; k++) acc[ci + k] += 3.2 * Math.exp(-k / 1.5) * Math.cos(2 * Math.PI * 0.42 * k);
    for (i = 0; i < N; i++) jolt[i] = Math.abs(acc[i] - acc[(i - 1 + N) % N]);
    var Tf = Math.floor(D * 100), fph = new Int8Array(Tf);
    for (i = 0; i < Tf; i++) fph[i] = F.sample(i / 100, 0).phase % 5;
    SIG = { F: F, fs: fs, D: D, N: N, turn: turn, yaw: yaw, tip: tip, tilt: tilt, jolt: jolt, Tf: Tf, fph: fph };
    return SIG;
  }

  /* racket orientation, same pose formula as scene.js: R = Rz(alpha) Rx(-elev) B Rx(roll) */
  function mm(A, B) { var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]; return C; }
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  var BR = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  function racketR(s) { return mm(mm(mm(Rz(s.alpha * D2R), Rx(-s.rkElev * D2R)), BR), Rx((s.roll + 5) * D2R)); }

  /* ---------------------------------------------------------------- kit: renderer, fixed camera, labels, caption */
  // box = {x0,x1,y0,y1} (three.js units, z=0 plane) that must stay in view; el = gentle downward tilt
  function kit(stage, ctx, box, el) {
    var THREE = ctx.THREE, theme = ctx.theme || {};
    function css(c) {
      if (!c) return '#888888';
      if (c.charAt(0) === '#') return c;
      if (/^ph\d$/.test(c)) return (theme.phaseColors && theme.phaseColors[+c.charAt(2)]) || '#888888';
      return theme[c] || '#888888';
    }
    function color(c) { var x = new THREE.Color(); try { x.set(css(c)); } catch (e) { x.set('#888888'); } return x; }

    var R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    R.setPixelRatio(Math.min(2, W.devicePixelRatio || 1));
    var cv = R.domElement;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
    stage.appendChild(cv);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;overflow:hidden;font:12px ' + SANS;
    stage.appendChild(ov);

    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445048, 1.0));
    var sun = new THREE.DirectionalLight(0xffffff, 0.45); sun.position.set(2, 6, 5); scene.add(sun);

    var mats = [], labels = [], tmp = new THREE.Vector3(), w = 1, h = 1, cap = null, capLines = [], botPad = 66;
    function mat(kind, c, extra) {
      var p = extra || {}, m;
      if (c) p.color = color(c);
      m = kind === 'lambert' ? new THREE.MeshLambertMaterial(p) : new THREE.MeshBasicMaterial(p);
      if (c) mats.push({ m: m, c: c });
      return m;
    }
    function label(text, pos, c, anchor) {
      var el = document.createElement('div');
      el.textContent = text;
      var L = { el: el, pos: pos, c: c || 'fg', anchor: anchor || 'bl' };
      L.paint = function () {
        el.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:12px ' + SANS + ';color:' + css(L.c) + ';';
      };
      L.paint(); ov.appendChild(el); labels.push(L);
      return L;
    }
    function caption(lines) {
      capLines = lines;
      cap = document.createElement('div');
      cap.innerHTML = lines.map(function (s) { return '<div>' + s + '</div>'; }).join('');
      ov.appendChild(cap); paintCaption();
      fit(); // re-fit now that the caption's height is known, so content sits below it
    }
    function paintCaption() {
      if (!cap) return;
      var bg = color('bg');
      cap.style.cssText = 'position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);box-sizing:border-box;' +
        'font:13px/1.4 ' + SANS + ';color:' + css('fg') + ';padding:7px 10px;border-radius:8px;' +
        'background:rgba(' + Math.round(bg.r * 255) + ',' + Math.round(bg.g * 255) + ',' + Math.round(bg.b * 255) + ',0.82);' +
        'border:1px solid ' + css('line') + ';';
    }
    function placeLabels() {
      for (var i = 0; i < labels.length; i++) {
        var L = labels[i];
        tmp.copy(L.pos).project(cam);
        var x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
        if (tmp.z > 1 || y < 0 || y > h - 60) { L.el.style.display = 'none'; continue; }
        L.el.style.display = 'block';
        var tr = L.anchor === 'r' ? 'translate(calc(-100% - 6px),-50%)' : L.anchor === 'b' ? 'translate(-50%,calc(-100% - 4px))'
          : 'translate(0,calc(-100% - 4px))';
        L.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) ' + tr;
      }
    }
    // fit the content box between the caption (top) and the shell transport (bottom 56px)
    function fit() {
      var top = cap ? Math.min(cap.offsetHeight || 64, 90) + 20 : 16, bot = botPad;
      var uh = Math.max(40, h - top - bot), aspect = w / h, tf = Math.tan(cam.fov * D2R / 2);
      var bw = (box.x1 - box.x0) * 1.08, bh = (box.y1 - box.y0) * 1.1;
      var dist = Math.max((bh / 2) / tf * (h / uh), (bw / 2) / (tf * aspect));
      var tx = (box.x0 + box.x1) / 2, ty = (box.y0 + box.y1) / 2;
      cam.position.set(tx, ty + dist * Math.sin(el || 0), dist * Math.cos(el || 0));
      cam.lookAt(tx, ty, 0);
      cam.setViewOffset(w, h, 0, (bot - top) / 2, w, h); // positive y moves content up
      cam.updateProjectionMatrix();
    }
    var K = {
      THREE: THREE, scene: scene, mat: mat, label: label, caption: caption, color: color, css: css, phC: [],
      reserveBottom: function (px) { botPad = px; fit(); },
      resize: function () {
        w = Math.max(1, stage.clientWidth || 640); h = Math.max(1, stage.clientHeight || 400);
        R.setSize(w, h, false); cam.aspect = w / h; fit();
      },
      render: function () { R.render(scene, cam); placeLabels(); },
      setTheme: function (th) {
        theme = th || theme;
        scene.background = color('bg');
        for (var i = 0; i < 5; i++) K.phC[i] = color('ph' + i);
        mats.forEach(function (r) { r.m.color.copy(color(r.c)); });
        labels.forEach(function (L) { L.paint(); });
        paintCaption();
      },
      dispose: function () {
        scene.traverse(function (ob) {
          if (ob.geometry) ob.geometry.dispose();
          if (ob.material) [].concat(ob.material).forEach(function (m) { m.dispose(); });
        });
        R.dispose(); if (R.forceContextLoss) R.forceContextLoss();
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        labels = []; mats = []; cap = null;
      }
    };
    K.setTheme(theme); K.resize();
    return K;
  }

  /* thick line as a flat strip in the z=0 plane; NaN breaks it; reveal(k) shows points [0, k) */
  function strip(K, xs, ys, wd, m, z) {
    var THREE = K.THREE, n = xs.length, pos = new Float32Array(n * 6), idx = [], cum = new Int32Array(n + 1);
    for (var i = 0; i < n; i++) {
      var a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      if (!isFinite(ys[a])) a = i; if (!isFinite(ys[b])) b = i;
      var dx = xs[b] - xs[a], dy = (ys[b] - ys[a]) || 0, L = Math.hypot(dx, dy) || 1, nx = -dy / L * wd / 2, ny = dx / L * wd / 2;
      var y = isFinite(ys[i]) ? ys[i] : 0;
      pos.set([xs[i] + nx, y + ny, z || 0, xs[i] - nx, y - ny, z || 0], i * 6);
      cum[i + 1] = cum[i];
      if (i < n - 1 && isFinite(ys[i]) && isFinite(ys[i + 1])) { var q = 2 * i; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); cum[i + 1] += 6; }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    var mesh = new THREE.Mesh(g, m); K.scene.add(mesh);
    return { mesh: mesh, reveal: function (k) { g.setDrawRange(0, cum[clamp(Math.floor(k), 0, n)]); } };
  }
  function bar(K, x0, x1, y0, y1, m, z) {
    var b = new K.THREE.Mesh(new K.THREE.PlaneGeometry(x1 - x0, y1 - y0), m);
    b.position.set((x0 + x1) / 2, (y0 + y1) / 2, z || 0); K.scene.add(b); return b;
  }
  // loop clock: run once at SPEED, then hold the finished picture for `hold` seconds
  function looper(D, hold) { return function (c) { var run = D / SPEED, u = c % (run + hold); return Math.min(1, u / run); }; }

  W.Chapters = W.Chapters || [];

  /* ================================================================ chapter 4: features without heading */
  W.Chapters.push({
    id: 'features', order: 5,
    kicker: 'Step 5 · Features',
    title: 'Features without heading',
    body: "<p><b>Measure only things we can trust.</b></p><p>The compass drifts, so we never ask “which way is the racket pointing?” Instead we ask things gravity can always answer: how fast is it turning, is the tip up or down, is the face tilted, and was there a sudden jolt? (The jolt is the ball hit.)</p><p>Every hundredth of a second we turn these into <b>60 small measurements</b> that describe what the racket is doing.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F);
      var X0 = -3, X1 = 3, PIV = new THREE.Vector3(0, 2.0, 0);
      var K = kit(stage, ctx, { x0: -3.1, x1: 3.1, y0: -1.75, y1: 3.2 }, 0.05);
      K.caption(['We only measure what gravity lets us trust:', 'turning, tip, face tilt, and the jolt of the hit.']);

      // racket, pivoting about its butt cap (where the sensor sits)
      var rk = new THREE.Group(), fm = K.mat('lambert', 'body');
      var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), fm);
      handle.rotation.z = -Math.PI / 2; handle.position.x = 0.2; rk.add(handle);
      var head = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.018, 8, 44), fm);
      head.scale.set(1.3, 1, 1); head.position.x = 0.78; rk.add(head);
      var face = new THREE.Mesh(new THREE.CircleGeometry(0.26, 32), K.mat('basic', 'fg', { transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      face.scale.set(1.3, 1, 1); face.position.x = 0.78; rk.add(face);
      rk.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), K.mat('basic', 'accent')));
      rk.position.copy(PIV); K.scene.add(rk);
      var M4 = new THREE.Matrix4(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
      function Vw(c, out) { return out.set(c[0], c[2], -c[1]); } // world z-up -> three y-up

      // four plain signal rows
      var ROWS = [
        { name: 'turn speed', d: S.turn, signed: false },
        { name: 'tip up / down', d: S.tip, signed: true },
        { name: 'face tilt', d: S.tilt, signed: true },
        { name: 'ball jolt', d: S.jolt, signed: false, accent: true }
      ];
      var xs = [], i;
      for (i = 0; i < S.N; i++) xs.push(X0 + (X1 - X0) * i / (S.N - 1));
      var dotG = new THREE.SphereGeometry(0.05, 12, 8), dotM = K.mat('basic', 'accent');
      ROWS.forEach(function (r, k) {
        var base = 0.45 - k * 0.62, amp = 0.36, mx = absMax(r.d), mid = 0;
        if (r.signed) { var lo = Infinity, hi = -Infinity; for (i = 0; i < S.N; i++) { lo = Math.min(lo, r.d[i]); hi = Math.max(hi, r.d[i]); } mid = (lo + hi) / 2; mx = Math.max(1e-6, (hi - lo) / 2); }
        r.y = [];
        for (i = 0; i < S.N; i++) r.y.push(r.signed ? base + amp / 2 + amp / 2 * (r.d[i] - mid) / mx : base + amp * r.d[i] / mx);
        bar(K, X0, X1, base - 0.004, base + 0.004, K.mat('basic', 'line'), -0.01);
        strip(K, xs, r.y, 0.035, K.mat('basic', r.accent ? 'accent' : 'muted'));
        r.dot = new THREE.Mesh(dotG, dotM); K.scene.add(r.dot);
        K.label(r.name, new THREE.Vector3(X0 - 0.08, base + amp / 2, 0), r.accent ? 'accent' : 'fg', 'r'); // left of its own row, never under another line
      });
      var play = bar(K, -0.008, 0.008, -1.45, 0.9, K.mat('basic', 'accent', { transparent: true, opacity: 0.45 }), 0.01);

      var clock = ctx.reducedMotion ? F.contactTime / SPEED : 0;
      function update() {
        var t = (clock * SPEED) % S.D, s = F.sample(t, 0), R = racketR(s);
        M4.makeBasis(Vw([R[0][0], R[1][0], R[2][0]], v0), Vw([R[0][1], R[1][1], R[2][1]], v1), Vw([R[0][2], R[1][2], R[2][2]], v2));
        rk.quaternion.setFromRotationMatrix(M4);
        var j = clamp(Math.round(t * S.fs), 0, S.N - 1);
        play.position.x = xs[j];
        ROWS.forEach(function (r) { r.dot.position.set(xs[j], r.y[j], 0.02); });
      }
      update(); K.render();
      return {
        frame: function (dt) { if (!ctx.reducedMotion) clock += dt; update(); K.render(); },
        resize: function () { K.resize(); K.render(); },
        setTheme: function (th) { K.setTheme(th); K.render(); },
        dispose: function () { K.dispose(); }
      };
    }
  });

  /* ================================================================ chapter 5: from frames to phases */
  W.Chapters.push({
    id: 'models', order: 6,
    kicker: 'Step 6 · Models',
    title: 'From frames to phases',
    body: "<p><b>First guess each moment, then make the story make sense.</b></p><p>A model looks at each tiny moment and guesses the phase. It is right about <b>98%</b> of the time, but it sometimes flickers: “backswing, forward, backswing, forward”.</p><p>So a second layer adds common sense: a swing always goes idle → back → forward → follow-through → recovery, in that order, once. Now every swing comes out as one clean sequence, and the ball-hit moment is usually within about <b>5 thousandths of a second</b>.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F), Tf = S.Tf;
      var X0 = -4, X1 = 4, fw = (X1 - X0) / Tf;
      var K = kit(stage, ctx, { x0: -4.1, x1: 4.1, y0: -0.75, y1: 1.6 }, 0.32);
      K.caption(['Guessing each moment alone flickers.', 'Adding the swing-order rule gives one clean sequence.']);

      // flickery per-moment guesses (fixed seed: confusion near phase boundaries plus a few stray frames)
      var R = rng(11), guess = new Int8Array(Tf), j, d;
      for (j = 0; j < Tf; j++) {
        var y = S.fph[j], best = 99, nb = y;
        for (d = 1; d < 6; d++) {
          if (j - d >= 0 && S.fph[j - d] !== y) { best = d; nb = S.fph[j - d]; break; }
          if (j + d < Tf && S.fph[j + d] !== y) { best = d; nb = S.fph[j + d]; break; }
        }
        if (best < 5 && R() < 0.55 * (1 - best / 5)) y = nb;
        else if (R() < 0.03) y = (y + (R() < 0.5 ? 1 : 4)) % 5;
        guess[j] = y;
      }

      // a colour bar = one merged mesh (front + top face per frame), coloured per vertex
      function colourBar(labels, yb) {
        var hgt = 0.42, dep = 0.22, pos = new Float32Array(Tf * 8 * 3), colr = new Float32Array(Tf * 8 * 3), idx = [];
        for (var i = 0; i < Tf; i++) {
          var xa = X0 + i * fw, xb = xa + fw * 0.94, o = i * 8;
          pos.set([xa, yb, 0, xb, yb, 0, xb, yb + hgt, 0, xa, yb + hgt, 0,
                   xa, yb + hgt, 0, xb, yb + hgt, 0, xb, yb + hgt, -dep, xa, yb + hgt, -dep], o * 3);
          idx.push(o, o + 1, o + 2, o, o + 2, o + 3, o + 4, o + 5, o + 6, o + 4, o + 6, o + 7);
        }
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colr, 3)); g.setIndex(idx);
        K.scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));
        return { paint: function () {
          for (var i = 0; i < Tf; i++) {
            var c = K.phC[labels[i]];
            for (var v = 0; v < 8; v++) { var f = v < 4 ? 1 : 0.75; colr.set([c.r * f, c.g * f, c.b * f], (i * 8 + v) * 3); }
          }
          g.attributes.color.needsUpdate = true;
        } };
      }
      var bars = [colourBar(guess, 0.75), colourBar(S.fph, -0.35)];
      bars.forEach(function (b) { b.paint(); });
      K.label('Guess per moment', new THREE.Vector3(X0, 1.2, 0), 'muted', 'bl');
      K.label('With common sense', new THREE.Vector3(X0, 0.1, 0), 'fg', 'bl');

      // results table (real numbers from results/summary.json, player-held-out)
      var PH = (ctx.summary && ctx.summary.phase) || {};
      var ROWS = [['LR', 'Logistic regression'], ['HGB', 'Gradient boosting'], ['LR+HMM', 'Logistic regression + HMM'], ['HGB+HMM', 'Gradient boosting + HMM']];
      var tbl = document.createElement('div');
      stage.appendChild(tbl);
      function n(v, d, u) { return typeof v === 'number' ? v.toFixed(d) + (u || '') : '–'; }
      function paintTable() {
        var fg = K.css('fg'), mu = K.css('muted'), ln = K.css('line'), ac = K.css('accent'), bg = K.color('bg');
        tbl.style.cssText = 'position:absolute;left:50%;bottom:62px;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);' +
          'overflow-x:auto;box-sizing:border-box;padding:6px 10px;border-radius:8px;font:12px/1.45 ' + SANS + ';color:' + fg + ';' +
          'background:rgba(' + Math.round(bg.r * 255) + ',' + Math.round(bg.g * 255) + ',' + Math.round(bg.b * 255) + ',0.9);border:1px solid ' + ln + ';pointer-events:none';
        var th = 'style="text-align:right;padding:0 0 3px 14px;color:' + mu + ';font-weight:400;white-space:nowrap"';
        var html = '<table style="border-collapse:collapse"><tr><th style="text-align:left;padding:0 0 3px;color:' + mu + ';font-weight:400"></th>' +
          '<th ' + th + '>Moments right</th><th ' + th + '>Order score</th><th ' + th + '>Ball hit, typical</th><th ' + th + '>Ball hit, worst 10%</th></tr>';
        ROWS.forEach(function (r, i) {
          var m = PH[r[0]] || {}, best = i === ROWS.length - 1;
          var td = 'style="text-align:right;padding:1px 0 1px 14px;white-space:nowrap' + (best ? ';color:' + ac + ';font-weight:600' : '') + '"';
          html += '<tr style="border-top:1px solid ' + ln + '"><td style="padding:1px 0;white-space:nowrap' + (best ? ';color:' + ac + ';font-weight:600' : '') + '">' + r[1] + '</td>' +
            '<td ' + td + '>' + n(m.macro_f1, 1, '%') + '</td><td ' + td + '>' + n(m.edit, 0) + ' / 100</td>' +
            '<td ' + td + '>' + n(m.contact_mae_ms, 1, ' ms') + '</td><td ' + td + '>' + n(m.contact_p90_ms, 0, ' ms') + '</td></tr>';
        });
        tbl.innerHTML = html + '</table>';
      }
      paintTable();
      K.reserveBottom(62 + (tbl.offsetHeight || 110) + 14);

      var play = bar(K, -0.012, 0.012, -0.5, 1.35, K.mat('basic', 'fg', { transparent: true, opacity: 0.6 }), 0.02);
      play.visible = !ctx.reducedMotion;
      var clock = 0;
      function update() { play.position.x = X0 + (X1 - X0) * (((clock * SPEED) % S.D) / S.D); }
      update(); K.render();
      return {
        frame: function (dt) { if (!ctx.reducedMotion) clock += dt; update(); K.render(); },
        resize: function () { K.resize(); K.reserveBottom(62 + (tbl.offsetHeight || 110) + 14); K.render(); },
        setTheme: function (th) { K.setTheme(th); paintTable(); bars.forEach(function (b) { b.paint(); }); K.render(); },
        dispose: function () { K.dispose(); if (tbl.parentNode) tbl.parentNode.removeChild(tbl); }
      };
    }
  });

  /* ================================================================ chapter 6: missing and noisy data */
  W.Chapters.push({
    id: 'gaps', order: 4,
    kicker: 'Step 4 · Missing data',
    title: 'Missing and noisy data',
    body: "<p><b>What to do when the signal drops out.</b></p><p>Small gaps we fill by joining the dots before and after. Bigger gaps we mark as “unknown”, and later the model’s swing-order rule (Step 6) carries us across them.</p><p>Even with <b>30% of the data missing</b>, the final model still scores about <b>98%</b>. The wrong way is filling gaps with zeros: the racket looks like it froze mid-swing, and the score crashes to <b>79%</b>.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F), N = S.N;
      var X0 = -4, X1 = 4, GAP0 = 1.05, GAP1 = 1.35;
      var K = kit(stage, ctx, { x0: -4.1, x1: 4.1, y0: -1.35, y1: 2.35 }, 0.06);
      K.caption(['The same swing loses its signal for a moment.', 'Filling with zeros looks like a frozen racket: 79%.', 'Marking it unknown and bridging keeps the swing: 98%.']);

      var xs = [], zeroFill = [], kept = [], bridge = [], my = absMax(S.yaw), amp = 0.55, i;
      var g0 = Math.round(GAP0 * S.fs), g1 = Math.round(GAP1 * S.fs);
      for (i = 0; i < N; i++) {
        xs.push(X0 + (X1 - X0) * i / (N - 1));
        var v = S.yaw[i] / my * amp, inGap = i > g0 && i < g1;
        zeroFill.push(inGap ? 0 : v);
        kept.push(inGap ? NaN : v);
        // dashed straight bridge across the gap
        var u = (i - g0) / (g1 - g0), lin = (S.yaw[g0] + (S.yaw[g1] - S.yaw[g0]) * u) / my * amp;
        bridge.push(i >= g0 && i <= g1 && Math.floor((i - g0) / 5) % 2 === 0 ? lin : NaN);
      }
      var LANES = [{ base: 1.25, y: zeroFill, c: 'muted', name: 'Filled with zeros' },
                   { base: -0.6, y: kept, c: 'accent', name: 'Marked unknown' }];
      var xg0 = xs[g0], xg1 = xs[g1];
      LANES.forEach(function (L) {
        bar(K, X0, X1, L.base - 0.004, L.base + 0.004, K.mat('basic', 'line'), -0.02);
        bar(K, xg0, xg1, L.base - amp - 0.1, L.base + amp + 0.1, K.mat('basic', 'fg', { transparent: true, opacity: 0.07, depthWrite: false }), -0.03);
        L.line = strip(K, xs, L.y.map(function (y) { return L.base + y; }), 0.04, K.mat('basic', L.c));
        K.label(L.name, new THREE.Vector3(X0, L.base + amp + 0.12, 0), L.c === 'accent' ? 'accent' : 'fg', 'bl');
      });
      var br = strip(K, xs, bridge.map(function (y) { return LANES[1].base + y; }), 0.03, K.mat('basic', 'accent', { transparent: true, opacity: 0.7 }));
      K.label('gap', new THREE.Vector3((xg0 + xg1) / 2, LANES[0].base + amp + 0.12, 0), 'muted', 'b');

      var prog = looper(S.D, 2.5), clock = 0;
      function update() {
        var k = ctx.reducedMotion ? N : prog(clock) * N;
        LANES.forEach(function (L) { L.line.reveal(k); }); br.reveal(k);
      }
      update(); K.render();
      return {
        frame: function (dt) { clock += dt; update(); K.render(); },
        resize: function () { K.resize(); K.render(); },
        setTheme: function (th) { K.setTheme(th); K.render(); },
        dispose: function () { K.dispose(); }
      };
    }
  });
})();
