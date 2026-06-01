// Tavern Crashers — Stage: canvas host, mouse tools, render loop. Exposes window.Stage + window.flashHelp.
(function(){
// ============================================================
// Stage — canvas, mouse interaction, ties engine to React state.
// ============================================================
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS, useMemo: useMemoS, useCallback: useCallbackS } = React;

function Stage({ map, tokens, mapImg, sprites, clips, lingers,
                 time, totalTime, playing, cleanMode, tool,
                 selectedTokenId, selectedClipId, selectedSpellId, selectedLingerId, selectedLingerObjId,
                 imgTick,
                 onSelectToken, onSelectClip, onSelectLingerObj, onPickPoint,
                 onAddMoveClip, onAddSpellClip, onAddAttackClip,
                 onAddLinger, onMoveLinger, onDeleteLinger,
                 onMoveTokenTo, onDragOver, draggingSprite,
                 canvasRef, hostRef }){

  const tempPathRef = useRefS([]);          // collected polyline points (mutable)
  const tempTokenIdRef = useRefS(null);     // who we're drawing for
  const [pathTick, setPathTick] = useStateS(0); // re-render trigger
  const [hoverPoint, setHoverPoint] = useStateS(null);
  const [dragToken, setDragToken] = useStateS(null);
  const stageBoxRef = useRefS(null);

  // Convert client coords → map coords (canvas is sized to map; CSS scales it).
  const clientToMap = useCallbackS((cx, cy) => {
    const host = hostRef.current; if (!host) return {x:0, y:0};
    const rect = host.getBoundingClientRect();
    const mx = ((cx - rect.left) / rect.width) * map.width;
    const my = ((cy - rect.top) / rect.height) * map.height;
    return { x: mx, y: my };
  }, [map, hostRef]);

  // Find token under map-point.
  const tokenAt = useCallbackS((p) => {
    for (let i=tokens.length-1; i>=0; i--){
      const t = tokens[i];
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d <= window.MapEngine.TOKEN_R + 4) return t;
    }
    return null;
  }, [tokens]);

  // -------- mouse handlers --------
  const onMouseDown = useCallbackS((e) => {
    if (playing) return;
    if (e.button !== 0) return;
    const mp = clientToMap(e.clientX, e.clientY);
    const t = tokenAt(mp);

    if (tool === "select"){
      if (t){
        onSelectToken(t.id);
        setDragToken({ tokenId: t.id, offsetX: t.x - mp.x, offsetY: t.y - mp.y });
      } else {
        // No token under cursor — try linger effects so they can be
        // selected (and then deleted) from the default tool too.
        const hitL = (lingers || []).slice().reverse().find(l => Math.hypot(l.x - mp.x, l.y - mp.y) <= l.radius);
        if (hitL){
          onSelectLingerObj?.(hitL.id);
        } else {
          onSelectToken(null);
          onSelectLingerObj?.(null);
        }
      }
    }
    else if (tool === "path"){
      if (t){
        onSelectToken(t.id);
        tempTokenIdRef.current = t.id;
        tempPathRef.current = [{ x: t.x, y: t.y }];
        setPathTick(n => n + 1);
      } else if (selectedTokenId){
        // start from selected token
        const st = tokens.find(tt => tt.id === selectedTokenId);
        if (st){
          tempTokenIdRef.current = st.id;
          tempPathRef.current = [{ x: st.x, y: st.y }, mp];
          setPathTick(n => n + 1);
        }
      }
    }
    else if (tool === "spell" || tool === "aoe"){
      if (!selectedTokenId){ flashHelp("Select a caster first (V)"); return; }
      if (!selectedSpellId){ flashHelp("Pick a spell from the right panel first"); return; }
      const spell = window.SPELLS.find(s => s.id === selectedSpellId);
      // AOE tool always targets a point, never a token. Spell tool prefers token.
      const targetTok = (tool === "spell" && t && t.id !== selectedTokenId) ? t : null;
      onAddSpellClip(selectedTokenId, spell, targetTok ? { tokenId: targetTok.id } : { point: mp });
    }
    else if (tool === "attack"){
      if (!selectedTokenId){ flashHelp("Select an attacker first (V)"); return; }
      if (t && t.id !== selectedTokenId){
        onAddAttackClip(selectedTokenId, t.id);
      } else {
        flashHelp("Click a target token to attack");
      }
    }
    else if (tool === "linger"){
      // If clicking on an existing linger effect, select it (allow drag).
      const hit = (lingers || []).slice().reverse().find(l => Math.hypot(l.x - mp.x, l.y - mp.y) <= l.radius);
      if (hit){
        onSelectLingerObj?.(hit.id);
        return;
      }
      if (!selectedLingerId){ flashHelp("Pick an effect from the right panel first"); return; }
      onAddLinger?.(selectedLingerId, mp.x, mp.y);
    }
  }, [playing, tool, clientToMap, tokenAt, onSelectToken, selectedTokenId, selectedSpellId, selectedLingerId, tokens, lingers, onAddLinger, onSelectLingerObj, onAddAttackClip]);

  const onMouseMove = useCallbackS((e) => {
    const mp = clientToMap(e.clientX, e.clientY);
    setHoverPoint(mp);
    if (dragToken){
      onMoveTokenTo(dragToken.tokenId, mp.x + dragToken.offsetX, mp.y + dragToken.offsetY);
    }
    if (tempTokenIdRef.current){
      const arr = tempPathRef.current;
      const last = arr[arr.length-1];
      const d = Math.hypot(mp.x - last.x, mp.y - last.y);
      if (d > 14){
        arr.push(mp);
        setPathTick(n => n + 1);
      }
    }
  }, [clientToMap, dragToken, onMoveTokenTo]);

  const onMouseUp = useCallbackS((e) => {
    setDragToken(null);
    if (tempTokenIdRef.current){
      const path = tempPathRef.current;
      if (path.length >= 2){
        onAddMoveClip(tempTokenIdRef.current, path.slice());
      }
      tempTokenIdRef.current = null;
      tempPathRef.current = [];
      setPathTick(n => n + 1);
    }
  }, [onAddMoveClip]);

  const onMouseLeave = useCallbackS(() => {
    setHoverPoint(null);
  }, []);

  // Global mouseup safety
  useEffectS(() => {
    const handler = () => {
      setDragToken(null);
      if (tempTokenIdRef.current){
        const path = tempPathRef.current;
        if (path.length >= 2) onAddMoveClip(tempTokenIdRef.current, path.slice());
        tempTokenIdRef.current = null;
        tempPathRef.current = [];
        setPathTick(n => n + 1);
      }
    };
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, [onAddMoveClip]);

  // -------- canvas render loop --------
  useEffectS(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = map.width; canvas.height = map.height;
    const ctx = canvas.getContext("2d");

    let rafId;
    const renderOnce = () => {
      window.MapEngine.drawScene(ctx, {
        map, mapImg, tokens, sprites, clips, lingers,
        time, selectedTokenId, selectedLingerObjId,
        tempPath: tempPathRef.current.length > 1 ? tempPathRef.current : null,
        tempPathTokenId: tempTokenIdRef.current,
        tempTarget:null, hoverPoint, tool,
        playing, cleanMode
      });
    };
    renderOnce();
  }, [map, mapImg, tokens, sprites, clips, lingers, time, selectedTokenId,
       selectedLingerObjId, pathTick, hoverPoint, tool, playing, cleanMode, canvasRef, imgTick]);

  // -------- compute display size to fit available area --------
  const [box, setBox] = useStateS({ w: 800, h: 600 });
  useEffectS(() => {
    const el = stageBoxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = map.width / map.height;
  let w = box.w - 20, h = box.h - 20;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  if (cleanMode){ w = box.w; h = box.h; if (w/h > aspect) w = h*aspect; else h = w/aspect; }

  // -------- help text --------
  const helpMap = {
    select: "Click a token to select. Drag to move it. Click a placed effect to select and delete it.",
    path:   "Click a token, then drag to draw a movement path. Release to add a MOVE clip.",
    spell:  "Pick caster (V) + spell (right panel), then click target token or ground.",
    attack: "With a caster selected, click a target token to add an attack.",
    aoe:    "Pick caster + spell, then click ground to place AOE at point.",
    linger: "Pick an effect (right panel), then click the map to place it. Click an existing effect to select it; press Del or use the ✕ pill to remove.",
    note:   "Map notes — coming soon.",
  };

  return React.createElement("div", {
    ref: stageBoxRef,
    className: "stage-wrap"
  },
    React.createElement("div", {
      ref: hostRef,
      className: `stage-canvas-host tool-${tool}`,
      style: { width: w+"px", height: h+"px" },
      onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
      onContextMenu: e => e.preventDefault(),
    },
      React.createElement("canvas", { ref: canvasRef }),
      // ---- In-canvas delete pill for the selected linger effect.
      // Positioned in % so it tracks the scaled host. Stops mousedown so it
      // doesn't get interpreted as "place another effect / drop selection".
      !cleanMode && !playing && (() => {
        const sel = (lingers || []).find(l => l.id === selectedLingerObjId);
        if (!sel) return null;
        const leftPct = (sel.x / map.width) * 100;
        const topPct  = ((sel.y - (sel.radius || 80)) / map.height) * 100;
        return React.createElement("button", {
          className: "linger-delete-pill",
          style: { left: leftPct + "%", top: topPct + "%" },
          onMouseDown: e => e.stopPropagation(),
          onClick: e => { e.stopPropagation(); onDeleteLinger?.(sel.id); },
          title: "Delete this effect (Del)",
        }, "✕  Delete effect")
      })()
    ),
    !cleanMode && !playing && React.createElement("div", { className:"stage-hud" },
      React.createElement("span", { className:"pill" }, map.name),
      React.createElement("span", { className:"pill" },
        `${map.width}×${map.height} · ${tokens.length} token${tokens.length===1?"":"s"}`)
    ),
    !cleanMode && !playing && React.createElement("div", { className:"stage-help" },
      React.createElement("b", null, tool.toUpperCase()),
      " — ", helpMap[tool]
    )
  );
}

// quick toast
let _toastT;
function flashHelp(msg){
  let el = document.querySelector(".toast");
  if (!el){
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="dot"></span><span>${msg}</span>`;
  el.style.opacity = "1";
  clearTimeout(_toastT);
  _toastT = setTimeout(()=>{ el.style.opacity = "0"; }, 2200);
}
window.flashHelp = flashHelp;

window.Stage = Stage;
})();
