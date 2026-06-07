# Civilization in localStorage — ASCII World Plan

## 1. Core Understanding

This project is a tiny browser-based civilization simulator that lives entirely inside the user's browser storage.

The civilization does not run on a server. It only advances when the user opens the page. When the page loads, it reads the saved world state from `localStorage`, calculates how much real time has passed since the last visit, runs a controlled number of simulation ticks, updates the world, then saves the new state back.

The emotional hook is:

> "A tiny civilization has been living, collapsing, rebuilding, and aging inside your browser while you were away."

This should not feel like a stats dashboard. It should feel like opening an ancient living map.

The site should combine:

- ASCII town/world visuals
- deterministic simulation
- local save state
- archaeology-style storytelling
- visible world changes
- small interactive discoveries

The user should return and think:

> "What happened here since I last opened this?"

---

## 2. Visual Direction

The UI should be inspired by ASCII web-game / ASCII-town aesthetics like:

- hand-built ASCII landscapes
- terminal-like worlds
- old map / simulation interfaces
- tiny civilization dioramas
- text-based game screens

The uploaded reference image shows the right kind of feeling: a wide ASCII landscape with mountains, houses, trees, water, roads, small signs, and environmental density. The project should take that direction, but make it dynamic and procedural.

The site should not rely on external game assets. The ASCII characters are the asset system.

---

## 3. Main Experience

When the user opens the site, they see a large ASCII civilization map.

Above or beside the map, show only essential context:

- civilization name
- current year
- years passed while away
- current age / era
- survival status

Below the map, show a short "While you were away" report.

Example:

```txt
THE ASHROOT KINGDOM — YEAR 12,430

812 years passed while you were away.

[large ASCII world map]

While you were away:
- The city of Varn fell to famine.
- A road formed between Eastmere and Old Hollow.
- The northern forest swallowed the ruins of Durn.
- Ironworking was discovered.
```

The goal is to make the user visually inspect the world, not just read numbers.

---

## 4. UI Layout

Recommended layout:

```txt
┌──────────────────────────────────────────────────────────────┐
│ CIVILIZATION NAME                         YEAR 12,430        │
│ Last opened: 8 days ago                   812 years passed   │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                  LARGE ASCII WORLD MAP                       │
│                                                              │
├───────────────────────────────┬──────────────────────────────┤
│ WHILE YOU WERE AWAY           │ SELECTED TILE / PLACE        │
│ - Event 1                     │ Name: Old Varn               │
│ - Event 2                     │ Type: Ruined Town            │
│ - Event 3                     │ Founded: Year 421            │
│ - Event 4                     │ Fell: Year 3812              │
├───────────────────────────────┴──────────────────────────────┤
│ Reset | Advance 100 Years | Export Save | Import Save        │
└──────────────────────────────────────────────────────────────┘
```

The ASCII map should be the hero element. Stats should support the map, not dominate it.

---

## 5. ASCII Asset System

Each world tile should have a visual representation.

Do not use one-letter symbols like this:

```txt
F F H H W W M
```

Use small ASCII blocks instead.

A tile can be represented as a small fixed-size ASCII block, for example:

```txt
5 characters wide × 3 characters tall
```

Example tile blocks:

### Empty Land

```txt
  .  
 . . 
     
```

### Forest

```txt
 /\  
/||\ 
 ||  
```

### Mountain

```txt
 /\  
/  \ 
^^^^ 
```

### River

```txt
~~~~~
 ~~~~
~~~~~
```

### Farm

```txt
/////
/////
/////
```

### Camp

```txt
 /\  
/  \ 
 ||  
```

### Village

```txt
 /\  
/__\ 
 ||  
```

### Town

```txt
/\_/\
|_[]|
 |__|
```

### Capital

```txt
 _|_ 
/___\
|_|_|
```

### Ruins

```txt
_/\_ 
|  _ 
_/_\_
```

### Fire / Disaster

```txt
  ^  
 /!\ 
 !!! 
```

### Road

```txt
-----
  -  
-----
```

This creates a map that feels illustrated while still being pure text.

---

## 6. World Map Design

The world should be a grid of logical tiles.

Example logical tile types:

- empty land
- forest
- mountain
- river
- lake
- farm
- road
- camp
- village
- town
- city
- capital
- ruins
- temple
- wall
- bridge
- burned land

The rendered map is created by converting each logical tile into its ASCII block.

This gives two layers:

1. **Simulation layer** — simple tile data
2. **Visual layer** — ASCII rendering

That separation keeps the simulation manageable while allowing the UI to look rich.

---

## 7. Civilization Progression

Tiles should visibly evolve over time.

Example progression:

```txt
empty land → camp → village → town → city → capital
```

Possible regressions:

```txt
town → abandoned town → ruins → forest
farm → dry field → empty land
forest → burned forest → empty land → forest
```

This is important because the fun comes from visible change.

When the user returns after time away, the map should show evidence of history:

