// Tavern Crashers — Topbar (round nav + transport controls)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function Topbar({ tool, setTool, roundIdx, roundCount, onPrevRound, onNextRound, onAddRound,
                  playing, playMode, setPlayMode, onPlay, onStop, onReset,
                  time, totalTime, speed, setSpeed,
                  cleanMode, setCleanMode,
                  recording, onToggleRecord, onExportFrame, onSeek }){

  const fmt = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s/60), sec = s % 60;
    return `${String(m).padStart(2,"0")}:${sec.toFixed(2).padStart(5,"0")}`;
  };

  return React.createElement("div", { className:"topbar" },
    // Tool segments (also accessible from left rail)
    React.createElement("div", { className:"round-info" },
      React.createElement("button", { onClick:onPrevRound, title:"Previous round" }, "◀"),
      React.createElement("span", null, "Round ",
        React.createElement("span", { className:"num" }, roundIdx+1),
        " / ", roundCount
      ),
      React.createElement("button", { onClick:onNextRound, title:"Next round" }, "▶"),
      React.createElement("button", { onClick:onAddRound, title:"Add new round" }, "＋")
    ),
    React.createElement("div", { className:"seg" },
      React.createElement("button", {
        className: playMode==="round" ? "on" : "",
        onClick: ()=>setPlayMode("round")
      }, "Play round"),
      React.createElement("button", {
        className: playMode==="all" ? "on" : "",
        onClick: ()=>setPlayMode("all")
      }, "Play all"),
    ),

    React.createElement("div", { className:"spacer" }),

    React.createElement("div", { className:"transport" },
      React.createElement("button", { className:"t-btn", title:"Reset to start", onClick:onReset }, "⏮"),
      React.createElement("button", {
        className: "t-btn play" + (playing?" playing":""),
        title:"Play / pause (space)",
        onClick: playing ? onStop : onPlay
      }, playing ? "❚❚" : "▶"),
      React.createElement("button", { className:"t-btn", title:"Step to end", onClick:()=>onSeek(totalTime) }, "⏭"),
      React.createElement("div", { className:"time" }, `${fmt(time)} / ${fmt(totalTime)}`),
      React.createElement("select", {
        className:"speed", value:speed, onChange:e=>setSpeed(parseFloat(e.target.value)),
        title:"Playback speed"
      },
        [0.25,0.5,1,1.5,2,3].map(s =>
          React.createElement("option", { key:s, value:s }, `${s}×`))
      ),
      React.createElement("button", {
        className: "t-btn rec" + (recording?" on":""),
        title: recording ? "Stop recording (saves .webm)" : "Start recording (.webm, then convert in any editor)",
        onClick: onToggleRecord
      }, recording ? "■" : "●"),
      React.createElement("button", { className:"t-btn", title:"Save current frame as PNG", onClick:onExportFrame }, "📷"),
      React.createElement("button", {
        className:"clean-btn", title:"Hide all UI — clean stage for screen recording",
        onClick: ()=>setCleanMode(true)
      }, "Clean mode")
    )
  );
}

  window.Topbar = Topbar;
})();
