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
    COLOR_BG_INNER: '#0d1430',
    COLOR_BG_OUTER: '#070b1a',
    COLOR_STRING: 'rgba(200,220,255,0.7)',
    COLOR_BEAD_STROKE: 'rgba(25,45,90,0.7)',
    COLOR_PIN: '#6be2ff',
    COLOR_DRAG: 'rgba(255,255,255,.9)',
    COLOR_AVE: '#e8f0ff',
    COLOR_PATER: '#cbd7ff',
    COLOR_MEDAL: '#ffe6a8',
    COLOR_HIGHLIGHT: '#ff0000',
    CROSS_STROKE: '#2a334d',
    CROSS_GRAD_TOP: '#f2e6c9',
    CROSS_GRAD_BOTTOM: '#d6b88a',
    CROSS_EDGE_HI: '#ffffff',
    TOP_BOTTOM_MARGIN_RATIO: 0.05
  };

  const TYPE = { AVE:'AVE', PATER:'PATER', MEDAL:'MEDAL', CROSS:'CROSS' };

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
    let highlightedId=null; let last=performance.now();

    const radiusOverrides = () => ({
      AVE: CFG.RADIUS_AVE, PATER: CFG.RADIUS_PATER, MEDAL: CFG.RADIUS_MEDAL
    });
    const crossSize = () => ({ w: CFG.CROSS_WIDTH, h: CFG.CROSS_HEIGHT });

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
      ctx.save(); ctx.globalAlpha = hi? 0.45 : 0.2; ctx.strokeStyle = hi? CFG.COLOR_HIGHLIGHT : CFG.CROSS_EDGE_HI; ctx.lineWidth=1; ctx.stroke(); ctx.restore();
      const dotR=Math.max(1, Math.min(2.2, stem*0.12)); ctx.beginPath(); ctx.arc(-armLen+2,0,dotR,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill(); ctx.beginPath(); ctx.arc(armLen-2,0,dotR,0,Math.PI*2); ctx.fill(); ctx.restore();
    }

    function draw(){
      ctx.clearRect(0,0,W,H);
      //const grd = ctx.createRadialGradient(W*0.5,H*0.3, 10, W*0.5,H*0.3, Math.max(W,H)*0.9); grd.addColorStop(0, CFG.COLOR_BG_INNER); grd.addColorStop(1, CFG.COLOR_BG_OUTER); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
      ctx.lineWidth=3; ctx.strokeStyle=CFG.COLOR_STRING; ctx.beginPath();
      const loop=collectLoop(); const medal=nodes[54];
      for(let i=0;i<loop.length-1;i++){ const a=loop[i], b=loop[i+1]; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.moveTo(loop[loop.length-1].x, loop[loop.length-1].y); ctx.lineTo(medal.x, medal.y);
      ctx.moveTo(medal.x, medal.y); ctx.lineTo(loop[0].x, loop[0].y);
      for(let i=loop.length;i<nodes.length-1;i++){ const a=nodes[i], b=nodes[i+1]; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
      ctx.stroke();

      for(const n of nodes){ let base = (n.kind===TYPE.PATER)? CFG.COLOR_PATER : (n.kind===TYPE.MEDAL)? CFG.COLOR_MEDAL : CFG.COLOR_AVE; if(highlightedId && n.node_id===highlightedId) base = CFG.COLOR_HIGHLIGHT; ctx.beginPath(); ctx.arc(n.x,n.y,n.radius,0,Math.PI*2); ctx.fillStyle=base; ctx.fill(); ctx.strokeStyle=CFG.COLOR_BEAD_STROKE; ctx.stroke(); if(n.pinned){ ctx.beginPath(); ctx.arc(n.x,n.y, Math.max(3,n.radius*0.55),0,Math.PI*2); ctx.strokeStyle=CFG.COLOR_PIN; ctx.lineWidth=2; ctx.stroke(); }}
      const crossAnchor = nodes[nodes.length-1]; const crossHi = (crossAnchor.node_id===highlightedId); drawCross(crossAnchor.x, crossAnchor.y, crossSize(), crossHi);
      if (dragging){ const n=dragging.node; ctx.beginPath(); ctx.arc(n.x,n.y,n.radius+3,0,Math.PI*2); ctx.strokeStyle=CFG.COLOR_DRAG; ctx.lineWidth=2; ctx.stroke(); }
    }

    function PO(e){ const r=canvas.getBoundingClientRect(); if(e.touches&&e.touches[0]) return {x:e.touches[0].clientX-r.left, y:e.touches[0].clientY-r.top}; return {x:e.clientX-r.left, y:e.clientY-r.top}; }
    function nearestNode(x,y,maxR=28){ let best=null, bd=maxR*maxR; for(const n of nodes){ const dx=n.x-x, dy=n.y-y, d2=dx*dx+dy*dy; const lim=(n.radius+10), lim2=lim*lim; const use=Math.min(bd,lim2); if(d2<use){ bd=d2; best=n; } } return best; }

    function loopRAF(t){ const now=t||performance.now(); const dt=Math.min(0.033,(now-last)/1000); last=now; step(dt); draw(); _raf = requestAnimationFrame(loopRAF); }
    let _raf=null;

    function showPinTip(x,y){ const el=pinTip; if(!el) return; el.style.left=x+'px'; el.style.top=y+'px'; el.style.display='block'; clearTimeout(showPinTip._t); showPinTip._t=setTimeout(()=> el.style.display='none', 600); }

    // 공개 API --------------------------------------------------------------
    function init(){ resize(); initRosary(); if(_raf) cancelAnimationFrame(_raf); _raf = requestAnimationFrame(loopRAF); }
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
