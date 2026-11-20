(function () {
  var CH = (window.Chapters || []).slice().sort(function (a, b) { return a.order - b.order; });
  var stage = document.getElementById('stage'), rail = document.getElementById('rail');
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CHAPTER_SECONDS = 22;
  var cur = -1, inst = null, playing = !reduced, autoAdv = !reduced, elapsed = 0, last = performance.now();

  function tok(k) { return getComputedStyle(document.documentElement).getPropertyValue(k).trim(); }
  function theme() {
    return { bg: tok('--stage'), fg: tok('--fg'), muted: tok('--muted'), ground: tok('--ground'), body: tok('--body'),
      racket: tok('--racket'), accent: tok('--accent'), line: tok('--line'),
      phaseColors: [tok('--ph0'), tok('--ph1'), tok('--ph2'), tok('--ph3'), tok('--ph4'), tok('--ph0')] };
  }
  var ctx = { THREE: window.THREE, F: window.Forehand3D, theme: theme(), summary: window.SUMMARY || {}, reducedMotion: reduced };

  var PLANS = { 1: 'Plan 1 · Racket-only inference', 2: 'Plan 2 · Skeleton from the sensor (MediaPipe-style)' };
  function planOf(c) { return c.plan || (c.order >= 11 ? 2 : 1); }
  var lastPlan = 0;
  CH.forEach(function (c, i) {
    var p = planOf(c);
    if (p !== lastPlan) {
      var g = document.createElement('span'); g.className = 'plan'; g.textContent = PLANS[p] || ('Plan ' + p);
      rail.appendChild(g); lastPlan = p;
    }
    var b = document.createElement('button'); b.dataset.i = i;
    b.textContent = c.kicker || c.title; b.onclick = function () { go(i, true); };
    rail.appendChild(b);
  });

  function safe(fn) { try { return fn(); } catch (e) { console.error(e); return undefined; } }

  function go(i, manual) {
    if (!CH.length) return;
    i = (i + CH.length) % CH.length;
    if (inst) safe(function () { inst.dispose(); });
    inst = null; stage.innerHTML = '';
    cur = i; elapsed = 0;
    var c = CH[i];
    document.getElementById('kick').textContent = 'Plan ' + planOf(c) + ' · ' + (c.kicker || '');
    document.getElementById('title').textContent = c.title;
    document.getElementById('body').innerHTML = c.body || '';
    [].forEach.call(rail.querySelectorAll('button'), function (b) {
      var j = +b.dataset.i;
      b.setAttribute('aria-current', j === i ? 'true' : 'false');
      if (j === i && manual !== undefined) b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
    if (manual) { autoAdv = false; updAuto(); }
    try { history.replaceState(null, '', '#' + c.id); } catch (e) {}
    inst = safe(function () { return c.mount(stage, ctx); }) || null;
    if (!inst) {
      var d = document.createElement('div'); d.className = 'err';
      d.textContent = 'This chapter could not start its 3D view on this device. The narration on the right still tells the story.';
      stage.appendChild(d);
    }
  }
  function updAuto() { document.getElementById('auto').textContent = autoAdv ? 'auto-advance on' : 'auto-advance off'; }
  document.getElementById('auto').onclick = function () { autoAdv = !autoAdv; updAuto(); };
  document.getElementById('auto').style.cursor = 'pointer';
  document.getElementById('prev').onclick = function () { go(cur - 1, true); };
  document.getElementById('next').onclick = function () { go(cur + 1, true); };
  var pb = document.getElementById('play');
  function updPlay() { pb.textContent = playing ? 'Pause' : 'Play'; }
  pb.onclick = function () { playing = !playing; updPlay(); }; updPlay(); updAuto();
  document.addEventListener('keydown', function (e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight') go(cur + 1, true);
    else if (e.key === 'ArrowLeft') go(cur - 1, true);
    else if (e.key === ' ') { e.preventDefault(); playing = !playing; updPlay(); }
  });

  new ResizeObserver(function () { if (inst && inst.resize) safe(function () { inst.resize(); }); }).observe(stage);
  function retheme() { ctx.theme = theme(); if (inst && inst.setTheme) safe(function () { inst.setTheme(ctx.theme); }); }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  var prog = document.getElementById('prog');
  function loop(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (inst && inst.frame) safe(function () { inst.frame(playing ? dt : 0); });
    if (playing && autoAdv) {
      elapsed += dt;
      if (elapsed >= CHAPTER_SECONDS) go(cur + 1);
    }
    prog.style.width = (autoAdv ? Math.min(100, 100 * elapsed / CHAPTER_SECONDS) : 100 * (cur + 1) / CH.length) + '%';
    requestAnimationFrame(loop);
  }
  var start = 0, h = (location.hash || '').slice(1);
  CH.forEach(function (c, i) { if (c.id === h) start = i; });
  go(start);
  requestAnimationFrame(loop);
})();
