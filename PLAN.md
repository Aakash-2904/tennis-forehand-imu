# Racket-Only Forehand Inference: First-Experiment Plan

**Goal.** From a racket-butt IMU alone (200 Hz accelerometer ±16 g, gyroscope ±2000 dps, on-board 6-axis orientation; no body landmarks), segment forehands into phases, time ball contact, and estimate trunk (shoulder-line) rotation where the physics allows it.

**Data.** No public dataset pairs racket IMU streams with body kinematics and phase labels, so the first experiment uses a physics-based simulator with known ground truth: 12 players × 2 sessions × 30 forehands. Each stroke is built from a kinematic chain (trunk yaw → shoulder → arm elevation → wrist lag → rigid racket) with the sensor 12 cm below the hand. The sensor and link model adds impact shock, noise, bias, saturation, AHRS heading drift and tilt error, timestamp jitter, and bursty BLE packet loss, plus idle distractors (twirls, ball bouncing, aborted half-swings). Phase labels are defined kinematically: onset, racket-heading minimum (reversal), impact, heading maximum, and return to rest. The results therefore test the method and the physics argument. They are an upper bound, not a claim about real players.

## 1. Feature representation and baseline

The AHRS heading starts at an arbitrary angle and drifts, so no feature uses absolute yaw. Per 10 ms frame (60 features):

- gyro magnitude and body-axis rates, plus **yaw rate about gravity** (gyro rotated using only the tilt part of the orientation)
- accel magnitude and components, gravity-removed linear acceleration, a saturation flag
- **tip elevation** and **face tilt** against gravity, which gravity keeps observable
- jerk, which isolates the impact
- centred-window means and standard deviations at 25, 105 and 305 ms; past-vs-future 150 ms means; heading change over the last and next 300 ms

**Baseline:** frame-wise multinomial logistic regression. Gradient-boosted trees (GBoost) serve as a stronger frame-wise reference. Neither model knows phase order.

## 2. Temporal model and rationale

The temporal model is a **duration-constrained left-to-right HMM** over classifier posteriors, with a fixed cycle: idle → backswing → forward swing → follow-through → recovery → idle. Each phase is a chain of states, so it has a hard minimum duration (0.6 × the 5th-percentile training duration). The last state's self-loop matches the mean duration. Emissions are scaled likelihoods p(phase|x)/p(phase), as in hybrid speech recognisers. Rationale:

- It cannot emit an illegal order, and it produces exactly one contact per stroke.
- It learns about 15 numbers (durations and priors), which suits a first study with few labelled players.
- Frames inside long gaps get a flat emission, so the grammar bridges dropouts.
- It sits on top of any classifier, so the comparison isolates what temporal structure adds.

Contact is the decoded forward-swing → follow-through boundary, snapped to the impact onset: the first sample within ±40 ms whose jerk exceeds half the local peak.

## 3. Missing and noisy data

| Problem | Handling |
|---|---|
| Bursty packet loss, 150–400 ms dropouts | Re-grid on timestamps; interpolate gaps ≤ 50 ms (quaternion nlerp with sign continuity); mask longer gaps; flat HMM emission on masked frames |
| Jitter, clock skew | Resample by timestamp, never by sample count |
| Saturation above ±16 g | Flag as a feature; never integrate or estimate a radius from clipped samples |
| Heading drift (no magnetometer) | Gravity-referenced features and yaw rates only; integrate yaw within one stroke (~1.5 s) |
| AHRS tilt error at high g | Prefer gyro-derived features during the swing |
| Distractors | Labelled idle in training; minimum durations reject short bursts |

**Ablation.** Each held-out player's sessions were re-corrupted at 0–30% packet loss. Interpolate-and-mask does most of the work: at 30% loss GBoost alone holds 98.2 macro-F1, and GBoost+HMM holds 97.0. Naive zero-filling collapses GBoost to 79.2. The HMM recovers that to 88.4, because a zero-filled gap looks like the racket stopping and the grammar rejects it.

## 4. Player-held-out validation and metrics

- **Leave-one-player-out**, 12 folds. Both sessions of the test player are held out, so none of that player's strokes, mounting offset or style reaches training. A random frame split leaks (neighbouring frames are nearly identical), and so does a stroke split (style is shared across strokes).
- Report the mean and the **spread across players**. With 12 players, that spread is the honest uncertainty.
- Hyper-parameters were fixed before the run. Tuning needs a nested split inside the training players.
- **Metrics:** frame macro-F1 (the forward swing is about 5% of frames); edit score and F1@IoU 0.5 (segment-level, penalise flicker); contact precision and recall within ±50 ms and timing error; boundary MAE for every transition; and for rotation, RMSE, per-stroke peak-coil error and Pearson r.

