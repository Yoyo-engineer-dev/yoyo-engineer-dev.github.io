// Tavern Crashers — Inspector (right column: Props / Animations / Effects / Map)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function Inspector({ activeTab, setActiveTab,
                     map, sprites,
                     selectedToken, onUpdateToken, onDeleteToken,
                     selectedClip, onUpdateClip, onDeleteClip,
                     selectedSpellId, onSelectSpell,
                     selectedLingerId, onSelectLinger,
                     selectedLingerObjId, lingers, onDeleteLinger,
                     tool, totalTime }){

  // The inspector has an additional "Effects" tab; we auto-switch to it when the
  // user activates the linger tool, but they can also click it directly.
  const tabs = [
    { id:"props",  label:"Props" },
    { id:"spells", label:"Animations" },
    { id:"linger", label:"Effects" },
    { id:"map",    label:"Map" },
  ];

  return React.createElement("div", { className:"inspect" },
    React.createElement("div", { className:"inspect-tabs" },
      tabs.map(t =>
        React.createElement("button", {
          key:t.id, className: activeTab===t.id?"on":"",
          onClick:()=>setActiveTab(t.id)
        }, t.label)
      )
    ),
    React.createElement("div", { className:"inspect-body" },
      activeTab === "props"  && React.createElement(PropsInspector, {
        selectedToken, onUpdateToken, onDeleteToken,
        selectedClip, onUpdateClip, onDeleteClip,
        sprites, tool
      }),
      activeTab === "spells" && React.createElement(window.SpellLibrary, {
        selectedSpellId, onSelect: onSelectSpell
      }),
      activeTab === "linger" && React.createElement(window.LingerLibrary, {
        selectedLingerId, onSelect: onSelectLinger,
        selectedLingerObjId, lingers, onDeleteLinger,
      }),
      activeTab === "map"    && React.createElement(MapInspector, { map })
    )
  );
}

