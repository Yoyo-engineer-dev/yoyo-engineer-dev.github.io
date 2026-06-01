// Tavern Crashers — Linger effects library (persistent map effects)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function LingerLibrary({ selectedLingerId, onSelect,
                         selectedLingerObjId, lingers, onDeleteLinger }){
  const effects = window.LINGER_EFFECTS || [];
  return React.createElement("div", { className:"spell-lib" },
    React.createElement("div", { className:"search-row" },
      React.createElement("div", {
        style:{ flex:1, color:"var(--txt-3)", fontSize:11, lineHeight:1.4 }
      }, "Persistent effects — click the ", React.createElement("b",null,"Effects"),
         " tool (E), pick one, then click the map to place. They linger across rounds until deleted.")
    ),
    React.createElement("div", { className:"spell-list" },
      effects.map(eff => {
        const sc = (window.SCHOOLS || {})[eff.school] || window.SCHOOLS?.melee || {hot:"#888",cool:"#222"};
        return React.createElement("div", {
          key: eff.id,
          className:"spell-row" + (selectedLingerId===eff.id?" sel":""),
          onClick: ()=>onSelect(eff.id),
          title: `${eff.name} — radius ${eff.radius}`
        },
          React.createElement("span", {
            className:"swatch",
            style:{ background:`radial-gradient(circle, ${sc.hot}, ${sc.cool})` }
          }),
          React.createElement("span", { className:"nm" }, eff.name),
          React.createElement("span", { className:"meta" }, eff.kind),
          React.createElement("span", { className:"dmg heal" }, eff.radius+"ft")
        );
      })
    ),
    // Placed effects list at the bottom — for deletion
    (lingers && lingers.length > 0) && React.createElement("div", {
      style:{ borderTop:"1px solid var(--line)", padding:"6px 8px", maxHeight:160, overflow:"auto" }
    },
      React.createElement("div", {
        style:{ fontSize:10, textTransform:"uppercase", letterSpacing:".08em",
                color:"var(--txt-3)", marginBottom:4 }
      }, "Placed on map · " + lingers.length),
      lingers.map(l => React.createElement("div", {
        key: l.id,
        style:{
          display:"grid", gridTemplateColumns:"1fr auto",
          alignItems:"center", padding:"3px 4px", fontSize:11,
          background: selectedLingerObjId === l.id ? "var(--bg-3)" : "transparent",
          borderRadius: 3, marginBottom: 2,
        }
      },
        React.createElement("span", null, l.name, " · ",
          React.createElement("span", { style:{color:"var(--txt-3)"} },
            `(${Math.round(l.x)}, ${Math.round(l.y)})`)),
        React.createElement("button", {
          className:"insp-btn danger",
          style:{ width:"auto", padding:"2px 6px", margin:0 },
          onClick:()=>onDeleteLinger(l.id)
        }, "×")
      ))
    )
  );
}

  window.LingerLibrary = LingerLibrary;
})();
