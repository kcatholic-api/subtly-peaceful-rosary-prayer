// ===== RosaryCanvas 모듈 (UMD 스타일) ======================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RosaryCanvas = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  // --- 기본(레퍼런스) CFG: 600x640에서 최적 --------------------------------
  const REF = { W: 600, H: 640 };
  const CFG_BASE = {
    ITERATIONS: 12,
    GRAVITY: 1200,
    FRICTION: 0.12,
    STRING_STIFFNESS: 0.5,
    BEAD_SPACING: 18,
    RADIUS_AVE: 6,
    RADIUS_PATER: 8.5,
    RADIUS_MEDAL: 9.5,
    CROSS_WIDTH: 24,
    CROSS_HEIGHT: 34,
    COLLISION_REPULSION: 0.3,
    COLOR_BG_INNER: '#321111ff',
    COLOR_BG_OUTER: '#1f0b0bff',
    COLOR_STRING: 'rgba(148,106,68,0.65)',
    COLOR_BEAD_STROKE: 'rgba(78,47,23,0.85)',
    COLOR_PIN: '#e5c07b',
    COLOR_DRAG: 'rgba(255,255,255,.9)',
    COLOR_AVE: '#d4a373',
    COLOR_PATER: '#b07f49',
    COLOR_MEDAL: '#d9b26d',
    COLOR_HIGHLIGHT: '#f7d58b',
    HIGHLIGHT_GLOW_INNER: 'rgba(255,249,227,0.95)',
    HIGHLIGHT_GLOW_MID: 'rgba(249,224,160,0.75)',
    HIGHLIGHT_GLOW_OUTER: 'rgba(196,138,45,0.05)',
    HIGHLIGHT_RING: 'rgba(255,232,173,0.85)',
    HIGHLIGHT_PULSE_RATE: 2.4,
    CROSS_STROKE: '#7f4e24',
    CROSS_GRAD_TOP: '#f2d4a9',
    CROSS_GRAD_BOTTOM: '#b67f3c',
    CROSS_EDGE_HI: '#fbe2c5',
    TOP_BOTTOM_MARGIN_RATIO: 0.05
  };

  const TYPE = { AVE:'AVE', PATER:'PATER', MEDAL:'MEDAL', CROSS:'CROSS' };
  const WOOD_TONES = {
    AVE: { light: '#f6dec0', mid: '#d49a60', dark: '#8a5425' },
    PATER: { light: '#f0cfa2', mid: '#bc8041', dark: '#6f4119' },
    MEDAL: { light: '#f8e3ad', mid: '#c99547', dark: '#7a4c1b' }
  };

  class Node {
    constructor(x,y, kind=TYPE.CROSS, node_id='unknown', radiusOverrides){
      this.node_id = node_id;
      this.x = x; this.y = y; this.px = x; this.py = y;
      this.pinned = false; this.kind = kind;
      this.radius = (kind===TYPE.PATER) ? radiusOverrides.PATER
                   : (kind===TYPE.AVE) ? radiusOverrides.AVE
                   : (kind===TYPE.MEDAL) ? radiusOverrides.MEDAL
                   : radiusOverrides.AVE;
    }
  }
  class Link { constructor(a,b,rest){ this.a=a; this.b=b; this.rest=rest; }
    satisfy(stiff=1){
      const ax=this.a.x, ay=this.a.y, bx=this.b.x, by=this.b.y;
      let dx = bx-ax, dy = by-ay; let dist = Math.hypot(dx,dy) || 1e-6;
      const diff = (dist - this.rest)/dist; const mul = stiff * diff;
      const invA = this.a.pinned? 0 : 0.5; const invB = this.b.pinned? 0 : 0.5;
      this.a.x += dx * mul * invA; this.a.y += dy * mul * invA;
      this.b.x -= dx * mul * invB; this.b.y -= dy * mul * invB;
    } }

  function scaleFromCanvas(w, h){
    // 기준 박스(600x640) 대비 "안에 들어가도록" 스케일 = min(w/600, h/640)
    // 예) 800x640 → min(800/600≈1.33, 640/640=1) = 1 → 그대로 유지
    // 예) 400x320 → min(400/600≈0.667, 320/640=0.5) = 0.5 → 절반으로 축소
    const sx = w / REF.W, sy = h / REF.H;
    return Math.min(sx, sy);
  }

  function scaledCfg(base, scale){
    const s = Math.max(0.25, scale); // 너무 작아지는 것 방지(하드 클램프)
    const out = { ...base };
    out.BEAD_SPACING = base.BEAD_SPACING * s;
    out.RADIUS_AVE   = base.RADIUS_AVE   * s;
    out.RADIUS_PATER = base.RADIUS_PATER * s;
    out.RADIUS_MEDAL = base.RADIUS_MEDAL * s;
    out.CROSS_WIDTH  = base.CROSS_WIDTH  * s;
    out.CROSS_HEIGHT = base.CROSS_HEIGHT * s;
    return out;
  }

  function makeEngine(canvas, userCfg){
    // 상태
    const ctx = canvas.getContext('2d');
    const hudGravity = document.getElementById('gravity');
    const hudCollide = document.getElementById('collide');
    const pinTip = document.getElementById('pinTip');
    let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let W=0, H=0;
    let CFG = { ...CFG_BASE, ...(userCfg||{}) }; // 현재 활성 설정(색상/물리 고정값 포함)
    let SCALE = 1; // 캔버스 기반 스케일
    let nodes=[], links=[]; let dragging=null; let pointer={x:0,y:0};
    let highlightedId=null; let last=performance.now(); let animTime=0;
    let bgRadiusPx = 0;

    const radiusOverrides = () => ({
      AVE: CFG.RADIUS_AVE, PATER: CFG.RADIUS_PATER, MEDAL: CFG.RADIUS_MEDAL
    });
    const crossSize = () => ({ w: CFG.CROSS_WIDTH, h: CFG.CROSS_HEIGHT });

    function beadTone(kind){
      if (kind === TYPE.PATER) return WOOD_TONES.PATER;
      if (kind === TYPE.MEDAL) return WOOD_TONES.MEDAL;
      return WOOD_TONES.AVE;
    }

    function createWoodGradient(x, y, radius, tone){
      const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.55, radius * 0.1, x, y, radius);
      grad.addColorStop(0, tone.light);
      grad.addColorStop(0.5, tone.mid);
      grad.addColorStop(1, tone.dark);
      return grad;
    }

    function beadFill(node, isHighlighted){
      if (isHighlighted){
        const glow = ctx.createRadialGradient(node.x, node.y, node.radius * 0.1, node.x, node.y, node.radius);
        glow.addColorStop(0, CFG.HIGHLIGHT_GLOW_INNER);
        glow.addColorStop(0.6, CFG.HIGHLIGHT_GLOW_MID);
        glow.addColorStop(1, CFG.COLOR_HIGHLIGHT);
        return glow;
      }
      const tone = beadTone(node.kind);
      return createWoodGradient(node.x, node.y, node.radius, tone);
    }

    function beadGrain(node){
      const tone = beadTone(node.kind);
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = tone.light;
      ctx.lineWidth = Math.max(0.4, node.radius * 0.12);
      ctx.beginPath();
      ctx.arc(node.x - node.radius * 0.2, node.y - node.radius * 0.25, node.radius * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = tone.dark;
      ctx.beginPath();
      ctx.arc(node.x + node.radius * 0.15, node.y + node.radius * 0.2, node.radius * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function roundedRectPath(context, x, y, width, height, radius){
      const limit = Math.min(width, height) * 0.5;
      const r = Math.max(0, Math.min(radius, limit));
      context.moveTo(x + r, y);
      context.lineTo(x + width - r, y);
      context.quadraticCurveTo(x + width, y, x + width, y + r);
      context.lineTo(x + width, y + height - r);
      context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      context.lineTo(x + r, y + height);
      context.quadraticCurveTo(x, y + height, x, y + height - r);
      context.lineTo(x, y + r);
      context.quadraticCurveTo(x, y, x + r, y);
      context.closePath();
    }

    function drawHighlightHalo(node, time){
      const pulseRate = CFG.HIGHLIGHT_PULSE_RATE || 2.4;
      const oscillation = (Math.sin(time * pulseRate) + 1) * 0.5;
      const crossMetrics = node.kind === TYPE.CROSS ? crossSize() : null;
      const baseRadius = node.kind === TYPE.CROSS
        ? Math.max(crossMetrics.w, crossMetrics.h) * 0.55
        : node.radius * 1.35;
      const outerRadius = baseRadius + (node.radius * 0.9) + oscillation * node.radius * 0.9;
      const gradient = ctx.createRadialGradient(
        node.x,
        node.y,
        Math.max(1, baseRadius * 0.35),
        node.x,
        node.y,
        outerRadius
      );
      gradient.addColorStop(0, CFG.HIGHLIGHT_GLOW_INNER);
      gradient.addColorStop(0.45, CFG.HIGHLIGHT_GLOW_MID);
      gradient.addColorStop(1, CFG.HIGHLIGHT_GLOW_OUTER);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(node.x, node.y, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.globalAlpha = 0.5 + oscillation * 0.3;
      ctx.lineWidth = Math.max(0.8, node.radius * 0.3);
      ctx.strokeStyle = CFG.HIGHLIGHT_RING;
      ctx.beginPath();
      ctx.arc(node.x, node.y, baseRadius + oscillation * node.radius * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function resize(){
      const cssW = Math.floor(canvas.clientWidth || canvas.width || REF.W);
      const cssH = Math.floor(canvas.clientHeight|| canvas.height|| REF.H);
      W = cssW; H = cssH;
      DPR = Math.max(1, Math.min(2, window.devicePixelRatio||1));
      canvas.width  = Math.floor(cssW * DPR);
      canvas.height = Math.floor(cssH * DPR);
      ctx.setTransform(DPR,0,0,DPR,0,0);
      // 스케일 재산출 & 스케일되는 항목만 업데이트
      SCALE = scaleFromCanvas(W,H);
      const scaled = scaledCfg(CFG_BASE, SCALE);
      CFG = { ...CFG, ...scaled };
      if (typeof window !== 'undefined' && window.getComputedStyle){
        const computed = parseFloat(window.getComputedStyle(canvas).fontSize);
        const fontSizePx = Number.isFinite(computed) ? computed : 16;
        bgRadiusPx = fontSizePx * 0.75;
      } else {
        bgRadiusPx = 12; // 기본 폰트 16px 가정 → 0.75em
      }
    }

    function initRosary(){
      nodes=[]; links=[];
      const CX = W/2;
      const CY = H*0.375;
      const R = Math.min(W, H) * 0.35; // 기본 구조는 비율 기반, 절대치(구슬/십자가)는 CFG 스케일 사용

      // 루프 정의(54개)
      const loopKinds=[]; const loopIds=[];
      for(let d=0; d<5; d++){
        for(let j=0;j<10;j++){ loopKinds.push(TYPE.AVE); loopIds.push(`ave-${d}-${j}`); }
        if(d<4){ loopKinds.push(TYPE.PATER); loopIds.push(`pater-${d}`); }
      }
      const loop=[]; const t0=Math.PI/2;
      for(let i=0;i<loopKinds.length;i++){
        const t=t0 + (i/loopKinds.length)*Math.PI*2; const x=CX+Math.cos(t)*R; const y=CY+Math.sin(t)*R;
        const n = new Node(x,y, loopKinds[i], loopIds[i], radiusOverrides()); loop.push(n); nodes.push(n);
      }
      for(let i=0;i<loop.length-1;i++){
        const rest = (i%11===9 || i%11===10) ? CFG.BEAD_SPACING*1.5 : CFG.BEAD_SPACING;
        links.push(new Link(loop[i], loop[i+1], rest));
      }
      const bottom = loop[0];
      const medal = new Node(bottom.x, bottom.y + CFG.BEAD_SPACING*0.8, TYPE.MEDAL, 'medal', radiusOverrides());
      nodes.push(medal);
      links.push(new Link(bottom, medal, CFG.BEAD_SPACING*1.5));
      links.push(new Link(loop[loop.length-1], medal, CFG.BEAD_SPACING*1.5));

      const dropSeq=[TYPE.PATER, TYPE.AVE, TYPE.AVE, TYPE.AVE, TYPE.PATER];
      let prev=medal;
      for(let i=0;i<dropSeq.length;i++){
        const n = new Node(prev.x, prev.y + CFG.BEAD_SPACING, dropSeq[i], `intro-${dropSeq.length-i-1}`, radiusOverrides());
        nodes.push(n); links.push(new Link(prev, n, i===0? CFG.BEAD_SPACING*1.5: CFG.BEAD_SPACING)); prev=n;
      }
      const crossAnchor = new Node(prev.x, prev.y + CFG.BEAD_SPACING*0.9, TYPE.CROSS, 'cross', radiusOverrides());
      crossAnchor.radius = 4.5 * SCALE; // 클릭 범위
      nodes.push(crossAnchor); links.push(new Link(prev, crossAnchor, CFG.BEAD_SPACING*1.8));

      nodes.forEach(n=>{ n.x+= (Math.random()-0.5)*2; n.y+= (Math.random()-0.5)*2; n.px=n.x; n.py=n.y; });
    }

    function collectLoop(){ return nodes.slice(0,54); }

    function step(dt){
      const g = (document.getElementById('gravity')?.checked) ? CFG.GRAVITY : 0;
      for(const n of nodes){ if(n.pinned) continue; const vx=(n.x-n.px)*CFG.FRICTION, vy=(n.y-n.py)*CFG.FRICTION; n.px=n.x; n.py=n.y; n.x+=vx; n.y+=vy + g*dt*dt; }
      for(let k=0;k<CFG.ITERATIONS;k++){
        for(const L of links) L.satisfy(CFG.STRING_STIFFNESS);
        for(const n of nodes){ const r=n.radius+2; let clamp=false; if(n.x<r){n.x=r; clamp=true;} if(n.x>W-r){n.x=W-r; clamp=true;} if(n.y<r){n.y=r; clamp=true;} if(n.y>H-r){n.y=H-r; clamp=true;} if(clamp){n.px=n.x; n.py=n.y;} }
        if (document.getElementById('collide')?.checked) repelCollisions();
      }
    }
    function repelCollisions(){
      for(let i=0;i<nodes.length;i++){
        const a=nodes[i]; for(let j=i+1;j<nodes.length;j++){ const b=nodes[j]; const dx=b.x-a.x, dy=b.y-a.y; const d2=dx*dx+dy*dy; if(!d2) continue; const min=(a.radius+b.radius)*0.98; if(d2<min*min){ const d=Math.sqrt(d2)||1e-6, overlap=(min-d), nx=dx/d, ny=dy/d, m=CFG.COLLISION_REPULSION*overlap; if(!a.pinned){a.x-=nx*m*0.5; a.y-=ny*m*0.5;} if(!b.pinned){b.x+=nx*m*0.5; b.y+=ny*m*0.5;} } }
      }
    }

    function drawCross(cx, cy, {w,h}, hi=false){
      const stem=Math.max(2, w*0.38); const armLen=Math.max(w*0.95*0.5, stem); const armThk=Math.max(2, h*0.20); const topLen=Math.max(6, h*0.28); const botLen=Math.max(10, h*0.56);
      ctx.save(); ctx.translate(cx,cy); ctx.lineJoin='round'; ctx.lineCap='round';
      const grad=ctx.createLinearGradient(0,-topLen,0,botLen); grad.addColorStop(0, CFG.CROSS_GRAD_TOP); grad.addColorStop(1, CFG.CROSS_GRAD_BOTTOM);
      ctx.beginPath(); ctx.moveTo(-stem/2,-topLen); ctx.lineTo(stem/2,-topLen); ctx.lineTo(stem/2,-armThk/2); ctx.lineTo(armLen,-armThk/2); ctx.lineTo(armLen,armThk/2); ctx.lineTo(stem/2,armThk/2); ctx.lineTo(stem/2,botLen); ctx.lineTo(-stem/2,botLen); ctx.lineTo(-stem/2,armThk/2); ctx.lineTo(-armLen,armThk/2); ctx.lineTo(-armLen,-armThk/2); ctx.lineTo(-stem/2,-armThk/2); ctx.closePath();
      ctx.fillStyle = hi? CFG.COLOR_HIGHLIGHT : grad; ctx.strokeStyle = hi? CFG.COLOR_HIGHLIGHT : CFG.CROSS_STROKE; ctx.lineWidth=2; ctx.fill(); ctx.stroke();
      if (!hi){
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.strokeStyle = CFG.CROSS_EDGE_HI; ctx.lineWidth = Math.max(1.2, stem*0.18);
        ctx.beginPath(); ctx.moveTo(-armLen*0.85, -armThk*0.15); ctx.lineTo(armLen*0.85, -armThk*0.05); ctx.stroke();
        ctx.globalAlpha = 0.14; ctx.strokeStyle = 'rgba(98,58,28,0.6)'; ctx.lineWidth = Math.max(1, stem*0.12);
        ctx.beginPath(); ctx.moveTo(-stem*0.35, topLen*0.25); ctx.lineTo(stem*0.35, botLen*0.65); ctx.stroke();
        ctx.restore();
      } else {
        ctx.save(); ctx.globalAlpha = 0.45; ctx.strokeStyle = CFG.COLOR_HIGHLIGHT; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
      }
      const dotR=Math.max(1, Math.min(2.2, stem*0.12)); ctx.beginPath(); ctx.arc(-armLen+2,0,dotR,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill(); ctx.beginPath(); ctx.arc(armLen-2,0,dotR,0,Math.PI*2); ctx.fill(); ctx.restore();
    }

    function draw(time=0){
      ctx.clearRect(0,0,W,H);
      const bg = ctx.createRadialGradient(W*0.5, H*0.35, Math.max(W,H)*0.05, W*0.5, H*0.4, Math.max(W,H)*0.8);
      bg.addColorStop(0, CFG.COLOR_BG_INNER);
      bg.addColorStop(1, CFG.COLOR_BG_OUTER);
      ctx.save();
      ctx.beginPath();
      roundedRectPath(ctx, 0, 0, W, H, bgRadiusPx);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth=3; ctx.strokeStyle=CFG.COLOR_STRING; ctx.beginPath();
      const loop=collectLoop(); const medal=nodes[54];
      for(let i=0;i<loop.length-1;i++){ const a=loop[i], b=loop[i+1]; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.moveTo(loop[loop.length-1].x, loop[loop.length-1].y); ctx.lineTo(medal.x, medal.y);
      ctx.moveTo(medal.x, medal.y); ctx.lineTo(loop[0].x, loop[0].y);
      for(let i=loop.length;i<nodes.length-1;i++){ const a=nodes[i], b=nodes[i+1]; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.stroke();

      for(const n of nodes){
        const isHighlighted = (highlightedId && n.node_id===highlightedId);
        if (isHighlighted){
          drawHighlightHalo(n, time);
        }
        ctx.beginPath();
        ctx.arc(n.x,n.y,n.radius,0,Math.PI*2);
        ctx.fillStyle = beadFill(n, !!isHighlighted);
        ctx.fill();
        ctx.strokeStyle = isHighlighted ? CFG.COLOR_HIGHLIGHT : CFG.COLOR_BEAD_STROKE;
        ctx.lineWidth = Math.max(1, n.radius * 0.2);
        ctx.stroke();
        if(!isHighlighted && n.kind !== TYPE.CROSS){
          beadGrain(n);
        }
        if(n.pinned){
          ctx.beginPath();
          ctx.arc(n.x,n.y, Math.max(3,n.radius*0.55),0,Math.PI*2);
          ctx.strokeStyle=CFG.COLOR_PIN;
          ctx.lineWidth=2;
          ctx.stroke();
        }
      }
      const crossAnchor = nodes[nodes.length-1]; const crossHi = (crossAnchor.node_id===highlightedId); drawCross(crossAnchor.x, crossAnchor.y, crossSize(), crossHi);
      if (dragging){ const n=dragging.node; ctx.beginPath(); ctx.arc(n.x,n.y,n.radius+3,0,Math.PI*2); ctx.strokeStyle=CFG.COLOR_DRAG; ctx.lineWidth=2; ctx.stroke(); }
    }

    function PO(e){ const r=canvas.getBoundingClientRect(); if(e.touches&&e.touches[0]) return {x:e.touches[0].clientX-r.left, y:e.touches[0].clientY-r.top}; return {x:e.clientX-r.left, y:e.clientY-r.top}; }
    function nearestNode(x,y,maxR=28){ let best=null, bd=maxR*maxR; for(const n of nodes){ const dx=n.x-x, dy=n.y-y, d2=dx*dx+dy*dy; const lim=(n.radius+10), lim2=lim*lim; const use=Math.min(bd,lim2); if(d2<use){ bd=d2; best=n; } } return best; }

    function loopRAF(t){
      const now=t||performance.now();
      const dt=Math.min(0.033,(now-last)/1000);
      last=now;
      animTime += dt;
      step(dt);
      draw(animTime);
      _raf = requestAnimationFrame(loopRAF);
    }
    let _raf=null;

    function showPinTip(x,y){ const el=pinTip; if(!el) return; el.style.left=x+'px'; el.style.top=y+'px'; el.style.display='block'; clearTimeout(showPinTip._t); showPinTip._t=setTimeout(()=> el.style.display='none', 600); }

    // 공개 API --------------------------------------------------------------
    function init(){
      resize();
      initRosary();
      animTime = 0;
      last = performance.now();
      if(_raf) cancelAnimationFrame(_raf);
      _raf = requestAnimationFrame(loopRAF);
    }
    function reset(){ initRosary(); }
    function highlight_rosary_step(id){ const n = nodes.find(v=> v.node_id===id); if(!n){ highlightedId=null; return false; } highlightedId=id; return true; }
    function destroy(){ if(_raf) cancelAnimationFrame(_raf); _raf=null; nodes=[]; links=[]; }
    function getConfig(){ return { ...CFG, SCALE, canvasSize:{W,H} }; }

    // 이벤트 바인딩(포인터)
    canvas.addEventListener('pointerdown', e=>{ const p=PO(e); pointer=p; const n=nearestNode(p.x,p.y); if(!n) return; dragging={node:n, ox:n.x-p.x, oy:n.y-p.y}; n.px=n.x=p.x+dragging.ox; n.py=n.y=p.y+dragging.oy; });
    canvas.addEventListener('pointermove', e=>{ const p=PO(e); pointer=p; if(dragging){ const n=dragging.node; n.px=n.x; n.py=n.y; n.x=p.x+dragging.ox; n.y=p.y+dragging.oy; }});
    const endDrag=()=>{ if(dragging){ dragging.node.px=dragging.node.x; dragging.node.py=dragging.node.y; } dragging=null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', e=>{ e.preventDefault(); const p=PO(e); const n=nearestNode(p.x,p.y,22); if(n){ n.pinned=!n.pinned; showPinTip(p.x,p.y); }});

    // 크기 변경 즉시 반영
    const onResize = ()=>{ const prevScale=SCALE; resize(); const newScale=SCALE; if (Math.abs(newScale - prevScale) > 1e-6){ initRosary(); } };
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

    return { init, reset, destroy, getConfig, highlight_rosary_step };
  }

  function create(canvas, options){
    const engine = makeEngine(canvas, options||{});
    engine.init();
    return engine;
  }

  return { create, TYPE };
}));
