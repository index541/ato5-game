/* あと5分だけ… Web版コントローラ: ローカル対戦 / PeerJSホスト / ゲスト */
'use strict';
const Core = window.Ato5Core;
const $ = id => document.getElementById(id);
const BOT_NAMES = ['ボット・すや', 'ボット・ねむ', 'ボット・ゆめ', 'ボット・まど', 'ボット・こま'];
const PHASE_LABEL = { lobby: 'ロビー', choice: '選択中', reveal: '公開！', nap: '二度寝', event: 'ハプニング', eventConfirm: 'ハプニング', roundEnd: 'ラウンド終了', gameEnd: '結果発表' };

let mode = null;            // 'local' | 'host' | 'guest'
let game = null;            // host/local の実体
let view = null;            // 表示用の publicView
let myPlayerId = -1;        // オンライン時の自分のプレイヤー番号（ローカルは -1=全員操作）
let localHumanIds = [];     // ローカルで人間が操作するプレイヤー番号
let lastPhase = '';
let orchestrateTimer = null;
let passQueue = [];         // ローカル: これから選択する人間プレイヤー
let passCurrent = null;

/* ---------- 画面遷移 ---------- */
function show(id) {
  ['scr-home', 'scr-local', 'scr-lobby', 'scr-game'].forEach(s => $(s).classList.toggle('hidden', s !== id));
}
function overlay(html) { $('modal').innerHTML = html; $('overlay').classList.remove('hidden'); }
function closeOverlay() { $('overlay').classList.add('hidden'); $('modal').innerHTML = ''; }
function confetti() {
  const cs = ['#ef91b2', '#ffd976', '#75c9ad', '#8b75d7', '#7fc4e8'];
  for (let i = 0; i < 60; i++) {
    const d = document.createElement('div');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = cs[i % cs.length];
    d.style.animationDuration = (2.2 + Math.random() * 2) + 's';
    d.style.animationDelay = (Math.random() * 0.7) + 's';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5500);
  }
}

/* ---------- 時計と得点盤（静的部品） ---------- */
(function buildClock() {
  const f = $('clockFace');
  for (let m = 435; m <= 530; m += 5) {
    if (![450, 480, 510].includes(m)) continue;
    const a = ((m % 720) / 720) * Math.PI * 2;
    const s = document.createElement('span');
    s.className = 'clockNum';
    s.style.left = (50 + Math.sin(a) * 40) + '%';
    s.style.top = (50 - Math.cos(a) * 40) + '%';
    s.textContent = Core.fmt(m);
    f.appendChild(s);
  }
  const dn = document.createElement('div'); dn.className = 'clockHand deadline'; dn.id = 'handDead';
  const nw = document.createElement('div'); nw.className = 'clockHand now'; nw.id = 'handNow';
  const c = document.createElement('div'); c.className = 'clockCenter';
  const tipN = document.createElement('div'); tipN.className = 'clockTip'; tipN.id = 'tipNow'; tipN.style.color = '#7963c3';
  const tipD = document.createElement('div'); tipD.className = 'clockTip'; tipD.id = 'tipDead'; tipD.style.color = '#d76f94';
  f.append(dn, nw, c, tipN, tipD);
})();
(function buildScore() {
  const b = $('scoreBoard');
  for (let i = 0; i < 40; i++) {
    const cell = document.createElement('div');
    cell.className = 'scoreCell'; cell.textContent = i;
    b.appendChild(cell);
  }
})();
function cellCenter(idx) {
  const col = idx % 20, row = Math.floor(idx / 20);
  return { x: col * 39 + 18, y: row * 47 + 22 };
}
function handAngle(mins) { return ((mins % 720) / 720) * 360; }
function tipPos(mins, r) {
  const a = handAngle(mins) * Math.PI / 180;
  return { x: 50 + Math.sin(a) * r, y: 50 - Math.cos(a) * r };
}

