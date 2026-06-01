// Tavern Crashers — Map tabs (top row)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function MapTabs({ maps, activeMapId, onSelect, onClose, onAdd, onRename }){
  return React.createElement("div", { className:"tabs" },
    maps.map(m =>
      React.createElement("div", {
        key: m.id, className: "tab" + (m.id===activeMapId ? " active" : ""),
        onClick: () => onSelect(m.id),
        onDoubleClick: () => {
          const nn = prompt("Rename map", m.name);
          if (nn) onRename(m.id, nn);
        },
        title: "double-click to rename"
      },
        React.createElement("span", { className:"dot" }),
        React.createElement("span", { className:"name" }, m.name),
        React.createElement("span", {
          className:"close",
          onClick:(e)=>{ e.stopPropagation(); if(confirm(`Close "${m.name}"?`)) onClose(m.id); }
        }, "×")
      )
    ),
    React.createElement("button", { className:"tab-add", onClick:onAdd, title:"Upload a map image" }, "＋"),
    React.createElement("div", { className:"brand" },
      React.createElement("b", null, "Tavern Crashers"),
      React.createElement("span", null, "Map Tool · V1.0")
    )
  );
}

  window.MapTabs = MapTabs;
})();
