// Tavern Crashers — Root App component (state, playback, recording, wiring). Exposes window.App.
(function(){
// ============================================================
// Tavern Crashers — main App
// ============================================================
const { useState: uS, useEffect: uE, useRef: uR, useMemo: uM, useCallback: uC } = React;

// ---- helpers ----
const uid = (p="id") => `${p}_${Math.random().toString(36).slice(2,9)}`;

// Default starter sprites
// Resolve an asset path through the standalone-bundle resource map when present,
// so the same code works in dev AND in the inlined single-file export.
const _R = (id, path) => (window.__resources && window.__resources[id]) || path;
const DEFAULT_SPRITES = [
  { id:"s_bard",      name:"Bard",        src:_R("tokenBard","assets/token-bard.png") },
  { id:"s_noble",     name:"Noble",       src:_R("tokenNoble","assets/token-noble.png") },
  { id:"s_tiefling",  name:"Tiefling",    src:_R("tokenTiefling","assets/token-tiefling.png") },
  { id:"s_rogue",     name:"Rogue",       src:_R("tokenRogue","assets/token-rogue.png") },
  { id:"s_spider",    name:"Spider",      src:_R("tokenSpider","assets/token-spider.png") },
];
const DEFAULT_MAPS = [
  { id:"m_tree",  name:"Spider Tree",  src:_R("mapTree","assets/map-tree.png"),      width:1536, height:1024 },
  { id:"m_trash", name:"Trash Pile",   src:_R("mapTrash","assets/map-trashpile.png"), width:1536, height:1024 },
];

function makeMap({ id, name, src, width, height }){
  return {
    id: id || uid("m"), name, src, width, height,
    tokens: [],
    rounds: [{ id: uid("r"), clips: [] }],
    lingers: [],   // persistent environmental effects placed by the user
  };
}

// ============================================================
// useImage — cache HTMLImageElements by src.
// Notifies subscribers whenever a new image finishes loading.
// ============================================================
const _imgCache = new Map();
const _imgListeners = new Set();
function _notifyImgLoad(){ _imgListeners.forEach(fn => { try { fn(); } catch(e){} }); }
function getImage(src){
  if (!src) return null;
  if (_imgCache.has(src)) return _imgCache.get(src);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => _notifyImgLoad();
  img.onerror = () => _notifyImgLoad();
  img.src = src;
  _imgCache.set(src, img);
  return img;
}
function useImageTick(){
  const [tick, setTick] = uS(0);
  uE(() => {
    const fn = () => setTick(n => n + 1);
    _imgListeners.add(fn);
    return () => _imgListeners.delete(fn);
  }, []);
  return tick;
}

// ============================================================
// App
// ============================================================
function App(){
  // ---- preload the damage-number display font so canvas text renders in it ----
  uE(() => {
    if (!document.fonts || !document.fonts.load) return;
    Promise.all([
      document.fonts.load('400 66px "Abril Fatface"'),
      document.fonts.load('400 120px "Abril Fatface"'),
    ]).then(() => _notifyImgLoad()).catch(() => {});
  }, []);
  // ---- sprites ----
  const [sprites, setSprites] = uS(() => {
    const m = {};
    DEFAULT_SPRITES.forEach(s => m[s.id] = { ...s, img: getImage(s.src) });
    return m;
  });

  // ---- maps & active ----
  const [maps, setMaps] = uS(() =>
    DEFAULT_MAPS.map(m => {
      const map = makeMap(m);
      if (m.id === "m_tree"){
        // seed with sample tokens + a couple of clips so users see motion on first play
        const tBard     = uid("t");
        const tRogue    = uid("t");
        const tNoble    = uid("t");
        const tTiefling = uid("t");
        const tSpider   = uid("t");
        map.tokens = [
          { id:tBard,     spriteId:"s_bard",     label:"Bard",     x: 220, y: 760, ringColor:"#f7c948", hp:22, hpMax:30 },
          { id:tRogue,    spriteId:"s_rogue",    label:"Rogue",    x: 380, y: 850, ringColor:"#41d28e", hp:18, hpMax:24 },
          { id:tNoble,    spriteId:"s_noble",    label:"Noble",    x:1250, y: 800, ringColor:"#4ea1ff", hp:14, hpMax:20 },
          { id:tTiefling, spriteId:"s_tiefling", label:"Tiefling", x:1320, y: 870, ringColor:"#b58cff", hp:26, hpMax:28 },
          { id:tSpider,   spriteId:"s_spider",   label:"Spider",   x: 770, y: 520, ringColor:"#ff5470", hp:36, hpMax:40 },
        ];
        const fireBolt = window.SPELLS.find(s=>s.id==="fire-bolt");
        const viciousMockery = window.SPELLS.find(s=>s.id==="vicious-mockery");
        const web = { ...window.SPELLS.find(s=>s.id==="entangle"), name:"Web", school:"necrotic" };
        const sneakAttack = window.SPELLS.find(s=>s.id==="sneak-attack");
        map.rounds = [{
          id: uid("r"),
          clips: [
            // 0.0s: Bard steps forward (slow walk, ~2.5s)
            { id: uid("c"), kind:"move", tokenId: tBard, start: 0.0, dur: 2.4,
              path: [{x:220, y:760}, {x:280, y:720}, {x:340, y:680}, {x:400, y:640}, {x:460, y:620}] },
            // 2.8s: Tiefling shoots fire bolt at spider (4s spell)
            { id: uid("c"), kind:"spell", tokenId: tTiefling, targetTokenId: tSpider,
              start: 2.8, dur: 4.0, spell: { ...fireBolt }, damage: "7" },
            // 7.2s: Spider scuttles toward party (3s)
            { id: uid("c"), kind:"move", tokenId: tSpider, start: 7.2, dur: 3.0,
              path: [{x:770, y:520}, {x:680, y:600}, {x:580, y:700}, {x:520, y:780}] },
            // 10.4s: Spider casts Web on the rogue area (4.5s)
            { id: uid("c"), kind:"spell", tokenId: tSpider, target:{x:380, y:850},
              start: 10.4, dur: 4.5, spell: web },
            // 10.6s: Noble casts Cure Wounds on Tiefling (4s)
            { id: uid("c"), kind:"spell", tokenId: tNoble, targetTokenId: tTiefling,
              start: 10.6, dur: 4.0, spell: { ...window.SPELLS.find(s=>s.id==="cure-wounds") }, damage: "+9" },
            // 15.2s: Rogue stabs spider (3.5s)
            { id: uid("c"), kind:"spell", tokenId: tRogue, targetTokenId: tSpider,
              start: 15.2, dur: 3.5, spell: { ...sneakAttack }, damage: "14" },
            // 15.4s: Bard mocks spider (4s)
            { id: uid("c"), kind:"spell", tokenId: tBard, targetTokenId: tSpider,
              start: 15.4, dur: 4.0, spell: { ...viciousMockery }, damage: "4" },
            // 19.6s: Rogue follows up with a bare-knuckle slam on the spider
            { id: uid("c"), kind:"attack", tokenId: tRogue, targetTokenId: tSpider,
              start: 19.6, dur: 3.0,
              spell: { school:"melee", vfx:"melee-unarmed", name:"Strike" }, damage: "6" },
          ]
        }];
      }
      if (m.id === "m_trash"){
        map.tokens = [
          { id:uid("t"), spriteId:"s_rogue",  label:"Rogue", x: 700, y: 500, ringColor:"#41d28e", hp:18, hpMax:24 },
          { id:uid("t"), spriteId:"s_spider", label:"Spider",x: 250, y: 220, ringColor:"#ff5470", hp:36, hpMax:40 },
        ];
      }
      return map;
    })
  );
  const [activeMapId, setActiveMapId] = uS("m_tree");
  const activeMap = uM(()=> maps.find(m => m.id === activeMapId) || maps[0], [maps, activeMapId]);

  // ---- selection / tool ----
  const [tool, setTool] = uS("select");
  const [selectedTokenId, setSelectedTokenId] = uS(null);
  const [selectedClipId, setSelectedClipId]   = uS(null);
  // Selecting a spell auto-switches the tool to "spell" so the user can immediately
  // click the target — no extra tool toggle needed.
  // Death animations are a one-click action: pick a token first, then click a death
  // animation and it applies to that token.
  const [selectedSpellId, setSelectedSpellId] = uS("fireball");
  const [selectedLingerId, setSelectedLingerId] = uS("fire-patch");
  const [selectedLingerObjId, setSelectedLingerObjId] = uS(null);
  // pickSpell is declared as a regular function (not useCallback) so it always
  // closes over the freshest selectedTokenId / addClipAtEnd. It is created below
  // after addClipAtEnd; here we just declare a ref the children call through.
  const pickSpellRef = uR(() => {});
  const pickSpell = uC((id) => pickSpellRef.current(id), []);
  const [inspectorTab, setInspectorTab] = uS("props");

  // When the user activates the "linger" tool, snap the inspector to the Effects tab.
  uE(() => {
    if (tool === "linger") setInspectorTab("linger");
  }, [tool]);
  const [drawerView, setDrawerView] = uS("both");
  const [drawerCollapsed, setDrawerCollapsed] = uS(false);

  // ---- round / playback ----
  const [roundIdx, setRoundIdx] = uS(0);
  const [time, setTime] = uS(0);
  const [playing, setPlaying] = uS(false);
  const [playMode, setPlayMode] = uS("round");
  const [speed, setSpeed] = uS(1);
  const [cleanMode, setCleanMode] = uS(false);
  const [recording, setRecording] = uS(false);
  // Holds the most recent recorded round so we can show it back in a clickable
  // in-app player (with a download button) instead of silently downloading.
  const [recordedClip, setRecordedClip] = uS(null); // { url, name, mime }

  // ---- live tokens (used during playback to compose multi-round playAll) ----
  const [liveTokensOverride, setLiveTokensOverride] = uS(null);

  // ---- undo stack ----
  const undoStack = uR([]);
  const pushUndo = uC(() => {
    undoStack.current.push(JSON.stringify({ maps, sprites: Object.fromEntries(
      Object.entries(sprites).map(([k,v])=>[k, {id:v.id,name:v.name,src:v.src}])
    ) }));
    if (undoStack.current.length > 30) undoStack.current.shift();
  }, [maps, sprites]);
  const doUndo = uC(() => {
    const top = undoStack.current.pop();
    if (!top) return;
    const { maps:m } = JSON.parse(top);
    setMaps(m);
  }, []);

  // ---- canvas refs (lifted for recording) ----
  const canvasRef = uR(null);
  const hostRef = uR(null);

  // ---- derived: current round, clips, totalTime ----
  const round = activeMap.rounds[roundIdx] || activeMap.rounds[0];
  const clips = round.clips;

  const baseTokens = uM(() => {
    if (liveTokensOverride) return liveTokensOverride;
    // Walk previous rounds' moves to settle base positions for current round
    let toks = activeMap.tokens.map(t => ({...t}));
    for (let i = 0; i < roundIdx; i++){
      const r = activeMap.rounds[i];
      if (r) toks = window.MapEngine.commitRound(toks, r.clips);
    }
    return toks;
  }, [activeMap.tokens, activeMap.rounds, roundIdx, liveTokensOverride]);

  const totalTime = uM(() => window.MapEngine.roundDuration(clips), [clips]);

  // ============================================================
  // map mutation helpers
  // ============================================================
  const updateActiveMap = uC((updater) => {
    pushUndo();
    setMaps(prev => prev.map(m => m.id === activeMapId ? updater(m) : m));
  }, [activeMapId, pushUndo]);

  const setRoundClips = uC((next) => {
    updateActiveMap(m => ({
      ...m,
      rounds: m.rounds.map((r,i)=> i===roundIdx ? {...r, clips: typeof next === 'function' ? next(r.clips) : next} : r)
    }));
  }, [updateActiveMap, roundIdx]);

  // ---- tokens ----
  const addTokenAt = uC((spriteId, x, y) => {
    const sp = sprites[spriteId];
    const label = sp?.name || "Token";
    const ringColor = "#ffffff";
    updateActiveMap(m => ({
      ...m,
      tokens: [...m.tokens, { id: uid("t"), spriteId, label, x, y, ringColor, hp:10, hpMax:10 }]
    }));
  }, [sprites, updateActiveMap]);

  const updateToken = uC((id, patch) => {
    updateActiveMap(m => ({
      ...m,
      tokens: m.tokens.map(t => t.id===id ? {...t, ...patch} : t)
    }));
  }, [updateActiveMap]);

  const deleteToken = uC((id) => {
    updateActiveMap(m => ({
      ...m,
      tokens: m.tokens.filter(t => t.id !== id),
      rounds: m.rounds.map(r => ({
        ...r,
        clips: r.clips.filter(c => c.tokenId !== id && c.targetTokenId !== id)
      }))
    }));
    if (selectedTokenId === id) setSelectedTokenId(null);
  }, [updateActiveMap, selectedTokenId]);

  // While dragging in select mode, mutate position without undo bloat.
  const liveMoveTokenTo = uC((id, x, y) => {
    setMaps(prev => prev.map(m => m.id===activeMapId ? ({
      ...m,
      tokens: m.tokens.map(t => t.id===id ? {...t, x, y} : t)
    }) : m));
  }, [activeMapId]);

  // ---- linger effects (persistent across rounds) ----
  const addLingerEffectAt = uC((effectId, x, y) => {
    const def = window.LINGER_EFFECTS.find(e => e.id === effectId);
    if (!def) return;
    updateActiveMap(m => ({
      ...m,
      lingers: [...(m.lingers || []), {
        id: uid("l"),
        effectId: def.id, kind: def.kind, school: def.school,
        name: def.name, radius: def.radius, x, y,
      }]
    }));
  }, [updateActiveMap]);

  const deleteLingerEffect = uC((id) => {
    updateActiveMap(m => ({
      ...m,
      lingers: (m.lingers || []).filter(l => l.id !== id),
    }));
  }, [updateActiveMap]);

  const moveLingerEffect = uC((id, x, y) => {
    setMaps(prev => prev.map(m => m.id===activeMapId ? ({
      ...m,
      lingers: (m.lingers || []).map(l => l.id===id ? {...l, x, y} : l)
    }) : m));
  }, [activeMapId]);

  // ---- clips ----
  const addClipAtEnd = uC((clip) => {
    const dur = clip.dur ?? 1.2;
    // Add a small beat between clips so the camera can settle between actions.
    const isSpellOrAttack = clip.kind === "spell" || clip.kind === "attack";
    const beat = isSpellOrAttack ? 0.5 : 0.2;
    const start = clip.start ?? (totalTime > 0 ? totalTime + beat : 0);
    const newClip = { id: uid("c"), start, dur, ...clip };
    setRoundClips(cs => [...cs, newClip]);
    setSelectedClipId(newClip.id);
    return newClip;
  }, [setRoundClips, totalTime]);

  const updateClip = uC((id, patch) => {
    setRoundClips(cs => cs.map(c => c.id===id ? {...c, ...patch} : c));
  }, [setRoundClips]);
  const moveClipStart = uC((id, newStart) => updateClip(id, { start: Math.max(0, newStart) }), [updateClip]);
  const resizeClip   = uC((id, newStart, newDur) => updateClip(id, { start: Math.max(0, newStart), dur: Math.max(0.1, newDur) }), [updateClip]);
  const deleteClip = uC((id) => {
    setRoundClips(cs => cs.filter(c => c.id !== id));
    if (selectedClipId === id) setSelectedClipId(null);
  }, [setRoundClips, selectedClipId]);

  // ---- spell/attack add ----
  const addMoveClip = uC((tokenId, path) => {
    // Slow walk: ~0.18s per waypoint so motion is easy to follow.
    addClipAtEnd({ kind:"move", tokenId, path, dur: Math.max(1.6, path.length * 0.18) });
    setTool("select");
  }, [addClipAtEnd]);

  const addSpellClip = uC((casterId, spell, targetSpec) => {
    const isDeath = spell?.vfx?.startsWith?.("death-");
    if (isDeath){
      // A death animation attaches to the victim (the targeted token), not the caster.
      const victimId = targetSpec.tokenId;
      if (!victimId){
        window.flashHelp?.("Click a token to apply a death animation");
        return;
      }
      addClipAtEnd({ kind:"spell", tokenId: victimId, spell: { ...spell }, dur: 3.5 });
      setTool("select");
      return;
    }
    // Phased animation: wind-up → charge → release → travel → impact → settle.
    // Fireball-class gets a longer beat; everything else lands in 3–5 s.
    const dur = (spell?.id === "fireball" || spell?.id === "meteor-swarm" || spell?.id === "chain-lightning") ? 5.5
      : (spell?.vfx === "aoe-sustain" || spell?.vfx === "wall" || spell?.vfx === "vines" || spell?.vfx === "line") ? 4.5
      : (spell?.vfx === "melee-slash" || spell?.vfx === "melee-stab" || spell?.vfx === "melee-smash") ? 3.5
      : (spell?.vfx === "ranged-shot" || spell?.id === "handaxe-throw" || spell?.id === "throwing-dagger" || spell?.id === "javelin") ? 4.0
      : 4.0;
    const clip = { kind:"spell", tokenId: casterId, spell: { ...spell }, dur };
    if (targetSpec.tokenId) clip.targetTokenId = targetSpec.tokenId;
    if (targetSpec.point)   clip.target = targetSpec.point;
    addClipAtEnd(clip);
    setTool("select");
  }, [addClipAtEnd]);

  const addAttackClip = uC((casterId, targetId) => {
    addClipAtEnd({ kind:"attack", tokenId: casterId, targetTokenId: targetId,
      spell:{ school:"melee", vfx:"melee-unarmed", name:"Strike" }, dur: 3.0 });
    setTool("select");
  }, [addClipAtEnd]);

  // Wire pickSpell to the freshest state. Death animations are one-click:
  // select a token, then click a death — applied immediately.
  pickSpellRef.current = (spellId) => {
    setSelectedSpellId(spellId);
    const spell = window.SPELLS.find(s => s.id === spellId);
    const isDeath = spell?.vfx?.startsWith?.("death-");
    if (isDeath){
      if (!selectedTokenId){
        window.flashHelp?.("Pick a token first, then click a death animation");
        setInspectorTab("spells");
        return;
      }
      addClipAtEnd({ kind:"spell", tokenId: selectedTokenId, spell: { ...spell }, dur: 3.5 });
      setTool("select");
      // Stay on the animations tab so the user can queue more if desired
      return;
    }
    setTool("spell");
    setInspectorTab("spells");
  };

  // ---- map operations ----
  const addMapFromFile = uC(() => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = ev => {
      const f = inp.files?.[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = e => {
        const src = e.target.result;
        const img = new Image();
        img.onload = () => {
          const m = makeMap({ name: f.name.replace(/\.[^.]+$/,"") || "New Map", src, width: img.naturalWidth, height: img.naturalHeight });
          _imgCache.set(src, img);
          setMaps(prev => [...prev, m]);
          setActiveMapId(m.id);
        };
        img.src = src;
      };
      fr.readAsDataURL(f);
    };
    inp.click();
  }, []);
  const closeMap = uC((id) => {
    setMaps(prev => {
      const next = prev.filter(m => m.id !== id);
      if (next.length === 0){
        // keep one empty
        const empty = makeMap({ name:"Untitled", src:"", width:1536, height:1024 });
        return [empty];
      }
      return next;
    });
    setMaps(prev => {
      if (id === activeMapId){
        const fallback = prev.find(m => m.id !== id) || prev[0];
        setActiveMapId(fallback.id);
      }
      return prev;
    });
  }, [activeMapId]);
  const renameMap = uC((id, name) => {
    setMaps(prev => prev.map(m => m.id === id ? {...m, name} : m));
  }, []);

  const addSprite = uC((name, src) => {
    const img = getImage(src);
    const id = uid("s");
    setSprites(prev => ({ ...prev, [id]: { id, name, src, img } }));
  }, []);

  // ---- round nav ----
  const addRound = uC(() => {
    updateActiveMap(m => ({
      ...m,
      rounds: [...m.rounds, { id: uid("r"), clips: [] }]
    }));
    setRoundIdx(r => activeMap.rounds.length); // index of new round
  }, [updateActiveMap, activeMap.rounds.length]);
  const prevRound = uC(() => {
    setRoundIdx(r => Math.max(0, r-1));
    setTime(0); setPlaying(false); setLiveTokensOverride(null);
  }, []);
  const nextRound = uC(() => {
    const max = activeMap.rounds.length - 1;
    if (roundIdx < max){
      setRoundIdx(r => r+1);
    } else {
      addRound();
    }
    setTime(0); setPlaying(false); setLiveTokensOverride(null);
  }, [activeMap.rounds.length, roundIdx, addRound]);

  // ---- playback loop ----
  // We use a Web Worker for the tick driver so playback continues smoothly even
  // when the browser tab loses focus (rAF gets throttled to 0Hz). Worker just
  // postMessages every ~16ms; main thread advances time + redraws.
  const rafRef = uR(null);
  const lastTRef = uR(0);
  const playingRef = uR(false);
  const tickerRef = uR(null);  // worker instance
  uE(() => { playingRef.current = playing; }, [playing]);

  uE(() => {
    if (!playing) return;
    lastTRef.current = performance.now();

    // Spawn the tick worker (background-tab safe).
    const workerSrc = `
      let id; let interval = 16;
      onmessage = (e) => {
        if (e.data === 'stop'){ clearInterval(id); id = null; return; }
        if (e.data && e.data.start){
          interval = e.data.interval || 16;
          clearInterval(id);
          id = setInterval(() => postMessage('t'), interval);
        }
      };
    `;
    const blob = new Blob([workerSrc], { type: "application/javascript" });
    const w = new Worker(URL.createObjectURL(blob));
    tickerRef.current = w;

    const advance = () => {
      const now = performance.now();
      const dt = (now - lastTRef.current) / 1000 * speed;
      lastTRef.current = now;
      setTime(prev => {
        const next = prev + dt;
        if (next >= totalTime){
          if (playMode === "all" && roundIdx < activeMap.rounds.length - 1){
            const newRoundIdx = roundIdx + 1;
            const settled = window.MapEngine.commitRound(baseTokens, clips);
            setLiveTokensOverride(settled);
            setRoundIdx(newRoundIdx);
            return 0;
          } else {
            setPlaying(false);
            // Auto-stop recording at end of playback and pop the HUD back.
            if (recRef.current?.rec && recRef.current.rec.state !== "inactive"){
              try { recRef.current.rec.stop(); } catch(e){}
            } else {
              setCleanMode(false);
            }
            return totalTime;
          }
        }
        return next;
      });
    };

    w.onmessage = () => {
      // Try rAF first (smoother when visible), otherwise advance directly.
      if (document.visibilityState === "visible"){
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(advance);
      } else {
        advance();
      }
    };
    w.postMessage({ start: true, interval: 16 });

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { w.postMessage("stop"); w.terminate(); } catch(e){}
      tickerRef.current = null;
    };
  }, [playing, speed, totalTime, playMode, roundIdx, activeMap.rounds.length, baseTokens, clips]);

  const onPlay = uC(() => {
    if (time >= totalTime - 0.01) setTime(0);
    if (playMode === "all" && roundIdx === activeMap.rounds.length - 1 && time >= totalTime - 0.01){
      // restart from round 0
      setRoundIdx(0); setTime(0);
    }
    setLiveTokensOverride(null);
    setPlaying(true);
  }, [time, totalTime, playMode, roundIdx, activeMap.rounds.length]);

  const onStop = uC(() => {
    setPlaying(false);
  }, []);

  const onReset = uC(() => {
    setPlaying(false);
    setTime(0);
    setLiveTokensOverride(null);
  }, []);

  // ---- recording ----
  const recRef = uR({ rec:null, chunks:[] });
  const onToggleRecord = uC(async () => {
    if (recording){
      recRef.current.rec?.stop();
      return;
    }
    const canvas = canvasRef.current; if (!canvas) return;
    try {
      const stream = canvas.captureStream(30);
      let mt = "video/webm;codecs=vp9";
      if (!window.MediaRecorder?.isTypeSupported(mt)) mt = "video/webm;codecs=vp8";
      if (!window.MediaRecorder?.isTypeSupported(mt)) mt = "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 8_000_000 });
      recRef.current = { rec, chunks: [] };
      rec.ondataavailable = e => { if (e.data.size > 0) recRef.current.chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(recRef.current.chunks, { type: mt });
        const url = URL.createObjectURL(blob);
        const name = `${activeMap.name.replace(/\s+/g,"-")}-round${roundIdx+1}-${Date.now()}.webm`;
        // Show the clip back in an in-app player rather than auto-downloading.
        setRecordedClip(prev => {
          if (prev?.url) { try { URL.revokeObjectURL(prev.url); } catch(e){} }
          return { url, name, mime: mt };
        });
        setRecording(false);
        // Bring the HUD back as soon as recording stops, and pause playback
        // so the scene doesn't linger.
        setPlaying(false);
        setCleanMode(false);
      };
      rec.start();
      setRecording(true);
      // Force clean mode + play
      setCleanMode(true);
      setTime(0); setLiveTokensOverride(null); setPlaying(true);
      window.flashHelp("Recording — press play when ready, ■ to stop");
    } catch (err){
      console.error(err);
      window.flashHelp("Recording not supported in this browser");
    }
  }, [recording, activeMap.name]);

  const onExportFrame = uC(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${activeMap.name.replace(/\s+/g,"-")}-${Math.floor(time*100)}.png`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }, [activeMap.name, time]);

  // ---- delete selected ----
  const onDeleteSelected = uC(() => {
    if (selectedClipId) deleteClip(selectedClipId);
    else if (selectedLingerObjId){
      deleteLingerEffect(selectedLingerObjId);
      setSelectedLingerObjId(null);
    }
    else if (selectedTokenId) deleteToken(selectedTokenId);
  }, [selectedClipId, selectedLingerObjId, selectedTokenId, deleteClip, deleteLingerEffect, deleteToken]);

  // ---- keyboard ----
  uE(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (e.key === " "){ e.preventDefault(); playing ? onStop() : onPlay(); }
      else if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "m" || e.key === "M") setTool("path");
      else if (e.key === "s" || e.key === "S") setTool("spell");
      else if (e.key === "a" || e.key === "A") setTool("attack");
      else if (e.key === "o" || e.key === "O") setTool("aoe");
      else if (e.key === "e" || e.key === "E") setTool("linger");
      else if (e.key === "n" || e.key === "N") setTool("note");
      else if (e.key === "l" || e.key === "L") setTool("linger");
      else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey||e.metaKey)){ e.preventDefault(); doUndo(); }
      else if (e.key === "Backspace" || e.key === "Delete") onDeleteSelected();
      else if (e.key === "Escape"){
        setCleanMode(false);
        setSelectedTokenId(null);
        setSelectedClipId(null);
        setSelectedLingerObjId(null);
      }
      else if (e.key === "ArrowLeft" && e.altKey) prevRound();
      else if (e.key === "ArrowRight" && e.altKey) nextRound();
    };
    window.addEventListener("keydown", onKey);
    return ()=>window.removeEventListener("keydown", onKey);
  }, [playing, onPlay, onStop, doUndo, onDeleteSelected, prevRound, nextRound]);

  // ---- sprite drag-from-drawer onto stage ----
  const dragRef = uR(null);
  const onDragSpriteStart = uC((spriteId, e) => {
    e.preventDefault();
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const sp = sprites[spriteId];
    if (sp) ghost.style.backgroundImage = `url("${sp.src}")`;
    document.body.appendChild(ghost);
    const move = (ev) => {
      ghost.style.left = ev.clientX + "px";
      ghost.style.top  = ev.clientY + "px";
    };
    const up = (ev) => {
      ghost.remove();
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // is over stage?
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) return;
      const mx = ((ev.clientX - rect.left) / rect.width) * activeMap.width;
      const my = ((ev.clientY - rect.top) / rect.height) * activeMap.height;
      addTokenAt(spriteId, mx, my);
    };
    move(e);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [sprites, activeMap, addTokenAt]);

  // ---- image load notifier (triggers canvas redraw when images finish loading) ----
  const imgTick = useImageTick();
  const mapImg = uM(()=> activeMap.src ? getImage(activeMap.src) : null, [activeMap.src, imgTick]);

  // ---- derived ----
  const selectedToken = selectedTokenId ? baseTokens.find(t => t.id === selectedTokenId) : null;
  const selectedClip  = selectedClipId  ? clips.find(c => c.id === selectedClipId) : null;

  // ============================================================
  // render
  // ============================================================
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: `app${cleanMode || playing ? " clean":""}${playing?" playing":""}${recording?" recording":""}` },
      // tabs
      React.createElement(window.MapTabs, {
        maps, activeMapId,
        onSelect: id => { setActiveMapId(id); setTime(0); setRoundIdx(0); setPlaying(false); },
        onClose: closeMap,
        onAdd: addMapFromFile,
        onRename: renameMap,
      }),
      // topbar
      React.createElement(window.Topbar, {
        tool, setTool,
        roundIdx, roundCount: activeMap.rounds.length,
        onPrevRound: prevRound, onNextRound: nextRound, onAddRound: addRound,
        playing, playMode, setPlayMode,
        onPlay, onStop, onReset,
        time, totalTime, speed, setSpeed,
        cleanMode, setCleanMode,
        recording, onToggleRecord, onExportFrame,
        onSeek: setTime,
      }),
      // tools
      React.createElement(window.ToolRail, {
        tool, setTool,
        onUndo: doUndo,
        onDeleteSelected,
        selectedLingerId, onSelectLinger: setSelectedLingerId,
      }),
      // center
      React.createElement("div", { className:"center" },
        React.createElement(window.Stage, {
          map: activeMap, tokens: baseTokens, mapImg, sprites, clips,
          lingers: activeMap.lingers || [],
          time, totalTime, playing, cleanMode, tool,
          selectedTokenId, selectedClipId, selectedSpellId,
          selectedLingerId, selectedLingerObjId,
          imgTick,
          onSelectToken: id => { setSelectedTokenId(id); setSelectedClipId(null); setSelectedLingerObjId(null); setInspectorTab("props"); },
          onSelectClip:  id => { setSelectedClipId(id); setSelectedTokenId(null); setSelectedLingerObjId(null); setInspectorTab("props"); },
          onSelectLingerObj: id => { setSelectedLingerObjId(id); setSelectedTokenId(null); setSelectedClipId(null); setInspectorTab("linger"); },
          onAddMoveClip: addMoveClip,
          onAddSpellClip: addSpellClip,
          onAddAttackClip: addAttackClip,
          onAddLinger: addLingerEffectAt,
          onMoveLinger: moveLingerEffect,
          onDeleteLinger: deleteLingerEffect,
          onMoveTokenTo: liveMoveTokenTo,
          canvasRef, hostRef,
        }),
        !cleanMode && !drawerCollapsed && React.createElement("div", { className:"bottom" },
          React.createElement(window.DrawerHandle, {
            activeView: drawerView, setActiveView: setDrawerView,
            collapsed: drawerCollapsed, setCollapsed: setDrawerCollapsed,
          }),
          React.createElement("div", { className:"dock" },
            (drawerView === "tokens" || drawerView === "both") &&
              React.createElement(window.TokenDrawer, {
                sprites,
                onUploadSprite: addSprite,
                onDragSprite: onDragSpriteStart,
              }),
            (drawerView === "timeline" || drawerView === "both") &&
              React.createElement(window.Timeline, {
                map: activeMap, roundIdx, tokens: baseTokens, clips,
                time, totalTime,
                selectedClipId, selectedTokenId,
                onSelectClip: id => { setSelectedClipId(id); setSelectedTokenId(null); setInspectorTab("props"); },
                onSelectToken: id => { setSelectedTokenId(id); setSelectedClipId(null); setInspectorTab("props"); },
                onMoveClip: moveClipStart,
                onResizeClip: resizeClip,
                onSeek: setTime,
                sprites,
              }),
          )
        ),
        !cleanMode && drawerCollapsed && React.createElement("div", { className:"bottom" },
          React.createElement(window.DrawerHandle, {
            activeView: drawerView, setActiveView: setDrawerView,
            collapsed: drawerCollapsed, setCollapsed: setDrawerCollapsed,
          })
        ),
      ),
      // inspector
      React.createElement(window.Inspector, {
        activeTab: inspectorTab, setActiveTab: setInspectorTab,
        map: activeMap, sprites,
        selectedToken, onUpdateToken: updateToken, onDeleteToken: deleteToken,
        selectedClip, onUpdateClip: updateClip, onDeleteClip: deleteClip,
        selectedSpellId, onSelectSpell: pickSpell,
        selectedLingerId, onSelectLinger: (id)=>{ setSelectedLingerId(id); setTool("linger"); setInspectorTab("linger"); },
        selectedLingerObjId, lingers: activeMap.lingers || [], onDeleteLinger: deleteLingerEffect,
        tool, totalTime,
      })
    ),
    React.createElement("button", {
      className:"exit-clean",
      onClick: ()=> setCleanMode(false),
      title:"Exit clean mode (Esc)"
    }, "✕  Exit clean mode  ·  Esc"),
    recordedClip && React.createElement(window.RecordingModal, {
      clip: recordedClip,
      onClose: () => {
        setRecordedClip(prev => { if (prev?.url){ try { URL.revokeObjectURL(prev.url); } catch(e){} } return null; });
      },
    })
  );
}

window.App = App;
})();
