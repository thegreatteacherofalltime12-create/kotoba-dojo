/**
 * The hole, drawn top-down.
 *
 * Lifted from the original single-player game with the drawing left alone —
 * the dogleg, the trees, the bunkers and the ball's flight are all as they
 * were. What changed is where the ball goes: the server says how far down the
 * fairway the shot finished, and this animates to it. Nothing here decides
 * anything about the round.
 */

const G = { courseId: "augusta", hole: 0, hazard: null, par: 4, yards: 400 };
let cv = null, cx = null;
let ball = { x: .5, y: .09, scale: 1 };
let ballTarget = { x: .5, y: .09 };
let flightStart = 0, flightDur = 0, flying = false, trail = [];
let sinkStart = 0, sunk = false;   // the ball dropping into the cup, then gone
let holeShape = null;
let raf = null;

const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };

function buildHole(){
  const seed = (G.courseId.charCodeAt(0)*97 + G.hole*131) % 997;
  const bend = (rnd(seed)-0.5)*0.30;            // dogleg amount
  const width = 0.13 + rnd(seed+7)*0.07;         // fairway half-width
  const haz = G.hazard || null;
  const trees = [];
  for(let i=0;i<46;i++){
    const t = i/46;
    const side = i%2 ? 1 : -1;
    const cxx = 0.5 + bend*Math.sin(t*Math.PI);
    trees.push({
      t, side,
      x: cxx + side*(width + 0.055 + rnd(seed+i*3)*0.10),
      y: 0.05 + t*0.86,
      r: 5 + rnd(seed+i*11)*7,
      ph: rnd(seed+i)*Math.PI*2
    });
  }
  const bunkers = [];
  const nb = haz==="sand" ? 4 : 2;
  for(let i=0;i<nb;i++){
    const t = 0.35 + rnd(seed+i*17)*0.55;
    const side = rnd(seed+i*23) > .5 ? 1 : -1;
    bunkers.push({
      x: 0.5 + bend*Math.sin(t*Math.PI) + side*(width*0.75 + rnd(seed+i*5)*0.05),
      y: 0.08 + t*0.82,
      rx: 0.035 + rnd(seed+i*13)*0.028,
      ry: 0.018 + rnd(seed+i*19)*0.014
    });
  }
  let water = null;
  if(haz==="water") water = { x:0.5 + bend*0.6 + (rnd(seed+3)>.5?1:-1)*(width+0.06), y:0.62, rx:0.16, ry:0.13 };
  if(haz==="island") water = { x:0.5, y:0.86, rx:0.30, ry:0.13, island:true };
  holeShape = { bend, width, haz, trees, bunkers, water };
}
function fairwayX(t){ return 0.5 + holeShape.bend*Math.sin(t*Math.PI); }