- new towns appeared
- old cities became ruins
- roads connected settlements
- farms expanded
- forests regrew
- rivers flooded land
- fires damaged areas
- temples appeared
- abandoned settlements were swallowed by nature

---

## 8. LocalStorage Save Model

The entire civilization state should be saved locally.

The save should contain:

- world seed
- civilization name
- current year
- last opened timestamp
- map tile data
- settlements
- named places
- resources
- technology level
- event history
- tile histories
- disaster history
- version number for future save migrations

Example conceptual save structure:

```txt
civilization_save = {
  version,
  seed,
  name,
  year,
  lastOpenedAt,
  world,
  settlements,
  resources,
  technology,
  eventLog,
  tileHistory
}
```

The save must stay small enough for localStorage. The world should be compact and avoid storing unnecessary render output.

Store the logical world, not the final ASCII map.

---

## 9. Deterministic Simulation

The simulation should be deterministic.

That means the same seed and same saved state should always produce the same future events.

This matters because:

- the world feels internally consistent
- bugs are easier to reproduce
- exported saves behave predictably
- the project has a stronger simulation identity

Randomness should come from the civilization's seed and current year/tick, not from uncontrolled random calls.

---

## 10. Time Passing System

On page open:

1. Load saved civilization from localStorage.
2. Read `lastOpenedAt`.
3. Compare with current time.
4. Convert elapsed real time into simulation years/ticks.
5. Cap the maximum number of ticks to avoid freezing.
6. Run the simulation.
7. Generate a summary of major events.
8. Save the new state.
9. Render the map.

Example:

```txt
1 real hour = 10 civilization years
1 real day = 240 civilization years
```

The exact ratio can be tuned.

Important: cap huge gaps.

If the user returns after months, do not run millions of ticks. Instead:

- run a reasonable maximum number of detailed ticks
- compress the rest into larger abstract era events
- still show a satisfying history summary

---

## 11. Simulation Systems

The simulation should be simple but expressive.

### Population

Population grows when food, water, and stability are good.

Population falls during:

- famine
- plague
- war
- flood
- fire
- collapse

Population should affect settlement growth.

### Food

Food comes from farms and nearby fertile land.

Too little food causes famine, migration, or collapse.

### Water

Water comes from rivers, lakes, and wells.

Settlements near water should grow more easily.

### Stability

Stability represents social health.

It can be affected by:

- disasters
- overcrowding
- famine
- long golden ages
- technology
- war-like events

Low stability can cause abandonment, collapse, or splinter settlements.

### Technology

Technology should progress slowly.

Possible eras:

- campfire
- farming
- bronze
- iron
- stone roads
- masonry
- navigation
- industry

Technology should affect visuals too.

Example:

- roads appear after road-building
- temples appear after organized religion
- larger towns appear after masonry
- bridges appear after engineering

### Environment

The world should change even without people.

Examples:

- forests spread
- burned land recovers
- rivers flood
- empty land becomes fertile
- ruins decay

---

## 12. Event System

Events are the soul of the project.

Each tick can create small changes, but only important changes should enter the visible event log.

Event types:

- settlement founded
- settlement upgraded
- settlement abandoned
- city collapsed
- famine
- flood
- fire
- plague
- golden age
- technology discovered
- road completed
- temple built
- capital moved
- ruins discovered
- forest reclaimed old land

Example event log:

```txt
Year 842: The village of Merrow was founded beside the river.
Year 1190: Farms spread across the southern plain.
Year 2401: A fire consumed half of Durn.
Year 3912: Old Varn collapsed after famine.
Year 4210: The forest swallowed the ruins of Durn.
```

The event log should be written like a tiny history book, not like system debug output.

Bad:

```txt
population -12, food -8, tile 44 changed
```

Good:

```txt
The harvest failed. Twelve families left Eastmere.
```

---

## 13. Tile Click Interaction

The map should be inspectable.

When the user clicks or hovers a tile, show its story.

Example:

```txt
Old Varn
Type: Ruined Town
Founded: Year 421
Peak: 1,204 people
Fell: Year 3,912
Cause: Famine
Current state: Half-buried ruins under young forest
```

Tile histories make the world feel real.

Not every tile needs deep history. Only important places need it:

- settlements
- ruins
- temples
- capitals
- disaster sites
- bridges
- old roads

---

## 14. Naming System

Generated names are important for personality.

The civilization should generate names for:

- civilization
- settlements
- rivers
- forests
- mountains
- ruins
- eras
- disasters

Examples:

- Ashroot Kingdom
- Eastmere
- Old Varn
- Durn Hollow
- Ember Basin
- The Pale Road
- The Flood of Nine Springs
- The Year of Black Grain

Names make events memorable.

---

## 15. Controls

Keep controls minimal.

Recommended controls:

- **Advance 100 Years** — manually simulate more time
- **Reset Civilization** — start over with a new seed
- **Export Save** — copy/download save data
- **Import Save** — restore save data
- **Rename Civilization** — personalize it
- **Pause Aging** — optional, prevents real-time catch-up

Avoid turning it into a management game. The point is not control. The point is discovery.

