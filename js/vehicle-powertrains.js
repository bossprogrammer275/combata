// Independent vehicle powertrain models. Rapier owns chassis/contact solving;
// each vehicle supplies a different motor/engine and gearbox response.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function createPowertrainState(tune = {}) {
  const p = tune.powertrain || {};
  return { gear:1, rpm:p.idleRpm||850, shiftTimer:0, motorRpm:0, throttle:0, engineLoad:0 };
}
function sampleCurve(curve, rpm, fallback) {
  if (!Array.isArray(curve) || !curve.length) return fallback;
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i=1;i<curve.length;i++) {
    const a=curve[i-1], b=curve[i];
    if (rpm<=b[0]) { const t=clamp((rpm-a[0])/Math.max(1,b[0]-a[0]),0,1); return a[1]+(b[1]-a[1])*t; }
  }
  return curve[curve.length-1][1];
}
function stepElectric(state,spec,tune,throttle,speed,dt) {
  const radius=Math.max(.2,spec.wheelRadius||.43), finalDrive=spec.finalDrive||9;
  const rpm=Math.abs(speed)/radius*finalDrive*60/(Math.PI*2);
  const torque=sampleCurve(spec.torqueCurve,rpm,spec.maxMotorTorque||1400);
  const force=Math.min(torque*finalDrive/radius,(spec.peakPowerKw||420)*1000/Math.max(3,Math.abs(speed)));
  const accel=clamp(force/Math.max(600,tune.mass||1500),0,spec.maxAcceleration||11.5);
  state.motorRpm+=(rpm-state.motorRpm)*(1-Math.exp(-10*dt));
  state.rpm=state.motorRpm;state.gear=1;state.shiftTimer=0;state.throttle=throttle;state.engineLoad=Math.abs(throttle);
  let driveAcceleration=0,brakeAcceleration=0;
  if(throttle>.01){if(speed<-.8)brakeAcceleration=(tune.brakeAcceleration||12)*throttle;else driveAcceleration=accel*throttle*clamp(1-Math.max(0,speed)/Math.max(1,tune.maxSpeed||50)*.12,.82,1);}
  else if(throttle<-.01){if(speed>.8)brakeAcceleration=(tune.brakeAcceleration||12)*Math.abs(throttle);else driveAcceleration=-(tune.reverseAcceleration||5)*Math.abs(throttle);}
  else if(speed>1.5)brakeAcceleration=spec.regenDeceleration||.75;
  return {driveAcceleration,brakeAcceleration,maxForward:tune.maxSpeed||40,gear:'D',rpm:state.rpm,engineLoad:state.engineLoad,powertrainType:'electric-single-speed'};
}
function stepCombustion(state,spec,tune,throttle,speed,dt) {
  const gears=spec.gearRatios||[3.1,2.1,1.45,1.05,.82,.68], radius=Math.max(.2,spec.wheelRadius||.34);
  const finalDrive=spec.finalDrive||3.5,idle=spec.idleRpm||850,redline=spec.redline||8500;
  const index=clamp((state.gear||1)-1,0,gears.length-1),ratio=gears[index];
  const wheelRpm=Math.abs(speed)/radius*60/(Math.PI*2),coupled=wheelRpm*ratio*finalDrive;
  state.rpm+=(Math.max(idle,coupled)-state.rpm)*(1-Math.exp(-14*dt));
  state.shiftTimer=Math.max(0,state.shiftTimer-dt);
  if(throttle>.08&&state.shiftTimer<=0&&state.rpm>(spec.upshiftRpm||redline*.94)&&state.gear<gears.length){state.gear++;state.shiftTimer=spec.shiftTime||.16;}
  else if(state.shiftTimer<=0&&state.gear>1&&state.rpm<(spec.downshiftRpm||2500)&&speed>4){state.gear--;state.shiftTimer=(spec.shiftTime||.16)*1.15;}
  const active=clamp(state.gear-1,0,gears.length-1),activeRatio=gears[active];
  const torque=sampleCurve(spec.torqueCurve,clamp(state.rpm,idle,redline),spec.peakTorqueNm||500);
  const force=torque*activeRatio*finalDrive*(spec.drivetrainEfficiency||.88)/radius;
  const rawAccel=force/Math.max(600,tune.mass||1500);
  const fade=clamp(1-Math.max(0,speed)/Math.max(1,tune.maxSpeed||50)*.08,.88,1);
  const shiftCut=state.shiftTimer>0?(spec.shiftTorqueRetention||.16):1;
  state.throttle=throttle;state.engineLoad=Math.abs(throttle)*shiftCut;
  let driveAcceleration=0,brakeAcceleration=0;
  if(throttle>.01){if(speed<-.8)brakeAcceleration=(tune.brakeAcceleration||12)*throttle;else driveAcceleration=Math.min(spec.maxAcceleration||14,rawAccel)*throttle*fade*shiftCut;}
  else if(throttle<-.01){if(speed>.8)brakeAcceleration=(tune.brakeAcceleration||12)*Math.abs(throttle);else driveAcceleration=-(tune.reverseAcceleration||4.5)*Math.abs(throttle);}
  return {driveAcceleration,brakeAcceleration,maxForward:tune.maxSpeed||40,gear:String(state.gear),rpm:state.rpm,engineLoad:state.engineLoad,powertrainType:spec.type||'combustion-dct'};
}
export function stepVehiclePowertrain(state,tune,throttle,forwardSpeed,dt,surfaceSpeedMultiplier=1) {
  const spec=tune.powertrain||{},t=clamp(Number(throttle)||0,-1,1),speed=Number(forwardSpeed)||0,step=clamp(Number(dt)||1/60,0,1/30);
  let result;
  if(spec.type==='ev')result=stepElectric(state,spec,tune,t,speed,step);
  else if(spec.type==='dct'||spec.type==='automatic')result=stepCombustion(state,spec,tune,t,speed,step);
  else {
    const max=tune.maxSpeed||40,fade=clamp(1-Math.max(0,speed)/max*.72,.18,1);
    result={driveAcceleration:t>0?(tune.engineAcceleration||8)*t*fade:(t<0&&speed<=.8?-(tune.reverseAcceleration||4)*Math.abs(t):0),
      brakeAcceleration:(t<0&&speed>.8)?(tune.brakeAcceleration||11)*Math.abs(t):(t>0&&speed<-.8?(tune.brakeAcceleration||11)*t:0),
      maxForward:max,gear:'—',rpm:0,engineLoad:Math.abs(t),powertrainType:'legacy'};
  }
  result.maxForward*=clamp(surfaceSpeedMultiplier,.35,1.05);
  return result;
}
