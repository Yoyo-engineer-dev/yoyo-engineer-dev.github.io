// D&D 5e spell + weapon reference database (SRD-derived names + classic flavor).
// Each entry has the data needed to render a top-down animation.
//
// vfx types (matched in engine.jsx):
//   projectile     - travels from caster -> target, small core + trail
//   missile-volley - several small projectiles fan from caster -> target
//   ray            - thin fast beam from caster -> target with glow
//   beam           - sustained thick beam from caster -> target
//   bolt           - jagged lightning from caster -> target
//   chain          - bolt that arcs caster -> A -> B -> C
//   aoe-burst      - explosion centered on target point, expands then fades
//   aoe-sustain    - circle that holds and pulses
//   cone           - 60deg wedge from caster facing target
//   line           - rectangle line from caster through target
//   wall           - rectangular wall placed perpendicular to caster->target
//   aura-heal      - golden ring + rising motes around target
//   aura-buff      - colored pulsing ring around target token
//   debuff         - dark wisps drift around target token
//   melee-slash    - caster lurches, arc swing at target, impact flash
//   melee-longsword- caster lurches, wide image-based longsword swing, heavy impact
//   melee-stab     - caster lurches, narrow stab line, impact flash
//   melee-smash    - caster lurches, radial shockwave at impact
//   ranged-shot    - small fast projectile (arrow/bolt) with feather streak
//   vines          - tendrils crawl from caster point to target
//   nature-thorn   - quick whip line w/ thorn particles
//   summon         - circle of runes pulses at point, then "thing" appears
//   teleport       - target token blinks out at A and in at B
//
// schools dictate colors. Anything dmg=null is utility/heal.

