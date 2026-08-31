const ACHIEVEMENTS = [
  // Skill-based
  { id: 'first_blood', name: 'FIRST BLOOD', desc: 'Get your first kill', icon: '🗡', tier: 'common', check: p => p.totalKills >= 1 },
  { id: 'headshot_master', name: 'HEADSHOT MASTER', desc: 'Get 10 headshots', icon: '🎯', tier: 'rare', check: p => p.headshots >= 10 },
  { id: 'no_scope', name: 'NO SCOPE', desc: 'Kill an enemy without aiming', icon: '👁', tier: 'rare', check: p => p.noScopeKills >= 1 },
  { id: 'arsenal', name: 'ARSENAL', desc: 'Kill with each weapon type', icon: '🔫', tier: 'rare', check: p => p.weaponKills && Object.keys(p.weaponKills).length >= 6 },
  // Kill chain
  { id: 'double_kill', name: 'DOUBLE TROUBLE', desc: 'Get a double kill', icon: '⚡', tier: 'common', check: p => p.doubleKills >= 1 },
  { id: 'triple_kill', name: 'TRIPLE THREAT', desc: 'Get a triple kill', icon: '🔥', tier: 'rare', check: p => p.tripleKills >= 1 },
  { id: 'rampage', name: 'RAMPAGE', desc: 'Get a 4+ kill chain', icon: '💀', tier: 'legendary', check: p => p.rampages >= 1 },
  // Combat
  { id: 'chain_explosion', name: 'DOMINO EFFECT', desc: 'Trigger a chain explosion', icon: '💥', tier: 'rare', check: p => p.chainExplosions >= 1 },
  { id: 'flame_kills', name: 'FIREBUG', desc: '100 total kills with flamethrower', icon: '🔥', tier: 'legendary', check: p => (p.weaponKills?.flame || 0) >= 100 },
  // Meta
  { id: 'level_10', name: 'VETERAN', desc: 'Reach level 10', icon: '⭐', tier: 'rare', check: p => p.level >= 10 },
  { id: 'level_25', name: 'ELITE', desc: 'Reach level 25', icon: '🌟', tier: 'legendary', check: p => p.level >= 25 },
  { id: 'collector', name: 'COLLECTOR', desc: 'Own all cosmetics in a category', icon: '👗', tier: 'rare', check: p => p.allCosmeticsOwned >= 1 },
];

const TIER_COLORS = { common: '#c9a227', rare: '#4a9eff', legendary: '#ff4a4a' };
const TIER_CHIMES = {
  common: { freq: 880, dur: 0.12 },
  rare: { freq: 1100, dur: 0.2 },
  legendary: { freq: 1320, dur: 0.3 },
};

export class AchievementSystem {
  constructor(profile, audio) {
    this.profile = profile;
    this.audio = audio;
    this.unlocked = this.loadUnlocked();
    this.progress = this.loadProgress();
    this.queue = [];
    this.showing = false;
  }

  loadUnlocked() {
    try { return JSON.parse(localStorage.getItem('sc_achievements') || '[]'); } catch (e) { return []; }
  }

  saveUnlocked() {
    localStorage.setItem('sc_achievements', JSON.stringify(this.unlocked));
  }

  loadProgress() {
    try {
      return JSON.parse(localStorage.getItem('sc_ach_progress') || '{}');
    } catch (e) {
      return {};
    }
  }

  saveProgress() {
    localStorage.setItem('sc_ach_progress', JSON.stringify(this.progress));
  }

  getProgress() {
    return { ...this.progress, totalKills: this.profile.data.progress.kills, level: this.profile.data.progress.level };
  }

  check(hud) {
    const prog = this.getProgress();
    for (const ach of ACHIEVEMENTS) {
      if (this.unlocked.includes(ach.id)) continue;
      if (ach.check(prog)) {
        this.unlocked.push(ach.id);
        this.saveUnlocked();
        this.queue.push(ach);
      }
    }
    if (this.queue.length > 0 && !this.showing) this.showNext(hud);
  }

  showNext(hud) {
    if (this.queue.length === 0) { this.showing = false; return; }
    this.showing = true;
    const ach = this.queue.shift();
    hud.showAchievementToast(ach, TIER_COLORS[ach.tier], TIER_CHIMES[ach.tier], () => {
      setTimeout(() => this.showNext(hud), 500);
    });
    if (this.audio && this.audio._tone) {
      setTimeout(() => {
        this.audio._tone(TIER_CHIMES[ach.tier].freq, TIER_CHIMES[ach.tier].dur, 0.15, 'sine', TIER_CHIMES[ach.tier].freq * 0.75);
      }, 50);
    }
  }
}

export { ACHIEVEMENTS, TIER_COLORS };