| Model | Macro-F1 (± sd players) | Edit | F1@50 | Contact P / R | Contact MAE / p90 | Onset MAE |
|---|---|---|---|---|---|---|
| LogReg (baseline) | 98.3 ± 0.5 | 93.8 | 97.6 | 99.4 / 99.4 | 6.1 / 15.0 ms | 9.6 ms |
| GBoost | 98.5 ± 0.7 | 96.0 | 97.2 | 98.2 / 99.6 | 6.0 / 15.0 ms | 5.6 ms |
| LogReg + HMM | 98.4 ± 0.5 | 100.0 | 99.8 | 97.9 / 97.9 | 5.7 / 13.0 ms | 7.8 ms |
| GBoost + HMM | 98.4 ± 0.5 | 100.0 | 99.8 | 98.1 / 98.1 | 5.5 / 10.0 ms | 6.2 ms |

Frame-level F1 barely moves with the HMM, because on clean simulated data every classifier labels frames well. The HMM's gain is structural: the segment sequence becomes exactly right (edit 100, F1@50 99.8) and the timing tail tightens (p90 contact error 15 → 10 ms). It costs some contact recall (99.6 → 98.1): when evidence is ambiguous, the grammar drops a stroke rather than inventing a partial one.

## 5. Body-motion variable and what is not identifiable

**Target:** trunk yaw change since the *detected* backswing onset. **Estimators:** (a) proxy k × racket yaw about gravity, with k fitted on the training players; (b) a GBoost regressor on racket yaw and its running extremes, elevation, face tilt, |ω|, linear acceleration, a centripetal radius proxy |a|/ω², and phase; (c) the same regressor fed the **exact, noise-free racket pose and forces** (a perfect-sensor control).

| Estimator | RMSE | Peak-coil error | r |
|---|---|---|---|
| Proxy | 13.8° | 17.7° | 0.95 |
| GBoost | 7.1° | 7.2° | 0.99 |
| GBoost, perfect sensor | 6.6° | 7.8° | 0.99 |
| GBoost + 5 calibration strokes | 5.3° | 4.7° | 0.99 |

A perfect sensor gains only 0.5°, so sensor noise is not the bottleneck. The observation model is. **Constructive proof:** take one forehand and move 40% of the trunk rotation into the shoulder joint. Racket heading is the sum of the joint angles, so racket orientation is unchanged at every instant and the gyro signals match to 2e-11 dps, while peak backswing coil goes from −52.6° to −31.6°. Only linear acceleration changes, through the lever arm (0.32 g rms). An unknown 6 cm change in arm length produces 0.33 g, so the residual cannot separate "more trunk" from "a different body".

| Quantity | From the racket IMU alone |
|---|---|
| Phase timing, tempo, contact time, racket angular velocity | Identifiable |
| Racket elevation and face tilt vs gravity | Identifiable (degraded by AHRS tilt error at high g) |
| Racket head speed | Approximate (ω × known racket geometry) |
| Trunk rotation for a calibrated player | Partial: calibration reveals the player's trunk share, not stroke-to-stroke variation in it |
| Heading relative to the court | Not identifiable (no magnetometer; only relative yaw within a stroke) |
| Racket position and path beyond ~0.5 s | Not identifiable (double-integration drift) |
| Split of racket rotation into trunk, shoulder, elbow, forearm and wrist | Not identifiable (3 orientation DoF vs 10+ body DoF) |
| Pelvis vs thorax (X-factor), stance, footwork, weight transfer | Not identifiable |
| Grip vs mounting offset vs forearm pronation | Confounded (all appear as a constant roll offset) |
| Contact point relative to the body, ball speed and spin, outcome | Not identifiable |

## 6. Ground truth and sensors that resolve the ambiguity

- **Reference:** optical motion capture (200+ Hz, thorax and pelvis marker clusters), hardware-synced to the IMU. Phase boundaries are defined kinematically from the mocap, not by annotators. A cheaper option is 2–3 synced high-speed cameras (≥ 120 fps) with multi-view markerless pose. A single camera with 2-D MediaPipe is depth-ambiguous, and trunk rotation happens largely in depth.
- **Sync:** align every stream on the impact shock, which is sharp in all of them, plus a tap at session start.
- **Extra sensors:** a thorax IMU measures trunk yaw directly and removes the main ambiguity. A pelvis IMU adds hip-shoulder separation. A wrist or forearm IMU (a smartwatch is enough) splits the shoulder from the forearm and wrist. A magnetometer gives court heading outdoors. Pressure insoles give weight transfer, and ball tracking gives the contact point.
- **Cheapest route:** per-player calibration. Five strokes with camera ground truth lower rotation RMSE from 7.1° to 5.3°.

## Limits and next steps

1. The data are synthetic, so every score is an upper bound. The simulator's player variation, noise and label definitions are plausible but not fitted. The first real step is to measure the sim-to-real gap on a small mocap-synced cohort.
2. Real forehands vary more (open stance, running, defensive and slice strokes), and real labels are noisier.
3. Windows are centred, so the pipeline is offline. Real-time feedback needs causal windows and a fixed-lag Viterbi decoder, at some cost in boundary accuracy.
4. Once real labelled data exist, replace the frame classifier with a BiGRU or temporal CNN, keeping the HMM or a CRF on top for the phase grammar.
5. Only right-handed forehands are modelled. Left-handers mirror the yaw sign.
