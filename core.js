/* あと5分だけ… ゲーム本体ロジック（UI非依存 / 仕様 SPEC_v1 準拠）
   ブラウザでは window.Ato5Core、Nodeでは module.exports として使う */
(function (global) {
  'use strict';
  const EVENTS = [
    ['信号が全部青', 5], ['近道を発見', 5], ['電車が空いている', 5], ['バスが早く来た', 5],
    ['道が空いている', 5], ['先生が遅刻', 5], ['忘れ物に気づく', -5], ['急な雨', -5],
    ['踏切が開かない', -10], ['電車の遅延', -10], ['バスが遅れる', -10], ['道路工事', -10],
    ['自転車がパンク', -10], ['階段で転ぶ', -5], ['友達に呼び止められる', -5], ['コンビニに寄ってしまう', -5]
  ].map((a, i) => ({ id: 'E' + String(i + 1).padStart(2, '0'), name: a[0], delta: a[1], img: 'assets/event_' + String(i).padStart(2, '0') + '.png' }));
  const NAPS = [
    ['奇跡の爆睡', 2], ['深い眠り', 2], ['布団が最高', 1], ['幸せな夢', 1],
    ['スマホ見ちゃった', -1], ['もう少しだけ…', -1], ['変な夢', -2], ['寝坊の予感', -2]
  ].map((a, i) => ({ id: 'N' + String(i + 1).padStart(2, '0'), name: a[0], bonus: a[1], img: 'assets/nap_' + String(i).padStart(2, '0') + '.png' }));

  const MIN = 435, START = 450, INIT_DEADLINE = 505, MAX = 530;
  const COLORS = ['#3498db', '#43b77a', '#ff7e9e', '#7c68c7', '#f59439', '#2bb3b0'];

  function shuffled(arr, rnd) {
    const a = arr.map(x => ({ ...x }));
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /* 基本点ルールA: あと5分を選んだ人数で決まる */
  function basePointsFor(sleptCount) { return sleptCount >= 4 ? 1 : sleptCount >= 2 ? 2 : sleptCount === 1 ? 3 : 0; }

  class Game {
    constructor(players, rnd) {
      this.rnd = rnd || Math.random;
      this.players = players.map((p, i) => ({
        id: i, name: p.name || ('P' + (i + 1)), isBot: !!p.isBot, connected: true,
        color: COLORS[i], status: 'sleeping', score: 0, final: null,
        choice: null, hasChosen: false, hasReady: false, lastNap: null, lastGain: null,
        roundScores: [null, null, null], total: 0
      }));
      this.round = 1; this.turn = 1;
      this.phase = 'lobby'; // lobby|check|choice|reveal|napDraw|event|eventConfirm|roundEnd|gameEnd
      this.logs = [];
      this.resetRound();
    }
    resetRound() {
      this.now = START; this.deadline = INIT_DEADLINE;
      this.eventDeck = shuffled(EVENTS, this.rnd); this.ei = 0;
      this.napDeck = shuffled(NAPS, this.rnd); this.ni = 0;
      this.lastEvent = null; this.pendingNaps = []; this.currentBp = null;
      this.players.forEach(p => { p.status = 'sleeping'; p.score = 0; p.final = null; p.choice = null; p.hasChosen = false; p.hasReady = false; p.lastNap = null; p.lastGain = null; });
    }
    log(t) { this.logs.unshift('[R' + this.round + '] ' + t); if (this.logs.length > 60) this.logs.pop(); }
    sleeping() { return this.players.filter(p => p.status === 'sleeping'); }
    startGame() { this.resetRound(); this.round = 1; this.turn = 1; this.beginCheck(); this.log('第1ラウンド開始'); }
    beginCheck() {
      this.phase = 'check';
      this.players.forEach(p => { p.hasReady = false; p.choice = null; p.hasChosen = false; });
    }
    submitReady(id) {
      if (this.phase !== 'check') return false;
      const p = this.players[id];
      if (!p || p.status !== 'sleeping') return false;
      p.hasReady = true;
      if (this.sleeping().every(q => q.hasReady)) {
        this.players.forEach(q => { q.hasReady = false; });
        this.phase = 'choice';
      }
      return true;
    }
    drawEventCard() { if (this.ei >= this.eventDeck.length) { this.eventDeck = shuffled(EVENTS, this.rnd); this.ei = 0; } return this.eventDeck[this.ei++]; }
    drawNapCard() { if (this.ni >= this.napDeck.length) { this.napDeck = shuffled(NAPS, this.rnd); this.ni = 0; } return this.napDeck[this.ni++]; }

    submitChoice(id, choice) {
      if (this.phase !== 'choice') return false;
      const p = this.players[id];
      if (!p || p.status !== 'sleeping') return false;
      p.choice = choice; p.hasChosen = true;
      if (this.sleeping().every(q => q.hasChosen)) this.toReveal();
      return true;
    }
    toReveal() {
      this.phase = 'reveal';
      const slept = this.sleeping().filter(p => p.choice === 'sleep').length;
      this.currentBp = basePointsFor(slept);
    }
    /* 公開を確定し、起床処理＋二度寝カード配布まで進める */
    resolveReveal() {
      if (this.phase !== 'reveal') return;
      this.sleeping().filter(p => p.choice === 'wake').forEach(p => {
        p.status = 'safe'; p.final = p.score; this.log(p.name + ' 起床 ' + p.score + '点確定');
      });
      this.pendingNaps = [];
      this.sleeping().filter(p => p.choice === 'sleep').forEach(p => {
        const card = this.drawNapCard();
        const gain = Math.max(0, this.currentBp + card.bonus);
        this.pendingNaps.push({ playerId: p.id, card, gain, bp: this.currentBp, drawn: false });
      });
      if (this.pendingNaps.length) { this.phase = 'napDraw'; }
      else this.afterScoring();
    }
    markNapDrawn(id) {
      if (this.phase !== 'napDraw') return false;
      const x = this.pendingNaps.find(n => n.playerId === id);
      if (!x || x.drawn) return false;
      x.drawn = true;
      return this.pendingNaps.every(n => n.drawn);
    }
    applyNaps() {
      if (this.phase !== 'napDraw') return;
      if (!this.pendingNaps.every(n => n.drawn)) return;
      this.pendingNaps.forEach(x => {
        const p = this.players[x.playerId];
        p.score += x.gain; p.lastNap = x.card; p.lastGain = x.gain;
        this.log(p.name + '「' + x.card.name + '」 +' + x.gain + '点');
      });
      this.players.forEach(p => { p.choice = null; p.hasChosen = false; });
      this.afterScoring();
    }
    afterScoring() {
      if (this.sleeping().length === 0) { this.finishRound(); return; }
      this.phase = 'event';
    }
    drawEvent() {
      if (this.phase !== 'event') return null;
      const e = this.drawEventCard();
      this.lastEvent = e;
      this.deadline = Math.max(MIN, Math.min(MAX, this.deadline + e.delta));
      this.log('ハプニング「' + e.name + '」 最終出発 ' + (e.delta > 0 ? '+' : '') + e.delta + '分');
      this.phase = 'eventConfirm';
      return e;
    }
    confirmEvent() {
      if (this.phase !== 'eventConfirm') return;
      this.now += 5;
      if (this.now > this.deadline) {
        this.sleeping().forEach(p => { p.status = 'bust'; p.score = 0; p.final = 0; this.log(p.name + ' 遅刻で0点'); });
      }
      if (this.sleeping().length === 0) { this.finishRound(); return; }
      this.turn++; this.beginCheck();
    }
    finishRound() {
      this.players.forEach(p => {
        const rs = p.status === 'safe' ? (p.final != null ? p.final : p.score) : 0;
        p.roundScores[this.round - 1] = rs; p.total += rs;
      });
      this.phase = this.round >= 3 ? 'gameEnd' : 'roundEnd';
      this.log('第' + this.round + 'ラウンド終了');
    }
    nextRound() {
      if (this.phase !== 'roundEnd') return;
      this.round++; this.turn = 1; this.resetRound(); this.beginCheck();
      this.log('第' + this.round + 'ラウンド開始');
    }
    /* ボットの選択: 締切までの余裕で判断 */
    botChoice(p) {
      const gap = this.deadline - this.now;
      const r = this.rnd();
      if (gap >= 20) return 'sleep';
      if (gap >= 15) return r < 0.8 ? 'sleep' : 'wake';
      if (gap >= 10) return r < 0.45 ? 'sleep' : 'wake';
      if (gap >= 5) return r < 0.15 ? 'sleep' : 'wake';
      return 'wake';
    }
    /* 観戦者・他プレイヤーに見せてよい状態（選択中は中身を隠す） */
    publicView() {
      const hideChoices = this.phase === 'choice';
      return {
        round: this.round, turn: this.turn, phase: this.phase,
        now: this.now, deadline: this.deadline, currentBp: this.currentBp,
        lastEvent: this.lastEvent, pendingNaps: this.phase === 'napDraw' || this.phase === 'event' || this.phase === 'eventConfirm' ? this.pendingNaps : [],
        logs: this.logs.slice(0, 12),
        players: this.players.map(p => ({
          id: p.id, name: p.name, isBot: p.isBot, connected: p.connected, color: p.color,
          status: p.status, score: p.status === 'bust' ? 0 : (p.final != null && p.status === 'safe' ? p.final : p.score),
          hasChosen: p.hasChosen, hasReady: p.hasReady, choice: hideChoices ? null : p.choice,
          lastNap: p.lastNap, lastGain: p.lastGain,
          roundScores: p.roundScores, total: p.total
        }))
      };
    }
  }

  const Core = { EVENTS, NAPS, Game, basePointsFor, COLORS, fmt: m => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') };
  global.Ato5Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
