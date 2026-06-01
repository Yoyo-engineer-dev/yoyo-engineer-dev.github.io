// Tavern Crashers — Bottom drawer handle (view switch / collapse)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function DrawerHandle({ activeView, setActiveView, collapsed, setCollapsed }){
  return React.createElement("div", { className:"drawer-handle" },
    React.createElement("div", { className:"seg" },
      React.createElement("button", {
        className: activeView==="timeline" ? "on" : "",
        onClick: ()=>{ setActiveView("timeline"); setCollapsed(false); }
      }, "Timeline"),
      React.createElement("button", {
        className: activeView==="tokens"  ? "on" : "",
        onClick: ()=>{ setActiveView("tokens"); setCollapsed(false); }
      }, "Sprites"),
      React.createElement("button", {
        className: activeView==="both" ? "on" : "",
        onClick: ()=>{ setActiveView("both"); setCollapsed(false); }
      }, "Both"),
    ),
    React.createElement("span", { className:"spacer" }),
    React.createElement("span", { style:{color:"var(--txt-3)"} },
      "drag sprites onto map · drag clips horizontally to retime"),
    React.createElement("button", {
      className:"toggle", onClick: ()=>setCollapsed(!collapsed),
      title: collapsed ? "Expand drawer" : "Collapse drawer"
    }, collapsed ? "▲" : "▼")
  );
}

  window.DrawerHandle = DrawerHandle;
})();