function draw(now){
  const W = cv.width, H = cv.height;
  const wind = holeShape.haz==="wind";

  // sky / rough ground
  const g = cx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,"#16301a"); g.addColorStop(1,"#0f2412");
  cx.fillStyle = g; cx.fillRect(0,0,W,H);

  // subtle mow stripes on the rough
  cx.globalAlpha = .35;
  for(let i=0;i<26;i++){
    cx.fillStyle = i%2 ? "#13290f" : "#112407";
    cx.fillRect(0, i*H/26, W, H/26);
  }
  cx.globalAlpha = 1;

  // fairway ribbon
  cx.beginPath();
  for(let i=0;i<=60;i++){
    const t=i/60, x=(fairwayX(t)-holeShape.width)*W, y=(0.05+t*0.86)*H;
    i? cx.lineTo(x,y) : cx.moveTo(x,y);
  }
  for(let i=60;i>=0;i--){
    const t=i/60, x=(fairwayX(t)+holeShape.width)*W, y=(0.05+t*0.86)*H;
    cx.lineTo(x,y);
  }
  cx.closePath();
  const fg = cx.createLinearGradient(0,0,0,H);
  fg.addColorStop(0,"#3f8f3f"); fg.addColorStop(1,"#57ab52");
  cx.fillStyle = fg; cx.fill();

  // fairway mow stripes
  cx.save(); cx.clip();
  cx.globalAlpha=.16;
  for(let i=0;i<20;i++){ cx.fillStyle = i%2?"#0d2a0d":"#8fd98f"; cx.fillRect(0,i*H/20,W,H/20); }
  cx.globalAlpha=1; cx.restore();

  // water
  if(holeShape.water){
    const w = holeShape.water;
    cx.beginPath(); cx.ellipse(w.x*W, w.y*H, w.rx*W, w.ry*H, 0, 0, Math.PI*2);
    cx.fillStyle = "#2b6f92"; cx.fill();
    // shimmer
    cx.save(); cx.clip();
    for(let i=0;i<7;i++){
      const yy = (w.y-w.ry)*H + i*(w.ry*2*H/7) + Math.sin(now/620+i)*3;
      cx.strokeStyle = "rgba(190,235,255,"+(0.10+0.06*Math.sin(now/430+i))+")";
      cx.lineWidth = 2; cx.beginPath(); cx.moveTo((w.x-w.rx)*W, yy); cx.lineTo((w.x+w.rx)*W, yy); cx.stroke();
    }
    cx.restore();
    if(w.island){
      cx.beginPath(); cx.ellipse(w.x*W, w.y*H, w.rx*W*0.42, w.ry*H*0.62, 0,0,Math.PI*2);
      cx.fillStyle="#4ea54a"; cx.fill();
    }
  }

  // bunkers
  holeShape.bunkers.forEach(b=>{
    cx.beginPath(); cx.ellipse(b.x*W, b.y*H, b.rx*W, b.ry*H, 0, 0, Math.PI*2);
    cx.fillStyle = "#d9b06a"; cx.fill();
    cx.strokeStyle = "#a8834a"; cx.lineWidth = 2; cx.stroke();
  });

  // green
  const gx = fairwayX(1)*W, gy = 0.90*H;
  cx.beginPath(); cx.ellipse(gx, gy, 0.115*W, 0.075*H, 0,0,Math.PI*2);
  cx.fillStyle = "#79cf6d"; cx.fill();
  cx.strokeStyle="#3f8f3f"; cx.lineWidth=3; cx.stroke();

  // cup
  cx.beginPath(); cx.arc(gx, gy, 6, 0, Math.PI*2); cx.fillStyle="#0d1f0b"; cx.fill();

  // flag (waves; harder in wind)
  const sway = Math.sin(now/(wind?170:340))*(wind?7:3);
  cx.strokeStyle="#e9eee6"; cx.lineWidth=3;
  cx.beginPath(); cx.moveTo(gx,gy); cx.lineTo(gx, gy-52); cx.stroke();
  cx.beginPath(); cx.moveTo(gx, gy-52);
  cx.lineTo(gx+26+sway, gy-44+sway*0.4); cx.lineTo(gx, gy-34);
  cx.closePath(); cx.fillStyle="#e5484d"; cx.fill();

  // tee markers
  const tx = fairwayX(0)*W, ty = 0.065*H;
  cx.fillStyle="#e9eee6";
  cx.fillRect(tx-30,ty-3,7,7); cx.fillRect(tx+23,ty-3,7,7);

  // trees (sway)
  holeShape.trees.forEach(t=>{
    const s = Math.sin(now/(wind?520:900) + t.ph)*(wind?3.2:1.4);
    cx.beginPath(); cx.arc(t.x*W + s, t.y*H, t.r, 0, Math.PI*2);
    cx.fillStyle = "#1d4b1e"; cx.fill();
    cx.beginPath(); cx.arc(t.x*W + s - t.r*0.28, t.y*H - t.r*0.28, t.r*0.55, 0, Math.PI*2);
    cx.fillStyle = "#2c6b2b"; cx.fill();
  });

  // ball flight
  if(flying){
    const p = Math.min(1,(now-flightStart)/flightDur);
    const e = p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
    ball.x = ballTarget.fx + (ballTarget.x-ballTarget.fx)*e;
    ball.y = ballTarget.fy + (ballTarget.y-ballTarget.fy)*e;
    ball.scale = 1 + Math.sin(p*Math.PI)*1.9;      // fakes height
    trail.push({x:ball.x,y:ball.y,a:1});
    if(trail.length>26) trail.shift();
    if(p>=1){ flying=false; ball.scale=1; if(ballTarget.hole){ sinkStart = now; } }
  }
  // Holed: the ball shrinks into the cup over a third of a second and is
  // not drawn again until the next hole puts a new one on the tee.
  if(sinkStart){
    const q = Math.min(1,(now-sinkStart)/350);
    ball.scale = 1-q;
    if(q>=1){ sunk = true; sinkStart = 0; }
  }
  trail.forEach((p,i)=>{
    p.a *= 0.94;
    cx.beginPath(); cx.arc(p.x*W, p.y*H, 2.2, 0, Math.PI*2);
    cx.fillStyle = "rgba(255,255,255,"+(p.a*0.42)+")"; cx.fill();
  });
  if(trail.length && trail[0].a<0.02) trail.shift();

  // shadow + ball
  if(!sunk){
    cx.beginPath(); cx.ellipse(ball.x*W+3, ball.y*H+4, 4.5*Math.max(1,ball.scale*0.6), 3, 0,0,Math.PI*2);
    cx.fillStyle="rgba(0,0,0,.30)"; cx.fill();
    cx.beginPath(); cx.arc(ball.x*W, ball.y*H, Math.max(0,5*ball.scale), 0, Math.PI*2);
    cx.fillStyle="#ffffff"; cx.fill();
    cx.strokeStyle="#b9c9b4"; cx.lineWidth=1; cx.stroke();
  }

  // yardage marker to pin
  const remain = Math.max(0, Math.round(G.yards * (1 - (ball.y-0.09)/0.81)));
  cx.font = "600 21px Archivo, system-ui, sans-serif";
  cx.fillStyle = "rgba(230,244,226,.72)";
  cx.textAlign = "right";
  cx.fillText(remain>0 ? remain+" yds to pin" : "IN THE CUP", W-16, H-18);
}

