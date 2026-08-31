// ===== ASSET LOADER =====
// Loads every authored asset (buildings, props, nature, vehicles) from the
// per-asset files in this folder and installs them onto World.prototype,
// along with the routing dispatchers (_authoredBuilding / _authoredProp /
// _authoredReactive / _authoredLandmark). The main game and the asset
// viewer both import installAssets from here.
import { installShop } from './buildings/shop.js';
import { installTower } from './buildings/tower.js';
import { installShell } from './buildings/shell.js';
import { installPlainbox } from './buildings/plainbox.js';
import { installHouseDetailed } from './buildings/housedetailed.js';
import { installApartment } from './buildings/apartment.js';
import { installLcorner } from './buildings/lcorner.js';
import { installRowhouse } from './buildings/rowhouse.js';
import { installMosque } from './buildings/mosque.js';
import { installSchool } from './buildings/school.js';
import { installStore } from './buildings/store.js';
import { installMall } from './buildings/mall.js';
import { installStadium } from './buildings/stadium.js';
import { installFirestation } from './buildings/firestation.js';
import { installGasstation } from './buildings/gasstation.js';
import { installMotel } from './buildings/motel.js';
import { installSupermarket } from './buildings/supermarket.js';
import { installParking } from './buildings/parking.js';
import { installEnterableContainer } from './buildings/enterablecontainer.js';
import { installTransitStation } from './buildings/transitstation.js';
import { installEnterableBuilding } from './buildings/enterablebuilding.js';
import { installHouse } from './buildings/house.js';
import { installHighrise } from './buildings/highrise.js';
import { installBank } from './buildings/bank.js';
import { installHospital } from './buildings/hospital.js';
import { installTownhouse } from './buildings/townhouse.js';
import { installWarehouse } from './buildings/warehouse.js';
import { installTrainStation } from './buildings/trainstation.js';
import { installFuelTank } from './buildings/fueltank.js';
import { installPort } from './buildings/port.js';
import { installLuxuryVilla } from './buildings/luxuryvilla.js';
import { installArtDecoHotel } from './buildings/artdecohotel.js';
import { installNightclub } from './buildings/nightclub.js';
import { installPoliceStation } from './buildings/policestation.js';
import { installMarinaPier } from './buildings/marinapier.js';
import { installAirportHangar } from './buildings/airporthangar.js';
import { installModernPetrol } from './buildings/modernpetrol.js';
import { installPenthouseTower } from './buildings/penthousetower.js';

import { installCrate } from './props/crate.js';
import { installWoodcrate } from './props/woodcrate.js';
import { installCrates } from './props/crates.js';
import { installBarrels } from './props/barrels.js';
import { installBarrel } from './props/barrel.js';
import { installBox } from './props/box.js';
import { installStairs } from './props/stairs.js';
import { installLamp } from './props/lamp.js';
import { installHydrant } from './props/hydrant.js';
import { installDumpster } from './props/dumpster.js';
import { installTrashcan } from './props/trashcan.js';
import { installMailbox } from './props/mailbox.js';
import { installBusstop } from './props/busstop.js';
import { installTrafficlight } from './props/trafficlight.js';
import { installPole } from './props/pole.js';
import { installPlanter } from './props/planter.js';
import { installBollard } from './props/bollard.js';
import { installBillboard } from './props/billboard.js';
import { installUmbrella } from './props/umbrella.js';
import { installCafetable } from './props/cafetable.js';
import { installBench } from './props/bench.js';
import { installWreck } from './props/wreck.js';

import { installTree } from './nature/tree.js';
import { installPalm } from './nature/palm.js';
import { installHill } from './nature/hill.js';
import { installRockField } from './nature/rockfield.js';

function rng(a, b) { return a + Math.random() * (b - a); }

