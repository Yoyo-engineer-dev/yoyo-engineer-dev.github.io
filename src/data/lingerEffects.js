// Persistent environmental effects placed on the map that linger between rounds
// until manually deleted. Each entry: id, name, kind (used by the renderer),
// school (for color palette), default radius.
window.LINGER_EFFECTS = [
  { id:"fire-patch",   name:"Fire Patch",   kind:"fire",      school:"fire",     radius: 70 },
  { id:"bonfire",      name:"Bonfire",      kind:"bonfire",   school:"fire",     radius: 50 },
  { id:"smoke-cloud",  name:"Smoke Cloud",  kind:"smoke",     school:"utility",  radius: 90 },
  { id:"fog-cloud",    name:"Fog Cloud",    kind:"fog",       school:"cold",     radius: 100 },
  { id:"poison-cloud", name:"Poison Cloud", kind:"poison",    school:"acid",     radius: 90 },
  { id:"ice-patch",    name:"Ice Patch",    kind:"ice",       school:"cold",     radius: 70 },
  { id:"web-area",     name:"Web",          kind:"web",       school:"utility",  radius: 90 },
  { id:"blood-pool",   name:"Blood Pool",   kind:"blood",     school:"necrotic", radius: 50 },
  { id:"scorched",     name:"Scorched",     kind:"scorched",  school:"fire",     radius: 60 },
  { id:"holy-circle",  name:"Holy Circle",  kind:"holy",      school:"holy",     radius: 80 },
  { id:"dark-zone",    name:"Dark Zone",    kind:"dark",      school:"necrotic", radius: 90 },
  { id:"lightning-rune",name:"Lightning Rune",kind:"lightning",school:"lightning",radius: 60 },
];
