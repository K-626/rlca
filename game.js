// 試作用の戦闘ロジック。Wikiの仕組みを参考にしつつ、効果値や敵AIは簡略化しています。
const SKILLS = {
  darkTouch: {
    name: "闇の接触", symbol: "☾", type: "攻撃", count: 5,
    desc: "敵に7ダメージ。別のスキルを挟むと追加で3ダメージ。",
    kind: "dark"
  },
  voidGaze: {
    name: "虚無のまなざし", symbol: "◉", type: "妨害", count: 2,
    desc: "敵に2ダメージを与え、次の敵行動を1回妨害する。",
    kind: "stun"
  },
  rest: {
    name: "休息", symbol: "✧", type: "回復", count: 2,
    desc: "体力を8回復し、マナを1得る。",
    kind: "heal"
  },
  reconsider: {
    name: "再考", symbol: "↻", type: "補助", count: 1,
    desc: "手札を引き直し、闇の接触の追加ダメージを準備する。",
    kind: "redraw"
  }
};

const TREANT_SKILLS = [
  { name: "自然の恵み", desc: "この戦闘中、スキル発動時に回復する力を得る。", kind: "nature", excluded: true },
  { name: "新緑の握撃", desc: "相手に2ダメージを3回与える。", kind: "grip" },
  { name: "怒れる大地", desc: "回復回数×3のダメージを与える。", kind: "earth" },
  { name: "大地の守り", desc: "回復回数×与ダメ回数のシールドを得る。", kind: "guard", excluded: true }
];

const $ = (id) => document.getElementById(id);
let state;

function newState() {
  const deck = [];
  Object.entries(SKILLS).forEach(([id, skill]) => {
    for (let i = 0; i < skill.count; i++) deck.push({ id, uid: `${id}-${i}` });
  });
  return {
    turn: 1,
    phase: "player",
    playerHp: 100,
    playerMaxHp: 100,
    mana: 0,
    actions: 3,
    hand: [],
    deck,
    usedIds: [],
    darkBonusReady: true,
    enemyHp: 80,
    enemyMaxHp: 80,
    enemyShield: 0,
    enemyHeals: 0,
    enemyDamageHits: 0,
    enemyNatureActive: false,
    enemyStun: 0,
    enemyTurnIndex: 0,
    log: [],
    won: false,
    lost: false
  };
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getSkill(id) { return SKILLS[id]; }

function drawHand() {
  const available = shuffle(state.deck.filter(card => !state.hand.some(h => h.uid === card.uid)));
  state.hand = available.slice(0, 3);
}

function log(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 30);
}

function damageEnemy(amount) {
  const blocked = Math.min(state.enemyShield, amount);
  state.enemyShield -= blocked;
  const actual = amount - blocked;
  state.enemyHp = Math.max(0, state.enemyHp - actual);
  if (blocked > 0) log(`トレントのシールドが${blocked}ダメージを防いだ。`);
  log(`トレントに${actual}ダメージ。`);
  state.enemyDamageHits++;
  if (state.enemyHp <= 0) finish("victory");
}

function damagePlayer(amount) {
  state.playerHp = Math.max(0, state.playerHp - amount);
  log(`虚の異形は${amount}ダメージを受けた。`);
  if (state.playerHp <= 0) finish("defeat");
}

function playSkill(index) {
  if (state.phase !== "player" || state.actions <= 0 || state.won || state.lost) return;
  const card = state.hand[index];
  if (!card) return;
  const skill = getSkill(card.id);
  state.hand.splice(index, 1);
  state.usedIds.push(card.uid);
  log(`「${skill.name}」を発動。`);

  switch (skill.kind) {
    case "dark":
      damageEnemy(7);
      if (state.darkBonusReady && !state.won) {
        damageEnemy(3);
        log("別のスキルを挟んだ効果が発動！");
      }
      state.darkBonusReady = false;
      break;
    case "stun":
      damageEnemy(2);
      state.enemyStun = Math.min(1, state.enemyStun + 1);
      state.darkBonusReady = true;
      log("トレントの次の行動を1回妨害する。");
      break;
    case "heal": {
      const before = state.playerHp;
      state.playerHp = Math.min(state.playerMaxHp, state.playerHp + 8);
      const healed = state.playerHp - before;
      state.mana += 1;
      state.darkBonusReady = true;
      log(`体力を${healed}回復し、マナを1得た。`);
      break;
    }
    case "redraw":
      state.darkBonusReady = true;
      state.actions = Math.min(3, state.actions + 1);
      log("手札を引き直し、追加行動を得た。");
      break;
  }

  // 発動したスキルはデッキに戻る仕様。手札に同じカードを重ねないよう補充する。
  if (!state.won && !state.lost) {
    if (state.hand.length < 3) {
      const candidates = shuffle(state.deck.filter(c => !state.hand.some(h => h.uid === c.uid)));
      const next = candidates.find(c => c.uid !== card.uid || candidates.length === 1);
      if (next) state.hand.push(next);
    }
    if (skill.kind !== "redraw") state.actions--;
    render();
    if (state.actions <= 0 && !state.won && !state.lost) {
      $("end-turn-btn").classList.add("attention");
    }
  } else render();
}