---

## 16. First-Time User Flow

When no save exists:

1. Generate a seed.
2. Generate a small world.
3. Place water, mountains, forests, and fertile land.
4. Create one tiny settlement.
5. Name the civilization.
6. Start at year 0 or year 1.
7. Show the first event.

Example:

```txt
Year 1: The first fires were lit beside the river.
```

The first screen should already feel alive.

---

## 17. Returning User Flow

When a save exists:

1. Load the existing civilization.
2. Calculate time away.
3. Simulate years passed.
4. Show a return summary.
5. Highlight changed areas if possible.

Example return message:

```txt
You were gone for 6 days.
1,440 years passed.

The Ashroot Kingdom survived.
Three towns were founded.
One city fell.
The old capital is now ruins.
```

This should be the main addictive loop.

---

## 18. ASCII Rendering Rules

The map should feel dense but readable.

Rules:

- use monospace font
- preserve spacing exactly
- avoid line wrapping
- use horizontal scrolling if needed
- keep map inside a fixed viewport
- allow zoom levels if useful
- avoid too many colors at first
- use subtle colors later if needed

ASCII should be the visual identity, not a fallback.

Possible style options:

### Pure ASCII

Black text on light background or light text on dark background.

### Terminal Mode

Dark background, green/amber/white text.

### Paper Map Mode

Off-white background, dark gray text, like the uploaded reference.

The paper-map look may be more unique and portfolio-friendly.

---

## 19. Fun Details

Small details will make the project memorable.

Possible additions:

- signs inside the ASCII map
- named roads
- tiny monuments
- seasonal text changes
- rare mythical events
- corrupted ancient records
- graves / memorial markers
- old capital marker
- year labels on ruins
- "known history begins here" marker
- civilization motto
- era titles

Example:

```txt
       [OLD VARN]
        _/\_
       /_  \
```

Signs are especially good because they make the ASCII world feel like a place.

---

## 20. MVP Scope

The MVP should be small but complete.

### Required MVP Features

- generate one deterministic world
- save/load from localStorage
- simulate missed time on page open
- render ASCII map
- settlements can grow
- farms can spread
- forests can regrow
- disasters can create ruins
- event log exists
- return summary exists
- reset button exists
- export/import save exists

### Not Needed for MVP

- combat system
- complex economy
- real pathfinding
- multiplayer
- server sync
- authentication
- animated sprites
- heavy controls
- external assets

---

## 21. Implementation Phases

### Phase 1 — Static ASCII World

Goal: prove the visual style.

Build:

- fixed ASCII map renderer
- small tile set
- basic page layout
- header + map + event panel

No simulation yet.

Success condition:

The page already looks cool as a static ASCII civilization map.

---

### Phase 2 — Procedural World Generation

Goal: generate a unique world from a seed.

Build:

- seeded world creation
- terrain distribution
- rivers/water
- forests
- mountains
- initial settlement
- generated names

Success condition:

Refreshing with the same seed gives the same world.

---

### Phase 3 — LocalStorage Save/Load

Goal: make the world persistent.

Build:

- save state
- load state
- reset civilization
- version field
- safe fallback if save is broken

Success condition:

The same civilization returns after closing and reopening the tab.

---

### Phase 4 — Tick Simulation

Goal: make the world change.

Build:

- yearly/tick update loop
- settlement growth
- farm spread
- forest spread
- resource pressure
- simple disasters
- event generation

Success condition:

Advancing 100 years changes the world in visible ways.

---

### Phase 5 — Away-Time Simulation

Goal: make return visits magical.

Build:

- calculate time since last open
- convert real time to civilization years
- simulate missed years
- cap large simulations
- generate return summary

Success condition:

Opening the page after time away shows meaningful changes and a good summary.

---

### Phase 6 — Inspectable History

Goal: make the world feel archaeological.

Build:

- clickable tiles
- named places
- tile history
- settlement founding/fall data
- ruin details

Success condition:

Clicking ruins, towns, and landmarks tells a tiny story.

---

### Phase 7 — Polish

Goal: make it memorable.

Build:

- better ASCII tiles
- signs and labels
- subtle animations
- highlighted changed areas
- better event writing
- export/import save
- responsive layout

Success condition:

The project feels like a complete toy, not a prototype.

---

## 22. The Main Design Rule

Do not make the user read stats to understand what happened.

Make the world itself show history.

Good signs of success:

- user notices a city disappeared
- user sees a new road
- user finds ruins where a village used to be
- user clicks a tile to learn its history
- user wants to reopen the site later

Bad signs:

- the map is just decoration
- the event log is the only interesting part
- the page feels like a dashboard
- nothing visually changes between visits

---

## 23. Final Product Identity

This project is best described as:

> A tiny deterministic ASCII civilization that ages inside your browser.

Or:

> A localStorage archaeology simulator.

Or:

> A living ASCII town that only wakes up when you visit.

The strongest version is not a game with controls. It is a strange little world that makes the browser feel haunted by history.