/* Multi-word: each solved word walks the ball one shot down the hole. */
function hitBallTo(frac, lie){
  const fx = ball.x, fy = ball.y;
  let ny = 0.09 + (0.90-0.09)*frac;
  let nx = fairwayX((ny-0.05)/0.86);
  if(lie==="rough") nx += (Math.random()>.5?1:-1) * (holeShape.width + 0.03);
  if(lie==="sand" && holeShape.bunkers.length){ const b=holeShape.bunkers[0]; nx=b.x; ny=b.y; }
  if(lie==="water" && holeShape.water){ nx=holeShape.water.x; ny=holeShape.water.y; }
  if(lie==="hole"){ nx = fairwayX(1); ny = 0.90; }
  ballTarget = { x:Math.max(0.05,Math.min(0.95,nx)), y:Math.min(0.90,ny), fx, fy, hole: lie==="hole" };
  sunk = false; sinkStart = 0;
  flightStart = performance.now();
  flightDur = 520 + Math.abs(ny-fy)*700;
  flying = true;
}


/** Point the drawing at a canvas and start the loop. */
export function attachHole(canvasEl) {
  cv = canvasEl;
  cx = cv.getContext("2d");
  fit();
  addEventListener("resize", fit);
  if (!raf) raf = requestAnimationFrame(loop);
}

/**
 * Match the canvas to the box it sits in, at the screen's real pixel density.
 * Without this the hole is a blurry rectangle on any phone.
 */
function fit() {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const box = cv.getBoundingClientRect();
  cv.width = Math.max(320, Math.round(box.width * dpr));
  cv.height = Math.max(360, Math.round(box.height * dpr));
}

// The one and only scheduler. draw() must never call requestAnimationFrame
// itself: it did when this was lifted from the single-player game, where draw
// WAS the loop. With loop() driving it too, every frame left one extra draw
// chain running — one more redraw per frame, for as long as the hole was open.
function loop(now) {
  try { draw(now); } catch { /* a frame that fails is not worth stopping for */ }
  raf = requestAnimationFrame(loop);
}

/** A new hole: rebuild the shape and put the ball back on the tee. */
export function setHole({ courseId, hole, hazard, par, yards }) {
  G.courseId = courseId || "augusta";
  G.hole = hole || 0;
  G.hazard = hazard || null;
  G.par = par || 4;
  G.yards = yards || 400;
  buildHole();
  ball = { x: fairwayX(0), y: .09, scale: 1 };
  ballTarget = { x: ball.x, y: ball.y };
  trail = [];
  flying = false;
  sunk = false; sinkStart = 0;
}

/**
 * Strike it. `frac` is how far down the hole the ball finished, which is the
 * server's number, not ours.
 */
export function strike(frac, lie) {
  if (!holeShape) buildHole();
  hitBallTo(Math.max(0, Math.min(1, frac)), lie);
}
