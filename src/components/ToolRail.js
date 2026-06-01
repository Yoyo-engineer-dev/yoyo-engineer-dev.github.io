// Tavern Crashers — Left tool rail (+ linger effect sublist)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TOOLS = [
  { id:"select", label:"Select", key:"V", svg:'<path d="M3 2l11 7-5 1-1 6z" fill="currentColor"/>' },
  { id:"path",   label:"Path",   key:"M", svg:'<path d="M3 14c2-6 6-10 14-10" stroke="currentColor" stroke-width="2.5" fill="none" stroke-dasharray="3 3"/><circle cx="3" cy="14" r="2" fill="currentColor"/><circle cx="17" cy="4" r="2" fill="currentColor"/>' },
  { id:"spell",  label:"Spell",  key:"S", svg:'<path d="M10 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="currentColor"/>' },
  { id:"attack", label:"Attack", key:"A", svg:'<path d="M4 16l8-12 2 2-8 12zm10-3l-2 2 2 2 2-2z" fill="currentColor"/>' },
  { id:"aoe",    label:"AOE",    key:"O", svg:'<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" fill="none"/><circle cx="10" cy="10" r="2" fill="currentColor"/>' },
  { id:"linger", label:"Effects",key:"E", svg:'<path d="M10 2c-2 4 1 5-1 8s-3 2-3 5a4 4 0 0 0 8 0c0-3-2-3-2-6s2-3 0-7zM7 14a3 3 0 0 0 6 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id:"note",   label:"Note",   key:"N", svg:'<rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M6 8h8M6 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
];

function ToolRail({ tool, setTool, onUndo, onDeleteSelected,
                    selectedLingerId, onSelectLinger }){
  return React.createElement("div", { className:"tools" },
    TOOLS.map(t =>
      React.createElement("button", {
        key:t.id, className:"tool-btn" + (tool===t.id?" on":""),
        onClick:()=>setTool(t.id),
        title:`${t.label} (${t.key})`
      },
        React.createElement("span", { className:"kbd" }, t.key),
        React.createElement("svg", { viewBox:"0 0 20 20", dangerouslySetInnerHTML:{__html:t.svg} }),
        React.createElement("span", null, t.label)
      )
    ),
    React.createElement("div", { className:"sep" }),
    React.createElement("button", {
      className:"tool-btn", title:"Undo (⌘Z)", onClick:onUndo
    },
      React.createElement("svg", { viewBox:"0 0 20 20",
        dangerouslySetInnerHTML:{__html:'<path d="M4 10c2-4 6-6 10-4M4 10l3-3M4 10l3 3" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'} }),
      React.createElement("span", null, "Undo")
    ),
    React.createElement("button", {
      className:"tool-btn", title:"Delete selected (⌫)", onClick:onDeleteSelected
    },
      React.createElement("svg", { viewBox:"0 0 20 20",
        dangerouslySetInnerHTML:{__html:'<path d="M5 6h10v10a2 2 0 01-2 2H7a2 2 0 01-2-2V6zm3-3h4v3M3 6h14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'} }),
      React.createElement("span", null, "Delete")
    ),
    // ---- Linger effects sublist: visible whenever the Linger tool is active.
    tool === "linger" && React.createElement("div", { className:"linger-list" },
      React.createElement("div", { className:"linger-list-head" }, "Effects"),
      (window.LINGER_EFFECTS || []).map(eff => {
        const sc = (window.SCHOOLS || {})[eff.school] || { hot:"#888", mid:"#555", cool:"#222" };
        return React.createElement("button", {
          key: eff.id,
          className: "linger-item" + (selectedLingerId===eff.id?" on":""),
          onClick: () => onSelectLinger?.(eff.id),
          title: `Place ${eff.name} on map`,
        },
          React.createElement("span", {
            className:"linger-swatch",
            style:{ background:`radial-gradient(circle, ${sc.hot}, ${sc.cool})` }
          }),
          React.createElement("span", { className:"linger-name" }, eff.name)
        );
      })
    )
  );
}

  window.ToolRail = ToolRail;
})();