/* ---------- 描画 ---------- */
function render() {
  if (!view) return;
  const v = view;
  $('hudRound').textContent = v.round;
  $('hudBase').textContent = (v.phase === 'choice' || v.phase === 'reveal') && v.currentBp == null ? '―' : (v.currentBp == null ? '―' : v.currentBp);
  if (v.phase === 'reveal' || v.phase === 'nap' || v.phase === 'event' || v.phase === 'eventConfirm') $('hudBase').textContent = v.currentBp;
  $('hudPhase').textContent = PHASE_LABEL[v.phase] || v.phase;
  $('tNow').textContent = Core.fmt(v.now);
  $('tDead').textContent = Core.fmt(v.deadline);
  const gap = v.deadline - v.now;
  $('tGap').textContent = gap > 0 ? 'あと' + gap + '分' : gap === 0 ? 'ちょうど！' : '超過';
  const sb = $('safeBox');
  if (gap >= 15) { sb.className = 'safetyBox'; sb.textContent = 'まだ間に合う'; }
  else if (gap >= 5) { sb.className = 'safetyBox'; sb.style.background = '#fff6da'; sb.style.color = '#96741d'; sb.textContent = 'そろそろ危ない'; }
  else { sb.className = 'safetyBox danger'; sb.style.background = ''; sb.style.color = ''; sb.textContent = gap <= 0 ? '今起きないと遅刻！' : 'ギリギリ！'; }
  $('handNow').style.transform = 'rotate(' + handAngle(v.now) + 'deg)';
  $('handDead').style.transform = 'rotate(' + handAngle(v.deadline) + 'deg)';
  const pn = tipPos(v.now, 33), pd = tipPos(v.deadline, 44);
  Object.assign($('tipNow').style, { left: pn.x + '%', top: pn.y + '%' }); $('tipNow').textContent = '今 ' + Core.fmt(v.now);
  Object.assign($('tipDead').style, { left: pd.x + '%', top: pd.y + '%' }); $('tipDead').textContent = '締切 ' + Core.fmt(v.deadline);

  // 得点トークン
  const board = $('scoreBoard');
  board.querySelectorAll('.scoreTok').forEach(e => e.remove());
  const counts = {};
  v.players.forEach(p => {
    const shown = Math.min(p.score, 39);
    const key = shown + '|' + p.status;
    const rank = counts[shown] = (counts[shown] || 0) + 1;
    const off = (rank - 1) * 7;
    const c = cellCenter(shown);
    const t = document.createElement('div');
    t.className = 'scoreTok';
    t.style.background = p.color;
    t.style.left = (c.x - 12 + off) + 'px';
    t.style.top = (c.y - 12 + off) + 'px';
    t.textContent = p.id + 1;
    t.title = p.name + ' ' + p.score + '点';
    board.appendChild(t);
    if (p.score >= 40) {
      const o = document.createElement('div');
      o.className = 'scoreTok'; o.style.background = '#655576'; o.style.width = '19px'; o.style.height = '19px'; o.style.fontSize = '7px';
      o.style.left = (c.x + 8) + 'px'; o.style.top = (c.y - 20) + 'px';
      o.textContent = p.score >= 80 ? '+80' : '+40';
      board.appendChild(o);
    }
  });

  // プレイヤー行
  $('playerList').innerHTML = v.players.map(p => {
    let chip;
    if (p.status === 'bust') chip = '<span class="chip bust">遅刻 0点</span>';
    else if (p.status === 'safe') chip = '<span class="chip wake">起床済み ' + p.score + '点</span>';
    else if (v.phase === 'choice') chip = p.hasChosen ? '<span class="chip">選んだ ✓</span>' : '<span class="chip wait">選択中…</span>';
    else if (p.choice === 'wake') chip = '<span class="chip wake choiceFlip">起きる</span>';
    else if (p.choice === 'sleep') chip = '<span class="chip sleep choiceFlip">あと5分</span>';
    else chip = '<span class="chip wait">二度寝中</span>';
    const conn = p.connected ? '' : ' <span class="chip wait">切断中（ボット代行）</span>';
    return '<div class="pRow' + (p.id === myPlayerId ? ' me' : '') + (p.status === 'bust' && v.phase === 'choice' && lastPhase === 'eventConfirm' ? ' busted' : '') + '">' +
      '<div class="avatar" style="background:' + p.color + '">' + (p.id + 1) + '</div>' +
      '<div><b>' + esc(p.name) + '</b>' + (p.isBot ? ' <span class="chip">BOT</span>' : '') + conn +
      '<div class="small">ラウンド得点: ' + p.roundScores.map(s => s == null ? '―' : s).join(' / ') + '</div></div>' +
      '<div>' + chip + '</div><div style="font-weight:950;font-size:17px">' + p.total + '点</div></div>';
  }).join('');
  $('logBox').innerHTML = v.logs.map(l => '<div>' + esc(l) + '</div>').join('');

  renderMyArea();
  renderPhaseOverlay();
  lastPhase = v.phase;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* 自分の操作エリア */
function renderMyArea() {
  const v = view; if (!v) return;
  const area = $('myArea');
  if (mode === 'guest' || mode === 'host') {
    const me = v.players[myPlayerId];
    if (!me) { area.innerHTML = ''; return; }
    if (v.phase === 'choice' && me.status === 'sleeping' && !me.hasChosen) {
      area.innerHTML = '<b>あなたの番です</b><div class="voteBig">' +
        '<button class="voteBtn wake" id="myWake"><span class="big">☀</span>起きる</button>' +
        '<button class="voteBtn sleep" id="mySleep"><span class="big">☾</span>あと5分</button></div>' +
        '<div class="small" style="margin-top:8px">締切まであと' + (v.deadline - v.now) + '分。あと5分の基本点は、選んだ人数で決まります（1人=3点／2〜3人=2点／4人以上=1点）。</div>';
      $('myWake').onclick = () => sendMyChoice('wake');
      $('mySleep').onclick = () => sendMyChoice('sleep');
    } else if (v.phase === 'choice' && me.status === 'sleeping') {
      area.innerHTML = '<div class="small">選択済みです。みんなの公開を待っています…</div>';
    } else if (me.status === 'safe') {
      area.innerHTML = '<div class="small">あなたは起床済み（' + me.score + '点確定）。残りの人の様子を見守りましょう。</div>';
    } else if (me.status === 'bust') {
      area.innerHTML = '<div class="small" style="color:#bd5964;font-weight:900">遅刻して0点になりました…次のラウンドで取り返しましょう。</div>';
    } else {
      area.innerHTML = '<div class="small">' + (PHASE_LABEL[v.phase] || '') + ' の様子を表示中です。</div>';
    }
  } else {
    area.innerHTML = '<div class="small">この端末のみんなで操作しています。選択は順番に端末を渡して行います。</div>';
  }
  if (mode === 'host') {
    area.innerHTML += '<div style="margin-top:10px"><button class="btn ghost" id="btnSkip">演出をスキップして進める</button></div>';
    $('btnSkip').onclick = () => { clearTimeout(orchestrateTimer); advanceFromPhase(); };
  }
}

/* フェーズ演出オーバーレイ */
function renderPhaseOverlay() {
  const v = view; if (!v) return;
  if (v.phase === 'reveal') {
    const slept = v.players.filter(p => p.choice === 'sleep').length;
    overlay('<div style="text-align:center"><b style="font-size:20px">一斉公開！</b>' +
      '<div class="small">あと5分 ' + slept + '人 → 基本点 <b style="font-size:16px;color:#a264bd">' + v.currentBp + '点</b></div></div>' +
      '<div class="revealGrid">' + v.players.map((p, i) => {
        if (p.status === 'safe' && p.choice == null) return '';
        const c = p.choice === 'wake' ? '<span class="chip wake choiceFlip" style="animation-delay:' + (i * 0.15) + 's">☀ 起きる</span>'
          : p.choice === 'sleep' ? '<span class="chip sleep choiceFlip" style="animation-delay:' + (i * 0.15) + 's">☾ あと5分</span>' : '<span class="chip wait">―</span>';
        return '<div class="revealCell"><div class="avatar" style="background:' + p.color + ';margin:auto">' + (p.id + 1) + '</div><b>' + esc(p.name) + '</b><div style="margin-top:6px">' + c + '</div></div>';
      }).join('') + '</div>');
  } else if (v.phase === 'nap') {
    overlay('<div style="text-align:center"><b style="font-size:20px">二度寝カード</b></div>' +
      v.pendingNaps.map((x, i) => {
        const p = v.players[x.playerId];
        return '<div style="text-align:center;margin-top:8px"><b>' + esc(p.name) + '</b> <span class="chip sleep">基本' + x.bp + '点 ＋ 補正' + (x.card.bonus >= 0 ? '+' : '') + x.card.bonus + ' → <b>' + x.gain + '点</b></span>' +
          '<div class="flipCard"><div class="flipInner" style="animation-delay:' + (i * 0.35) + 's"><img src="' + x.card.img + '" alt="' + esc(x.card.name) + '"></div></div></div>';
      }).join(''));
  } else if (v.phase === 'eventConfirm' && v.lastEvent) {
    const e = v.lastEvent;
    overlay('<div style="text-align:center"><b style="font-size:20px">登校ハプニング！</b>' +
      '<div style="font-size:26px;font-weight:950;color:' + (e.delta > 0 ? '#2e8b62' : '#d76f94') + ';margin-top:6px">最終出発 ' + (e.delta > 0 ? '+' : '') + e.delta + '分</div></div>' +
      '<div class="flipCard"><div class="flipInner"><img src="' + e.img + '" alt="' + esc(e.name) + '"></div></div>' +
      '<div class="small" style="text-align:center">時刻が5分進みます…</div>');
  } else if (v.phase === 'roundEnd') {
    overlay('<div style="text-align:center"><b style="font-size:20px">第' + v.round + 'ラウンド終了</b></div>' +
      rankHtml(v, false) + '<div class="small" style="text-align:center;margin-top:8px">次のラウンドへ進みます…</div>');
  } else if (v.phase === 'gameEnd') {
    overlay('<div style="text-align:center"><b style="font-size:22px">最終結果</b></div>' + rankHtml(v, true));
    if (lastPhase !== 'gameEnd') confetti();
  } else if (v.phase === 'choice' && passCurrent == null) {
    closeOverlay();
  }
}
function rankHtml(v, final) {
  const sorted = [...v.players].sort((a, b) => b.total - a.total);
  const top = sorted[0] ? sorted[0].total : 0;
  return sorted.map((p, i) => '<div class="pRow' + (p.id === myPlayerId ? ' me' : '') + '">' +
    '<div class="avatar" style="background:' + p.color + '">' + (i + 1) + '</div>' +
    '<div><b>' + esc(p.name) + '</b>' + (final && p.total === top ? ' <span class="chip" style="background:#fff0b8;color:#96741d">優勝</span>' : '') +
    '<div class="small">各ラウンド: ' + p.roundScores.map(s => s == null ? '―' : s).join(' / ') + '</div></div>' +
    '<div></div><div style="font-weight:950;font-size:18px">' + p.total + '点</div></div>').join('') +
    (final && sorted.length > 1 && sorted[1].total === top ? '<div class="small" style="text-align:center">同点首位は引き分け（共同優勝）です</div>' : '');
}

/* ---------- 進行管理（ホスト/ローカル共通） ---------- */
let enteredKey = '';
function syncFromGame() {
  view = game.publicView();
  render();
  if (mode === 'host') broadcast({ type: 'state', view });
  onPhaseEntered();
}
function onPhaseEntered() {
  if (!game) return;
  const key = game.round + '-' + game.turn + '-' + game.phase;
  if (game.phase === 'choice') {
    if (enteredKey !== key) { enteredKey = key; runChoiceCollection(); }
  } else if (game.phase === 'reveal') scheduleAdvance(3000);
  else if (game.phase === 'nap') scheduleAdvance(2400 + game.pendingNaps.length * 1100);
  else if (game.phase === 'event') scheduleAdvance(1000);
  else if (game.phase === 'eventConfirm') scheduleAdvance(3200);
  else if (game.phase === 'roundEnd') scheduleAdvance(4500);
}
function scheduleAdvance(ms) { clearTimeout(orchestrateTimer); orchestrateTimer = setTimeout(advanceFromPhase, ms); }
function advanceFromPhase() {
  if (!game) return;
  if (game.phase === 'reveal') game.resolveReveal();
  else if (game.phase === 'nap') game.applyNaps();
  else if (game.phase === 'event') game.drawEvent();
  else if (game.phase === 'eventConfirm') game.confirmEvent();
  else if (game.phase === 'roundEnd') game.nextRound();
  else return;
  syncFromGame();
}
function submitAndSync(id, choice) {
  if (!game || game.phase !== 'choice') return;
  game.submitChoice(id, choice);
  syncFromGame();
}
function runChoiceCollection() {
  if (!game || game.phase !== 'choice') return;
  // ボットと切断中プレイヤーは自動選択
  game.sleeping().filter(p => (p.isBot || !p.connected) && !p.hasChosen).forEach((p, i) => {
    setTimeout(() => submitAndSync(p.id, game.botChoice(p)), 600 + i * 500 + Math.random() * 400);
  });
  if (mode === 'local') {
    passQueue = game.sleeping().filter(p => localHumanIds.includes(p.id) && !p.hasChosen).map(p => p.id);
    nextPass();
  }
}
function nextPass() {
  if (mode !== 'local' || !game || game.phase !== 'choice') { passCurrent = null; return; }
  const id = passQueue.shift();
  if (id == null) { passCurrent = null; if (game.phase === 'choice') closeOverlay(); return; }
  passCurrent = id;
  const p = game.players[id];
  overlay('<div style="text-align:center"><div class="avatar" style="background:' + p.color + ';margin:auto;width:52px;height:52px;font-size:18px">' + (id + 1) + '</div>' +
    '<h3 style="margin:8px 0 2px">' + esc(p.name) + ' さんの番です</h3>' +
    '<div class="small">他の人は画面を見ないでください</div>' +
    '<div class="small" style="margin-top:6px">今 ' + Core.fmt(game.now) + ' ／ 締切 ' + Core.fmt(game.deadline) + '（あと' + (game.deadline - game.now) + '分）／ 現在 ' + p.score + '点</div>' +
    '<button class="btn main" id="passReady" style="margin-top:12px">' + esc(p.name) + ' です（タップして選択）</button></div>');
  $('passReady').onclick = () => {
    overlay('<div style="text-align:center"><b style="font-size:19px">' + esc(p.name) + ' さん、どうする？</b></div>' +
      '<div class="voteBig"><button class="voteBtn wake" id="pvWake"><span class="big">☀</span>起きる</button>' +
      '<button class="voteBtn sleep" id="pvSleep"><span class="big">☾</span>あと5分</button></div>' +
      '<div class="small" style="margin-top:8px">あと5分の基本点は選んだ人数で決まります（1人=3点／2〜3人=2点／4人以上=1点）。カードの補正（-2〜+2）が付きます。</div>');
    $('pvWake').onclick = () => { passCurrent = null; submitAndSync(id, 'wake'); setTimeout(nextPass, 60); };
    $('pvSleep').onclick = () => { passCurrent = null; submitAndSync(id, 'sleep'); setTimeout(nextPass, 60); };
  };
}

/* ---------- 自分の選択（オンライン） ---------- */
function sendMyChoice(choice) {
  if (mode === 'host') submitAndSync(myPlayerId, choice);
  else if (mode === 'guest' && guestConn && guestConn.open) {
    guestConn.send({ type: 'choice', choice });
    $('myArea').innerHTML = '<div class="small">送信しました。公開を待っています…</div>';
  }
}

/* ---------- ローカルモード ---------- */
function buildLocalNames() {
  const n = parseInt($('localHumans').value, 10);
  $('localNames').innerHTML = Array.from({ length: n }, (_, i) =>
    '<label style="display:block;margin-top:6px">プレイヤー' + (i + 1) + ' の名前</label><input class="localName" maxlength="12" value="プレイヤー' + (i + 1) + '">').join('');
}
$('localHumans').addEventListener('change', buildLocalNames);
buildLocalNames();
$('btnLocal').onclick = () => { show('scr-local'); };
$('btnLocalStart').onclick = () => {
  const names = [...document.querySelectorAll('.localName')].map(i => i.value.trim() || i.placeholder);
  const bots = parseInt($('localBots').value, 10);
  const total = names.length + bots;
  if (total < 2 || total > 6) { $('localErr').textContent = '合計が2〜6人になるようにしてください（今は' + total + '人）'; return; }
  $('localErr').textContent = '';
  const players = names.map(n => ({ name: n }));
  for (let i = 0; i < bots; i++) players.push({ name: BOT_NAMES[i], isBot: true });
  localHumanIds = names.map((_, i) => i);
  myPlayerId = -1;
  mode = 'local';
  game = new Core.Game(players);
  game.startGame();
  show('scr-game');
  enteredKey = '';
  syncFromGame();
};

/* ---------- オンライン: 共通 ---------- */
let peer = null, guestConn = null;
const hostConns = new Map(); // peerId -> {conn, rosterIdx}
let roster = [];             // ホスト側ロビー [{name, isBot}]
const PEER_PREFIX = 'ato5room-';
function roomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function broadcast(msg) { hostConns.forEach(({ conn }) => { if (conn && conn.open) conn.send(msg); }); }
function lobbyView() {
  return roster.map((r, i) => ({ name: r.name, isBot: r.isBot, id: i }));
}
function renderLobby() {
  $('memberList').innerHTML = roster.map((r, i) =>
    '<div class="memberRow"><div class="avatar" style="background:' + Core.COLORS[i] + '">' + (i + 1) + '</div><b>' + esc(r.name) + '</b>' +
    (r.isBot ? '<span class="chip">BOT</span>' : '') + (i === 0 ? '<span class="chip wake">ホスト</span>' : '') + '</div>').join('');
  $('lobbyCount').textContent = '（' + roster.length + '人 / 2〜6人）';
  if (mode === 'guest') {
    $('memberList').innerHTML = guestRoster.map((r, i) =>
      '<div class="memberRow"><div class="avatar" style="background:' + Core.COLORS[i] + '">' + (i + 1) + '</div><b>' + esc(r.name) + '</b>' +
      (r.isBot ? '<span class="chip">BOT</span>' : '') + (i === 0 ? '<span class="chip wake">ホスト</span>' : '') + '</div>').join('');
    $('lobbyCount').textContent = '（' + guestRoster.length + '人）';
  }
}
let guestRoster = [];

/* ---------- ホスト ---------- */
$('btnCreate').onclick = () => {
  const name = ($('myName').value || '').trim();
  if (!name) { alert('名前を入力してください'); return; }
  if (typeof Peer === 'undefined') { alert('オンライン機能を読み込めませんでした。通信環境を確認してください'); return; }
  mode = 'host'; myPlayerId = 0;
  roster = [{ name, isBot: false }];
  const code = roomCode();
  peer = new Peer(PEER_PREFIX + code);
  peer.on('open', () => {
    $('roomCodeTxt').textContent = code;
    const url = location.origin + location.pathname + '?room=' + code;
    $('joinUrlTxt').textContent = url;
    if (typeof qrcode !== 'undefined') {
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      $('qrBox').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 10, scalable: true });
    } else $('qrBox').innerHTML = '<div class="small">QR生成に失敗しました。URLを共有してください</div>';
    show('scr-lobby');
    $('hostLobbyBtns').classList.remove('hidden');
    $('guestLobbyMsg').classList.add('hidden');
    renderLobby();
  });
  peer.on('connection', conn => {
    conn.on('data', msg => {
      if (msg.type === 'join') {
        if (game) { conn.send({ type: 'error', message: 'ゲーム進行中のため参加できません' }); return; }
        if (roster.length >= 6) { conn.send({ type: 'error', message: '部屋が満員です' }); return; }
        roster.push({ name: String(msg.name || 'ゲスト').slice(0, 12), isBot: false });
        const idx = roster.length - 1;
        hostConns.set(conn.peer, { conn, rosterIdx: idx });
        conn.send({ type: 'welcome', playerId: idx, roster: lobbyView() });
        broadcast({ type: 'lobby', roster: lobbyView() });
        renderLobby();
      } else if (msg.type === 'choice' && game) {
        const rec = hostConns.get(conn.peer);
        if (rec) submitAndSync(rec.rosterIdx, msg.choice);
      }
    });
    conn.on('close', () => {
      const rec = hostConns.get(conn.peer);
      hostConns.delete(conn.peer);
      if (rec && game) {
        game.players[rec.rosterIdx].connected = false;
        syncFromGame();
        if (game.phase === 'choice') runChoiceCollection();
      }
    });
  });
  peer.on('error', e => { console.warn('peer error', e); });
};
$('btnAddBot').onclick = () => {
  if (roster.length >= 6) { $('lobbyErr').textContent = '最大6人です'; return; }
  roster.push({ name: BOT_NAMES[roster.filter(r => r.isBot).length] || 'ボット', isBot: true });
  broadcast({ type: 'lobby', roster: lobbyView() });
  renderLobby();
};
$('btnStartGame').onclick = () => {
  if (roster.length < 2) { $('lobbyErr').textContent = '2人以上で開始できます。ボット追加もできます'; return; }
  $('lobbyErr').textContent = '';
  game = new Core.Game(roster.map(r => ({ name: r.name, isBot: r.isBot })));
  game.startGame();
  broadcast({ type: 'start' });
  show('scr-game');
  enteredKey = '';
  syncFromGame();
};

