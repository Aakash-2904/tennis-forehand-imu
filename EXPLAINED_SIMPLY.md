# What this project does, explained simply

## The big question
Picture a tennis racket with a tiny sensor in the end of the handle, like the motion chip in your phone. It feels **how fast the racket spins**, **how hard it speeds up**, and **which way it's tilted**. There's no camera, so it can't see the player's body.

We want to know two things:
1. **Can the sensor tell which part of the swing the player is in?** A forehand has 5 parts:
   - **Ready:** waiting
   - **Backswing:** pulling the racket back
   - **Forward swing:** swinging at the ball, which takes only about 1/8 of a second
   - **Follow-through:** finishing the swing
   - **Recovery:** getting back to ready
2. **Can it tell how much the player turned their shoulders?** Coaches care about this a lot.

## Step 1: make fake players
We don't have real recordings, so we built a **video-game-style physics model** of 12 players hitting 720 forehands in total. Each fake player has their own style. Some turn their body a lot, some swing mostly with the arm.

Because we built them, we know the **right answers**: exactly when each swing part happens and exactly how far the shoulders turned. That lets us grade our guesses.

We also made the sensor imperfect on purpose, like a real one. It gets noisy, it maxes out when the swing is too fast, and sometimes the Bluetooth connection drops a few readings.

## Step 2: teach a computer to spot the swing parts
- **Simple model:** it looks at 1/100 of a second at a time and guesses the swing part. It's mostly right, but it **flickers**. Imagine it saying "backswing, backswing, FOLLOW-THROUGH, backswing." That's impossible.
- **Smarter model (HMM):** it knows the **rules of a forehand**. The parts always go in order, and none of them can be super short. It's like autocorrect for swings, and it fixes the flickering.
- **Result:** about **98% correct**, and it finds the exact moment the ball hits the strings to within about **5 thousandths of a second**.

## Step 3: handle missing data
When Bluetooth drops readings, a lazy fix is to fill the gaps with zeros. That's like the racket suddenly freezing in mid-air, which confuses the computer. The better fix is to fill short gaps smoothly and simply **mark long gaps as "unknown."**

## Step 4: test fairly
We train on 11 players and test on the 12th, someone the computer has **never seen**. Then we repeat that 12 times. It's like studying with practice tests but being graded on a brand-new exam.

## Step 5: the big discovery
The racket's turn is like a **sum**:

> racket turn = shoulder turn + arm turn + wrist turn

The sensor only sees the **total**. If I say "two numbers add up to 10," you can't tell whether it's 7 + 3 or 4 + 6.

Same thing here. We built two different fake players, one turning the shoulders more and one using the arm more. Their racket sensors gave **exactly the same readings**.

Then we gave the computer a **perfect sensor with zero noise**, and it was **still about 7° off** on shoulder turn. So the problem isn't a bad sensor or a dumb computer. **The information just isn't there.**

## Step 6: how to fix it
Add a **second sensor on the chest** (a smartwatch on the wrist helps split arm from wrist). Or film each player for about **5 swings** to learn their personal style. That lowers the error from about 7° to about 5°.

## Why the assignment cares
They said they value **"knowing the physical limits"** as much as fancy models. Our project shows both: what works (finding swing parts) and what a racket sensor can't do on its own (exact shoulder turn), with proof.

**One honest note:** all of this uses fake (simulated) players. That proves the method and the logic. Real players would give somewhat lower scores, and testing on them would be the next step.

---

## Where everything is
- `PLAN.md`: the two-page technical plan (the formal answer to `q.md`)
- `notebooks/forehand_experiment.ipynb`: the notebook with all results
- `site/index.html`: the explainer website (open it in a browser)
- `README.md`: how to re-run everything

---

# How the 12 players were built

The 12 players were built in four layers, like making a character in a video game. All the code is in `src/simulate.py`.

## Layer 1: give each player a "personality" (`sample_player`)
Each player gets about a dozen random numbers, each drawn from a realistic range:

| setting | what it means | range |
|---|---|---|
| **coil** | how far they turn their **shoulders** back | 55° to 105° |
| **shoulder** | how much the **arm** swings back on its own | 5° to 35° |
| **wrist lag** | how much the wrist bends back before snapping through | 8° to 28° |
| **arm length** | shoulder to hand | 0.55 to 0.70 m |
| **tempo** | slow or quick swinger | 0.8× to 1.25× |
| **forward swing time** | how fast they hit | 0.10 to 0.15 s |
| **grip** | how the racket face is turned in the hand | −15° to +25° |

The 12 players the experiment actually used:

| player | shoulder turn | arm | wrist | arm length | tempo | swing time | grip |
|---|---|---|---|---|---|---|---|
| 0 | 86° | 12° | 25° | 0.55 m | 1.17 | 140 ms | 4° |
| 1 | 68° | 22° | 24° | 0.64 m | 1.25 | 111 ms | -9° |
| 2 | 57° | 33° | 18° | 0.62 m | 0.91 | 101 ms | -7° |
| 3 | 73° | 10° | 26° | 0.63 m | 1.18 | 132 ms | 15° |
| 4 | 80° | 23° | 16° | 0.60 m | 0.87 | 141 ms | 0° |
| 5 | 85° | 10° | 13° | 0.61 m | 0.84 | 148 ms | -6° |
| 6 | 99° | 30° | 26° | 0.64 m | 0.87 | 110 ms | 22° |
| 7 | 99° | 16° | 13° | 0.56 m | 1.19 | 123 ms | 7° |
| 8 | 56° | 9° | 21° | 0.61 m | 1.04 | 144 ms | -1° |
| 9 | 73° | 32° | 27° | 0.55 m | 1.14 | 141 ms | -10° |
| 10 | 56° | 20° | 13° | 0.58 m | 0.96 | 109 ms | -1° |
| 11 | 72° | 18° | 18° | 0.63 m | 1.20 | 137 ms | 8° |

Compare **player 2** and **player 8**. Both turn their shoulders about 56°, but player 2 adds 33° with the arm while player 8 adds only 9°. That difference in **how they split the turn** between body and arm is the thing the racket sensor can't see.

## Layer 2: animate the swing with keyframes (`stroke_knots`)
This works like animation software. For each swing you set the pose at a few key moments, and the computer fills in the motion between them:

```
moment:          ready → end of backswing → ball contact → end of follow-through → back to ready
shoulder turn:     0°  →      -coil        →     ~0°      →      +40 to 80°       →      0°
racket tilt:      35°  →       25°         →     -5°      →      high finish      →     35°
```

To make it feel human:
- Every swing is slightly different: hit harder or softer, each value nudged by about 7%.
- The **body leads the arm** by 30–80 ms, like a real kinetic chain.
- The motion is smoothed so nothing jerks unnaturally.
- Between swings, players sometimes twirl the racket, bounce a ball, or do a half-swing.

## Layer 3: physics, like a robot arm (`forward_kinematics`)
The body is a chain of linked parts: **torso → shoulder → arm → hand → racket**. From the angles at every moment (1,000 times a second), the computer works out:
- where the sensor is in space,
- how fast it's spinning (that's the **gyro**),
- how hard it's being pushed, including gravity (that's the **accelerometer**).

This step is pure math, the same physics a real sensor would feel.

## Layer 4: make the sensor realistic and imperfect (`corrupt`)
Real sensors aren't perfect, so we add:
- a **shock** at ball contact, 15 to 35 times gravity,
- **noise and drift**, small random errors,
- **maxing out**: readings above 16 g get cut off,
- **compass drift**: the sensor slowly loses track of which way it's facing,
- **Bluetooth drops**: readings lost in short bursts.

## Putting it together
**12 players × 2 practice sessions × 30 forehands = 720 forehands**, about 47 minutes of simulated tennis. Every player has a fixed random "seed", so running the code again rebuilds exactly the same 12 players.

These numbers are *plausible* guesses, not measured from real players. That's fine for testing the method, but it's why the results are best-case.
