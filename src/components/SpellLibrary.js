// Tavern Crashers — Spell library (searchable, school-filtered)
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

function SpellLibrary({ selectedSpellId, onSelect }){
  const [q, setQ] = useState("");
  const [filterSchool, setFilterSchool] = useState(null);

  const filtered = useMemo(()=>{
    const ql = q.trim().toLowerCase();
    return window.SPELLS.filter(s=>{
      if (filterSchool && s.school !== filterSchool) return false;
      if (!ql) return true;
      return s.name.toLowerCase().includes(ql)
        || s.school.toLowerCase().includes(ql)
        || (s.dmg && s.dmg.toLowerCase().includes(ql))
        || (s.vfx && s.vfx.toLowerCase().includes(ql))
        || ("l"+s.lvl).includes(ql);
    });
  }, [q, filterSchool]);

  const schools = Object.keys(window.SCHOOLS);

  return React.createElement("div", { className:"spell-lib" },
    React.createElement("div", { className:"search-row" },
      React.createElement("input", {
        placeholder:`⌕  search ${window.SPELLS.length} spells, dmg, school…`,
        value:q, onChange:e=>setQ(e.target.value), autoFocus:true
      }),
      q && React.createElement("button", {
        className:"insp-btn", style:{width:"auto",padding:"3px 8px",margin:0},
        onClick:()=>setQ("")
      }, "×")
    ),
    React.createElement("div", { className:"school-row" },
      schools.map(s => {
        const c = window.SCHOOLS[s];
        return React.createElement("button", {
          key:s, className:"school-chip" + (filterSchool===s?" on":""),
          style:{ background: filterSchool===s ? c.mid : undefined,
                  borderColor: filterSchool===s ? c.mid : undefined },
          onClick: ()=>setFilterSchool(filterSchool===s?null:s)
        }, s)
      })
    ),
    React.createElement("div", { className:"spell-list" },
      filtered.length===0
        ? React.createElement("div", { className:"spell-empty" }, "no matches")
        : filtered.map(s => {
            const sc = window.SCHOOLS[s.school];
            return React.createElement("div", {
              key:s.id,
              className:"spell-row" + (selectedSpellId===s.id?" sel":""),
              onClick:()=>onSelect(s.id),
              title: `${s.name} · ${s.school} · ${s.vfx}\nrange ${s.range}${s.dmg?` · dmg ${s.dmg}`:""}`
            },
              React.createElement("span", {
                className:"swatch",
                style:{ background:`radial-gradient(circle, ${sc.hot}, ${sc.cool})` }
              }),
              React.createElement("span", { className:"nm" }, s.name),
              React.createElement("span", { className:"meta" },
                (s.lvl===0?"cant":"l"+s.lvl), " · ", s.range),
              s.dmg
                ? React.createElement("span", { className:"dmg" }, s.dmg)
                : React.createElement("span", { className:"dmg heal" }, "util")
            );
          })
    )
  );
}

  window.SpellLibrary = SpellLibrary;
})();