/* ---------- ゲスト ---------- */
function doJoin(code, name) {
  if (typeof Peer === 'undefined') { $('joinStatus').textContent = 'オンライン機能を読み込めませんでした'; return; }
  mode = 'guest';
  const st = m => { const el = $('joinStatus'); if (el) el.textContent = m; $('btnJoin').textContent = m; };
  st('接続しています…');
  let welcomed = false;
  peer = new Peer();
  const timer = setTimeout(() => { if (!welcomed) st('接続できませんでした。ホストの画面が開いたままになっているか、部屋コードが合っているか確認してください'); }, 15000);
  peer.on('open', () => {
    st('部屋に接続しています…');
    guestConn = peer.connect(PEER_PREFIX + code, { reliable: true });
    guestConn.on('open', () => { st('入室しています…'); guestConn.send({ type: 'join', name }); });
    guestConn.on('error', e => { st('接続でエラーが出ました。もう一度お試しください'); console.warn(e); });
    guestConn.on('data', msg => {
      if (msg.type === 'welcome') {
        welcomed = true; clearTimeout(timer);
        myPlayerId = msg.playerId; guestRoster = msg.roster;
        show('scr-lobby');
        $('hostLobbyBtns').classList.add('hidden');
        $('guestLobbyMsg').classList.remove('hidden');
        $('roomCodeTxt').textContent = code;
        $('qrBox').innerHTML = '';
        $('joinUrlTxt').textContent = '参加できました。ホストの開始を待っています';
        renderLobby();
      } else if (msg.type === 'lobby') { guestRoster = msg.roster; renderLobby(); }
      else if (msg.type === 'start') { show('scr-game'); }
      else if (msg.type === 'state') { view = msg.view; if ($('scr-game').classList.contains('hidden')) show('scr-game'); render(); }
      else if (msg.type === 'error') { st(msg.message); }
    });
    guestConn.on('close', () => { if (welcomed) alert('ホストとの接続が切れました'); });
  });
  peer.on('error', e => {
    clearTimeout(timer);
    st(e && e.type === 'peer-unavailable' ? '部屋が見つかりませんでした。ホストの画面が開いたままか確認してください' : '接続できませんでした。通信環境と部屋コードを確認してください');
    console.warn(e);
  });
}
$('btnShowJoin').onclick = () => $('joinBox').classList.toggle('hidden');
$('btnJoin').onclick = () => {
  const name = ($('myName').value || '').trim();
  const code = ($('joinCode').value || '').trim().toUpperCase();
  if (!name) { alert('名前を入力してください'); return; }
  if (code.length !== 6) { alert('部屋コードは6文字です'); return; }
  doJoin(code, name);
};

/* ---------- 初期化 ---------- */
document.querySelectorAll('[data-back="home"]').forEach(b => b.onclick = () => show('scr-home'));
if (typeof Peer === 'undefined' || typeof qrcode === 'undefined') $('netWarn').classList.remove('hidden');
(function initFromUrl() {
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    $('joinBox').classList.remove('hidden');
    $('joinCode').value = room.toUpperCase();
    $('myName').focus();
  }
})();
