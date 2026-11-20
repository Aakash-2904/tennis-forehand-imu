/* ch_b.js: chapters 4-6 of the Forehand 3D story.
   4 features : heading-free features, gimbal against gravity, signal ribbons, multi-scale windows
   5 models   : flickering frame classifiers, left-to-right duration HMM, contact snap, results table
   6 gaps     : burst packet loss, zero-fill vs interpolate+mask+flat emission, robustness bars
   Classic script. Numbers come from results/summary.json (ctx.summary at mount, hardcoded only in narration). */
(function () {
  'use strict';
  var W = window, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var MONO = '12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function fmt(v, d) { return (v === undefined || v === null || isNaN(v)) ? '–' : Number(v).toFixed(d === undefined ? 1 : d); }
  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ================================================================ shared signals (computed once from F.sample) */
  var SIG = null;
  function signals(F) {
    if (SIG && SIG.F === F) return SIG;
    var fs = 200, D = F.duration, N = Math.floor(D * fs), i;
    var yaw = new Float32Array(N), acc = new Float32Array(N), jerk = new Float32Array(N), ph = new Int8Array(N);
    for (i = 0; i < N; i++) {
      var s = F.sample(i / fs, 0);
      yaw[i] = s.gyroYaw; acc[i] = s.accMag; ph[i] = s.phase % 5;
    }
    // impact shock + ringing as in simulate.py: A * exp(-k/1.5) * cos(2*pi*0.42*k), k in samples after contact
    var ci = Math.round(F.contactTime * fs);
    for (var k = 0; k < 40 && ci + k < N; k++) acc[ci + k] += 3.2 * Math.exp(-k / 1.5) * Math.cos(2 * Math.PI * 0.42 * k);
    for (i = 0; i < N; i++) jerk[i] = Math.abs(acc[i] - acc[(i - 1 + N) % N]);
    // contact snap: first sample within +-8 samples (40 ms) whose jerk >= half the local peak (experiment.refine_contact)
    var lo = Math.max(0, ci - 8), hi = Math.min(N - 1, ci + 8), pk = 0;
    for (i = lo; i <= hi; i++) pk = Math.max(pk, jerk[i]);
    var onset = ci; for (i = lo; i <= hi; i++) if (jerk[i] >= 0.5 * pk) { onset = i; break; }
    var Tf = Math.floor(D * 100), fph = new Int8Array(Tf);
    for (i = 0; i < Tf; i++) fph[i] = ph[Math.min(N - 1, 2 * i)];
    SIG = { F: F, fs: fs, D: D, N: N, yaw: yaw, acc: acc, jerk: jerk, ph: ph, Tf: Tf, fph: fph, ci: ci, onset: onset };
    return SIG;
  }
  function absMax(a) { var m = 1e-9; for (var i = 0; i < a.length; i++) if (isFinite(a[i])) m = Math.max(m, Math.abs(a[i])); return m; }

  /* ================================================================ racket orientation (scene.js pose: R = Rz(alpha) Rx(-er) B Rx(beta)) */
  function mm(A, B) { var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]; return C; }
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  var BR = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  function racketR(s) { return mm(mm(mm(Rz(s.alpha * D2R), Rx(-s.rkElev * D2R)), BR), Rx((s.roll + 5) * D2R)); }
  function col(R, j) { return [R[0][j], R[1][j], R[2][j]]; }

  /* ================================================================ kit: renderer, camera, orbit, labels, theme registry */
  function kit(stage, ctx, o) {
    var THREE = ctx.THREE, theme = ctx.theme || {};
    function css(c, th) {
      th = th || theme;
      if (typeof c === 'function') return c(th);
      if (!c) return '#888888';
      if (c.charAt(0) === '#' || c.indexOf('rgb') === 0) return c;
      if (/^ph\d$/.test(c)) return (th.phaseColors && th.phaseColors[+c.charAt(2)]) || '#888888';
      return th[c] || '#888888';
    }
    function color(c, th) { var x = new THREE.Color(); var s = css(c, th); try { x.set(s || '#888888'); } catch (e) { x.set('#888888'); } return x; }
    function mix(a, b, t) { return function (th) { return '#' + color(a, th).lerp(color(b, th), t).getHexString(); }; }
    function rgba(c, a) { var x = color(c); return 'rgba(' + Math.round(x.r * 255) + ',' + Math.round(x.g * 255) + ',' + Math.round(x.b * 255) + ',' + a + ')'; }

    var R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    R.setPixelRatio(Math.min(2, W.devicePixelRatio || 1));
    var cv = R.domElement;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    stage.appendChild(cv);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;overflow:hidden;font:' + MONO;
    stage.appendChild(ov);

    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(o.fov || 36, 1, 0.05, 200);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x3a4a40, 0.95); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(3, 8, 6); scene.add(sun);

    var view = { target: o.target.clone(), dist: o.dist, az: o.az || 0, el: o.el || 0.3, aspect: o.aspect || 1.6, shiftY: o.shiftY || 0 };
    var user = { az: 0, el: 0, zoom: 1 }, drag = null, w = 1, h = 1;
    function down(e) { drag = { x: e.clientX, y: e.clientY, az: user.az, el: user.el }; cv.style.cursor = 'grabbing'; try { cv.setPointerCapture(e.pointerId); } catch (_) {} }
    function move(e) { if (!drag) return; user.az = drag.az - (e.clientX - drag.x) * 0.006; user.el = clamp(drag.el + (e.clientY - drag.y) * 0.005, -0.5, 0.8); }
    function up() { drag = null; cv.style.cursor = 'grab'; }
    function wheel(e) { e.preventDefault(); user.zoom = clamp(user.zoom * Math.exp(e.deltaY * 0.001), 0.55, 2.2); }
    cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });

    var mats = [];
    function mat(kind, c, extra) {
      var p = extra || {}, m;
      p.color = color(c);
      if (kind === 'line') m = new THREE.LineBasicMaterial(p);
      else if (kind === 'dash') m = new THREE.LineDashedMaterial(p);
      else if (kind === 'lambert') m = new THREE.MeshLambertMaterial(p);
      else m = new THREE.MeshBasicMaterial(p);
      mats.push({ m: m, c: c });
      return m;
    }

    var labels = [], tmp = new THREE.Vector3();
    function label(html, pos, st) {
      st = st || {};
      var el = document.createElement('div');
      el.innerHTML = html;
      var L = { el: el, pos: pos, st: st, on: true, op: 1 };
      L.paint = function () {
        el.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;line-height:1.25;will-change:transform;' +
          'font-size:' + (st.size || 11) + 'px;color:' + css(st.c || 'fg') + ';' + (st.bold ? 'font-weight:700;' : '') +
          (st.plain ? '' : 'background:' + rgba('bg', 0.8) + ';padding:1px 5px;border-radius:4px;border:1px solid ' + rgba(st.c || 'line', 0.35) + ';');
      };
      L.set = function (s) { if (s !== L._s) { L._s = s; el.innerHTML = s; } };
      L.paint(); ov.appendChild(el); labels.push(L);
      return L;
    }
    function hud(cssText) {
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;' + cssText;
      ov.appendChild(d); return d;
    }
    function placeLabels() {
      for (var i = 0; i < labels.length; i++) {
        var L = labels[i];
        var p = typeof L.pos === 'function' ? L.pos() : L.pos;
        if (!L.on || !p || L.op <= 0.01) { L.el.style.display = 'none'; continue; }
        tmp.copy(p).project(cam);
        var x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
        if (tmp.z > 1 || x < -40 || x > w + 40 || y < 0 || y > h - 60) { L.el.style.display = 'none'; continue; }
        L.el.style.display = 'block';
        L.el.style.opacity = L.op;
        var a = L.st.anchor || 'b', tr = a === 'l' ? 'translate(4px,-50%)' : a === 'r' ? 'translate(calc(-100% - 4px),-50%)' :
          a === 'c' ? 'translate(-50%,-50%)' : a === 't' ? 'translate(-50%,4px)' : 'translate(-50%,calc(-100% - 4px))';
        L.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) ' + tr;
      }
    }

    var K = {
      THREE: THREE, scene: scene, cam: cam, view: view, user: user, ov: ov, renderer: R,
      css: css, color: color, mix: mix, rgba: rgba, mat: mat, label: label, hud: hud,
      phC: [], narrow: false,
      size: function () { return { w: w, h: h }; },
      resize: function () {
        w = Math.max(1, stage.clientWidth || 640); h = Math.max(1, stage.clientHeight || 400);
        R.setSize(w, h, false); cam.aspect = w / h; K.narrow = w < 560;
      },
      render: function () {
        var a = view.az + user.az, e = clamp(view.el + user.el, -0.35, 1.35);
        var d = view.dist * user.zoom * Math.max(1, view.aspect / (w / h));
        cam.position.set(view.target.x + d * Math.cos(e) * Math.sin(a), view.target.y + d * Math.sin(e), view.target.z + d * Math.cos(e) * Math.cos(a));
        cam.lookAt(view.target);
        if (view.shiftY) cam.setViewOffset(w, h, 0, -view.shiftY * h, w, h); else cam.clearViewOffset();
        cam.updateProjectionMatrix();
        R.render(scene, cam);
        placeLabels();
      },
      setTheme: function (th) {
        theme = th || theme;
        scene.background = color('bg');
        for (var i = 0; i < 5; i++) K.phC[i] = color('ph' + i);
        mats.forEach(function (r) { r.m.color.copy(color(r.c)); });
        labels.forEach(function (L) { L.paint(); });
      },
      dispose: function () {
        cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
        cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
        cv.removeEventListener('wheel', wheel);
        scene.traverse(function (ob) {
          if (ob.geometry) ob.geometry.dispose();
          if (ob.material) [].concat(ob.material).forEach(function (m) { m.dispose(); });
        });
        R.dispose(); if (R.forceContextLoss) R.forceContextLoss();
        if (cv.parentNode) cv.parentNode.removeChild(cv);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        labels = []; mats = [];
      }
    };
    K.setTheme(theme); K.resize();
    return K;
  }

  /* ================================================================ geometry helpers */
  // ribbon: a flat band following the curve (top) plus a translucent curtain down to `base`; NaN breaks it
  function ribbon(K, xs, ys, z, wd, base, topMat, curMat) {
    var THREE = K.THREE, n = xs.length, pos = new Float32Array(n * 6), cpos = new Float32Array(n * 6), idx = [], segEnd = new Int32Array(n), i;
    for (i = 0; i < n; i++) {
      var y = isFinite(ys[i]) ? ys[i] : base;
      pos.set([xs[i], y, z - wd / 2, xs[i], y, z + wd / 2], i * 6);
      cpos.set([xs[i], y, z, xs[i], base, z], i * 6);
    }
    for (i = 0; i < n - 1; i++) {
      if (isFinite(ys[i]) && isFinite(ys[i + 1])) { var a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      segEnd[i + 1] = idx.length;
    }
    function mk(p, m) {
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setIndex(idx);
      g.computeVertexNormals(); var me = new THREE.Mesh(g, m); K.scene.add(me); return me;
    }
    var top = mk(pos, topMat), cur = curMat ? mk(cpos, curMat) : null;
    return { top: top, cur: cur, reveal: function (k) {
      var c = segEnd[clamp(k | 0, 0, n - 1)];
      top.geometry.setDrawRange(0, c); if (cur) cur.geometry.setDrawRange(0, c);
    } };
  }
  // merged boxes with vertex colours, ordered so drawRange(0, 36*k) reveals the first k
  function tiles(K, n, posFn, size) {
    var THREE = K.THREE, tpl = new THREE.BoxGeometry(size[0], size[1], size[2]);
    var tp = tpl.attributes.position.array, tn = tpl.attributes.normal.array, ti = tpl.index.array, nv = tp.length / 3;
    var pos = new Float32Array(n * nv * 3), nor = new Float32Array(n * nv * 3), colr = new Float32Array(n * nv * 3), idx = new (n * nv > 65000 ? Uint32Array : Uint16Array)(n * ti.length);
    for (var i = 0; i < n; i++) {
      var p = posFn(i);
      for (var v = 0; v < nv; v++) {
        var o = (i * nv + v) * 3;
        pos[o] = tp[v * 3] + p[0]; pos[o + 1] = tp[v * 3 + 1] + p[1]; pos[o + 2] = tp[v * 3 + 2] + p[2];
        nor[o] = tn[v * 3]; nor[o + 1] = tn[v * 3 + 1]; nor[o + 2] = tn[v * 3 + 2];
        colr[o] = colr[o + 1] = colr[o + 2] = 0.6;
      }
      for (var j = 0; j < ti.length; j++) idx[i * ti.length + j] = ti[j] + i * nv;
    }
    tpl.dispose();
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    var m = new THREE.MeshLambertMaterial({ vertexColors: true });
    var mesh = new THREE.Mesh(g, m); K.scene.add(mesh);
    return {
      mesh: mesh, per: ti.length,
      set: function (i, c) { for (var v = 0; v < nv; v++) { var o = (i * nv + v) * 3; colr[o] = c.r; colr[o + 1] = c.g; colr[o + 2] = c.b; } },
      commit: function () { g.attributes.color.needsUpdate = true; },
      reveal: function (k) { g.setDrawRange(0, clamp(k, 0, n) * ti.length); }
    };
  }
  function dynLine(K, n, m) {
    var THREE = K.THREE, arr = new Float32Array(n * 3), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    var l = new THREE.Line(g, m); l.frustumCulled = false; K.scene.add(l);
    return { obj: l, set: function (fn) {
      for (var i = 0; i < n; i++) { var v = fn(i / (n - 1)); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
      g.attributes.position.needsUpdate = true;
      if (l.material.isLineDashedMaterial) l.computeLineDistances();
    } };
  }
  function segs(K, pts, m) {
    var g = new K.THREE.BufferGeometry(); g.setAttribute('position', new K.THREE.Float32BufferAttribute(pts, 3));
    var l = new K.THREE.LineSegments(g, m); K.scene.add(l); return l;
  }
  function boxWire(K, fillMat, lineMat) {
    var THREE = K.THREE, grp = new THREE.Group(), bg = new THREE.BoxGeometry(1, 1, 1);
    if (fillMat) grp.add(new THREE.Mesh(bg, fillMat));
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(bg), lineMat));
    if (!fillMat) bg.dispose();
    K.scene.add(grp); return grp;
  }
  function court(K, cx, cy, cz, sx, sz) { // hard-court slab with white lines
    var THREE = K.THREE;
    var slab = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.05, sz), K.mat('lambert', 'ground'));
    slab.position.set(cx, cy - 0.025, cz); K.scene.add(slab);
    var y = cy + 0.003, x0 = cx - sx / 2 + 0.12, x1 = cx + sx / 2 - 0.12, z0 = cz - sz / 2 + 0.12, z1 = cz + sz / 2 - 0.12;
    segs(K, [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0],
      K.mat('line', '#f4f6f2', { transparent: true, opacity: 0.85 }));
    return slab;
  }
  function makeRacket(K, s) {
    var THREE = K.THREE, g = new THREE.Group(), fm = K.mat('lambert', 'fg'), cm = K.mat('basic', 'accent');
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * s, 0.024 * s, 0.32 * s, 10), fm);
    handle.rotation.z = -Math.PI / 2; handle.position.x = 0.16 * s; g.add(handle);
    var head = new THREE.Mesh(new THREE.TorusGeometry(0.21 * s, 0.014 * s, 8, 44), fm);
    head.scale.set(1.32, 1, 1); head.position.x = 0.64 * s; g.add(head);
    var strings = new THREE.Mesh(new THREE.CircleGeometry(0.2 * s, 32), K.mat('basic', 'fg', { transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    strings.scale.set(1.32, 1, 1); strings.position.x = 0.64 * s; g.add(strings);
    var thr = segs(K, [0.32 * s, 0, 0, 0.40 * s, 0.11 * s, 0, 0.32 * s, 0, 0, 0.40 * s, -0.11 * s, 0], K.mat('line', 'fg'));
    K.scene.remove(thr); g.add(thr);
    var cap = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.06 * s, 0.06 * s), cm); g.add(cap);
    K.scene.add(g);
    return g;
  }
  function cone(K, m, r, hgt) { var c = new K.THREE.Mesh(new K.THREE.ConeGeometry(r, hgt, 12), m); K.scene.add(c); return c; }
  function V(w, out) { return (out || new (W.THREE.Vector3)()).set(w[0], w[2], -w[1]); }

  /* ================================================================ chapter 4: features without heading */
  W.Chapters = W.Chapters || [];
  W.Chapters.push({
    id: 'features', order: 4,
    kicker: 'Step 4 · Features',
    title: 'Features without heading',
    body: "<p><b>Measure only things we can trust.</b></p><p>The compass drifts, so we never ask “which way is the racket pointing?” Instead we ask things gravity can always answer: how fast is it turning, is the tip up or down, is the face tilted, and was there a sudden jolt? (The jolt is the ball hit.)</p><p>Every hundredth of a second we turn these into <b>60 small measurements</b> that describe what the racket is doing.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F);
      var K = kit(stage, ctx, { target: new THREE.Vector3(0.3, 0.0, 0), dist: 11.0, el: 0.3, az: 0, aspect: 1.35, fov: 36 });
      var X0 = -4, XW = 8, D = S.D;
      function tx(t) { return X0 + t / D * XW; }

      // ---- gimbal (centre = butt cap sensor)
      var C = new THREE.Vector3(1.7, 1.75, 0), CW = [0, 0, 0]; // world-frame origin of the gimbal
      var gm = K.mat('lambert', 'fg');
      var gAxis = segs(K, [C.x, C.y + 1.5, C.z, C.x, C.y - 1.15, C.z], K.mat('line', 'fg'));
      var gHead = cone(K, gm, 0.07, 0.2); gHead.position.set(C.x, C.y - 1.25, C.z); gHead.rotation.x = Math.PI;
      // heading ring: dashed, greyed, drifting
      var hRingMat = K.mat('dash', K.mix('muted', 'bg', 0.25), { dashSize: 0.09, gapSize: 0.07, transparent: true, opacity: 0.8 });
      var hRing = dynLine(K, 97, hRingMat);
      hRing.set(function (u) { var a = u * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 1.32, 0, Math.sin(a) * 1.32); });
      hRing.obj.position.copy(C);
      var hTicks = []; for (var ti = 0; ti < 12; ti++) { var a0 = ti / 12 * Math.PI * 2; hTicks.push(Math.cos(a0) * 1.25, 0, Math.sin(a0) * 1.25, Math.cos(a0) * 1.4, 0, Math.sin(a0) * 1.4); }
      var hTick = segs(K, hTicks, K.mat('line', 'muted', { transparent: true, opacity: 0.5 })); hTick.position.copy(C);
      var hPtr = cone(K, K.mat('basic', 'muted'), 0.05, 0.16);
      // elevation ring (vertical, follows racket azimuth)
      var eRing = dynLine(K, 73, K.mat('line', 'ph1', { transparent: true, opacity: 0.55 }));
      var eArc = dynLine(K, 33, K.mat('line', 'ph1'));
      var eRef = dynLine(K, 2, K.mat('dash', 'ph1', { dashSize: 0.05, gapSize: 0.04 }));
      // yaw rate about gravity: horizontal arc arrow
      var yArc = dynLine(K, 49, K.mat('line', 'ph2'));
      var yTip = cone(K, K.mat('basic', 'ph2'), 0.045, 0.13);
      // face normal + tilt arc
      var nLine = dynLine(K, 2, K.mat('line', 'ph3'));
      var nTip = cone(K, K.mat('basic', 'ph3'), 0.035, 0.1);
      var fArc = dynLine(K, 25, K.mat('line', 'ph3'));
      var rk = makeRacket(K, 1.25);
      var m4 = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();

      // ---- signal ribbons on a hard-court slab
      var FLOOR = -1.85;
      court(K, 0, FLOOR, -0.3, 8.9, 3.1);
      var step = 2, xs = [], yA = [], yB = [], yC = [];
      var my = absMax(S.yaw), ma = absMax(S.acc), mj = absMax(S.jerk);
      var rows = [
        { z: 0.7, name: 'yaw rate about g', c: 'accent', base: FLOOR + 0.42, amp: 0.4, signed: true, arr: yA },
        { z: -0.3, name: '|acc|', c: 'ph1', base: FLOOR + 0.62, amp: 0.7, arr: yB },
        { z: -1.3, name: 'jerk (impact)', c: 'ph2', base: FLOOR + 1.12, amp: 0.7, arr: yC }
      ];
      for (var i = 0; i < S.N; i += step) {
        xs.push(tx(i / S.fs));
        yA.push(rows[0].base + rows[0].amp * S.yaw[i] / my);
        yB.push(rows[1].base + rows[1].amp * S.acc[i] / ma);
        yC.push(rows[2].base + rows[2].amp * Math.min(1, S.jerk[Math.min(S.N - 1, i)] / mj + (i + 1 < S.N ? S.jerk[i + 1] / mj : 0)));
      }
      rows.forEach(function (r) {
        ribbon(K, xs, r.arr, r.z, 0.09, r.base, K.mat('lambert', r.c, { side: THREE.DoubleSide }),
          K.mat('basic', r.c, { transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
        segs(K, [X0, r.base, r.z, X0 + XW, r.base, r.z], K.mat('line', 'fg', { transparent: true, opacity: 0.25 }));
        K.label(r.name, new THREE.Vector3(X0 + XW + 0.08, r.base + 0.05, r.z), { anchor: 'l', c: r.c, size: 10.5 });
      });
      // 10 ms frame ticks along the front edge
      var tk = [], zf = 1.2; for (var f = 0; f <= S.Tf; f++) { var xx = tx(f / 100), hh = f % 10 === 0 ? 0.09 : 0.04; tk.push(xx, FLOOR + 0.004, zf, xx, FLOOR + 0.004, zf - hh); }
      segs(K, tk, K.mat('line', '#f4f6f2', { transparent: true, opacity: 0.6 }));
      var frameMark = new THREE.Mesh(new THREE.BoxGeometry(XW / S.Tf, 0.02, 0.16), K.mat('basic', 'accent')); K.scene.add(frameMark);

      // nested windows (25 / 105 / 305 ms) + past / future 150 ms
      var wins = [
        { ms: 305, fill: 0.05, c: 'muted' }, { ms: 105, fill: 0.08, c: 'fg' }, { ms: 25, fill: 0.16, c: 'accent' }
      ].map(function (wd, j) {
        var g = boxWire(K, K.mat('basic', wd.c, { transparent: true, opacity: wd.fill, depthWrite: false }), K.mat('line', wd.c, { transparent: true, opacity: 0.9 }));
        var hgt = 2.0 + j * 0.1;
        g.scale.set(wd.ms / 1000 / D * XW, hgt, 2.75 - j * 0.12);
        wd.g = g; wd.hgt = hgt;
        var lx = [-0.5, 0.5, 0][j], ly = [0, 0, 0.18][j];
        wd.lab = K.label(wd.ms + ' ms', function () { return new THREE.Vector3(g.position.x + lx * g.scale.x, FLOOR + hgt + ly, g.position.z - g.scale.z / 2); }, { c: wd.c, size: 10, anchor: ['r', 'l', 'b'][j] });
        return wd;
      });
            var pastM = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), K.mat('basic', 'ph1', { transparent: true, opacity: 0.55 }));
      var futM = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), K.mat('basic', 'ph4', { transparent: true, opacity: 0.55 }));
      K.scene.add(pastM); K.scene.add(futM);
      var hw = 0.15 / D * XW;
      pastM.scale.set(hw, 1, 0.22); futM.scale.set(hw, 1, 0.22);
      var lPast = K.label('past 150 ms', function () { return new THREE.Vector3(pastM.position.x - hw * 0.5, FLOOR, 1.0); }, { c: 'ph1', size: 10, anchor: 'r' });
      var lFut = K.label('future 150 ms', function () { return new THREE.Vector3(futM.position.x + hw * 0.5, FLOOR, 1.0); }, { c: 'ph4', size: 10, anchor: 'l' });

      // ---- gimbal labels
      var gLab = K.label('g · gravity · fixed, trusted', new THREE.Vector3(C.x + 0.1, C.y - 1.25, C.z), { anchor: 'l', c: 'fg' });
      var pHead = new THREE.Vector3(), pYaw = new THREE.Vector3(), pEl = new THREE.Vector3(), pFace = new THREE.Vector3();
      var lHead = K.label('', pHead, { anchor: 'l', c: 'muted' });
      var lYaw = K.label('', pYaw, { anchor: 'r', c: 'ph2' });
      var lEl = K.label('', pEl, { anchor: 'l', c: 'ph1' });
      var lFace = K.label('', pFace, { anchor: 'b', c: 'ph3' });

      // ---- HUD
      var box = K.hud('left:10px;top:10px;max-width:min(300px,48%);display:flex;flex-direction:column;gap:6px');
      var badge = document.createElement('div'), read = document.createElement('div');
      box.appendChild(badge); box.appendChild(read);
      function paintHud() {
        var panel = 'background:' + K.rgba('bg', 0.86) + ';border:1px solid ' + K.css('line') + ';border-radius:8px;padding:6px 8px;color:' + K.css('fg') + ';';
        badge.style.cssText = panel + 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap';
        badge.innerHTML = '<span style="font-size:24px;font-weight:700;color:' + K.css('accent') + '">60</span>' +
          '<span><b>features per 10 ms frame</b><br><span style="color:' + K.css('muted') + ';font-size:10.5px">13 raw · 36 window mean/SD · 8 past/future · 2 Δheading ±300 ms · 1 saturation</span></span>';
        read.style.cssText = panel + 'font-size:11px;font-variant-numeric:tabular-nums;line-height:1.45';
      }
      paintHud();

      var clock = 0, drift = 0, speed = ctx.reducedMotion ? 0.08 : 0.32, last = '';
      function update() {
        var t = (clock * speed) % D, s = F.sample(t, 0), Rm = racketR(s);
        var xr = col(Rm, 0), yr = col(Rm, 1), zr = col(Rm, 2);
        V(xr, vx); V(yr, vy); V(zr, vz);
        m4.makeBasis(vx, vy, vz); rk.quaternion.setFromRotationMatrix(m4); rk.position.copy(C);
        var az = Math.atan2(xr[1], xr[0]), elev = Math.asin(clamp(xr[2], -1, 1)), tilt = Math.asin(clamp(zr[2], -1, 1));
        function W3(x, y, z) { return new THREE.Vector3(C.x + x, C.y + z, C.z - y); }
        eRing.set(function (u) { var a = u * Math.PI * 2; return W3(Math.cos(a) * Math.cos(az) * 1.08, Math.cos(a) * Math.sin(az) * 1.08, Math.sin(a) * 1.08); });
        eArc.set(function (u) { var e = u * elev; return W3(Math.cos(e) * Math.cos(az) * 0.95, Math.cos(e) * Math.sin(az) * 0.95, Math.sin(e) * 0.95); });
        eRef.set(function (u) { return W3(u * Math.cos(az) * 1.08, u * Math.sin(az) * 1.08, 0); });
        pEl.copy(W3(Math.cos(elev / 2) * Math.cos(az) * 1.1, Math.cos(elev / 2) * Math.sin(az) * 1.1, Math.sin(elev / 2) * 1.1));
        // yaw-rate arc about gravity (length proportional to rate, 0.22 deg per deg/s, clamped)
        var sweep = clamp(s.gyroYaw * 0.22, -300, 300) * D2R, ry = 0.62, hy = -0.32;
        yArc.set(function (u) { var a = az + u * sweep; return W3(Math.cos(a) * ry, Math.sin(a) * ry, hy); });
        var ae = az + sweep, sg = sweep >= 0 ? 1 : -1;
        yTip.position.copy(W3(Math.cos(ae) * ry, Math.sin(ae) * ry, hy));
        var tan = V([-Math.sin(ae) * sg, Math.cos(ae) * sg, 0]).normalize();
        yTip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
        yTip.visible = Math.abs(sweep) > 0.08;
        pYaw.copy(W3(Math.cos(az + sweep / 2) * ry * 1.05, Math.sin(az + sweep / 2) * ry * 1.05, hy - 0.05));
        // face normal at the head centre
        var hc = [xr[0] * 0.67, xr[1] * 0.67, xr[2] * 0.67];
        var nEnd = [hc[0] + zr[0] * 0.5, hc[1] + zr[1] * 0.5, hc[2] + zr[2] * 0.5];
        nLine.set(function (u) { return W3(hc[0] + zr[0] * 0.5 * u, hc[1] + zr[1] * 0.5 * u, hc[2] + zr[2] * 0.5 * u); });
        nTip.position.copy(W3(nEnd[0], nEnd[1], nEnd[2]));
        nTip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(zr).normalize());
        var hz = Math.hypot(zr[0], zr[1]) || 1, hx = zr[0] / hz, hyy = zr[1] / hz;
        fArc.set(function (u) { var e = u * tilt; return W3(hc[0] + Math.cos(e) * hx * 0.3, hc[1] + Math.cos(e) * hyy * 0.3, hc[2] + Math.sin(e) * 0.3); });
        pFace.copy(W3(nEnd[0], nEnd[1], nEnd[2] + 0.05));
        // heading ring drifts: arbitrary start + slow random-walk-like drift
        var hdg = az + drift;
        hRing.obj.rotation.y = drift; hTick.rotation.y = drift;
        hPtr.position.copy(W3(Math.cos(hdg) * 1.32, Math.sin(hdg) * 1.32, 0));
        hPtr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V([Math.cos(hdg), Math.sin(hdg), 0]));
        pHead.copy(W3(Math.cos(hdg) * 1.45, Math.sin(hdg) * 1.45, 0.02));
        var hd = ((hdg * R2D) % 360 + 360) % 360;
        lHead.set('heading <s>' + hd.toFixed(0) + '°</s> · drifts · untrusted');
        lYaw.set('yaw rate about g ' + (s.gyroYaw >= 0 ? '+' : '') + s.gyroYaw.toFixed(0) + ' °/s');
        lEl.set('tip elevation ' + (elev * R2D).toFixed(0) + '°');
        lFace.set('face tilt ' + (tilt * R2D).toFixed(0) + '°');
        lYaw.on = Math.abs(sweep) > 0.25;
        // windows + frame marker follow the cursor time
        var x = tx(t), zc = -0.3;
        wins.forEach(function (wd) { wd.g.position.set(x, FLOOR + wd.hgt / 2, zc); });
        pastM.position.set(x - hw / 2, FLOOR + 0.01, 1.0); futM.position.set(x + hw / 2, FLOOR + 0.01, 1.0);
        frameMark.position.set(tx(Math.floor(t * 100) / 100 + 0.005), FLOOR + 0.01, zf - 0.08);
        var ph = ['idle', 'backswing', 'forward swing', 'follow-through', 'recovery'][s.phase % 5];
        var key = s.gyroYaw.toFixed(0) + hd.toFixed(0) + ph;
        if (key !== last) {
          last = key;
          var mu = K.css('muted');
          read.innerHTML = '<div style="color:' + K.css('ph4') + ';font-size:10px;letter-spacing:.08em">TRUSTED · vs gravity</div>' +
            row('yaw rate about g', (s.gyroYaw >= 0 ? '+' : '') + s.gyroYaw.toFixed(0) + ' °/s', 'ph2') +
            row('tip elevation', (elev * R2D).toFixed(0) + '°', 'ph1') + row('face tilt', (tilt * R2D).toFixed(0) + '°', 'ph3') +
            row('|acc|', s.accMag.toFixed(2) + ' g', 'fg') +
            '<div style="color:' + mu + ';font-size:10px;letter-spacing:.08em;margin-top:3px">UNTRUSTED · no magnetometer</div>' +
            row('heading (AHRS)', '<s>' + hd.toFixed(0) + '°</s>', 'muted') +
            '<div style="color:' + mu + ';margin-top:3px">frame ' + Math.floor(t * 100) + ' · ' + ph + '</div>';
        }
      }
      function row(k, v, c) { return '<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:' + K.css('muted') + '">' + k + '</span><b style="color:' + K.css(c) + '">' + v + '</b></div>'; }

      update(); K.render();
      return {
        frame: function (dt) {
          clock += dt;
          drift += dt * (ctx.reducedMotion ? 0.02 : 0.11) * (1 + 0.6 * Math.sin(clock * 0.37));
          if (!ctx.reducedMotion) K.view.az = 0.16 * Math.sin(clock * 0.15);
          update(); K.render();
        },
        resize: function () { K.resize(); K.render(); },
        setTheme: function (th) { K.setTheme(th); paintHud(); last = ''; update(); K.render(); },
        dispose: function () { K.dispose(); }
      };
    }
  });

  /* ================================================================ chapter 5: from frames to phases */
  W.Chapters.push({
    id: 'models', order: 5,
    kicker: 'Step 5 · Models',
    title: 'From frames to phases',
    body: "<p><b>First guess each moment, then make the story make sense.</b></p><p>A model looks at each tiny moment and guesses the phase. It is right about <b>98%</b> of the time, but it sometimes flickers: “backswing, forward, backswing, forward”.</p><p>So a second layer adds common sense: a swing always goes idle → back → forward → follow-through → recovery, in that order, once. Now every swing comes out as one clean sequence, and the ball-hit moment is usually within about <b>5 thousandths of a second</b>.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F), sum = ctx.summary || {};
      var K = kit(stage, ctx, { target: new THREE.Vector3(0, 0.75, 0), dist: 10.4, el: 0.42, az: 0, aspect: 1.55, shiftY: 0.12 });
      var X0 = -4, XW = 8, D = S.D, Tf = S.Tf, fw = XW / Tf;
      function tx(t) { return X0 + t / D * XW; }
      var hm = sum.hmm || {}, nS = hm.n_states || [78, 25, 8, 14, 25], selfP = hm.self_p || [0.993, 0.970, 0.914, 0.949, 0.970];
      var NAMES = ['idle', 'backswing', 'forward', 'follow-thr.', 'recovery'];

      // ---- timeline rows
      court(K, 0, -0.06, 0.35, 8.9, 2.3);
      var ROWS = [{ name: 'LogReg', z: 1.0, rate: 0.03, bnd: 5, seed: 11 }, { name: 'GBoost', z: 0.5, rate: 0.017, bnd: 4, seed: 23 }, { name: 'HMM', z: 0, hmm: true }];
      var bdist = new Int16Array(Tf), bnb = new Int8Array(Tf); // distance to nearest true boundary, phase across it
      for (var j = 0; j < Tf; j++) {
        var best = 99, nb = S.fph[j];
        for (var d = 1; d < 8; d++) {
          if (j - d >= 0 && S.fph[j - d] !== S.fph[j]) { best = d; nb = S.fph[j - d]; break; }
          if (j + d < Tf && S.fph[j + d] !== S.fph[j]) { best = d; nb = S.fph[j + d]; break; }
        }
        bdist[j] = best; bnb[j] = nb;
      }
      var cFrame = Math.round(F.contactTime * 100);
      var hmmLab = new Int8Array(Tf);
      for (j = 0; j < Tf; j++) hmmLab[j] = S.fph[j];
      for (j = cFrame; j < cFrame + 3 && j < Tf; j++) hmmLab[j] = 2; // decoded F->FT boundary 30 ms late, then snapped
      ROWS.forEach(function (r) {
        r.t = tiles(K, Tf, function (i) { return [X0 + (i + 0.5) * fw, 0.06, r.z]; }, [fw * 0.86, r.hmm ? 0.14 : 0.1, 0.34]);
        r.lab = K.label(r.hmm ? '<b>HMM</b> decode' : r.name, new THREE.Vector3(X0 - 0.08, 0.06, r.z), { anchor: 'r', c: r.hmm ? 'accent' : 'fg', size: 11 });
      });
      var flickLab = K.label('flicker', new THREE.Vector3(X0 + XW + 0.08, 0.06, 0.75), { anchor: 'l', c: 'muted', size: 10 });
      var cleanLab = K.label('one clean cycle', new THREE.Vector3(X0 + XW + 0.08, 0.06, 0), { anchor: 'l', c: 'accent', size: 10 });
      function paintRows(epoch) {
        ROWS.forEach(function (r) {
          if (r.hmm) { for (var i = 0; i < Tf; i++) r.t.set(i, K.phC[hmmLab[i]]); r.t.commit(); return; }
          var R = rng(r.seed * 7919 + epoch * 104729);
          for (var i2 = 0; i2 < Tf; i2++) {
            var y = S.fph[i2];
            if (bdist[i2] < r.bnd && R() < 0.55 * (1 - bdist[i2] / r.bnd)) y = bnb[i2];
            else if (R() < r.rate) { y = (y + (R() < 0.5 ? 1 : 4)) % 5; if (R() < 0.35 && i2 + 1 < Tf) { r.t.set(i2, K.phC[y]); i2++; } }
            r.t.set(i2, K.phC[y]);
          }
          r.t.commit();
        });
      }

      // ---- jerk trace behind the rows + contact snap
      var jz = -0.55, jb = 0.0, jm = absMax(S.jerk), jx = [], jy = [];
      for (var i = 0; i < S.N; i++) { jx.push(tx(i / S.fs)); jy.push(jb + 0.6 * S.jerk[i] / jm); }
      ribbon(K, jx, jy, jz, 0.05, jb, K.mat('basic', 'ph2', { side: THREE.DoubleSide }), K.mat('basic', 'ph2', { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      K.label('jerk', new THREE.Vector3(X0 - 0.08, jb + 0.05, jz), { anchor: 'r', c: 'ph2', size: 10 });
      var onsetX = tx(S.onset / S.fs), decX = tx(F.contactTime + 0.03), brW = 0.08 / D * XW;
      var bracket = boxWire(K, K.mat('basic', 'accent', { transparent: true, opacity: 0.1, depthWrite: false }), K.mat('line', 'accent'));
      bracket.scale.set(brW, 0.8, 1.9); bracket.position.set(onsetX, 0.4, 0.25);
      var pillar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.0, 0.03), K.mat('basic', 'accent')); K.scene.add(pillar);
      var pillarTop = new THREE.Vector3();
      var cLab = K.label('', function () { return pillarTop; }, { c: 'accent', size: 10.5, anchor: 'b' });

      // ---- HMM chain of state rings
      var RINGS = nS.map(function (n) { return Math.max(2, Math.round(Math.sqrt(n))); });
      var ds = 0.27, gap = 0.5, total = 0;
      RINGS.forEach(function (r, k) { total += (r - 1) * ds + (k < 4 ? gap : 0); });
      var CY = 1.75, CZ = -0.5, x = -total / 2, ringPos = [], conn = [];
      var torG = new THREE.TorusGeometry(0.105, 0.02, 8, 28);
      RINGS.forEach(function (r, k) {
        var mtl = K.mat('lambert', 'ph' + k), list = [];
        for (var q = 0; q < r; q++) {
          var m = new THREE.Mesh(torG, mtl); m.rotation.y = Math.PI / 2; m.position.set(x, CY, CZ); K.scene.add(m);
          list.push(new THREE.Vector3(x, CY, CZ));
          if (q < r - 1) { conn.push(x + 0.02, CY, CZ, x + ds - 0.02, CY, CZ); x += ds; }
        }
        // self-loop on the last state
        var loop = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 24, Math.PI * 1.65), mtl);
        loop.position.set(x, CY + 0.2, CZ); loop.rotation.z = -Math.PI * 0.32; K.scene.add(loop);
        ringPos.push(list);
        var mid = (list[0].x + list[list.length - 1].x) / 2;
        K.label(NAMES[k] + '<br><span style="opacity:.75">' + nS[k] + ' states · stay ' + fmt(selfP[k], 3) + '</span>',
          new THREE.Vector3(mid, k % 2 ? CY - 0.16 : CY + 0.36, CZ), { c: 'ph' + k, size: 10, anchor: k % 2 ? 't' : 'b' });
        if (k < 4) { conn.push(x + 0.02, CY, CZ, x + gap - 0.02, CY, CZ); x += gap; }
      });
      segs(K, conn, K.mat('line', 'muted'));
      var arrows = [];
      for (var k2 = 0; k2 < 4; k2++) {
        var lastR = ringPos[k2][ringPos[k2].length - 1], ar = cone(K, K.mat('basic', 'muted'), 0.035, 0.09);
        ar.position.set(lastR.x + gap * 0.62, CY, CZ); ar.rotation.z = -Math.PI / 2; arrows.push(ar);
      }
      var pA = ringPos[4][ringPos[4].length - 1], pB = ringPos[0][0];
      var bez = new THREE.QuadraticBezierCurve3(pA.clone(), new THREE.Vector3(0, CY + 1.1, CZ - 1.6), pB.clone());
      var back = dynLine(K, 64, K.mat('dash', 'muted', { dashSize: 0.1, gapSize: 0.07 }));
      back.set(function (u) { return bez.getPoint(u); });
      K.label('back to idle', bez.getPoint(0.5), { c: 'muted', size: 10, anchor: 'b' });
      // token
      var token = new THREE.Mesh(new THREE.SphereGeometry(0.065, 18, 12), K.mat('basic', 'accent'));
      var halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), K.mat('basic', 'accent', { transparent: true, opacity: 0.25, depthWrite: false }));
      K.scene.add(token); K.scene.add(halo);
      var tokLab = K.label('Viterbi path', function () { return token.position; }, { c: 'accent', size: 10, anchor: 't', plain: true });
      // cursor plane across the rows
      var cursor = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.34, 1.5), K.mat('basic', 'accent', { transparent: true, opacity: 0.35, depthWrite: false }));
      K.scene.add(cursor);
      var ph = F.phases, idleLen = (D - ph[5].t0) + ph[0].t1;
      function phaseLen(k) { return k === 0 ? idleLen : ph[k].t1 - ph[k].t0; }
      function tokenAt(t) {
        var k = 0, i3; for (i3 = 0; i3 < ph.length; i3++) if (t < ph[i3].t1) { k = i3; break; }
        var e = k === 5 ? t - ph[5].t0 : k === 0 ? t + (D - ph[5].t0) : t - ph[k].t0;
        k = k % 5;
        var L = phaseLen(k), TR = 0.12;
        if (k === 0) { if (e < TR) return bez.getPoint(e / TR); e -= TR; L -= TR; }
        var chainT = Math.min(nS[k] / 100, 0.8 * L), list = ringPos[k];
        if (e < chainT) {
          var u = e / chainT * (list.length - 1), a = Math.floor(u), f = u - a;
          return list[a].clone().lerp(list[Math.min(a + 1, list.length - 1)], f);
        }
        var lp = list[list.length - 1], ang = Math.PI / 2 + (e - chainT) / 0.18 * Math.PI * 2;
        return new THREE.Vector3(lp.x + Math.cos(ang) * 0.085 - 0, lp.y + 0.2 - Math.sin(ang) * 0.085 + 0.0, lp.z);
      }

      // ---- results table
      var tbl = K.hud('right:10px;top:10px;max-width:calc(100% - 20px)');
      function paintTable() {
        var P = sum.phase || {}, models = [['LR', 'LogReg (baseline)'], ['HGB', 'GBoost'], ['LR+HMM', 'LogReg + HMM'], ['HGB+HMM', 'GBoost + HMM']];
        var nar = K.narrow, ac = K.css('accent'), mu = K.css('muted'), fg = K.css('fg');
        var td = 'padding:2px 6px;text-align:right;border-top:1px solid ' + K.css('line') + ';';
        var h = '<div style="background:' + K.rgba('bg', 0.88) + ';border:1px solid ' + K.css('line') + ';border-radius:8px;padding:7px 8px;color:' + fg + ';font-size:' + (nar ? 10.5 : 11) + 'px;font-variant-numeric:tabular-nums">';
        var a = P.LR || {}, b = P.HGB || {}, c2 = P['LR+HMM'] || {}, d2 = P['HGB+HMM'] || {};
        h += '<div style="margin-bottom:4px"><span style="color:' + mu + '">edit score </span><b style="font-size:15px">' + fmt(a.edit) + ' / ' + fmt(b.edit) +
          '</b> <span style="color:' + mu + '">→</span> <b style="font-size:17px;color:' + ac + '">' + fmt(Math.min(c2.edit, d2.edit)) + '</b></div>';
        h += '<table style="border-collapse:collapse;width:100%"><tr style="color:' + mu + '"><th style="text-align:left;padding:2px 6px;font-weight:500">model</th>' +
          (nar ? '' : '<th style="' + td + 'font-weight:500;border:0">macro-F1</th>') +
          '<th style="' + td + 'font-weight:500;border:0;color:' + ac + '">edit</th><th style="' + td + 'font-weight:500;border:0">F1@50</th>' +
          (nar ? '' : '<th style="' + td + 'font-weight:500;border:0">contact P/R</th>') +
          '<th style="' + td + 'font-weight:500;border:0">' + (nar ? 'p90 ms' : 'MAE/p90 ms') + '</th></tr>';
        models.forEach(function (m) {
          var r = P[m[0]] || {}, hm2 = m[0].indexOf('HMM') > 0;
          h += '<tr><td style="' + td + 'text-align:left">' + (nar ? m[1].replace(' (baseline)', '') : m[1]) + '</td>' +
            (nar ? '' : '<td style="' + td + '">' + fmt(r.macro_f1) + ' <span style="color:' + mu + '">±' + fmt(r.macro_f1_sd_players) + '</span></td>') +
            '<td style="' + td + (hm2 ? 'color:' + ac + ';font-weight:700' : '') + '">' + fmt(r.edit) + '</td>' +
            '<td style="' + td + '">' + fmt(r.f1_50) + '</td>' +
            (nar ? '' : '<td style="' + td + '">' + fmt(r.contact_p) + ' / ' + fmt(r.contact_r) + '</td>') +
            '<td style="' + td + '">' + (nar ? fmt(r.contact_p90_ms) : fmt(r.contact_mae_ms) + ' / ' + fmt(r.contact_p90_ms)) + '</td></tr>';
        });
        h += '</table><div style="color:' + mu + ';font-size:10px;margin-top:4px">leave-one-player-out, 12 players · tiles above are illustrative</div></div>';
        tbl.innerHTML = h;
      }
      paintTable();

      var clock = 0, speed = ctx.reducedMotion ? 0.1 : 0.3, epoch = -1, lastNarrow = K.narrow;
      function update() {
        var t = (clock * speed) % D, fr = Math.min(Tf, Math.floor(t * 100) + 1);
        var ep = Math.floor(clock / (ctx.reducedMotion ? 1.2 : 0.22));
        if (ep !== epoch) { epoch = ep; paintRows(ep); }
        ROWS[2].t.reveal(fr);
        cursor.position.set(tx(t), 0.17, 0.5);
        var tp = tokenAt(t); token.position.copy(tp); halo.position.copy(tp);
        halo.scale.setScalar(1 + 0.15 * Math.sin(clock * 6));
        // contact: appears once the cursor passes it, then snaps from the decoded boundary to the jerk onset
        var after = t - (F.contactTime + 0.05);
        pillar.visible = bracket.visible = after > 0; cLab.on = after > 0;
        var u = ease(after / speed / 0.9);
        var px = decX + (onsetX - decX) * u;
        pillar.position.set(px, 0.5, 0.25); pillarTop.set(px, 1.02, 0.25);
        bracket.children.forEach(function (c) { c.material.opacity = (c.isLineSegments ? 0.9 : 0.1) * Math.min(1, after * 6); });
        cLab.set(u < 0.98 ? 'decoded F→FT boundary' : 'contact = jerk onset · ±40 ms search');
      }
      update(); K.render();
      return {
        frame: function (dt) {
          clock += dt;
          if (!ctx.reducedMotion) K.view.az = 0.1 * Math.sin(clock * 0.13);
          update(); K.render();
        },
        resize: function () { K.resize(); if (K.narrow !== lastNarrow) { lastNarrow = K.narrow; paintTable(); } K.render(); },
        setTheme: function (th) { K.setTheme(th); epoch = -1; paintTable(); update(); K.render(); },
        dispose: function () { torG.dispose(); K.dispose(); }
      };
    }
  });

  /* ================================================================ chapter 6: missing and noisy data */
  W.Chapters.push({
    id: 'gaps', order: 6,
    kicker: 'Step 6 · Missing data',
    title: 'Missing and noisy data',
    body: "<p><b>What to do when the signal drops out.</b></p><p>Small gaps we fill by joining the dots before and after. Bigger gaps we mark as “unknown”, and the swing-order rule carries us across them.</p><p>Even with <b>30% of the data missing</b>, it still scores about <b>98%</b>. The wrong way is filling gaps with zeros: the racket looks like it froze mid-swing, and the score crashes to <b>79%</b>.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, S = signals(F), sum = ctx.summary || {};
      var LANES_T = new THREE.Vector3(0.2, 1.0, 0), CHART_T = new THREE.Vector3(10.1, 1.0, 0);
      var K = kit(stage, ctx, { target: LANES_T, dist: 10.5, el: 0.3, az: 0, aspect: 1.5 });
      var X0 = -4, XW = 8, D = S.D, N = S.N, fs = S.fs, Tf = S.Tf;
      function tx(t) { return X0 + t / D * XW; }

      // ---- packet loss pattern: 4 samples (20 ms) per packet, one 300 ms burst + a few short drops
      var GAP0 = 1.05, GAP1 = 1.35, nP = Math.ceil(N / 4), lost = new Uint8Array(nP), p;
      for (p = 0; p < nP; p++) { var tp0 = p * 4 / fs; if (tp0 >= GAP0 - 1e-6 && tp0 < GAP1 - 1e-6) lost[p] = 1; }
      [16, 35, 36, 81, 101].forEach(function (q) { if (q < nP) lost[q] = 1; });
      var have = new Uint8Array(N), gapLen = new Int32Array(N), i;
      for (i = 0; i < N; i++) have[i] = lost[i >> 2] ? 0 : 1;
      for (i = 0; i < N;) { if (!have[i]) { var j2 = i; while (j2 < N && !have[j2]) j2++; for (var q2 = i; q2 < j2; q2++) gapLen[q2] = j2 - i; i = j2; } else i++; }
      // lane A: zero-fill; lane B: interpolate <= 10 samples (50 ms), mask longer (NaN)
      var yA = new Float32Array(N), yB = new Float32Array(N), yBr = new Float32Array(N);
      for (i = 0; i < N; i++) {
        yA[i] = have[i] ? S.yaw[i] : 0;
        if (have[i]) { yB[i] = yBr[i] = S.yaw[i]; continue; }
        var a = i; while (a > 0 && !have[a]) a--; var b = i; while (b < N - 1 && !have[b]) b++;
        var lin = S.yaw[a] + (S.yaw[b] - S.yaw[a]) * (i - a) / Math.max(1, b - a);
        yBr[i] = lin; yB[i] = gapLen[i] <= 10 ? lin : NaN;
      }
      var my = absMax(S.yaw);
      // decoded phases per 10 ms frame
      var fA = new Int8Array(Tf), fB = new Int8Array(Tf), g0 = Math.round(GAP0 * 100), g1 = Math.round(GAP1 * 100), fj;
      for (fj = 0; fj < Tf; fj++) { fA[fj] = fB[fj] = S.fph[fj]; }
      for (fj = g0; fj < g1; fj++) fA[fj] = 0;                           // zeros look like a stopped racket: idle
      for (fj = g1; fj < Math.min(Tf, g1 + 14); fj++) fA[fj] = 1;       // phantom restart: backswing...
      for (fj = g1 + 14; fj < Math.min(Tf, g1 + 22); fj++) fA[fj] = 2;  // ...and a phantom forward swing

      var LANES = [
        { key: 'A', base: 1.75, y: yA, f: fA, title: '<b>A · zero-fill</b>', c: 'ph2' },
        { key: 'B', base: 0.0, y: yB, f: fB, title: '<b>B · interpolate ≤50 ms + mask + flat emission</b>', c: 'ph4' }
      ];
      var pktG = new THREE.BoxGeometry(XW / nP * 0.7, 0.07, 0.12), m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
      LANES.forEach(function (L) {
        var B0 = L.base;
        court(K, 0, B0 - 0.02, 0.05, 8.7, 1.45);
        // packets
        L.pk = new THREE.InstancedMesh(pktG, K.mat('lambert', 'body'), nP); K.scene.add(L.pk);
        L.pkX = []; for (p = 0; p < nP; p++) L.pkX.push(X0 + (p + 0.5) * XW / nP);
        // decoded phase strip
        L.t = tiles(K, Tf, function (k) { return [X0 + (k + 0.5) * XW / Tf, B0 + 0.03, 0.22]; }, [XW / Tf * 0.88, 0.05, 0.22]);
        // signal ribbon (zero line at B0 + 0.62)
        var zl = B0 + 0.62, xs = [], ys = [];
        for (i = 0; i < N; i++) { xs.push(tx(i / fs)); ys.push(isFinite(L.y[i]) ? zl + 0.5 * L.y[i] / my : NaN); }
        L.rib = ribbon(K, xs, ys, -0.2, 0.07, zl, K.mat('lambert', 'accent', { side: THREE.DoubleSide }), K.mat('basic', 'accent', { transparent: true, opacity: 0.17, side: THREE.DoubleSide, depthWrite: false }));
        segs(K, [X0, zl, -0.2, X0 + XW, zl, -0.2], K.mat('line', 'fg', { transparent: true, opacity: 0.3 }));
        K.label(L.title, new THREE.Vector3(X0 + 0.02, B0 + 1.2, -0.2), { c: L.c, size: 11, anchor: 'l' });
        L.zl = zl;
        // racket glyph at the lane end, turning with the integrated (reconstructed) yaw rate
        L.rk = makeRacket(K, 0.6); L.rk.position.set(X0 + XW + 0.45, zl, -0.2);
      });
      K.label('packets · 20 ms each', new THREE.Vector3(X0 - 0.05, LANES[1].base - 0.1, 0.55), { c: 'muted', size: 10, anchor: 'r' });
      K.label('decoded phase', new THREE.Vector3(X0 - 0.05, LANES[1].base + 0.16, 0.22), { c: 'muted', size: 10, anchor: 'r' });
      K.label('yaw rate', new THREE.Vector3(X0 - 0.05, LANES[1].zl, -0.2), { c: 'accent', size: 10, anchor: 'r' });
      var gx0 = tx(GAP0), gx1 = tx(GAP1), gw = gx1 - gx0;
      // lane A gap: zeros
      var zA = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.05, 0.5), K.mat('basic', 'ph2', { transparent: true, opacity: 0.55 }));
      zA.position.set((gx0 + gx1) / 2, LANES[0].zl, -0.2); K.scene.add(zA);
      var lStop = K.label('300 ms burst → zeros: the racket "stops"', new THREE.Vector3((gx0 + gx1) / 2, LANES[0].zl + 0.62, -0.2), { c: 'ph2', size: 10.5 });
      var lConf = K.label('HMM confused: phantom restart', new THREE.Vector3(tx(GAP1 + 0.12), LANES[0].base + 0.06, 0.4), { c: 'ph2', size: 10, anchor: 't' });
      // lane B gap: masked box + dashed bridge
      var mB = boxWire(K, K.mat('basic', 'muted', { transparent: true, opacity: 0.16, depthWrite: false }), K.mat('dash', 'muted', { dashSize: 0.06, gapSize: 0.05 }));
      mB.scale.set(gw, 1.0, 0.9); mB.position.set((gx0 + gx1) / 2, LANES[1].base + 0.55, 0.0);
      mB.children.forEach(function (c) { if (c.isLineSegments) c.computeLineDistances(); });
      var ia = Math.round(GAP0 * fs) - 1, ib = Math.round(GAP1 * fs);
      var bridge = dynLine(K, 2, K.mat('dash', 'fg', { dashSize: 0.06, gapSize: 0.05 }));
      bridge.set(function (u) { var k = u < 0.5 ? ia : ib; return new THREE.Vector3(tx(k / fs), LANES[1].zl + 0.5 * S.yaw[Math.min(N - 1, k)] / my, -0.2); });
      var lMask = K.label('masked · flat emission', new THREE.Vector3((gx0 + gx1) / 2, LANES[1].base + 1.08, 0), { c: 'muted', size: 10.5 });
      var lBridge = K.label('grammar bridges the gap', new THREE.Vector3(tx(GAP1 + 0.12), LANES[1].base + 0.06, 0.4), { c: 'ph4', size: 10, anchor: 't' });
      var cursor = new THREE.Mesh(new THREE.BoxGeometry(0.014, 3.1, 0.02), K.mat('basic', 'accent', { transparent: true, opacity: 0.7 }));
      K.scene.add(cursor);
      // integrated yaw for the glyphs
      var angA = new Float32Array(N), angB = new Float32Array(N);
      for (i = 1; i < N; i++) { angA[i] = angA[i - 1] + yA[i] / fs; angB[i] = angB[i - 1] + yBr[i] / fs; }

      // ---- robustness bar chart, read from summary.robustness {"<rate>_<interp|zero>": {HGB, HGB+HMM}}
      var rob = sum.robustness || {}, rates = {}, VAR = [
        { mode: 'zero', model: 'HGB', name: 'GBoost · zero-fill', c: 'ph2' },
        { mode: 'zero', model: 'HGB+HMM', name: 'GBoost+HMM · zero-fill', c: 'accent' },
        { mode: 'interp', model: 'HGB+HMM', name: 'GBoost+HMM · interp+mask', c: 'ph4' },
        { mode: 'interp', model: 'HGB', name: 'GBoost · interp+mask', c: 'ph1' }
      ];
      Object.keys(rob).forEach(function (key) {
        var cut = key.lastIndexOf('_'), r = parseFloat(key.slice(0, cut)), mode = key.slice(cut + 1);
        if (!isFinite(r)) return; (rates[r] = rates[r] || {})[mode] = rob[key];
      });
      var rList = Object.keys(rates).map(Number).sort(function (a, b) { return a - b; });
      var wanted = rList.filter(function (r) { return [0, 0.1, 0.2, 0.3].some(function (w) { return Math.abs(w - r) < 1e-9; }); });
      if (wanted.length >= 2) rList = wanted;
      var BASE = 60, HS = 2.3 / 40, cx0 = CHART_T.x - (rList.length - 1) * 1.3 / 2, bars = [];
      court(K, CHART_T.x, 0, 0.1, Math.max(4, rList.length * 1.3 + 1.2), 2.9);
      var wall = [], wx0 = cx0 - 0.7, wx1 = cx0 + (rList.length - 1) * 1.3 + 0.7, wz = -1.05;
      for (var gv = BASE; gv <= 100; gv += 10) {
        var gy = (gv - BASE) * HS; wall.push(wx0, gy, wz, wx1, gy, wz, wx0, gy, wz, wx0, gy, 1.2);
        K.label(gv + (gv === 100 ? ' macro-F1' : gv === BASE ? ' · axis start' : ''), new THREE.Vector3(wx0 - 0.05, gy, wz), { c: 'muted', size: 10, anchor: 'r', plain: true });
      }
      segs(K, wall, K.mat('line', 'muted', { transparent: true, opacity: 0.45 }));
      var barG = new THREE.BoxGeometry(0.26, 1, 0.26);
      rList.forEach(function (r, gi) {
        var x = cx0 + gi * 1.3;
        K.label(Math.round(r * 100) + '% loss', new THREE.Vector3(x, 0, 1.4), { c: 'fg', size: 10.5, anchor: 't' });
        VAR.forEach(function (v, vi) {
          var val = (rates[r][v.mode] || {})[v.model];
          if (!isFinite(val)) return;
          var m = new THREE.Mesh(barG, K.mat('lambert', v.c)); K.scene.add(m);
          var z = 0.75 - vi * 0.5, bar = { m: m, x: x, z: z, val: val };
          m.position.set(x, 0, z);
          if (Math.abs(r - rList[rList.length - 1]) < 1e-9 || (gi === 0 && false)) {
            bar.lab = K.label('<b>' + fmt(val) + '</b>', function () { return new THREE.Vector3(x, Math.max(0.02, m.scale.y) + 0.02, z); }, { c: v.c, size: 10.5, anchor: 'b' });
          }
          bars.push(bar);
        });
      });
      // ---- HUD (headline + legend; switches with the camera focus)
      var hudBox = K.hud('left:10px;top:10px;max-width:min(320px,60%)');
      var r30 = rates[rList[rList.length - 1]] || {}, ri = r30.interp || {}, rz = r30.zero || {};
      function paintHud(focus) {
        var mu = K.css('muted'), panel = 'background:' + K.rgba('bg', 0.88) + ';border:1px solid ' + K.css('line') + ';border-radius:8px;padding:7px 9px;color:' + K.css('fg') + ';font-size:11px;line-height:1.45';
        var h = '<div style="' + panel + '">';
        if (focus === 'lanes') {
          h += '<b>Same 300 ms burst, two pre-processing choices</b><div style="color:' + mu + '">A fills the gap with zeros. B interpolates short gaps (≤50 ms), masks the burst and gives masked frames a flat HMM emission.</div>';
        } else {
          h += '<b>Macro-F1 vs packet loss</b> <span style="color:' + mu + '">(held-out players)</span>' +
            '<div style="margin-top:3px">at ' + Math.round(rList[rList.length - 1] * 100) + '%: mask <b style="color:' + K.css('ph1') + '">' + fmt(ri.HGB) + '</b> vs zero-fill <b style="color:' + K.css('ph2') + '">' + fmt(rz.HGB) +
            '</b>, HMM → <b style="color:' + K.css('accent') + '">' + fmt(rz['HGB+HMM']) + '</b></div><div style="display:flex;flex-wrap:wrap;gap:2px 10px;margin-top:4px">';
          VAR.slice().reverse().forEach(function (v) {
            h += '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px;background:' + K.css(v.c) + '"></i>' + v.name + '</span>';
          });
          h += '</div>';
        }
        hudBox.innerHTML = h + '</div>';
      }
      var laneLabels = [lStop, lConf, lMask, lBridge];
      var focus = '', clock = 0, P1 = 9, P = 18, speed = ctx.reducedMotion ? 0.35 : 1;
      var tgt = new THREE.Vector3();
      function update(dt) {
        var tl = (clock * speed) % P, inLanes = tl < P1;
        if (ctx.reducedMotion) inLanes = (clock % 24) < 12;
        var nf = inLanes ? 'lanes' : 'chart';
        if (nf !== focus) { focus = nf; paintHud(focus); }
        // camera glides between the two set pieces
        var want = inLanes ? LANES_T : CHART_T;
        var k = ctx.reducedMotion ? 1 : 1 - Math.exp(-dt * 2.2);
        if (dt === 0 && !K._init) { k = 1; K._init = true; }
        tgt.copy(K.view.target).lerp(want, k); K.view.target.copy(tgt);
        K.view.dist += ((inLanes ? 11.3 : 8.6) - K.view.dist) * k;
        K.view.el += ((inLanes ? 0.3 : 0.5) - K.view.el) * k;
        K.view.az += ((inLanes ? 0.0 : -0.2) - K.view.az) * k;
        // lanes: sweep the stroke
        var st = inLanes ? clamp((tl - 0.4) / 7.6, 0, 1) * D : D - 1e-3;
        if (ctx.reducedMotion) st = ((clock * 0.12) % 1) * D;
        var si = Math.min(N - 1, Math.floor(st * fs)), fr = Math.min(Tf, Math.floor(st * 100) + 1);
        cursor.position.set(tx(st), 1.45, 0.05);
        LANES.forEach(function (L, li) {
          L.rib.reveal(si);
          for (p = 0; p < nP; p++) {
            var tpk = p * 4 / fs;
            if (lost[p] || tpk > st) L.pk.setMatrixAt(p, zero);
            else { var pop = 1 + 0.8 * Math.max(0, 1 - (st - tpk) / 0.06); m4.makeScale(pop, pop, pop); m4.setPosition(L.pkX[p], L.base + 0.04, 0.55); L.pk.setMatrixAt(p, m4); }
          }
          L.pk.instanceMatrix.needsUpdate = true;
          L.t.reveal(fr);
          var ang = (li === 0 ? angA : angB)[si];
          L.rk.rotation.set(0, ang * D2R, 0.35);
        });
        var passed = st > GAP0;
        zA.visible = passed; mB.visible = passed; bridge.obj.visible = st > GAP1;
        laneLabels.forEach(function (lb, idx) { lb.on = inLanes && (idx % 2 === 0 ? passed : st > GAP1 + 0.05); });
        // bars grow when the chart is in focus
        var gt = inLanes ? 0 : ease((tl - P1 - 0.6) / 1.6);
        if (ctx.reducedMotion) gt = 1;
        bars.forEach(function (b, bi) {
          var hgt = Math.max(0.001, (b.val - BASE) * HS * ease(gt * 1.25 - bi * 0.012));
          b.m.scale.y = hgt; b.m.position.y = hgt / 2;
          if (b.lab) b.lab.on = !inLanes && gt > 0.6;
        });
      }
      function paintTiles() {
        LANES.forEach(function (L, li) {
          for (var k = 0; k < Tf; k++) {
            var c = K.phC[L.f[k]].clone();
            if (li === 1 && k >= g0 && k < g1) c.lerp(K.color('bg'), 0.45); // bridged under the mask
            L.t.set(k, c);
          }
          L.t.commit();
        });
      }
      paintTiles(); update(0); K.render();
      return {
        frame: function (dt) { clock += dt; update(dt); K.render(); },
        resize: function () { K.resize(); K.render(); },
        setTheme: function (th) { K.setTheme(th); paintTiles(); focus = ''; update(0); K.render(); },
        dispose: function () { pktG.dispose(); barG.dispose(); LANES.forEach(function (L) { L.pk.dispose && L.pk.dispose(); }); K.dispose(); }
      };
    }
  });
})();