window.SPELLS = [
  // ---- FIRE ----
  { id:"fireball",       name:"Fireball",         school:"fire",     lvl:3, range:"150ft", dmg:"8d6",  vfx:"aoe-burst",   radius:20 },
  { id:"burning-hands",  name:"Burning Hands",    school:"fire",     lvl:1, range:"15ft",  dmg:"3d6",  vfx:"cone",        cone:15 },
  { id:"fire-bolt",      name:"Fire Bolt",        school:"fire",     lvl:0, range:"120ft", dmg:"1d10", vfx:"projectile" },
  { id:"scorching-ray",  name:"Scorching Ray",    school:"fire",     lvl:2, range:"120ft", dmg:"3×2d6",vfx:"missile-volley", count:3 },
  { id:"wall-of-fire",   name:"Wall of Fire",     school:"fire",     lvl:4, range:"120ft", dmg:"5d8",  vfx:"wall" },
  { id:"fire-storm",     name:"Fire Storm",       school:"fire",     lvl:7, range:"150ft", dmg:"7d10", vfx:"aoe-sustain", radius:30 },
  { id:"flame-strike",   name:"Flame Strike",     school:"fire",     lvl:5, range:"60ft",  dmg:"4d6+4d6", vfx:"aoe-burst",radius:10 },
  { id:"flaming-sphere", name:"Flaming Sphere",   school:"fire",     lvl:2, range:"60ft",  dmg:"2d6",  vfx:"aoe-sustain", radius:5 },
  { id:"hellish-rebuke", name:"Hellish Rebuke",   school:"fire",     lvl:1, range:"60ft",  dmg:"2d10", vfx:"aura-buff" },
  { id:"produce-flame",  name:"Produce Flame",    school:"fire",     lvl:0, range:"30ft",  dmg:"1d8",  vfx:"projectile" },
  { id:"heat-metal",     name:"Heat Metal",       school:"fire",     lvl:2, range:"60ft",  dmg:"2d8",  vfx:"debuff" },

  // ---- COLD ----
  { id:"cone-of-cold",   name:"Cone of Cold",     school:"cold",     lvl:5, range:"60ft",  dmg:"8d8",  vfx:"cone",        cone:60 },
  { id:"ice-knife",      name:"Ice Knife",        school:"cold",     lvl:1, range:"60ft",  dmg:"1d10", vfx:"projectile" },
  { id:"ray-of-frost",   name:"Ray of Frost",     school:"cold",     lvl:0, range:"60ft",  dmg:"1d8",  vfx:"ray" },
  { id:"frostbite",      name:"Frostbite",        school:"cold",     lvl:0, range:"60ft",  dmg:"1d6",  vfx:"debuff" },
  { id:"sleet-storm",    name:"Sleet Storm",      school:"cold",     lvl:3, range:"150ft", dmg:"—",    vfx:"aoe-sustain", radius:20 },
  { id:"wall-of-ice",    name:"Wall of Ice",      school:"cold",     lvl:6, range:"120ft", dmg:"10d6", vfx:"wall" },
  { id:"ice-storm",      name:"Ice Storm",        school:"cold",     lvl:4, range:"300ft", dmg:"2d8+4d6", vfx:"aoe-burst", radius:20 },
  { id:"snowball-swarm", name:"Snowball Swarm",   school:"cold",     lvl:2, range:"90ft",  dmg:"3d6",  vfx:"aoe-burst",   radius:5 },

  // ---- LIGHTNING / THUNDER ----
  { id:"lightning-bolt", name:"Lightning Bolt",   school:"lightning",lvl:3, range:"100ft", dmg:"8d6",  vfx:"line" },
  { id:"chain-lightning",name:"Chain Lightning",  school:"lightning",lvl:6, range:"150ft", dmg:"10d8", vfx:"chain", chains:3 },
  { id:"shocking-grasp", name:"Shocking Grasp",   school:"lightning",lvl:0, range:"touch", dmg:"1d8",  vfx:"melee-smash" },
  { id:"witch-bolt",     name:"Witch Bolt",       school:"lightning",lvl:1, range:"30ft",  dmg:"1d12", vfx:"beam" },
  { id:"call-lightning", name:"Call Lightning",   school:"lightning",lvl:3, range:"120ft", dmg:"3d10", vfx:"bolt" },
  { id:"thunderwave",    name:"Thunderwave",      school:"lightning",lvl:1, range:"self",  dmg:"2d8",  vfx:"aoe-burst",   radius:15 },
  { id:"thunderclap",    name:"Thunderclap",      school:"lightning",lvl:0, range:"5ft",   dmg:"1d6",  vfx:"aoe-burst",   radius:5 },

  // ---- HOLY / RADIANT ----
  { id:"cure-wounds",    name:"Cure Wounds",      school:"holy",     lvl:1, range:"touch", dmg:null,   vfx:"aura-heal" },
  { id:"healing-word",   name:"Healing Word",     school:"holy",     lvl:1, range:"60ft",  dmg:null,   vfx:"aura-heal" },
  { id:"mass-cure-wounds",name:"Mass Cure Wounds",school:"holy",     lvl:5, range:"60ft",  dmg:null,   vfx:"aoe-sustain", radius:30 },
  { id:"bless",          name:"Bless",            school:"holy",     lvl:1, range:"30ft",  dmg:null,   vfx:"aura-buff" },
  { id:"sacred-flame",   name:"Sacred Flame",     school:"holy",     lvl:0, range:"60ft",  dmg:"1d8",  vfx:"aoe-burst",   radius:3 },
  { id:"guiding-bolt",   name:"Guiding Bolt",     school:"holy",     lvl:1, range:"120ft", dmg:"4d6",  vfx:"projectile" },
  { id:"sunbeam",        name:"Sunbeam",          school:"holy",     lvl:6, range:"60ft line",dmg:"6d8",vfx:"line" },
  { id:"divine-smite",   name:"Divine Smite",     school:"holy",     lvl:1, range:"melee", dmg:"2d8",  vfx:"melee-slash" },
  { id:"spirit-guardians",name:"Spirit Guardians",school:"holy",     lvl:3, range:"15ft self",dmg:"3d8",vfx:"aura-buff" },
  { id:"beacon-of-hope", name:"Beacon of Hope",   school:"holy",     lvl:3, range:"30ft",  dmg:null,   vfx:"aura-buff" },
  { id:"spiritual-weapon",name:"Spiritual Weapon",school:"holy",     lvl:2, range:"60ft",  dmg:"1d8",  vfx:"summon" },

  // ---- NECROTIC ----
  { id:"inflict-wounds", name:"Inflict Wounds",   school:"necrotic", lvl:1, range:"touch", dmg:"3d10", vfx:"melee-stab" },
  { id:"vampiric-touch", name:"Vampiric Touch",   school:"necrotic", lvl:3, range:"self",  dmg:"3d6",  vfx:"beam" },
  { id:"chill-touch",    name:"Chill Touch",      school:"necrotic", lvl:0, range:"120ft", dmg:"1d8",  vfx:"projectile" },
  { id:"ray-of-sickness",name:"Ray of Sickness",  school:"necrotic", lvl:1, range:"60ft",  dmg:"2d8",  vfx:"ray" },
  { id:"blight",         name:"Blight",           school:"necrotic", lvl:4, range:"30ft",  dmg:"8d8",  vfx:"debuff" },
  { id:"circle-of-death",name:"Circle of Death",  school:"necrotic", lvl:6, range:"150ft", dmg:"8d6",  vfx:"aoe-burst",   radius:60 },
  { id:"finger-of-death",name:"Finger of Death",  school:"necrotic", lvl:7, range:"60ft",  dmg:"7d8+30",vfx:"ray" },
  { id:"animate-dead",   name:"Animate Dead",     school:"necrotic", lvl:3, range:"10ft",  dmg:null,   vfx:"summon" },

  // ---- FORCE / ARCANE ----
  { id:"magic-missile",  name:"Magic Missile",    school:"force",    lvl:1, range:"120ft", dmg:"3×1d4+1",vfx:"missile-volley", count:3 },
  { id:"eldritch-blast", name:"Eldritch Blast",   school:"force",    lvl:0, range:"120ft", dmg:"1d10", vfx:"projectile" },
  { id:"shield",         name:"Shield",           school:"force",    lvl:1, range:"self",  dmg:null,   vfx:"aura-buff" },
  { id:"force-wave",     name:"Force Wave",       school:"force",    lvl:5, range:"self",  dmg:"6d6",  vfx:"aoe-burst",   radius:30 },
  { id:"bigbys-hand",    name:"Bigby's Hand",     school:"force",    lvl:5, range:"120ft", dmg:"4d8",  vfx:"summon" },
  { id:"disintegrate",   name:"Disintegrate",     school:"force",    lvl:6, range:"60ft",  dmg:"10d6+40",vfx:"beam" },

  // ---- NATURE / ACID ----
  { id:"acid-splash",    name:"Acid Splash",      school:"acid",     lvl:0, range:"60ft",  dmg:"1d6",  vfx:"projectile" },
  { id:"acid-arrow",     name:"Melf's Acid Arrow",school:"acid",     lvl:2, range:"90ft",  dmg:"4d4",  vfx:"projectile" },
  { id:"vitriolic-sphere",name:"Vitriolic Sphere",school:"acid",     lvl:4, range:"150ft", dmg:"10d4", vfx:"aoe-burst",   radius:20 },
  { id:"entangle",       name:"Entangle",         school:"nature",   lvl:1, range:"90ft",  dmg:null,   vfx:"vines" },
  { id:"thorn-whip",     name:"Thorn Whip",       school:"nature",   lvl:0, range:"30ft",  dmg:"1d6",  vfx:"nature-thorn" },
  { id:"plant-growth",   name:"Plant Growth",     school:"nature",   lvl:3, range:"150ft", dmg:null,   vfx:"aoe-sustain", radius:20 },
  { id:"spike-growth",   name:"Spike Growth",     school:"nature",   lvl:2, range:"150ft", dmg:"2d4",  vfx:"aoe-sustain", radius:20 },
  { id:"conjure-animals",name:"Conjure Animals",  school:"nature",   lvl:3, range:"60ft",  dmg:null,   vfx:"summon" },
  { id:"poison-spray",   name:"Poison Spray",     school:"nature",   lvl:0, range:"10ft",  dmg:"1d12", vfx:"cone",        cone:10 },
  { id:"cloudkill",      name:"Cloudkill",        school:"nature",   lvl:5, range:"500ft", dmg:"5d8",  vfx:"aoe-sustain", radius:20 },

  // ---- PSYCHIC ----
  { id:"vicious-mockery",name:"Vicious Mockery",  school:"psychic",  lvl:0, range:"60ft",  dmg:"1d4",  vfx:"debuff" },
  { id:"phantasmal-force",name:"Phantasmal Force",school:"psychic",  lvl:2, range:"60ft",  dmg:"1d6",  vfx:"debuff" },
  { id:"synaptic-static",name:"Synaptic Static",  school:"psychic",  lvl:5, range:"120ft", dmg:"8d6",  vfx:"aoe-burst",   radius:20 },
  { id:"mind-spike",     name:"Mind Spike",       school:"psychic",  lvl:2, range:"60ft",  dmg:"3d8",  vfx:"ray" },
  { id:"crown-of-madness",name:"Crown of Madness",school:"psychic",  lvl:2, range:"120ft", dmg:null,   vfx:"aura-buff" },

  // ---- MELEE WEAPONS ----
  { id:"greatsword",     name:"Greatsword Slash", school:"melee",    lvl:0, range:"5ft",   dmg:"2d6",  vfx:"melee-slash" },
  { id:"longsword",      name:"Longsword Slash",  school:"melee",    lvl:0, range:"5ft",   dmg:"1d8",  vfx:"melee-slash" },
  { id:"longsword-ornate",name:"Ornate Longsword", school:"melee",   lvl:0, range:"5ft",   dmg:"1d8",  vfx:"melee-longsword" },
  { id:"shortsword",     name:"Shortsword Stab",  school:"melee",    lvl:0, range:"5ft",   dmg:"1d6",  vfx:"melee-stab" },
  { id:"rapier",         name:"Rapier Lunge",     school:"melee",    lvl:0, range:"5ft",   dmg:"1d8",  vfx:"melee-stab" },
  { id:"dagger",         name:"Dagger Stab",      school:"melee",    lvl:0, range:"5ft",   dmg:"1d4",  vfx:"melee-stab" },
  { id:"battleaxe",      name:"Battleaxe Swing",  school:"melee",    lvl:0, range:"5ft",   dmg:"1d8",  vfx:"melee-slash" },
  { id:"warhammer",      name:"Warhammer Smash",  school:"melee",    lvl:0, range:"5ft",   dmg:"1d8",  vfx:"melee-smash" },
  { id:"mace",           name:"Mace Bash",        school:"melee",    lvl:0, range:"5ft",   dmg:"1d6",  vfx:"melee-smash" },
  { id:"glaive",         name:"Glaive Sweep",     school:"melee",    lvl:0, range:"10ft",  dmg:"1d10", vfx:"melee-slash" },
  { id:"pike",           name:"Pike Thrust",      school:"melee",    lvl:0, range:"10ft",  dmg:"1d10", vfx:"melee-stab" },
  { id:"quarterstaff",   name:"Quarterstaff",     school:"melee",    lvl:0, range:"5ft",   dmg:"1d6",  vfx:"melee-smash" },
  { id:"unarmed",        name:"Unarmed Strike",   school:"melee",    lvl:0, range:"5ft",   dmg:"1+STR",vfx:"melee-unarmed" },
  { id:"sneak-attack",   name:"Sneak Attack",     school:"melee",    lvl:0, range:"5ft",   dmg:"+1d6", vfx:"melee-stab" },

  // ---- RANGED WEAPONS ----
  { id:"longbow",        name:"Longbow Shot",     school:"ranged",   lvl:0, range:"150ft", dmg:"1d8",  vfx:"ranged-shot" },
  { id:"shortbow",       name:"Shortbow Shot",    school:"ranged",   lvl:0, range:"80ft",  dmg:"1d6",  vfx:"ranged-shot" },
  { id:"heavy-crossbow", name:"Heavy Crossbow",   school:"ranged",   lvl:0, range:"100ft", dmg:"1d10", vfx:"ranged-shot" },
  { id:"hand-crossbow",  name:"Hand Crossbow",    school:"ranged",   lvl:0, range:"30ft",  dmg:"1d6",  vfx:"ranged-shot" },
  { id:"sling",          name:"Sling Stone",      school:"ranged",   lvl:0, range:"30ft",  dmg:"1d4",  vfx:"projectile" },
  { id:"throwing-dagger",name:"Throwing Dagger",  school:"ranged",   lvl:0, range:"20ft",  dmg:"1d4",  vfx:"ranged-shot" },
  { id:"javelin",        name:"Javelin Throw",    school:"ranged",   lvl:0, range:"30ft",  dmg:"1d6",  vfx:"ranged-shot" },
  { id:"handaxe-throw",  name:"Handaxe Throw",    school:"ranged",   lvl:0, range:"20ft",  dmg:"1d6",  vfx:"ranged-shot" },

  // ---- UTILITY ----
  { id:"misty-step",     name:"Misty Step",       school:"utility",  lvl:2, range:"30ft",  dmg:null,   vfx:"teleport" },
  { id:"dimension-door", name:"Dimension Door",   school:"utility",  lvl:4, range:"500ft", dmg:null,   vfx:"teleport" },
  { id:"fog-cloud",      name:"Fog Cloud",        school:"utility",  lvl:1, range:"120ft", dmg:null,   vfx:"aoe-sustain", radius:20 },
  { id:"darkness",       name:"Darkness",         school:"utility",  lvl:2, range:"60ft",  dmg:null,   vfx:"aoe-sustain", radius:15 },
  { id:"silence",        name:"Silence",          school:"utility",  lvl:2, range:"120ft", dmg:null,   vfx:"aoe-sustain", radius:20 },
  { id:"invisibility",   name:"Invisibility",     school:"utility",  lvl:2, range:"touch", dmg:null,   vfx:"aura-buff" },
  { id:"haste",          name:"Haste",            school:"utility",  lvl:3, range:"30ft",  dmg:null,   vfx:"aura-buff" },
  { id:"slow",           name:"Slow",             school:"utility",  lvl:3, range:"120ft", dmg:null,   vfx:"debuff" },
  // ---- DEATHS (animations that remove the token) ----
  { id:"death-shatter",      name:"Shatter",      school:"death", lvl:0, range:"target", dmg:null, vfx:"death-shatter" },
  { id:"death-burn",         name:"Burn to Ash",   school:"death", lvl:0, range:"target", dmg:null, vfx:"death-burn" },
  { id:"death-disintegrate", name:"Disintegrate",  school:"death", lvl:0, range:"target", dmg:null, vfx:"death-disintegrate" },
  { id:"death-melt",         name:"Melt",          school:"death", lvl:0, range:"target", dmg:null, vfx:"death-melt" },
  { id:"death-evaporate",    name:"Evaporate",     school:"death", lvl:0, range:"target", dmg:null, vfx:"death-evaporate" },
  { id:"death-vanish",       name:"Vanish",        school:"death", lvl:0, range:"target", dmg:null, vfx:"death-vanish" },
  { id:"death-petrify",      name:"Petrify & Crumble", school:"death", lvl:0, range:"target", dmg:null, vfx:"death-petrify" },
  { id:"death-frost",        name:"Freeze & Shatter", school:"death", lvl:0, range:"target", dmg:null, vfx:"death-frost" },
];

