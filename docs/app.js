"use strict";
(function () {
  // Arena is not part of a run. Its quests hand you a fixed set of five weapons,
  // so there is no combo to put at stake — honouring them would mean granting an
  // attempt per set, which is a different game. They are filtered out of the
  // pool rather than made inert, so they never appear in the route at all.
  // Prowler quests are out for the same reason the Prowler weapon is: you hunt
  // them as a Palico, so none of the 84 weapon/style combos is at stake on one.
  // Arena is out because its five fixed sets are not yours either.
  const QUESTS = (window.MHGU_QUESTS || []).filter(q => q.t !== "Arena" && !q.p);
  const $ = (id) => document.getElementById(id);
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ── Static config (carried over from the Randomizer) ─────────────────────
  const WEAPONS = ["Great Sword","Long Sword","Sword & Shield","Dual Blades",
    "Hammer","Hunting Horn","Lance","Gunlance","Switch Axe","Charge Blade",
    "Insect Glaive","Light Bowgun","Heavy Bowgun","Bow"];

  const WEAPON_COLORS = {
    "Great Sword":"#ff505b","Long Sword":"#9beaf1","Sword & Shield":"#dfd65f",
    "Dual Blades":"#6ac083","Hammer":"#c3a3d2","Hunting Horn":"#f89a64",
    "Lance":"#9fbcff","Gunlance":"#f4baf5","Switch Axe":"#aaaaaa",
    "Charge Blade":"#fc5800","Insect Glaive":"#f5f5f5","Light Bowgun":"#acd56b",
    "Heavy Bowgun":"#f8899c","Bow":"#55edc4",
  };

  const STYLES = ["Guild","Striker","Adept","Aerial","Valor","Alchemy"];
  // Corner tags on the board. Three styles begin with A, so those take two
  // letters and the rest take one — the shortest set that stays unambiguous.
  const STYLE_TAG = { Guild: "G", Striker: "S", Adept: "Ad",
                      Aerial: "Ae", Valor: "V", Alchemy: "Al" };

  const WEAPON_ABBREV = {
    "Great Sword":"GS","Long Sword":"LS","Sword & Shield":"SnS","Dual Blades":"DB",
    "Hammer":"Hammer","Hunting Horn":"HH","Lance":"Lance","Gunlance":"GL",
    "Switch Axe":"SA","Charge Blade":"CB","Insect Glaive":"IG",
    "Light Bowgun":"LBG","Heavy Bowgun":"HBG","Bow":"Bow",
  };

  // Prowler is not part of a run. It was the one weapon whose slots were biases
  // rather than styles — 8 against everything else's 6 — which is why the board
  // needed a second grid and why a cap of 6 retired it two short of the pool.
  // 14 x 6 = 84.
  const ALL_WEAPONS = WEAPONS;
  const stylesFor = () => STYLES;
  const TOTAL_COMBOS = WEAPONS.length * STYLES.length;

  // ── Icon path helpers ────────────────────────────────────────────────────
  const FALLBACK_ICON = "assets/MonsterIcons/MHGU-Question_Mark_Icon.webp";
  const monsterIcon = (name) => name
    ? "assets/MonsterIcons/MHGU-" + name.replace(/ /g, "_") + "_Icon.webp"
    : FALLBACK_ICON;
  const weaponIcon = (w) => "assets/WeaponIcons/icon_" +
    w.toLowerCase().replace(/ & /g, "_and_").replace(/ /g, "_") + "_tinted.png";
  // Training Codex — stands in for a padlock on anything the run has locked.
  const LOCK_ICON = '<img class="lock-icon" src="assets/ItemIcons/MH4G-Book_Icon_Red.webp" alt="Locked">';
  const comboIcon = (w) => weaponIcon(w);

  // ── State ────────────────────────────────────────────────────────────────
  // cfg outlives individual runs, so starting a new one doesn't mean re-ticking
  // every box. run is wiped by Start Run.
  // Both locks default on: locked is the 1x reference run, unlocking is the
  // discount. See LEVERS.
  const DEFAULT_CFG = {
    kill: "both",                        // "both" | "cart" | "fail" | "streak"
    assign: "roll",                      // "roll" | "pick"
    loadout: "hold",                     // "hold" | "cycle" | "rotate"
    // Convenience only, and deliberately absent from LEVERS: whether the app
    // rolls for you the moment a combo is needed, or waits for the button.
    // It changes how many clicks a run costs, never what the run is worth.
    autoRoll: false,
    lockQuest: true,
    // The Insurance skill: one more cart before the quest is lost. It lives in
    // cfg only so it is remembered between hunts and runs — it is NOT a rule, is
    // not frozen while a run is on, and has no entry in LEVERS. See cartLimit.
    insurance: false,
    stylesPerWeapon: 3,                  // 1-6; styles a weapon may lose before it retires
    reviveEnabled: false, reviveOnce: true,
    reviveCap: 5,                        // buy-backs allowed per run; see LEVERS.reviveCap
    revivePrice: 10000,                  // zenny for the FIRST buy-back; it doubles
    rerollEnabled: false,
    rerollPrice: 5000,                   // zenny for the FIRST reroll; it doubles
  };
  let cfg = Object.assign({}, DEFAULT_CFG);

  // ── Difficulty ───────────────────────────────────────────────────────────
  // Every lever is a RATIO and they multiply. The reference run — carts and
  // quest failures, 3 styles, hold until it falls, quest lock on, no revives or
  // rerolls — is exactly 1.00, which also means it earns each quest's real
  // in-game zenny untouched.
  //
  // Each option carries two numbers, and the gap between them is the whole
  // reason this table exists:
  //
  //   effect  what the option does to your FINAL SCORE. This is the honest
  //           number, measured over thousands of simulated runs, and it is what
  //           the XS..XL badge and the difficulty rating are built from.
  //   factor  what the maths actually multiplies by to deliver that effect.
  //
  // They differ because a harder setting also makes the run SHORTER, so it banks
  // fewer clears. One style per weapon needs an internal x4.48 to land on a
  // x1.60 score, because 15 combos buy far fewer hunts than 45. The old additive
  // scheme showed that 4.48 to the player as a promise, which is precisely why
  // it kept lying — you cannot have one displayed number be both the per-clear
  // rate and the final-score ratio.
  //
  // Solved by fixed point: factor = effect / measured relative length, iterated
  // until stable. Re-solve with scratch sim-multiplicative.js if you retune.
  // Re-solved for the 14-weapon roster when Prowler was removed: every ceiling
  // scaled by exactly 14/15, since Prowler contributed min(cap, 8) and for caps
  // 1-6 that is just cap. Uniform scaling, so the ratios barely moved — the
  // largest shift was the styles cap at ~5%.
  //
  //                       factor  effect
  const LEVERS = {
    kill: {
      both:   [1.000, 1.00],   // a cart OR a failure takes it — nothing forgiven
      cart:   [0.711, 0.75],   // carts only; you can lose a quest and keep it
      fail:   [0.366, 0.50],   // failures only; carting to a clear costs nothing
      streak: [0.246, 0.38],   // the first failure is forgiven
    },
    // The styles cap swings hardest because it decides how much of the board you
    // ever get to spend. Its effects carry ~17% on top of the honest pool ratio,
    // so restriction is high risk / high reward rather than merely break-even.
    cap: {
      1: [4.717, 1.60], 2: [1.944, 1.35], 3: [1.000, 1.00],
      4: [0.737, 0.85], 5: [0.578, 0.72], 6: [0.459, 0.60],
    },
    // assign and loadout are measured now, not judged. sim-player.js gives each
    // player a CART CHANCE per combo — without that there is no such thing as a
    // good combo, so there was nothing for hold to protect or Hunter's choice to
    // choose, and both sat in LEVER PLACEHOLDER on judgement alone.
    //
    // Cart chance is the only primitive in that model. A hunt runs until you
    // clear, cart out three times, or fail some other way, so the clear rate is
    // (1 - q^3)(1 - t) per combo rather than a number anyone asserts — which is
    // what finally let the kill conditions be solved against how carting really
    // works. Skill is how MANY combos you are comfortable on (0 of 42 for a weak
    // generalist, 30 for a strong specialist); breadth is how unevenly that
    // comfort is spread.
    //
    // Two results shape the table below.
    //
    // Hunter's choice carries the whole effect. Under it all four loadout rules
    // measure IDENTICAL, because picking your best combo and holding your best
    // combo are the same thing. So `pick` is priced off the roll/pick gap and
    // the loadout weights are read off the roll rows only; letting both claim it
    // was double-counting, and paid 0.85 x 0.85 = 0.72 for a 0.93 effect.
    //
    // The loadout rule barely matters. Across 3 kill conditions x 3 skill
    // profiles x 4 swap-play styles the whole group spans 1.00 to 1.04. Fifty
    // hunts spread over ~40 combos at 1.7 hunts each is simply not enough
    // exposure for which rule governs your combo to move the outcome. If that
    // group should be a real difficulty lever, the fix is a bigger difference
    // between the RULES, not a bigger number here.
    assign:  { roll: [1, 1], pick: [0.835, 0.93] },
    loadout: { hold: [1, 1], cycle: [1.107, 1.04], rotate: [1.097, 1.03] },
    quest:   { on: [1, 1], off: [0.850, 0.85] },

    reviveOn:    [0.775, 0.82],   // a safety net at all
    reviveOnce:  [1.060, 1.06],   // ...but one each, so some of it back
    // Costs double now (see reviveCost), which makes the price self-limiting:
    // a dearer price just means fewer buy-backs, so total spend barely moves
    // across the ladder. That is why these are small — they only have to price
    // the residual, not the whole mechanic.
    revivePrice: { 5000: [0.94, 0.94], 10000: [1, 1], 20000: [1.03, 1.03], 30000: [1.05, 1.05] },
    reviveCap:   { 1: [1.05, 1.05], 3: [1.02, 1.02], 5: [1, 1], 10: [0.97, 0.97], 20: [0.94, 0.94] },
    rerollOn:    [0.860, 0.86],
    rerollPrice: { 2500: [0.96, 0.96], 5000: [1, 1], 10000: [1.02, 1.02], 20000: [1.04, 1.04] },
  };
  // LEVER PLACEHOLDER — assign, loadout, quest and rerollOn cannot be measured.
  // The simulator treats every combo as equally winnable (a deliberate design
  // call), so a model where combos are interchangeable can say nothing about a
  // rule governing WHICH combo you hold. Those four carry factor === effect.
  //
  // `quest` joined this list when "same quest failed twice" was retired, which
  // had been its only measurable effect — the forced retry was the sole reason
  // that rule ever fired. Against every remaining kill condition the degeneracy
  // audit puts lock-on at KS 0.008..0.016 from lock-off: indistinguishable.
  //
  // That is the model being blind, not the lever being dead. The lock exists so
  // you cannot dodge a difficult quest you chose and lost, and every quest in
  // the simulator is equally winnable — so there is no such thing as a difficult
  // quest to dodge, and nothing for the lock to prevent.
  //
  // Do not go looking for a net figure to replace 0.85. These levers push in
  // BOTH directions at once and for different reasons — the retry is harder
  // because that quest already beat you, and easier because you have now seen
  // the fight and can prepare for it. Sweeping the retry win rate from 0.50 to
  // 0.90 duly moves the lock between 0.84x and 1.08x, straddling 1.00: the net
  // is whatever you assumed going in. So the four placeholders are not priced on
  // outcome at all. They pay you for ACCEPTING A RESTRICTION, and what they are
  // worth is what you gave up, which is a design decision and not a measurement.

  // Walk the chosen options once; i picks factor (0) or effect (1).
  const legs = (c, i) => {
    const L = LEVERS, out = [
      (L.kill[c.kill] || [1, 1])[i],
      (L.cap[c.stylesPerWeapon] || [1, 1])[i],
      (L.assign[c.assign] || [1, 1])[i],
      (L.loadout[c.loadout] || [1, 1])[i],
      (c.lockQuest ? L.quest.on : L.quest.off)[i],
    ];
    if (c.reviveEnabled) {
      out.push(L.reviveOn[i]);
      if (c.reviveOnce) out.push(L.reviveOnce[i]);
      out.push((L.revivePrice[c.revivePrice] || [1, 1])[i]);
      out.push((L.reviveCap[c.reviveCap] || [1, 1])[i]);
    }
    if (c.rerollEnabled) {
      out.push(L.rerollOn[i]);
      out.push((L.rerollPrice[c.rerollPrice] || [1, 1])[i]);
    }
    return out;
  };
  const product = (a) => a.reduce((p, x) => p * x, 1);

  // What earnings are multiplied by. Never displayed, never negative.
  const multiplier = (c) => Math.round(product(legs(c, 0)) * 1000) / 1000;
  // What the run is worth relative to the reference — the honest figure, and
  // the only one a player ever sees, as a rating.
  const difficulty = (c) => product(legs(c, 1));

  // A completed run is its clear limit, and finishing with combos still in hand
  // is the point — so surviving pays.
  //
  // Awarded as a share of what you earned, not a flat pot per combo. A flat pot
  // pays most to the loosest settings, which finish with 46 of 90 standing
  // simply because they had 90 and gentle rules; as a proportion, keeping 5 of
  // 15 scores exactly like keeping 15 of 45. Simulation also showed survival
  // tracks play quality at a fixed setting — 0/45 at a 55% win rate against
  // 16/45 at 95% — so it measures something real.
  //
  // At 1.0 a flawless run doubles and a wipe adds nothing.
  const SURVIVOR_BONUS = 1.0;

  // ── How difficulty reads ─────────────────────────────────────────────────
  // Bands are set from the real distribution across all 49,200 reachable
  // configurations: the median lands at 0.30 and 98% sit below the reference,
  // because the app has one lever that tightens a run and roughly ten that
  // loosen it. So the defaults are genuinely Hard, and that is not a display
  // artefact — adding more levers shaped like "hold until you clear" is what
  // would populate the top.
  //
  // Each band carries its payoff alongside it, deliberately in one array rather
  // than two: they are the same fact said twice — once as what the run costs you
  // and once as what it pays — so they must never be able to disagree. A player
  // reading "Very Hard" alone has been told the price and not the reward, which
  // is why a harder run needs to visibly say Extra Large next to it.
  //
  // Note the sizes are relative to the other settings, not to zero: a Normal run
  // rates around 0.55, so it earns rather less than the quests' face value. It is
  // "Medium" because it sits in the middle of what is reachable.
  // "Max" tops the bonus because Extra Large had stopped meaning anything at the
  // top: one style per weapon peaks at 1.664 and TWO styles still reaches 1.404,
  // so the two harshest caps read identically. 1.60 is not an arbitrary line —
  // it is exactly the weight of one style per weapon, and every other lever that
  // eases a run multiplies by less than 1. So Max means precisely "nothing is
  // softened anywhere": kill on carts and failures, one style, rolled combos,
  // quest lock on, no revives, no rerolls. Enable a safety net or unlock a single
  // quest and it drops back to Extra Large. Three of the 59,040 configurations
  // qualify (the loadout rule is free to vary — it spans 1.00 to 1.04).
  //
  // The rating moves with it — "Extreme" rather than a second Very Hard — because
  // the pairing is load-bearing: these two lines are the same fact said twice, and
  // a run that pays differently has to read differently.
  const RATINGS = [
    [1.60, "Extreme",   "Max"],
    [1.10, "Very Hard", "Extra Large"],
    [0.70, "Hard",      "Large"],
    [0.40, "Normal",    "Medium"],
    [0.20, "Easy",      "Small"],
    [0,    "Very Easy", "Extra Small"],
  ];
  // Epsilon for the same reason SIZE_STEPS needs one, and it matters more here:
  // the 1.60 boundary is a value a real configuration lands on exactly, so a
  // stray ulp from the product would silently cost someone the top band.
  const bandFor = (d) => RATINGS.find(([min]) => d >= min - 1e-9) || RATINGS[RATINGS.length - 1];
  const ratingFor = (d) => bandFor(d)[1];
  const bonusFor  = (d) => bandFor(d)[2];

  // A single option's size, as a shirt size rather than a number — the same
  // vocabulary as Attack Up (S/M/L). Built from `effect`, so it says what the
  // option really does rather than what the arithmetic needed.
  //
  // XXL was added here and then taken back out. It existed to separate the two
  // harshest kill conditions, which both sat past the 0.60 XL line (0.62 and
  // 0.74) and so read identically while the RATING, a product with no ceiling,
  // still moved a whole band between them. Retiring "same quest failed twice"
  // removed the collision instead, and the largest size left in the app is 0.62,
  // so an XXL tier could never fire. An unreachable band is worse than none.
  //
  // The underlying ceiling is still there if a harsher lever ever arrives: size
  // is the distance from 1, which on the costly side cannot exceed 1.00 however
  // brutal the option. The durable fix at that point is |ln(effect)| — the
  // natural metric where every lever is a ratio, and unbounded both ways — but
  // it re-bands 18 of the 34 badges, so it is not worth doing pre-emptively.
  const SIZE_STEPS = [[0.60, "XL"], [0.30, "L"], [0.15, "M"], [0.05, "S"]];
  function sizeOf(effect) {
    const away = Math.abs(effect - 1);
    // Epsilon because the boundaries ARE the table values: 1.15 - 1 comes out
    // as 0.1499999999999999 in binary floating point, which silently demoted
    // cycling from M to S while 0.85 landed on M correctly.
    const step = SIZE_STEPS.find(([min]) => away >= min - 1e-9);
    return (step ? step[1] : "XS");
  }
  // "+M" reads as a bonus, "−M" as a cost. A bare letter says neither.
  function badge(effect) {
    if (Math.abs(effect - 1) < 0.005) return "±0";
    return (effect > 1 ? "+" : "−") + sizeOf(effect);
  }

  // Invariant: having no safety net must beat having one, however dearly it is
  // priced. Checked rather than assumed — it depends on four separate numbers
  // and the last version of this broke when the cap weights were added.
  (function assertReviveNeverBeatsOff() {
    const base = { kill: "fail", assign: "roll", loadout: "hold", lockQuest: true,
                   stylesPerWeapon: 3, rerollEnabled: false, rerollPrice: 5000 };
    const off = difficulty(Object.assign({}, base, { reviveEnabled: false }));
    let best = -Infinity, at = "";
    for (const once of [true, false])
      for (const p of Object.keys(LEVERS.revivePrice))
        for (const k of Object.keys(LEVERS.reviveCap)) {
          const d = difficulty(Object.assign({}, base, { reviveEnabled: true,
            reviveOnce: once, revivePrice: +p, reviveCap: +k }));
          if (d > best) { best = d; at = `${once ? "once" : "repeat"} ${p}z cap ${k}`; }
        }
    if (best >= off) {
      console.warn(`Revive weights inverted: the best revive run (${at}) rates ` +
        `${best.toFixed(3)}, which is not below the ${off.toFixed(3)} for allowing ` +
        `none. Lower LEVERS.reviveOnce, or the dearest revivePrice / reviveCap.`);
    }
  })();

  // ── Revive economy ───────────────────────────────────────────────────────
  // Cost DOUBLES per buy-back and scales with the run's multiplier.
  //
  // Both halves are load-bearing. Flat linear pricing never stops anyone, so at
  // one style per weapon a player simply bought twenty extra combos for pocket
  // change and doubled their run — revives were worth +82% there while the
  // weights charged −0.52, and no single number could cover a swing that moved
  // 2.45x across settings. Doubling makes the player stop of their own accord
  // (5k, 10k, 20k, 40k, 80k — a rational hunter quits around the fifth), and
  // scaling by the multiplier stops a buy-back being nearly free exactly where
  // it is strongest, since earnings scale but a flat price does not.
  //
  // Together they pull the swing down to 1.16x, which a single factor CAN price.
  const costScale = () => Math.max(0.25, (run.mult || multiplier(cfg)));
  const stepCost = (price, used) =>
    Math.round(price * Math.pow(2, Math.max(0, used)) * costScale());
  const reviveCost = (used) => stepCost(cfg.revivePrice, used);

  const emptyRun = () => ({
    active: false, finished: false,
    startedAt: 0, endedAt: 0,
    deaths: [],            // {weapon, style, reason, quest, n, reviveCount}
    failStreak: 0,         // run-global; carts never touch it
    questsDone: {},        // "Type|Name" -> true once CLEARED; see clearedQuest()
    lockQuest: null,       // the quest you owe a retry on
    combo: null,           // the loadout for the hunt in progress
    quest: null,           // the quest for the hunt in progress
    attemptCarts: 0,
    // Where run.deaths and run.carts stood when this attempt began, so naming
    // the wrong quest can be taken back in full. Deaths are only ever appended,
    // which is what makes truncating back to a mark safe.
    attemptStart: { deaths: 0, carts: 0 },
    hunts: 0,              // resolved hunts; carts don't end one so don't count
    cleared: 0,            // successful hunts; this is what CLEAR_LIMIT bounds
    failed: 0, carts: 0, revives: 0, rerolls: 0,
    revived: {},           // comboKey -> times bought back (survives the death being removed)
    reviveLog: [],         // {weapon, style, cost} for the summary
    rerollLog: [],         // {weapon, style, cost}
    zennySpent: 0,         // paid out of score rather than materials
    earned: 0,             // zenny rewards of quests cleared, x the run's multiplier
    mult: 1,               // what earnings are multiplied by; snapshotted at Start Run
    diff: 1,               // what the run RATES as — the figure behind "Hard"
    maxLosses: 0,          // likewise — the rules unlock again once the run ends,
                           // so the summary can't ask cfg what the cap was
    cfg: null,             // the whole lever set, for the summary's Rules panel
  });
  let run = emptyRun();
  // The previous run, kept for its summary. Persisted, so it survives a reload.
  let prevRun = null;
  // Which page the content column is showing. null follows the run: the board
  // while one is going, the result once it ends. Set explicitly by the tabs.
  let view = null;

  // Derived index over run.deaths — O(1) lookups when building the pool.
  // Never persisted; rebuilt on load.
  let deadKeys = new Set();
  const rebuildDeadKeys = () => { deadKeys = new Set(run.deaths.map(d => comboKey(d.weapon, d.style))); };

  // How many buy-backs a whole run gets. This bound is not optional: without
  // it a run has no terminal state at all, because you can always pay for one
  // more combo. Simulation ran past 4,000 hunts even at 100,000z a revive —
  // ten times any sane run — where a cap of 5 lands at 1.04x the no-revive
  // score. Price alone cannot fix an unbounded loop.
  const reviveAllowance = () => cfg.reviveCap;

  // A fallen combo can be bought back while the run has allowance left, unless
  // the "once per combo" lever is on and it has already come back once.
  // run.revived survives the death entry being removed, which is what makes
  // that second check possible.
  const canRevive = (w, s) =>
    cfg.reviveEnabled && run.active && !run.finished && deadKeys.has(comboKey(w, s)) &&
    run.revives < reviveAllowance() &&
    !(cfg.reviveOnce && (run.revived[comboKey(w, s)] || 0) >= 1);

  // The only payment route: straight off the run's score. There is deliberately
  // no affordability gate, so a buy-back can take the total negative — and
  // since the multiplicative scheme cannot produce a negative multiplier, debt
  // is now the only way a run ends below zero.
  //
  // That is intended, not an oversight. Buying a combo back you cannot afford
  // means hunting your way out of the hole before the score means anything
  // again; you wanted the combo, you paid the price, now go earn it. Do NOT
  // add an affordability gate — it would quietly turn the hardest decision in
  // the app into one the player is never allowed to make.
  function settle(option) {
    run.earned -= option.total;
    run.zennySpent += option.total;
  }

  function doRevive(w, s, option) {
    const key = comboKey(w, s);
    if (!canRevive(w, s)) return;
    run.deaths = run.deaths.filter(d => comboKey(d.weapon, d.style) !== key);
    run.revived[key] = (run.revived[key] || 0) + 1;
    run.reviveLog.push({ weapon: w, style: s, cost: option.total });
    run.revives++;
    settle(option);
    rebuildDeadKeys();
    afterMutation();     // hands out the first combo if auto-roll is on
  }

  // Refuse the combo you were handed and draw another. The refused one is not
  // lost — it goes back in the pool — you have simply paid to not take it now.
  const canReroll = () => cfg.rerollEnabled && cfg.assign === "roll" &&
    run.active && !run.finished && !!run.combo &&
    isAlive(run.combo.weapon, run.combo.style) && legalCombos().length > 1;

  const rerollCost = (used) => stepCost(cfg.rerollPrice, used);

  function doReroll(option) {
    if (!canReroll()) return;
    const from = run.combo;
    // Draw a genuinely different combo rather than possibly the same one back.
    let next = null;
    for (let i = 0; i < 50 && !next; i++) {
      const c = rollCombo();
      if (c && comboKey(c.weapon, c.style) !== comboKey(from.weapon, from.style)) next = c;
    }
    if (!next) return;
    run.rerollLog.push({ weapon: from.weapon, style: from.style, cost: option.total });
    run.rerolls++;
    run.combo = next;
    settle(option);
    save(); renderAll();
  }

  // ── Pool ─────────────────────────────────────────────────────────────────
  // Typographic minus so a negative total matches the multiplier's formatting.
  const zenny = (n) => n.toLocaleString("en-US").replace("-", "−") + "z";
  // A long run can earn seven figures, which will not fit a summary tile at
  // full width. Abbreviate past a million; the tile keeps the exact figure in
  // its tooltip.
  const zennyShort = (n) => n >= 1e6
    ? (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + "Mz"
    : zenny(n);
  // Step the type down as the string grows so nothing overflows its tile.
  const fitClass = (s) => s.length <= 4 ? "" : s.length <= 6 ? " fit-s"
    : s.length <= 8 ? " fit-xs" : " fit-xxs";
  const comboKey = (w, s) => w + "|" + s;
  const questKey = (q) => q.t + "|" + q.n;
  const isArena = (q) => !!q && q.t === "Arena";
  // A quest is spent once you CLEAR it, and only then. Consuming it on any
  // attempt would break the quest lock outright, since it forces a retry of a
  // quest that would no longer exist. Failing leaves it on the board, which is
  // also the natural reading — you haven't done it yet.
  //
  // The rule exists because farming one quest fifty times was worth 5.17x
  // playing whatever you fancied, which was a bigger score swing than any
  // difficulty lever. It costs an ordinary player almost nothing: fifty draws
  // from 1,136 quests collide about once a run. Arena is exempt for the same
  // reason it scores nothing — it is outside the economy entirely.
  const questDone = (q) => !isArena(q) && !!run.questsDone[questKey(q)];
  const isAlive = (w, s) => !deadKeys.has(comboKey(w, s));

  // A weapon only gets so many styles before the whole thing retires, taking
  // its surviving styles out of the pool with it. Counted from run.deaths, so a
  // revive (which removes a death) can bring a retired weapon back.
  const stylesLost = (w) => run.deaths.reduce((n, d) => n + (d.weapon === w ? 1 : 0), 0);
  // Judged against the cap the RUN started with, not the live one. Reading live
  // cfg meant a finished run could be brought back to life from the sidebar:
  // the rules unlock the moment a run ends, and raising the styles cap
  // un-retired every weapon, so legalCombos() went non-empty and runOver() --
  // which is derived rather than latched -- flipped back to false. The run
  // resumed with all its old deaths still on the board, which is exactly what
  // it looked like: fallen combos still fallen, retired ones back in play.
  //
  // Derived rather than latched is deliberate and stays that way: a revive
  // removes a death and SHOULD be able to reopen a run. What must not reopen it
  // is editing the rules afterwards.
  const runCap = () => !run.active ? cfg.stylesPerWeapon
    : ((run.cfg && run.cfg.stylesPerWeapon) || capForCeiling(runMax()) || cfg.stylesPerWeapon);
  const isRetired  = (w) => stylesLost(w) >= runCap();

  // ── Carting out ──────────────────────────────────────────────────────────
  // Three carts loses the quest, which is the game's rule rather than one of
  // ours, so it is not a lever and does not appear in LEVERS. A handful of
  // quests allow only one: `f` on the quest record, carried over from the
  // Randomizer's OneFaint flag — the top Special Permit hunt for each of the 18
  // Deviants, at G2, G3 or G4 depending on the monster.
  //
  // Insurance is NOT a lever either, and that is why it lives beside the outcome
  // buttons rather than in the sidebar. It is a skill on the set you are wearing,
  // so it can differ hunt to hunt — it describes THIS hunt the way the cart count
  // does, not the rules of the run. So it is not frozen while a run is on, it
  // carries no badge, and it is absent from LEVERS.
  //
  // (What it would be worth if it were a lever is in scratchpad/sim-insurance.js:
  // 1.02x to 1.06x of run length, and dependent on the kill condition, because
  // under `cart` or `both` the combo is already dead from the first cart and the
  // extra one buys the quest but never the weapon.)
  const CART_LIMIT = 3, ONE_FAINT_LIMIT = 1;
  const cartLimit = (q) =>
    ((q && q.f) ? ONE_FAINT_LIMIT : CART_LIMIT) + (cfg.insurance ? 1 : 0);

  const legalStyles  = (w) => isRetired(w) ? [] : stylesFor(w).filter(s => isAlive(w, s));
  const legalWeapons = () => ALL_WEAPONS.filter(w => legalStyles(w).length > 0);
  function legalCombos() {
    const out = [];
    legalWeapons().forEach(w => legalStyles(w).forEach(s => out.push({ weapon: w, style: s })));
    return out;
  }
  // Longest a run can possibly last: every weapon spends its full allowance.
  const ceilingFor = (cap) => ALL_WEAPONS.reduce(
    (n, w) => n + Math.min(cap, stylesFor(w).length), 0);
  const maxLosses = () => ceilingFor(cfg.stylesPerWeapon);
  // The run's own ceiling, snapshotted at Start Run. Falls back to the live
  // figure for runs saved before it was recorded.
  const runMax = () => run.maxLosses || maxLosses();
  // Each cap yields a distinct ceiling (15/30/45/60/75/90), so a run that kept
  // no rules snapshot can still have this one rule read back off its ceiling.
  const capForCeiling = (ceiling) => [1, 2, 3, 4, 5, 6].find(c => ceilingFor(c) === ceiling);

  // Weapon-first: uniform among surviving weapons, then uniform among that
  // weapon's surviving styles. Preserves the Randomizer's distribution rather
  // than flattening across all 92 (which would shrink a weapon's share as its
  // styles die).
  function rollCombo() {
    const weapons = legalWeapons();
    if (!weapons.length) return null;
    const weapon = pick(weapons);
    const styles = legalStyles(weapon);
    if (!styles.length) return null;   // unreachable by construction
    return { weapon, style: pick(styles) };
  }

  // Run-over is derived, not latched, so it recomputes after every death and
  // after any revive.
  // A run closes on exhaustion, on the clear limit, or when you end it manually.
  //
  // The limit counts SUCCESSFUL hunts, not attempts, and is fixed rather than
  // chosen. Both of those are load-bearing.
  //
  // It exists to stop the gentle kill conditions winning on sheer length —
  // unbounded, the gentlest condition ran a median 1,384 hunts against 102 for
  // the default and inverted the entire difficulty ordering. So it cannot be a
  // scored lever (it only binds when a run would otherwise outlast it, so a
  // short configuration could take the tightest limit, never reach it, and
  // collect the bonus for free) and it cannot be opted out of.
  //
  // Counting clears rather than attempts is what keeps the ordering honest. A
  // failure never positively contributes, so it must not extend the clock in a
  // way that benefits you either. Under an attempt cap it did: the gentle
  // conditions spent their whole allowance earning while the harsh ones wiped
  // early and stopped, and combined with the survivor bonus that put "two in a
  // row" ABOVE the stricter "quest failed" at a 65% win rate. Counting clears
  // hands every run the same 50 payouts unless it wipes first, so the
  // multiplier is what separates them.
  const CLEAR_LIMIT = 50;
  const clearsUsed = () => run.cleared || 0;

  // What you finished holding, as a share of what this run could have lost.
  const survivorRate = () => {
    const ceiling = runMax();
    if (!ceiling) return 0;
    return Math.max(0, Math.min(1, (ceiling - run.deaths.length) / ceiling));
  };
  // Only ever a bonus. Scaling a negative total by survival would punish
  // keeping combos, which is the opposite of the intent.
  const survivorBonus = () =>
    run.earned > 0 ? Math.round(run.earned * survivorRate() * SURVIVOR_BONUS) : 0;
  const finalScore = () => run.earned + survivorBonus();
  const clearCapHit = () => clearsUsed() >= CLEAR_LIMIT;
  const runOver = () => run.active &&
    (run.finished || clearCapHit() || legalCombos().length === 0);

  // Which run the result page is showing: the current one once it is over,
  // otherwise the one before it. So a finished run's result stays reachable
  // after the next one starts.
  const summaryRun = () => runOver() ? run : (prevRun && prevRun.active ? prevRun : null);
  // Tabs only earn their space when both pages have something on them.
  const canSwitch = () => !!summaryRun() && (run.active || !!prevRun);
  const shownView = () => {
    if (view === "summary" && summaryRun()) return "summary";
    if (view === "board") return "board";
    return runOver() ? "summary" : "board";     // null follows the run
  };

  // ── Persistence ──────────────────────────────────────────────────────────
  const STORE_KEY = "mhgu-zenny-gauntlet";

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, cfg, run, prevRun }));
    } catch (e) {}
  }
  // lockLoadout was a boolean before cycling existed. Anything saved or exported
  // under the old scheme maps straight across; a run's own snapshot is migrated
  // too, so a finished run still reports the rules it was actually played under.
  // Keyed off whether the SOURCE is already in the new format, not off whether
  // the target holds a valid value — cfg is seeded from DEFAULT_CFG, so it
  // always holds "hold" by the time this runs, and testing the target would
  // silently skip every migration.
  function migrateLoadout(target, source) {
    if (source && typeof source.loadout === "string") return;
    // lockLoadout:false used to mean "swap whenever you like", which became
    // `free` and is now retired. Both land on hold, which is what free
    // measured as anyway.
    target.loadout = "hold";
  }
  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) {}
    // Only keys DEFAULT_CFG still knows about, so settings that were replaced
    // (the old per-condition kill booleans) don't linger in storage.
    if (d && d.cfg) {
      cfg = Object.assign({}, DEFAULT_CFG);
      Object.keys(DEFAULT_CFG).forEach(k => { if (k in d.cfg) cfg[k] = d.cfg[k]; });
      // "Same quest failed twice" is retired (see RETIRED_LABELS). It maps to
      // two-in-a-row rather than to the default, because that is what it was:
      // measured over 6,000 runs the two produced identical death counts at
      // every percentile. Falling through to the guard below would have thrown
      // anyone on the gentlest condition onto the harshest one.
      if (cfg.kill === "twice") cfg.kill = "streak";
      // "May swap once per quest" is retired. It maps to hold, which is what
      // it measured as -- implied 1.00, identical to holding -- so nobody who
      // had it selected is moved to a different difficulty by losing it.
      if (cfg.loadout === "free") cfg.loadout = "hold";
      if (!LEVERS.kill[cfg.kill]) cfg.kill = DEFAULT_CFG.kill;
      migrateLoadout(cfg, d.cfg);
    }
    if (d && d.run) {
      run = Object.assign(emptyRun(), d.run);
      if (run.cfg) migrateLoadout(run.cfg, run.cfg);
    }
    if (d && d.prevRun) {
      prevRun = Object.assign(emptyRun(), d.prevRun);
      if (prevRun.cfg) migrateLoadout(prevRun.cfg, prevRun.cfg);
    }
    rebuildDeadKeys();
    // A run saved before run.cfg existed has no rules snapshot. If it is still
    // going, the live cfg IS its snapshot — the rules are frozen for the
    // duration of a run, so they cannot have diverged — and adopting it now
    // means the panel is correct for the rest of the run. A run that already
    // ENDED gets nothing: the rules unlocked when it finished, so the live cfg
    // is no evidence of what was played. renderSummary says so rather than
    // reporting numbers it cannot stand behind.
    if (run.active && !run.cfg && !runOver()) {
      run.cfg = Object.assign({}, cfg);
      save();
    }
    // A run that was already over when it was saved has never been through
    // afterMutation since, so stamp it now. Without this the latch only applies
    // to runs that end while the tab is open.
    const wasFinished = run.finished;
    settleRunEnd();
    if (run.finished !== wasFinished) save();
  }

  // ── Config <-> DOM ───────────────────────────────────────────────────────
  const CFG_BOXES = {
    lockQuest: "l_quest",
    reviveEnabled: "r_enabled", reviveOnce: "r_once",
    rerollEnabled: "rr_enabled",
  };
  // Radio groups: cfg key -> value -> element id.
  const CFG_RADIOS = {
    kill:   { both: "k_both", cart: "k_cart", fail: "k_fail", streak: "k_streak" },
    stylesPerWeapon: { 1: "c_1", 2: "c_2", 3: "c_3", 4: "c_4", 5: "c_5", 6: "c_6" },
    revivePrice: { 5000: "p_5000", 10000: "p_10000", 20000: "p_20000", 30000: "p_30000" },
    reviveCap: { 1: "rc_1", 3: "rc_3", 5: "rc_5", 10: "rc_10", 20: "rc_20" },
    rerollPrice: { 2500: "rp_2500", 5000: "rp_5000", 10000: "rp_10000", 20000: "rp_20000" },
    assign: { roll: "a_roll", pick: "a_pick" },
    loadout: { hold: "ld_hold", cycle: "ld_cycle", rotate: "ld_rotate" },
  };

  // How a radio's chosen value reads, taken from the sidebar label itself rather
  // than a second table — the summary's Rules panel then can't drift from the
  // control it is reporting on. The difficulty badge is dropped; the panel is a
  // record of what was played, and the weights are already on the tiles.
  // A finished run keeps the rules it was played under, so a value whose control
  // no longer exists still needs a name. Only the summary reads these; the live
  // config is migrated on load and can never hold one.
  const RETIRED_LABELS = { twice: "Same quest failed twice" };
  function ruleLabel(key, value) {
    const id = (CFG_RADIOS[key] || {})[value];
    const input = id && $(id);
    if (!input || !input.closest("label")) return RETIRED_LABELS[value] || String(value);
    const label = input.closest("label").cloneNode(true);
    const w = label.querySelector(".w");
    if (w) w.remove();
    return label.textContent.trim();
  }

  // Every badge is painted from LEVERS, so the sidebar cannot drift from the
  // table the way hardcoded numbers did. Shirt sizes rather than values: the
  // same vocabulary as Attack Up (S/M/L), and unlike a number a letter is free
  // to report the option's MEASURED effect rather than the arithmetic behind it.
  // The cap labels used to spell out their own counts and went stale the moment
  // the roster changed — they still read "15 combos" after Prowler left. The
  // count is one readout for the chosen cap now rather than six repeated on the
  // options, and it comes from the same function the ceiling uses, so it cannot
  // disagree with the board it is describing.
  function paintCapTotal() {
    const out = $("capTotal");
    if (out) out.textContent = ceilingFor(cfg.stylesPerWeapon);
  }

  function paintBadges() {
    const L = LEVERS;
    const set = (id, effect, suffix) => {
      const el = $(id);
      if (!el) return;
      const w = el.closest("label") && el.closest("label").querySelector(".w");
      if (w) w.textContent = badge(effect) + (suffix || "");
    };
    Object.entries(CFG_RADIOS.kill).forEach(([v, id]) => set(id, L.kill[v][1]));
    Object.entries(CFG_RADIOS.stylesPerWeapon).forEach(([v, id]) => set(id, L.cap[v][1]));
    Object.entries(CFG_RADIOS.assign).forEach(([v, id]) => set(id, L.assign[v][1]));
    Object.entries(CFG_RADIOS.loadout).forEach(([v, id]) => set(id, L.loadout[v][1]));
    Object.entries(CFG_RADIOS.reviveCap).forEach(([v, id]) => set(id, L.reviveCap[v][1]));
    Object.entries(CFG_RADIOS.revivePrice).forEach(([v, id]) => set(id, L.revivePrice[v][1]));
    Object.entries(CFG_RADIOS.rerollPrice).forEach(([v, id]) => set(id, L.rerollPrice[v][1]));
    // No "if on"/"if off" qualifiers: paintBadgeState lights a badge exactly
    // when its modifier is in the multiplier, so the highlight already says
    // which state the number belongs to.
    set("l_quest", L.quest.off[1]);
    set("r_enabled", L.reviveOn[1]);
    set("r_once", L.reviveOnce[1]);
    set("rr_enabled", L.rerollOn[1]);
  }

  // Which badges are actually contributing right now. Asked of cfg rather than
  // of the DOM, because "is this option selected" is not the same question as
  // "is this option doing anything" — a revive price is selected at all times
  // and does nothing at all while revives are off. Structural CSS could only
  // ever answer the first, which is why the price and cap badges used to light
  // up on a run with no revives in it.
  //
  // This mirrors legs() deliberately: if a lever is added there and not here,
  // the sidebar will misreport it.
  function activeBadges() {
    const on = new Set([
      CFG_RADIOS.kill[cfg.kill],
      CFG_RADIOS.stylesPerWeapon[cfg.stylesPerWeapon],
      CFG_RADIOS.assign[cfg.assign],
      CFG_RADIOS.loadout[cfg.loadout],
    ]);
    // The quest lock is the one rule that is ON by default: unticking it is
    // what costs you, so that is when its badge belongs.
    if (!cfg.lockQuest) on.add("l_quest");
    if (cfg.reviveEnabled) {
      on.add("r_enabled");
      if (cfg.reviveOnce) on.add("r_once");
      on.add(CFG_RADIOS.revivePrice[cfg.revivePrice]);
      on.add(CFG_RADIOS.reviveCap[cfg.reviveCap]);
    }
    if (cfg.rerollEnabled) {
      on.add("rr_enabled");
      on.add(CFG_RADIOS.rerollPrice[cfg.rerollPrice]);
    }
    return on;
  }
  function paintBadgeState() {
    const on = activeBadges();
    document.querySelectorAll(".chk").forEach(label => {
      const input = label.querySelector("input"), w = label.querySelector(".w");
      if (input && w) w.classList.toggle("on", on.has(input.id));
    });
  }

  function writeCfgToDom() {
    Object.entries(CFG_BOXES).forEach(([k, id]) => { $(id).checked = !!cfg[k]; });
    // Both of these live outside CFG_BOXES, and for opposite reasons: autoRoll is
    // a preference rather than a rule, and Insurance describes the hunt rather
    // than the run. CFG_BOXES is read back by readCfgFromDom, which bails out
    // while a run is on — right for rules, wrong for a box you must be able to
    // tick mid-run. So each keeps its own handler and its own line here.
    $("s_autoroll").checked = !!cfg.autoRoll;
    $("h_insurance").checked = !!cfg.insurance;
    // Object keys are strings, but some cfg values are numbers (stylesPerWeapon),
    // so compare as strings and convert back on the way in.
    Object.entries(CFG_RADIOS).forEach(([k, maping]) => {
      Object.entries(maping).forEach(([val, id]) => { $(id).checked = String(cfg[k]) === val; });
    });
    applyCfgLockState();
  }
  const RADIO_NUMERIC = { stylesPerWeapon: true, revivePrice: true, rerollPrice: true,
    reviveCap: true };
  function readCfgFromDom() {
    if (cfgLocked()) return;                    // settings are frozen for the run
    Object.entries(CFG_BOXES).forEach(([k, id]) => { cfg[k] = $(id).checked; });
    Object.entries(CFG_RADIOS).forEach(([k, maping]) => {
      const hit = Object.entries(maping).find(([, id]) => $(id).checked);
      if (hit) cfg[k] = RADIO_NUMERIC[k] ? +hit[0] : hit[0];
    });
    applyCfgLockState();
  }

  // The rules are fixed for the duration of a run — otherwise the difficulty
  // you picked means nothing, since any condition could be switched off the
  // moment it was about to cost you something.
  const cfgLocked = () => run.active && !runOver();

  const CFG_INPUTS = () => Object.values(CFG_BOXES).map($)
    .concat(Object.values(CFG_RADIOS).flatMap(m => Object.values(m).map($)));

  function applyCfgLockState() {
    const locked = cfgLocked();
    CFG_INPUTS().forEach(el => { el.disabled = locked; });
    // Frozen for the run like the rules are, and additionally off whenever there
    // is nothing to automate. It sits outside CFG_BOXES anyway: those are read
    // back by readCfgFromDom, which bails out while a run is on, so this keeps
    // its own handler and its own line in writeCfgToDom.
    $("s_autoroll").disabled = locked || cfg.assign !== "roll";
    if (!locked) syncDependentBoxes();
    $("cfgLockNote").classList.toggle("hidden", !locked);
  }
  // Sub-options only mean something when their parent is on.
  function syncDependentBoxes() {
    // Everything under Revive is meaningless until revives are switched on.
    const off = !cfg.reviveEnabled;
    $("r_once").disabled = off;
    Object.values(CFG_RADIOS.revivePrice).forEach(id => { $(id).disabled = off; });
    Object.values(CFG_RADIOS.reviveCap).forEach(id => { $(id).disabled = off; });
    // Reroll goes a step further than the revive sub-options: it is the PARENT
    // switch that comes off, because a reroll refuses the combo you were handed
    // and Hunter's choice hands you nothing to refuse. Cleared in cfg and not
    // merely greyed — a set-but-unusable flag would keep rerollOn's 0.86 in the
    // difficulty, discounting the rating for a mechanic the run cannot reach.
    // `na` rather than the disabled dimming, which is deliberately radios-only:
    // this is not a decision being frozen, it is an option that never applied.
    const noRoll = cfg.assign !== "roll";
    if (noRoll && cfg.rerollEnabled) { cfg.rerollEnabled = false; $("rr_enabled").checked = false; }
    $("rr_enabled").disabled = noRoll;
    $("rr_enabled").closest("label").classList.toggle("na", noRoll);
    const rrOff = !cfg.rerollEnabled;
    Object.values(CFG_RADIOS.rerollPrice).forEach(id => { $(id).disabled = rrOff; });
  }

  // ── Kill / revive ────────────────────────────────────────────────────────
  // Idempotent: several conditions firing on one failure record a single death,
  // tagged with the first matching reason.
  function kill(combo, reason) {
    const key = comboKey(combo.weapon, combo.style);
    if (deadKeys.has(key)) return false;
    deadKeys.add(key);
    const prior = run.deaths.filter(d => comboKey(d.weapon, d.style) === key).length;
    run.deaths.push({
      weapon: combo.weapon, style: combo.style, reason,
      quest: run.quest ? run.quest.n : "",
      n: run.deaths.length + 1, reviveCount: prior,
    });
    return true;
  }

  // ── The report handler ───────────────────────────────────────────────────
  function report(outcome) {
    if (!run.active || run.finished) return;
    if (!run.combo || !run.quest) return;

    const combo = run.combo;
    // Arena is filtered out of the pool, so this can only be true for a run
    // saved or exported before that change. Kept as a guard rather than deleted:
    // without it, restoring such a run would suddenly score a quest that was
    // played on the understanding it counted for nothing.
    const counts = !isArena(run.quest);

    let cartedOut = false;
    if (outcome === "cart") {
      run.carts++; run.attemptCarts++;
      if (counts && (cfg.kill === "cart" || cfg.kill === "both")) kill(combo, "Carted");
      // Carting out is the game's own failure condition, so the app applies it
      // rather than waiting to be told: at the limit the attempt resolves as a
      // failure and falls through to the path below. Below the limit it does NOT
      // end the attempt — Cleared and Failed both stay available.
      if (run.attemptCarts < cartLimit(run.quest)) { afterMutation(); return; }
      outcome = "fail";
      cartedOut = true;
    }

    // The quest lock is a single-retry obligation. Reaching any resolution on
    // the locked quest discharges it — win or lose, the retry was served, so
    // failing it again must NOT re-lock you or the debt could never be paid.
    // Only a failure on a quest you weren't already locked to owes a new one.
    const wasRetry = !!run.lockQuest && questKey(run.lockQuest) === questKey(run.quest);
    run.lockQuest = null;

    // One hunt = one resolution. Carting doesn't end the attempt, so it isn't
    // one; an Arena hunt still is, since it consumed real playing time.
    run.hunts = (run.hunts || 0) + 1;

    if (outcome === "clear") {
      run.cleared++;
      if (counts) {
        // Points only ever go up — a failure costs you a loadout, which is the
        // punishment. Arena pays nothing, same as it costs nothing.
        run.earned += Math.round((run.quest.r || 0) * run.mult);
        run.failStreak = 0;
        // Spent. Clearing is the only thing that takes a quest off the board.
        run.questsDone[questKey(run.quest)] = true;
      }
    } else {                                        // "fail"
      run.failed++;
      if (counts) {
        run.failStreak++;                           // before the streak check
        // "Carted out" rather than "Quest failed" when the carts ended it, so the
        // fallen list says what actually happened. Under `cart` or `both` the
        // combo already died on the first cart and kill() is idempotent, so this
        // only ever names the death under `fail`.
        const reason = cartedOut ? "Carted out" : "Quest failed";
        if      (cfg.kill === "fail" || cfg.kill === "both")   kill(combo, reason);
        else if (cfg.kill === "streak" && run.failStreak >= 2) kill(combo, "Two failures in a row");

        if (cfg.lockQuest && !wasRetry) run.lockQuest = run.quest;
      }
    }

    // Roll over into the next hunt. The loadout lock means exactly one thing:
    // you keep the combo until it dies — through clears as well as failures.
    run.attemptCarts = 0;
    run.attemptStart = { deaths: run.deaths.length, carts: run.carts };
    // hold   — keep it until it dies, through clears as well as failures
    // cycle  — a clear hands it in; a failure does not, so you can take the
    //          quest that beat you again with the same combo (which is what the
    //          quest lock is asking you to do)
    // rotate — every quest hands it in, win or lose. Harsher than cycle: cycle
    //          at least lets you keep a combo through the retry you are owed.
    //
    // There was a fourth, "may swap once per quest", and it is retired. It
    // measured at 1.00 — exactly hold — so it was never the easier option it
    // claimed to be, and a free choosable swap strictly dominated the paid
    // random reroll, making that lever worse whenever both were enabled.
    const keepCombo = cfg.loadout === "hold" ? true
                    : cfg.loadout === "cycle" ? outcome !== "clear"
                    : false;
    run.combo = (keepCombo && isAlive(combo.weapon, combo.style))
      ? { weapon: combo.weapon, style: combo.style } : null;
    run.quest = run.lockQuest || null;
    afterMutation();
  }

  // A run ends once and stays ended. runOver() is still derived, but the moment
  // it becomes true the result is written down, so nothing computed afterwards
  // can undo it — a run begins when Start Run is pressed and at no other time.
  // Latching also settles what a revive may do: it can save a run that is still
  // going, and cannot resurrect one that is not.
  function settleRunEnd() {
    if (!run.active || run.finished) return;
    if (clearCapHit() || legalCombos().length === 0) {
      run.finished = true;
      run.endedAt = Date.now();
    }
  }

  function afterMutation() {
    settleRunEnd();
    maybeAutoRoll();
    save();
    renderAll();
  }

  // Hand out a combo without waiting for the button. Only while the app is the
  // one rolling -- under Hunter's choice there is nothing to automate, the
  // choice is the point.
  //
  // Called from afterMutation rather than from a render, so state is never
  // mutated while drawing. It is naturally idempotent: it does nothing once
  // run.combo is set, and every path that clears run.combo runs through here.
  function maybeAutoRoll() {
    if (!cfg.autoRoll || cfg.assign !== "roll") return;
    if (!run.active || runOver() || run.combo) return;
    const c = rollCombo();
    if (c) run.combo = c;
  }

  // ── Run lifecycle ────────────────────────────────────────────────────────
  function startRun() {
    // The outgoing run is kept so its result stays reachable from the next one.
    // Only a run that actually happened is worth keeping.
    if (run.active && run.deaths.length + (run.hunts || 0) > 0) prevRun = run;
    view = null;
    run = emptyRun();
    run.active = true;
    run.startedAt = Date.now();
    run.mult = multiplier(cfg);
    run.diff = difficulty(cfg);      // the rating, snapshotted alongside it
    run.maxLosses = maxLosses();
    run.attemptStart = { deaths: 0, carts: 0 };
    run.cfg = Object.assign({}, cfg);
    rebuildDeadKeys();
    afterMutation();     // hands out the first combo if auto-roll is on
  }
  function endRun() {
    run.finished = true;
    run.endedAt = Date.now();
    save(); renderAll();
  }

  // ── Quest picker ─────────────────────────────────────────────────────────
  let searchResults = [];
  function renderQuestResults(term) {
    const box = $("questResults");
    // The input is disabled while a retry is owed, so this cannot normally be
    // reached — but the guard belongs on the list itself rather than on the one
    // control that happens to open it.
    if (run.lockQuest) { box.classList.add("hidden"); return; }
    const t = term.trim().toLowerCase();
    if (!t) { box.classList.add("hidden"); return; }
    // Cleared quests are gone for the run, so they are absent rather than
    // disabled — the search is for picking, and an unpickable row is noise.
    const hits = QUESTS.filter(q => q.n.toLowerCase().includes(t));
    const spent = hits.filter(questDone).length;
    searchResults = hits.filter(q => !questDone(q)).slice(0, 40);
    if (!searchResults.length) {
      box.innerHTML = spent
        ? `<p class="qr-none">${spent === 1 ? "That quest has" : "Those quests have"}` +
          ` already been cleared this run.</p>`
        : '<p class="qr-none">No quest matches that.</p>';
    } else {
      // Buttons rather than divs so the list is reachable by keyboard and
      // announced properly — it's the only way to set a quest.
      box.innerHTML = searchResults.map((q, i) =>
        `<button type="button" data-i="${i}">${escapeHtml(q.n)}` +
        `<span class="qr-type"> &middot; ${escapeHtml(q.t)}${q.m ? " &middot; " + escapeHtml(q.m) : ""}</span>` +
        // Flagged in the list rather than only after you have taken it: a
        // one-faint permit is a different proposition from the quest above it
        // at the same reward, and that has to be visible while choosing.
        (q.f ? `<span class="qr-faint" title="One faint only">1&#9760;</span>` : "") +
        `<span class="qr-worth">${zenny(q.r || 0)}</span></button>`
      ).join("");
    }
    box.classList.remove("hidden");
  }
  // Nothing is committed by naming a quest, so clearing it is not an undo of
  // anything -- it just puts the hunt back to needing one. The outcome buttons
  // already require run.quest, so they disable themselves and nothing can be
  // reported into the gap.
  // Everything logged against the named quest goes with it: the attempt's carts,
  // and any combo those carts killed. A cart under "cart" or "carts and quest
  // failures" takes the combo immediately, so clearing without this would leave
  // a death on the board caused by an attempt that no longer exists.
  function abandonAttempt() {
    const mark = run.attemptStart || { deaths: run.deaths.length, carts: run.carts };
    run.deaths.length = Math.min(run.deaths.length, mark.deaths);
    run.carts = mark.carts;
    run.attemptCarts = 0;
    rebuildDeadKeys();
  }

  function clearQuest() {
    if (run.lockQuest) return;
    abandonAttempt();
    run.quest = null;
    save(); renderAll();
  }

  function chooseQuest(q) {
    // Naming a different quest over an existing one abandons the old attempt
    // too, so it cannot matter whether you cleared first.
    if (run.quest) abandonAttempt();
    run.quest = q;
    $("questSearch").value = "";
    $("questResults").classList.add("hidden");
    save(); renderAll();
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function renderBoard() {
    const board = $("board");
    // Shown before a run as well as during one. With no deaths recorded yet the
    // pool functions already answer "all 92 alive", so the idle state is the
    // board rather than a page of prose describing it. Only the end-of-run
    // summary displaces it.
    if (shownView() !== "board") { board.classList.add("hidden"); return; }
    board.classList.remove("hidden");

    // A crosshair rather than one marked cell. Selecting a weapon lights its
    // ROW, selecting a style lights its COLUMN, and the two converge on the
    // combo. One cell in eighty-four is a hard thing to spot however it is
    // marked -- which is why every attempt at a single-cell marker read as
    // "off" -- but a lit row and a lit column are visible from anywhere on the
    // board, and the reading is free: the answer is wherever they cross.
    //
    // Reads the pickers while a choice is in progress, so under Hunter's
    // choice the crosshair assembles as you go: pick the weapon and the row
    // lights, pick the style and the column joins it.
    const cur = run.combo;
    const picking = !cur && !$("hlPick").classList.contains("hidden");
    const hlW = cur ? cur.weapon : (picking ? $("pickWeapon").value : null);
    const hlS = cur ? cur.style  : (picking ? $("pickStyle").value  : null);
    // The arms of the crosshair. Applied to every cell, alive or not, so the
    // line does not break where a combo has fallen.
    const isCurrent = (w, s) => cur && cur.weapon === w && cur.style === s;
    const cellClass = (w, s) => {
      if (!isAlive(w, s)) {
        return "cell dead" + (canRevive(w, s) ? " revivable" : "");
      }
      // Alive, but its weapon spent its style allowance — out of the pool
      // without ever having been lost. A different thing from fallen.
      if (isRetired(w)) return "cell retired";
      // Back from the dead — worth marking, it cost something.
      const back = (run.revived[comboKey(w, s)] || 0) > 0;
      return "cell alive" + (back ? " revived" : "") + (isCurrent(w, s) ? " current" : "");
    };
    // The row label doubles as the weapon's status. Retired and Selected are the
    // two states you cannot read off a single cell — retired is a property of the
    // whole weapon, and "which one am I on" means scanning 92 cells for an icon.
    // Saying it on the row answers both at the point you are already looking.
    const rowLabel = (w) => isRetired(w) ? "Retired"
      : (run.combo && run.combo.weapon === w) ? "Selected"
      : (WEAPON_ABBREV[w] || w);

    const cellTitle = (w, s) => canRevive(w, s)
      ? ` title="Buy back for ${zenny(reviveCost(run.revives))}"` : "";

    // No legend. Retired and Selected now say so on the row label, and the board
    // marks the rest by what sits in the slot rather than by colour, which the
    // help modal covers. A key nobody needs is just height the grid wanted.
    // EVERY item is placed explicitly. Auto-placement flows around items that
    // carry a fixed position, so adding the crosshair overlays below pushed the
    // auto-placed cells down a row and the arms landed one row out. Placing the
    // lot removes auto-placement from the picture entirely.
    let html = '<div class="board-grid">';
    html += '<div class="bh corner" style="grid-row:1;grid-column:1"></div>';
    STYLES.forEach((s, j) => {
      html += `<div class="bh${s === hlS ? ' col-on' : ''}" ` +
              `style="grid-row:1;grid-column:${j + 2}">${escapeHtml(s)}</div>`;
    });
    WEAPONS.forEach((w, i) => {
      // The text is wrapped so it can reserve the width of the widest label it
      // will ever hold — see .bl-t. Without that the column grows the moment
      // something is selected and the whole grid shifts under the cursor.
      html += `<div class="brow-label${w === hlW ? ' row-on' : ''}" ` +
              `style="color:${WEAPON_COLORS[w]};grid-row:${i + 2};grid-column:1">` +
              `<img src="${weaponIcon(w)}" alt="">` +
              `<span class="bl-t">${escapeHtml(rowLabel(w))}</span></div>`;
      STYLES.forEach((s, j) => {
        html += `<div class="${cellClass(w, s)}" style="--wc:${WEAPON_COLORS[w]};` +
                `--wi:url('${weaponIcon(w)}');grid-row:${i + 2};grid-column:${j + 2}"` +
                `${cellTitle(w, s)} data-w="${escapeHtml(w)}" data-s="${escapeHtml(s)}">` +
                `<span class="stag">${STYLE_TAG[s] || s}</span></div>`;
      });
    });

    // The crosshair is drawn as its own shapes laid over the grid rather than by
    // restyling the cells it passes through. Placing them as grid items means
    // the browser does the arithmetic: a band spanning every style column of one
    // weapon's row, another spanning every weapon row of one style column, and a
    // box on the square they share. They cover the 1px gaps too, so each reads
    // as one continuous rectangle instead of a run of separate outlines.
    //
    // Track maths: row 1 is the header strip and column 1 the row labels, so a
    // weapon at index i sits on grid row i + 2 and a style at index j on grid
    // column j + 2. End lines are spelled out rather than using -1, which only
    // reaches the end of the EXPLICIT grid -- with rows created implicitly it
    // collapsed the column band to a single row.
    const wi = WEAPONS.indexOf(hlW), si = STYLES.indexOf(hlS);
    const lastCol = STYLES.length + 2, lastRow = WEAPONS.length + 2;
    if (wi >= 0) html += `<div class="cross-row" style="grid-row:${wi + 2};grid-column:2/${lastCol}"></div>`;
    if (si >= 0) html += `<div class="cross-col" style="grid-column:${si + 2};grid-row:2/${lastRow}"></div>`;
    if (wi >= 0 && si >= 0)
      html += `<div class="cross-hit" style="grid-row:${wi + 2};grid-column:${si + 2}"></div>`;
    html += "</div>";

    board.innerHTML = html;
  }

  function renderStatus() {
    const strip = $("statusStrip");
    if (!run.active || runOver()) { strip.classList.add("hidden"); return; }
    strip.classList.remove("hidden");

    const lost = run.deaths.length;
    const alive = legalCombos().length;
    let html =
      `<span class="stat dead">Lost <b>${lost}/${runMax()}</b></span>` +
      `<span class="stat">Available <b>${alive}</b></span>` +
      `<span class="stat">Hunts <b>${run.hunts || 0}</b></span>` +
      `<span class="stat">Cleared <b>${clearsUsed()}/${CLEAR_LIMIT}</b></span>` +
      `<span class="stat">Failed <b>${run.failed}</b></span>` +
      `<span class="stat">Carts <b>${run.carts}</b></span>` +
      `<span class="stat earned">Earned <b>${zenny(run.earned)}</b></span>` +
      // No Difficulty here: the sidebar's box carries it, and it cannot change
      // mid-run anyway. The strip is for the numbers that move.
      (cfg.reviveEnabled
        ? `<span class="stat">Next revive <b>${zenny(reviveCost(run.revives))}</b></span>` : "");
    if (cfg.kill === "streak") html += `<span class="stat">Streak <b>${run.failStreak}</b></span>`;

    // No lock chips here. Both were saying something already said closer to where
    // it matters: the quest card carries the lock icon and "you owe this quest a
    // retry" (and hides the search box), and a held loadout is enforced by the
    // roll/pick controls themselves. The one case the combo chip covered alone —
    // a cart killing the combo mid-attempt — is in the outcome hint, which sits
    // beside the buttons you press next.
    strip.innerHTML = html;
  }


  function renderHuntBar() {
    const bar = $("huntBar");
    if (!run.active || runOver()) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");

    // The pickers are open only when there is nothing in hand. Every loadout
    // rule holds a live combo until the run takes it away, so a committed combo
    // is never yours to change -- the pickers would be a lie.
    const pickMode = cfg.assign === "pick" && !run.combo;

    $("hlPick").classList.toggle("hidden", !pickMode);
    $("hlRolled").classList.toggle("hidden", pickMode);
    // rollBtn belongs to the ROLL flow only.
    $("rollBtn").classList.toggle("hidden", cfg.assign === "pick");

    if (pickMode) {
      const wSel = $("pickWeapon"), sSel = $("pickStyle");
      // A cart can kill the held combo without ending the attempt, so the
      // current loadout may be dead. Show it as it is — rendering must never
      // reassign it, or the hunt silently continues on a different combo and
      // the failure report kills that one too.
      const held = run.combo;
      const heldDead = held && !isAlive(held.weapon, held.style);
      const weapons = legalWeapons();
      if (heldDead && !weapons.includes(held.weapon)) weapons.unshift(held.weapon);
      // With nothing committed, the selects are the only record of what you were
      // part-way through choosing, so a re-render must not throw it away.
      const draftW = !held && weapons.includes(wSel.value) ? wSel.value : null;
      const curW = draftW || (held && weapons.includes(held.weapon) ? held.weapon : weapons[0]);
      wSel.innerHTML = weapons.map(w =>
        `<option value="${escapeHtml(w)}"${w === curW ? " selected" : ""}>${escapeHtml(w)}</option>`).join("");

      const styles = !curW ? [] : legalStyles(curW).slice();
      if (heldDead && held.weapon === curW && !styles.includes(held.style)) styles.unshift(held.style);
      const draftS = !held && styles.includes(sSel.value) ? sSel.value : null;
      const curS = draftS || (held && styles.includes(held.style) ? held.style : styles[0]);
      sSel.innerHTML = styles.map(st =>
        `<option value="${escapeHtml(st)}"${st === curS ? " selected" : ""}>${escapeHtml(st)}</option>`).join("");

      // Deliberately does NOT seed run.combo. It used to, which meant Hunter's
      // Choice assigned you the first weapon in the list before you had touched
      // anything — and under hold or cycle that combo was immediately locked, so
      // the pickers vanished before they could be used. The selects now hold a
      // draft and nothing is committed until Confirm.
      // Nothing to swap to until the hunt is reported. Confirm goes with them:
      // it was left live beside frozen selects, so it neither did anything nor
      // looked like it wouldn't.
      const canCommit = !heldDead && !!curW && !!curS;
      wSel.disabled = sSel.disabled = !!heldDead;
      $("pickConfirm").disabled = !canCommit;
    } else {
      const c = run.combo;
      $("hlText").textContent = c
        ? (c.weapon + "  ·  " + c.style)
        : "—";
      const icon = $("hlIcon");
      if (c) { icon.src = comboIcon(c.weapon, c.style); icon.classList.remove("hidden"); }
      else icon.classList.add("hidden");
      // Blocked while a hunt is outstanding — otherwise the mode is opt-out per
      // roll and the locks mean nothing.
      $("rollBtn").disabled = !!run.combo;
      $("rollBtn").textContent = run.combo ? "Combo set" : "Roll Combo";
      const rr = canReroll();
      $("rerollBtn").classList.toggle("hidden", !rr);
      if (rr) $("rerollBtn").textContent = "Reroll — " + zenny(rerollCost(run.rerolls));
    }

    const q = run.quest;
    const qLocked = !!run.lockQuest;
    const chosen = $("questChosen");
    // Kept in the layout when empty rather than display:none — otherwise the
    // hunt bar jumped 90px to 119px the moment you named a quest.
    chosen.classList.toggle("empty", !q);
    chosen.classList.toggle("locked", qLocked);
    if (q) {
      // The lock marker is always rendered and merely hidden when it does not
      // apply, so engaging the lock cannot change the card's size. It used to be
      // a block-level note below the title, which added a whole line the moment
      // you failed a quest — the card grew exactly when you were reading it.
      chosen.innerHTML =
        escapeHtml(q.n) +
        (isArena(q)
          ? ' <span class="qc-arena">Arena &mdash; nothing at stake</span>'
          : ` <span class="qc-worth">${zenny(q.r || 0)}</span>`) +
        `<span class="qc-note${qLocked ? "" : " off"}">${LOCK_ICON} Retry Enforced</span>` +
        // Naming the wrong quest costs real score -- the reward is read straight
        // off it -- and searching again to replace it is not something the card
        // advertises. This says plainly that the choice is not yet binding.
        // Absent while the lock holds, because then it genuinely is.
        (qLocked ? "" : '<button type="button" class="qc-clear" ' +
          'title="Wrong quest? Clear it and choose again">&times;</button>');
    }
    // Disabled rather than hidden while the quest is locked: it stays visible so
    // you can see the control exists and is simply unavailable, it holds its own
    // space so the hunt bar doesn't resize, and the browser takes it out of the
    // tab order for free.
    $("questSearch").disabled = qLocked;
    $("questSearch").placeholder = qLocked
      ? "Retry enforced — finish this quest first"
      : "Search quests…";
    if (qLocked) $("questSearch").value = "";
    if (qLocked) $("questResults").classList.add("hidden");

    const ready = !!(run.combo && run.quest);
    $("oClear").disabled = !ready;
    $("oCart").disabled  = !ready;
    $("oFail").disabled  = !ready;

    let hint = "";
    if (!run.combo) hint = "Get a weapon/style first.";
    else if (!run.quest) hint = "Name the quest you're hunting.";
    else if (isArena(run.quest)) hint = "Arena quest — reporting here won't cost you anything.";
    else {
      // The count leads and is never displaced. It used to be an `else if` after
      // the fallen notice, which meant it vanished at exactly the moment it was
      // most needed: under `cart` or `both` the combo dies on the FIRST cart, so
      // the notice fired immediately and hid the tally for the whole rest of the
      // attempt — while the quest was still live and still counting toward the
      // limit that would end it. The two facts are independent, so both show.
      //
      // The limit itself is shown from the moment a quest is named rather than
      // once you have carted, since a one-faint quest is the thing you want to
      // know about BEFORE you take it.
      const lim = cartLimit(run.quest);
      hint = run.attemptCarts + " of " + lim + " cart" + (lim === 1 ? "" : "s") +
        (run.quest.f ? " — one-faint quest." : ".");
      if (!isAlive(run.combo.weapon, run.combo.style))
        hint += " This combo has already fallen — report the hunt to draw a new one.";
    }
    $("outcomeHint").textContent = hint;
  }

  function renderDeaths() {
    $("lostCount").textContent = run.deaths.length;
    $("aliveCount").textContent = run.active ? legalCombos().length : TOTAL_COMBOS;
    const el = $("deathList");
    if (!run.deaths.length) {
      el.innerHTML = '<p class="hint" style="margin:0">Nothing lost yet.</p>';
      return;
    }
    el.innerHTML = run.deaths.slice().reverse().map(d =>
      `<div class="bl-tag nuz-tag">` +
      `<span class="nuz-combo">${escapeHtml(WEAPON_ABBREV[d.weapon] || d.weapon)} + ${escapeHtml(d.style)}</span>` +
      `<span class="nuz-reason">${escapeHtml(d.reason)}</span></div>`
    ).join("");
  }

  function renderSummary() {
    const el = $("summary");
    const target = summaryRun();
    if (!target || shownView() !== "summary") { el.classList.add("hidden"); return; }
    el.classList.remove("hidden");
    // The body below, and every helper it leans on (survivorRate, finalScore,
    // runMax, legalCombos), reads the module-level `run`. Rather than thread a
    // parameter through all of it, point `run` at the run being shown and put it
    // back afterwards. The swap is synchronous and nothing else can observe it.
    const liveRun = run;
    run = target;
    rebuildDeadKeys();          // the index is derived from run.deaths, so it swaps too
    try {
      renderSummaryBody(el, target);
    } finally {
      run = liveRun;
      rebuildDeadKeys();
    }
  }

  function renderSummaryBody(el, target) {

    const exhausted = legalCombos().length === 0;
    // Report the same quantity the survivor bonus is paid on — unspent
    // allowance — not the raw board count, which includes combos belonging to
    // retired weapons and so reads higher.
    const standing = runMax() - run.deaths.length;
    // Three ways to finish now, and which one it was is the headline.
    const why = exhausted
      ? "Every available combo has fallen."
      : clearCapHit()
        ? `You went the distance — ${CLEAR_LIMIT} successful hunts, with ${standing} combo${
            standing === 1 ? "" : "s"} still standing.`
        : `Ended manually with ${standing} still standing.`;
    const tile = ([val, label, cls, exact]) =>
      `<div class="sum-stat${cls ? " " + cls : ""}"${exact ? ` title="${escapeHtml(exact)}"` : ""}>` +
      `<b class="fit${fitClass(val)}">${escapeHtml(val)}</b><span>${label}</span></div>`;
    // Three rows, and the order is the point: the score is the headline, what
    // built it comes next, then how the run went, then what it cost you.
    // "Lost" is absent deliberately — Survived carries the same information.
    const scoring = [
      [ratingFor(run.diff != null ? run.diff : difficulty(cfg)), "Difficulty", "",
        bonusFor(run.diff != null ? run.diff : difficulty(cfg)) + " bonus"],
      [zennyShort(run.earned), "Earned", "", zenny(run.earned)],
      [(runMax() - run.deaths.length) + "/" + runMax(), "Survived", "",
        Math.round(survivorRate() * 100) + "% of the run's combos still standing"],
      [zennyShort(survivorBonus()), "Survivor", "", zenny(survivorBonus())],
    ];
    const tally = [
      [clearsUsed() + "/" + CLEAR_LIMIT, "Cleared"],
      [String(run.hunts || 0), "Hunts"],
      [String(run.failed), "Failed"],
    ];
    // Each log lists what was bought and for how much; zero is still worth
    // showing, since "I never paid" is part of the record.
    const spend = ([n, log]) => log.map(r =>
      (WEAPON_ABBREV[r.weapon] || r.weapon) + " + " + r.style + " — " + zenny(r.cost)
    ).join("\n") || "None";
    const costs = [
      [String(run.carts), "Carts"],
      [String(run.rerolls || 0), "Rerolls", "", spend([run.rerolls, run.rerollLog || []])],
      [String(run.revives || 0), "Revives", "", spend([run.revives, run.reviveLog || []])],
    ];
    const final = zennyShort(finalScore());
    // The rules unlock the moment a run ends, so this panel reads ONLY the
    // snapshot taken at Start Run — never the live cfg. Falling back to cfg
    // would make a finished run's rules follow the sidebar around, which is the
    // one thing a record of what was played must not do.
    const rcfg = run.cfg;
    const rules = rcfg ? [
      ["Kill condition",    ruleLabel("kill", rcfg.kill)],
      ["Weapons/Styles",    ruleLabel("stylesPerWeapon", rcfg.stylesPerWeapon)],
      ["Loadout",           ruleLabel("assign", rcfg.assign)],
      ["Weapon/Style hold", ruleLabel("loadout", rcfg.loadout)],
      ["Quest Retry Lock",  rcfg.lockQuest ? "On" : "Off"],
      ["Revives",           rcfg.reviveEnabled
        ? [zenny(rcfg.revivePrice), rcfg.reviveCap + " max",
           rcfg.reviveOnce ? "one per combo" : "repeatable"].join(" · ")
        : "Off"],
      ["Rerolls",           rcfg.rerollEnabled ? zenny(rcfg.rerollPrice) : "Off"],
    ] : [
      // No snapshot: only the styles cap survives, read back off the ceiling.
      ["Weapons/Styles", ruleLabel("stylesPerWeapon", capForCeiling(runMax())) ],
    ];
    const roll = run.deaths.map(d =>
      `<div class="bl-tag nuz-tag"><span class="sr-n">#${d.n}</span>` +
      `<span class="nuz-combo">${escapeHtml(WEAPON_ABBREV[d.weapon] || d.weapon)} + ${escapeHtml(d.style)}</span>` +
      `<span class="nuz-reason">${escapeHtml(d.reason)}${d.quest ? " · " + escapeHtml(d.quest) : ""}</span></div>`
    ).join("");
    el.innerHTML =
      `<h2>Run Over</h2>` +
      `<p class="sub">${escapeHtml(why)}</p>` +
      `<div class="sum-cols">` +
        `<section class="sum-panel"><h3>Rules</h3><div class="sum-rules">` +
          rules.map(([k, v]) =>
            `<div class="sr-row"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join("") +
        `</div>` +
        (rcfg ? "" : `<p class="hint">This run finished before the tracker started ` +
          `recording rules, so the rest weren't saved.</p>`) +
        `</section>` +
        `<section class="sum-panel sum-center">` +
          `<div class="sum-hero" title="${escapeHtml(zenny(finalScore()))}">` +
            `<b class="fit${fitClass(final)}">${escapeHtml(final)}</b><span>Final</span></div>` +
          `<div class="sum-stats cols-4">` + scoring.map(tile).join("") + `</div>` +
          `<div class="sum-stats cols-3">` + tally.map(tile).join("") + `</div>` +
          `<div class="sum-stats cols-3 last">` + costs.map(tile).join("") + `</div>` +
        `</section>` +
        `<section class="sum-panel"><h3>Quest Log</h3>` +
          (roll ? `<div class="sum-roll">${roll}</div>`
                : `<p class="hint">No combos lost.</p>`) +
        `</section>` +
      `</div>` +
      `<div class="row end gap"><button id="sumNew" class="btn tiny accent">Start New Run</button></div>`;

    $("sumNew").addEventListener("click", startRun);
  }

  function renderAll() {
    const running = run.active && !runOver();
    const tabs = $("viewTabs"), showTabs = canSwitch();
    tabs.classList.toggle("hidden", !showTabs);
    if (showTabs) {
      const v = shownView();
      $("tabBoard").classList.toggle("on", v === "board");
      $("tabResult").classList.toggle("on", v === "summary");
      // Says whose result you are about to read, which matters most in the one
      // case where it is not the obvious one: mid-run, looking back.
      $("tabResult").textContent = runOver() ? "Result" : "Last Result";
    }
    // The controls column only exists while there is a hunt to act on; hiding it
    // also hands its 320px back to the result screen, which wants the width.
    $("controlsPanel").classList.toggle("hidden", !running);
    $("startBtn").classList.toggle("hidden", run.active && !runOver());
    $("endBtn").classList.toggle("hidden", !running);
    $("startBtn").textContent = run.deaths.length || run.active ? "Start New Run" : "Start Run";

    // Live while you're tuning; frozen to the run's snapshot once it starts.
    // The rating, not the number behind it — see LEVERS for why the number was
    // never something a player could act on.
    const d = cfgLocked() ? (run.diff != null ? run.diff : difficulty(cfg)) : difficulty(cfg);
    $("multValue").textContent = ratingFor(d);
    $("bonusValue").textContent = bonusFor(d);
    paintBadgeState();
    paintCapTotal();
    // Turning revives or rerolls off IS the selection — the price and cap below
    // them describe something that isn't happening, so they go rather than sit
    // there greyed.
    $("reviveOpts").classList.toggle("hidden", !cfg.reviveEnabled);
    $("rerollOpts").classList.toggle("hidden", !cfg.rerollEnabled);
    // ...and say so on the panel header, because both default to collapsed and
    // a shut panel otherwise gives no clue which way its switch is set.
    [["reviveState", cfg.reviveEnabled], ["rerollState", cfg.rerollEnabled]]
      .forEach(([id, isOn]) => {
        $(id).textContent = isOn ? "On" : "Off";
        $(id).classList.toggle("on", !!isOn);
      });
    $("multBox").classList.toggle("negative", false);
    $("multBox").classList.toggle("locked", cfgLocked());


    applyCfgLockState();
    renderStatus();
    renderHuntBar();
    renderBoard();
    renderDeaths();
    renderSummary();
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  // Themes are the 18 Deviants — this app's own identity, rather than the
  // Randomizer's classic monster palette. [label, hex, icon/full name]: the
  // label is the Deviant prefix so it fits the tile, the full name drives the
  // icon file and the tooltip.
  //
  // Most hexes are the right-hand stop of that Deviant's in-game pigment, which
  // is a two-color gradient. Several shift hue rather than shade across the
  // plate (Snowbaron white→purple, Boltreaver green→blue), so the right stop is
  // not simply a darker version of the left.
  //
  // Four are hand-picked rather than sampled: Dreadqueen takes Bloodbath's
  // purple left stop, Bloodbath takes the old Nightcloak navy, and Dreadking and
  // Nightcloak are deepened into a matched dark red / dark blue pair.
  //
  // These are tuned to look like the monster, not to spread evenly. Some
  // Deviants really are close to each other in game, and two similar plates is
  // the correct outcome when that's true — don't "fix" it by pushing them
  // apart. The one hard constraint is readability: white text must clear 4.5:1
  // on --bg, --bg2 and --hover, so re-check contrast after changing a hex.
  const COLORS = [
    ["Redhelm",     "#CE2A20", "Redhelm Arzuros"],
    ["Snowbaron",   "#8E6BC4", "Snowbaron Lagombi"],
    ["Stonefist",   "#E8776E", "Stonefist Hermitaur"],
    ["Dreadqueen",  "#4A2A66", "Dreadqueen Rathian"],
    ["Drilltusk",   "#D07A20", "Drilltusk Tetsucabra"],
    ["Silverwind",  "#7A858E", "Silverwind Nargacuga"],
    ["Crystalbeard","#CFAE44", "Crystalbeard Uragaan"],
    ["Deadeye",     "#3F7A2E", "Deadeye Yian Garuga"],
    ["Dreadking",   "#3E0C05", "Dreadking Rathalos"],
    ["Thunderlord", "#C79A1C", "Thunderlord Zinogre"],
    ["Grimclaw",    "#3070D0", "Grimclaw Tigrex"],
    ["Hellblade",   "#D25A18", "Hellblade Glavenus"],
    ["Nightcloak",  "#07143C", "Nightcloak Malfestio"],
    ["Rustrazor",   "#5E9CC8", "Rustrazor Ceanataur"],
    ["Soulseer",    "#DC6F9E", "Soulseer Mizutsune"],
    ["Boltreaver",  "#22D3DB", "Boltreaver Astalos"],
    ["Elderfrost",  "#B8C6CE", "Elderfrost Gammoth"],
    ["Bloodbath",   "#1E2440", "Bloodbath Diablos"],
  ];
  const COLORS_HEX = Object.fromEntries(COLORS.map(([n, h]) => [h.toUpperCase(), n]));
  const COLORS_ICON = Object.fromEntries(COLORS.filter(c => c[2]).map(([n, , i]) => [n, i]));

  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const hexRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    const l = (mx + mn) / 2;
    return [h / 6, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l];
  }
  function hslToRgb([h, s, l]) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const hi = Math.floor(h * 6) % 6;
    const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x]
      : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => clamp(v * 255));
  }
  // shade/lighten only move lightness in HSL space, so the hue and saturation of
  // the chosen theme color are preserved — every derived shade stays in family.
  //
  // shade REMAPS the source lightness into [lo, hi] rather than multiplying and
  // clamping. The clamp it replaces was the reason every theme looked alike:
  // multiplying then capping at a single ceiling meant 17 of the 18 Deviants
  // landed on exactly that ceiling, so every background came out at the same
  // lightness and only a barely-visible hue told them apart. Remapping keeps the
  // pale Deviants pale relative to the dark ones while still bounding the top of
  // the range, so white text clears the 4.5:1 floor on every theme (worst case
  // is Crystalbeard's hover at 6.8:1).
  const shade = (rgb, lo, hi) => {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb([h, s, clamp01(lo + (hi - lo) * l)]);
  };
  const lighten = (rgb, b, minL) => {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb([h, s, clamp01(Math.max(l + (1 - l) * b, minL == null ? 0 : minL))]);
  };
  const css = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  // Split out so the colour on screen does not have to be a swatch's colour.
  // Everything below the split is about the CHOICE -- persisting it, marking the
  // swatch, swapping the title icon -- and only runs when a theme is picked.
  function paintTheme(c) {
    const r = document.documentElement.style;
    r.setProperty("--bg",           css(shade(c, .10, .28)));
    r.setProperty("--bg1",          css(shade(c, .085, .23)));
    r.setProperty("--bg2",          css(shade(c, .07, .19)));
    r.setProperty("--hover",        css(shade(c, .17, .35)));
    r.setProperty("--accent",       css(shade(c, .10, .28)));
    r.setProperty("--accent-hover", css(lighten(c, .40, .62)));
    // A fallen combo used to be marked in a fixed red, which fought every theme
    // it wasn't Dreadking. These follow the theme instead, and sit above the
    // --bg2 band (which tops out at .19) so the tag still reads as marked —
    // the separation is lightness, not hue. The line-through on the combo name
    // carries the meaning regardless of color.
    r.setProperty("--fallen-line", css(shade(c, .28, .48)));
    r.setProperty("--fallen-fill", rgba(shade(c, .40, .62), .12));
    // Text on a fallen marker needs to clear the dark panel it sits on, so it
    // gets a floor rather than a band.
    r.setProperty("--fallen-text", css(lighten(c, .55, .72)));
    r.setProperty("--titlebar-overlay", "rgba(0,0,0,0.18)");
    r.setProperty("--text", "#ffffff");
    r.setProperty("--text-dim", "#fffffff5");
    r.setProperty("--line", "rgba(11,8,8,0.12)");
    r.setProperty("--card", "rgba(255,255,255,0.05)");
  }

  // ── Themes that carry a second colour ─────────────────────────────────────
  // A palette tile normally means one colour. Two of them mean two, because the
  // monster does: Bloodbath Diablos bloodies, and Boltreaver is an Astalos under
  // its lightning. Both keep ONE hex -- the saved theme is still the palette hex
  // in either state -- because COLORS_HEX validates the stored theme and picks
  // the title icon BY HEX, so a second hex would need a second tile with a second
  // monster name on it. The choice rides alongside in its own key.
  //
  // The BASE colour is whichever entry matches the tile's own hex, and that is
  // what an unset state means, so nobody is moved off the theme they already had.
  // It is not always first: Boltreaver's green leads the pips while its cyan is
  // the base, which is why the entries carry their colour rather than deriving it
  // from position.
  //
  // Bloodbath briefly had a third state, an animated walk from its navy to the
  // red and back. Out for now, not abandoned -- the phase function is in the
  // commits around "Give Bloodbath three states". Restoring it needs a timer and
  // a third entry here; nothing below cares how many there are.
  const VARIANTS = {
    "#1E2440": [["navy",  "#1E2440", "Navy"],
                ["blood", "#A0121C", "Bloodred"]],
    // Same saturation and lightness as the cyan it sits beside — hsl(133,73%,50%)
    // against hsl(183,73%,50%) — so the two states differ in hue alone, which is
    // the same discipline shade() applies to everything else in the theme.
    "#22D3DB": [["green", "#22DB4A", "Green"],
                ["bolt",  "#22D3DB", "Cyan"]],
    // The only tile whose own hex is NEITHER state: #DC6F9E is the identity the
    // save and the icon are keyed to, and both colours here replace it. The pink
    // is that hex with lightness alone dropped, 65% to 45% — the same hue and
    // saturation — so it reads as the theme darkened rather than a new colour.
    // With no entry matching the tile hex the unset default falls to the first,
    // the ash, which is the one case in the table where choosing changes what an
    // existing Soulseer user sees.
    "#DC6F9E": [["ash",  "#8A7F79", "Ash"],
                ["soul", "#B92D69", "Soulfire"]],
    // hsl(22,63%,36%) sits a degree off Hellblade's hue but ten points darker and
    // sixteen less saturated, which is what separates oxidised metal from flame.
    // Two plates in the same family is a correct outcome here, not a collision.
    "#5E9CC8": [["rust", "#964C22", "Rust"],
                ["blue", "#5E9CC8", "Blue"]],
    // Author's hex. It is the palest colour in the table and so sets the app's
    // new contrast floor -- white on its --hover is 5.05:1, still clear of 4.5
    // but the tightest anything here runs.
    "#C79A1C": [["green", "#64E98A", "Green"],
                ["gold",  "#C79A1C", "Gold"]],
    // Author's hex.
    "#D25A18": [["orange",   "#D25A18", "Orange"],
                ["charcoal", "#2C2119", "Charcoal"]],
    // Everything else was tried and taken back out: a systematic second colour
    // for all ten remaining Deviants, first as lighten(c, 0.35) and then, when
    // that read pastel rather than vivid, as a saturation push. Both passes are
    // in the commits around "Apply the lighter second colour" and "Make the
    // second colours brighter" if the idea comes back. Redhelm's blue went with
    // them. What is left is the six that were each a decision about the monster
    // rather than a formula applied to a hex.
  };
  const VARIANT_KEY = "mhgu-zenny-gauntlet-variant";
  const variantsFor = (hex) => VARIANTS[hex.toUpperCase()] || null;

  // hex -> chosen state id. Validated on the way in rather than trusted: a stale
  // id from a state that has since been removed falls back to the base.
  const variantState = {};
  try {
    const raw = JSON.parse(localStorage.getItem(VARIANT_KEY) || "{}");
    Object.keys(VARIANTS).forEach(h => {
      if (VARIANTS[h].some(v => v[0] === raw[h])) variantState[h] = raw[h];
    });
  } catch (e) {}

  const variantOf = (hex) => {
    const vs = variantsFor(hex);
    if (!vs) return null;
    const up = hex.toUpperCase();
    return vs.find(v => v[0] === variantState[up])
        || vs.find(v => v[1].toUpperCase() === up)      // the base, when unset
        || vs[0];
  };
  // The colour a tile actually paints with, which is the tile's own hex unless a
  // variant says otherwise. Everything downstream goes through this.
  const themeColor = (hex) => { const v = variantOf(hex); return v ? v[1] : hex; };

  function paintVariantTiles() {
    Object.keys(VARIANTS).forEach(h => {
      const tile = document.querySelector('.swatch[data-hex="' + h + '"]');
      if (!tile) return;
      const cur = variantOf(h);
      tile.style.background = cur[1];
      tile.querySelectorAll(".pip").forEach(p =>
        p.classList.toggle("on", p.dataset.state === cur[0]));
    });
  }
  function setVariant(hex, id) {
    variantState[hex.toUpperCase()] = id;
    try { localStorage.setItem(VARIANT_KEY, JSON.stringify(variantState)); } catch (e) {}
    paintVariantTiles();
    applyTheme(hex);                    // picking a state is picking the theme
  }

  function applyTheme(hex) {
    paintTheme(hexRgb(themeColor(hex)));
    try { localStorage.setItem("mhgu-zenny-gauntlet-theme", hex); } catch (e) {}
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("sel", s.dataset.hex === hex));
    const ti = document.querySelector(".title-icon");
    if (ti) {
      const name = COLORS_HEX[hex.toUpperCase()];
      ti.src = name ? monsterIcon(COLORS_ICON[name] || name) : FALLBACK_ICON;
      ti.onerror = () => { ti.onerror = null; ti.src = FALLBACK_ICON; };
    }
  }
  function buildSwatches() {
    const wrap = $("swatches"); wrap.innerHTML = "";
    COLORS.forEach(([name, hex]) => {
      const full = COLORS_ICON[name] || name;
      const d = document.createElement("div");
      d.className = "swatch"; d.dataset.hex = hex; d.style.background = hex; d.title = full;
      d.innerHTML = `<img class="swatch-icon" src="${monsterIcon(full)}" alt=""><span>${escapeHtml(name)}</span>`;
      d.querySelector("img").onerror = function () { this.onerror = null; this.src = FALLBACK_ICON; };
      d.addEventListener("click", () => applyTheme(hex));
      // A variant tile gets one pip per colour. They are the indicator and the
      // control at once: each is painted as the thing it selects, so the row
      // reads as a legend even before you click it. Driven entirely off the
      // VARIANTS entry, so adding a colour to a tile — or a tile to the table —
      // needs nothing here. stopPropagation keeps the tile's own handler from
      // re-applying the theme underneath the pip's.
      const vs = variantsFor(hex);
      if (vs) {
        const pips = document.createElement("div");
        pips.className = "pips";
        vs.forEach(([id, colour, label]) => {
          const p = document.createElement("button");
          p.type = "button";
          p.className = "pip";
          p.dataset.state = id;
          p.style.background = colour;
          p.title = label;
          p.setAttribute("aria-label", full + " — " + label);
          p.addEventListener("click", (e) => { e.stopPropagation(); setVariant(hex, id); });
          pips.appendChild(p);
        });
        d.appendChild(pips);
      }
      wrap.appendChild(d);
    });
    paintVariantTiles();
  }

  // ── Payment ──────────────────────────────────────────────────────────────
  // One modal serves both revives and rerolls, settled by deducting from what
  // the run has earned.
  //
  // Paying in materials was dropped deliberately. It looked free to the app but
  // wasn't to the player — selling a rare part hurts, selling ten Iron Ore
  // doesn't, and nothing here can tell the difference. An unmeasurable cost
  // can't be balanced, and simulation showed it acting as a free run
  // extension. Zenny is a cost the app can actually see and price.
  function askPayment({ title, sub, cost, onPaid }) {
    $("reviveTitle").textContent = title;
    $("reviveSub").textContent = sub;
    $("reviveOptions").innerHTML =
      `<button type="button" class="revive-opt pay-zenny" data-pay="1">` +
      `<span class="ro-line"><span class="ro-name">Deduct from earned zenny</span></span>` +
      `<span class="ro-total">&minus;${zenny(cost)}</span></button>`;
    $("reviveOptions").querySelector("[data-pay]").addEventListener("click", () => {
      $("reviveModal").classList.add("hidden");
      onPaid({ total: cost });
    });
    $("reviveModal").classList.remove("hidden");
  }

  function openRevive(w, s) {
    if (!canRevive(w, s)) return;
    const cost = reviveCost(run.revives);
    askPayment({
      title: (WEAPON_ABBREV[w] || w) + " + " + s,
      sub: `Revive #${run.revives + 1} of ${reviveAllowance()}.`,
      cost,
      onPaid: (option) => doRevive(w, s, option),
    });
  }

  function openReroll() {
    if (!canReroll()) return;
    const cost = rerollCost(run.rerolls);
    const c = run.combo;
    askPayment({
      title: "Reroll " + (WEAPON_ABBREV[c.weapon] || c.weapon) + " + " + c.style,
      sub: `Reroll #${run.rerolls + 1}.`,
      cost,
      onPaid: (option) => doReroll(option),
    });
  }

  // ── Confirm modal ────────────────────────────────────────────────────────
  let confirmAction = null;
  function askConfirm(title, body, fn) {
    $("confirmTitle").textContent = title;
    $("confirmBody").textContent = body;
    confirmAction = fn;
    $("confirmModal").classList.remove("hidden");
  }

  // ── Export / import ──────────────────────────────────────────────────────
  function exportRun() {
    const blob = new Blob([JSON.stringify({ v: 1, cfg, run }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mhgu-zenny-gauntlet.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importRun(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (d.cfg) cfg = Object.assign({}, DEFAULT_CFG, d.cfg);
        if (d.run) run = Object.assign(emptyRun(), d.run);
        rebuildDeadKeys(); writeCfgToDom(); save(); renderAll();
      } catch (e) {
        const b = $("importBtn"); const t = b.textContent;
        b.textContent = "Invalid file!";
        setTimeout(() => { b.textContent = t; }, 2000);
      }
    };
    fr.readAsText(file);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  // One panel open at a time. The bodies are long enough that two at once pushes
  // the rest off the bottom of the sidebar, so opening one shuts the others.
  // Clicking an open panel still closes it, leaving them all shut.
  document.querySelectorAll(".panel-head").forEach(h => {
    h.addEventListener("click", () => {
      const p = h.parentElement;
      const opening = p.dataset.open !== "true";
      document.querySelectorAll(".panel").forEach(o => { o.dataset.open = "false"; });
      p.dataset.open = opening ? "true" : "false";
      // Bring the header into view, or opening a panel low in the sidebar can
      // leave you looking at the middle of it.
      if (opening) h.scrollIntoView({ block: "nearest" });
    });
  });

  document.querySelector(".sidebar").addEventListener("change", (e) => {
    if (e.target.closest(".panel-body")) {
      readCfgFromDom();
      save(); renderAll();
    }
  });

  $("startBtn").addEventListener("click", () => {
    if (run.active && run.deaths.length) {
      askConfirm("Start a new run?",
        "This clears the current run — " + run.deaths.length + " fallen combo(s) and all progress.",
        startRun);
    } else startRun();
  });
  $("endBtn").addEventListener("click", () => {
    askConfirm("End this run?", "The run is closed out and you'll get the summary.", endRun);
  });

  $("rollBtn").addEventListener("click", () => {
    if (run.combo) return;
    const c = rollCombo();
    if (!c) { renderAll(); return; }
    run.combo = c; save(); renderAll();
  });

  // Only ever accept a combo that actually exists and is still alive — the
  // selects are empty while the app is rolling for you, and a change event
  // fired against them would otherwise produce a phantom "|" combo that can be
  // hunted with and killed.
  const setPickedCombo = (w, s) => {
    if (!ALL_WEAPONS.includes(w)) return;
    const styles = legalStyles(w);
    const style = styles.includes(s) ? s : styles[0];
    if (!style) return;
    run.combo = { weapon: w, style };
    save(); renderAll();
  };
  // Changing the weapon only refreshes which styles are on offer — it commits
  // nothing, so you can look through the options before settling.
  $("pickWeapon").addEventListener("change", () => {
    const w = $("pickWeapon").value, sSel = $("pickStyle");
    sSel.innerHTML = legalStyles(w).map(st =>
      `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`).join("");
    renderBoard();          // the row arm of the crosshair follows the picker
  });
  $("pickStyle").addEventListener("change", renderBoard);
  $("pickConfirm").addEventListener("click", () =>
    setPickedCombo($("pickWeapon").value, $("pickStyle").value));
  // Opting in to the swap. Nothing is spent by opening it — the swap is only
  // used up by confirming a different combo.

  $("questSearch").addEventListener("input", (e) => renderQuestResults(e.target.value));
  // Delegated: the card's innerHTML is rebuilt on every render, so a listener
  // bound to the button itself would not survive one.
  $("questChosen").addEventListener("click", (e) => {
    if (e.target.closest(".qc-clear")) clearQuest();
  });
  $("questResults").addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (row) chooseQuest(searchResults[+row.dataset.i]);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".hunt-quest")) $("questResults").classList.add("hidden");
  });

  $("oClear").addEventListener("click", () => report("clear"));
  $("oCart").addEventListener("click",  () => report("cart"));
  $("oFail").addEventListener("click",  () => report("fail"));

  // Two docs, split by the question they answer. About is what a run IS and what
  // it costs you; Help is how to drive the thing.
  $("aboutBtn").addEventListener("click", () => $("aboutModal").classList.remove("hidden"));
  $("aboutClose").addEventListener("click", () => $("aboutModal").classList.add("hidden"));
  $("helpBtn").addEventListener("click", () => $("helpModal").classList.remove("hidden"));
  $("helpClose").addEventListener("click", () => $("helpModal").classList.add("hidden"));
  $("themeBtn").addEventListener("click", () => $("themeModal").classList.remove("hidden"));
  $("s_autoroll").addEventListener("change", (e) => {
    cfg.autoRoll = e.target.checked;
    afterMutation();      // saves, and deals a combo straight away if one is due
  });
  // Deliberately live during a run: the set you are wearing is a fact about this
  // hunt, and a hunt you have already carted on is exactly when you would notice
  // you are wearing it. Ticking it mid-attempt raises the limit for the attempt
  // in progress -- which is correct, since the limit has not been reached yet or
  // the attempt would already be over.
  $("h_insurance").addEventListener("change", (e) => {
    cfg.insurance = e.target.checked;
    save(); renderAll();
  });
  $("tabBoard").addEventListener("click", () => { view = "board"; renderAll(); });
  $("tabResult").addEventListener("click", () => { view = "summary"; renderAll(); });
  $("themeClose").addEventListener("click", () => $("themeModal").classList.add("hidden"));
  $("linksBtn").addEventListener("click", () => $("linksModal").classList.remove("hidden"));
  $("linksClose").addEventListener("click", () => $("linksModal").classList.add("hidden"));
  [["aboutModal"], ["helpModal"], ["themeModal"], ["linksModal"], ["confirmModal"]].forEach(([id]) => {
    $(id).addEventListener("click", (e) => { if (e.target.id === id) $(id).classList.add("hidden"); });
  });
  // Board is rebuilt on every render, so delegate rather than binding cells.
  $("board").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell.revivable");
    if (cell) openRevive(cell.dataset.w, cell.dataset.s);
  });
  $("rerollBtn").addEventListener("click", openReroll);
  $("reviveCancel").addEventListener("click", () => $("reviveModal").classList.add("hidden"));
  $("reviveModal").addEventListener("click", (e) => {
    if (e.target.id === "reviveModal") $("reviveModal").classList.add("hidden");
  });

  $("confirmCancel").addEventListener("click", () => $("confirmModal").classList.add("hidden"));
  $("confirmOk").addEventListener("click", () => {
    $("confirmModal").classList.add("hidden");
    if (confirmAction) { const f = confirmAction; confirmAction = null; f(); }
  });

  $("exportBtn").addEventListener("click", exportRun);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importRun(e.target.files[0]);
    e.target.value = "";
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  paintBadges();
  buildSwatches();
  const DEFAULT_THEME = "#07143C";            // Nightcloak Malfestio
  let savedTheme = DEFAULT_THEME;
  try { savedTheme = localStorage.getItem("mhgu-zenny-gauntlet-theme") || savedTheme; } catch (e) {}
  // A stored hex that's no longer in the palette would leave no tile selected and
  // no title icon, so fall back rather than half-applying it.
  if (!COLORS_HEX[savedTheme.toUpperCase()]) savedTheme = DEFAULT_THEME;
  applyTheme(savedTheme);

  load();
  writeCfgToDom();
  $("questSearch").placeholder = "Search " + QUESTS.length + " quests…";
  renderAll();

  // Once MHFU has swapped in, Chrome still draws each select's text too low, its bottom
  // clipped, until the select is restyled: zooming the page does it, a repaint does not.
  // A font-family round trip restyles them; the serif step is styled but never laid out.
  if (document.fonts) document.fonts.load("1em MHFU").then(() => {
    const selects = document.querySelectorAll("select");
    selects.forEach(s => { s.style.fontFamily = "serif"; });
    selects.forEach(s => getComputedStyle(s).fontFamily);
    selects.forEach(s => { s.style.fontFamily = ""; });
  }, () => {});
})();