function PropsInspector({ selectedToken, onUpdateToken, onDeleteToken,
                          selectedClip, onUpdateClip, onDeleteClip,
                          sprites, tool }){
  if (selectedClip){
    const c = selectedClip;
    return React.createElement("div", null,
      React.createElement("div", { className:"insp-section" },
        React.createElement("h4", null, "Selected clip"),
        React.createElement("div", { className:"insp-row" }, "Kind",
          React.createElement("b", null, c.kind)),
        c.spell && React.createElement("div", { className:"insp-row" }, "Spell",
          React.createElement("b", null, c.spell.name)),
        React.createElement("div", { className:"insp-row" }, "Start",
          React.createElement("input", {
            type:"number", step:"0.1", min:"0", value:c.start.toFixed(2),
            onChange: e => onUpdateClip(c.id, { start: parseFloat(e.target.value)||0 })
          })),
        React.createElement("div", { className:"insp-row" }, "Dur",
          React.createElement("input", {
            type:"number", step:"0.1", min:"0.1", value:c.dur.toFixed(2),
            onChange: e => onUpdateClip(c.id, { dur: Math.max(0.1, parseFloat(e.target.value)||0.1) })
          })),
        c.kind === 'move' && c.path && React.createElement("div", { className:"insp-row" },
          "Waypoints", React.createElement("b", null, c.path.length)),
      ),
      (c.kind === 'spell' || c.kind === 'attack') && React.createElement("div", { className:"insp-section" },
        React.createElement("h4", null, "Damage"),
        React.createElement("div", { className:"insp-row" }, "Amount",
          React.createElement("input", {
            type:"text", inputMode:"numeric", placeholder:"e.g. 12",
            value: c.damage ?? "",
            onChange: e => onUpdateClip(c.id, { damage: e.target.value })
          })),
        React.createElement("label", { className:"insp-check" },
          React.createElement("input", {
            type:"checkbox", checked: !!c.crit,
            onChange: e => onUpdateClip(c.id, { crit: e.target.checked })
          }),
          React.createElement("span", null, "Critical hit"),
          React.createElement("span", { className:"insp-check-hint" }, "comic punch-through")
        ),
        React.createElement("p", { className:"insp-note" },
          "Flies off the target on impact. Leave blank to hide. Prefix with ",
          React.createElement("b", null, "+"), " for healing (green). ",
          React.createElement("b", null, "Crit"), " uses the bigger explode-and-snap animation.")
      ),
      React.createElement("button", {
        className:"insp-btn danger", onClick:()=>onDeleteClip(c.id)
      }, "Delete clip")
    );
  }

  if (selectedToken){
    const t = selectedToken;
    return React.createElement("div", null,
      React.createElement("div", { className:"insp-section" },
        React.createElement("h4", null, "Token"),
        React.createElement("div", { className:"insp-row" }, "Name",
          React.createElement("input", {
            value:t.label, onChange:e=>onUpdateToken(t.id, { label: e.target.value })
          })),
        React.createElement("div", { className:"insp-row" }, "Sprite",
          React.createElement("select", {
            value: t.spriteId,
            onChange:e=>onUpdateToken(t.id, { spriteId: e.target.value })
          },
            Object.values(sprites).map(s =>
              React.createElement("option", { key:s.id, value:s.id }, s.name))
          )),
        React.createElement("div", { className:"insp-row" }, "Ring",
          React.createElement("input", {
            type:"color", value: t.ringColor || "#ffffff",
            onChange:e=>onUpdateToken(t.id, { ringColor: e.target.value })
          })),
      ),
      React.createElement("div", { className:"insp-section" },
        React.createElement("h4", null, "Stats"),
        React.createElement("div", { className:"insp-row" }, "HP",
          React.createElement("input", {
            type:"number", value: t.hp ?? 0,
            onChange:e=>onUpdateToken(t.id, { hp: parseInt(e.target.value)||0 })
          })),
        React.createElement("div", { className:"insp-row" }, "Max HP",
          React.createElement("input", {
            type:"number", value: t.hpMax ?? 0,
            onChange:e=>onUpdateToken(t.id, { hpMax: parseInt(e.target.value)||0 })
          })),
        React.createElement("div", { className:"insp-row" }, "Position",
          React.createElement("b", null, `${Math.round(t.x)}, ${Math.round(t.y)}`)),
      ),
      React.createElement("button", {
        className:"insp-btn danger", onClick:()=>onDeleteToken(t.id)
      }, "Delete token from map")
    );
  }

  return React.createElement("div", { className:"muted", style:{fontSize:11, lineHeight:1.5} },
    React.createElement("p", null, "Nothing selected."),
    React.createElement("p", null,
      "Try: ",
      React.createElement("b", null, "drag a sprite"), " from the bottom drawer onto the map, then ",
      React.createElement("b", null, "click it"), " to select."),
    React.createElement("div", { className:"divider" }),
    React.createElement("div", { className:"insp-section" },
      React.createElement("h4", null, "Shortcuts"),
      React.createElement("div", { className:"insp-row" }, "V", React.createElement("span",null,"Select tool")),
      React.createElement("div", { className:"insp-row" }, "M", React.createElement("span",null,"Draw movement path")),
      React.createElement("div", { className:"insp-row" }, "S", React.createElement("span",null,"Cast selected spell")),
      React.createElement("div", { className:"insp-row" }, "A", React.createElement("span",null,"Attack (click target)")),
      React.createElement("div", { className:"insp-row" }, "Space", React.createElement("span",null,"Play / pause")),
      React.createElement("div", { className:"insp-row" }, "⌫", React.createElement("span",null,"Delete selection")),
      React.createElement("div", { className:"insp-row" }, "⌘Z", React.createElement("span",null,"Undo")),
    )
  );
}

function MapInspector({ map }){
  if (!map) return null;
  return React.createElement("div", null,
    React.createElement("div", { className:"insp-section" },
      React.createElement("h4", null, "Map"),
      React.createElement("div", { className:"insp-row" }, "Name", React.createElement("b", null, map.name)),
      React.createElement("div", { className:"insp-row" }, "Size", React.createElement("b", null, `${map.width}×${map.height}`)),
      React.createElement("div", { className:"insp-row" }, "Tokens", React.createElement("b", null, map.tokens.length)),
      React.createElement("div", { className:"insp-row" }, "Rounds", React.createElement("b", null, map.rounds.length)),
    ),
    React.createElement("div", { className:"insp-section" },
      React.createElement("h4", null, "Layers (rounds)"),
      map.rounds.map((r, i) =>
        React.createElement("div", { key:r.id, className:"insp-row" },
          `R${i+1}`,
          React.createElement("span", null, `${r.clips.length} clips`)
        )
      )
    )
  );
}

  window.Inspector = Inspector;
})();