// Per-school color palette used by the renderer.
window.SCHOOLS = {
  fire:      { hot:"#ff7a2e", mid:"#ffb84a", cool:"#5a1c00", label:"Fire" },
  cold:      { hot:"#bcdcff", mid:"#7ec0ff", cool:"#1f4a86", label:"Cold" },
  lightning: { hot:"#ffffff", mid:"#9ad6ff", cool:"#3a6ad2", label:"Lightning" },
  holy:      { hot:"#fff4b8", mid:"#ffd56a", cool:"#a3711c", label:"Holy" },
  necrotic:  { hot:"#c594d2", mid:"#7b3d96", cool:"#1d0830", label:"Necrotic" },
  force:     { hot:"#ffffff", mid:"#bca6ff", cool:"#3c2ea8", label:"Force" },
  acid:      { hot:"#d2f56a", mid:"#7eb433", cool:"#2c4708", label:"Acid" },
  nature:    { hot:"#bce0a0", mid:"#5a9c46", cool:"#1f3e10", label:"Nature" },
  psychic:   { hot:"#ffc3f0", mid:"#d162c0", cool:"#4a1356", label:"Psychic" },
  melee:     { hot:"#ffe4b0", mid:"#d4b27a", cool:"#3a2b1a", label:"Melee" },
  ranged:    { hot:"#d6c7a0", mid:"#a08856", cool:"#2e2410", label:"Ranged" },
  utility:   { hot:"#e0e0f0", mid:"#9aa3b8", cool:"#2a2f3d", label:"Utility" },
  death:     { hot:"#ff6680", mid:"#a02842", cool:"#2a0612", label:"Death" },
};