export function installAssets(World) {
  // --- buildings ---
  installShop(World);
  installTower(World);
  installShell(World);
  installPlainbox(World);
  installHouseDetailed(World);
  installApartment(World);
  installLcorner(World);
  installRowhouse(World);
  installMosque(World);
  installSchool(World);
  installStore(World);
  installMall(World);
  installStadium(World);
  installFirestation(World);
  installGasstation(World);
  installMotel(World);
  installSupermarket(World);
  installParking(World);
  installEnterableContainer(World);
  installTransitStation(World);
  installEnterableBuilding(World);
  installHouse(World);
  installHighrise(World);
  installBank(World);
  installHospital(World);
  installTownhouse(World);
  installWarehouse(World);
  installTrainStation(World);
  installFuelTank(World);
  installPort(World);
  installLuxuryVilla(World);
  installArtDecoHotel(World);
  installNightclub(World);
  installPoliceStation(World);
  installMarinaPier(World);
  installAirportHangar(World);
  installModernPetrol(World);
  installPenthouseTower(World);

  // --- props ---
  installCrate(World);
  installWoodcrate(World);
  installCrates(World);
  installBarrels(World);
  installBarrel(World);
  installBox(World);
  installStairs(World);
  installLamp(World);
  installHydrant(World);
  installDumpster(World);
  installTrashcan(World);
  installMailbox(World);
  installBusstop(World);
  installTrafficlight(World);
  installPole(World);
  installPlanter(World);
  installBollard(World);
  installBillboard(World);
  installUmbrella(World);
  installCafetable(World);
  installBench(World);
  installWreck(World);

  // --- nature ---
  installTree(World);
  installPalm(World);
  installHill(World);
  installRockField(World);

  // ===== ROUTING DISPATCHERS =====

  // Building dispatcher — routes JSON building entries to the asset builders.
  World.prototype._authoredBuilding = function (b) {
    const x = b.x, z = b.z, ry = b.ry || 0;
    const kind = b.kind || 'box';
    const mat = this._sceneMat(b.m);
    const solid = b.solid !== false;
    const doorW = b.doorW || 3;
    const w = b.w || 12, h = b.h || 4, d = b.d || 12;
    const style = b.style || (b.m === 'brick' ? 'tenement' : b.m === 'wood' ? 'cottage' : b.m === 'metal' ? 'industrial' : 'office');
    const seed = b.seed || 1;
    const roofMat = this._sceneMat(b.roofM || 'roof');
    if (kind === 'shop') this.shop(x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b);
    else if (kind === 'tower') this.tower(x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b);
    else if (kind === 'shell') this.shell(x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b);
    else if (kind === 'container') {
      this.enterableContainer(x, z, ry, mat);
      this.lootPoints.push({ x: x, z: z });
    } else if (kind === 'house') {
      this.houseDetailed(x, z, ry, w, d, h, b.m === 'brick' ? 'brick' : b.m === 'wood' ? 'wood' : 'plaster', solid, seed);
    } else if (kind === 'apartment') {
      this.apartment(x, z, ry, w, d, b.floors || Math.round(h / 3), solid, seed);
    } else if (kind === 'lcorner') {
      this.lcorner(x, z, ry, w, d, b.wing || 10, h, solid, seed);
    } else if (kind === 'rowhouse') {
      this.rowhouse(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'church' || kind === 'mosque') {
      this.mosque(x, z, ry, w, d, solid, seed);
    } else if (kind === 'gasstation') {
      this.gasstation(x, z, ry, solid, seed);
    } else if (kind === 'motel') {
      this.motel(x, z, ry, w, d, solid, seed);
    } else if (kind === 'supermarket') {
      this.supermarket(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'parking') {
      this.parking(x, z, ry, w, d, b.floors || 3, solid, seed);
    } else if (kind === 'school') {
      this.school(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'store') {
      this.store(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'mall') {
      this.mall(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'stadium') {
      this.stadium(x, z, ry, solid, seed);
    } else if (kind === 'firestation') {
      this.firestation(x, z, ry, solid, seed);
    } else if (kind === 'bank') {
      this.bank(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'hospital') {
      this.hospital(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'townhouse') {
      this.townhouse(x, z, ry, w, d, h, solid, seed);
    } else if (kind === 'enterablebuilding') {
      this.enterableBuilding(x, z, w, h, d, mat, ry, solid);
    } else if (kind === 'fuel') {
      this.fuelTank(x, z, b.r || 3, b.h || 7, solid);
    } else if (kind === 'highrise') {
      this.highrise(x, z, ry, b.floors || Math.round(h / 3), w, d, h, solid);
    } else if (kind === 'penthousetower' || kind === 'penthouse' || kind === 'helipad') {
      this.penthouseTower(x, z, ry, b.floors || 8, w || 18, d || 18, solid, seed);
    } else if (kind === 'luxuryvilla' || kind === 'villa' || kind === 'mansion') {
      this.luxuryVilla(x, z, ry, w || 22, d || 18, solid, seed);
    } else if (kind === 'artdeco' || kind === 'artdecohotel') {
      this.artDecoHotel(x, z, ry, w || 18, d || 16, solid, seed);
    } else if (kind === 'nightclub' || kind === 'club' || kind === 'casino') {
      this.nightclub(x, z, ry, w || 22, d || 20, solid, seed);
    } else if (kind === 'policestation' || kind === 'police') {
      this.policeStation(x, z, ry, w || 24, d || 18, solid, seed);
    } else if (kind === 'marinapier' || kind === 'marina' || kind === 'pier') {
      this.marinaPier(x, z, ry, w || 32, d || 26, solid, seed);
    } else if (kind === 'airporthangar' || kind === 'hangar') {
      this.airportHangar(x, z, ry, w || 34, d || 26, solid, seed);
    } else if (kind === 'modernpetrol' || kind === 'petrol') {
      this.modernPetrol(x, z, ry, solid, seed);
    } else if (kind === 'port') {
      this.port(x, z, ry, solid);
    } else if (kind === 'warehouse') {
      this.warehouse(x, z, w, d, h, solid);
    } else {
      // plain box — build from wall strips so ry gets tight per-wall AABBs
      this.plainbox(x, z, ry, w, h, d, mat, solid, doorW, style, seed, roofMat, b);
    }
    if (b.name) this.namedLocations.push({ x, z, name: b.name, color: '#ffd24a' });
    // Foundation plinth + AO band under the massing; roofline lip on flat roofs.
    const noSkirt = ['gasstation', 'modernpetrol', 'container', 'stadium', 'marinapier', 'luxuryvilla'].includes(kind);
    const flatLip = ['box', 'tower', 'shell', 'apartment', 'store', 'supermarket', 'parking', 'school', 'firestation', 'motel', 'mall', 'shop', 'bank', 'hospital', 'townhouse', 'nightclub', 'policestation', 'penthousetower'].includes(kind);
    if (!noSkirt) this._baseTrim(x, z, w, d, ry, h, { lip: flatLip });
    if (flatLip) this._buildingImperfections(x, z, w, d, ry, h, (b.seed || 1) + (Math.abs(x) * 31 + Math.abs(z) * 17) | 0);
  };

  // Prop dispatcher — routes JSON prop entries to the per-asset builders.
  World.prototype._authoredProp = function (p) {
    const x = p.x, z = p.z, ry = p.ry || 0;
    const kind = p.kind || 'crate';
    const react = p.react || null;
    if (!this._propPositions) this._propPositions = [];
    this._propPositions.push({ x, z });
    if (kind === 'palm') this.palm(x, z, p.scale || p.s || 1, p.lean || 0.12, ry);
    else if (kind === 'tree') this.tree(x, z, p.scale || p.s || 1, !!p.dead);
    else if (kind === 'crate') this._propCrate(x, z, ry, p, react);
    else if (kind === 'woodcrate') this._propWoodcrate(x, z, ry, p, react);
    else if (kind === 'crates') this._propCrates(x, z, ry, p, react);
    else if (kind === 'barrels') this._propBarrels(x, z, ry, p, react);
    else if (kind === 'barrel') this._propBarrel(x, z, ry, p, react);
    else if (kind === 'box') this._propBox(x, z, ry, p, react);
    else if (kind === 'stairs') this._propStairs(x, z, ry, p, react);
    else if (kind === 'lamp') this._propLamp(x, z, ry, p, react);
    else if (kind === 'hydrant') this._propHydrant(x, z, ry, p, react);
    else if (kind === 'dumpster') this._propDumpster(x, z, ry, p, react);
    else if (kind === 'trashcan') this._propTrashcan(x, z, ry, p, react);
    else if (kind === 'mailbox') this._propMailbox(x, z, ry, p, react);
    else if (kind === 'busstop') this._propBusstop(x, z, ry, p, react);
    else if (kind === 'trafficlight') this._propTrafficlight(x, z, ry, p, react);
    else if (kind === 'pole') this._propPole(x, z, ry, p, react);
    else if (kind === 'planter') this._propPlanter(x, z, ry, p, react);
    else if (kind === 'bollard') this._propBollard(x, z, ry, p, react);
    else if (kind === 'billboard') this._propBillboard(x, z, ry, p, react);
    else if (kind === 'umbrella') this._propUmbrella(x, z, ry, p, react);
    else if (kind === 'cafetable') this._propCafetable(x, z, ry, p, react);
    else if (kind === 'bench') this._propBench(x, z, ry, p, react);
    else if (kind === 'wreck') this._propWreck(x, z, ry, p, react);
    const n = p.n || 1, spread = p.spread || 0;
    if (n > 1) {
      for (let i = 1; i < n; i++) {
        const sx = x + rng(-spread, spread), sz = z + rng(-spread, spread);
        const sry = Math.random() * Math.PI * 2;
        const pc = { ...p, x: sx, z: sz, ry: sry, n: 0, spread: 0 };
        this._authoredProp(pc);
      }
    }
  };

  // Reactive prop dispatcher.
  World.prototype._authoredReactive = function (rc) {
    const x = rc.x, z = rc.z;
    if (rc.kind === 'flex') this.climbBox(x, 0, z, 1.2, .9, 1.2, this._sceneMat(rc.m || 'metal'), Math.random() * Math.PI, 'flex');
    else if (rc.kind === 'fire') this.climbBox(x, 0, z, 1.4, 1.1, 1.4, this._sceneMat(rc.m || 'crate'), Math.random() * Math.PI, 'fire');
    else this.climbBox(x, 0, z, 1, 1.4, 1, this.mBarrel(), Math.random() * Math.PI, 'firex');
  };

  // Landmark dispatcher — routes JSON landmark entries to the asset builders.
  World.prototype._authoredLandmark = function (lm) {
    const x = lm.x, z = lm.z, ry = lm.ry || 0;
    switch (lm.kind) {
      case 'transit': this.transitStation(x, z, lm.name || 'STATION'); break;
      case 'fuel': this.fuelTank(x, z, lm.r || 3, lm.h || 7, lm.solid !== false); break;
      case 'port': this.port(x, z, ry, lm.solid !== false); break;
      case 'trainstation': this.trainStation(x, z, ry, lm.solid !== false); break;
      case 'warehouse': this.warehouse(x, z, lm.w || 34, lm.d || 22, lm.h || 9, lm.solid !== false); break;
      case 'mall': this.mall(x, z, ry, lm.w || 40, lm.d || 20, lm.h || 8.5, lm.solid !== false, 3); break;
      case 'stadium': this.stadium(x, z, ry, lm.solid !== false, 5); break;
      case 'firestation': this.firestation(x, z, ry, lm.solid !== false, 7); break;
      case 'mosque': this.mosque(x, z, ry, lm.w || 16, lm.d || 18, lm.solid !== false, 11); break;
      case 'school': this.school(x, z, ry, lm.w || 22, lm.d || 16, lm.h || 7.5, lm.solid !== false, 13); break;
      case 'policestation': this.policeStation(x, z, ry, lm.solid !== false, 8); break;
      case 'nightclub': this.nightclub(x, z, ry, lm.w || 22, lm.d || 20, lm.solid !== false, 3); break;
      case 'rockfield': this.rockField(x, z, lm.r || 10); break;
      case 'hill': this.hill(x, z, lm.r || 14, lm.h || 8); break;
      default: break;
    }
  };
}