function endTurn() {
  if (state.phase !== "player" || state.won || state.lost) return;
  state.phase = "enemy";
  log(`--- ${state.turn}ターン目：トレントの行動 ---`);
  render();

  // トレントのスキル構成（Wiki記載）を参考にした簡易AI。
  // 通常版：自然の恵み×1、新緑の握撃×5、怒れる大地×1、大地の守り×1
  const sequence = ["grip", "grip", "nature", "grip", "guard", "grip", "earth", "grip"];
  let idx = 0;

  function doEnemyAction() {
    if (state.won || state.lost) return;
    if (idx >= 2) {
      state.turn++;
      state.actions = 3;
      state.phase = "player";
      drawHand();
      log(`--- ${state.turn}ターン目：虚の異形の行動 ---`);
      render();
      return;
    }

    const kind = sequence[state.enemyTurnIndex % sequence.length];
    state.enemyTurnIndex++;
    idx++;

    if (state.enemyStun > 0) {
      state.enemyStun--;
      log("虚無のまなざしにより、トレントの行動は妨害された。");
      setTimeout(doEnemyAction, 380);
      render();
      return;
    }

    if (kind === "nature") {
      // 自然の恵みは発動後、以後のスキル発動ごとに回復する効果として扱う。
      state.enemyNatureActive = true;
      log("自然の恵み：以後、スキルを発動するたびに体力を1回復する。");
    } else if (kind === "grip") {
      for (let hit = 0; hit < 3; hit++) {
        if (state.playerHp <= 0) break;
        damagePlayer(2);
      }
      log("新緑の握撃：2ダメージを3回。");
    } else if (kind === "guard") {
      const gained = state.enemyHeals * state.enemyDamageHits;
      state.enemyShield += gained;
      log(`大地の守り：トレントがシールドを${gained}得た。`);
    } else if (kind === "earth") {
      const amount = state.enemyHeals * 3;
      log(`怒れる大地：回復回数 ${state.enemyHeals} × 3。`);
      if (amount > 0) damagePlayer(amount);
      else log("回復回数が0のためダメージは発生しない。");
    }

    // 自然の恵みの効果は「スキル発動ごと」に1回だけ誘発する。
    if (kind !== "nature" && state.enemyNatureActive && !state.lost) {
      const before = state.enemyHp;
      state.enemyHp = Math.min(state.enemyMaxHp, state.enemyHp + 1);
      state.enemyHeals++;
      log(`自然の恵み：トレントが${state.enemyHp - before}回復（回復回数 ${state.enemyHeals}）。`);
    }
    render();
    setTimeout(doEnemyAction, 450);
  }

  doEnemyAction();
}

function finish(result) {
  if (state.won || state.lost) return;
  state.phase = result;
  state.won = result === "victory";
  state.lost = result === "defeat";
  if (state.won) {
    log("勝利！ トレントのスキルを1つ獲得できる想定です（報酬画面は未実装）。");
  } else {
    log("敗北……「もう一度戦う」から再挑戦できます。");
  }
  setTimeout(() => {
    $("result-title").textContent = state.won ? "勝利！" : "敗北…";
    $("result-message").textContent = state.won
      ? "トレントを倒した。次の開発段階でスキル獲得画面を追加できます。"
      : "体力が尽きた。スキルの順番を工夫して再挑戦しよう。";
    $("result-overlay").classList.remove("hidden");
  }, 250);
}

function renderHand() {
  const hand = $("hand");
  hand.innerHTML = "";
  state.hand.forEach((card, index) => {
    const skill = getSkill(card.id);
    const button = document.createElement("button");
    button.className = "skill-card";
    button.disabled = state.phase !== "player" || state.actions <= 0 || state.won || state.lost;
    button.innerHTML = `
      <div class="card-top"><span class="card-symbol">${skill.symbol}</span><span class="card-type">${skill.type}</span></div>
      <h3>${skill.name}</h3><p>${skill.desc}</p>
      <div class="card-foot"><span>行動を1消費</span><span>発動する ↗</span></div>
      <span class="card-number">0${index + 1}</span>`;
    button.addEventListener("click", () => playSkill(index));
    hand.appendChild(button);
  });
  $("hand-count").textContent = `${state.hand.length} / 3`;
}

function renderDeck() {
  const deckList = $("deck-list");
  deckList.innerHTML = "";
  Object.values(SKILLS).forEach(skill => {
    const row = document.createElement("div");
    row.className = "deck-item";
    row.innerHTML = `<span>${skill.name}</span><span>× ${skill.count}</span>`;
    deckList.appendChild(row);
  });
  $("deck-count").textContent = `${state.deck.length} スキル`;
}

function render() {
  $("turn-label").textContent = `TURN ${state.turn}`;
  $("player-hp-text").textContent = `${state.playerHp} / ${state.playerMaxHp}`;
  $("player-hp-bar").style.width = `${state.playerHp / state.playerMaxHp * 100}%`;
  $("player-mana").textContent = state.mana;
  $("player-actions").textContent = state.actions;
  $("enemy-hp-text").textContent = `${state.enemyHp} / ${state.enemyMaxHp}`;
  $("enemy-hp-bar").style.width = `${state.enemyHp / state.enemyMaxHp * 100}%`;
  $("enemy-shield").textContent = state.enemyShield;
  $("enemy-heals").textContent = state.enemyHeals;
  $("action-count").textContent = `${state.actions} 回`;
  $("end-turn-btn").disabled = state.phase !== "player" || state.won || state.lost;
  $("end-turn-btn").classList.toggle("attention", state.actions <= 0);
  $("enemy-intent").textContent = state.enemyStun > 0 ? "次の行動：妨害中" : "次の行動：トレントのスキル";
  $("battle-log").innerHTML = state.log.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  renderHand();
  renderDeck();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}

function restart() {
  state = newState();
  drawHand();
  log("トレントが現れた。手札からスキルを選ぼう。");
  log("虚の異形の初期デッキを参考に、10個のスキルを用意した。");
  $("result-overlay").classList.add("hidden");
  render();
}

$("end-turn-btn").addEventListener("click", endTurn);
$("restart-btn").addEventListener("click", restart);
$("result-restart").addEventListener("click", restart);
restart();
