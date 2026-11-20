/* ch_c.js: chapters 7-10 (validation, rotation, non-identifiability, roadmap).
   Classic script. Numbers come from ctx.summary (results/summary.json) and PLAN.md sections 4-6. */
(function () {
  'use strict';

  var MONO = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var D2R = Math.PI / 180;
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ helpers */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function fx(v, n) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(n); }
  function parseCol(c) {
    c = String(c || '').trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (m) {
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = /rgba?\(([^)]+)\)/i.exec(c);
    if (m) { var p = m[1].split(',').map(parseFloat); return [p[0] || 0, p[1] || 0, p[2] || 0]; }
    return [128, 128, 128];
  }
  function rgba(c, a) { var p = parseCol(c); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
  function lum(c) { var p = parseCol(c); return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; }
  function pal(th) {
    th = th || {}; var ph = th.phaseColors || [];
    return {
      bg: th.bg || '#0f1b17', fg: th.fg || '#e2ebe6', muted: th.muted || '#8ea198', ground: th.ground || '#1f4c3e',
      body: th.body || '#bfc8cc', racket: th.racket || '#0a0f12', accent: th.accent || '#e6c53a', line: th.line || '#22342d',
      grey: ph[0] || '#7d8d87', blue: ph[1] || '#4f9ad6', red: ph[2] || '#ee6a45', yellow: ph[3] || '#e6c53a', green: ph[4] || '#62c48d',
      dark: lum(th.bg || '#0f1b17') < 0.45
    };
  }
  function el(parent, tag, css, html) {
    var d = document.createElement(tag || 'div');
    if (css) d.style.cssText = css;
    if (html != null) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  }
  function panelCss(P) {
    return 'position:absolute;background:' + rgba(P.bg, 0.84) + ';border:1px solid ' + rgba(P.line, 0.9) +
      ';border-radius:8px;padding:8px 10px;font:' + MONO + ';color:' + P.fg + ';line-height:1.45;pointer-events:none;' +
      'box-shadow:0 2px 10px ' + rgba('#000000', 0.12) + ';';
  }
  function sw(c) { return '<i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px;background:' + c + '"></i>'; }
  function setHTML(node, html) { if (node.__h !== html) { node.__h = html; node.innerHTML = html; } }

  // one WebGL renderer + scene + camera + overlay layer for a chapter
  function base(stage, ctx, fov) {
    var THREE = ctx.THREE, P = pal(ctx.theme);
    var root = el(stage, 'div', 'position:absolute;inset:0;overflow:hidden;');
    var canvas = el(root, 'canvas', 'display:block;width:100%;height:100%;');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(P.bg);
    scene.fog = new THREE.Fog(P.bg, 14, 30);
    var camera = new THREE.PerspectiveCamera(fov || 40, 1, 0.05, 80);
    var hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(P.ground), 0.85); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 0.65); sun.position.set(3, 7, 4); scene.add(sun);
    var overlay = el(root, 'div', 'position:absolute;inset:0;pointer-events:none;font:' + MONO + ';color:' + P.fg + ';');
    var W = 640, H = 400, tmp = new THREE.Vector3();
    var B = {
      THREE: THREE, root: root, canvas: canvas, renderer: renderer, scene: scene, camera: camera, overlay: overlay, P: P,
      hemi: hemi,
      size: function () { return { w: W, h: H }; },
      resize: function () {
        W = root.clientWidth || stage.clientWidth || 640; H = root.clientHeight || stage.clientHeight || 400;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, H, false);
        camera.aspect = W / Math.max(1, H); camera.updateProjectionMatrix();
      },
      project: function (v) {
        tmp.copy(v).project(camera);
        return { x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H, vis: tmp.z < 1 && tmp.z > -1 };
      },
      place: function (node, v, dy) {
        var s = B.project(v);
        node.style.display = s.vis ? '' : 'none';
        node.style.left = s.x.toFixed(1) + 'px'; node.style.top = (s.y + (dy || 0)).toFixed(1) + 'px';
        return s;
      },
      retheme: function (th) {
        P = B.P = pal(th);
        scene.background = new THREE.Color(P.bg); scene.fog.color.set(P.bg);
        hemi.groundColor.set(P.ground); overlay.style.color = P.fg;
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
  function label(B, css) {
    return el(B.overlay, 'div', 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;text-align:center;' +
      'font:11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;' + (css || ''));
  }
  function std(M, c, extra) {
    var THREE = M; var o = { color: c, roughness: 0.6, metalness: 0.05, flatShading: true };
    for (var k in extra) o[k] = extra[k];
    return new THREE.MeshStandardMaterial(o);
  }
  function phaseKey(sum) {
    var ph = (sum && sum.phase) || {};
    var keys = ['HGB+HMM', 'GBoost+HMM', 'LR+HMM', 'HGB', 'LR'];
    for (var i = 0; i < keys.length; i++) if (ph[keys[i]] && ph[keys[i]].per_player_f1) return { key: keys[i], d: ph[keys[i]] };
    for (var k in ph) if (ph[k] && ph[k].per_player_f1) return { key: k, d: ph[k] };
    return null;
  }
  function meanSd(a) {
    if (!a.length) return { m: 0, s: 0 };
    var m = 0, s = 0, i; for (i = 0; i < a.length; i++) m += a[i]; m /= a.length;
    for (i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return { m: m, s: Math.sqrt(s / a.length) };   // population sd, as summarise() uses np.std
  }

  /* ================================================================== 7. Player-held-out validation */
  var CH7 = {
    id: 'validation', order: 7,
    kicker: 'Step 7 · Validation',
    title: 'Hold out a whole player, twelve times',
    body: "<p><b>Test on a stranger, not someone you have already seen.</b></p><p>We teach the system on 11 players and test it on the 12th, a player it has never seen. Then we repeat that 12 times, so every player gets a turn as the stranger.</p><p>Scores stay between <b>97.6% and 99.3%</b> across players, so it works on new people, not just ones it memorised.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, B = base(stage, ctx, 38), P = B.P, scene = B.scene, cam = B.camera;
      var pk = phaseKey(ctx.summary);
      var f1 = pk ? pk.d.per_player_f1.slice(0, 12) : [98.6, 97.6, 97.7, 98.9, 98.7, 98.5, 97.9, 98.8, 99.3, 98.6, 98.2, 98.6];
      var modelName = pk ? pk.key.replace('HGB', 'GBoost').replace('LR', 'LogReg').replace('+', ' + ') : 'GBoost + HMM';
      var N = f1.length, R = 3.0, SPEED = ctx.reducedMotion ? 0.45 : 1;
      var FOLD = 1.6, HOLD = 3.6, LOOP = N * FOLD + HOLD;
      function barH(v) { return 0.12 + 1.5 * clamp((v - 96.5) / 3.2, 0, 1); }

      cam.position.set(0, 4.3, 7.9); cam.lookAt(0, 0.45, 0);

      var groundMat = std(THREE, P.ground, { roughness: 0.95 });
      var ground = new THREE.Mesh(new THREE.CircleGeometry(5.2, 72), groundMat);
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
      var lineMat = new THREE.MeshBasicMaterial({ color: P.body, transparent: true, opacity: 0.55 });
      var ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.025, R + 0.025, 120), lineMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; scene.add(ring);
      var ring2 = new THREE.Mesh(new THREE.RingGeometry(R + 0.53, R + 0.56, 120), lineMat);
      ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.004; scene.add(ring2);
      var pedMat = std(THREE, P.accent, { emissive: new THREE.Color(P.accent), emissiveIntensity: 0.25 });
      var ped = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.12, 40), pedMat);
      ped.position.y = 0.06; scene.add(ped);

      var bodyGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.55, 14), capGeo = new THREE.SphereGeometry(0.185, 14, 10);
      var headGeo = new THREE.SphereGeometry(0.14, 14, 10), chipGeo = new THREE.BoxGeometry(0.2, 0.05, 0.26);
      var barGeo = new THREE.BoxGeometry(0.17, 1, 0.17); barGeo.translate(0, 0.5, 0);
      var plinthGeo = new THREE.BoxGeometry(0.26, 0.03, 0.26);
      var figs = [];
      for (var i = 0; i < N; i++) {
        var a = i / N * TAU, g = new THREE.Group();
        var mat = std(THREE, P.blue, { emissive: new THREE.Color(P.blue), emissiveIntensity: 0.15 });
        var chipMat = std(THREE, P.blue, { emissive: new THREE.Color(P.blue), emissiveIntensity: 0.2 });
        var body = new THREE.Mesh(bodyGeo, mat); body.position.y = 0.5; g.add(body);
        var c0 = new THREE.Mesh(capGeo, mat); c0.scale.set(1, 0.6, 1); c0.position.y = 0.23; g.add(c0);
        var c1 = new THREE.Mesh(capGeo, mat); c1.scale.set(1, 0.6, 1); c1.position.y = 0.78; g.add(c1);
        var hd = new THREE.Mesh(headGeo, mat); hd.position.y = 1.03; g.add(hd);
        var chips = [-0.14, 0.14].map(function (dx) { var c = new THREE.Mesh(chipGeo, chipMat); c.position.set(dx, 0.03, -0.5); g.add(c); return c; });
        g.rotation.y = a; g.position.set(R * Math.sin(a), 0, R * Math.cos(a)); scene.add(g);
        var barMat = std(THREE, P.green, { emissive: new THREE.Color(P.green), emissiveIntensity: 0.2 });
        var bar = new THREE.Mesh(barGeo, barMat), rb = R + 0.55;
        bar.position.set(rb * Math.sin(a), 0.02, rb * Math.cos(a)); bar.rotation.y = a; bar.scale.y = 0.02; scene.add(bar);
        var pl = new THREE.Mesh(plinthGeo, lineMat); pl.position.set(rb * Math.sin(a), 0.015, rb * Math.cos(a)); pl.rotation.y = a; scene.add(pl);
        var lb = label(B, 'color:' + P.fg + ';');
        figs.push({ a: a, g: g, mat: mat, chipMat: chipMat, chips: chips, bar: bar, barMat: barMat, h: 0.02, lb: lb, rb: rb });
      }
      // mean +/- sd band around the bar ring (updates as folds accumulate)
      var bandMat = new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
      var band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.55, R + 0.55, 1, 120, 1, true), bandMat); scene.add(band);
      var meanLineMat = new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.85 });
      var meanLine = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.012, 6, 140), meanLineMat);
      meanLine.rotation.x = Math.PI / 2; scene.add(meanLine);
      var pedLabel = label(B, 'color:' + P.accent + ';font-weight:600;');

      // HUD (top-left)
      var hud = el(B.overlay, 'div', panelCss(P) + 'left:10px;top:10px;max-width:min(270px,48%);');
      // leak inset (top-right): neighbouring 10 ms frames are near-copies
      var frames = [], tA = F.phases[2].t0 - 0.25, NF = 34;
      for (var k = 0; k < NF; k++) frames.push(F.sample(tA + k * 0.01, 0).gyroMag);
      var all = [], gmin = Infinity, gmax = -Infinity;
      for (var tt = 0; tt < F.duration; tt += 0.01) { var gv = F.sample(tt, 0).gyroMag; all.push(gv); if (gv < gmin) gmin = gv; if (gv > gmax) gmax = gv; }
      var rel = [];
      for (k = 1; k < all.length; k++) if (all[k] > gmin + 0.05 * (gmax - gmin)) rel.push(Math.abs(all[k] - all[k - 1]) / (gmax - gmin));
      rel.sort(function (x, y) { return x - y; });
      var medRel = rel.length ? rel[Math.floor(rel.length / 2)] * 100 : 0;
      var isTest = [], seed = 7;
      for (k = 0; k < NF; k++) { seed = (seed * 1103515245 + 12345) % 2147483648; isTest.push(seed / 2147483648 < 0.25); }
      var leak = el(B.overlay, 'div', panelCss(P) + 'right:10px;top:10px;width:190px;');
      var fmax = Math.max.apply(null, frames);
      function leakSvg(hi) {
        var s = '<svg width="170" height="62" viewBox="0 0 170 62" style="display:block">';
        for (var j = 0; j < NF; j++) {
          var h = 4 + 50 * frames[j] / fmax, x = 2 + j * 5;
          s += '<rect x="' + x + '" y="' + (58 - h).toFixed(1) + '" width="4" height="' + h.toFixed(1) + '" rx="1" fill="' +
            (isTest[j] ? P.accent : P.blue) + '" opacity="' + (j === hi || j === hi - 1 || j === hi + 1 ? 1 : 0.55) + '"/>';
        }
        if (hi >= 0) s += '<rect x="' + (2 + (hi - 1) * 5 - 1) + '" y="1" width="16" height="60" fill="none" stroke="' + P.fg + '" stroke-width="1" rx="2"/>';
        return s + '</svg>';
      }
      var testIdx = []; for (k = 1; k < NF - 1; k++) if (isTest[k] && (!isTest[k - 1] || !isTest[k + 1])) testIdx.push(k);

      var clock = 0;
      function applyColors(fig, w) {   // w: 0 train .. 1 test
        var c = new THREE.Color(P.blue).lerp(new THREE.Color(P.accent), w);
        fig.mat.color.copy(c); fig.mat.emissive.copy(c); fig.mat.emissiveIntensity = 0.12 + 0.5 * w;
        fig.chipMat.color.copy(c); fig.chipMat.emissive.copy(c); fig.chipMat.emissiveIntensity = 0.15 + 0.6 * w;
      }
      function update(dt) {
        clock = (clock + dt * SPEED) % LOOP;
        var fold = Math.floor(clock / FOLD), v = clock - fold * FOLD, summaryPhase = fold >= N;
        var seen = [];
        for (var i = 0; i < N; i++) {
          var f = figs[i], isT = !summaryPhase && i === fold;
          var lift = isT ? smooth(v / 0.4) * (1 - smooth((v - 1.2) / 0.4)) : 0;
          var arc = isT ? 0.45 * Math.sin(Math.PI * clamp(v / 0.4, 0, 1)) + 0.45 * Math.sin(Math.PI * clamp((v - 1.2) / 0.4, 0, 1)) : 0;
          var r = R * (1 - lift), y = lift * 0.12 + arc;
          f.g.position.set(r * Math.sin(f.a), y, r * Math.cos(f.a));
          applyColors(f, summaryPhase ? 0.15 : (isT ? smooth(v / 0.25) * (1 - smooth((v - 1.3) / 0.3)) : 0));
          var visited = summaryPhase || i < fold || (isT && v > 0.35);
          var target = visited ? barH(f1[i]) : 0.02;
          f.h += (target - f.h) * (1 - Math.exp(-(dt > 0 ? dt * SPEED : 0.016) * 6));
          f.bar.scale.y = Math.max(0.02, f.h);
          var hot = isT && v > 0.3;
          f.barMat.color.set(hot ? P.accent : P.green); f.barMat.emissive.set(hot ? P.accent : P.green);
          f.barMat.emissiveIntensity = hot ? 0.5 : 0.2;
          if (visited) seen.push(f1[i]);
          f.lb.innerHTML = '<span style="color:' + P.muted + '">P' + (i + 1) + '</span>' + (visited ? '<br><b style="color:' + (hot ? P.accent : P.fg) + '">' + f1[i].toFixed(1) + '</b>' : '');
          B.place(f.lb, new THREE.Vector3(f.rb * Math.sin(f.a), Math.max(0.02, f.h) + 0.08, f.rb * Math.cos(f.a)));
        }
        var ms = meanSd(seen);
        band.visible = meanLine.visible = seen.length > 0;
        if (seen.length) {
          var y0 = barH(ms.m - ms.s), y1 = barH(ms.m + ms.s);
          band.scale.y = Math.max(0.005, y1 - y0); band.position.y = 0.02 + (y0 + y1) / 2;
          meanLine.position.y = 0.02 + barH(ms.m);
          bandMat.opacity = summaryPhase ? 0.24 : 0.12;
        }
        pedLabel.textContent = summaryPhase ? 'all 12 folds done' : 'test player P' + (fold + 1);
        B.place(pedLabel, new THREE.Vector3(0, summaryPhase ? 0.3 : 1.5, 0));
        var full = meanSd(f1);
        var h = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">LEAVE-ONE-PLAYER-OUT · ' + modelName + '</div>';
        if (!summaryPhase) {
          h += '<div style="margin-top:3px"><b>Fold ' + (fold + 1) + ' / ' + N + '</b></div>' +
            '<div>' + sw(P.accent) + 'test: P' + (fold + 1) + ', both sessions</div>' +
            '<div>' + sw(P.blue) + 'train: other 11 players, 22 sessions</div>' +
            '<div style="margin-top:3px">P' + (fold + 1) + ' macro-F1 <b style="color:' + P.accent + '">' + (v > 0.35 ? f1[fold].toFixed(1) : '…') + '</b></div>';
        } else {
          h += '<div style="margin-top:3px"><b>All 12 players scored</b></div><div>' + sw(P.green) + 'per-player macro-F1</div>';
        }
        h += '<div style="margin-top:3px">' + sw(P.accent) + 'mean ± sd so far: <b>' + (seen.length ? ms.m.toFixed(1) + ' ± ' + ms.s.toFixed(1) : '–') + '</b> <span style="color:' + P.muted + '">(n=' + seen.length + ')</span></div>';
        if (summaryPhase) h += '<div style="color:' + P.muted + '">final: ' + full.m.toFixed(1) + ' ± ' + full.s.toFixed(1) + ', range ' + Math.min.apply(null, f1).toFixed(1) + '–' + Math.max.apply(null, f1).toFixed(1) + '</div>';
        setHTML(hud, h);
        var hi = testIdx.length ? testIdx[Math.floor(clock / 1.1) % testIdx.length] : -1;
        setHTML(leak, '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">WHY NOT A RANDOM FRAME SPLIT</div>' + leakSvg(hi) +
          '<div style="font-size:11px">' + sw(P.accent) + 'test ' + sw(P.blue) + 'train, 10 ms frames</div>' +
          '<div style="font-size:11px;color:' + P.muted + '">neighbours differ by ~' + medRel.toFixed(1) + '% of the swing range: each test frame has a near-copy in train</div>');
        var sz = B.size(); leak.style.display = sz.w < 470 ? 'none' : '';
        B.render();
      }
      update(0);
      return {
        frame: function (dt) { update(dt); },
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P;
          groundMat.color.set(P.ground); lineMat.color.set(P.body); pedMat.color.set(P.accent); pedMat.emissive.set(P.accent);
          bandMat.color.set(P.accent); meanLineMat.color.set(P.accent);
          hud.style.cssText = panelCss(P) + 'left:10px;top:10px;max-width:min(270px,48%);'; hud.__h = '';
          leak.style.cssText = panelCss(P) + 'right:10px;top:10px;width:190px;'; leak.__h = '';
          pedLabel.style.color = P.accent; figs.forEach(function (f) { f.lb.style.color = P.fg; });
          update(0);
        },
        dispose: function () { B.dispose(); }
      };
    }
  };

  /* ================================================================== 8. Estimating trunk rotation */
  var CH8 = {
    id: 'rotation', order: 8,
    kicker: 'Step 8 · Trunk rotation',
    title: 'How well can a racket sensor see the trunk turn?',
    body: "<p><b>Can the racket tell how much you turned your chest?</b></p><p>Partly. Our best guess is off by about <b>7°</b>. Here is the important part: even a perfect, noise-free sensor only gets to 6.6°. So the problem is not a bad sensor; the racket simply does not carry that information.</p><p>If we film a player for just <b>5 swings</b> to calibrate, the error drops to about 5°.</p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, F = ctx.F, B = base(stage, ctx, 36), P = B.P, scene = B.scene, cam = B.camera;
      var rot = (ctx.summary && ctx.summary.rotation) || {};
      function rm(k, d) { return num(rot[k] && rot[k].rmse, d); }
      var E = [
        { key: 'proxy', name: 'proxy k×racket yaw', rmse: rm('proxy', 13.758), col: 'red' },
        { key: 'hgb', name: 'GBoost', rmse: rm('hgb', 7.084), col: 'blue' },
        { key: 'oracle', name: 'perfect sensor', rmse: rm('oracle', 6.616), col: 'green' }
      ];
      var cal5 = rm('hgb_cal5', 5.304);
      var ks = rot.k_share && rot.k_share.length ? rot.k_share : [0.5];
      var kMean = ks.reduce(function (s, v) { return s + v; }, 0) / ks.length;
      var D = F.duration, NS = 490, dtS = D / NS, SPEED = ctx.reducedMotion ? 0.3 : 0.75;
      var p1 = F.phases[1].t0, p5 = F.phases[4].t1;
      var tru = [], alp = [], i;
      for (i = 0; i < NS; i++) { var s = F.sample(i * dtS, 0); tru.push(s.trunk); alp.push(s.alpha); }
      function env(t) { return smooth((t - (p1 - 0.12)) / 0.15) * (1 - smooth((t - p5 + 0.05) / 0.2)); }
      var shapes = [
        function (t, j) { return kMean * alp[j] - tru[j]; },
        function (t) { return Math.sin(TAU * 3 * t / D + 0.7) + 0.6 * Math.sin(TAU * 7 * t / D + 2.1); },
        function (t) { return Math.sin(TAU * 4 * t / D + 2.4) + 0.5 * Math.sin(TAU * 9 * t / D + 0.3); }
      ];
      E.forEach(function (e, n) {
        var raw = [], ss = 0, cnt = 0;
        for (var j = 0; j < NS; j++) { var t = j * dtS, v = env(t) * shapes[n](t, j); raw.push(v); if (t >= p1 && t <= p5) { ss += v * v; cnt++; } }
        var sc = e.rmse / Math.sqrt(ss / Math.max(1, cnt) || 1);
        e.est = raw.map(function (v, j) { return tru[j] + v * sc; });
      });
      function at(arr, t) { t = ((t % D) + D) % D; var x = t / dtS, j = Math.floor(x), u = x - j; return arr[j % NS] * (1 - u) + arr[(j + 1) % NS] * u; }

      cam.position.set(-2.7, 4.3, 2.6); cam.lookAt(0.25, 1.05, 0);
      var groundMat = std(THREE, P.ground, { roughness: 0.95 });
      var ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), groundMat); ground.rotation.x = -Math.PI / 2; scene.add(ground);
      var courtLine = new THREE.MeshBasicMaterial({ color: P.body });
      var bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 12), courtLine); bl.position.set(0.6, 0.002, 0); scene.add(bl);
      // mannequin: pelvis follows 0.4 x trunk (as the simulator's figure), torso follows trunk
      var bodyMat = std(THREE, P.body), darkMat = std(THREE, P.body);
      darkMat.color.multiplyScalar(0.68);
      var pelvis = new THREE.Group(); scene.add(pelvis);
      var pm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), darkMat); pm.scale.set(0.11, 0.09, 0.17); pm.position.y = 0.9; pelvis.add(pm);
      var legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.86, 10);
      [-0.13, 0.15].forEach(function (z) { var l = new THREE.Mesh(legGeo, darkMat); l.position.set(0, 0.45, z); scene.add(l); });
      var torso = new THREE.Group(); scene.add(torso);
      var tm = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.5, 14), bodyMat); tm.scale.set(1, 1, 1.6); tm.position.y = 1.18; torso.add(tm);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), bodyMat); head.position.y = 1.64; torso.add(head);
      var trueMat = std(THREE, P.accent, { emissive: new THREE.Color(P.accent), emissiveIntensity: 0.55 });
      var shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.0), trueMat); shoulder.position.y = 1.45; torso.add(shoulder);
      [-0.5, 0.5].forEach(function (z) { var e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), trueMat); e.position.set(0, 1.45, z); torso.add(e); });
      // estimate bars, stacked above the shoulder line
      var barGeo = new THREE.BoxGeometry(0.04, 0.04, 1.0), tipGeo = new THREE.SphereGeometry(0.04, 10, 8);
      E.forEach(function (e, n) {
        e.mat = new THREE.MeshStandardMaterial({ color: P[e.col], emissive: new THREE.Color(P[e.col]), emissiveIntensity: 0.4, transparent: true, opacity: 0.62, depthWrite: false });
        e.g = new THREE.Group(); e.g.position.y = 1.56 + 0.1 * n;
        e.g.add(new THREE.Mesh(barGeo, e.mat));
        [-0.5, 0.5].forEach(function (z) { var tip = new THREE.Mesh(tipGeo, e.mat); tip.position.z = z; e.g.add(tip); });
        scene.add(e.g);
        e.lb = label(B, 'color:' + P[e.col] + ';font-weight:600;');
      });
      // racket heading (what the proxy scales), drawn faint at hand height
      var rkMat = new THREE.MeshBasicMaterial({ color: P.muted, transparent: true, opacity: 0.6 });
      var rk = new THREE.Group(); rk.position.y = 1.0;
      var rkBar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.9), rkMat); rkBar.position.z = 0.55; rk.add(rkBar); scene.add(rk);
      var rkLb = label(B, 'color:' + P.muted + ';');
      // protractor ring at shoulder height, ticks every 15 deg
      var dialMat = new THREE.LineBasicMaterial({ color: P.body, transparent: true, opacity: 0.45 });
      var tp = [];
      for (var d = -90; d <= 90; d += 15) {
        var a = d * D2R, r0 = d % 45 === 0 ? 0.62 : 0.66, r1 = 0.72;
        tp.push(r0 * Math.sin(a), 1.45, r0 * Math.cos(a), r1 * Math.sin(a), 1.45, r1 * Math.cos(a));
      }
      for (d = -90; d < 90; d += 3) {
        var a0 = d * D2R, a1 = (d + 3) * D2R;
        tp.push(0.72 * Math.sin(a0), 1.45, 0.72 * Math.cos(a0), 0.72 * Math.sin(a1), 1.45, 0.72 * Math.cos(a1));
      }
      var dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      scene.add(new THREE.LineSegments(dg, dialMat));
      var trueLb = label(B, 'color:' + P.accent + ';font-weight:700;');

      var hud = el(B.overlay, 'div', '');
      var head2 = el(B.overlay, 'div', '');
      var chart = el(B.overlay, 'div', '');
      function styleBoxes() {
        hud.style.cssText = panelCss(P) + 'left:10px;top:10px;max-width:min(300px,62%);';
        head2.style.cssText = panelCss(P) + 'left:10px;bottom:64px;max-width:min(330px,calc(100% - 20px));border-color:' + P.accent + ';';
        chart.style.cssText = panelCss(P) + 'right:10px;top:10px;';
        hud.__h = head2.__h = chart.__h = '';
      }
      styleBoxes();
      var CW = 200, CHh = 96;
      function path(arr) {
        var s = '';
        for (var j = 0; j < NS; j += 4) { var x = j / NS * CW, y = CHh / 2 - arr[j] / 100 * (CHh / 2 - 4); s += (j ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
        return s;
      }
      var paths = null;
      function chartHtml(t) {
        if (!paths) paths = { tru: path(tru), e: E.map(function (e) { return path(e.est); }) };
        var x = (((t % D) + D) % D) / D * CW;
        var s = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">TRUNK YAW OVER ONE STROKE</div>' +
          '<svg width="' + CW + '" height="' + CHh + '" viewBox="0 0 ' + CW + ' ' + CHh + '" style="display:block;margin-top:3px">' +
          '<line x1="0" x2="' + CW + '" y1="' + CHh / 2 + '" y2="' + CHh / 2 + '" stroke="' + P.line + '"/>';
        E.forEach(function (e, n) { s += '<path d="' + paths.e[n] + '" fill="none" stroke="' + P[e.col] + '" stroke-width="1.2" opacity="0.85"/>'; });
        s += '<path d="' + paths.tru + '" fill="none" stroke="' + P.accent + '" stroke-width="2.2"/>' +
          '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="0" y2="' + CHh + '" stroke="' + P.fg + '" stroke-opacity="0.6"/></svg>' +
          '<div style="font-size:10px;color:' + P.muted + '">0° line; coil is negative</div>';
        return s;
      }
      var clock = F.phases[1].t0;
      function update(dt) {
        clock = (clock + dt * SPEED) % D;
        var t = clock, tv = at(tru, t), av = at(alp, t);
        torso.rotation.y = tv * D2R; pelvis.rotation.y = 0.4 * tv * D2R; rk.rotation.y = av * D2R;
        var sz = B.size(), narrow = sz.w < 520;
        var rows = '';
        E.forEach(function (e, n) {
          var ev = at(e.est, t); e.g.rotation.y = ev * D2R;
          B.place(e.lb, new THREE.Vector3(0.56 * Math.sin(ev * D2R), 1.6 + 0.1 * n, 0.56 * Math.cos(ev * D2R)));
          e.lb.textContent = narrow ? '' : e.key === 'proxy' ? 'proxy' : e.key === 'hgb' ? 'GBoost' : 'perfect';
          rows += '<tr><td>' + sw(P[e.col]) + e.name + '</td><td style="text-align:right"><b>' + e.rmse.toFixed(1) + '°</b></td><td style="text-align:right;color:' + P.muted + '">' + fx(ev - tv, 0) + '°</td></tr>';
        });
        rows += '<tr><td style="color:' + P.muted + '">' + sw('transparent') + 'GBoost + 5 calib. strokes</td><td style="text-align:right"><b>' + cal5.toFixed(1) + '°</b></td><td></td></tr>';
        B.place(trueLb, new THREE.Vector3(-0.56 * Math.sin(tv * D2R), 1.55, -0.56 * Math.cos(tv * D2R)));
        trueLb.textContent = 'true ' + fx(tv, 0) + '°';
        B.place(rkLb, new THREE.Vector3(1.05 * Math.sin(av * D2R), 1.0, 1.05 * Math.cos(av * D2R)), -4);
        rkLb.textContent = narrow ? '' : 'racket yaw';
        setHTML(hud, '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">HELD-OUT RMSE, 12 PLAYERS</div>' +
          '<table style="border-collapse:collapse;font:inherit;margin-top:3px"><tr style="color:' + P.muted + ';font-size:11px"><td>estimator</td><td style="text-align:right;padding-left:10px">RMSE</td><td style="text-align:right;padding-left:10px">err now*</td></tr>' + rows + '</table>' +
          '<div style="font-size:10px;color:' + P.muted + ';margin-top:2px">' + sw(P.accent) + 'true shoulder line · *bars are an illustration: true yaw + an error trace scaled to each RMSE</div>');
        var gain = E[1].rmse - E[2].rmse;
        setHTML(head2, '<b style="color:' + P.accent + '">A perfect sensor gains only ' + gain.toFixed(1) + '°</b> (' + E[1].rmse.toFixed(1) + ' → ' + E[2].rmse.toFixed(1) + '°).<br>Sensor noise is not the bottleneck; the <b>observation model</b> is.');
        setHTML(chart, chartHtml(t));
        chart.style.display = sz.w < 600 ? 'none' : '';
        B.render();
      }
      update(0);
      return {
        frame: function (dt) { update(dt); },
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P; paths = null;
          groundMat.color.set(P.ground); courtLine.color.set(P.body); bodyMat.color.set(P.body); darkMat.color.set(P.body).multiplyScalar(0.68);
          trueMat.color.set(P.accent); trueMat.emissive.set(P.accent); rkMat.color.set(P.muted); dialMat.color.set(P.body);
          E.forEach(function (e) { e.mat.color.set(P[e.col]); e.mat.emissive.set(P[e.col]); e.lb.style.color = P[e.col]; });
          trueLb.style.color = P.accent; rkLb.style.color = P.muted;
          styleBoxes(); update(0);
        },
        dispose: function () { B.dispose(); }
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
      var F = ctx.F, P = pal(ctx.theme);
      var ni = (ctx.summary && ctx.summary.nonident) || {};
      var gyrMax = num(ni.gyr_max_diff_dps, 2.11e-11), dAB = num(ni.dAB_rms, 0.3217), dAL = num(ni.dAL_rms, 0.3319),
          pkA = num(ni.peak_trunk_A, -52.585), pkB = num(ni.peak_trunk_B, -31.551), noise = num(ni.noise_g, 0.0441), c = num(ni.c, 0.6);
      var SMAX = 1 - c;   // 0.4: fraction of trunk yaw moved into the shoulder in the proof
      var root = el(stage, 'div', 'position:absolute;inset:0;overflow:hidden;');
      var holder = el(root, 'div', 'position:absolute;inset:0;');
      var view = F.mount(holder, { theme: ctx.theme, camera: 'top', ghost: true });
      view.setGhost(true); view.setTrail(true); view.setTheme(ctx.theme);
      var overlay = el(root, 'div', 'position:absolute;inset:0;pointer-events:none;font:' + MONO + ';color:' + P.fg + ';');
      var hud = el(overlay, 'div', ''), meter = el(overlay, 'div', ''), ladder = el(overlay, 'div', ''), tag = el(overlay, 'div', '');
      function styleBoxes() {
        overlay.style.color = P.fg;
        hud.style.cssText = panelCss(P) + 'left:10px;top:10px;width:min(262px,calc(100% - 20px));';
        meter.style.cssText = panelCss(P) + 'left:10px;bottom:64px;width:min(262px,calc(50% - 15px));';
        ladder.style.cssText = panelCss(P) + 'right:10px;top:10px;width:min(250px,40%);';
        tag.style.cssText = 'position:absolute;right:10px;bottom:64px;font:11px ui-monospace, Menlo, monospace;color:' + P.muted + ';text-align:right;max-width:40%;';
        hud.__h = meter.__h = ladder.__h = tag.__h = '';
      }
      styleBoxes();
      var LAD = [
        { k: 'identifiable', c: 'green', items: ['phase timing, tempo, contact time', 'racket angular velocity', 'elevation and face tilt vs gravity'] },
        { k: 'approximate', c: 'blue', items: ['racket head speed (ω × geometry)'] },
        { k: 'partial', c: 'yellow', items: ['trunk rotation for a calibrated player (share, not stroke-to-stroke)'] },
        { k: 'not identifiable', c: 'red', items: ['<b>split of racket rotation into trunk / shoulder / elbow / wrist</b>', 'court heading, path beyond ~0.5 s', 'X-factor, stance, footwork, contact point', 'grip vs mount vs pronation: confounded'] }
      ];
      var SW = 9.0, clock = 0, sclock = 0, lastCam = 'top', SPEED = ctx.reducedMotion ? 0.35 : 1;
      function ladderHtml(pulse, compact) {
        var s = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">FROM THE RACKET IMU ALONE</div>';
        LAD.forEach(function (r) {
          var col = P[r.c], on = r.c === 'red';
          s += '<div style="margin-top:5px"><span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:' + rgba(col, on ? 0.25 + 0.2 * pulse : 0.2) +
            ';border:1px solid ' + col + ';color:' + P.fg + '">' + r.k + '</span>';
          var items = compact ? r.items.slice(0, 1) : r.items;
          s += '<div style="font-size:11px;color:' + P.muted + ';margin-top:2px;white-space:normal">' + items.join('<br>') + '</div></div>';
        });
        return s;
      }
      function bar(lbl, v, col, max) {
        var w = clamp(v / max, 0, 1) * 100;
        return '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;font-size:11px"><span style="flex:0 0 88px;color:' + P.muted + '">' + lbl + '</span>' +
          '<span style="flex:1;height:7px;background:' + rgba(P.line, 0.9) + ';border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:' + w.toFixed(1) + '%;background:' + col + '"></i></span>' +
          '<span style="flex:0 0 52px;text-align:right">' + v.toFixed(2) + ' g</span></div>';
      }
      function update(dt) {
        clock = (clock + dt * SPEED * (ctx.reducedMotion ? 0.6 : 1)) % F.duration;
        sclock = (sclock + dt * SPEED) % (2 * SW);
        var u = (sclock % SW) / SW, share = SMAX * 0.5 * (1 - Math.cos(TAU * u));
        var camName = sclock < SW ? 'top' : 'behind';
        if (camName !== lastCam) { lastCam = camName; view.setCamera(camName); }
        view.render(clock, share);
        var a = F.sample(clock, 0), b = F.sample(clock, share);
        var dAlpha = Math.abs(a.alpha - b.alpha), dGyro = Math.abs(a.gyroMag - b.gyroMag);
        var pk = pkA * (1 - share);    // trunk_B = c * trunk_A is linear in the moved share
        var sz = { w: root.clientWidth || 640 }, compact = sz.w < 620;
        var h = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">TRUNK → SHOULDER SHIFT</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin:3px 0 4px"><b style="font-size:15px;color:' + P.accent + '">' + Math.round(share * 100) + '%</b>' +
          '<span style="flex:1;height:6px;background:' + rgba(P.line, 0.9) + ';border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:' + (share / SMAX * 100).toFixed(1) + '%;background:' + P.accent + '"></i></span><span style="color:' + P.muted + '">of ' + Math.round(SMAX * 100) + '%</span></div>' +
          '<div>' + sw(P.green) + 'racket heading <b>' + fx(b.alpha, 1) + '°</b> <span style="color:' + P.muted + '">Δ ' + (dAlpha < 1e-9 ? '0' : dAlpha.toExponential(0)) + '°</span></div>' +
          '<div>' + sw(P.green) + 'gyro |ω| <b>' + b.gyroMag.toFixed(0) + ' dps</b> <span style="color:' + P.muted + '">Δ ' + (dGyro < 1e-12 ? '0' : dGyro.toExponential(0)) + '</span></div>' +
          '<div style="color:' + P.muted + ';font-size:11px">proof stroke max gyro diff: ' + gyrMax.toExponential(1) + ' dps</div>' +
          '<div style="margin-top:4px">' + sw(P.red) + 'peak trunk coil <b style="color:' + P.red + '">' + fx(pk, 1) + '°</b> <span style="color:' + P.muted + '">(' + fx(pkA, 1) + ' → ' + fx(pkB, 1) + ')</span></div>' +
          '<div>' + sw(P.red) + 'trunk yaw now <b>' + fx(b.trunk, 0) + '°</b> <span style="color:' + P.muted + '">vs ' + fx(a.trunk, 0) + '° unshifted</span></div>';
        setHTML(hud, h);
        var cur = dAB * share / SMAX;
        setHTML(meter, '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">ONLY ACCEL CHANGES (LEVER ARM)</div>' +
          bar('sensor noise', noise, P.grey, 0.4) + bar('this shift ≈', cur, P.red, 0.4) + bar('arm +6 cm', dAL, P.blue, 0.4) +
          '<div style="font-size:10px;color:' + P.muted + ';margin-top:3px">rms over the stroke; full 40% shift = ' + dAB.toFixed(2) + ' g</div>');
        meter.style.display = (root.clientHeight || 400) < 430 && compact ? 'none' : '';
        var pulse = 0.5 + 0.5 * Math.sin(sclock * 3);
        setHTML(ladder, ladderHtml(ctx.reducedMotion ? 0.5 : Math.round(pulse * 10) / 10, compact));
        ladder.style.display = sz.w < 470 ? 'none' : '';
        setHTML(tag, 'solid: current split · ghost: the other body<br>camera: ' + camName);
        tag.style.display = sz.w < 470 ? 'none' : '';
      }
      update(0);
      return {
        frame: function (dt) { update(dt); },
        resize: function () { view.resize(); update(0); },
        setTheme: function (th) { P = pal(th); view.setTheme(th); styleBoxes(); update(0); },
        dispose: function () {
          if (view.dispose) { try { view.dispose(); } catch (e) { /* ignore */ } }
          var cv = holder.querySelector ? holder.querySelector('canvas') : null;
          if (cv && cv.getContext) {
            var gl = null;
            try { gl = cv.getContext('webgl2') || cv.getContext('webgl'); } catch (e) { gl = null; }
            var ext = gl && gl.getExtension ? gl.getExtension('WEBGL_lose_context') : null;
            if (ext) ext.loseContext();
          }
          if (root.parentNode) root.parentNode.removeChild(root);
        }
      };
    }
  };

  /* ================================================================== 10. What would resolve it + build plan */
  var CH10 = {
    id: 'roadmap', order: 10,
    kicker: 'Step 10 · What next',
    title: 'What would resolve it, and how it was built',
    body: "<p><b>How to actually fix it.</b></p><p>A better model will not help; we need more information. Options: a second sensor on the chest (or a smartwatch on the wrist), or cameras filming players to get the true answer.</p><p>The cheapest fix is a quick <b>5-swing camera calibration</b> per player. The real next step is testing on real players, since everything so far is simulated.</p><p><small>In one line: the racket sensor is great at <b>when</b> things happen, but cannot truly see <b>how your body</b> made the swing.</small></p>",
    mount: function (stage, ctx) {
      var THREE = ctx.THREE, B = base(stage, ctx, 40), P = B.P, scene = B.scene, cam = B.camera;
      var sum = ctx.summary || {}, rot = sum.rotation || {}, pkd = phaseKey(sum), ph = sum.phase || {};
      var lr = ph.LR ? ph.LR.macro_f1 : 98.3, hmmEdit = pkd && pkd.d.edit != null ? pkd.d.edit : 100;
      var mF = pkd ? pkd.d.macro_f1 : 98.4, sF = pkd ? pkd.d.macro_f1_sd_players : 0.5;
      var r71 = num(rot.hgb && rot.hgb.rmse, 7.08), r53 = num(rot.hgb_cal5 && rot.hgb_cal5.rmse, 5.30);
      var gyr = num(sum.nonident && sum.nonident.gyr_max_diff_dps, 2.1e-11);
      var SPEED = ctx.reducedMotion ? 0.45 : 1;
      function V(x, y, z) { return new THREE.Vector3(x, y, z); }

      var groundMat = std(THREE, P.ground, { roughness: 0.95 });
      var ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), groundMat); ground.rotation.x = -Math.PI / 2; scene.add(ground);
      var courtMat = new THREE.MeshBasicMaterial({ color: P.body, transparent: true, opacity: 0.7 });
      var base1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 16), courtMat); base1.position.set(0.9, 0.002, 0); scene.add(base1);
      var side1 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.004, 0.05), courtMat); side1.position.set(-4, 0.002, 4.1); scene.add(side1);

      /* --- the instrumented player (faces +x, the net; right side = +z) */
      var bodyMat = std(THREE, P.body), darkMat = std(THREE, P.body), rkMat = std(THREE, P.racket);
      darkMat.color.multiplyScalar(0.68);
      var fig = new THREE.Group(); scene.add(fig);
      var CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), SPH = new THREE.SphereGeometry(1, 12, 9), UP = V(0, 1, 0);
      function cap(a, b, r, mat) {
        var d = b.clone().sub(a), len = d.length();
        var c = new THREE.Mesh(CYL, mat); c.position.copy(a).add(b).multiplyScalar(0.5); c.scale.set(r, len, r);
        c.quaternion.setFromUnitVectors(UP, d.normalize()); fig.add(c);
        [a, b].forEach(function (p) { var s = new THREE.Mesh(SPH, mat); s.position.copy(p); s.scale.setScalar(r); fig.add(s); });
      }
      var J = {
        neck: V(0, 1.45, 0), head: V(0.02, 1.64, 0), shR: V(-0.05, 1.45, 0.2), shL: V(0.05, 1.45, -0.2),
        elR: V(-0.12, 1.2, 0.36), wrR: V(0.1, 1.02, 0.45), elL: V(0.22, 1.2, -0.3), wrL: V(0.42, 1.22, -0.2),
        pel: V(0, 0.92, 0), hipR: V(0, 0.9, 0.11), hipL: V(0, 0.9, -0.11), knR: V(0.05, 0.48, 0.2), knL: V(0.12, 0.48, -0.22),
        ftR: V(-0.02, 0.06, 0.42), ftL: V(0.14, 0.06, -0.38)
      };
      var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.52, 12), bodyMat); torso.scale.set(1, 1, 1.65); torso.position.y = 1.18; fig.add(torso);
      var pelv = new THREE.Mesh(SPH, darkMat); pelv.scale.set(0.11, 0.09, 0.17); pelv.position.copy(J.pel); fig.add(pelv);
      var headM = new THREE.Mesh(SPH, bodyMat); headM.scale.set(0.095, 0.115, 0.095); headM.position.copy(J.head); fig.add(headM);
      cap(J.shR, J.shL, 0.05, bodyMat); cap(J.neck, V(0, 1.55, 0), 0.04, bodyMat);
      cap(J.shR, J.elR, 0.042, bodyMat); cap(J.elR, J.wrR, 0.035, bodyMat); cap(J.shL, J.elL, 0.04, bodyMat); cap(J.elL, J.wrL, 0.033, bodyMat);
      cap(J.hipR, J.knR, 0.062, darkMat); cap(J.knR, J.ftR, 0.046, darkMat); cap(J.hipL, J.knL, 0.062, darkMat); cap(J.knL, J.ftL, 0.046, darkMat);
      // racket: butt below the hand, head up and back (ready / early backswing)
      var butt = V(0.06, 0.94, 0.47), rhead = V(-0.25, 1.5, 0.75);
      cap(butt, J.wrR.clone().lerp(rhead, 0.25), 0.017, rkMat);
      var ringG = new THREE.TorusGeometry(0.15, 0.012, 6, 32); ringG.scale(1, 1.3, 1);
      var rring = new THREE.Mesh(ringG, rkMat); rring.position.copy(rhead); rring.lookAt(rhead.clone().add(V(0.6, 0, -0.5)));
      rring.rotateZ(Math.atan2(rhead.y - butt.y, Math.hypot(rhead.x - butt.x, rhead.z - butt.z)) - Math.PI / 2); fig.add(rring);

      /* --- sensors and references (PLAN section 6) */
      var S = [];
      function addS(o) { o.mat = new THREE.MeshStandardMaterial({ color: P[o.col], emissive: new THREE.Color(P[o.col]), emissiveIntensity: 0.1, roughness: 0.4 }); o.objs = []; o.lb = label(B, 'font-weight:600;'); S.push(o); return o; }
      function box(o, p, s) { var m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), o.mat); m.position.copy(p); scene.add(m); o.objs.push(m); return m; }
      function dot(o, p, r) { var m = new THREE.Mesh(SPH, o.mat); m.position.copy(p); m.scale.setScalar(r); scene.add(m); o.objs.push(m); return m; }
      var today = addS({ name: 'racket-butt IMU (today)', col: 'accent', at: butt.clone().add(V(0, -0.04, 0)), res: 'what this project uses: 200 Hz accel + gyro + 6-axis orientation, nothing on the body' });
      box(today, butt.clone().add(V(0, -0.035, 0)), [0.05, 0.035, 0.05]);
      var thor = addS({ name: 'thorax IMU', col: 'red', at: V(0.14, 1.3, 0), res: 'measures trunk yaw directly: removes the main ambiguity' });
      box(thor, V(0.125, 1.3, 0), [0.03, 0.08, 0.07]);
      var pelI = addS({ name: 'pelvis IMU', col: 'red', at: V(0.13, 0.92, 0), res: 'adds hip–shoulder separation (X-factor)' });
      box(pelI, V(0.115, 0.93, 0), [0.03, 0.06, 0.07]);
      var wri = addS({ name: 'wrist IMU / smartwatch', col: 'blue', at: J.wrR.clone().add(V(-0.03, 0.06, 0)), res: 'splits shoulder rotation from forearm and wrist' });
      var wb = box(wri, J.wrR.clone().add(V(-0.04, 0.03, 0)), [0.05, 0.03, 0.06]); wb.rotation.z = -0.6;
      var mag = addS({ name: 'magnetometer', col: 'yellow', at: butt.clone().add(V(0.22, -0.1, 0.05)), res: 'gives court heading outdoors (yaw is relative-only today)' });
      var magC = butt.clone().add(V(0.2, -0.12, 0.02));
      var mring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 6, 36), mag.mat); mring.position.copy(magC); mring.rotation.x = Math.PI / 2; scene.add(mring); mag.objs.push(mring);
      var needleG = new THREE.ConeGeometry(0.018, 0.14, 8); needleG.rotateZ(-Math.PI / 2);
      var needle = new THREE.Mesh(needleG, mag.mat); needle.position.copy(magC); scene.add(needle); mag.objs.push(needle);
      var camS = addS({ name: '2–3 synced cameras ≥120 fps', col: 'blue', at: V(2.3, 2.15, 2.4), res: 'multi-view markerless pose; one 2-D camera is depth-ambiguous, and trunk rotation happens in depth' });
      var camPos = [V(2.4, 1.8, 2.5), V(2.6, 1.8, -2.4), V(-2.6, 1.8, 2.2)], frLines = [];
      var lineMatC = new THREE.LineBasicMaterial({ color: P.blue, transparent: true, opacity: 0.0 });
      camPos.forEach(function (cp) {
        var bx = box(camS, cp, [0.16, 0.12, 0.22]); bx.lookAt(V(0, 1.1, 0));
        var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, cp.y, 6), darkMat); leg.position.set(cp.x, cp.y / 2, cp.z); scene.add(leg);
        var g = new THREE.BufferGeometry().setFromPoints([cp, V(0, 1.7, 0), cp, V(0, 0.1, 0.3), cp, V(0, 0.1, -0.3)]);
        var ls = new THREE.LineSegments(g, lineMatC); scene.add(ls); frLines.push(ls);
      });
      var moc = addS({ name: 'optical mocap markers (200+ Hz)', col: 'green', at: V(-0.1, 1.42, -0.17), res: 'ground truth: thorax + pelvis clusters, hardware-synced; phase boundaries defined kinematically' });
      [V(-0.08, 1.38, 0.12), V(-0.1, 1.24, -0.12), V(-0.06, 1.47, -0.14), V(-0.11, 1.12, 0.1), V(-0.08, 0.98, 0.14), V(-0.09, 0.9, -0.14), V(-0.1, 1.0, 0)].forEach(function (p) { dot(moc, p, 0.022); });
      var ins = addS({ name: 'pressure insoles', col: 'yellow', at: J.ftL.clone().add(V(0, 0.05, 0)), res: 'weight transfer and footwork' });
      [J.ftR, J.ftL].forEach(function (p) { box(ins, V(p.x + 0.06, 0.012, p.z), [0.28, 0.012, 0.11]); });
      var calib = { name: 'cheapest route: 5 calibration strokes', res: 'with camera ground truth, rotation RMSE ' + r71.toFixed(1) + '° → ' + r53.toFixed(1) + '°' };

      /* --- build timeline: a path on the court that ends at the instrumented player */
      var STEPS = [
        ['simulate', '12 players × 2 sessions × 30'],
        ['sensor model', 'noise, drift, BLE loss'],
        ['preprocess', 're-grid, interp ≤50 ms, mask'],
        ['features', '60 per 10 ms frame'],
        ['baseline', 'LogReg ' + lr.toFixed(1) + ' F1'],
        ['HMM', 'edit ' + hmmEdit.toFixed(0) + ', p90 contact 10 ms'],
        ['LOPO evaluation', mF.toFixed(1) + ' ± ' + sF.toFixed(1) + ', 12 folds'],
        ['non-identifiability', 'gyro equal to ' + gyr.toExponential(0) + ' dps'],
        ['real data + ground truth', 'next: mocap-synced cohort']
      ];
      var NP = STEPS.length, nodePos = [];
      for (var i = 0; i < NP; i++) {
        var u = i / (NP - 1);
        nodePos.push(V(-7.6 + 6.9 * u, 0.06, 2.3 * Math.sin(u * Math.PI * 1.5 + 0.4) * (1 - 0.75 * u) + 0.25 * u));
      }
      var curve = new THREE.CatmullRomCurve3(nodePos, false, 'catmullrom', 0.5);
      var pathMat = new THREE.MeshBasicMaterial({ color: P.body, transparent: true, opacity: 0.45 });
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.03, 6, false), pathMat));
      var doneMat = new THREE.MeshBasicMaterial({ color: P.accent });
      var donePath = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.045, 6, false), doneMat); scene.add(donePath);
      var doneCount = donePath.geometry.index ? donePath.geometry.index.count : 0;
      var nodeGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.1, 28), nodes = [];
      for (i = 0; i < NP; i++) {
        var nm = std(THREE, P.body, { emissive: new THREE.Color(P.body), emissiveIntensity: 0.05 });
        var n = new THREE.Mesh(nodeGeo, nm); n.position.copy(nodePos[i]); scene.add(n);
        nodes.push({ m: n, mat: nm, lb: label(B, '') });
      }
      var marker = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), new THREE.MeshBasicMaterial({ color: P.accent })); scene.add(marker);
      var halo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.25, depthWrite: false })); scene.add(halo);

      var card = el(B.overlay, 'div', ''), hud = el(B.overlay, 'div', '');
      function styleBoxes() {
        card.style.cssText = panelCss(P) + 'left:10px;bottom:64px;max-width:min(360px,calc(100% - 20px));';
        hud.style.cssText = panelCss(P) + 'left:10px;top:10px;max-width:min(300px,60%);';
        card.__h = hud.__h = '';
      }
      styleBoxes();

      // timeline: A = marker walks the build steps; B = sensors light one by one; C = calibration + hold
      var TA = NP * 1.05, TS = 1.7, NSEN = S.length, TB = NSEN * TS, TC = 3.2, LOOP = TA + TB + TC, clock = 0;
      var camA = { p: V(-3.2, 5.6, 7.6), t: V(-3.6, 0.2, 0.2) }, camB = { p: V(2.6, 2.3, 3.6), t: V(0, 1.05, 0) };
      var cp = V(0, 0, 0), ct = V(0, 0, 0);
      function update(dt) {
        clock = (clock + dt * SPEED) % LOOP;
        var t = clock, inA = t < TA, sIdx = inA ? -1 : Math.floor((t - TA) / TS), inC = t >= TA + TB;
        // camera blend
        var k = inA ? smooth((t - (TA - 1.4)) / 1.4) : (inC ? 1 - smooth((t - (LOOP - 1.4)) / 1.4) : 1);
        if (!inA && !inC) k = 1;
        cp.copy(camA.p).lerp(camB.p, k); ct.copy(camA.t).lerp(camB.t, k);
        var sz = B.size();
        if (sz.w < 520) { cp.add(V(0, 0.6, 2.2).multiplyScalar(1)); }
        cam.position.copy(cp); cam.lookAt(ct);
        // marker along the path
        var prog = inA ? clamp(t / (TA - 0.4), 0, 1) : 1;
        var mp = curve.getPointAt(prog); marker.position.set(mp.x, 0.22 + 0.05 * Math.sin(t * 5), mp.z); halo.position.copy(marker.position);
        halo.scale.setScalar(1 + 0.15 * Math.sin(t * 6));
        if (doneCount) donePath.geometry.setDrawRange(0, Math.floor(doneCount * prog / 6) * 6);
        var reached = Math.floor(prog * (NP - 1) + 1e-6);
        for (var i = 0; i < NP; i++) {
          var nd = nodes[i], on = i <= reached, cur = inA && i === reached, last = i === NP - 1;
          var col = last ? P.red : (on ? P.green : P.body);
          nd.mat.color.set(on ? col : P.body); nd.mat.emissive.set(on ? col : P.body); nd.mat.emissiveIntensity = cur ? 0.7 : on ? 0.3 : 0.05;
          nd.m.scale.set(cur ? 1.25 : 1, 1, cur ? 1.25 : 1);
          nd.lb.innerHTML = '<span style="color:' + (on ? P.fg : P.muted) + ';font-weight:' + (cur ? 700 : 500) + '">' + (i + 1) + '. ' + STEPS[i][0] + '</span>' +
            ((cur || (on && k < 0.5 && sz.w >= 700)) ? '<br><span style="color:' + P.muted + ';font-size:10px">' + STEPS[i][1] + '</span>' : '');
          nd.lb.style.opacity = k > 0.6 ? (last ? 0.9 : 0) : 1;
          if (k <= 0.6 || last) B.place(nd.lb, nodePos[i].clone().add(V(0, 0.32, 0))); else nd.lb.style.display = 'none';
          if (sz.w < 520 && !cur && !last && k <= 0.6) nd.lb.style.display = 'none';
        }
        // sensors
        S.forEach(function (o, j) {
          var lit = !inA && (inC || j <= sIdx), curS = !inA && !inC && j === sIdx;
          var pulse = curS ? 0.5 + 0.5 * Math.sin(t * 7) : 0;
          o.mat.emissiveIntensity = lit ? 0.45 + 0.6 * pulse : 0.05;
          o.mat.color.set(lit ? P[o.col] : P.body);
          o.lb.style.color = P[o.col];
          o.lb.textContent = o.name;
          if (lit && (curS || (inC && sz.w >= 560))) B.place(o.lb, o.at, -6); else o.lb.style.display = 'none';
          if (o === camS) lineMatC.opacity = lit ? 0.35 + 0.3 * pulse : 0;
        });
        needle.rotation.y = 0.4 * Math.sin(t * 1.3);
        var h;
        if (inA) {
          h = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">HOW THE PROJECT WAS BUILT</div>' +
            '<div><b style="color:' + P.accent + '">' + (reached + 1) + '. ' + STEPS[reached][0] + '</b></div><div style="color:' + P.muted + '">' + STEPS[reached][1] + '</div>';
          setHTML(card, '<div>' + sw(P.green) + 'done (synthetic data) ' + sw(P.red) + 'next: real data</div>');
        } else if (!inC) {
          var o = S[sIdx];
          h = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">WHAT WOULD RESOLVE IT · ' + (sIdx + 1) + '/' + NSEN + '</div>' +
            '<div><b style="color:' + P[o.col] + '">' + o.name + '</b></div>';
          setHTML(card, '<div>' + sw(P[o.col]) + o.res + '</div>');
        } else {
          h = '<div style="color:' + P.muted + ';font-size:11px;letter-spacing:.08em">GROUND TRUTH + EXTRA SENSORS</div><div><b style="color:' + P.accent + '">' + calib.name + '</b></div>';
          setHTML(card, '<div>' + sw(P.accent) + calib.res + '. Sync every stream on the impact shock, plus a tap at session start.</div>');
        }
        setHTML(hud, h);
        B.render();
      }
      update(0);
      return {
        frame: function (dt) { update(dt); },
        resize: function () { B.resize(); update(0); },
        setTheme: function (th) {
          B.retheme(th); P = B.P;
          groundMat.color.set(P.ground); courtMat.color.set(P.body); bodyMat.color.set(P.body); darkMat.color.set(P.body).multiplyScalar(0.68);
          rkMat.color.set(P.racket); pathMat.color.set(P.body); doneMat.color.set(P.accent); marker.material.color.set(P.accent); halo.material.color.set(P.accent);
          lineMatC.color.set(P.blue); S.forEach(function (o) { o.mat.emissive.set(P[o.col]); });
          styleBoxes(); update(0);
        },
        dispose: function () { B.dispose(); }
      };
    }
  };

  var list = (window.Chapters = window.Chapters || []);
  list.push(CH7, CH8, CH9, CH10);
})();
