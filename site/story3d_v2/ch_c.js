/* ch_c.js (v2, simplified): chapters 7-10 (validation, rotation, nonident, roadmap).
   Classic script. One idea per scene, one small caption, few plain labels, calm motion.
   Numbers: results/summary.json via ctx.summary, with the published values as fallbacks. */
(function () {
  'use strict';

  var FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var D2R = Math.PI / 180, TAU = Math.PI * 2;
  var SWING = 0.6;                       // swing playback speed (calm)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function pal(th) {
    th = th || {}; var ph = th.phaseColors || [];
    return { bg: th.bg || '#0f1b17', fg: th.fg || '#e2ebe6', muted: th.muted || '#8ea198', ground: th.ground || '#1f4c3e',
      body: th.body || '#bfc8cc', racket: th.racket || '#0a0f12', accent: th.accent || '#e6c53a',
      line: th.line || '#22342d', second: ph[1] || '#4f9ad6' };
  }
  function rgba(c, a) {
    c = String(c || '').trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c), p = [128, 128, 128];
    if (m) {
      var h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      p = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    } else if ((m = /rgba?\(([^)]+)\)/i.exec(c))) { p = m[1].split(',').map(parseFloat); }
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  }
  function el(parent, css, html) {
    var d = document.createElement('div');
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }

  /* ------------------------------------------------------------------ one renderer + scene + overlay per chapter */
  function base(stage, ctx, view) {
    var THREE = ctx.THREE, P = pal(ctx.theme);
    var root = el(stage, 'position:absolute;inset:0;overflow:hidden;');
    var canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:100%;height:100%;'; root.appendChild(canvas);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    var scene = new THREE.Scene(); scene.background = new THREE.Color(P.bg);
    var camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
    var hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(P.ground), 0.9); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.position.set(3, 7, 4); scene.add(sun);
    var groundMat = new THREE.MeshStandardMaterial({ color: P.ground, roughness: 0.95 });
    var ground = new THREE.Mesh(new THREE.CircleGeometry(9, 48), groundMat); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    var overlay = el(root, 'position:absolute;inset:0;pointer-events:none;font:' + FONT + ';color:' + P.fg + ';');
    var caption = el(overlay, '');
    var W = 640, H = 400, tmp = new THREE.Vector3(), labels = [];
    var target = new THREE.Vector3(view.target[0], view.target[1], view.target[2]);
    var dir = new THREE.Vector3(view.dir[0], view.dir[1], view.dir[2]).normalize();

    function styleCaption() {
      caption.style.cssText = 'position:absolute;left:10px;top:10px;max-width:min(300px,calc(100% - 20px));padding:8px 11px;' +
        'border-radius:8px;line-height:1.45;font:' + FONT + ';color:' + P.fg + ';background:' + rgba(P.bg, 0.88) + ';border:1px solid ' + P.line + ';';
    }
    styleCaption();
    var B = {
      THREE: THREE, scene: scene, P: P, caption: caption, camera: camera, root: root, target: target,
      onResize: null,
      label: function (color) {
        var d = el(overlay, '');
        d.__c = color; d.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;padding:2px 7px;border-radius:6px;' +
          'font:' + FONT + ';font-weight:600;color:' + (color ? P[color] : P.fg) + ';background:' + rgba(P.bg, 0.78) + ';';
        labels.push(d); return d;
      },
      place: function (node, v, opacity) {   // v: three.js position; keeps labels on screen and above the transport bar
        tmp.copy(v).project(camera);
        var x = clamp((tmp.x + 1) / 2 * W, 50, W - 50), y = clamp((1 - tmp.y) / 2 * H, 40, H - 64);
        node.style.left = x.toFixed(0) + 'px'; node.style.top = y.toFixed(0) + 'px';
        node.style.opacity = opacity == null ? 1 : opacity.toFixed(2);
        node.style.display = tmp.z < 1 && (opacity == null || opacity > 0.02) ? '' : 'none';
      },
      resize: function () {
        W = root.clientWidth || stage.clientWidth || 640; H = root.clientHeight || stage.clientHeight || 400;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, H, false);
        var asp = W / Math.max(1, H); camera.aspect = asp; camera.updateProjectionMatrix();
        // steady camera: fixed direction, distance just far enough to fit the scene's half-width
        var tv = Math.tan(camera.fov * D2R / 2), d = Math.max(view.dist, view.half / (tv * Math.min(asp, 1.6)) * 1.08);
        camera.position.copy(target).addScaledVector(dir, d); camera.lookAt(target);
        if (B.onResize) B.onResize(W, H);
      },
      retheme: function (th) {
        P = B.P = pal(th);
        scene.background = new THREE.Color(P.bg); hemi.groundColor.set(P.ground); groundMat.color.set(P.ground);
        overlay.style.color = P.fg; styleCaption();
        labels.forEach(function (d) { d.style.color = d.__c ? P[d.__c] : P.fg; d.style.background = rgba(P.bg, 0.78); });
      },
      render: function () { renderer.render(scene, camera); },
      dispose: function () {
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); });
        });
        renderer.dispose();
        if (renderer.forceContextLoss) renderer.forceContextLoss();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    B.resize();
    return B;
  }
  function mat(THREE, c, extra) {
    var o = { color: c, roughness: 0.65, metalness: 0.05, flatShading: true };
    for (var k in extra) o[k] = extra[k];
    return new THREE.MeshStandardMaterial(o);
  }

  /* ------------------------------------------------------------------ a simple swinging figure driven by Forehand3D.sample */
  // world frame (z up, x to net, y left) -> three.js (y up)
  function V(THREE, w, off) { return new THREE.Vector3(w[0], w[2], -(w[1] + (off || 0))); }
  function mm(A, Bm) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = A[i][0] * Bm[0][j] + A[i][1] * Bm[1][j] + A[i][2] * Bm[2][j];
    return C;
  }
  function Rz(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }
  function Rx(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  var RB = [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
  // same chain as scene.js (shoulder, straight arm, racket frame); returns world points
  function poseOf(F, t, share) {
    var s = F.sample(t, share), th = s.trunk * D2R, phi = (s.trunk + s.shoulder) * D2R, ea = s.armElev * D2R;
    var S = [0.2 * Math.sin(th), -0.2 * Math.cos(th), 1.45];
    var H = [S[0] + 0.62 * Math.cos(ea) * Math.sin(phi), S[1] - 0.62 * Math.cos(ea) * Math.cos(phi), S[2] + 0.62 * Math.sin(ea)];
    var R = mm(mm(mm(Rz(s.alpha * D2R), Rx(-s.rkElev * D2R)), RB), Rx((s.roll + 5) * D2R));
    var xr = [R[0][0], R[1][0], R[2][0]], yr = [R[0][1], R[1][1], R[2][1]], zr = [R[0][2], R[1][2], R[2][2]];
    function along(k) { return [H[0] + k * xr[0], H[1] + k * xr[1], H[2] + k * xr[2]]; }
    return { s: s, th: th, S: S, L: [-S[0], -S[1], 1.45], H: H, butt: along(-0.12), throat: along(0.24), head: along(0.45), xr: xr, yr: yr, zr: zr };
  }
  function makeFigure(B, off, chestColor) {
    var THREE = B.THREE, P = B.P, g = new THREE.Group(); B.scene.add(g);
    var CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), SPH = new THREE.SphereGeometry(1, 12, 9), UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
    var bodyM = mat(THREE, P.body), legM = mat(THREE, P.body), rkM = mat(THREE, P.racket);
    legM.color.multiplyScalar(0.75);
    var chestM = mat(THREE, chestColor ? P[chestColor] : P.body);
    function cap(m, r) {
      var c = { a: new THREE.Mesh(CYL, m), s0: new THREE.Mesh(SPH, m), s1: new THREE.Mesh(SPH, m) };
      g.add(c.a); g.add(c.s0); g.add(c.s1);
      c.set = function (p, q) {
        tmp.subVectors(q, p); var len = tmp.length() || 1e-4;
        c.a.position.addVectors(p, q).multiplyScalar(0.5); c.a.scale.set(r, len, r);
        c.a.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
        c.s0.position.copy(p); c.s0.scale.setScalar(r); c.s1.position.copy(q); c.s1.scale.setScalar(r);
      };
      return c;
    }
    function W(w) { return V(THREE, w, off); }
    // static legs and pelvis
    cap(legM, 0.06).set(W([0, -0.11, 0.9]), W([-0.05, -0.42, 0.06]));
    cap(legM, 0.06).set(W([0, 0.11, 0.9]), W([0.12, 0.38, 0.06]));
    var pelvis = new THREE.Mesh(SPH, legM); pelvis.scale.set(0.11, 0.09, 0.17); pelvis.position.copy(W([0, 0, 0.92])); g.add(pelvis);
    // torso (the chest: carries the turn) and head
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 1, 12), chestM);
    torso.scale.set(0.12, 0.5, 0.19); torso.position.copy(W([0, 0, 1.18])); g.add(torso);
    var head = new THREE.Mesh(SPH, bodyM); head.scale.setScalar(0.1); head.position.copy(W([0, 0, 1.63])); g.add(head);
    var shoulders = cap(chestM, 0.055), rArm = cap(bodyM, 0.04), lArm = cap(bodyM, 0.038), handle = cap(rkM, 0.017);
    var ringGeo = new THREE.TorusGeometry(1, 0.07, 6, 32);
    var ring = new THREE.Mesh(ringGeo, rkM); g.add(ring);
    var M4 = new THREE.Matrix4();
    return {
      chestMat: chestM,
      update: function (t, share) {
        var p = poseOf(B.F, t, share), th = p.th;
        torso.rotation.y = th;
        shoulders.set(W(p.S), W(p.L));
        rArm.set(W(p.S), W(p.H));
        lArm.set(W(p.L), W([p.L[0] + 0.3 * Math.cos(th), p.L[1] + 0.3 * Math.sin(th) - 0.1, 1.2]));
        handle.set(W(p.butt), W(p.throat));
        M4.makeBasis(V(THREE, p.xr), V(THREE, p.yr), V(THREE, p.zr));
        ring.quaternion.setFromRotationMatrix(M4); ring.position.copy(W(p.head)); ring.scale.set(0.165, 0.125, 0.165);
        return p;
      },
      retheme: function (P2, chestCol) {
        bodyM.color.set(P2.body); legM.color.set(P2.body).multiplyScalar(0.75); rkM.color.set(P2.racket);
        chestM.color.set(chestCol || P2.body);
      }
    };
  }

  /* ------------------------------------------------------------------ sample run: real inputs -> real outputs, one held-out swing */
  var PH_NAMES = ['idle', 'backswing', 'forward swing', 'follow-through', 'recovery'];
  var UNITS = { gyr_mag: ' °/s', yaw_rate: ' °/s', elev: '°', face_tilt: '°', acc_mag: ' g', jerk_m5: '' };
  var PANEL_FONT = '12px/1.45 system-ui,-apple-system,sans-serif';
  function samplePanel(B, ctx) {
    // one real swing per held-out player (window.SAMPLES), else the single player-0 swing (window.SAMPLE)
    var META = window.SAMPLES || window.SAMPLE;
    if (!META) return null;
    var ALL = (window.SAMPLES && window.SAMPLES.swings) || [window.SAMPLE];
    var S = ALL[0], n = S.frames, cols = META.cols, theme = ctx.theme || {}, who = 0;
    var maxN = 0; ALL.forEach(function (w) { maxN = Math.max(maxN, w.frames); });
    var box = el(B.root, ''), rows = {}, peak = {};
    function measure() {
      cols.forEach(function (c) {
        var v = S.x[c.key], m = 1e-6;
        for (var i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]));
        peak[c.key] = m;
      });
    }
    measure();
    function phc(i) { return (theme.phaseColors && theme.phaseColors[i]) || ['#7d8d87', '#4f9ad6', '#ee6a45', '#e6c53a', '#62c48d'][i]; }
    function chip(i) {
      return '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:9px;height:9px;border-radius:2px;background:' +
        phc(i) + '"></span>' + PH_NAMES[i] + '</span>';
    }
    function fmt(key, v) {
      if (key === 'jerk_m5') return v.toFixed(2);
      if (key === 'acc_mag') return v.toFixed(1) + UNITS[key];
      return Math.round(v).toLocaleString('en-US') + UNITS[key];
    }
    var compact = false;
    function build() {
      var P = B.P;
      box.style.cssText = 'position:absolute;box-sizing:border-box;padding:9px 12px;border-radius:8px;overflow:hidden;pointer-events:none;' +
        'font:' + PANEL_FONT + ';color:' + P.fg + ';background:' + rgba(P.bg, 0.92) + ';border:1px solid ' + P.line + ';';
      var h = '<div style="font-weight:700">Sample run: test player ' + ((S.player != null ? S.player : who) + 1) + ', ' + (META.placeholder ? 'illustrative swing' : 'one real swing') + '</div>' +
        '<div style="color:' + P.muted + ';margin-bottom:6px">Never seen in training. Played at half speed.</div>' +
        '<div style="display:flex;justify-content:space-between;color:' + P.muted + ';margin-bottom:2px"><span>INPUT, every 10 ms</span><span>' +
        META.n_features + ' numbers, 6 shown</span></div>' +
        '<div style="display:grid;grid-template-columns:' + (compact ? '1fr 1fr' : '1fr') + ';column-gap:14px">';
      cols.forEach(function (c) {
        h += '<div style="display:grid;grid-template-columns:112px 1fr 64px;align-items:center;gap:6px;height:19px">' +
          '<span style="white-space:nowrap">' + c.name + '</span>' +
          '<span style="height:6px;border-radius:3px;background:' + P.line + ';position:relative;overflow:hidden">' +
          '<span data-bar="' + c.key + '" style="position:absolute;left:0;top:0;bottom:0;width:0;background:' + P.muted + '"></span></span>' +
          '<span data-val="' + c.key + '" style="text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap"></span></div>';
      });
      h += '</div><div data-miss style="height:16px;color:' + P.accent + '"></div>' +
        '<div style="color:' + P.muted + ';margin:2px 0 3px">OUTPUT, every 10 ms</div>' +
        '<div style="display:grid;grid-template-columns:150px 1fr;row-gap:2px">' +
        '<span>Gradient boosting guess</span><span data-out="hgb"></span>' +
        '<span style="color:' + P.accent + ';font-weight:600">Final, with HMM</span><span data-out="hgb_hmm" style="font-weight:600"></span>' +
        '<span style="color:' + P.muted + '">True phase</span><span data-out="y" style="color:' + P.muted + '"></span></div>' +
        '<div style="position:relative;margin-top:8px"><canvas data-tl style="display:block;width:100%;height:38px"></canvas>' +
        '<div data-ph style="position:absolute;top:-2px;bottom:-2px;width:2px;left:0;background:' + P.fg + '"></div></div>' +
        '<div style="display:flex;justify-content:space-between;color:' + P.muted + ';font-size:11px;margin-top:2px">' +
        '<span>rows: guess, final, true</span><span data-t></span></div>';
      box.innerHTML = h;
      cols.forEach(function (c) {
        rows[c.key] = { bar: box.querySelector('[data-bar="' + c.key + '"]'), val: box.querySelector('[data-val="' + c.key + '"]') };
      });
      box.__out = { hgb: box.querySelector('[data-out="hgb"]'), hgb_hmm: box.querySelector('[data-out="hgb_hmm"]'), y: box.querySelector('[data-out="y"]') };
      box.__miss = box.querySelector('[data-miss]'); box.__ph = box.querySelector('[data-ph]');
      box.__t = box.querySelector('[data-t]'); box.__tl = box.querySelector('[data-tl]');
    }
    function drawTimeline() {
      var cv = box.__tl, w = cv.clientWidth || 280, hh = 38, dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
      var g = cv.getContext && cv.getContext('2d'); if (!g) return;
      g.scale(dpr, dpr);
      [S.hgb, S.hgb_hmm, S.y].forEach(function (lab, r) {
        for (var i = 0; i < n; i++) { g.fillStyle = phc(lab[i]); g.fillRect(i / n * w, r * 13, w / n + 0.6, 10); }
      });
    }
    var last = -1, cur = 0;
    function show(i) {
      i = Math.min(n - 1, Math.max(0, i));
      cur = i;
      if (i === last) return;
      last = i;
      cols.forEach(function (c) {
        var v = S.x[c.key][i];
        rows[c.key].bar.style.width = (clamp(Math.abs(v) / peak[c.key], 0, 1) * 100).toFixed(1) + '%';
        rows[c.key].val.textContent = fmt(c.key, v);
      });
      box.__out.hgb.innerHTML = chip(S.hgb[i]);
      box.__out.hgb_hmm.innerHTML = chip(S.hgb_hmm[i]);
      box.__out.y.innerHTML = chip(S.y[i]);
      box.__miss.textContent = S.missing[i] ? 'Signal missing here: marked unknown' : '';
      box.__ph.style.left = 'calc(' + (i / (n - 1) * 100).toFixed(2) + '% - 1px)';
      box.__t.textContent = 't = ' + (i / META.fps).toFixed(2) + ' s';
    }
    var api = {
      width: 340,
      n: maxN,
      show: show,
      // switch to test player k's own swing (k = index in the ring)
      use: function (k) {
        var next = ALL[((k % ALL.length) + ALL.length) % ALL.length];
        if (next === S) return;
        S = next; n = S.frames; who = k; measure();
        if (box.__w) { var r = api.layout(box.__w, box.__h); }
      },
      layout: function (W, H) {
        box.__w = W; box.__h = H;
        compact = W < 900;
        build();
        if (compact) box.style.cssText += 'left:10px;right:10px;bottom:64px;';
        else box.style.cssText += 'right:10px;top:10px;width:' + api.width + 'px;max-height:calc(100% - 74px);';
        drawTimeline(); last = -1; show(cur);
        return compact ? { right: 0, bottom: box.offsetHeight + 64 } : { right: api.width + 20, bottom: 0 };
      },
      retheme: function (th) { theme = th || theme; last = -1; }
    };
    return api;
  }


  /* ================================================================== 7. Player-held-out validation */
  var CH7 = {
    id: 'validation', order: 7,
    kicker: 'Step 7 · Validation',
    title: 'Hold out a whole player, twelve times',
    body: "<p><b>Test on a stranger, not someone you have already seen.</b></p><p>We teach the system on 11 players and test it on the 12th, a player it has never seen. Then we repeat that 12 times, so every player gets a turn as the stranger.</p><p>Scores stay between <b>97.6% and 99.3%</b> across players, so it works on new people, not just ones it memorised.</p>",
    mount: function (stage, ctx) {
      var B = base(stage, ctx, { target: [0, 0.3, 0.2], dir: [0, 0.62, 1], dist: 7.4, half: 2.9 });
      var THREE = B.THREE, P = B.P, N = 12, R = 2.2;
      var clock = 0;
      var bodyGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.6, 14), headGeo = new THREE.SphereGeometry(0.14, 14, 10);
      var neutral = new THREE.Color(P.body), acc = new THREE.Color(P.accent);
      var players = [];
      for (var i = 0; i < N; i++) {
        var a = i / N * TAU, m = mat(THREE, P.body), g = new THREE.Group();
        var b = new THREE.Mesh(bodyGeo, m); b.position.y = 0.3; g.add(b);
        var h = new THREE.Mesh(headGeo, m); h.position.y = 0.76; g.add(h);
        B.scene.add(g); players.push({ a: a, g: g, m: m });
      }
      var testLb = B.label('accent'); testLb.textContent = 'Test player';
      var trainLb = B.label(); trainLb.textContent = '11 training players';
      B.caption.innerHTML = 'Learn from 11 players, test on the 12th.<br>Repeat 12 times, one stranger each time.<br>Score on strangers: <b>97.6% to 99.3%</b>';

      // live sample run; shift the 3D ring away from the panel (left of it on wide stages, above it on narrow ones)
      var SP = samplePanel(B, ctx), SRATE = ctx.reducedMotion ? 0.2 : 0.5;
      B.onResize = function (W, H) {
        if (!SP) return;
        var r = SP.layout(W, H);
        if (r.bottom) {   // panel under the ring: back the camera off so the ring fits in the space left above it
          var k = H / Math.max(120, H - r.bottom) * 1.05;
          B.camera.position.sub(B.target).multiplyScalar(k).add(B.target); B.camera.lookAt(B.target);
        }
        B.camera.setViewOffset(W, H, r.right / 2, r.bottom / 2, W, H);
        B.camera.updateProjectionMatrix();
      };
      B.resize();

      // one shared clock: each round = test player walks in, the sample swing plays while they stand
      // in the centre, then they walk back. So one test player = exactly one sample run.
      var WALK = 0.7, PLAY = SP ? SP.n / 100 / SRATE : 1.3, ROUND_T = WALK + PLAY + WALK;
      function update(dt) {
        clock = (clock + dt) % (N * ROUND_T);
        var k = Math.floor(clock / ROUND_T), v = clock - k * ROUND_T;
        var w = smooth(v / WALK) * (1 - smooth((v - WALK - PLAY) / WALK));   // 0 in the ring .. 1 in the centre
        players.forEach(function (p, i) {
          var u = i === k ? w : 0, r = R * (1 - u);
          p.g.position.set(r * Math.sin(p.a), 0, r * Math.cos(p.a));
          p.m.color.copy(neutral).lerp(acc, u);
        });
        B.place(testLb, new THREE.Vector3(0, 1.15, 0), w);
        B.place(trainLb, new THREE.Vector3(0, -0.15, R + 0.45));
        if (SP) { SP.use(k); SP.show(Math.max(0, Math.floor((v - WALK) * SRATE * 100))); }
        B.render();
      }
      update(0);
      return {
        frame: update,
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) { B.retheme(th); P = B.P; neutral.set(P.body); acc.set(P.accent); if (SP) SP.retheme(th); B.resize(); update(0); },
        dispose: function () { B.onResize = null; B.dispose(); }
      };
    }
  };

  /* ------------------------------------------------------------------ rotation panel: real inputs -> real chest-turn outputs, one held-out swing */
  var ROT_SHOWN = ['psi', 'psi_min', 'psi_max', 'tau', 'elev', 'face_tilt', 'gyr_mag', 'lin_mag', 'radius'];
  var ROT_FB = {
    psi: ['racket turn since start', '°'], psi_min: ['most coiled so far', '°'], psi_max: ['furthest forward so far', '°'],
    tau: ['time since start', 's'], elev: ['tip up / down', '°'], face_tilt: ['face tilt', '°'], gyr_mag: ['turn speed', '°/s'],
    lin_mag: ['push', 'g'], radius: ['swing radius guess', 'm']
  };
  var ROT_DEC = { tau: 2, lin_mag: 1, radius: 2 };
  function rotPanel(B) {
    var R = window.ROTSAMPLE;
    if (!R || !R.true || !R.true.length) return null;
    var n = Math.max(1, Math.min(R.frames || R.true.length, R.true.length)), fps = num(R.fps, 100);
    var res = R.results || {}, inp = {}, box = el(B.root, ''), vals = {}, outs = {}, compact = false, dense = false, last = -1, cur = 0;
    (R.inputs || []).forEach(function (c) { if (c && c.key) inp[c.key] = c; });
    function series(k) { return R[k] || []; }
    function at(arr, i) { return num(arr[i], 0); }
    function minus(s) { return s.replace('-', '−'); }
    function sgn(v) { v = Math.round(v); return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '°'; }
    function fmtIn(key, v, unit) {
      var s = v.toFixed(ROT_DEC[key] || 0);
      if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
      return minus(s) + (unit === '°' ? '°' : ' ' + unit);
    }
    function phaseName(i) {
      for (var k = 1; k <= 4; k++) { var c = inp['ph' + k]; if (c && c.values && num(c.values[i], 0) > 0.5) return PH_NAMES[k]; }
      return PH_NAMES[0];
    }
    var lo = 0, hi = 0;
    ['true', 'hgb', 'proxy'].forEach(function (k) {
      var a = series(k);
      for (var i = 0; i < a.length; i++) { var v = num(a[i], 0); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    });
    if (hi - lo < 1) hi = lo + 1;
    function resRow(name, k, strong) {
      var v = num(res[k], null), P = B.P, st = strong ? 'color:' + P.accent + ';font-weight:600;' : '';
      return '<span style="' + st + '">' + name + '</span>' +
        '<span style="text-align:right;font-variant-numeric:tabular-nums;' + st + '">' + (v == null ? '–' : v.toFixed(1) + '°') + '</span>';
    }
    function build() {
      var P = B.P, NUMS = 'text-align:right;font-variant-numeric:tabular-nums;', h = '';
      box.style.cssText = 'position:absolute;box-sizing:border-box;padding:9px 12px;border-radius:8px;overflow:hidden;pointer-events:none;' +
        'font:' + PANEL_FONT + ';color:' + P.fg + ';background:' + rgba(P.bg, 0.92) + ';border:1px solid ' + P.line + ';';
      h += '<div style="font-weight:700">How the chest turn is predicted</div>' +
        '<div style="color:' + P.muted + ';margin-bottom:6px">One real swing from a held-out player. Played at half speed.</div>' +
        '<div style="color:' + P.muted + ';margin-bottom:2px">INPUT, every 10 ms: ' + ((R.inputs && R.inputs.length) || 16) + ' numbers from the racket sensor</div>' +
        '<div style="display:grid;grid-template-columns:' + (compact || dense ? '1fr 1fr' : '1fr') + ';column-gap:14px">';
      ROT_SHOWN.forEach(function (k) {
        var c = inp[k] || {}, name = c.name || ROT_FB[k][0];
        h += '<div style="display:flex;justify-content:space-between;gap:8px;height:18px;white-space:nowrap">' +
          '<span style="overflow:hidden;text-overflow:ellipsis">' + name + '</span>' +
          '<span data-in="' + k + '" style="' + NUMS + '"></span></div>';
      });
      h += '</div><div style="color:' + P.muted + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">+ 3 force axes, + current phase: ' +
        '<span data-phase style="color:' + P.fg + '"></span></div>' +
        '<div style="color:' + P.muted + ';margin-top:6px">MODEL: <span style="color:' + P.fg + '">gradient boosting regressor, trained on the other 11 players</span></div>';
      var outH = ''
        + '<div style="color:' + P.muted + ';margin:6px 0 2px">OUTPUT: chest turn since swing start</div>' +
        '<div style="display:grid;grid-template-columns:1fr 56px;row-gap:1px">' +
        '<span style="color:' + P.muted + '">True</span><span data-out="true" style="' + NUMS + 'color:' + P.muted + '"></span>' +
        '<span style="color:' + P.accent + ';font-weight:700">Gradient boosting</span><span data-out="hgb" style="' + NUMS + 'color:' + P.accent + ';font-weight:700"></span>' +
        '<span>Simple ratio k × racket turn</span><span data-out="proxy" style="' + NUMS + '"></span>' +
        '<span>Perfect-sensor test</span><span data-out="oracle" style="' + NUMS + '"></span></div>';
      var resH = ''
        + '<div style="color:' + P.muted + ';margin:6px 0 2px">Average error, 12 held-out players</div>' +
        '<div style="display:grid;grid-template-columns:1fr 50px;row-gap:1px">' +
        resRow('Simple ratio', 'proxy') + resRow('Gradient boosting', 'hgb', true) + resRow('Perfect sensor', 'oracle') + resRow('+ 5-swing calibration', 'cal5') +
        '</div>';
      var chartH = ''
        + '<div style="position:relative;margin-top:7px"><canvas data-ch style="display:block;width:100%;height:' + (dense ? 44 : 60) + 'px"></canvas>' +
        '<div data-ph style="position:absolute;top:0;bottom:0;width:2px;left:0;background:' + P.fg + '"></div></div>' +
        '<div style="display:flex;justify-content:space-between;color:' + P.muted + ';font-size:11px;margin-top:2px">' +
        '<span>true · <span style="color:' + P.accent + '">boosting</span> · ratio (dashed)</span><span data-t></span></div>';
      h += dense ? '<div style="display:grid;grid-template-columns:1fr 1fr;column-gap:16px"><div>' + outH + '</div><div>' + resH + '</div></div>' + chartH
                 : outH + chartH + resH;
      box.innerHTML = h;
      ROT_SHOWN.forEach(function (k) { vals[k] = box.querySelector('[data-in="' + k + '"]'); });
      ['true', 'hgb', 'proxy', 'oracle'].forEach(function (k) { outs[k] = box.querySelector('[data-out="' + k + '"]'); });
      box.__phase = box.querySelector('[data-phase]'); box.__ph = box.querySelector('[data-ph]');
      box.__t = box.querySelector('[data-t]'); box.__ch = box.querySelector('[data-ch]');
    }
    function drawChart() {
      var cv = box.__ch, P = B.P, w = cv.clientWidth || 300, hh = dense ? 44 : 60, dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
      var g = cv.getContext && cv.getContext('2d'); if (!g) return;
      g.scale(dpr, dpr);
      function Y(v) { return 4 + (1 - (v - lo) / (hi - lo)) * (hh - 8); }
      g.strokeStyle = P.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke();
      [['true', P.muted, 1.6, false], ['proxy', P.fg, 1, true], ['hgb', P.accent, 2, false]].forEach(function (s) {
        var a = series(s[0]); if (!a.length) return;
        g.strokeStyle = s[1]; g.lineWidth = s[2]; if (g.setLineDash) g.setLineDash(s[3] ? [4, 3] : []);
        g.beginPath();
        for (var i = 0; i < Math.min(n, a.length); i++) {
          var x = i / Math.max(1, n - 1) * w, y = Y(num(a[i], 0));
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      });
      if (g.setLineDash) g.setLineDash([]);
    }
    function show(i) {
      i = Math.min(n - 1, Math.max(0, i)); cur = i;
      if (i === last) return;
      last = i;
      ROT_SHOWN.forEach(function (k) {
        var c = inp[k], unit = (c && c.unit) || ROT_FB[k][1];
        vals[k].textContent = c && c.values ? fmtIn(k, num(c.values[i], 0), unit) : '–';
      });
      box.__phase.textContent = phaseName(i);
      ['true', 'hgb', 'proxy', 'oracle'].forEach(function (k) { var a = series(k); outs[k].textContent = a.length ? sgn(at(a, i)) : '–'; });
      box.__ph.style.left = 'calc(' + (i / Math.max(1, n - 1) * 100).toFixed(2) + '% - 1px)';
      box.__t.textContent = 't = ' + (i / fps).toFixed(2) + ' s';
    }
    var api = {
      width: 330, n: n, fps: fps,
      value: function (k, i) { return at(series(k), Math.min(n - 1, Math.max(0, i))); },
      show: show,
      layout: function (W, H) {
        compact = W < 900; dense = false;
        build();
        // short window: if the stacked panel would be clipped, switch to a wider two-column layout that fits
        if (!compact) {
          box.style.cssText += 'right:10px;top:10px;width:' + api.width + 'px;';
          if (H < 720 || box.scrollHeight > H - 74) { dense = true; api.width = 470; build(); } else api.width = 330;
        }
        if (compact) box.style.cssText += 'left:10px;right:10px;bottom:64px;max-height:calc(100% - 74px);';
        else box.style.cssText += 'right:10px;top:10px;width:' + api.width + 'px;max-height:calc(100% - 74px);';
        drawChart(); last = -1; show(cur);
        return compact ? { right: 0, bottom: box.offsetHeight + 64 } : { right: api.width + 20, bottom: 0 };
      },
      dispose: function () { if (box.parentNode) box.parentNode.removeChild(box); }
    };
    return api;
  }

  /* ================================================================== 8. Estimating chest (trunk) rotation */
  var CH8 = {
    id: 'rotation', order: 8,
    kicker: 'Step 8 · Trunk rotation',
    title: 'How well can a racket sensor see the trunk turn?',
    body: "<p><b>Can the racket tell how much you turned your chest?</b></p><p>Partly. Our best guess is off by about <b>7°</b>. Here is the important part: even a perfect, noise-free sensor only gets to 6.6°. So the problem is not a bad sensor; the racket simply does not carry that information.</p><p>If we film a player for just <b>5 swings</b> to calibrate, the error drops to about 5°.</p>" +
      "<p>What goes in: how far the racket has turned since the swing began, how coiled and how far forward it has been so far, time since the start, tip and face angles, turn speed, push, a swing-radius guess, the force on each axis and the current phase. A gradient boosting model trained on the other 11 players turns those 16 numbers into the chest turn every 10 ms.</p>",
    mount: function (stage, ctx) {
      var B = base(stage, ctx, { target: [0.15, 1.05, 0.25], dir: [-0.9, 1.25, 0.55], dist: 4.4, half: 1.1 });
      var THREE = B.THREE, F = ctx.F, P = B.P; B.F = F;
      var rot = (ctx.summary && ctx.summary.rotation) || {};
      function rm(k, d) { return num(rot[k] && rot[k].rmse, d); }
      var RS = window.ROTSAMPLE, ours = num(RS && RS.results && RS.results.hgb, rm('hgb', 7.08));
      var D = F.duration, SPEED = SWING * (ctx.reducedMotion ? 0.35 : 1), clock = F.phases[1].t0;

      // fallback (no real sample): illustrative estimate = true chest turn + a slow error wave scaled to the measured average error
      var t0 = F.phases[1].t0, t1 = F.phases[4].t1;
      function env(t) { return smooth((t - t0 + 0.1) / 0.2) * (1 - smooth((t - t1 + 0.05) / 0.25)); }
      function wave(t) { return env(t) * (Math.sin(TAU * 2 * t / D + 0.7) + 0.4 * Math.sin(TAU * 5 * t / D + 2.1)); }
      var ss = 0, cnt = 0;
      for (var t = t0; t <= t1; t += 0.01) { ss += wave(t) * wave(t); cnt++; }
      var errScale = ours / Math.sqrt(ss / Math.max(1, cnt) || 1);

      var fig = makeFigure(B, 0);
      function bar(color, y) {
        var m = new THREE.MeshBasicMaterial({ color: color });
        var g = new THREE.Group(); g.position.y = y;
        var mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.95), m); g.add(mesh);
        B.scene.add(g); return { g: g, m: m };
      }
      var trueBar = bar(P.fg, 1.47), estBar = bar(P.accent, 1.53);
      var trueLb = B.label(), estLb = B.label('accent');
      trueLb.textContent = 'True turn'; estLb.textContent = 'Sensor guess';
      B.caption.innerHTML = 'Racket turn, angles and forces go in.<br>A model trained on 11 players outputs the chest turn.<br>Average error about <b>' + Math.round(ours) + '°</b>.';

      // live panel (one real held-out swing); shift the figure away from it like the validation chapter does
      var SP = rotPanel(B), SRATE = ctx.reducedMotion ? 0.2 : 0.5, HOLD = 0.8;
      var LOOP = SP ? SP.n / SP.fps / SRATE + HOLD : 1, sclock = 0;
      B.onResize = function (W, H) {
        if (!SP) return;
        var r = SP.layout(W, H);
        if (r.bottom) {   // panel under the figure: back the camera off so the figure fits in the space left above it
          var k = H / Math.max(120, H - r.bottom) * 1.05;
          B.camera.position.sub(B.target).multiplyScalar(k).add(B.target); B.camera.lookAt(B.target);
        }
        B.camera.setViewOffset(W, H, r.right / 2, r.bottom / 2, W, H);
        B.camera.updateProjectionMatrix();
      };
      B.resize();

      // one shared clock: frame i drives the figure, both bars and the panel
      function update(dt) {
        var tv, ev;
        if (SP) {
          sclock = (sclock + dt) % LOOP;
          var i = Math.min(SP.n - 1, Math.floor(sclock * SRATE * SP.fps));
          fig.update(t0 + (t1 - t0) * i / Math.max(1, SP.n - 1), 0);
          tv = SP.value('true', i) * D2R; ev = SP.value('hgb', i) * D2R;
          SP.show(i);
        } else {
          clock = (clock + dt * SPEED) % D;
          tv = fig.update(clock, 0).th; ev = tv + wave(clock) * errScale * D2R;
        }
        trueBar.g.rotation.y = tv; estBar.g.rotation.y = ev;
        // guess label at the player's left end of its bar, true label at the right end of its bar
        B.place(estLb, new THREE.Vector3(-0.5 * Math.sin(ev), 1.58, -0.5 * Math.cos(ev)));
        B.place(trueLb, new THREE.Vector3(0.5 * Math.sin(tv), 1.5, 0.5 * Math.cos(tv)));
        B.render();
      }
      update(0);
      return {
        frame: update,
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P; fig.retheme(P); trueBar.m.color.set(P.fg); estBar.m.color.set(P.accent);
          B.resize(); update(0);
        },
        dispose: function () { B.onResize = null; if (SP) SP.dispose(); B.dispose(); }
      };
    }
  };

  /* ================================================================== 9. Same racket, different body */
  var CH9 = {
    id: 'nonident', order: 9,
    kicker: 'Step 9 · The limit',
    title: 'Same racket, different body',
    body: "<p><b>Two different bodies, identical racket motion.</b></p><p>Swing once using mostly your chest. Swing again turning your chest less and your shoulder more. The racket moves <b>exactly the same</b> both times, and the sensor readings match almost perfectly.</p><p>But your body turned very differently: <b>52° vs 32°</b> of chest turn. A racket sensor alone can never tell those two swings apart. This is the heart of the project.</p>",
    mount: function (stage, ctx) {
      // two players side by side (world y = +1.35 and -1.35), seen from behind and above
      var OFF = 1.35;
      var B = base(stage, ctx, { target: [0.35, 0.95, 0.35], dir: [-1, 1.35, 0], dist: 5.6, half: 2.3 });
      var THREE = B.THREE, F = ctx.F, P = B.P; B.F = F;
      var ni = (ctx.summary && ctx.summary.nonident) || {};
      var pkA = Math.abs(num(ni.peak_trunk_A, -52.6)), pkB = Math.abs(num(ni.peak_trunk_B, -31.6));
      var SHARE = clamp(1 - pkB / pkA, 0, 0.6);   // 0.4: part of the chest turn handed to the shoulder
      var D = F.duration, SPEED = SWING * (ctx.reducedMotion ? 0.35 : 1), clock = F.phases[1].t0;
      var figA = makeFigure(B, OFF, 'accent'), figB = makeFigure(B, -OFF, 'second');

      // racket-head path over the swing: identical for both bodies (drawn once per body)
      var pts = [], ta = F.phases[1].t0, tb = F.phases[4].t1;
      for (var t = ta; t <= tb; t += 0.01) pts.push(poseOf(F, t, 0).head);
      function path(off, color) {
        var m = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.7 });
        var geo = new THREE.BufferGeometry().setFromPoints(pts.map(function (w) { return V(THREE, w, off); }));
        B.scene.add(new THREE.Line(geo, m)); return m;
      }
      var pathA = path(OFF, P.accent), pathB = path(-OFF, P.second);
      var lbA = B.label('accent'), lbB = B.label('second'), lbSame = B.label();
      lbA.textContent = 'Chest turn ' + Math.abs(pkA).toFixed(1) + '°';
      lbB.textContent = 'Chest turn ' + Math.abs(pkB).toFixed(1) + '°';
      lbSame.textContent = 'Same racket path';
      B.caption.innerHTML = 'The racket moves exactly the same.<br>The chest turns very differently.<br>The sensor cannot tell them apart.';

      function update(dt) {
        clock = (clock + dt * SPEED) % D;
        figA.update(clock, 0); figB.update(clock, SHARE);
        B.place(lbA, V(THREE, [0, OFF, 2.0]));
        B.place(lbB, V(THREE, [0, -OFF, 2.0]));
        B.place(lbSame, V(THREE, [0.6, 0, 0.35]));
        B.render();
      }
      update(0);
      return {
        frame: update,
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P;
          figA.retheme(P, P.accent); figB.retheme(P, P.second); pathA.color.set(P.accent); pathB.color.set(P.second);
          update(0);
        },
        dispose: function () { B.dispose(); }
      };
    }
  };

  /* ================================================================== 10. What would resolve it */
  var CH10 = {
    id: 'roadmap', order: 10,
    kicker: 'Step 10 · What next',
    title: 'What would resolve it, and how it was built',
    body: "<p><b>How to actually fix it.</b></p><p>A better model will not help; we need more information. Options: a second sensor on the chest (or a smartwatch on the wrist), or cameras filming players to get the true answer.</p><p>The cheapest fix is a quick <b>5-swing camera calibration</b> per player. The real next step is testing on real players, since everything so far is simulated.</p><p><small>In one line: the racket sensor is great at <b>when</b> things happen, but cannot truly see <b>how your body</b> made the swing.</small></p>",
    mount: function (stage, ctx) {
      var B = base(stage, ctx, { target: [0.9, 0.95, -0.2], dir: [0.75, 0.55, 1], dist: 4.6, half: 1.7 });
      var THREE = B.THREE, F = ctx.F, P = B.P; B.F = F;
      var fig = makeFigure(B, 0), p = fig.update(0.25, 0);   // still, ready stance
      var SPEED = ctx.reducedMotion ? 0.4 : 1, STEP = 3.6, clock = 0;

      // a small camera on a tripod, in front of the player and to the side
      var camPos = V(THREE, [2.2, 1.4, 1.2]);
      var legM = mat(THREE, P.muted), boxM = mat(THREE, P.body);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, camPos.y, 6), legM); pole.position.set(camPos.x, camPos.y / 2, camPos.z); B.scene.add(pole);
      var camBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.16), boxM); camBox.position.copy(camPos); camBox.lookAt(0, 1.2, 0); B.scene.add(camBox);

      var chest = V(THREE, [0.13 * Math.cos(p.th), 0.13 * Math.sin(p.th), 1.3]);
      var wrist = V(THREE, [p.H[0] - 0.04 * p.xr[0], p.H[1] - 0.04 * p.xr[1], p.H[2] + 0.02]);
      var lens = camPos.clone().add(new THREE.Vector3(0, 0, 0).subVectors(new THREE.Vector3(0, 1.2, 0), camPos).normalize().multiplyScalar(0.11));
      var spots = [
        { at: chest, name: 'Chest sensor' },
        { at: wrist, name: 'Wrist watch' },
        { at: lens, name: 'Camera check' }
      ];
      var dotGeo = new THREE.SphereGeometry(0.05, 14, 10), haloGeo = new THREE.SphereGeometry(0.12, 16, 12);
      spots.forEach(function (s) {
        s.m = new THREE.MeshStandardMaterial({ color: P.muted, emissive: new THREE.Color(P.accent), emissiveIntensity: 0, roughness: 0.4 });
        s.dot = new THREE.Mesh(dotGeo, s.m); s.dot.position.copy(s.at); B.scene.add(s.dot);
        s.hm = new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0, depthWrite: false });
        s.halo = new THREE.Mesh(haloGeo, s.hm); s.halo.position.copy(s.at); B.scene.add(s.halo);
        s.lb = B.label('accent'); s.lb.textContent = s.name;
      });
      B.caption.innerHTML = 'The racket alone is not enough.<br>Add one more view of the body:<br>a chest sensor, a watch, or a 5-swing camera check.';
      var cMuted = new THREE.Color(P.muted), cAcc = new THREE.Color(P.accent);

      function update(dt) {
        clock = (clock + dt * SPEED) % (STEP * spots.length);
        var k = Math.floor(clock / STEP), v = clock - k * STEP;
        spots.forEach(function (s, i) {
          var on = i === k ? smooth(v / 0.6) * (1 - smooth((v - STEP + 0.6) / 0.6)) : 0;
          s.m.color.copy(cMuted).lerp(cAcc, on); s.m.emissiveIntensity = 0.6 * on;
          s.hm.opacity = 0.22 * on; s.dot.scale.setScalar(1 + 0.4 * on);
          B.place(s.lb, s.at.clone().add(new THREE.Vector3(0, 0.16, 0)), on);
        });
        B.render();
      }
      update(0);
      return {
        frame: update,
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P; fig.retheme(P); legM.color.set(P.muted); boxM.color.set(P.body);
          cMuted.set(P.muted); cAcc.set(P.accent);
          spots.forEach(function (s) { s.m.emissive.set(P.accent); s.hm.color.set(P.accent); });
          update(0);
        },
        dispose: function () { B.dispose(); }
      };
    }
  };

  (window.Chapters = window.Chapters || []).push(CH7, CH8, CH9, CH10);
})();
