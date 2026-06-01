// Tavern Crashers — Timeline (clip tracks, drag/resize, playhead)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function Timeline({ map, roundIdx, tokens, clips, time, totalTime,
                    selectedClipId, selectedTokenId, onSelectClip, onSelectToken,
                    onMoveClip, onResizeClip, onSeek, sprites }){

  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null);
  // drag: { clipId, mode:'move'|'l'|'r', startX, startClip }

  const onTrackMouseDown = useCallback((e) => {
    if (e.target.closest('.tl-clip')) return;
    if (e.target.closest('.tl-track .name')) return;
    if (e.button !== 0) return;
    // scrub — use the lane element's own bounding box
    const lane = e.currentTarget;
    const rect = lane.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * totalTime;
    onSeek(Math.max(0, Math.min(totalTime, t)));
  }, [totalTime, onSeek]);

  useEffect(()=>{
    if (!drag) return;
    const onMove = e=>{
      // Use the timeline tracks container so drag delta translates to time correctly
      const lane = document.querySelector(".tl-tracks .lane");
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const dxT = ((e.clientX - drag.startX) / rect.width) * totalTime;
      if (drag.mode === "move") onMoveClip(drag.clipId, drag.startClip.start + dxT);
      else if (drag.mode === "l") {
        const newStart = Math.max(0, drag.startClip.start + dxT);
        const newDur = Math.max(0.1, drag.startClip.dur - (newStart - drag.startClip.start));
        onResizeClip(drag.clipId, newStart, newDur);
      }
      else if (drag.mode === "r") {
        const newDur = Math.max(0.1, drag.startClip.dur + dxT);
        onResizeClip(drag.clipId, drag.startClip.start, newDur);
      }
    };
    const onUp = ()=> setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return ()=>{
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, totalTime, onMoveClip, onResizeClip]);

  // ruler
  const ticks = [];
  const step = totalTime > 8 ? 1 : 0.5;
  for (let t=0; t<=totalTime+0.001; t+=step){
    const left = (t/totalTime)*100;
    ticks.push(
      React.createElement("div", {
        key:t, className:"tick" + (Math.abs(t%1)<0.001?" major":""),
        style:{left: left+"%"}
      }, t.toFixed( step<1 ? 1 : 0 ))
    );
  }

  return React.createElement("div", { className:"timeline" },
    React.createElement("div", { className:"tl-ruler" },
      React.createElement("div", { className:"gutter" }, `Round ${roundIdx+1}`),
      React.createElement("div", { className:"ticks" }, ticks)
    ),
    React.createElement("div", { className:"tl-tracks", ref: trackRef },
      tokens.length === 0 && React.createElement("div", {
        className:"tl-add-track"
      }, "Drag tokens onto the map to add tracks…"),

      tokens.map(t => {
        const tClips = clips.filter(c => c.tokenId === t.id);
        const sprite = sprites[t.spriteId];
        return React.createElement("div", {
          key: t.id,
          className: "tl-track" + (t.id===selectedTokenId?" sel":""),
          onClick: () => onSelectToken(t.id)
        },
          React.createElement("div", { className:"name" },
            React.createElement("span", {
              className:"pip",
              style:{ backgroundImage: sprite ? `url("${sprite.src}")` : undefined,
                      background: !sprite ? (t.ringColor||"#888") : undefined }
            }),
            React.createElement("span", { className:"label" }, t.label)
          ),
          React.createElement("div", {
            className:"lane",
            onMouseDown: onTrackMouseDown
          },
            tClips.map(c => {
              const left = (c.start / totalTime) * 100;
              const width = Math.max(2, (c.dur / totalTime) * 100);
              return React.createElement("div", {
                key:c.id,
                className: `tl-clip kind-${c.kind}` + (selectedClipId===c.id?" sel":""),
                style:{ left: left+"%", width: width+"%" },
                onClick: e=>{ e.stopPropagation(); onSelectClip(c.id); },
                onMouseDown: e=>{
                  if (e.target.classList.contains("handle")) return;
                  e.stopPropagation();
                  setDrag({ clipId:c.id, mode:"move", startX:e.clientX, startClip:{...c} });
                }
              },
                React.createElement("div", {
                  className:"handle l",
                  onMouseDown:e=>{ e.stopPropagation(); setDrag({clipId:c.id, mode:"l", startX:e.clientX, startClip:{...c}}); }
                }),
                React.createElement("span", null,
                  c.kind === 'move' ? "MOVE"
                  : c.kind === 'spell' ? (c.spell?.name || "SPELL").toUpperCase()
                  : c.kind === 'attack' ? (c.spell?.name || "ATTACK").toUpperCase()
                  : "WAIT"
                ),
                React.createElement("div", {
                  className:"handle r",
                  onMouseDown:e=>{ e.stopPropagation(); setDrag({clipId:c.id, mode:"r", startX:e.clientX, startClip:{...c}}); }
                })
              );
            })
          )
        );
      }),

      // playhead — absolute inside tl-tracks, spans all tracks
      tokens.length > 0 && React.createElement("div", {
        className:"tl-playhead",
        style:{
          left: `calc(120px + (100% - 120px) * ${Math.min(1, time / Math.max(0.001, totalTime))})`
        }
      })
    )
  );
}

  window.Timeline = Timeline;
})();
