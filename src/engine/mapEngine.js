// ============================================================
// Tavern Crashers — VFX engine
// Top-down canvas renderer. All functions render in MAP coordinates.
// Exposed on window.MapEngine for use from stage.jsx.
// ============================================================

(function(){
  const TOKEN_R = 36;       // token radius in map pixels
  const EPS = 0.0001;

  // ---------------- math ----------------
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function easeInOut(t){ return t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2; }
  function easeOut(t){ return 1 - Math.pow(1-t, 3); }
  function easeIn(t){ return t*t*t; }
  function dist(a,b){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
  // deterministic pseudo-random for stable particle layouts within a clip
  function rng(seed){
    let s = seed | 0;
    return () => { s = (s*1664525 + 1013904223) | 0; return ((s >>> 0) / 0x100000000); };
  }

  // ---------------- weapon image assets ----------------
  // Detailed weapon art used by image-based melee VFX. Cached HTMLImageElements;
  // they load lazily and the canvas redraws each playback frame.
  const _weaponImgs = {};
  function weaponImg(src){
    if (_weaponImgs[src]) return _weaponImgs[src];
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    _weaponImgs[src] = img;
    return img;
  }
  const LONGSWORD_SRC = (window.__resources && window.__resources.longsword) || "assets/longsword.webp";

  // Draw the ornate longsword art with its grip at the origin and the blade
  // pointing along +x, scaled so the tip reaches `len` px (mirrors shapeSword's
  // contract so it slots into the same swing math). Caller rotates the ctx.
  function shapeLongswordImg(ctx, len){
    const img = weaponImg(LONGSWORD_SRC);
    if (!img || !img.complete || !img.naturalWidth) { shapeSword(ctx, len); return; }
    // Hand pivot (between guard and grip) and blade tip, in image pixels.
    const gx = 392, gy = 183, tx = 22, ty = 20;
    const imgAng  = Math.atan2(ty - gy, tx - gx);
    const axisLen = Math.hypot(tx - gx, ty - gy);
    const scale   = (len * 1.15) / axisLen;
    ctx.save();
    ctx.rotate(-imgAng);
    ctx.scale(scale, scale);
    ctx.translate(-gx, -gy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function withAlpha(hex, a){
    if (!hex) return `rgba(255,255,255,${a})`;
    if (hex.startsWith("rgba")) return hex;
    if (hex.startsWith("rgb(")){
      return hex.replace("rgb(", "rgba(").replace(")", `,${a})`);
    }
    let h = hex.replace("#","");
    if (h.length === 3) h = h.split("").map(c=>c+c).join("");
    const r = parseInt(h.slice(0,2),16);
    const g = parseInt(h.slice(2,4),16);
    const b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------------- path arc helpers ----------------
  function pathArc(path){
    if (!path || path.length < 2) return { total:0, segs:[] };
    let total = 0;
    const segs = [];
    for (let i=1;i<path.length;i++){
      const d = dist(path[i-1], path[i]);
      segs.push({ from:path[i-1], to:path[i], d, acc: total });
      total += d;
    }
    return { total, segs };
  }
  function pointAt(arc, t){
    if (arc.total <= 0) return arc.segs?.[0]?.from || {x:0,y:0};
    const target = t * arc.total;
    for (const s of arc.segs){
      if (target <= s.acc + s.d){
        const u = (target - s.acc) / Math.max(EPS, s.d);
        return { x: lerp(s.from.x, s.to.x, u), y: lerp(s.from.y, s.to.y, u),
                 angle: Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x) };
      }
    }
    const last = arc.segs[arc.segs.length-1];
    return { x:last.to.x, y:last.to.y, angle: Math.atan2(last.to.y-last.from.y, last.to.x-last.from.x) };
  }

  function tokenPosAt(token, clips, time){
    let x = token.x, y = token.y;
    let angle = 0;
    const moves = clips.filter(c => c.kind === 'move' && c.tokenId === token.id)
                       .sort((a,b)=>a.start-b.start);
    for (const c of moves){
      if (time < c.start) break;
      const arc = pathArc(c.path);
      if (time >= c.start + c.dur){
        const p = pointAt(arc, 1);
        x = p.x; y = p.y; angle = p.angle || angle;
      } else {
        const tt = clamp((time - c.start) / Math.max(EPS, c.dur), 0, 1);
        const p = pointAt(arc, easeInOut(tt));
        x = p.x; y = p.y; angle = p.angle || angle;
        break;
      }
    }
    return { x, y, angle };
  }

  // ============================================================
  // Token rendering
  // ============================================================
  function drawToken(ctx, token, sprite, pos, selected, impactFlash, lift){
    const r = TOKEN_R;
    // Normalize the lift descriptor — callers may pass a plain scale number or
    // a rich object { scale, lift, twist, bobY, rot } for the floating-coin hover.
    let L;
    if (lift && typeof lift === "object"){
      L = { scale: lift.scale ?? 1, lift: clamp(lift.lift ?? 0, 0, 1),
            twistX: lift.twistX ?? lift.twist ?? 1, twistY: lift.twistY ?? 1,
            bobY: lift.bobY ?? 0, rot: lift.rot ?? 0 };
    } else {
      const sc = lift || 1;
      L = { scale: sc, lift: clamp(sc - 1, 0, 1), twistX: 1, twistY: 1, bobY: 0, rot: 0 };
    }
    const elev = L.lift;
    ctx.save();

    // ---- shadow ----
    // Grounded: a tight contact ellipse. Lifted: it detaches, drifts down,
    // softens (blur) and fades — a real drop shadow that sells the height.
    ctx.save();
    if (elev > 0.01) ctx.filter = `blur(${(1.5 + elev*7).toFixed(1)}px)`;
    const shY = pos.y + r*0.85 + elev*24;
    const shS = 1 - elev*0.34;
    ctx.fillStyle = `rgba(0,0,0,${(0.5 - elev*0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(pos.x, shY, r*0.85*shS, r*0.30*shS, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ---- token body transform: rise + bob + twist on vertical axis + wobble ----
    if (elev > 0.001 || L.scale !== 1 || L.twistX !== 1 || L.twistY !== 1 || L.rot){
      ctx.translate(pos.x, pos.y - elev*r*0.5 + L.bobY);
      if (L.rot) ctx.rotate(L.rot);
      // twistX/twistY squash → reads as the coin tumbling on multiple axes
      ctx.scale(L.scale * L.twistX, L.scale * L.twistY);
      ctx.translate(-pos.x, -pos.y);
    }
    // sprite clip
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.closePath();
    ctx.save(); ctx.clip();
    if (sprite && sprite.img && sprite.img.complete){
      const s = r*2;
      ctx.drawImage(sprite.img, pos.x - r, pos.y - r, s, s);
    } else {
      ctx.fillStyle = token.color || "#555";
      ctx.fillRect(pos.x-r, pos.y-r, r*2, r*2);
      ctx.fillStyle="#fff"; ctx.font="bold 24px sans-serif"; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText((token.label||"?").slice(0,2), pos.x, pos.y);
    }
    ctx.restore();
    // impact flash overlay
    if (impactFlash > 0){
      ctx.save();
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = `rgba(255,255,255,${impactFlash*0.7})`;
      ctx.fillRect(pos.x-r, pos.y-r, r*2, r*2);
      ctx.restore();
    }
    // ring
    ctx.lineWidth = selected ? 4 : 2.5;
    ctx.strokeStyle = selected ? "#ff7a2e" : (token.ringColor || "rgba(255,255,255,.85)");
    ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.stroke();
    // label
    if (token.label){
      ctx.font = "600 11px -apple-system, system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,.7)";
      ctx.fillRect(pos.x - 24, pos.y + r + 4, 48, 14);
      ctx.fillStyle = "#fff";
      ctx.fillText(token.label, pos.x, pos.y + r + 6);
    }
    ctx.restore();
  }

  function drawSmoothPath(ctx, pts, color, dashed){
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.lineWidth = 4; ctx.strokeStyle = color;
    ctx.lineCap="round"; ctx.lineJoin="round";
    if (dashed) ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ============================================================
  // SHAPE HELPERS — drawn pre-rotated at origin (caller rotates ctx)
  // ============================================================
  function shapeSword(ctx, len, color){
    // blade pointing +x
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath();
    ctx.moveTo(-6, 4); ctx.lineTo(len, 4); ctx.lineTo(len+8, 0); ctx.lineTo(len, -4); ctx.lineTo(-6, -4); ctx.closePath();
    ctx.translate(2,2); ctx.fill(); ctx.translate(-2,-2);
    // blade
    const g = ctx.createLinearGradient(0, -3, 0, 3);
    g.addColorStop(0, "#f5f6fa"); g.addColorStop(.5, "#e6e9f0"); g.addColorStop(1, "#9aa1b4");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2, 3); ctx.lineTo(len-4, 3); ctx.lineTo(len, 0); ctx.lineTo(len-4, -3); ctx.lineTo(-2, -3);
    ctx.closePath(); ctx.fill();
    // center fuller
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillRect(0, -1, len-6, 1);
    // crossguard
    ctx.fillStyle = "#c4a155";
    ctx.fillRect(-8, -8, 6, 16);
    // grip
    ctx.fillStyle = "#3a261c";
    ctx.fillRect(-20, -3, 14, 6);
    // pommel
    ctx.fillStyle = "#c4a155";
    ctx.beginPath(); ctx.arc(-22, 0, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function shapeDagger(ctx, len, color){
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.moveTo(0, 3); ctx.lineTo(len-3, 3); ctx.lineTo(len, 0); ctx.lineTo(len-3, -3); ctx.lineTo(0, -3);
    ctx.closePath(); ctx.translate(2,2); ctx.fill(); ctx.translate(-2,-2);
    // blade
    const g = ctx.createLinearGradient(0, -2, 0, 2);
    g.addColorStop(0, "#f7f8fc"); g.addColorStop(1, "#a8aebf");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-2, 2); ctx.lineTo(len-4, 2); ctx.lineTo(len, 0); ctx.lineTo(len-4, -2); ctx.lineTo(-2, -2);
    ctx.closePath(); ctx.fill();
    // grip
    ctx.fillStyle = "#3a261c"; ctx.fillRect(-12, -2, 10, 4);
    ctx.fillStyle = "#8c6c3a"; ctx.fillRect(-14, -3, 2, 6);
    ctx.restore();
  }

  function shapeAxe(ctx, len, color){
    ctx.save();
    // haft
    ctx.fillStyle = "#3a261c";
    ctx.fillRect(-len*0.55, -2, len, 4);
    // grip wrap
    ctx.fillStyle = "#1d1410";
    ctx.fillRect(-len*0.55, -2.5, len*0.25, 5);
    // axe head — wedge at +len*0.45
    ctx.save();
    ctx.translate(len*0.45, 0);
    const g = ctx.createLinearGradient(0, -16, 0, 16);
    g.addColorStop(0, "#cfd3df"); g.addColorStop(.5, "#a4abbd"); g.addColorStop(1, "#6f7689");
    ctx.fillStyle = g;
    // shadow
    ctx.save(); ctx.translate(2,2); ctx.fillStyle="rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.moveTo(-6, -14); ctx.quadraticCurveTo(14, -8, 12, 0); ctx.quadraticCurveTo(14, 8, -6, 14);
    ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-6, -14); ctx.quadraticCurveTo(14, -8, 12, 0); ctx.quadraticCurveTo(14, 8, -6, 14);
    ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
    // edge highlight
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-5, -13); ctx.quadraticCurveTo(13, -7, 11, 0); ctx.quadraticCurveTo(13, 7, -5, 13);
    ctx.stroke();
    ctx.restore();
    // pommel
    ctx.fillStyle = "#c4a155";
    ctx.beginPath(); ctx.arc(-len*0.55-3, 0, 3.5, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function shapeHammer(ctx, len, color){
    ctx.save();
    // haft
    ctx.fillStyle = "#3a261c"; ctx.fillRect(-len*0.55, -2, len, 4);
    // head
    ctx.save();
    ctx.translate(len*0.45, 0);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-8+2, -14+2, 22, 28);
    const g = ctx.createLinearGradient(0, -14, 0, 14);
    g.addColorStop(0, "#c8cbd6"); g.addColorStop(.5, "#8a8ea0"); g.addColorStop(1, "#52576a");
    ctx.fillStyle = g;
    ctx.fillRect(-8, -14, 22, 28);
    ctx.strokeStyle = "#3a3d4a"; ctx.lineWidth = 1.2;
    ctx.strokeRect(-8, -14, 22, 28);
    ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fillRect(-7, -13, 2, 26);
    ctx.restore();
    ctx.restore();
  }

  function shapeBow(ctx, drawT, color){
    // bow standing vertical, string pulled to the right with arrow
    ctx.save();
    const bowH = 70;
    // bow limbs (curve)
    ctx.strokeStyle = "#5a3a1f";
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    // top limb
    ctx.moveTo(0, -bowH/2);
    ctx.quadraticCurveTo(-22, 0, 0, bowH/2);
    ctx.stroke();
    // bow highlight
    ctx.strokeStyle = "rgba(255,220,150,.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2, -bowH/2 + 6);
    ctx.quadraticCurveTo(-22, 0, -2, bowH/2 - 6);
    ctx.stroke();
    // tips
    ctx.fillStyle = "#3a261c";
    ctx.beginPath(); ctx.arc(0, -bowH/2, 3, 0, Math.PI*2); ctx.arc(0, bowH/2, 3, 0, Math.PI*2); ctx.fill();
    // string — pulled by drawT in [0..1]
    const pull = drawT * 22;
    ctx.strokeStyle = "rgba(240,240,255,.85)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -bowH/2);
    ctx.lineTo(pull, 0);
    ctx.lineTo(0, bowH/2);
    ctx.stroke();
    // arrow nocked (visible only when drawn)
    if (drawT > 0.05){
      ctx.save();
      ctx.translate(pull, 0);
      // arrow shaft pointing right (we'll rotate the whole bow toward target later)
      ctx.strokeStyle = "#7a5a30"; ctx.lineWidth = 2.4; ctx.lineCap="butt";
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(36 - pull, 0); ctx.stroke();
      // arrowhead
      ctx.fillStyle = "#d7dbe2";
      ctx.beginPath();
      ctx.moveTo(36 - pull, 0); ctx.lineTo(30 - pull, -3.5); ctx.lineTo(30 - pull, 3.5); ctx.closePath();
      ctx.fill();
      // fletching at nock
      ctx.fillStyle = "#b9484a";
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-7, -4); ctx.lineTo(-3, 0); ctx.lineTo(-7, 4); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function shapeArrow(ctx, length, color){
    // arrow horizontal, tip at +length/2
    ctx.save();
    const tip = length/2;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-tip+2, -1+2, length-6, 2);
    // shaft
    ctx.fillStyle = "#8b6a3c"; ctx.fillRect(-tip, -1.2, length-6, 2.4);
    // shaft highlight
    ctx.fillStyle = "rgba(255,230,170,.5)"; ctx.fillRect(-tip, -1.2, length-6, 0.8);
    // arrowhead
    ctx.fillStyle = "#d7dbe2";
    ctx.beginPath();
    ctx.moveTo(tip, 0); ctx.lineTo(tip-8, -4.5); ctx.lineTo(tip-8, 4.5); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#5a606e"; ctx.lineWidth=.6; ctx.stroke();
    // fletching
    ctx.fillStyle = color || "#b9484a";
    ctx.beginPath();
    ctx.moveTo(-tip, 0); ctx.lineTo(-tip+10, -5.5); ctx.lineTo(-tip+4, 0); ctx.lineTo(-tip+10, 5.5); ctx.closePath();
    ctx.fill();
    // second fletch (white)
    ctx.fillStyle = "rgba(245,245,255,.85)";
    ctx.beginPath();
    ctx.moveTo(-tip, 0); ctx.lineTo(-tip+8, -3); ctx.lineTo(-tip+5, 0); ctx.lineTo(-tip+8, 3); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function shapeStarMissile(ctx, size, color){
    ctx.save();
    // 5-point star
    const r = size, r2 = size*0.45;
    ctx.beginPath();
    for (let i=0;i<10;i++){
      const a = (i*Math.PI)/5 - Math.PI/2;
      const rr = i%2===0 ? r : r2;
      const x = Math.cos(a)*rr, y = Math.sin(a)*rr;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0,0,0, 0,0,r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(.5, color || "#bca6ff");
    g.addColorStop(1, withAlpha(color || "#3c2ea8", 0));
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }

  // ============================================================
  // PARTICLE HELPERS
  // ============================================================
  function ember(ctx, x, y, r, a, hot, mid){
    ctx.save();
    const g = ctx.createRadialGradient(x,y,0, x,y,r);
    g.addColorStop(0, withAlpha(hot, a));
    g.addColorStop(.4, withAlpha(mid, a*.7));
    g.addColorStop(1, withAlpha(mid, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
  function spark(ctx, x, y, ang, len, a, color){
    ctx.save();
    ctx.strokeStyle = withAlpha(color, a);
    ctx.lineWidth = 2; ctx.lineCap="round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang)*len, y + Math.sin(ang)*len);
    ctx.stroke();
    ctx.restore();
  }
  function iceShard(ctx, x, y, r, ang, a){
    ctx.save();
    ctx.translate(x,y); ctx.rotate(ang);
    ctx.fillStyle = withAlpha("#dbeeff", a);
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(0, -r*0.4); ctx.lineTo(r, 0); ctx.lineTo(0, r*0.4); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withAlpha("#7ec0ff", a);
    ctx.lineWidth = .8; ctx.stroke();
    ctx.restore();
  }
  function smokePuff(ctx, x, y, r, a, dark){
    ctx.save();
    const c = dark ? "#1a1410" : "#5a5a5a";
    const g = ctx.createRadialGradient(x,y,0, x,y,r);
    g.addColorStop(0, withAlpha(c, a*0.5));
    g.addColorStop(.6, withAlpha(c, a*0.3));
    g.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function getSchool(spell){ return window.SCHOOLS[spell?.school] || window.SCHOOLS.melee; }

  // ============================================================
  // CASTING / WIND-UP HELPERS
  // Each VFX uses phased timing — slow wind-up, charge, release, travel, impact, settle.
  // These helpers draw the "preparation" beats at the caster.
  // ============================================================

  // Pulsing orb of magic gathering in the caster's hand. Used by ranged spells.
  // intensity 0..1 — controls size + glow.
  function drawChannelOrb(ctx, caster, target, intensity, school, p){
    if (intensity <= 0) return;
    const c = window.SCHOOLS[school] || window.SCHOOLS.melee;
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
    // hand position — slightly forward toward target
    const hx = caster.x + Math.cos(ang) * 30;
    const hy = caster.y + Math.sin(ang) * 30;
    const baseR = 14 + intensity * 14;
    const wobble = Math.sin(p * 40) * 1.6;
    const r = baseR + wobble;

    ctx.save();
    // outer aura
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r*2.4);
    g.addColorStop(0, withAlpha(c.hot, 0.7 * intensity));
    g.addColorStop(0.45, withAlpha(c.mid, 0.45 * intensity));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(hx, hy, r*2.4, 0, Math.PI*2); ctx.fill();
    // core
    ctx.fillStyle = withAlpha("#ffffff", 0.85 * intensity);
    ctx.beginPath(); ctx.arc(hx, hy, r * 0.55, 0, Math.PI*2); ctx.fill();
    // orbiting motes
    const seed = (school || "x").length;
    const moteCount = 4 + Math.floor(intensity * 3);
    for (let i=0; i<moteCount; i++){
      const oa = (i/moteCount) * Math.PI*2 + p*8;
      const orbitR = r * 1.4;
      const mx = hx + Math.cos(oa) * orbitR;
      const my = hy + Math.sin(oa) * orbitR;
      ember(ctx, mx, my, 4, intensity, c.hot, c.mid);
    }
    // sparks
    if (intensity > 0.6){
      for (let i=0; i<5; i++){
        const sa = i * 1.27 + p * 6;
        const len = 8 + Math.sin(p*10 + i) * 5;
        spark(ctx, hx, hy, sa, len, intensity * 0.7, c.hot);
      }
    }
    ctx.restore();
  }

  // Held weapon at caster (pre-throw / pre-swing). Position controlled by `pose`:
  //   pose 0 = at hand (forward)
  //   pose -1 = drawn far back (behind caster)
  //   pose 1 = extended toward target
  function drawHeldWeapon(ctx, caster, target, pose, weapon, alpha){
    if (alpha <= 0) return;
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
    // offsets perpendicular and along the caster-target axis
    const along = pose * 36;        // along axis, behind/ahead
    const perp  = 18;               // hand offset to one side
    const dx = Math.cos(ang) * along + Math.cos(ang + Math.PI/2) * perp;
    const dy = Math.sin(ang) * along + Math.sin(ang + Math.PI/2) * perp;
    const px = caster.x + dx;
    const py = caster.y + dy;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    // weapon points outward from hand toward target direction (or backward when pose<0)
    const wAng = ang + (pose < 0 ? Math.PI : 0);
    ctx.rotate(wAng);
    const len = weapon === "axe" ? 48 : weapon === "sword" ? 80
              : weapon === "dagger" ? 32 : weapon === "hammer" ? 70
              : weapon === "spear" ? 90 : 50;
    if (weapon === "axe")    shapeAxe(ctx, len);
    else if (weapon === "sword")  shapeSword(ctx, len);
    else if (weapon === "dagger") shapeDagger(ctx, len);
    else if (weapon === "hammer") shapeHammer(ctx, len);
    else                          shapeSword(ctx, len);
    ctx.restore();
  }

  // Held bow at caster — drawT 0..1 controls string pull.
  function drawHeldBow(ctx, caster, target, drawT, alpha){
    if (alpha <= 0) return;
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
    const hx = caster.x + Math.cos(ang) * 14;
    const hy = caster.y + Math.sin(ang) * 14;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(hx, hy);
    // bow's vertical axis perpendicular to ang
    ctx.rotate(ang + Math.PI/2);
    shapeBow(ctx, drawT);
    ctx.restore();
  }

  // Easing helpers used by the new phased VFX
  function ease01(t){ return t<0 ? 0 : t>1 ? 1 : t; }
  function smooth(t){ return easeInOut(ease01(t)); }
  function snap(t){ return easeIn(ease01(t)); }
  function blast(t){ return easeOut(ease01(t)); }
  // Phase helper: returns subprogress [0..1] within (from..to), clamped.
  function phase(p, from, to){
    if (p <= from) return 0;
    if (p >= to) return 1;
    return (p - from) / (to - from);
  }
  // Phase active flag
  function inPhase(p, from, to){ return p >= from && p < to; }

  // Overhead chop angle (ABSOLUTE screen radians) for melee swings.
  // The blade always travels top→bottom on screen — wound up pointing UP
  // (-PI/2) and following through pointing DOWN (+PI/2) — leaning toward the
  // side the target is on so the strike still reads as aimed. `u` is the swing
  // progress (0 = fully raised, 1 = fully chopped down; may over/undershoot for
  // wind-up and follow-through).
  function chopAngle(ang, u){
    const dir  = Math.cos(ang) >= 0 ? 1 : -1;     // target to the right vs left
    const up   = -Math.PI / 2;                    // straight up (screen north)
    const down = dir > 0 ? Math.PI / 2 : -3 * Math.PI / 2; // straight down, correct side
    return lerp(up, down, u);
  }

  // Caster lurch helper — used by melee VFX
  function lurchPos(casterPos, targetPos, lurchAmount){
    const dx = targetPos.x - casterPos.x, dy = targetPos.y - casterPos.y;
    return { x: casterPos.x + dx*lurchAmount, y: casterPos.y + dy*lurchAmount };
  }

  // ============================================================
  // VFX FUNCTIONS
  // ============================================================

  // ---- PROJECTILE (generic; school-themed) ----
  // Phased: 0-0.22 wind-up (orb forming) | 0.22-0.45 charge | 0.45-0.55 release
  //         0.55-0.85 travel | 0.85-0.95 impact | 0.95-1.0 settle
  function vfxProjectile(ctx, p, caster, target, spell){
    const c = getSchool(spell);

    // --- Wind-up + charge at caster (visible 0.0 .. 0.55) ---
    if (p < 0.55){
      let intensity;
      if (p < 0.22) intensity = smooth(p / 0.22) * 0.65;          // grow to 0.65
      else if (p < 0.45) intensity = 0.65 + smooth(phase(p, 0.22, 0.45)) * 0.35; // up to 1
      else intensity = 1 - snap(phase(p, 0.45, 0.55));            // collapse on release
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      // Release flash at caster
      if (p >= 0.45 && p < 0.58){
        const fp = phase(p, 0.45, 0.58);
        const fa = 1 - fp;
        const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
        const hx = caster.x + Math.cos(ang) * 30;
        const hy = caster.y + Math.sin(ang) * 30;
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 40);
        g.addColorStop(0, withAlpha("#ffffff", fa * 0.85));
        g.addColorStop(0.5, withAlpha(c.hot, fa * 0.6));
        g.addColorStop(1, withAlpha(c.cool, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx, hy, 40, 0, Math.PI*2); ctx.fill();
      }
      if (p < 0.55) return; // no projectile yet
    }

    // --- Travel 0.55-0.88 ---
    if (p < 0.88){
      const tp = phase(p, 0.55, 0.88);          // 0..1 across travel
      // Slight ease-in-out so the eye can track the moment of arrival
      const tt = easeInOut(tp);
      const ang0 = Math.atan2(target.y - caster.y, target.x - caster.x);
      const hx = caster.x + Math.cos(ang0) * 30;
      const hy = caster.y + Math.sin(ang0) * 30;
      const px = lerp(hx, target.x, tt);
      const py = lerp(hy, target.y, tt);

      // trail
      const N = 14;
      for (let i=N;i>0;i--){
        const lp = clamp(tt - i*0.045, 0, 1);
        const tx = lerp(hx, target.x, lp);
        const ty = lerp(hy, target.y, lp);
        const aa = (1 - i/N) * 0.75;
        const rr = 11 - i*0.55;
        if (rr < 0.5) continue;
        ember(ctx, tx, ty, rr, aa, c.hot, c.mid);
      }
      // core
      ctx.save();
      ctx.shadowColor = c.mid; ctx.shadowBlur = 24;
      ember(ctx, px, py, 13, 1, c.hot, c.mid);
      if (spell?.school === "fire" || spell?.school === "holy" || spell?.school === "lightning"){
        ctx.fillStyle = "rgba(255,255,255,.95)";
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
      return;
    }

    // --- Impact + settle 0.88-1.0 ---
    const ip = phase(p, 0.88, 1.0);
    const r = lerp(18, 80, easeOut(ip));
    const a = 1 - ip;
    ctx.save();
    ctx.strokeStyle = withAlpha(c.hot, a*0.95);
    ctx.lineWidth = 6 * (1-ip*.5);
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.stroke();
    const g = ctx.createRadialGradient(target.x,target.y, 0, target.x,target.y, r*.8);
    g.addColorStop(0, withAlpha(c.hot, a*0.6));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(target.x, target.y, r*.8, 0, Math.PI*2); ctx.fill();
    const rng1 = rng(Math.floor(p*10) + (spell?.id||"x").length);
    for (let i=0;i<14;i++){
      const aa = rng1()*Math.PI*2;
      const dr = r * (0.7 + rng1()*0.5);
      ember(ctx, target.x+Math.cos(aa)*dr, target.y+Math.sin(aa)*dr, 5, a, c.hot, c.mid);
    }
    ctx.restore();
  }

  // ---- FIREBALL (signature) — phased: long charge, dramatic launch, big blast ----
  // 0.00-0.30 charge (orb growing) | 0.30-0.50 hold + intensify | 0.50-0.58 launch
  // 0.58-0.82 travel | 0.82-0.95 explosion | 0.95-1.0 settle
  function vfxFireball(ctx, p, caster, target, spell){
    const c = getSchool({school:"fire"});

    // --- Charge phase at caster ---
    if (p < 0.58){
      let intensity;
      if (p < 0.30) intensity = smooth(p / 0.30) * 0.7;
      else if (p < 0.50) intensity = 0.7 + smooth(phase(p, 0.30, 0.50)) * 0.3;
      else intensity = 1 - snap(phase(p, 0.50, 0.58));
      drawChannelOrb(ctx, caster, target, intensity, "fire", p);
      // Smoke wisps gathering during charge
      if (p > 0.20 && p < 0.55){
        const cp = phase(p, 0.20, 0.55);
        const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
        const hx = caster.x + Math.cos(ang) * 30;
        const hy = caster.y + Math.sin(ang) * 30;
        for (let i=0; i<5; i++){
          const oa = i/5 * Math.PI*2 + p * 4;
          const orbitR = 28 + Math.sin(p*8+i)*4;
          smokePuff(ctx, hx + Math.cos(oa)*orbitR, hy + Math.sin(oa)*orbitR, 12, cp*0.5, true);
        }
      }
      // Release flash
      if (p >= 0.50){
        const fp = phase(p, 0.50, 0.62);
        const fa = 1 - fp;
        const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
        const hx = caster.x + Math.cos(ang) * 30;
        const hy = caster.y + Math.sin(ang) * 30;
        const r2 = 30 + fp * 50;
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r2);
        g.addColorStop(0, withAlpha("#ffffff", fa));
        g.addColorStop(0.5, withAlpha(c.hot, fa*0.7));
        g.addColorStop(1, withAlpha(c.cool, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx, hy, r2, 0, Math.PI*2); ctx.fill();
      }
      if (p < 0.58) return;
    }

    // --- Travel 0.58-0.82 ---
    if (p < 0.82){
      const tp = phase(p, 0.58, 0.82);
      const tt = easeInOut(tp);                    // slow-fast-slow for clarity
      const ang0 = Math.atan2(target.y - caster.y, target.x - caster.x);
      const hx = caster.x + Math.cos(ang0) * 30;
      const hy = caster.y + Math.sin(ang0) * 30;
      const px = lerp(hx, target.x, tt);
      const py = lerp(hy, target.y, tt);
      const r = 16 + Math.sin(p*40)*1.5;
      // smoke trail
      const N = 18;
      for (let i=N;i>0;i--){
        const lp = clamp(tt - i*0.04, 0, 1);
        if (lp <= 0) continue;
        const sx = lerp(hx, target.x, lp);
        const sy = lerp(hy, target.y, lp);
        const off = Math.sin(i*1.3 + p*10)*3;
        const a = (1 - i/N) * 0.6;
        smokePuff(ctx, sx + off, sy - off, 16 + i*0.8, a*0.9, true);
      }
      // ember trail
      for (let i=10;i>0;i--){
        const lp = clamp(tt - i*0.04, 0, 1);
        if (lp <= 0) continue;
        const sx = lerp(hx, target.x, lp);
        const sy = lerp(hy, target.y, lp);
        ember(ctx, sx, sy, 10 - i*0.6, (1-i/10)*0.85, c.hot, c.mid);
      }
      // main flame
      ctx.save();
      ctx.shadowColor = c.hot; ctx.shadowBlur = 40;
      ember(ctx, px, py, r+10, 0.7, c.mid, c.cool);
      ember(ctx, px, py, r, 1, c.hot, c.mid);
      ctx.fillStyle = "rgba(255,255,240,1)";
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      // spiraling embers
      const rngE = rng((spell?.id||"f").length*7);
      for (let i=0;i<6;i++){
        const a = rngE()*Math.PI*2 + p*4;
        const dr = 22 + rngE()*10;
        ember(ctx, px + Math.cos(a)*dr, py + Math.sin(a)*dr, 4, 0.85, c.hot, c.mid);
      }
      return;
    }

    // --- Explosion 0.82-0.95 then settle ---
    const ip = phase(p, 0.82, 1.0);
    const radius = (spell?.radius || 20) * 8 + 70;
    const r = easeOut(Math.min(ip * 1.4, 1)) * radius;
    const fade = 1 - clamp((ip - 0.55) / 0.45, 0, 1);

    ctx.save();
    // ground scorch
    const scorch = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r*0.9);
    scorch.addColorStop(0, withAlpha("#2a0a00", 0.7*fade));
    scorch.addColorStop(0.7, withAlpha("#2a0a00", 0.3*fade));
    scorch.addColorStop(1, withAlpha("#2a0a00", 0));
    ctx.fillStyle = scorch;
    ctx.beginPath(); ctx.arc(target.x, target.y, r*0.9, 0, Math.PI*2); ctx.fill();
    // shockwave
    ctx.strokeStyle = withAlpha("#fff8c0", fade);
    ctx.lineWidth = 6 + (1-ip)*10;
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.stroke();
    // main fire body
    const g = ctx.createRadialGradient(target.x, target.y, r*0.05, target.x, target.y, r*0.85);
    g.addColorStop(0, withAlpha("#ffffff", fade));
    g.addColorStop(0.25, withAlpha(c.hot, fade*0.95));
    g.addColorStop(0.65, withAlpha(c.mid, fade*0.7));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(target.x, target.y, r*0.85, 0, Math.PI*2); ctx.fill();
    // flame petals
    const petals = 12;
    for (let i=0;i<petals;i++){
      const ang = i/petals * Math.PI*2 + p*1.5;
      const rr = r*0.7 + Math.sin(p*8 + i)*r*0.1;
      const px = target.x + Math.cos(ang)*rr;
      const py = target.y + Math.sin(ang)*rr;
      ember(ctx, px, py, 16 + Math.sin(p*5+i)*4, fade*0.9, c.hot, c.mid);
    }
    // smoke
    for (let i=0;i<10;i++){
      const ang = i/10 * Math.PI*2;
      const rr = r*0.95 + Math.sin(p*4+i)*12;
      const ip2 = clamp(ip*1.5, 0, 1);
      smokePuff(ctx, target.x+Math.cos(ang)*rr, target.y+Math.sin(ang)*rr, 24 + ip2*18, fade*0.65, true);
    }
    // flying embers
    for (let i=0;i<16;i++){
      const ang = (i/16)*Math.PI*2 + 0.3;
      const rr = r*0.4 + ip*r*0.7;
      ember(ctx, target.x+Math.cos(ang)*rr, target.y+Math.sin(ang)*rr, 5, fade, c.hot, c.mid);
    }
    ctx.restore();
  }

  // ---- BURNING HANDS / CONE OF COLD ----
  // 0.00-0.25 charge | 0.25-0.45 hands raise | 0.45-0.55 release | 0.55-0.85 sustained | 0.85-1.0 fade
  function vfxCone(ctx, p, caster, target, spell){
    const c = getSchool(spell);

    // charge at caster
    if (p < 0.55){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.45) intensity = 0.7 + smooth(phase(p,0.25,0.45))*0.3;
      else intensity = 1 - snap(phase(p,0.45,0.55));
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.45) return;
    }

    // cone visible from 0.45 onward
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx);
    const reach = (spell?.cone || 15) * 8 + 60;
    const half = Math.PI/4;
    const isFire = spell?.school === "fire";
    let grow, fade;
    if (p < 0.55){ grow = easeOut(phase(p, 0.45, 0.55)); fade = 1; }
    else if (p < 0.85){ grow = 1; fade = 1; }
    else { grow = 1; fade = 1 - smooth(phase(p, 0.85, 1.0)); }

    ctx.save();
    ctx.translate(caster.x, caster.y); ctx.rotate(ang);
    const rr = reach * grow;
    const g = ctx.createLinearGradient(0,0, rr, 0);
    g.addColorStop(0, withAlpha(c.hot, .9*fade));
    g.addColorStop(.6, withAlpha(c.mid, .5*fade));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0, rr, -half, half);
    ctx.closePath();
    ctx.fill();
    // plumes
    const rngF = rng(11 + Math.floor(p*8));
    const plumes = isFire ? 16 : 12;
    for (let i=0;i<plumes;i++){
      const ang2 = (rngF()-.5)*half*2*0.9;
      const dd = rngF()*rr;
      const ex = Math.cos(ang2)*dd;
      const ey = Math.sin(ang2)*dd;
      if (isFire){
        ember(ctx, ex, ey, 12 + rngF()*8, fade*0.95, c.hot, c.mid);
      } else {
        iceShard(ctx, ex, ey, 7 + rngF()*4, rngF()*Math.PI*2, fade*0.85);
      }
    }
    // smoke for fire
    if (isFire){
      for (let i=0;i<6;i++){
        const ang2 = (rngF()-.5)*half*2*0.8;
        const dd = rr*(0.4+rngF()*0.6);
        smokePuff(ctx, Math.cos(ang2)*dd, Math.sin(ang2)*dd, 20, fade*0.55, true);
      }
    }
    ctx.restore();
  }

  // ---- BEAM (witch bolt, vampiric touch, disintegrate) ----
  // 0.00-0.25 charge | 0.25-0.50 charge intensifies | 0.50-0.58 release flash
  // 0.58-0.92 sustained beam with crackling | 0.92-1.0 fade
  function vfxBeam(ctx, p, caster, target, spell){
    const c = getSchool(spell);

    if (p < 0.55){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.50) intensity = 0.7 + smooth(phase(p,0.25,0.50))*0.3;
      else intensity = 1;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.55) return;
    }

    const a = p < 0.62 ? smooth(phase(p,0.55,0.62)) : (p < 0.92 ? 1 : 1 - phase(p,0.92,1.0));
    ctx.save();
    ctx.lineCap = "round";
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const nx = -dy/Math.hypot(dx,dy), ny = dx/Math.hypot(dx,dy);
    const wob = Math.sin(p*30) * 4;
    const cx2 = caster.x + nx*wob, cy2 = caster.y + ny*wob;
    const tx2 = target.x + nx*wob, ty2 = target.y + ny*wob;
    ctx.strokeStyle = withAlpha(c.mid, a*0.55);
    ctx.lineWidth = 32; ctx.beginPath(); ctx.moveTo(cx2,cy2); ctx.lineTo(tx2,ty2); ctx.stroke();
    ctx.strokeStyle = withAlpha(c.hot, a);
    ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", a*0.7);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    const len = Math.hypot(dx,dy);
    const sparkCount = Math.min(20, Math.floor(len/30));
    for (let i=0;i<sparkCount;i++){
      const lp = ((i*97 + p*1000) % 1000) / 1000;
      const sx = lerp(caster.x, target.x, lp);
      const sy = lerp(caster.y, target.y, lp);
      const r2 = Math.random();
      ember(ctx, sx + nx*(r2-.5)*16, sy + ny*(r2-.5)*16, 3, a*0.8, c.hot, c.mid);
    }
    ctx.restore();
  }

  // ---- RAY (frost ray etc) ----
  // 0.00-0.25 charge | 0.25-0.55 intensify | 0.55-0.60 release | 0.60-0.92 sustained | 0.92-1.0 fade
  function vfxRay(ctx, p, caster, target, spell){
    const c = getSchool(spell);

    if (p < 0.60){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.55) intensity = 0.7 + smooth(phase(p,0.25,0.55))*0.3;
      else intensity = 1;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.55) return;
    }

    const a = p < 0.65 ? smooth(phase(p,0.55,0.65)) : (p < 0.92 ? 1 : 1 - phase(p,0.92,1.0));
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(c.mid, a*0.5);
    ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    ctx.strokeStyle = withAlpha(c.hot, a);
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", a*0.6);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    const tipR = 28 * a;
    const grad = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, tipR);
    grad.addColorStop(0, withAlpha("#ffffff", a*0.9));
    grad.addColorStop(1, withAlpha(c.mid, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(target.x, target.y, tipR, 0, Math.PI*2); ctx.fill();
    if (spell?.school === "cold"){
      const len = Math.hypot(target.x-caster.x, target.y-caster.y);
      const sparkCount = Math.min(10, Math.floor(len/40));
      for (let i=0;i<sparkCount;i++){
        const lp = ((i*97 + p*500) % 500) / 500;
        const sx = lerp(caster.x, target.x, lp);
        const sy = lerp(caster.y, target.y, lp);
        iceShard(ctx, sx + (Math.random()-.5)*8, sy + (Math.random()-.5)*8, 5, Math.random()*Math.PI*2, a*0.8);
      }
    }
    ctx.restore();
  }

  // ---- LIGHTNING BOLT — heavy with branches ----
  // 0.00-0.25 charging at caster | 0.25-0.50 charge intensifies | 0.50-0.55 release flash
  // 0.55-0.78 sustained bolt | 0.78-1.0 fading sparks
  function vfxBolt(ctx, p, caster, target, spell){
    const c = getSchool({school:"lightning"});

    // Charge phase
    if (p < 0.55){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.50) intensity = 0.7 + smooth(phase(p,0.25,0.50))*0.3;
      else intensity = 1; // hold full intensity through release moment
      drawChannelOrb(ctx, caster, target, intensity, "lightning", p);
      // crackling sparks around caster
      if (p > 0.10){
        const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
        const hx = caster.x + Math.cos(ang) * 30;
        const hy = caster.y + Math.sin(ang) * 30;
        const sparkCount = Math.floor(2 + intensity * 6);
        for (let i=0; i<sparkCount; i++){
          const sa = i * 1.31 + p * 8;
          const len = 12 + Math.sin(p*30 + i) * 8;
          spark(ctx, hx, hy, sa, len, intensity*0.8, "#cfe9ff");
        }
      }
      if (p < 0.55) return;
    }

    // Release flash 0.55-0.60
    if (p < 0.60){
      const fp = phase(p, 0.55, 0.60);
      const fa = 1 - fp;
      const ang = Math.atan2(target.y - caster.y, target.x - caster.x);
      const hx = caster.x + Math.cos(ang) * 30;
      const hy = caster.y + Math.sin(ang) * 30;
      const r = 60 * fa;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
      g.addColorStop(0, withAlpha("#ffffff", fa));
      g.addColorStop(0.6, withAlpha(c.hot, fa*0.7));
      g.addColorStop(1, withAlpha(c.cool, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI*2); ctx.fill();
    }

    // Sustained bolt 0.55-0.85, fading to 1.0
    if (p < 1.0){
      const visP = phase(p, 0.55, 1.0);
      const a = visP < 0.40 ? 1 : 1 - phase(visP, 0.40, 1.0);
      if (a <= 0) return;
      ctx.save();
      const segs = 16;
      const dx = target.x - caster.x, dy = target.y - caster.y;
      const nx = -dy/Math.hypot(dx,dy), ny = dx/Math.hypot(dx,dy);
      const seed = Math.floor(p*30);
      const r = rng(seed);
      const pts = [];
      pts.push({x:caster.x, y:caster.y});
      for (let i=1;i<segs;i++){
        const t = i/segs;
        const jitter = (r()-.5) * 80 * (1 - Math.abs(t-.5)*2*.3);
        pts.push({ x: lerp(caster.x, target.x, t) + nx*jitter, y: lerp(caster.y, target.y, t) + ny*jitter });
      }
      pts.push({x:target.x, y:target.y});
      ctx.lineCap = "round";
      ctx.strokeStyle = withAlpha(c.mid, a*0.35);
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(c.mid, a*0.7);
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.strokeStyle = withAlpha("#ffffff", a);
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      // branching forks
      const rng2 = rng(seed+7);
      for (let k=0;k<4;k++){
        const idx = 3 + Math.floor(rng2()*(pts.length-5));
        const branchLen = 50 + rng2()*70;
        const branchAng = Math.atan2(pts[idx+1].y - pts[idx].y, pts[idx+1].x - pts[idx].x) + (rng2()-.5)*Math.PI;
        ctx.strokeStyle = withAlpha(c.hot, a*0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pts[idx].x, pts[idx].y);
        const mx = pts[idx].x + Math.cos(branchAng)*branchLen*0.5 + (rng2()-.5)*30;
        const my = pts[idx].y + Math.sin(branchAng)*branchLen*0.5 + (rng2()-.5)*30;
        const ex = pts[idx].x + Math.cos(branchAng)*branchLen;
        const ey = pts[idx].y + Math.sin(branchAng)*branchLen;
        ctx.lineTo(mx, my); ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      // impact flash at target
      if (visP < 0.40){
        const fa = 1 - visP/0.40;
        const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, 90);
        g.addColorStop(0, withAlpha("#ffffff", fa*0.9));
        g.addColorStop(0.5, withAlpha(c.mid, fa*0.5));
        g.addColorStop(1, withAlpha(c.cool, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(target.x, target.y, 90, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---- RAY (frost ray etc) ----
  function vfxRay(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const a = p < 0.15 ? p/0.15 : 1 - (p-0.15)/0.85;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(c.mid, a*0.5);
    ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    ctx.strokeStyle = withAlpha(c.hot, a);
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    ctx.strokeStyle = withAlpha("#ffffff", a*0.6);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(caster.x,caster.y); ctx.lineTo(target.x,target.y); ctx.stroke();
    // tip burst at target
    const tipR = 24 * a;
    const grad = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, tipR);
    grad.addColorStop(0, withAlpha("#ffffff", a*0.9));
    grad.addColorStop(1, withAlpha(c.mid, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(target.x, target.y, tipR, 0, Math.PI*2); ctx.fill();
    // school-specific particles
    if (spell?.school === "cold"){
      const len = Math.hypot(target.x-caster.x, target.y-caster.y);
      const sparkCount = Math.min(10, Math.floor(len/40));
      for (let i=0;i<sparkCount;i++){
        const lp = ((i*97 + p*500) % 500) / 500;
        const sx = lerp(caster.x, target.x, lp);
        const sy = lerp(caster.y, target.y, lp);
        iceShard(ctx, sx + (Math.random()-.5)*8, sy + (Math.random()-.5)*8, 5, Math.random()*Math.PI*2, a*0.8);
      }
    }
    ctx.restore();
  }

  // ---- MISSILE VOLLEY (magic missile, scorching ray) ----
  // 0.00-0.25 charge | 0.25-0.50 build | 0.50-0.58 release | 0.58-0.92 missiles fly | 0.92-1.0 settle
  function vfxMissileVolley(ctx, p, caster, target, spell){
    const n = spell?.count || 3;
    const c = getSchool(spell);
    const isForce = spell?.school === "force";

    if (p < 0.55){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.50) intensity = 0.7 + smooth(phase(p,0.25,0.50))*0.3;
      else intensity = 1 - snap(phase(p,0.50,0.55));
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      // pre-formed missiles orbiting the orb
      if (p > 0.35 && isForce){
        const ang0 = Math.atan2(target.y - caster.y, target.x - caster.x);
        const hx = caster.x + Math.cos(ang0) * 30;
        const hy = caster.y + Math.sin(ang0) * 30;
        for (let i=0; i<n; i++){
          const oa = i/n * Math.PI*2 + p*6;
          const orbitR = 28 + Math.sin(p*8+i)*4;
          const mx = hx + Math.cos(oa)*orbitR;
          const my = hy + Math.sin(oa)*orbitR;
          ctx.save();
          ctx.translate(mx, my); ctx.rotate(p*6 + i);
          shapeStarMissile(ctx, 7, c.mid);
          ctx.restore();
        }
      }
      if (p < 0.55) return;
    }

    // Missiles fly 0.55-0.95 (staggered)
    const flightP = phase(p, 0.55, 0.95);
    for (let i=0;i<n;i++){
      const stagger = i * 0.06;
      const lp = (flightP - stagger) / (1 - stagger*0.4);
      if (lp <= 0 || lp >= 1) continue;
      const offset = (i - (n-1)/2) * 60;
      const dx = target.x-caster.x, dy = target.y-caster.y;
      const nx = -dy/(Math.hypot(dx,dy)||1), ny = dx/(Math.hypot(dx,dy)||1);
      const ang0 = Math.atan2(dy, dx);
      const hx = caster.x + Math.cos(ang0) * 30;
      const hy = caster.y + Math.sin(ang0) * 30;
      const mid = {
        x: (hx+target.x)/2 + nx*offset,
        y: (hy+target.y)/2 + ny*offset,
      };
      const tt = easeInOut(lp);
      const x = (1-tt)*(1-tt)*hx + 2*(1-tt)*tt*mid.x + tt*tt*target.x;
      const y = (1-tt)*(1-tt)*hy + 2*(1-tt)*tt*mid.y + tt*tt*target.y;
      for (let j=8;j>0;j--){
        const lp2 = clamp(lp - j*.04, 0, 1);
        const t2 = easeInOut(lp2);
        const x2 = (1-t2)*(1-t2)*hx + 2*(1-t2)*t2*mid.x + t2*t2*target.x;
        const y2 = (1-t2)*(1-t2)*hy + 2*(1-t2)*t2*mid.y + t2*t2*target.y;
        if (isForce){
          ctx.save();
          ctx.translate(x2,y2);
          shapeStarMissile(ctx, 6 - j*.5, c.mid);
          ctx.restore();
        } else {
          ember(ctx, x2, y2, 6 - j*.5, (1-j/8)*0.55, c.hot, c.mid);
        }
      }
      if (isForce){
        ctx.save();
        ctx.translate(x,y);
        const ang = Math.atan2(target.y - mid.y, target.x - mid.x);
        ctx.rotate(ang + p*4);
        ctx.shadowColor = c.mid; ctx.shadowBlur = 18;
        shapeStarMissile(ctx, 10, c.mid);
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = c.mid; ctx.shadowBlur = 16;
        ember(ctx, x, y, 11, 1, c.hot, c.mid);
        ctx.fillStyle = "rgba(255,255,255,.95)";
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }
  }

  function vfxChain(ctx, p, caster, target, spell){
    vfxBolt(ctx, p, caster, target, spell);
    const c = getSchool({school:"lightning"});
    const a = clamp((p-0.15)/0.5, 0, 1) * (1 - clamp((p-0.5)/0.5, 0, 1));
    if (a <= 0) return;
    const chains = spell?.chains || 3;
    for (let i=0;i<chains;i++){
      const ang = (i / chains) * Math.PI*2 + p*1.5;
      const tx = target.x + Math.cos(ang)*200;
      const ty = target.y + Math.sin(ang)*200;
      vfxBolt(ctx, clamp((p-0.2)*1.6, 0, 1), target, {x:tx,y:ty}, spell);
    }
  }

  // ---- AOE BURST (generic non-fire) ----
  // 0.00-0.25 charge at caster | 0.25-0.50 hold | 0.50-0.55 release
  // 0.55-0.75 expansion | 0.75-1.0 fade
  function vfxAoeBurst(ctx, p, caster, target, spell){
    if (spell?.id === "fireball") return vfxFireball(ctx, p, caster, target, spell);
    const c = getSchool(spell);

    // Casting prep (only if caster is not at target — e.g. AOE-at-point)
    const sameSpot = Math.hypot(caster.x-target.x, caster.y-target.y) < 60;
    if (p < 0.55 && !sameSpot){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.7;
      else if (p < 0.50) intensity = 0.7 + smooth(phase(p,0.25,0.50))*0.3;
      else intensity = 1 - snap(phase(p,0.50,0.55));
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.55) return;
    }

    const expP = phase(p, sameSpot ? 0.25 : 0.55, 0.85);
    const fadeP = phase(p, 0.85, 1.0);
    const maxR = (spell?.radius || 20) * 8 + 50;
    const r = easeOut(expP) * maxR;
    const fade = 1 - fadeP;

    ctx.save();
    const grad = ctx.createRadialGradient(target.x,target.y, r*.05, target.x,target.y, r);
    grad.addColorStop(0, withAlpha(c.hot, .85*fade));
    grad.addColorStop(0.55, withAlpha(c.mid, .55*fade));
    grad.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = withAlpha(c.hot, fade*0.95);
    ctx.lineWidth = 5*fade + 1;
    ctx.beginPath(); ctx.arc(target.x, target.y, r*1.02, 0, Math.PI*2); ctx.stroke();
    if (spell?.school === "cold"){
      const rngI = rng(3);
      for (let i=0;i<20;i++){
        const ang = rngI()*Math.PI*2;
        const rr = r*0.6 + rngI()*r*0.4;
        iceShard(ctx, target.x+Math.cos(ang)*rr, target.y+Math.sin(ang)*rr, 7, rngI()*Math.PI*2, fade*0.9);
      }
    } else if (spell?.school === "lightning"){
      for (let i=0;i<6;i++){
        const ang = i/6*Math.PI*2 + p*5;
        ctx.strokeStyle = withAlpha("#ffffff", fade*0.8);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(target.x, target.y);
        ctx.lineTo(target.x + Math.cos(ang)*r*0.9, target.y + Math.sin(ang)*r*0.9);
        ctx.stroke();
      }
    } else {
      for (let i=0;i<20;i++){
        const ang = i/20 * Math.PI*2 + p*1.5;
        const pr = r*.85 + Math.sin(p*8 + i)*8;
        ember(ctx, target.x + Math.cos(ang)*pr, target.y + Math.sin(ang)*pr, 4, fade*0.8, c.hot, c.mid);
      }
    }
    ctx.restore();
  }

  // ---- AOE SUSTAIN (fog cloud, web, plant growth, darkness) ----
  // 0.00-0.20 charge | 0.20-0.30 release | 0.30-0.85 sustain | 0.85-1.0 fade
  function vfxAoeSustain(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const sameSpot = Math.hypot(caster.x-target.x, caster.y-target.y) < 60;

    if (p < 0.30 && !sameSpot){
      let intensity;
      if (p < 0.20) intensity = smooth(p/0.20) * 0.85;
      else intensity = 0.85 - snap(phase(p,0.20,0.30))*0.85;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
    }

    const maxR = (spell?.radius || 20) * 7 + 30;
    let scale;
    if (p < 0.30) scale = easeOut(phase(p, sameSpot ? 0.00 : 0.20, 0.30));
    else if (p < 0.85) scale = 1;
    else scale = 1 - easeIn(phase(p, 0.85, 1.0));
    const r = maxR * scale;
    const pulse = 0.85 + 0.15*Math.sin(p*Math.PI*6);
    ctx.save();
    const grad = ctx.createRadialGradient(target.x,target.y, r*.25, target.x,target.y, r);
    grad.addColorStop(0, withAlpha(c.mid, .55*pulse));
    grad.addColorStop(0.7, withAlpha(c.cool, .35));
    grad.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.fill();
    ctx.setLineDash([12, 8]); ctx.lineDashOffset = -p*60;
    ctx.strokeStyle = withAlpha(c.hot, scale*.8);
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    if (spell?.id === "entangle" || spell?.name === "Web"){
      ctx.strokeStyle = withAlpha("#e9eaf2", scale*0.65);
      ctx.lineWidth = 1.5;
      for (let i=0;i<14;i++){
        const a = i/14 * Math.PI*2;
        ctx.beginPath();
        ctx.moveTo(target.x, target.y);
        ctx.lineTo(target.x + Math.cos(a)*r, target.y + Math.sin(a)*r);
        ctx.stroke();
      }
      for (let ring=1;ring<=4;ring++){
        ctx.beginPath();
        ctx.strokeStyle = withAlpha("#e9eaf2", scale*0.35);
        for (let i=0;i<14;i++){
          const a = i/14 * Math.PI*2;
          const rr = r*ring/4 + Math.sin(a*3 + p*2)*3;
          const x = target.x + Math.cos(a)*rr;
          const y = target.y + Math.sin(a)*rr;
          i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- LINE (lightning bolt as line, sunbeam) ----
  // 0.00-0.30 charge | 0.30-0.42 release | 0.42-0.78 sustained | 0.78-1.0 fade
  function vfxLine(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    if (p < 0.42){
      let intensity;
      if (p < 0.30) intensity = smooth(p/0.30) * 0.8;
      else intensity = 0.8 + smooth(phase(p,0.30,0.42))*0.2;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.42) return;
    }
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const len = Math.hypot(dx,dy);
    const ang = Math.atan2(dy, dx);
    const reach = Math.max(len, 600);
    const halfW = 60;
    let grow = 1, fade = 1;
    if (p < 0.50) grow = easeOut(phase(p, 0.42, 0.50));
    if (p > 0.78) fade = 1 - smooth(phase(p, 0.78, 1.0));
    ctx.save();
    ctx.translate(caster.x, caster.y); ctx.rotate(ang);
    const g = ctx.createLinearGradient(0,0, reach*grow, 0);
    g.addColorStop(0, withAlpha(c.hot, fade*.9));
    g.addColorStop(.5, withAlpha(c.mid, fade*.6));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, -halfW, reach*grow, halfW*2);
    ctx.strokeStyle = withAlpha("#ffffff", fade);
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(reach*grow, 0); ctx.stroke();
    ctx.restore();
  }

  // ---- WALL ----
  // 0.00-0.25 charge | 0.25-0.45 conjure (grows) | 0.45-0.85 sustain | 0.85-1.0 fade
  function vfxWall(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    if (p < 0.45){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.8;
      else intensity = 0.8 - smooth(phase(p,0.25,0.45))*0.4;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
    }
    const grow = p < 0.45 ? easeOut(phase(p, 0.25, 0.45)) : 1;
    const fade = p > 0.85 ? 1 - smooth(phase(p, 0.85, 1.0)) : 1;
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx) + Math.PI/2;
    const half = 200 * grow;
    const thick = 24;
    ctx.save();
    ctx.translate(target.x, target.y); ctx.rotate(ang);
    const g = ctx.createLinearGradient(-half, 0, half, 0);
    g.addColorStop(0, withAlpha(c.cool, fade*.3));
    g.addColorStop(.5, withAlpha(c.hot, fade*.95));
    g.addColorStop(1, withAlpha(c.cool, fade*.3));
    ctx.fillStyle = g;
    ctx.fillRect(-half, -thick, half*2, thick*2);
    ctx.strokeStyle = withAlpha(c.hot, fade);
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -thick, half*2, thick*2);
    for (let i=-5;i<=5;i++){
      const x = i*40 + Math.sin(p*8+i)*6;
      ember(ctx, x, 0, 12, fade*0.8, c.hot, c.mid);
    }
    ctx.restore();
  }

  function vfxAuraHeal(ctx, p, caster, target, spell){
    const c = window.SCHOOLS.holy;
    // 0.00-0.20 ring grows | 0.20-0.80 sustain with rising motes | 0.80-1.0 fade
    const grow = p < 0.20 ? easeOut(p/0.20) : 1;
    const r = (60 + Math.sin(p*Math.PI*4)*6) * grow;
    const fade = p < 0.20 ? p/0.20 : 1 - clamp((p-0.80)/0.20, 0, 1);
    ctx.save();
    // ring on ground
    ctx.strokeStyle = withAlpha(c.hot, fade);
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]); ctx.lineDashOffset = -p*40;
    ctx.beginPath(); ctx.ellipse(target.x, target.y+30, r, r*0.4, 0, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    // rising crosses (motes)
    for (let i=0;i<12;i++){
      const lp = ((i/12) + p*0.9) % 1;
      const ang = (i*0.71) % (Math.PI*2);
      const px = target.x + Math.cos(ang)*r*0.6;
      const py = target.y + 30 - lp*120;
      const a = (1 - lp) * fade;
      ctx.fillStyle = withAlpha(c.hot, a);
      ctx.fillRect(px-1, py-5, 2, 10);
      ctx.fillRect(px-5, py-1, 10, 2);
    }
    // glow on target
    const g = ctx.createRadialGradient(target.x, target.y, 10, target.x, target.y, 60);
    g.addColorStop(0, withAlpha(c.hot, fade*.55));
    g.addColorStop(1, withAlpha(c.hot, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(target.x, target.y, 60, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function vfxAuraBuff(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const r1 = 44 + Math.sin(p*Math.PI*2)*6;
    const r2 = 56 + Math.sin(p*Math.PI*2 + 1)*6;
    const fade = p < 0.15 ? p/0.15 : 1 - clamp((p-0.85)/0.15, 0, 1);
    ctx.save();
    ctx.strokeStyle = withAlpha(c.hot, fade*.9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(target.x, target.y, r1, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = withAlpha(c.mid, fade*.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(target.x, target.y, r2, 0, Math.PI*2); ctx.stroke();
    for (let i=0;i<6;i++){
      const ang = i/6 * Math.PI*2 + p*2;
      const px = target.x + Math.cos(ang)*r2;
      const py = target.y + Math.sin(ang)*r2;
      ember(ctx, px, py, 5, fade, c.hot, c.mid);
    }
    ctx.restore();
  }

  // ---- DEBUFF (Vicious Mockery, Hex, etc.) ----
  // 0.00-0.30 charge | 0.30-0.40 release | 0.40-0.85 swirling | 0.85-1.0 fade
  function vfxDebuff(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const sameSpot = Math.hypot(caster.x-target.x, caster.y-target.y) < 60;
    if (p < 0.40 && !sameSpot){
      let intensity;
      if (p < 0.30) intensity = smooth(p/0.30) * 0.8;
      else intensity = 0.8 - snap(phase(p,0.30,0.40))*0.8;
      drawChannelOrb(ctx, caster, target, intensity, spell?.school, p);
      if (p < 0.40) return;
    }
    let fade;
    if (p < 0.50) fade = smooth(phase(p, sameSpot?0.10:0.40, sameSpot?0.30:0.50));
    else if (p < 0.85) fade = 1;
    else fade = 1 - smooth(phase(p, 0.85, 1.0));
    ctx.save();
    for (let i=0;i<12;i++){
      const ang = (i/12)*Math.PI*2 + p*Math.PI*2;
      const r = 50 + Math.sin(p*6+i)*10;
      const x = target.x + Math.cos(ang)*r;
      const y = target.y + Math.sin(ang)*r;
      smokePuff(ctx, x, y, 18, fade*0.8, spell?.school !== "psychic");
      if (spell?.school === "psychic"){
        ember(ctx, x, y, 6, fade*0.6, c.hot, c.mid);
      }
    }
    ctx.restore();
  }

  // ---- MELEE: SWORD SLASH ----
  // ---- MELEE: SWORD SLASH ----
  // Overhead chop — always travels top→bottom on screen.
  // 0.00-0.15 weapon appears (raised) | 0.15-0.50 wind-up higher | 0.50-0.60 peak hold
  // 0.60-0.74 chop down | 0.74-0.88 follow-through | 0.88-1.0 return
  function vfxMeleeSlash(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx);
    const distT = Math.hypot(dx,dy);
    const swordLen = Math.min(110, Math.max(75, distT*0.55));

    // sword anchor: pivot point on caster side of the gap
    const px = caster.x + Math.cos(ang)*40;
    const py = caster.y + Math.sin(ang)*40;

    // Swing progress u: 0 = fully raised (up), 1 = fully chopped (down).
    let u;
    let alpha = 1;
    if (p < 0.15){
      u = -0.05; alpha = smooth(p/0.15);
    } else if (p < 0.50){
      u = lerp(-0.05, -0.12, smooth(phase(p, 0.15, 0.50)));    // wind up higher
    } else if (p < 0.60){
      u = -0.12 + Math.sin((p-0.50)*60) * 0.012;               // tense hold
    } else if (p < 0.74){
      u = lerp(-0.12, 0.92, blast(phase(p, 0.60, 0.74)));      // chop down fast
    } else if (p < 0.88){
      u = lerp(0.92, 1.08, smooth(phase(p, 0.74, 0.88)));      // follow-through
    } else {
      u = 1.08; alpha = 1 - smooth(phase(p, 0.88, 1.0));
    }

    if (alpha > 0){
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(chopAngle(ang, u));
      shapeSword(ctx, swordLen);
      ctx.restore();
    }

    // motion trail during the chop
    if (p >= 0.60 && p < 0.78){
      const sp = phase(p, 0.60, 0.78);
      const a0 = chopAngle(ang, -0.12);
      const a1 = chopAngle(ang, lerp(-0.12, 0.92, blast(sp)));
      const ccw = a1 < a0;
      ctx.save();
      ctx.translate(px, py);
      ctx.lineCap = "round";
      ctx.strokeStyle = withAlpha("#ffffff", (1-sp)*0.75);
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(0, 0, swordLen*0.85, a0, a1, ccw); ctx.stroke();
      ctx.strokeStyle = withAlpha(c.hot, (1-sp)*0.45);
      ctx.lineWidth = 22;
      ctx.beginPath(); ctx.arc(0, 0, swordLen*0.85, a0, a1, ccw); ctx.stroke();
      ctx.restore();
    }

    // Impact at target around p ~ 0.72
    if (p > 0.66 && p < 0.92){
      const ip = phase(p, 0.66, 0.92);
      const fa = 1 - ip;
      ctx.save();
      const rngS = rng(7);
      for (let i=0;i<10;i++){
        const aSpark = rngS()*Math.PI*2;
        const slen = 22 + rngS()*28;
        spark(ctx, target.x, target.y, aSpark, slen*(1-ip*0.3), fa, "#ffe0a0");
      }
      ember(ctx, target.x, target.y, 28*fa, fa*0.9, "#ffffff", c.hot);
      ctx.restore();
    }
  }

  // ---- MELEE: LONGSWORD SLASH (image-based hero swing) ----
  // Uses the ornate longsword art. A heavier, wider arc than the line-art slash:
  // 0.00-0.14 raise | 0.14-0.52 slow wind-up overhead | 0.52-0.62 peak hold
  // 0.62-0.76 fast swing through | 0.76-0.90 follow-through | 0.90-1.0 settle
  function vfxLongswordSlash(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx);
    const distT = Math.hypot(dx, dy);
    const swordLen = Math.min(150, Math.max(105, distT*0.7));

    // pivot just in front of the caster, on the line to the target
    const px = caster.x + Math.cos(ang)*42;
    const py = caster.y + Math.sin(ang)*42;

    // wide overhead chop — always top→bottom on screen.
    // u: 0 = fully raised, 1 = fully chopped down (slight over/undershoot for flourish)
    let u, alpha = 1;
    if (p < 0.14){
      u = -0.06; alpha = smooth(p/0.14);
    } else if (p < 0.52){
      u = lerp(-0.06, -0.16, smooth(phase(p, 0.14, 0.52)));        // wind up higher
    } else if (p < 0.62){
      u = -0.16 + Math.sin((p-0.52)*55) * 0.012;                   // tense hold
    } else if (p < 0.76){
      u = lerp(-0.16, 1.0, blast(phase(p, 0.62, 0.76)));           // whip down
    } else if (p < 0.90){
      u = lerp(1.0, 1.14, smooth(phase(p, 0.76, 0.90)));           // follow-through
    } else {
      u = 1.14; alpha = 1 - smooth(phase(p, 0.90, 1.0));
    }

    // glint trail during the chop (gold + white, matching the blade)
    if (p >= 0.62 && p < 0.82){
      const sp = phase(p, 0.62, 0.82);
      const a0 = chopAngle(ang, -0.16);
      const a1 = chopAngle(ang, lerp(-0.16, 1.0, blast(sp)));
      const ccw = a1 < a0;
      ctx.save();
      ctx.translate(px, py);
      ctx.lineCap = "round";
      ctx.strokeStyle = withAlpha("#fff7e0", (1-sp)*0.85);
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(0, 0, swordLen*0.9, a0, a1, ccw); ctx.stroke();
      ctx.strokeStyle = withAlpha("#f4c95a", (1-sp)*0.5);
      ctx.lineWidth = 30;
      ctx.beginPath(); ctx.arc(0, 0, swordLen*0.9, a0, a1, ccw); ctx.stroke();
      ctx.restore();
    }

    if (alpha > 0){
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px, py);
      ctx.rotate(chopAngle(ang, u));
      shapeLongswordImg(ctx, swordLen);
      ctx.restore();
    }

    // heavy impact at target around p ~ 0.72
    if (p > 0.66 && p < 0.94){
      const ip = phase(p, 0.66, 0.94);
      const fa = 1 - ip;
      ctx.save();
      const rngS = rng(11);
      for (let i=0;i<14;i++){
        const aSpark = rngS()*Math.PI*2;
        const slen = 26 + rngS()*36;
        spark(ctx, target.x, target.y, aSpark, slen*(1-ip*0.3), fa, "#ffe9b0");
      }
      ember(ctx, target.x, target.y, 36*fa, fa, "#ffffff", "#f4c95a");
      ctx.restore();
    }
  }

  // ---- MELEE: DAGGER STAB ----
  // 0.00-0.15 dagger appears | 0.15-0.45 cocked back | 0.45-0.55 hold
  // 0.55-0.68 lunge forward (fast) | 0.68-0.85 impact | 0.85-1.0 retract
  function vfxMeleeStab(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx);
    const distT = Math.hypot(dx,dy);

    // dagger position along caster→target axis
    let reach;
    let alpha = 1;
    if (p < 0.15){ reach = -16; alpha = smooth(p/0.15); }
    else if (p < 0.45){ reach = lerp(-16, -28, smooth(phase(p,0.15,0.45))); }
    else if (p < 0.55){ reach = -28 + Math.sin((p-0.45)*60)*1.5; }
    else if (p < 0.68){ reach = lerp(-28, distT*0.75, blast(phase(p,0.55,0.68))); }
    else if (p < 0.85){ reach = distT*0.75; }
    else { reach = lerp(distT*0.75, -10, snap(phase(p,0.85,1.0))); alpha = 1 - phase(p,0.95,1.0); }

    if (alpha > 0){
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(caster.x, caster.y);
      ctx.rotate(ang);
      // motion trail during lunge
      if (p > 0.55 && p < 0.70){
        const sp = phase(p, 0.55, 0.70);
        ctx.strokeStyle = withAlpha("#ffffff", (1-sp)*0.55);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(40, 0); ctx.lineTo(reach, 0); ctx.stroke();
        ctx.strokeStyle = withAlpha(c.hot, (1-sp)*0.4);
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(40, 0); ctx.lineTo(reach, 0); ctx.stroke();
      }
      ctx.translate(reach, 0);
      shapeDagger(ctx, 36);
      ctx.restore();
    }

    // impact at target during lunge peak
    if (p > 0.62 && p < 0.88){
      const ip = phase(p, 0.62, 0.88);
      const fa = 1 - ip;
      ctx.save();
      const rngS = rng(11 + (spell?.id||"x").length);
      for (let i=0;i<8;i++){
        const aSpark = ang + (rngS()-.5)*Math.PI;
        spark(ctx, target.x, target.y, aSpark, 22, fa*0.8, "#ffd0c0");
      }
      ember(ctx, target.x, target.y, 18*fa, fa*0.7, "#ffffff", c.hot);
      ctx.restore();
    }
  }

  // ---- MELEE: HAMMER SMASH ----
  // 0.00-0.15 hammer appears | 0.15-0.50 raise overhead | 0.50-0.58 peak
  // 0.58-0.72 swing down | 0.72-0.90 shockwave + debris | 0.90-1.0 settle
  function vfxMeleeSmash(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const ang = Math.atan2(dy, dx);

    // overhead smash — raised up then driven straight down (top→bottom on screen)
    let u;
    let alpha = 1;
    if (p < 0.15){ u = -0.05; alpha = smooth(p/0.15); }
    else if (p < 0.50){ u = lerp(-0.05, -0.14, smooth(phase(p,0.15,0.50))); }
    else if (p < 0.58){ u = -0.14 + Math.sin((p-0.50)*70)*0.01; }
    else if (p < 0.72){ u = lerp(-0.14, 1.0, blast(phase(p,0.58,0.72))); }
    else if (p < 0.92){ u = 1.0; }
    else { u = 1.0; alpha = 1 - smooth(phase(p,0.92,1.0)); }

    if (alpha > 0){
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(caster.x + Math.cos(ang)*30, caster.y + Math.sin(ang)*30);
      ctx.rotate(chopAngle(ang, u));
      shapeHammer(ctx, 80);
      ctx.restore();
    }

    // Shockwave on impact
    if (p > 0.66){
      const ip = phase(p, 0.66, 1.0);
      const r = ip * 110;
      const a = 1 - ip;
      ctx.save();
      ctx.strokeStyle = withAlpha(c.hot, a);
      ctx.lineWidth = 7 * a + 1;
      ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.stroke();
      const rngD = rng(17);
      for (let i=0;i<12;i++){
        const aa = rngD()*Math.PI*2;
        const dr = r + (rngD()-.5)*20;
        smokePuff(ctx, target.x+Math.cos(aa)*dr, target.y+Math.sin(aa)*dr, 20, a*0.7, true);
      }
      for (let i=0;i<10;i++){
        const aa = i/10*Math.PI*2 + rngD()*.5;
        const dr = r * (0.7 + rngD()*0.5);
        ctx.fillStyle = withAlpha("#6e5238", a);
        ctx.fillRect(target.x+Math.cos(aa)*dr - 2, target.y+Math.sin(aa)*dr - 2, 4, 4);
      }
      if (spell?.school === "lightning"){
        for (let i=0;i<8;i++){
          const aa = i/8*Math.PI*2;
          spark(ctx, target.x, target.y, aa, r*0.7, a, "#bff0ff");
        }
      }
      ctx.restore();
    }
  }

  // ---- MELEE: UNARMED STRIKE (Hearthstone-style charge) ----
  // The TOKEN itself does the work (lift → hover → slam) in the drawScene
  // pre-pass; this VFX only paints the impact "POW" at the moment of collision.
  // Impact lands at p ≈ 0.52 (see flashAtFor).
  function vfxMeleeUnarmed(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);

    // Speed/motion lines streaking behind the charging token (during the slam).
    if (p > 0.42 && p < 0.56){
      const sp2 = phase(p, 0.42, 0.56);
      ctx.save();
      ctx.strokeStyle = withAlpha("#ffffff", (1-sp2)*0.5);
      ctx.lineWidth = 4; ctx.lineCap = "round";
      for (let i=-1;i<=1;i++){
        const off = i*16;
        const ox = Math.cos(ang+Math.PI/2)*off, oy = Math.sin(ang+Math.PI/2)*off;
        ctx.beginPath();
        ctx.moveTo(caster.x+ox - Math.cos(ang)*34, caster.y+oy - Math.sin(ang)*34);
        ctx.lineTo(caster.x+ox - Math.cos(ang)*6,  caster.y+oy - Math.sin(ang)*6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Impact burst at the target — the satisfying collision flash.
    if (p > 0.50 && p < 0.80){
      const ip = phase(p, 0.50, 0.80);
      const fa = 1 - ip;
      const ix = target.x, iy = target.y;
      ctx.save();

      // white flash core
      const fr = lerp(20, 74, easeOut(ip));
      let g = ctx.createRadialGradient(ix, iy, 0, ix, iy, fr);
      g.addColorStop(0, withAlpha("#ffffff", fa));
      g.addColorStop(0.4, withAlpha("#ffe9b0", fa*0.8));
      g.addColorStop(1, withAlpha(c.hot, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(ix, iy, fr, 0, Math.PI*2); ctx.fill();

      // chunky impact star (classic POW)
      const spikes = 9;
      const rOuter = lerp(24, 100, easeOut(ip));
      const rInner = rOuter * 0.42;
      const spin = p * 2.0;
      ctx.beginPath();
      for (let i=0;i<spikes*2;i++){
        const a = (i/(spikes*2))*Math.PI*2 - Math.PI/2 + spin;
        const rr = i%2===0 ? rOuter : rInner;
        const px = ix + Math.cos(a)*rr, py = iy + Math.sin(a)*rr;
        i===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha("#fff4d0", fa*0.5);
      ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = withAlpha("#ffffff", fa*0.8); ctx.stroke();

      // expanding shock ring
      ctx.strokeStyle = withAlpha("#ffffff", fa*0.9);
      ctx.lineWidth = 6*fa + 1.5;
      ctx.beginPath(); ctx.arc(ix, iy, lerp(16, 96, easeOut(ip)), 0, Math.PI*2); ctx.stroke();

      // radial sparks
      const rngS = rng(13 + (spell?.id||"x").length);
      for (let i=0;i<12;i++){
        const a = rngS()*Math.PI*2;
        const d0 = 20 + ip*44;
        spark(ctx, ix+Math.cos(a)*d0, iy+Math.sin(a)*d0, a, 24*fa, fa, "#ffd98a");
      }
      // dust kicked up
      for (let i=0;i<6;i++){
        const a = i/6*Math.PI*2 + 0.4;
        const dr = lerp(10, 74, easeOut(ip));
        smokePuff(ctx, ix+Math.cos(a)*dr, iy+Math.sin(a)*dr, 18, fa*0.45, false);
      }
      ctx.restore();
    }
  }

  // Impact progress (0..1) at which a given spell/attack "lands" — used to
  // time impact flashes, camera punch, and flying damage numbers in one place.
  function flashAtFor(sp){
    const vfx = sp?.vfx;
    if (sp?.id === 'fireball') return 0.85;
    if (vfx === 'projectile') return 0.90;
    if (vfx === 'ranged-shot') return 0.93;
    if (sp?.id === 'handaxe-throw') return 0.93;
    if (sp?.id === 'throwing-dagger') return 0.94;
    if (vfx === 'melee-unarmed') return 0.52;
    if (vfx === 'melee-slash') return 0.72;
    if (vfx === 'melee-longsword') return 0.72;
    if (vfx === 'melee-stab')  return 0.68;
    if (vfx === 'melee-smash') return 0.72;
    if (vfx === 'bolt' || vfx === 'chain') return 0.55;
    if (vfx === 'missile-volley') return 0.88;
    if (vfx === 'aoe-burst') return 0.62;
    if (vfx === 'beam' || vfx === 'ray') return 0.62;
    if (vfx === 'cone') return 0.55;
    return 0.78;
  }

  // ---- Floating damage number ----
  // Two flavors, both set in the Abril Fatface display face:
  //  • normal: numbers explode out of a blurred oversized flash, slam into place
  //    with an elastic bounce, then drift down and fade — pulsing gold glow.
  //  • crit (crit=true): starts tiny, explodes with a flash + slight rotation,
  //    overshoots, then snap-wobbles to rest over layered golden comic shadows.
  // `age` = seconds since impact. `dmg` may be a string ("12", "+8" heal).
  function dmgFont(px){
    return `400 ${px}px "Abril Fatface", "Arial Black", system-ui, serif`;
  }
  function drawDamageNumber(ctx, x, y, dmg, age, crit){
    const txt = (dmg+"").trim();
    if (!txt) return;
    if (age < 0) return;
    const isHeal = txt.startsWith("+");
    if (crit) { drawCritNumber(ctx, x, y, txt, age, isHeal); return; }

    // ---------- NORMAL ----------
    const DUR = 1.35;
    const t = clamp(age / DUR, 0, 1);
    if (t >= 1) return;

    // scale: oversized → slam → small elastic settle
    let scale;
    if (age < 0.10){
      scale = lerp(1.95, 1.12, blast(age / 0.10));
    } else {
      const tt = phase(age, 0.10, 0.60);
      scale = 1.0 + 0.12 * Math.cos(tt * Math.PI * 3) * (1 - tt); // damped wobble → 1.0
    }
    // motion: a tiny kick up on impact, then drift DOWN as it fades
    const drop = blast(clamp((age - 0.34) / 0.95, 0, 1)) * 58 - blast(clamp(age/0.12,0,1)) * 8;
    const alpha = age < 0.92 ? 1 : clamp(1 - (age - 0.92) / 0.43, 0, 1);
    const fontPx = 60;

    ctx.save();
    ctx.translate(x, y + drop);

    // explosion flash behind the number (first ~0.22s)
    if (age < 0.24){
      const fp = age / 0.24;
      const fr = lerp(20, 96, blast(fp));
      const fa = (1 - fp) * 0.85;
      const fg = ctx.createRadialGradient(0,0,0, 0,0,fr);
      fg.addColorStop(0, withAlpha("#ffffff", fa));
      fg.addColorStop(0.4, withAlpha(isHeal ? "#9dff8a" : "#ffd27a", fa*0.8));
      fg.addColorStop(1, withAlpha(isHeal ? "#1f9b3a" : "#ff6a1a", 0));
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0,0,fr,0,Math.PI*2); ctx.fill();
    }

    ctx.scale(scale, scale);
    ctx.font = dmgFont(fontPx);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    // blurred oversized ghost during the explosion in-rush
    if (age < 0.14){
      const bf = 1 - age / 0.14;
      ctx.save();
      ctx.filter = `blur(${(bf * 9).toFixed(1)}px)`;
      ctx.globalAlpha = alpha * 0.9 * bf;
      ctx.fillStyle = isHeal ? "#d6ffc0" : "#ffe6b0";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }

    // pulsing fire-orange / gold glow shadow
    const glowPulse = 12 + (Math.sin(age * 20) * 0.5 + 0.5) * 14;
    ctx.shadowColor = withAlpha(isHeal ? "#76ff5a" : "#ff8a1e", alpha * 0.9);
    ctx.shadowBlur = glowPulse;
    ctx.shadowOffsetY = 0;

    // dark outline
    ctx.lineWidth = 8;
    ctx.strokeStyle = withAlpha("#2a0f06", alpha);
    ctx.strokeText(txt, 0, 0);
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

    // body gradient
    const g = ctx.createLinearGradient(0, -fontPx*0.55, 0, fontPx*0.55);
    if (isHeal){
      g.addColorStop(0, "#e8ffd0"); g.addColorStop(0.55, "#6fe06a"); g.addColorStop(1, "#1f9b3a");
    } else {
      g.addColorStop(0, "#fff1b8"); g.addColorStop(0.5, "#ff6a3c"); g.addColorStop(1, "#c4161b");
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillText(txt, 0, 0);
    // top sheen
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(txt, 0, -fontPx*0.06);
    ctx.restore();
  }

  // ---- CRIT damage number (comic-book punch-through) ----
  function drawCritNumber(ctx, x, y, txt, age, isHeal){
    const DUR = 1.7;
    const t = clamp(age / DUR, 0, 1);
    if (t >= 1) return;
    const FINAL = 1.5;

    // scale: tiny → explosive overshoot → snap-back with micro-wobble
    let scale, rot;
    if (age < 0.09){
      const e = blast(age / 0.09);
      scale = lerp(0.12, FINAL * 1.24, e);
      rot   = lerp(-0.24, 0.05, e);
    } else {
      const tt = phase(age, 0.09, 0.46);
      scale = FINAL + (FINAL * 0.24) * Math.cos(tt * Math.PI * 2.6) * (1 - tt);
      rot   = 0.05 * Math.cos(tt * Math.PI * 3.4) * (1 - tt);
    }
    const alpha = age < 1.18 ? 1 : clamp(1 - (age - 1.18) / 0.52, 0, 1);
    const fontPx = 64;

    ctx.save();
    ctx.translate(x, y - 4);

    // bright flash + radiating comic rays on the explosion
    if (age < 0.30){
      const fp = age / 0.30;
      const fr = lerp(26, 130, blast(fp));
      const fa = (1 - fp);
      const fg = ctx.createRadialGradient(0,0,0, 0,0,fr);
      fg.addColorStop(0, withAlpha("#ffffff", fa));
      fg.addColorStop(0.35, withAlpha("#ffdf7a", fa*0.9));
      fg.addColorStop(1, withAlpha("#ff8a00", 0));
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(0,0,fr,0,Math.PI*2); ctx.fill();
      // sharp rays
      ctx.save();
      ctx.strokeStyle = withAlpha("#fff3c4", fa*0.9);
      ctx.lineCap = "round";
      for (let i=0;i<10;i++){
        const a = (i/10)*Math.PI*2 + 0.2;
        const r0 = fr*0.45, r1 = fr*(0.85 + (i%2)*0.25);
        ctx.lineWidth = (i%2 ? 2 : 4);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0);
        ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.font = dmgFont(fontPx);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha;

    // layered golden drop shadows — comic punch-through stack
    const layers = 7;
    for (let i = layers; i >= 1; i--){
      const off = i * 2.4;
      const u = i / layers;                 // 1 = deepest/darkest
      const col = isHeal
        ? `rgb(${Math.round(18+40*(1-u))}, ${Math.round(70+60*(1-u))}, ${Math.round(20+30*(1-u))})`
        : `rgb(${Math.round(90+120*(1-u))}, ${Math.round(45+80*(1-u))}, ${Math.round(4+18*(1-u))})`;
      ctx.fillStyle = withAlpha(col, alpha);
      ctx.fillText(txt, off, off);
    }

    // crisp dark edge
    ctx.lineWidth = 7;
    ctx.strokeStyle = withAlpha("#1a0a02", alpha);
    ctx.strokeText(txt, 0, 0);

    // bright golden face
    const g = ctx.createLinearGradient(0, -fontPx*0.6, 0, fontPx*0.6);
    if (isHeal){
      g.addColorStop(0, "#f0ffd8"); g.addColorStop(0.5, "#86f06a"); g.addColorStop(1, "#1f9b3a");
    } else {
      g.addColorStop(0, "#fff7d0"); g.addColorStop(0.45, "#ffc23a"); g.addColorStop(1, "#e0440a");
    }
    ctx.fillStyle = g;
    ctx.fillText(txt, 0, 0);
    // sheen
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(txt, 0, -fontPx*0.08);
    ctx.restore();
  }

  // ---- RANGED SHOT — bow draws slowly, holds, then arrow flies ----
  // 0.00-0.15 bow appears | 0.15-0.55 draw string back | 0.55-0.62 hold
  // 0.62-0.70 release snap | 0.70-0.92 arrow flies | 0.92-1.0 stuck + sparks
  function vfxRangedShot(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);

    // Phase 1+2+3: bow visible from 0 to ~0.70
    if (p < 0.70){
      // bow opacity ramps in 0..0.15, full thereafter, fades 0.66-0.70
      let bowAlpha;
      if (p < 0.15) bowAlpha = smooth(p / 0.15);
      else if (p > 0.66) bowAlpha = 1 - smooth(phase(p, 0.66, 0.70));
      else bowAlpha = 1;
      // string pull: slow draw 0.15-0.55, hold 0.55-0.62, snap forward 0.62-0.66
      let drawT;
      if (p < 0.15) drawT = 0;
      else if (p < 0.55) drawT = smooth(phase(p, 0.15, 0.55));    // ease through draw
      else if (p < 0.62) drawT = 1 + Math.sin((p-0.55)*120) * 0.04; // tiny tremor at hold
      else drawT = 1 - snap(phase(p, 0.62, 0.66));                  // snap forward
      drawHeldBow(ctx, caster, target, drawT, bowAlpha);

      // Build glow at arrow head during charge (so school is readable)
      if (p > 0.20 && p < 0.62 && spell?.school && spell.school !== "ranged"){
        const cp = smooth(phase(p, 0.20, 0.62));
        const hx = caster.x + Math.cos(ang) * 14;
        const hy = caster.y + Math.sin(ang) * 14;
        // arrow tip is at: rotate bow vertical → pull amount + small offset along axis
        const pull = (drawT >= 0 ? drawT : 0) * 22;
        const tipDist = 14 + 36 - pull;
        const tx = hx + Math.cos(ang) * tipDist;
        const ty = hy + Math.sin(ang) * tipDist;
        ember(ctx, tx, ty, 8*cp, cp*0.8, c.hot, c.mid);
      }
      if (p < 0.70) return;
    }

    // Phase 4: arrow flies 0.70 - 0.92
    if (p < 0.92){
      const fp = phase(p, 0.70, 0.92);
      const tt = easeOut(fp);                       // fast initial, slow approach
      const sx = caster.x + Math.cos(ang) * 30;
      const sy = caster.y + Math.sin(ang) * 30;
      const x = lerp(sx, target.x, tt);
      const y = lerp(sy, target.y, tt);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // motion blur
      for (let i=3;i>0;i--){
        ctx.save();
        ctx.translate(-i*14, 0);
        ctx.globalAlpha = 0.25 / i;
        shapeArrow(ctx, 44, "#b9484a");
        ctx.restore();
      }
      shapeArrow(ctx, 44, "#b9484a");
      ctx.restore();
      // glow trail for elemental arrows
      if (spell?.school === "fire" || spell?.school === "cold" || spell?.school === "holy"){
        ember(ctx, x, y, 8, 0.6, c.hot, c.mid);
      }
      return;
    }

    // Phase 5: stuck arrow + sparks 0.92-1.0
    const ip = phase(p, 0.92, 1.0);
    const ang2 = ang;
    ctx.save();
    ctx.translate(target.x - Math.cos(ang2)*18, target.y - Math.sin(ang2)*18);
    ctx.rotate(ang2);
    shapeArrow(ctx, 44, "#b9484a");
    ctx.restore();
    const fa = 1 - ip;
    const rngS = rng(19 + (spell?.id||"x").length);
    for (let i=0;i<8;i++){
      const aSpark = rngS()*Math.PI*2;
      spark(ctx, target.x, target.y, aSpark, 18*fa, fa, "#ffd0a0");
    }
  }

  // ---- THROWING AXE — pulled out, raised back, thrown, spins to target ----
  // 0.00-0.15 appears in hand | 0.15-0.45 pulled back behind | 0.45-0.55 hold
  // 0.55-0.62 throw whip-forward | 0.62-0.90 spinning flight | 0.90-1.0 embedded + sparks
  function vfxThrownAxe(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);

    // Held weapon phase (caster prep)
    if (p < 0.62){
      // alpha fades in then out at throw
      let alpha;
      if (p < 0.15) alpha = smooth(p / 0.15);
      else if (p > 0.58) alpha = 1 - snap(phase(p, 0.58, 0.62));
      else alpha = 1;
      // pose: +0.2 forward at start, -1.0 fully back at hold, +0.4 launched
      let pose;
      if (p < 0.15) pose = 0.2;
      else if (p < 0.45) pose = lerp(0.2, -1.0, smooth(phase(p, 0.15, 0.45)));
      else if (p < 0.55) pose = -1.0 + Math.sin((p-0.45)*60) * 0.04;  // tremor
      else pose = lerp(-1.0, 0.5, snap(phase(p, 0.55, 0.62)));
      drawHeldWeapon(ctx, caster, target, pose, "axe", alpha);
      if (p < 0.62) return;
    }

    // Flight 0.62-0.90
    if (p < 0.90){
      const fp = phase(p, 0.62, 0.90);
      const tt = easeInOut(fp);
      const sx = caster.x + Math.cos(ang) * 36;
      const sy = caster.y + Math.sin(ang) * 36;
      const x = lerp(sx, target.x, tt);
      const y = lerp(sy, target.y, tt);
      // motion trail (rotating axes fading behind)
      for (let i=3;i>0;i--){
        const lp = clamp(tt - i*0.05, 0, 1);
        const tx = lerp(sx, target.x, lp);
        const ty = lerp(sy, target.y, lp);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang + lp * Math.PI * 6);
        ctx.globalAlpha = (1 - i/3) * 0.4;
        shapeAxe(ctx, 50);
        ctx.restore();
      }
      // main axe
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + tt * Math.PI * 6);   // 3 rotations
      shapeAxe(ctx, 50);
      ctx.restore();
      return;
    }

    // Impact 0.90-1.0
    const ip = phase(p, 0.90, 1.0);
    ctx.save();
    ctx.translate(target.x - Math.cos(ang)*12, target.y - Math.sin(ang)*12);
    ctx.rotate(ang);
    shapeAxe(ctx, 50);
    ctx.restore();
    const fa = 1 - ip;
    const rngS = rng(23);
    for (let i=0;i<8;i++){
      const aS = rngS()*Math.PI*2;
      spark(ctx, target.x, target.y, aS, 22*fa, fa, "#ffd0a0");
    }
  }

  // ---- THROWING DAGGER — drawn, cocked back, flicked, spins to target ----
  function vfxThrownDagger(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const ang = Math.atan2(target.y - caster.y, target.x - caster.x);

    if (p < 0.60){
      let alpha = p < 0.12 ? smooth(p/0.12) : (p > 0.55 ? 1 - snap(phase(p, 0.55, 0.60)) : 1);
      let pose;
      if (p < 0.12) pose = 0.2;
      else if (p < 0.40) pose = lerp(0.2, -0.7, smooth(phase(p, 0.12, 0.40)));
      else if (p < 0.50) pose = -0.7;
      else pose = lerp(-0.7, 0.5, snap(phase(p, 0.50, 0.60)));
      drawHeldWeapon(ctx, caster, target, pose, "dagger", alpha);
      if (p < 0.60) return;
    }

    if (p < 0.92){
      const fp = phase(p, 0.60, 0.92);
      const tt = easeInOut(fp);
      const sx = caster.x + Math.cos(ang)*32;
      const sy = caster.y + Math.sin(ang)*32;
      const x = lerp(sx, target.x, tt);
      const y = lerp(sy, target.y, tt);
      // trail
      for (let i=3;i>0;i--){
        const lp = clamp(tt - i*0.05, 0, 1);
        const tx = lerp(sx, target.x, lp);
        const ty = lerp(sy, target.y, lp);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(ang + lp*Math.PI*8);
        ctx.globalAlpha = (1 - i/3) * 0.35;
        shapeDagger(ctx, 32);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + tt*Math.PI*8);
      shapeDagger(ctx, 32);
      ctx.restore();
      return;
    }

    const ip = phase(p, 0.92, 1.0);
    ctx.save();
    ctx.translate(target.x - Math.cos(ang)*14, target.y - Math.sin(ang)*14);
    ctx.rotate(ang);
    shapeDagger(ctx, 32);
    ctx.restore();
    const fa = 1 - ip;
    for (let i=0;i<6;i++){
      spark(ctx, target.x, target.y, Math.random()*Math.PI*2, 14*fa, fa, "#ffe0c0");
    }
  }

  // ---- VINES (Entangle-style — tendrils crawl out) ----
  // 0.00-0.20 charge | 0.20-0.30 release | 0.30-0.60 vines extend | 0.60-0.85 hold | 0.85-1.0 fade
  function vfxVines(ctx, p, caster, target, spell){
    const c = window.SCHOOLS.nature;

    if (p < 0.30){
      let intensity;
      if (p < 0.20) intensity = smooth(p/0.20) * 0.8;
      else intensity = 0.8 - snap(phase(p,0.20,0.30))*0.8;
      drawChannelOrb(ctx, caster, target, intensity, "nature", p);
      if (p < 0.30) return;
    }
    let fade = 1;
    if (p > 0.85) fade = 1 - smooth(phase(p, 0.85, 1.0));
    const reach = p < 0.60 ? easeInOut(phase(p, 0.30, 0.60)) : 1;
    ctx.save();
    ctx.lineCap = "round";
    for (let v=0; v<5; v++){
      const dx = target.x - caster.x, dy = target.y - caster.y;
      const nx = -dy, ny = dx; const nl = Math.hypot(nx,ny) || 1;
      const off = (v - 2) * 22;
      const midx = (caster.x+target.x)/2 + nx/nl*off + Math.sin(p*4+v)*8;
      const midy = (caster.y+target.y)/2 + ny/nl*off + Math.cos(p*4+v)*8;
      const ex = lerp(caster.x, target.x, reach);
      const ey = lerp(caster.y, target.y, reach);
      ctx.strokeStyle = withAlpha(c.cool, fade);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(caster.x, caster.y);
      ctx.quadraticCurveTo(midx, midy, ex, ey);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(c.mid, fade*0.7);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(caster.x, caster.y);
      ctx.quadraticCurveTo(midx, midy, ex, ey);
      ctx.stroke();
    }
    if (reach >= 0.85){
      const rngL = rng(29);
      for (let i=0;i<14;i++){
        const a2 = rngL()*Math.PI*2;
        const r = 18 + rngL()*30;
        ctx.save();
        ctx.translate(target.x+Math.cos(a2)*r, target.y+Math.sin(a2)*r);
        ctx.rotate(a2);
        ctx.fillStyle = withAlpha(c.mid, fade*0.85);
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = withAlpha(c.hot, fade*0.7);
        ctx.beginPath();
        ctx.ellipse(0, -1, 4, 1.6, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // ---- NATURE THORN (Thorn Whip — quick lash, but with prep) ----
  // 0.00-0.25 windup (vine forms at hand) | 0.25-0.50 hold | 0.50-0.65 lash
  // 0.65-0.85 retract | 0.85-1.0 fade
  function vfxNatureThorn(ctx, p, caster, target, spell){
    const c = window.SCHOOLS.nature;

    if (p < 0.50){
      let intensity;
      if (p < 0.25) intensity = smooth(p/0.25) * 0.85;
      else intensity = 0.85;
      drawChannelOrb(ctx, caster, target, intensity, "nature", p);
      return;
    }

    let fade;
    if (p < 0.65) fade = 1;
    else if (p < 0.85) fade = 1 - phase(p, 0.65, 0.85)*0.3;
    else fade = 0.7 - smooth(phase(p, 0.85, 1.0))*0.7;

    const reach = p < 0.65 ? blast(phase(p, 0.50, 0.65)) : 1;
    ctx.save();
    ctx.lineCap = "round";
    const dx = target.x - caster.x, dy = target.y - caster.y;
    const nx = -dy, ny = dx; const nl = Math.hypot(nx,ny) || 1;
    const wob = Math.sin(p*30)*8;
    const ang = Math.atan2(dy, dx);
    const ex = caster.x + Math.cos(ang) * Math.hypot(dx,dy) * reach;
    const ey = caster.y + Math.sin(ang) * Math.hypot(dx,dy) * reach;
    const midx = (caster.x+ex)/2 + nx/nl*wob;
    const midy = (caster.y+ey)/2 + ny/nl*wob;
    ctx.strokeStyle = withAlpha(c.cool, fade);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(caster.x, caster.y);
    ctx.quadraticCurveTo(midx, midy, ex, ey);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(c.mid, fade*0.8);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(caster.x, caster.y);
    ctx.quadraticCurveTo(midx, midy, ex, ey);
    ctx.stroke();
    for (let i=0;i<8;i++){
      const t = i/8;
      const x = lerp(caster.x, ex, t);
      const y = lerp(caster.y, ey, t);
      ctx.fillStyle = withAlpha(c.hot, fade);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 4, y - 6); ctx.lineTo(x + 2, y); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- SUMMON ----
  function vfxSummon(ctx, p, caster, target, spell){
    const c = getSchool(spell);
    const grow = easeOut(Math.min(p/0.4, 1));
    const fade = 1 - clamp((p-0.7)/0.3, 0, 1);
    const r = 60 * grow;
    ctx.save();
    for (let i=0;i<3;i++){
      ctx.strokeStyle = withAlpha(c.hot, fade*.8 - i*.15);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = -p*100*(i+1)*(i%2?-1:1);
      ctx.beginPath(); ctx.arc(target.x, target.y, r*(1 - i*.18), 0, Math.PI*2); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (let i=0;i<8;i++){
      const a = i/8 * Math.PI*2 + p*2;
      const x = target.x + Math.cos(a)*r*0.9;
      const y = target.y + Math.sin(a)*r*0.9;
      ember(ctx, x, y, 4, fade, c.hot, c.mid);
    }
    const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
    g.addColorStop(0, withAlpha(c.hot, fade*.5));
    g.addColorStop(1, withAlpha(c.cool, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function vfxTeleport(ctx, p, caster, target, spell){
    const c = window.SCHOOLS.force;
    const a1 = p < 0.4 ? 1 - p/0.4 : 0;
    const a2 = p > 0.6 ? (p-0.6)/0.4 : 0;
    ctx.save();
    if (a1 > 0){
      const r = 50 + (1-a1)*40;
      const g = ctx.createRadialGradient(caster.x, caster.y, 0, caster.x, caster.y, r);
      g.addColorStop(0, withAlpha(c.hot, a1*.8));
      g.addColorStop(1, withAlpha(c.cool, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(caster.x, caster.y, r, 0, Math.PI*2); ctx.fill();
      for (let i=0;i<8;i++){
        const ang = i/8*Math.PI*2;
        spark(ctx, caster.x, caster.y, ang, 40*(1-a1), a1, "#cfb5ff");
      }
    }
    if (a2 > 0){
      const r = 50 + (1-a2)*40;
      const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, r);
      g.addColorStop(0, withAlpha(c.hot, a2*.8));
      g.addColorStop(1, withAlpha(c.cool, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // ============================================================
  // DEATH ANIMATIONS
  // Each runs over ~3.5s with phased pacing.
  // Signature: (ctx, p, pos, token, sprite, spell) where pos is the token's center.
  // The underlying token render is faded/transformed via applyDeathTokenTransform()
  // so these VFX layer on top and finish the visual.
  // ============================================================

  // Apply a transform / alpha to the canvas before drawing the underlying token
  // for various death kinds. Called inside ctx.save()/restore().
  function applyDeathTokenTransform(ctx, ds, pos){
    const p = ds.p;
    const kind = ds.kind;
    let alpha = 1;
    switch (kind){
      case 'death-shatter':
        // Stays fully visible until just before chunks fly, then snap-hide.
        alpha = p < 0.20 ? 1 : 0;
        // small jitter during cracking
        if (p < 0.20){
          const j = p / 0.20;
          const rng1 = rng(Math.floor(p*60));
          ctx.translate((rng1()-.5)*j*4, (rng1()-.5)*j*4);
        }
        break;
      case 'death-frost':
        alpha = p < 0.55 ? 1 : 0;
        break;
      case 'death-burn':
        // Stays visible but darkens, then fades after 0.7
        alpha = p < 0.70 ? 1 : 1 - smooth((p-0.70)/0.30);
        break;
      case 'death-disintegrate':
        alpha = 1 - smooth(p);
        // slight upward drift as the body releases dust
        ctx.translate(0, -p * 6);
        break;
      case 'death-melt': {
        alpha = 1 - p*0.5;
        const sy = 1 + p * 1.4;
        const sx = 1 - p * 0.45;
        ctx.translate(pos.x, pos.y + p * 22);
        ctx.scale(sx, sy);
        ctx.translate(-pos.x, -pos.y);
        break;
      }
      case 'death-evaporate':
        alpha = 1 - smooth(p);
        ctx.translate(0, -p * 18);
        break;
      case 'death-vanish':
        alpha = 1 - easeOut(p);
        // tiny shake during sparkle
        if (p > 0.10 && p < 0.55){
          const rng1 = rng(Math.floor(p*80));
          ctx.translate((rng1()-.5)*3, (rng1()-.5)*3);
        }
        break;
      case 'death-petrify':
        // stays fully visible while greying, crumbles after 0.7
        alpha = p < 0.70 ? 1 : 1 - smooth((p-0.70)/0.30);
        break;
      default:
        alpha = 1 - p;
    }
    // Drain the life out of the token: ramp it to black & white as it dies,
    // with a touch of darkening near the end. Applies to ALL death kinds.
    // (The VFX overlays are drawn in a separate pass and keep their color.)
    const gray = clamp(p / 0.45, 0, 1);
    if (gray > 0.001){
      const bright = (1 - 0.20 * smooth(p)).toFixed(3);
      ctx.filter = `grayscale(${gray.toFixed(3)}) brightness(${bright})`;
    }
    ctx.globalAlpha = clamp(alpha, 0, 1);
  }

  // ---- DEATH SHATTER (stone/crystal shards) ----
  function vfxDeathShatter(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    const color = token?.ringColor || "#bababa";
    const seed = (token?.id || "x").length * 13;

    if (p < 0.20){
      // Cracks fan out across the token; faint white shock fissures.
      const cp = p / 0.20;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.strokeStyle = `rgba(255,255,255,${cp*0.95})`;
      ctx.lineWidth = 2;
      const rnd = rng(seed);
      for (let i=0; i<6; i++){
        const a = i/6 * Math.PI*2 + rnd()*0.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        let prevR = 0;
        for (let s=1; s<=4; s++){
          const t = s/4 * cp;
          const rr = r * (0.25 + s*0.2) * cp;
          const aa = a + (rnd()-.5)*0.35;
          ctx.lineTo(Math.cos(aa)*rr, Math.sin(aa)*rr);
          prevR = rr;
        }
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    // Chunks fly outward + tumble + fall
    const cp = (p - 0.20) / 0.80;
    const NUM = 9;
    const alpha = 1 - easeIn(cp);
    if (alpha <= 0) return;
    const rnd = rng(seed);
    ctx.save();
    for (let i=0; i<NUM; i++){
      const ang = i / NUM * Math.PI*2 + rnd()*0.25;
      const spd = 70 + rnd()*40;
      const offX = Math.cos(ang) * spd * cp;
      const offY = Math.sin(ang) * spd * cp + cp*cp*140; // gravity
      const rot = (rnd()-.5) * cp * 5.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pos.x + offX, pos.y + offY);
      ctx.rotate(rot);
      // shard: irregular triangle, faceted look
      const sz = r * (0.4 + rnd()*0.3);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sz, -sz*0.5);
      ctx.lineTo(sz*0.75, sz*0.45);
      ctx.lineTo(sz*0.1, sz*0.5);
      ctx.closePath();
      ctx.fill();
      // highlight edge
      ctx.fillStyle = `rgba(255,255,255,${alpha*0.35})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(sz*0.95, -sz*0.45);
      ctx.lineTo(sz*0.55, -sz*0.05);
      ctx.closePath();
      ctx.fill();
      // dark seam
      ctx.strokeStyle = `rgba(0,0,0,${alpha*0.55})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // dust at impact
    for (let i=0;i<10;i++){
      const a = rnd()*Math.PI*2;
      const dr = r*0.3 + rnd()*r*0.8;
      smokePuff(ctx, pos.x + Math.cos(a)*dr, pos.y + Math.sin(a)*dr, 14, (1-cp)*0.55, false);
    }
  }

  // ---- DEATH FROST (freeze, then shatter as ice) ----
  function vfxDeathFrost(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    if (p < 0.55){
      // Frost crystals creep over the token's silhouette
      const cp = p / 0.55;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      // icy overlay tint
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = `rgba(180,220,255,${cp*0.55})`;
      ctx.fillRect(-r, -r, r*2, r*2);
      ctx.restore();
      // ice shards growing on edges
      const rnd = rng(((token?.id||"x").length+5)*7);
      const shards = Math.floor(2 + cp * 10);
      for (let i=0; i<shards; i++){
        const a = i/10 * Math.PI*2 + rnd()*0.4;
        const rr = r * (0.85 + rnd()*0.2);
        const sx = pos.x + Math.cos(a)*rr;
        const sy = pos.y + Math.sin(a)*rr;
        iceShard(ctx, sx, sy, 6 + rnd()*4, a, 0.8);
      }
      // central freeze ring
      ctx.save();
      ctx.strokeStyle = `rgba(220,240,255,${cp*0.9})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]); ctx.lineDashOffset = -p*30;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r*1.05, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }
    // Ice shatter — ice-tinted shards
    const cp = (p - 0.55) / 0.45;
    const alpha = 1 - easeIn(cp);
    if (alpha <= 0) return;
    const NUM = 10;
    const rnd = rng(((token?.id||"x").length+5)*7);
    ctx.save();
    for (let i=0; i<NUM; i++){
      const ang = i/NUM * Math.PI*2 + rnd()*0.2;
      const spd = 90 + rnd()*40;
      const offX = Math.cos(ang)*spd*cp;
      const offY = Math.sin(ang)*spd*cp + cp*cp*120;
      const rot = (rnd()-.5)*cp*4;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(pos.x + offX, pos.y + offY);
      ctx.rotate(rot);
      // ice shard shape
      const sz = r * (0.45 + rnd()*0.25);
      const g = ctx.createLinearGradient(0, -sz*0.4, 0, sz*0.4);
      g.addColorStop(0, "#eef7ff"); g.addColorStop(0.5, "#bcdcff"); g.addColorStop(1, "#5a8ec0");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-sz*0.1, 0);
      ctx.lineTo(sz, -sz*0.3);
      ctx.lineTo(sz*0.85, sz*0.35);
      ctx.lineTo(sz*0.1, sz*0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(60,110,170,${alpha*0.7})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // frost dust
    for (let i=0;i<8;i++){
      const a = rnd()*Math.PI*2;
      const dr = r*0.4 + rnd()*r*0.8;
      ember(ctx, pos.x + Math.cos(a)*dr, pos.y + Math.sin(a)*dr, 4, (1-cp)*0.6, "#dff0ff", "#7ec0ff");
    }
  }

  // ---- DEATH BURN (consumed by fire, leaves ash) ----
  function vfxDeathBurn(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    // Heat-shimmer ground glow
    if (p < 0.85){
      const ip = p < 0.5 ? p/0.5 : 1 - (p-0.5)/0.35;
      ctx.save();
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r*1.8);
      g.addColorStop(0, `rgba(255,180,80,${ip*0.5})`);
      g.addColorStop(0.6, `rgba(220,80,30,${ip*0.25})`);
      g.addColorStop(1, "rgba(120,30,5,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r*1.8, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // Dark scorched silhouette overlay on the token (rises with p)
    if (p < 0.70){
      ctx.save();
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.clip();
      ctx.fillStyle = `rgba(15,8,2,${Math.min(0.7, p*1.2)})`;
      ctx.fillRect(pos.x - r, pos.y - r, r*2, r*2);
      ctx.restore();
    }

    // Flames rising — many small ember columns
    const flameP = p < 0.85 ? Math.min(1, p*1.4) : 1 - (p-0.85)/0.15;
    const FN = 14;
    const rnd = rng(((token?.id||"x").length+1)*11);
    for (let i=0; i<FN; i++){
      const lp = ((i/FN) + p*1.8 + rnd()*0.2) % 1;
      const ang = rnd() * Math.PI*2;
      const orb = r * (0.4 + rnd()*0.6);
      const fx = pos.x + Math.cos(ang) * orb * 0.6;
      const fy = pos.y + Math.sin(ang) * orb * 0.3;
      const liftY = fy - lp * 70;
      const wob = Math.sin(lp*8 + i)*3;
      const a = (1 - lp) * flameP;
      ember(ctx, fx + wob, liftY, 13 * (1 - lp*0.5), a, "#fff2c0", "#ff7a2e");
      ember(ctx, fx + wob, liftY, 9  * (1 - lp*0.5), a*0.6, "#ffa040", "#7a1c00");
    }
    // dark smoke trail
    for (let i=0; i<6; i++){
      const lp = ((i/6) + p*1.2) % 1;
      const ang = rnd()*Math.PI*2;
      const sx = pos.x + Math.cos(ang) * r * 0.3;
      const sy = pos.y - lp * 90;
      smokePuff(ctx, sx, sy, 18 + lp*8, (1-lp)*flameP*0.6, true);
    }
    // ash pile on the ground after the flames die down
    if (p > 0.65){
      const ap = phase(p, 0.65, 1.0);
      const aFade = 1 - clamp((p-0.92)/0.08, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(40,30,22,${aFade*0.7})`;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + r*0.4, r*0.8*ap, r*0.25*ap, 0, 0, Math.PI*2);
      ctx.fill();
      // ash flakes drifting up
      for (let i=0;i<5;i++){
        const lp = ((i/5) + p*0.8) % 1;
        const ang = rnd()*Math.PI*2;
        const fx = pos.x + Math.cos(ang)*r*0.5;
        const fy = pos.y + r*0.3 - lp*120;
        ctx.fillStyle = `rgba(60,50,42,${(1-lp)*aFade*0.6})`;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 3, 2, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---- DEATH DISINTEGRATE (Disney-style dust dissolution) ----
  function vfxDeathDisintegrate(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    const seed = ((token?.id||"x").length+2)*17;
    const rnd = rng(seed);
    // 60 particles dispatched over time, each rises and fades
    const N = 50;
    for (let i=0; i<N; i++){
      const spawnT = i/N * 0.7;       // particle starts rising at this fraction
      const local = (p - spawnT) / 0.4;
      if (local <= 0 || local >= 1.2) continue;
      const ang = rnd() * Math.PI * 2;
      const baseR = r * (0.2 + rnd()*0.8);
      const px = pos.x + Math.cos(ang) * baseR + (rnd()-.5)*8;
      const py0 = pos.y + Math.sin(ang) * baseR * 0.5;
      const lift = clamp(local, 0, 1) * (60 + rnd()*40);
      const drift = Math.sin(local*5 + i) * 8;
      const py = py0 - lift;
      const a = (1 - clamp(local, 0, 1)) * 0.85;
      const size = 2 + rnd()*2.5;
      ctx.fillStyle = `rgba(${180+rnd()*40|0},${150+rnd()*30|0},${110+rnd()*30|0},${a})`;
      ctx.beginPath();
      ctx.arc(px + drift, py, size, 0, Math.PI*2);
      ctx.fill();
    }
    // wisp ring near the token surface
    if (p < 0.6){
      ctx.save();
      ctx.strokeStyle = `rgba(220,200,160,${(1-p)*0.4})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]); ctx.lineDashOffset = -p*40;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r*0.95, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---- DEATH MELT (sinks into a puddle) ----
  function vfxDeathMelt(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    // Puddle grows under the token as it melts
    const puddleP = clamp(p, 0, 1);
    const pr = r * (0.4 + puddleP*1.2);
    ctx.save();
    const g = ctx.createRadialGradient(pos.x, pos.y + r*0.4, 0, pos.x, pos.y + r*0.4, pr);
    const baseColor = token?.ringColor || "#5a4a3a";
    g.addColorStop(0, withAlpha(baseColor, 0.85 * puddleP));
    g.addColorStop(0.7, withAlpha(baseColor, 0.55 * puddleP));
    g.addColorStop(1, withAlpha(baseColor, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + r*0.5, pr, pr*0.32, 0, 0, Math.PI*2);
    ctx.fill();
    // dripping droplets
    if (p < 0.85){
      const rnd = rng(((token?.id||"x").length+3)*19);
      for (let i=0; i<6; i++){
        const lp = ((i/6) + p*0.6 + rnd()*0.1) % 1;
        const ang = (rnd()-.5)*Math.PI;
        const dx = Math.cos(ang)*r*0.4;
        const dy = pos.y - 8 + lp * (r*1.0 + p*30);
        const a = (1 - lp) * 0.9;
        ctx.fillStyle = withAlpha(baseColor, a);
        ctx.beginPath();
        ctx.ellipse(pos.x + dx, dy, 3 + lp*2, 6 + lp*4, 0, 0, Math.PI*2);
        ctx.fill();
      }
    }
    // steam rising from puddle late
    if (p > 0.5){
      const rnd2 = rng(((token?.id||"x").length+4)*23);
      for (let i=0; i<4; i++){
        const lp = ((i/4) + p*0.7) % 1;
        const sx = pos.x + (rnd2()-.5) * r * 0.8;
        const sy = pos.y + r*0.5 - lp*40;
        smokePuff(ctx, sx, sy, 12, (1-lp)*0.5, false);
      }
    }
    // fade puddle at end
    if (p > 0.9){
      const fa = 1 - (p - 0.9)/0.1;
      ctx.fillStyle = `rgba(0,0,0,${(1-fa)*0.2})`;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + r*0.5, pr*1.05, pr*0.34, 0, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---- DEATH EVAPORATE (mist rising) ----
  function vfxDeathEvaporate(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    const N = 16;
    const rnd = rng(((token?.id||"x").length+5)*29);
    for (let i=0; i<N; i++){
      const spawnT = i/N * 0.5;
      const local = (p - spawnT) / 0.55;
      if (local <= 0 || local >= 1.1) continue;
      const ang = rnd()*Math.PI*2;
      const baseR = r * (0.3 + rnd()*0.7);
      const px = pos.x + Math.cos(ang)*baseR*0.7;
      const py0 = pos.y;
      const lift = local * (80 + rnd()*40);
      const wob = Math.sin(local*4 + i)*10;
      const py = py0 - lift;
      const a = (1 - clamp(local, 0, 1)) * 0.6;
      const size = 12 + local*16;
      const g = ctx.createRadialGradient(px+wob, py, 0, px+wob, py, size);
      g.addColorStop(0, `rgba(240,245,255,${a*0.8})`);
      g.addColorStop(1, "rgba(220,230,250,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px+wob, py, size, 0, Math.PI*2); ctx.fill();
    }
    // wisp ring around feet
    if (p < 0.5){
      ctx.save();
      ctx.strokeStyle = `rgba(200,220,255,${(1-p*2)*0.5})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = p*40;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + r*0.6, r*0.9, r*0.3, 0, 0, Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ---- DEATH VANISH (magical sparkle disappearance) ----
  function vfxDeathVanish(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    const seed = ((token?.id||"x").length+6)*31;
    const rnd = rng(seed);
    // implosion shockwave
    if (p < 0.55){
      const ip = p / 0.55;
      // outer ring
      ctx.save();
      ctx.strokeStyle = `rgba(200,180,255,${(1-ip)*0.9})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r * (1 + ip*0.5), 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
      // glow
      const gr = r * (0.8 + Math.sin(p*15)*0.1);
      const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, gr*1.3);
      grad.addColorStop(0, `rgba(255,255,255,${ip*0.4})`);
      grad.addColorStop(0.5, `rgba(180,150,255,${ip*0.4})`);
      grad.addColorStop(1, "rgba(60,40,150,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, gr*1.3, 0, Math.PI*2); ctx.fill();
    }
    // sparkle particles (stars) bursting outward and spinning
    const SN = 22;
    for (let i=0; i<SN; i++){
      const ang = i/SN * Math.PI*2 + rnd()*0.3;
      const spd = 50 + rnd()*60;
      const dr = spd * easeOut(p);
      const sx = pos.x + Math.cos(ang)*dr;
      const sy = pos.y + Math.sin(ang)*dr - p*p*20;
      const sz = 3 + Math.sin(p*20 + i)*1.2;
      const a = (1 - p) * 0.95;
      if (a <= 0) continue;
      // 4-point sparkle
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(p*5 + i);
      ctx.fillStyle = `rgba(255,235,180,${a})`;
      ctx.beginPath();
      ctx.moveTo(0, -sz*2); ctx.lineTo(sz*0.5, 0);
      ctx.lineTo(0, sz*2); ctx.lineTo(-sz*0.5, 0); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(220,180,255,${a*0.8})`;
      ctx.beginPath();
      ctx.moveTo(-sz*2, 0); ctx.lineTo(0, sz*0.5);
      ctx.lineTo(sz*2, 0); ctx.lineTo(0, -sz*0.5); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // bright center pinch
    if (p > 0.40 && p < 0.65){
      const cp = phase(p, 0.40, 0.65);
      const cr = 18 * (1 - Math.abs(cp - 0.5)*2);
      ctx.fillStyle = `rgba(255,255,255,${1 - Math.abs(cp - 0.5)*2})`;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, cr, 0, Math.PI*2); ctx.fill();
    }
  }

  // ---- DEATH PETRIFY (turn to stone then crumble) ----
  function vfxDeathPetrify(ctx, p, pos, token, sprite, spell){
    const r = TOKEN_R;
    if (p < 0.70){
      // Stony overlay creeps from the bottom up
      const cp = p / 0.70;
      ctx.save();
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI*2); ctx.clip();
      // dark grey wash growing from below
      const g = ctx.createLinearGradient(pos.x, pos.y - r, pos.x, pos.y + r);
      g.addColorStop(0, `rgba(80,76,72,${cp*0.45})`);
      g.addColorStop(Math.max(0.01, 1 - cp), `rgba(80,76,72,${cp*0.55})`);
      g.addColorStop(1, `rgba(50,46,42,${cp*0.75})`);
      ctx.fillStyle = g;
      ctx.fillRect(pos.x - r, pos.y - r, r*2, r*2);
      ctx.restore();
      // cracks (more as time progresses)
      if (p > 0.40){
        const cr = (p - 0.40)/0.30;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.strokeStyle = `rgba(20,16,14,${cr*0.85})`;
        ctx.lineWidth = 1.5;
        const rnd = rng(((token?.id||"x").length+7)*37);
        for (let i=0; i<5; i++){
          const a = i/5 * Math.PI*2 + rnd()*0.4;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          for (let s=1; s<=3; s++){
            const t = s/3;
            const rr = r * t * 0.9;
            const aa = a + (rnd()-.5)*0.4;
            ctx.lineTo(Math.cos(aa)*rr, Math.sin(aa)*rr);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    // Crumble — small pebbles fall and disperse
    const cp = (p - 0.70)/0.30;
    const alpha = 1 - cp;
    const NUM = 16;
    const rnd = rng(((token?.id||"x").length+7)*37);
    for (let i=0; i<NUM; i++){
      const ang = i/NUM * Math.PI*2 + rnd()*0.3;
      const spd = 30 + rnd()*40;
      const offX = Math.cos(ang)*spd*cp;
      const offY = Math.sin(ang)*spd*cp + cp*cp*100;
      const sz = 4 + rnd()*4;
      const greyVal = 70 + rnd()*40 | 0;
      ctx.fillStyle = `rgba(${greyVal},${greyVal-4},${greyVal-8},${alpha})`;
      ctx.beginPath();
      ctx.arc(pos.x + offX, pos.y + offY, sz*0.6, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = `rgba(20,16,14,${alpha*0.7})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    // dust
    for (let i=0;i<8;i++){
      const a = rnd()*Math.PI*2;
      const dr = r*0.4 + rnd()*r*0.7;
      smokePuff(ctx, pos.x + Math.cos(a)*dr, pos.y + Math.sin(a)*dr, 16, (1-cp)*0.55, false);
    }
  }

  const DEATH_VFX = {
    "death-shatter":      vfxDeathShatter,
    "death-frost":        vfxDeathFrost,
    "death-burn":         vfxDeathBurn,
    "death-disintegrate": vfxDeathDisintegrate,
    "death-melt":         vfxDeathMelt,
    "death-evaporate":    vfxDeathEvaporate,
    "death-vanish":       vfxDeathVanish,
    "death-petrify":      vfxDeathPetrify,
  };

  function renderDeathVfx(ctx, kind, p, pos, token, sprite, spell){
    const fn = DEATH_VFX[kind] || vfxDeathDisintegrate;
    fn(ctx, p, pos, token, sprite, spell);
  }

  // ============================================================
  // LINGER EFFECTS — persistent environmental visuals.
  // Each takes (ctx, linger, time). `time` lets them animate (flicker etc).
  // ============================================================
  const LINGER_RENDERS = {
    fire: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      // ground scorch
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g0.addColorStop(0, "rgba(60,18,0,0.45)");
      g0.addColorStop(1, "rgba(60,18,0,0)");
      ctx.fillStyle = g0;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      // flickering flames
      const rnd = rng(Math.floor((l.id||"f").length*13));
      const N = 14;
      for (let i=0; i<N; i++){
        const a = rnd()*Math.PI*2;
        const dr = rnd() * r * 0.85;
        const flick = 1 + Math.sin(time*6 + i*1.7) * 0.25;
        ember(ctx, cx + Math.cos(a)*dr, cy + Math.sin(a)*dr,
          (10 + rnd()*6) * flick, 0.8 * flick, "#fff2c0", "#ff7a2e");
      }
      // central glow
      const g1 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*0.6);
      g1.addColorStop(0, "rgba(255,180,80,0.5)");
      g1.addColorStop(1, "rgba(255,80,20,0)");
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.6, 0, Math.PI*2); ctx.fill();
      // rising smoke
      for (let i=0; i<5; i++){
        const lp = ((time*0.3 + i*0.21) % 1);
        const a = rnd() * Math.PI*2;
        const px = cx + Math.cos(a) * r * 0.3;
        const py = cy - lp * 60;
        smokePuff(ctx, px, py, 16 + lp*10, (1-lp)*0.5, true);
      }
    },

    bonfire: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      // scorch
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*1.3);
      g0.addColorStop(0, "rgba(40,12,0,0.55)");
      g0.addColorStop(1, "rgba(40,12,0,0)");
      ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(cx, cy, r*1.3, 0, Math.PI*2); ctx.fill();
      // wood logs (crossed)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = "#3a2415";
      ctx.fillRect(-r*0.4, -3, r*0.8, 6);
      ctx.rotate(Math.PI/3);
      ctx.fillRect(-r*0.4, -3, r*0.8, 6);
      ctx.rotate(Math.PI/3);
      ctx.fillRect(-r*0.4, -3, r*0.8, 6);
      ctx.restore();
      // tall flame column
      const flick = 1 + Math.sin(time*8)*0.12;
      const fh = r * 0.9 * flick;
      const grad = ctx.createRadialGradient(cx, cy - fh*0.4, 0, cx, cy - fh*0.4, fh);
      grad.addColorStop(0, "rgba(255,250,180,0.95)");
      grad.addColorStop(0.4, "rgba(255,140,40,0.7)");
      grad.addColorStop(1, "rgba(180,30,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy - fh*0.4, r*0.45, fh, 0, 0, Math.PI*2);
      ctx.fill();
      // rising embers
      const rnd = rng(Math.floor((l.id||"b").length*7));
      for (let i=0; i<6; i++){
        const lp = ((time*0.5 + i*0.17) % 1);
        const ang = rnd()*Math.PI*2;
        const px = cx + Math.cos(ang) * r * 0.2;
        const py = cy - fh*0.5 - lp * r * 1.2;
        ember(ctx, px, py, 4, (1-lp)*0.9, "#fff2c0", "#ff7a2e");
      }
    },

    smoke: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const rnd = rng(Math.floor((l.id||"s").length*5));
      for (let i=0; i<10; i++){
        const a = i/10 * Math.PI*2 + time*0.15;
        const dr = r * (0.45 + rnd()*0.5);
        const px = cx + Math.cos(a)*dr + Math.sin(time*0.5+i)*8;
        const py = cy + Math.sin(a)*dr + Math.cos(time*0.5+i)*8;
        smokePuff(ctx, px, py, 28 + rnd()*14, 0.55, true);
      }
      // center darker mass
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*0.7);
      g.addColorStop(0, "rgba(30,28,25,0.5)");
      g.addColorStop(1, "rgba(30,28,25,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx,cy,r*0.7,0,Math.PI*2); ctx.fill();
    },

    fog: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const rnd = rng(Math.floor((l.id||"f").length*3));
      for (let i=0; i<12; i++){
        const a = i/12 * Math.PI*2 + time*0.1;
        const dr = r * (0.4 + rnd()*0.5);
        const px = cx + Math.cos(a)*dr + Math.sin(time*0.3+i)*10;
        const py = cy + Math.sin(a)*dr + Math.cos(time*0.3+i)*10;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 30);
        grad.addColorStop(0, "rgba(220,230,245,0.5)");
        grad.addColorStop(1, "rgba(220,230,245,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, 30, 0, Math.PI*2); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(200,215,235,0.35)");
      g.addColorStop(1, "rgba(200,215,235,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    },

    poison: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const rnd = rng(Math.floor((l.id||"p").length*11));
      // green base
      const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      base.addColorStop(0, "rgba(160,200,60,0.45)");
      base.addColorStop(1, "rgba(60,90,20,0)");
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      // swirling globs
      for (let i=0; i<10; i++){
        const a = i/10 * Math.PI*2 + time*0.25;
        const dr = r * (0.3 + (i%3)*0.18);
        const px = cx + Math.cos(a)*dr;
        const py = cy + Math.sin(a)*dr;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 22);
        grad.addColorStop(0, "rgba(180,220,90,0.55)");
        grad.addColorStop(1, "rgba(60,90,20,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, 22, 0, Math.PI*2); ctx.fill();
      }
      // bubbles
      for (let i=0; i<5; i++){
        const lp = ((time*0.4 + i*0.2) % 1);
        const a = rnd()*Math.PI*2;
        const px = cx + Math.cos(a)*r*0.3;
        const py = cy + Math.sin(a)*r*0.3 - lp*40;
        ctx.fillStyle = `rgba(200,230,80,${(1-lp)*0.6})`;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI*2); ctx.fill();
      }
    },

    ice: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      // base patch
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g0.addColorStop(0, "rgba(200,225,250,0.7)");
      g0.addColorStop(0.7, "rgba(140,190,235,0.45)");
      g0.addColorStop(1, "rgba(80,130,180,0)");
      ctx.fillStyle = g0;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      // crystals
      const rnd = rng(Math.floor((l.id||"i").length*17));
      for (let i=0; i<14; i++){
        const a = rnd()*Math.PI*2;
        const dr = rnd() * r * 0.85;
        iceShard(ctx, cx + Math.cos(a)*dr, cy + Math.sin(a)*dr, 4 + rnd()*6,
          rnd()*Math.PI*2, 0.85);
      }
      // shimmer
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + Math.sin(time*3)*0.2})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r*0.85, 0, Math.PI*2);
      ctx.stroke();
    },

    web: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      // halo
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g0.addColorStop(0, "rgba(220,225,235,0.18)");
      g0.addColorStop(1, "rgba(220,225,235,0)");
      ctx.fillStyle = g0;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = "rgba(235,238,245,0.75)";
      ctx.lineWidth = 1.4;
      const spokes = 14;
      for (let i=0; i<spokes; i++){
        const a = i/spokes * Math.PI*2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(235,238,245,0.45)";
      for (let ring=1; ring<=4; ring++){
        ctx.beginPath();
        for (let i=0; i<=spokes; i++){
          const a = i/spokes * Math.PI*2;
          const rr = r * ring/4 + Math.sin(a*3)*3;
          const x = cx + Math.cos(a)*rr;
          const y = cy + Math.sin(a)*rr;
          i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    },

    blood: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(120,8,8,0.9)");
      g.addColorStop(0.7, "rgba(70,6,6,0.7)");
      g.addColorStop(1, "rgba(30,2,2,0)");
      ctx.fillStyle = g;
      // irregular blob
      ctx.beginPath();
      const rnd = rng(Math.floor((l.id||"b").length*19));
      const sides = 14;
      for (let i=0; i<=sides; i++){
        const a = i/sides * Math.PI*2;
        const rr = r * (0.75 + (rnd()-0.5)*0.4);
        const x = cx + Math.cos(a)*rr;
        const y = cy + Math.sin(a)*rr;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fill();
      // highlight
      ctx.fillStyle = "rgba(220,40,40,0.4)";
      ctx.beginPath();
      ctx.ellipse(cx - r*0.2, cy - r*0.2, r*0.25, r*0.15, 0, 0, Math.PI*2);
      ctx.fill();
    },

    scorched: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(15,8,4,0.85)");
      g.addColorStop(0.7, "rgba(30,15,8,0.55)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      const rnd = rng(Math.floor((l.id||"s").length*23));
      const sides = 12;
      for (let i=0; i<=sides; i++){
        const a = i/sides * Math.PI*2;
        const rr = r * (0.78 + (rnd()-0.5)*0.3);
        const x = cx + Math.cos(a)*rr;
        const y = cy + Math.sin(a)*rr;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.fill();
      // glowing embers in scorch
      for (let i=0; i<4; i++){
        const a = rnd()*Math.PI*2;
        const dr = rnd() * r * 0.7;
        ember(ctx, cx + Math.cos(a)*dr, cy + Math.sin(a)*dr,
          3 + Math.sin(time*4+i)*1.5, 0.6, "#ff7a2e", "#5a1c00");
      }
    },

    holy: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const pulse = 0.8 + Math.sin(time*2)*0.15;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,240,180,${0.45*pulse})`);
      g.addColorStop(0.7, `rgba(255,210,120,${0.25*pulse})`);
      g.addColorStop(1, "rgba(255,180,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      // rune ring
      ctx.strokeStyle = `rgba(255,220,140,${0.7*pulse})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = -time*30;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.85, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      // small floating motes
      const rnd = rng(Math.floor((l.id||"h").length*13));
      for (let i=0; i<6; i++){
        const a = i/6*Math.PI*2 + time*0.5;
        const dr = r*0.6 + Math.sin(time*1.5+i)*8;
        const px = cx + Math.cos(a)*dr;
        const py = cy + Math.sin(a)*dr;
        ember(ctx, px, py, 5, 0.85*pulse, "#fff4b8", "#ffd56a");
      }
    },

    dark: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(8,4,16,0.92)");
      g.addColorStop(0.7, "rgba(20,10,30,0.7)");
      g.addColorStop(1, "rgba(20,10,30,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
      // wispy purple tendrils
      const rnd = rng(Math.floor((l.id||"d").length*29));
      for (let i=0; i<8; i++){
        const a = i/8 * Math.PI*2 + time*0.2;
        const dr = r*0.4 + Math.sin(time*1.2 + i)*r*0.15;
        const px = cx + Math.cos(a)*dr;
        const py = cy + Math.sin(a)*dr;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 18);
        grad.addColorStop(0, "rgba(120,80,180,0.4)");
        grad.addColorStop(1, "rgba(60,30,90,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI*2); ctx.fill();
      }
    },

    lightning: (ctx, l, time) => {
      const r = l.radius;
      const cx = l.x, cy = l.y;
      // rune circle on ground
      ctx.strokeStyle = "rgba(154,214,255,0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.85, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = "rgba(154,214,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.6, 0, Math.PI*2); ctx.stroke();
      // crackling arc — random short bolts
      const seed = Math.floor(time*4);
      const rnd = rng(seed + Math.floor((l.id||"l").length*7));
      const branches = 3;
      for (let b=0; b<branches; b++){
        const a0 = rnd() * Math.PI*2;
        const a1 = a0 + (rnd()-0.5)*1.2;
        const len = r * 0.7;
        const x0 = cx + Math.cos(a0)*r*0.2;
        const y0 = cy + Math.sin(a0)*r*0.2;
        const x1 = cx + Math.cos(a1)*len;
        const y1 = cy + Math.sin(a1)*len;
        // jittered polyline
        const segs = 6;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i=0; i<=segs; i++){
          const t = i/segs;
          const jx = (rnd()-0.5)*10;
          const jy = (rnd()-0.5)*10;
          const x = lerp(x0, x1, t) + jx*(1-Math.abs(t-0.5)*2);
          const y = lerp(y0, y1, t) + jy*(1-Math.abs(t-0.5)*2);
          i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      // central glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r*0.5);
      g.addColorStop(0, "rgba(180,225,255,0.5)");
      g.addColorStop(1, "rgba(60,90,200,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r*0.5, 0, Math.PI*2); ctx.fill();
    },
  };

  function renderLinger(ctx, l, time){
    const fn = LINGER_RENDERS[l.kind] || LINGER_RENDERS.fire;
    fn(ctx, l, time);
  }

  // ============================================================
  // PERSISTENT EFFECTS — lingering visuals placed on the map
  // ============================================================
  // time is in seconds (clip-relative not needed; effects loop based on real time).
  // Each renderer is given (ctx, effect, t) where t is the playback / wall time
  // and `effect` carries x, y, radius, kind, etc.

  function fxFire(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 80;
    // Ground char
    ctx.save();
    const gnd = ctx.createRadialGradient(x, y, 0, x, y, r);
    gnd.addColorStop(0, "rgba(40,18,8,0.45)");
    gnd.addColorStop(0.6, "rgba(40,18,8,0.25)");
    gnd.addColorStop(1, "rgba(40,18,8,0)");
    ctx.fillStyle = gnd;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Flame plumes
    const N = Math.max(6, Math.floor(r/12));
    const rnd = rng((e.id || "f").length * 13);
    for (let i=0;i<N;i++){
      const seed = rnd();
      const lp = ((t*0.8) + seed) % 1;
      const ang = seed * Math.PI*2;
      const dist = (0.2 + seed*0.85) * r * 0.85;
      const fx = x + Math.cos(ang)*dist;
      const fy = y + Math.sin(ang)*dist - lp * 50;
      const a = (1 - lp) * 0.95;
      ember(ctx, fx, fy, 14 - lp*6, a, "#fff2c0", "#ff7a2e");
      ember(ctx, fx, fy, 9 - lp*4, a*0.6, "#ffa040", "#7a1c00");
    }
    // Dark smoke wisps drifting up
    for (let i=0;i<4;i++){
      const seed = rnd();
      const lp = ((t*0.4) + seed) % 1;
      const ang = seed * Math.PI*2;
      const sx = x + Math.cos(ang)*r*0.4;
      const sy = y - lp*70;
      smokePuff(ctx, sx, sy, 16 + lp*12, (1-lp)*0.45, true);
    }
    // Glow
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r*0.8);
    glow.addColorStop(0, `rgba(255,160,70,${0.30 + Math.sin(t*6)*0.05})`);
    glow.addColorStop(1, "rgba(140,40,8,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r*0.8, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function fxGas(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 110;
    ctx.save();
    // Cloud body
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(155,200,80,0.55)");
    g.addColorStop(0.7, "rgba(110,170,70,0.35)");
    g.addColorStop(1, "rgba(60,100,30,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Drifting wisps
    const N = 10;
    const rnd = rng((e.id || "g").length * 7);
    for (let i=0;i<N;i++){
      const seed = rnd();
      const ang = seed * Math.PI*2 + t*0.2;
      const dr = (0.3 + seed*0.7) * r * 0.9;
      const wx = x + Math.cos(ang)*dr + Math.sin(t*0.6+i)*8;
      const wy = y + Math.sin(ang)*dr + Math.cos(t*0.5+i)*6;
      ember(ctx, wx, wy, 18, 0.55, "#cce790", "#5a8a30");
    }
    // Subtle border ring
    ctx.strokeStyle = "rgba(120,180,70,0.4)";
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t*20;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function fxWeb(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 90;
    ctx.save();
    // Faint dark backing
    ctx.fillStyle = "rgba(40,40,52,0.25)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Radial spokes
    ctx.strokeStyle = "rgba(235,238,245,0.75)";
    ctx.lineWidth = 1.5;
    for (let i=0;i<14;i++){
      const a = i/14 * Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
      ctx.stroke();
    }
    // Concentric strands
    for (let ring=1; ring<=5; ring++){
      ctx.beginPath();
      ctx.strokeStyle = "rgba(235,238,245,0.5)";
      for (let i=0; i<=14; i++){
        const a = i/14 * Math.PI*2;
        const rr = r*ring/5 + Math.sin(a*3 + t*0.5 + ring)*2;
        const px = x + Math.cos(a)*rr;
        const py = y + Math.sin(a)*rr;
        i===0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function fxBlood(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 54;
    ctx.save();
    // Irregular puddle — fixed shape based on seed
    const rnd = rng((e.id || "b").length * 17);
    ctx.fillStyle = "rgba(80,12,12,0.85)";
    ctx.beginPath();
    const N = 14;
    for (let i=0;i<N;i++){
      const a = i/N * Math.PI*2;
      const rr = r * (0.7 + rnd()*0.5);
      const px = x + Math.cos(a)*rr;
      const py = y + Math.sin(a)*rr*0.7;
      i===0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // Bright highlight blot
    ctx.fillStyle = "rgba(180,40,40,0.5)";
    ctx.beginPath();
    ctx.ellipse(x - r*0.2, y - r*0.1, r*0.4, r*0.18, 0.3, 0, Math.PI*2);
    ctx.fill();
    // Few spatter dots
    const rnd2 = rng((e.id || "b").length * 23);
    for (let i=0;i<8;i++){
      const a = rnd2()*Math.PI*2;
      const dr = r * (1.0 + rnd2()*0.6);
      const sz = 2 + rnd2()*4;
      ctx.fillStyle = "rgba(100,12,12,0.85)";
      ctx.beginPath();
      ctx.arc(x + Math.cos(a)*dr, y + Math.sin(a)*dr*0.7, sz, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
  }

  function fxIce(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 90;
    ctx.save();
    // Cold tinted patch
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(220,240,255,0.70)");
    g.addColorStop(0.7, "rgba(140,190,240,0.45)");
    g.addColorStop(1, "rgba(80,140,200,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Crack lines
    ctx.strokeStyle = "rgba(80,140,200,0.65)";
    ctx.lineWidth = 1.5;
    const rnd = rng((e.id || "i").length * 11);
    for (let i=0;i<7;i++){
      const a = i/7 * Math.PI*2 + rnd()*0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let lr = 0;
      for (let s=1; s<=4; s++){
        const sr = r * (s/4) * (0.6 + rnd()*0.4);
        const sa = a + (rnd()-.5)*0.45;
        ctx.lineTo(x + Math.cos(sa)*sr, y + Math.sin(sa)*sr);
      }
      ctx.stroke();
    }
    // Ice shards on perimeter
    for (let i=0;i<10;i++){
      const a = i/10 * Math.PI*2 + Math.sin(t*0.4 + i)*0.05;
      const dr = r * (0.7 + Math.sin(t + i)*0.04);
      iceShard(ctx, x + Math.cos(a)*dr, y + Math.sin(a)*dr, 5 + (i%3)*1.5, a, 0.75);
    }
    ctx.restore();
  }

  function fxSmoke(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 120;
    ctx.save();
    const N = 10;
    const rnd = rng((e.id || "s").length * 19);
    for (let i=0;i<N;i++){
      const seed = rnd();
      const ang = seed * Math.PI*2 + t*0.1;
      const dr = (0.2 + seed*0.85) * r * 0.95;
      const sx = x + Math.cos(ang)*dr + Math.sin(t*0.4+i)*10;
      const sy = y + Math.sin(ang)*dr + Math.cos(t*0.3+i)*8;
      smokePuff(ctx, sx, sy, 22 + Math.sin(t+i)*4, 0.55, false);
    }
    // Faint dark center
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(30,30,30,0.35)");
    g.addColorStop(1, "rgba(30,30,30,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function fxHoly(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 100;
    ctx.save();
    // Warm circle glow
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,235,150,${0.45 + Math.sin(t*2)*0.05})`);
    g.addColorStop(0.6, "rgba(255,200,90,0.25)");
    g.addColorStop(1, "rgba(180,120,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Outer rim with dashes
    ctx.strokeStyle = "rgba(255,215,100,0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = -t*30;
    ctx.beginPath(); ctx.arc(x, y, r*0.95, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    // Plus motes drifting upward
    const rnd = rng((e.id || "h").length * 29);
    for (let i=0;i<8;i++){
      const seed = rnd();
      const lp = ((t*0.5) + seed) % 1;
      const ang = seed * Math.PI*2;
      const px = x + Math.cos(ang)*r*0.5;
      const py = y + Math.sin(ang)*r*0.3 - lp*60;
      const a = (1 - lp) * 0.8;
      ctx.fillStyle = `rgba(255,235,150,${a})`;
      ctx.fillRect(px - 1, py - 5, 2, 10);
      ctx.fillRect(px - 5, py - 1, 10, 2);
    }
    ctx.restore();
  }

  function fxDark(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 100;
    ctx.save();
    // Heavy dark sphere
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.85)");
    g.addColorStop(0.6, "rgba(20,8,30,0.7)");
    g.addColorStop(1, "rgba(20,8,30,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Purple wisps
    const rnd = rng((e.id || "d").length * 31);
    for (let i=0;i<8;i++){
      const seed = rnd();
      const ang = seed * Math.PI*2 + t*0.3;
      const dr = (0.3 + seed*0.6) * r;
      const px = x + Math.cos(ang)*dr;
      const py = y + Math.sin(ang)*dr;
      ember(ctx, px, py, 12, 0.45, "#9a7baa", "#3c1a4a");
    }
    // Faint border
    ctx.strokeStyle = "rgba(120,80,160,0.6)";
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -t*40;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r*0.98, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function fxAcid(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 70;
    ctx.save();
    // Sickly green puddle
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(180,240,90,0.8)");
    g.addColorStop(0.7, "rgba(126,180,51,0.55)");
    g.addColorStop(1, "rgba(50,80,8,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Bubbles
    const rnd = rng((e.id || "a").length * 37);
    for (let i=0;i<8;i++){
      const seed = rnd();
      const ang = seed*Math.PI*2 + t*0.7;
      const dr = (0.2 + seed*0.7) * r;
      const a = 0.5 + Math.sin(t*3 + i)*0.4;
      ctx.fillStyle = `rgba(220,255,130,${Math.max(0, a*0.7)})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(ang)*dr, y + Math.sin(ang)*dr, 4 + Math.sin(t*4+i)*2, 0, Math.PI*2);
      ctx.fill();
    }
    // Highlight rim
    ctx.strokeStyle = "rgba(210,245,106,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r*0.95, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  function fxThorns(ctx, e, t){
    const x = e.x, y = e.y, r = e.radius || 100;
    ctx.save();
    // Faint green wash
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(120,180,90,0.4)");
    g.addColorStop(1, "rgba(60,100,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    // Tangled thorny vines — fixed seeded layout
    const rnd = rng((e.id || "t").length * 41);
    ctx.strokeStyle = "rgba(40,70,20,0.9)";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    for (let i=0;i<6;i++){
      const a = i/6 * Math.PI*2 + rnd()*0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x, py = y;
      for (let s=1;s<=6;s++){
        const tt = s/6;
        const sr = r * tt;
        const sa = a + Math.sin(s*1.7 + i)*0.5 + (rnd()-.5)*0.3;
        px = x + Math.cos(sa)*sr;
        py = y + Math.sin(sa)*sr;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Mid-vine highlight
      ctx.strokeStyle = "rgba(120,170,70,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s=1;s<=6;s++){
        const tt = s/6;
        const sr = r * tt;
        const sa = a + Math.sin(s*1.7 + i)*0.5;
        ctx.lineTo(x + Math.cos(sa)*sr, y + Math.sin(sa)*sr);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(40,70,20,0.9)";
      ctx.lineWidth = 3.5;
    }
    // Thorn dots
    for (let i=0;i<14;i++){
      const a = rnd()*Math.PI*2;
      const dr = r * (0.4 + rnd()*0.6);
      const sx = x + Math.cos(a)*dr;
      const sy = y + Math.sin(a)*dr;
      ctx.fillStyle = "rgba(40,70,20,0.95)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a)*8, sy + Math.sin(a)*8 - 4);
      ctx.lineTo(sx + 3, sy + 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  const EFFECTS_FX = {
    fire: fxFire,
    gas: fxGas,
    web: fxWeb,
    blood: fxBlood,
    ice: fxIce,
    smoke: fxSmoke,
    holy: fxHoly,
    dark: fxDark,
    acid: fxAcid,
    thorns: fxThorns,
  };

  function renderPersistentEffect(ctx, effect, t){
    const fn = EFFECTS_FX[effect.kind];
    if (fn) fn(ctx, effect, t);
  }

  // ============================================================
  // Dispatch
  // ============================================================
  const VFX = {
    "projectile":     vfxProjectile,
    "missile-volley": vfxMissileVolley,
    "ray":            vfxRay,
    "beam":           vfxBeam,
    "bolt":           vfxBolt,
    "chain":          vfxChain,
    "aoe-burst":      vfxAoeBurst,
    "aoe-sustain":    vfxAoeSustain,
    "cone":           vfxCone,
    "line":           vfxLine,
    "wall":           vfxWall,
    "aura-heal":      vfxAuraHeal,
    "aura-buff":      vfxAuraBuff,
    "debuff":         vfxDebuff,
    "melee-slash":    vfxMeleeSlash,
    "melee-longsword": vfxLongswordSlash,
    "melee-stab":     vfxMeleeStab,
    "melee-smash":    vfxMeleeSmash,
    "melee-unarmed":  vfxMeleeUnarmed,
    "ranged-shot":    vfxRangedShot,
    "vines":          vfxVines,
    "nature-thorn":   vfxNatureThorn,
    "summon":         vfxSummon,
    "teleport":       vfxTeleport,
  };

  // Spell-id overrides for signature animations
  const SPECIAL_BY_ID = {
    "fireball":         vfxFireball,
    "throwing-dagger":  vfxThrownDagger,
    "handaxe-throw":    vfxThrownAxe,
    "javelin":          vfxRangedShot,
  };

  function renderVfx(ctx, kind, p, caster, target, spell){
    const fn = (spell && SPECIAL_BY_ID[spell.id]) || VFX[kind] || vfxProjectile;
    fn(ctx, p, caster, target, spell);
  }

  // ============================================================
  // CAMERA
  // For each frame compute a virtual camera (cx, cy, zoom) based on the
  // currently-active clip. We hold a smoothed previous state per-canvas so
  // the camera glides rather than snaps. Authoring (paused) is overview.
  // ============================================================
  const _cameraState = new WeakMap();   // canvas -> { cx, cy, zoom }

  function _focalForSpell(p, sp, casterPos, targetPos){
    const vfx = sp?.vfx;
    if (vfx && (vfx.startsWith("death-"))){
      return { x: casterPos.x, y: casterPos.y, zoom: 1.9 };
    }
    if (vfx && (vfx === "aura-heal" || vfx === "aura-buff" || vfx === "debuff"
      || vfx === "aoe-sustain" || vfx === "vines" || vfx === "wall")){
      return { x: targetPos.x, y: targetPos.y, zoom: 1.7 };
    }
    // Phased follow — with a small zoom-in punch right at impact.
    if (p < 0.42){
      return { x: casterPos.x, y: casterPos.y, zoom: 1.85 };
    }
    if (p < 0.58){
      const t = (p - 0.42) / 0.16;
      const ts = t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
      return {
        x: lerp(casterPos.x, (casterPos.x + targetPos.x)/2, ts),
        y: lerp(casterPos.y, (casterPos.y + targetPos.y)/2, ts),
        zoom: lerp(1.85, 1.55, ts),
      };
    }
    if (p < 0.78){
      const t = (p - 0.58) / 0.20;
      const ts = t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
      const projT = lerp(0.5, 0.85, ts);
      return {
        x: lerp(casterPos.x, targetPos.x, projT),
        y: lerp(casterPos.y, targetPos.y, projT),
        zoom: lerp(1.55, 1.7, ts),
      };
    }
    // Impact zone: punch zoom higher briefly, then settle a touch.
    const t = (p - 0.78) / 0.22;
    const ts = t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    // overshoot zoom in the first half of impact, settle back
    const punchZoom = t < 0.4
      ? lerp(1.7, 2.25, t/0.4)
      : lerp(2.25, 1.95, (t-0.4)/0.6);
    return {
      x: lerp(targetPos.x * 0.85 + casterPos.x * 0.15, targetPos.x, ts),
      y: lerp(targetPos.y * 0.85 + casterPos.y * 0.15, targetPos.y, ts),
      zoom: punchZoom,
    };
  }

  function computeCamera(ctx, opts, positions){
    const { map, clips, time, playing, cleanMode } = opts;
    const W = map.width, H = map.height;
    const overview = { cx: W/2, cy: H/2, zoom: 1.0 };
    if (!playing) return overview;

    // Find the latest-starting active clip — its motion drives the camera.
    let active = null;
    let activeMove = null;
    for (const c of clips){
      if (time < c.start || time >= c.start + c.dur) continue;
      if (c.kind === "spell" || c.kind === "attack"){
        if (!active || c.start > active.start) active = c;
      } else if (c.kind === "move"){
        if (!activeMove || c.start > activeMove.start) activeMove = c;
      }
    }

    // Default: hold the camera's last position so we glide between clips
    // instead of snapping back to overview.
    const _held = _cameraState.get(ctx.canvas);
    let target = _held ? { cx: _held.cx, cy: _held.cy, zoom: _held.zoom } : overview;
    let isImpact = false;
    let shakeAmp = 0;
    if (active){
      const sp = active.spell || { school:"melee", vfx:"melee-slash" };
      const p = (time - active.start) / Math.max(EPS, active.dur);
      const casterPos = positions[active.tokenId] || { x:W/2, y:H/2 };
      let targetPos = casterPos;
      if (active.targetTokenId) targetPos = positions[active.targetTokenId] || casterPos;
      else if (active.target) targetPos = active.target;
      const focal = _focalForSpell(p, sp, casterPos, targetPos);
      target = { cx: focal.x, cy: focal.y, zoom: focal.zoom };
      // Impact window — when the projectile/swing lands, the camera should snap
      // in fast for a punchy hit. Roughly the same window we use for flash.
      const vfx = sp?.vfx;
      const flashAt = flashAtFor(sp);
      // The "punch" window: just before & during impact
      if (p > flashAt - 0.06 && p < flashAt + 0.10){
        isImpact = true;
      }
      // Screen shake for heavy melee hits (unarmed slam + hammer smash).
      if (vfx === 'melee-unarmed' || vfx === 'melee-smash'){
        const d = Math.abs(p - flashAt);
        if (d < 0.11){
          const amp = vfx === 'melee-unarmed' ? 12 : 9;
          shakeAmp = (1 - d/0.11) * amp;
        }
      }
    } else if (activeMove){
      const p = positions[activeMove.tokenId];
      if (p) target = { cx: p.x, cy: p.y, zoom: 1.5 };
    }
    // else: no active clip — keep `target` at the held position so the camera
    // simply pauses where the last animation left it, ready for the next one.

    // clamp target so we don't drift off the map at high zoom
    const half = { x: W/(2*target.zoom), y: H/(2*target.zoom) };
    target.cx = clamp(target.cx, half.x, W - half.x);
    target.cy = clamp(target.cy, half.y, H - half.y);

    // Smooth toward target. Snappier when impact, gentler otherwise.
    const prev = _cameraState.get(ctx.canvas) || overview;
    const k = isImpact ? 0.45 : 0.10;
    const cx = lerp(prev.cx, target.cx, k);
    const cy = lerp(prev.cy, target.cy, k);
    const zoom = lerp(prev.zoom, target.zoom, k);
    const next = { cx, cy, zoom };
    _cameraState.set(ctx.canvas, next);
    if (shakeAmp > 0){
      // High-frequency, decaying jitter layered on top of the smoothed camera.
      const sx = (Math.sin(time*97) + Math.sin(time*61)) * 0.5 * shakeAmp;
      const sy = (Math.cos(time*89) + Math.sin(time*73)) * 0.5 * shakeAmp;
      return { cx: cx + sx, cy: cy + sy, zoom };
    }
    return next;
  }
  function _applyCamera(ctx, cam, W, H){
    ctx.translate(W/2, H/2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.cx, -cam.cy);
  }

  // ============================================================
  // Top-level scene render
  // ============================================================
  function drawScene(ctx, opts){
    const { map, mapImg, tokens, sprites, clips, effects, lingers,
            time, selectedTokenId, selectedEffectId, selectedLingerObjId,
            tempPath, tempPathTokenId, tempTarget, hoverPoint, tool,
            playing, cleanMode, armedEffectKind } = opts;

    const W = map.width, H = map.height;
    ctx.clearRect(0,0,W,H);
    ctx.save();

    // Resolve token positions (needed for camera too)
    const positions = {};
    tokens.forEach(t => positions[t.id] = tokenPosAt(t, clips, time));

    // Apply camera transform (overview when paused)
    const cam = computeCamera(ctx, opts, positions);
    _applyCamera(ctx, cam, W, H);

    if (mapImg && mapImg.complete){
      ctx.drawImage(mapImg, 0, 0, W, H);
    } else {
      ctx.fillStyle="#1a1d22"; ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#666"; ctx.font="24px sans-serif"; ctx.textAlign="center";
      ctx.fillText("loading map…", W/2, H/2);
    }

    // ---- Persistent linger effects (under tokens / vfx) ----
    if (lingers && lingers.length){
      lingers.forEach(l => {
        renderLinger(ctx, l, time);
        // Selection ring (authoring only)
        if (!playing && !cleanMode && l.id === selectedLingerObjId){
          ctx.save();
          ctx.strokeStyle = "#ff7a2e";
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(l.x, l.y, (l.radius||80) + 4, 0, Math.PI*2);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // ---- Persistent effects: render under animations but over map ----
    if (effects && effects.length){
      effects.forEach(eff => {
        renderPersistentEffect(ctx, eff, time);
        // Selection ring (authoring only)
        if (!playing && !cleanMode && eff.id === selectedEffectId){
          ctx.save();
          ctx.strokeStyle = "#ff7a2e";
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(eff.x, eff.y, (eff.radius||80) + 4, 0, Math.PI*2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      });
    }

    // ---- Movement paths (authoring only) ----
    if (!playing && !cleanMode){
      clips.filter(c => c.kind==='move').forEach(c=>{
        const tok = tokens.find(t=>t.id===c.tokenId);
        if (!tok) return;
        const isActive = time >= c.start && time < c.start + c.dur;
        const isDone = time >= c.start + c.dur;
        const color = isActive ? "rgba(78,161,255,.9)" : (isDone ? "rgba(78,161,255,.3)" : "rgba(78,161,255,.55)");
        drawSmoothPath(ctx, c.path, color, true);
        const last = c.path[c.path.length-1];
        if (last){
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(last.x, last.y, 6, 0, Math.PI*2); ctx.fill();
        }
      });
    }

    // ---- Live spell preview ----
    if (tempTarget && tool === 'spell' && tempPathTokenId){
      const caster = tokens.find(t=>t.id===tempPathTokenId);
      if (caster) drawSmoothPath(ctx, [{x:caster.x,y:caster.y}, tempTarget], "rgba(255,122,46,.5)", true);
    }
    if (tempPath && tempPath.length>1){
      drawSmoothPath(ctx, tempPath, "rgba(255,122,46,.95)", false);
    }

    // ---- Resolve token positions ----
    // (Already computed above for camera; reuse `positions`.)

    // ---- Pre-pass: melee caster lurch + unarmed lift/slam + target knockback ----
    // tokenLift maps tokenId -> scale (1 = grounded). Used by the token draw
    // pass to raise the attacker off the board mid-strike.
    const tokenLift = {};
    clips.filter(c => c.kind==='spell' || c.kind==='attack').forEach(c=>{
      if (time < c.start || time >= c.start + c.dur) return;
      const sp = c.spell;
      if (!sp) return;
      const vfx = sp.vfx;
      const isLurch = vfx === 'melee-slash' || vfx === 'melee-longsword' || vfx === 'melee-stab' || vfx === 'melee-smash';
      const isUnarmed = vfx === 'melee-unarmed';
      if (!isLurch && !isUnarmed) return;
      const p = (time - c.start) / Math.max(EPS, c.dur);
      const casterPos = positions[c.tokenId];
      if (!casterPos) return;
      let targetPos;
      if (c.targetTokenId) targetPos = positions[c.targetTokenId] || casterPos;
      else if (c.target) targetPos = c.target;
      else targetPos = casterPos;
      const dx = targetPos.x - casterPos.x, dy = targetPos.y - casterPos.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx/len, uy = dy/len;

      if (isUnarmed){
        // Hearthstone charge: anticipation lift → hover (floating coin) → slam → recover.
        let lunge, lift01;
        if (p < 0.28){                    // wind-up: rise & pull back slightly
          const t = smooth(p/0.28);
          lunge = lerp(0, -0.07, t); lift01 = t;
        } else if (p < 0.42){             // hover aloft
          lunge = -0.07; lift01 = 1;
        } else if (p < 0.52){             // SLAM forward, dropping back to the board
          const t = blast(phase(p, 0.42, 0.52));
          lunge = lerp(-0.07, 0.86, t); lift01 = 1 - t;
        } else if (p < 0.62){             // tiny overshoot at contact
          lunge = lerp(0.86, 0.92, smooth(phase(p, 0.52, 0.62))); lift01 = 0;
        } else {                          // ease back home
          lunge = lerp(0.92, 0, smooth(phase(p, 0.62, 1.0))); lift01 = 0;
        }
        // Floating-coin idle while aloft (driven by absolute time so it animates).
        // A subtle tumble on all axes — gentle, not a full edge-on flip:
        //  - twistX/twistY: soft squash on each axis, offset in phase
        //  - bobY: gentle vertical float   - rot: slight in-plane wobble
        const th = time * 4.0;
        const twistX = 1 - lift01 * 0.16 * (0.5 + 0.5*Math.sin(th));
        const twistY = 1 - lift01 * 0.12 * (0.5 + 0.5*Math.sin(th*0.8 + 1.7));
        const bobY = Math.sin(time*4.6) * 3 * lift01;
        const rot  = Math.sin(time*3.1) * 0.06 * lift01;
        const scale = 1 + lift01*0.12;
        // Don't bury the attacker inside the target — stop a token-width short.
        const stop = Math.max(0, len - TOKEN_R*1.7);
        const dispLen = lunge >= 0 ? Math.min(lunge*len, stop) : lunge*len;
        positions[c.tokenId] = { x: casterPos.x + ux*dispLen, y: casterPos.y + uy*dispLen };
        tokenLift[c.tokenId] = { scale, lift: lift01, twistX, twistY, bobY, rot };

        // Target gets knocked back along the strike axis, then springs home.
        if (c.targetTokenId){
          const tb = positions[c.targetTokenId];
          if (tb){
            let kf = 0;
            if (p >= 0.50 && p < 0.57) kf = blast(phase(p, 0.50, 0.57));
            else if (p >= 0.57 && p < 0.82) kf = 1 - smooth(phase(p, 0.57, 0.82));
            const knock = 28 * kf;
            positions[c.targetTokenId] = { x: tb.x + ux*knock, y: tb.y + uy*knock };
            if (kf > 0) tokenLift[c.targetTokenId] = { scale: 1 - 0.06*kf, lift: 0, twistX: 1, twistY: 1, bobY: 0, rot: 0 };
          }
        }
      } else {
        // Existing weapon melee — a small lurch into the swing.
        let lurchT;
        if (p < 0.50) lurchT = -0.08 * smooth(p/0.50);
        else if (p < 0.70) lurchT = lerp(-0.08, 0.22, blast(phase(p, 0.50, 0.70)));
        else lurchT = lerp(0.22, 0, smooth(phase(p, 0.70, 1.0)));
        positions[c.tokenId] = { x: casterPos.x + dx*lurchT, y: casterPos.y + dy*lurchT };
      }
    });

    // ---- Compute death states per token (most recent death clip wins) ----
    const deathByToken = {};
    clips.forEach(c => {
      const sp = c.spell;
      if (!sp?.vfx?.startsWith?.('death-')) return;
      if (time < c.start) return;
      const inside = time < c.start + c.dur;
      const p = inside ? (time - c.start) / Math.max(EPS, c.dur) : 1;
      const prev = deathByToken[c.tokenId];
      // pick the latest-starting death
      if (!prev || c.start >= prev.start){
        deathByToken[c.tokenId] = { kind: sp.vfx, p, finished: !inside, spell: sp, start: c.start };
      }
    });

    // ---- Impact flashes per target token ----
    const flashByToken = {};
    clips.filter(c => c.kind==='spell' || c.kind==='attack').forEach(c=>{
      if (time < c.start || time >= c.start + c.dur) return;
      const p = (time - c.start) / Math.max(EPS, c.dur);
      const sp = c.spell;
      const vfxKind = sp?.vfx;
      let flashAt = null;
      if (sp?.id === 'fireball') flashAt = 0.85;
      else if (vfxKind === 'projectile') flashAt = 0.90;
      else if (vfxKind === 'ranged-shot') flashAt = 0.93;
      else if (sp?.id === 'handaxe-throw') flashAt = 0.93;
      else if (sp?.id === 'throwing-dagger') flashAt = 0.94;
      else if (vfxKind === 'melee-unarmed') flashAt = 0.52;
      else if (vfxKind === 'melee-slash') flashAt = 0.72;
      else if (vfxKind === 'melee-longsword') flashAt = 0.72;
      else if (vfxKind === 'melee-stab')  flashAt = 0.68;
      else if (vfxKind === 'melee-smash') flashAt = 0.72;
      else if (vfxKind === 'bolt' || vfxKind === 'chain') flashAt = 0.55;
      else if (vfxKind === 'missile-volley') flashAt = 0.88;
      if (flashAt !== null && c.targetTokenId){
        const d = Math.abs(p - flashAt);
        if (d < 0.12){
          const intensity = 1 - d/0.12;
          flashByToken[c.targetTokenId] = Math.max(flashByToken[c.targetTokenId] || 0, intensity);
        }
      }
    });

    // ---- Draw tokens FIRST so VFX sits on top ----
    tokens.forEach(t => {
      const ds = deathByToken[t.id];
      if (ds && ds.finished) return;          // token has fully died, skip
      const sprite = sprites[t.spriteId];
      const pos = positions[t.id];
      ctx.save();
      // Per-death visual transformations on the underlying token
      if (ds){
        applyDeathTokenTransform(ctx, ds, pos);
      }
      drawToken(ctx, t, sprite, pos,
        t.id === selectedTokenId && !cleanMode && !playing,
        flashByToken[t.id] || 0,
        tokenLift[t.id] || 1);
      ctx.restore();
    });

    // ---- Draw VFX on top of tokens ----
    clips.filter(c=>c.kind==='spell' || c.kind==='attack').forEach(c=>{
      if (time < c.start || time >= c.start + c.dur) return;
      const p = (time - c.start) / Math.max(EPS, c.dur);
      const casterPos = positions[c.tokenId] || {x:W/2,y:H/2};
      let targetPos;
      if (c.targetTokenId) targetPos = positions[c.targetTokenId] || casterPos;
      else if (c.target) targetPos = c.target;
      else targetPos = casterPos;

      let spell = c.spell;
      if (c.kind === 'attack' && !spell){
        spell = { school:"melee", vfx:"melee-slash" };
      }
      // Death VFX get their own renderer (they need the sprite + token)
      if (spell?.vfx?.startsWith?.('death-')){
        const victim = tokens.find(t => t.id === c.tokenId);
        const sprite = sprites[victim?.spriteId];
        renderDeathVfx(ctx, spell.vfx, p, positions[c.tokenId] || targetPos, victim, sprite, spell);
        return;
      }
      renderVfx(ctx, spell.vfx, p, casterPos, targetPos, spell);
    });

    // ---- Floating damage numbers (author-entered, Hearthstone-style) ----
    clips.filter(c => (c.kind==='spell' || c.kind==='attack')
                   && c.damage != null && (c.damage+"").trim() !== "").forEach(c=>{
      const sp = c.spell || { vfx:"melee-slash" };
      if (sp?.vfx?.startsWith?.('death-')) return;
      const flashAt = flashAtFor(sp);
      const impactTime = c.start + flashAt * c.dur;
      const HOLD = c.crit ? 1.7 : 1.35;
      if (time < impactTime || time > impactTime + HOLD) return;
      let tp;
      if (c.targetTokenId) tp = positions[c.targetTokenId];
      else if (c.target) tp = c.target;
      if (!tp) return;
      drawDamageNumber(ctx, tp.x, tp.y - TOKEN_R*0.7, c.damage, time - impactTime, !!c.crit);
    });

    // ---- Hover crosshair when targeting ----
    if (hoverPoint && !playing && (tool === 'spell' || tool === 'attack' || tool === 'aoe')){
      ctx.save();
      ctx.strokeStyle = "rgba(255,122,46,.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hoverPoint.x, hoverPoint.y, 22, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hoverPoint.x - 30, hoverPoint.y); ctx.lineTo(hoverPoint.x - 12, hoverPoint.y);
      ctx.moveTo(hoverPoint.x + 12, hoverPoint.y); ctx.lineTo(hoverPoint.x + 30, hoverPoint.y);
      ctx.moveTo(hoverPoint.x, hoverPoint.y - 30); ctx.lineTo(hoverPoint.x, hoverPoint.y - 12);
      ctx.moveTo(hoverPoint.x, hoverPoint.y + 12); ctx.lineTo(hoverPoint.x, hoverPoint.y + 30);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();  // unwind camera transform
  }

  function commitRound(tokens, clips){
    const next = tokens.map(t => ({...t}));
    clips.filter(c=>c.kind==='move').forEach(c => {
      const t = next.find(tk => tk.id === c.tokenId);
      if (!t || !c.path?.length) return;
      const end = c.path[c.path.length-1];
      t.x = end.x; t.y = end.y;
    });
    // Tokens that completed a death clip this round are gone in future rounds.
    const deadIds = new Set();
    clips.forEach(c => {
      if (c.spell?.vfx?.startsWith?.('death-')) deadIds.add(c.tokenId);
    });
    return next.filter(t => !deadIds.has(t.id));
  }

  function roundDuration(clips){
    return clips.reduce((m,c)=> Math.max(m, c.start + c.dur), 0.001);
  }

  window.MapEngine = {
    TOKEN_R, drawScene, commitRound, roundDuration,
    tokenPosAt, pathArc, pointAt,
    clamp, lerp, dist,
  };
})();
