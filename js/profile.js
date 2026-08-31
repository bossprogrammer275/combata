// Persistent player profile: coins, owned cosmetics, equipped loadout, and BR
// progress (wins/matches/level). Saved to localStorage so it survives reloads.
const KEY = 'sc_profile_v1';

const DEFAULTS = {
  coins: 800,
  // owned cosmetic ids (caps/glasses are boolean unlocks; outfits are owned ids)
  owned: {
    caps: false,
    glasses: false,
    outfits: ['camo', 'navy', 'soldier', 'casual'], // camo + starter sets free
    clothColors: [0, 1, 2, 3, 4, 5, 6, 7],          // index into clothesPalette
  },
  equipped: {
    outfit: 'camo',
    clothColor: 0,
    cap: false,
    glasses: false,
  },
  progress: { wins: 0, matches: 0, kills: 0, level: 1, xp: 0 },
  settings: { sens: 1, vol: 0.7, quality: 'ultra-low' },
};

// Shop catalogue (ids map to real cosmetics). Prices in coins.
export const SHOP = {
  caps: { id: 'caps', name: 'TACTICAL CAP', price: 300, desc: 'Baseball-style operator cap' },
  glasses: { id: 'glasses', name: 'TACTICAL SHADES', price: 450, desc: 'Combat eye protection' },
  outfits: [
    { id: 'navy', name: 'NAVY OPERATOR', price: 0, desc: 'Deep navy uniform (default)' },
    { id: 'soldier', name: 'INFANTRY TAN', price: 0, desc: 'Desert soldier tan (default)' },
    { id: 'casual', name: 'COVERT CIVILIAN', price: 600, desc: 'Low-profile casual look' },
    { id: 'cadpat', name: 'WOODLAND CADPAT', price: 750, desc: 'Forest digital camo' },
    { id: 'urban', name: 'URBAN GREY', price: 750, desc: 'City grey camo' },
  ],
  ammo: [
    { id: 'ammo_s', name: 'RIFLE AMMO x120', price: 120, weapon: 'rifle', amount: 120 },
    { id: 'ammo_p', name: 'PISTOL AMMO x60', price: 80, weapon: 'pistol', amount: 60 },
    { id: 'ammo_d', name: 'DMR AMMO x40', price: 140, weapon: 'dmr', amount: 40 },
    { id: 'ammo_l', name: 'LMG AMMO x200', price: 200, weapon: 'lmg', amount: 200 },
    { id: 'ammo_sn', name: 'SNIPER AMMO x20', price: 180, weapon: 'sniper', amount: 20 },
    { id: 'ammo_r', name: 'ROCKET x4', price: 300, weapon: 'rocket', amount: 4 },
    { id: 'ammo_g', name: 'GRENADES x4', price: 150, weapon: 'grenade', amount: 4 },
    { id: 'ammo_f', name: 'FUEL TANK x200', price: 180, weapon: 'flame', amount: 200 },
  ],
};

export class Profile {
  constructor() { this.load(); }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), d);
        // deep-merge owned/equipped/progress/settings
        this.data.owned = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.owned)), d.owned || {});
        this.data.equipped = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.equipped)), d.equipped || {});
        this.data.progress = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.progress)), d.progress || {});
    this.data.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.settings)), d.settings || {});
    // Auto-detect low-end hardware
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) this.data.settings.quality = 'ultra-low';
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) this.data.settings.quality = 'ultra-low';
    return;
      }
    } catch (e) { console.warn('profile load failed', e); }
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {}
  }

  get coins() { return this.data.coins; }
  addCoins(n) { this.data.coins = Math.max(0, this.data.coins + n); this.save(); }
  spend(n) {
    if (this.data.coins < n) return false;
    this.data.coins -= n; this.save(); return true;
  }

  owns(kind, id) {
    if (kind === 'caps' || kind === 'glasses') return !!this.data.owned[kind];
    if (kind === 'outfit') return this.data.owned.outfits.includes(id);
    if (kind === 'cloth') return this.data.owned.clothColors.includes(id);
    return false;
  }

  buy(kind, id) {
    let entry;
    if (kind === 'caps' || kind === 'glasses') entry = SHOP[kind];
    else if (kind === 'outfit') entry = SHOP.outfits.find(o => o.id === id);
    else if (kind === 'ammo') entry = SHOP.ammo.find(a => a.id === id);
    if (!entry) return { ok: false, msg: 'Unknown item' };
    if (this.owns(kind, id)) return { ok: false, msg: 'Already owned' };
    if (!this.spend(entry.price)) return { ok: false, msg: 'Not enough coins' };
    if (kind === 'caps') this.data.owned.caps = true;
    else if (kind === 'glasses') this.data.owned.glasses = true;
    else if (kind === 'outfit') this.data.owned.outfits.push(id);
    this.save();
    return { ok: true, entry };
  }

  equip(kind, id) {
    if (kind === 'outfit') { if (!this.owns('outfit', id)) return false; this.data.equipped.outfit = id; }
    else if (kind === 'cloth') { if (!this.owns('cloth', id)) return false; this.data.equipped.clothColor = id; }
    else if (kind === 'cap') this.data.equipped.cap = id;
    else if (kind === 'glasses') this.data.equipped.glasses = id;
    this.save(); return true;
  }

  buyAmmo(id) {
    const entry = SHOP.ammo.find(a => a.id === id);
    if (!entry) return { ok: false, msg: 'Unknown' };
    if (!this.spend(entry.price)) return { ok: false, msg: 'Not enough coins' };
    return { ok: true, entry };
  }

  // XP / leveling — each match grants XP; level raises bot count & lobby size
  addMatchResult({ won, kills }) {
    this.data.progress.matches++;
    this.data.progress.kills += kills;
    this.data.progress.xp += (won ? 120 : 40) + kills * 10;
    if (won) this.data.progress.wins++;
    while (this.data.progress.xp >= this.data.progress.level * 500) {
      this.data.progress.xp -= this.data.progress.level * 500;
      this.data.progress.level++;
    }
    this.save();
  }

  // BR: squad/lobby size grows with level (capped at 50 hostiles for a full battlefield)
  get lobbySize() { return 5; }
}
