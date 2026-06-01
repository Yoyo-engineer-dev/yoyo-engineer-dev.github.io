// Tavern Crashers — Token drawer (sprite palette, bottom dock)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function TokenDrawer({ sprites, onUploadSprite, onDragSprite }){
  const fileRef = useRef(null);
  return React.createElement("div", { className:"token-drawer" },
    React.createElement("div", { className:"row" },
      Object.values(sprites).map(s =>
        React.createElement("div", {
          key: s.id,
          className:"sprite",
          style:{ backgroundImage:`url("${s.src}")` },
          title:`${s.name}\ndrag onto map to place`,
          onMouseDown: (e)=> onDragSprite(s.id, e)
        },
          React.createElement("span", { className:"nm" }, s.name)
        )
      ),
      React.createElement("div", {
        className:"sprite upload",
        title:"Upload a new token sprite (PNG ideally circular)",
        onClick:()=>fileRef.current?.click()
      }, "＋"),
      React.createElement("input", {
        ref:fileRef, type:"file", accept:"image/*", style:{display:"none"},
        onChange: e=>{
          const f = e.target.files?.[0]; if (!f) return;
          const fr = new FileReader();
          fr.onload = ev => onUploadSprite(f.name.replace(/\.[^.]+$/,""), ev.target.result);
          fr.readAsDataURL(f);
          e.target.value = "";
        }
      })
    )
  );
}

  window.TokenDrawer = TokenDrawer;
})();
