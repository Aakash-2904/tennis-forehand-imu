# Forehand project in 3D: chapter contract

The page is a chaptered 3D story of the WHOLE project (tennis_forehand_imu): the problem, how we build it, and what it can and cannot know.
Sources: ../../PLAN.md, ../../README.md, ../../results/summary.json, ../../src/*.py. Use real numbers only.

Build folder: tennis_forehand_imu/site/story3d/
- scene.js (done): window.Forehand3D, see ../.. scratch CONTRACT below. Key API:
  F.duration (2.445 s), F.phases [{name,t0,t1}], F.contactTime (1.225),
  F.sample(t, share) -> {phase, trunk, shoulder, wrist, alpha, armElev, rkElev, roll, gyroYaw, gyroMag, accMag, linAcc, sensorPos[x,y,z], headPos[x,y,z]}
  F.mount(containerEl) -> view {render(t,share), setGhost(b), setTrail(b), setCamera('side'|'behind'|'top'|'free'), resize(), setTheme(theme), }
  (World frame: x to net, y left, z up.) view owns its own WebGL renderer + canvas.
- The shell (index, written by the lead) loads three.js r128 (global THREE, cdnjs), scene.js, then every ch_*.js, then itself. All files are CLASSIC scripts: no import/export/modules. They get concatenated inline into one HTML.

## Chapter module API
Each ch_*.js file pushes one or more chapters:

```js
(window.Chapters = window.Chapters || []).push({
  id: 'sensor',            // ascii slug, unique
  order: 2,                // integer, the shell sorts by this
  kicker: 'Step 2 · The sensor', // short label for the chapter rail
  title: 'One sensor on the butt cap',
  body: '<p>…</p>',        // 60–120 words of plain HTML narration (p, ul, b, small tables ok). Real numbers.
  mount(stage, ctx) {      // stage = empty position:relative div filling the 3D area. Build your scene inside it.
    // ctx = { THREE, F /*Forehand3D*/, theme, summary /*parsed results/summary.json minus big arrays*/, reducedMotion }
    // theme = {bg, fg, muted, ground, body, racket, accent, line, phaseColors:[5]}  CSS colour strings
    return {
      frame(dt) {},        // called every rAF while active, dt in s (0 when paused). Advance your own clock.
      resize() {},         // stage size changed
      setTheme(theme) {},  // theme changed
      dispose() {}         // MUST free everything: cancel listeners, renderer.dispose(), renderer.forceContextLoss(), remove DOM.
    };
  }
});
```
Rules:
- Exactly one chapter is mounted at a time; laptop has 8 GB RAM. One WebGL renderer per chapter max (if you use F.mount, that IS your renderer; you may add objects only via your own renderer otherwise). pixelRatio ≤ 2, shadows optional, keep geometry modest.
- Overlays (labels, small HUD readouts, legends) are absolutely positioned HTML inside stage, styled with inline styles using theme colours, font: 12px ui-monospace. Keep them out of the bottom 56px (shell transport lives there) and readable at 400 px width.
- Text labels in 3D: project 3D points to screen and position HTML labels (no font loading).
- Animations loop seamlessly. Respect ctx.reducedMotion (slow or static but still meaningful).
- No network fetches, no localStorage, no alert.
- Verify: `node --check` your file, and a node smoke test with a fake window that the push works and fields exist.
