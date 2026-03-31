// ═══════════════════════════════════════════════════════
// ToC Map Editor — Full Export
// Project : example
// Date    : 2026-03-31
// Grid    : 15 × 15 (hex R=18px)
// Stats   : 8 provinces · 4 nations · 3 sea zones · 61 land hexes
// ═══════════════════════════════════════════════════════

// ── Provinces ───────────────────────────────────────────
const PROVINCES = [
  {
    "id": 0,
    "name": "example1",
    "short": "example",
    "cx": 302.8,
    "cy": 54.8,
    "terrain": "forest",
    "hexCount": 11,
    "nation": 0,
    "isCapital": true,
    "isCoastal": true,
    "pop": 59000,
    "res": {
      "oil": 1,
      "coal": 1
    },
    "terrainMap": {
      "plains": 5,
      "forest": 6
    }
  },
  {
    "id": 1,
    "name": "example2",
    "short": "example",
    "cx": 258.5,
    "cy": 164.6,
    "terrain": "plains",
    "hexCount": 7,
    "nation": 0,
    "isCoastal": true,
    "pop": 20000,
    "res": {
      "coal": 1,
      "iron": 1
    },
    "terrainMap": {
      "plains": 4,
      "desert": 3
    }
  },
  {
    "id": 2,
    "name": "example3",
    "short": "example",
    "cx": 194.7,
    "cy": 126,
    "terrain": "desert",
    "hexCount": 9,
    "nation": 1,
    "isCapital": true,
    "isCoastal": true,
    "pop": 54000,
    "res": {
      "oil": 1,
      "iron": 1
    },
    "terrainMap": {
      "hills": 2,
      "plains": 1,
      "desert": 4,
      "jungle": 2
    }
  },
  {
    "id": 3,
    "name": "example4",
    "short": "example",
    "cx": 136.9,
    "cy": 48.4,
    "terrain": "highland",
    "hexCount": 8,
    "nation": 1,
    "isCoastal": true,
    "pop": 20000,
    "res": {
      "coal": 1,
      "iron": 1
    },
    "terrainMap": {
      "hills": 1,
      "highland": 4,
      "mountain": 2,
      "jungle": 1
    }
  },
  {
    "id": 4,
    "name": "example5",
    "short": "example",
    "cx": 218.9,
    "cy": 54,
    "terrain": "hills",
    "hexCount": 9,
    "nation": 1,
    "pop": 20000,
    "res": {
      "coal": 1,
      "iron": 1
    },
    "terrainMap": {
      "hills": 3,
      "mountain": 3,
      "plains": 3
    }
  },
  {
    "id": 5,
    "name": "example6",
    "short": "example",
    "cx": 222.9,
    "cy": 357.4,
    "terrain": "steppe",
    "hexCount": 7,
    "nation": 2,
    "isCapital": true,
    "isCoastal": true,
    "pop": 59000,
    "res": {
      "iron": 1
    },
    "terrainMap": {
      "steppe": 3,
      "farmland": 2,
      "savanna": 1,
      "plains": 1
    }
  },
  {
    "id": 6,
    "name": "example7",
    "short": "example",
    "cx": 153.1,
    "cy": 384,
    "terrain": "steppe",
    "hexCount": 9,
    "nation": 2,
    "isCoastal": true,
    "pop": 4000,
    "res": {
      "oil": 1,
      "coal": 1,
      "iron": 1
    },
    "terrainMap": {
      "steppe": 4,
      "hills": 2,
      "savanna": 3
    }
  },
  {
    "id": 7,
    "name": "example8",
    "short": "example",
    "cx": 407.7,
    "cy": 99,
    "terrain": "mountain",
    "hexCount": 1,
    "nation": 3,
    "isCapital": true,
    "isCoastal": true,
    "pop": 6000
  }
];

// ── Province adjacency (NB[i] = array of neighbour province indices) ──
const NB = [[4,1],[0,2,4],[1,3,4],[2,4],[0,1,2,3],[6],[5],[]];

// ── Nations ─────────────────────────────────────────────
const NATIONS = [
  {
    "id": 0,
    "name": "blue",
    "short": "blue",
    "color": "#102457",
    "ideology": "nationalism",
    "capital": 0
  },
  {
    "id": 1,
    "name": "red",
    "short": "red",
    "color": "#d73920",
    "ideology": "monarchy",
    "capital": 2
  },
  {
    "id": 2,
    "name": "green",
    "short": "green",
    "color": "#206820",
    "ideology": "socialdem",
    "capital": 5
  },
  {
    "id": 3,
    "name": "yellow",
    "short": "yellow",
    "color": "#ffcb13",
    "ideology": "monarchy",
    "capital": 7
  }
];

// ── Sea zones (for map labels) ───────────────────────────
const SEA_ZONES = [
  {
    "id": 0,
    "name": "SEA1",
    "cx": 80.4,
    "cy": 105.8,
    "hexCount": 24,
    "fontSize": 7
  },
  {
    "id": 1,
    "name": "SEA2",
    "cx": 351.9,
    "cy": 123.8,
    "hexCount": 24,
    "fontSize": 12
  },
  {
    "id": 2,
    "name": "OCEAN",
    "cx": 257.5,
    "cy": 282.1,
    "hexCount": 129,
    "fontSize": 24
  }
];

// ── Raw hex grid (r=row, c=col, t=terrain, sea=1/0, p=provinceIdx or -1) ──
const HEX_GRID = {"cols":15,"rows":15,"hexR":18,"hexes":[{"r":0,"c":0,"t":"plains","sea":1,"p":-1},{"r":0,"c":1,"t":"plains","sea":1,"p":-1},{"r":0,"c":2,"t":"plains","sea":1,"p":-1},{"r":0,"c":3,"t":"highland","sea":0,"p":3},{"r":0,"c":4,"t":"mountain","sea":0,"p":3},{"r":0,"c":5,"t":"mountain","sea":0,"p":3},{"r":0,"c":6,"t":"mountain","sea":0,"p":4},{"r":0,"c":7,"t":"hills","sea":0,"p":4},{"r":0,"c":8,"t":"plains","sea":0,"p":0},{"r":0,"c":9,"t":"forest","sea":0,"p":0},{"r":0,"c":10,"t":"forest","sea":0,"p":0},{"r":0,"c":11,"t":"plains","sea":1,"p":-1},{"r":0,"c":12,"t":"plains","sea":1,"p":-1},{"r":0,"c":13,"t":"plains","sea":1,"p":-1},{"r":0,"c":14,"t":"plains","sea":1,"p":-1},{"r":1,"c":0,"t":"plains","sea":1,"p":-1},{"r":1,"c":1,"t":"plains","sea":1,"p":-1},{"r":1,"c":2,"t":"plains","sea":1,"p":-1},{"r":1,"c":3,"t":"highland","sea":0,"p":3},{"r":1,"c":4,"t":"highland","sea":0,"p":3},{"r":1,"c":5,"t":"mountain","sea":0,"p":4},{"r":1,"c":6,"t":"hills","sea":0,"p":4},{"r":1,"c":7,"t":"plains","sea":0,"p":4},{"r":1,"c":8,"t":"plains","sea":0,"p":0},{"r":1,"c":9,"t":"forest","sea":0,"p":0},{"r":1,"c":10,"t":"forest","sea":0,"p":0},{"r":1,"c":11,"t":"plains","sea":1,"p":-1},{"r":1,"c":12,"t":"plains","sea":1,"p":-1},{"r":1,"c":13,"t":"plains","sea":1,"p":-1},{"r":1,"c":14,"t":"plains","sea":1,"p":-1},{"r":2,"c":0,"t":"plains","sea":1,"p":-1},{"r":2,"c":1,"t":"plains","sea":1,"p":-1},{"r":2,"c":2,"t":"plains","sea":1,"p":-1},{"r":2,"c":3,"t":"jungle","sea":0,"p":3},{"r":2,"c":4,"t":"highland","sea":0,"p":3},{"r":2,"c":5,"t":"mountain","sea":0,"p":4},{"r":2,"c":6,"t":"hills","sea":0,"p":4},{"r":2,"c":7,"t":"plains","sea":0,"p":4},{"r":2,"c":8,"t":"plains","sea":0,"p":0},{"r":2,"c":9,"t":"plains","sea":0,"p":0},{"r":2,"c":10,"t":"forest","sea":0,"p":0},{"r":2,"c":11,"t":"plains","sea":1,"p":-1},{"r":2,"c":12,"t":"plains","sea":1,"p":-1},{"r":2,"c":13,"t":"plains","sea":1,"p":-1},{"r":2,"c":14,"t":"plains","sea":1,"p":-1},{"r":3,"c":0,"t":"plains","sea":1,"p":-1},{"r":3,"c":1,"t":"plains","sea":1,"p":-1},{"r":3,"c":2,"t":"plains","sea":1,"p":-1},{"r":3,"c":3,"t":"hills","sea":0,"p":3},{"r":3,"c":4,"t":"hills","sea":0,"p":2},{"r":3,"c":5,"t":"hills","sea":0,"p":2},{"r":3,"c":6,"t":"plains","sea":0,"p":2},{"r":3,"c":7,"t":"plains","sea":0,"p":4},{"r":3,"c":8,"t":"plains","sea":0,"p":0},{"r":3,"c":9,"t":"forest","sea":0,"p":0},{"r":3,"c":10,"t":"plains","sea":1,"p":-1},{"r":3,"c":11,"t":"plains","sea":1,"p":-1},{"r":3,"c":12,"t":"mountain","sea":0,"p":7},{"r":3,"c":13,"t":"plains","sea":1,"p":-1},{"r":3,"c":14,"t":"plains","sea":1,"p":-1},{"r":4,"c":0,"t":"plains","sea":1,"p":-1},{"r":4,"c":1,"t":"plains","sea":1,"p":-1},{"r":4,"c":2,"t":"plains","sea":1,"p":-1},{"r":4,"c":3,"t":"plains","sea":1,"p":-1},{"r":4,"c":4,"t":"plains","sea":1,"p":-1},{"r":4,"c":5,"t":"jungle","sea":0,"p":2},{"r":4,"c":6,"t":"desert","sea":0,"p":2},{"r":4,"c":7,"t":"desert","sea":0,"p":2},{"r":4,"c":8,"t":"plains","sea":0,"p":1},{"r":4,"c":9,"t":"plains","sea":0,"p":1},{"r":4,"c":10,"t":"plains","sea":1,"p":-1},{"r":4,"c":11,"t":"plains","sea":1,"p":-1},{"r":4,"c":12,"t":"plains","sea":1,"p":-1},{"r":4,"c":13,"t":"plains","sea":1,"p":-1},{"r":4,"c":14,"t":"plains","sea":1,"p":-1},{"r":5,"c":0,"t":"plains","sea":1,"p":-1},{"r":5,"c":1,"t":"plains","sea":1,"p":-1},{"r":5,"c":2,"t":"plains","sea":1,"p":-1},{"r":5,"c":3,"t":"plains","sea":1,"p":-1},{"r":5,"c":4,"t":"jungle","sea":0,"p":2},{"r":5,"c":5,"t":"desert","sea":0,"p":2},{"r":5,"c":6,"t":"desert","sea":0,"p":2},{"r":5,"c":7,"t":"desert","sea":0,"p":1},{"r":5,"c":8,"t":"plains","sea":0,"p":1},{"r":5,"c":9,"t":"plains","sea":1,"p":-1},{"r":5,"c":10,"t":"plains","sea":1,"p":-1},{"r":5,"c":11,"t":"plains","sea":1,"p":-1},{"r":5,"c":12,"t":"plains","sea":1,"p":-1},{"r":5,"c":13,"t":"plains","sea":1,"p":-1},{"r":5,"c":14,"t":"plains","sea":1,"p":-1},{"r":6,"c":0,"t":"plains","sea":1,"p":-1},{"r":6,"c":1,"t":"plains","sea":1,"p":-1},{"r":6,"c":2,"t":"plains","sea":1,"p":-1},{"r":6,"c":3,"t":"plains","sea":1,"p":-1},{"r":6,"c":4,"t":"plains","sea":1,"p":-1},{"r":6,"c":5,"t":"plains","sea":1,"p":-1},{"r":6,"c":6,"t":"desert","sea":0,"p":1},{"r":6,"c":7,"t":"desert","sea":0,"p":1},{"r":6,"c":8,"t":"plains","sea":1,"p":-1},{"r":6,"c":9,"t":"plains","sea":1,"p":-1},{"r":6,"c":10,"t":"plains","sea":1,"p":-1},{"r":6,"c":11,"t":"plains","sea":1,"p":-1},{"r":6,"c":12,"t":"plains","sea":1,"p":-1},{"r":6,"c":13,"t":"plains","sea":1,"p":-1},{"r":6,"c":14,"t":"plains","sea":1,"p":-1},{"r":7,"c":0,"t":"plains","sea":1,"p":-1},{"r":7,"c":1,"t":"plains","sea":1,"p":-1},{"r":7,"c":2,"t":"plains","sea":1,"p":-1},{"r":7,"c":3,"t":"plains","sea":1,"p":-1},{"r":7,"c":4,"t":"plains","sea":1,"p":-1},{"r":7,"c":5,"t":"plains","sea":1,"p":-1},{"r":7,"c":6,"t":"plains","sea":1,"p":-1},{"r":7,"c":7,"t":"plains","sea":1,"p":-1},{"r":7,"c":8,"t":"plains","sea":1,"p":-1},{"r":7,"c":9,"t":"plains","sea":1,"p":-1},{"r":7,"c":10,"t":"plains","sea":1,"p":-1},{"r":7,"c":11,"t":"plains","sea":1,"p":-1},{"r":7,"c":12,"t":"plains","sea":1,"p":-1},{"r":7,"c":13,"t":"plains","sea":1,"p":-1},{"r":7,"c":14,"t":"plains","sea":1,"p":-1},{"r":8,"c":0,"t":"plains","sea":1,"p":-1},{"r":8,"c":1,"t":"plains","sea":1,"p":-1},{"r":8,"c":2,"t":"plains","sea":1,"p":-1},{"r":8,"c":3,"t":"plains","sea":1,"p":-1},{"r":8,"c":4,"t":"plains","sea":1,"p":-1},{"r":8,"c":5,"t":"plains","sea":1,"p":-1},{"r":8,"c":6,"t":"plains","sea":1,"p":-1},{"r":8,"c":7,"t":"plains","sea":1,"p":-1},{"r":8,"c":8,"t":"plains","sea":0,"p":1},{"r":8,"c":9,"t":"plains","sea":1,"p":-1},{"r":8,"c":10,"t":"plains","sea":1,"p":-1},{"r":8,"c":11,"t":"plains","sea":1,"p":-1},{"r":8,"c":12,"t":"plains","sea":1,"p":-1},{"r":8,"c":13,"t":"plains","sea":1,"p":-1},{"r":8,"c":14,"t":"plains","sea":1,"p":-1},{"r":9,"c":0,"t":"plains","sea":1,"p":-1},{"r":9,"c":1,"t":"plains","sea":1,"p":-1},{"r":9,"c":2,"t":"plains","sea":1,"p":-1},{"r":9,"c":3,"t":"plains","sea":1,"p":-1},{"r":9,"c":4,"t":"plains","sea":1,"p":-1},{"r":9,"c":5,"t":"plains","sea":1,"p":-1},{"r":9,"c":6,"t":"plains","sea":1,"p":-1},{"r":9,"c":7,"t":"plains","sea":1,"p":-1},{"r":9,"c":8,"t":"plains","sea":1,"p":-1},{"r":9,"c":9,"t":"plains","sea":1,"p":-1},{"r":9,"c":10,"t":"plains","sea":1,"p":-1},{"r":9,"c":11,"t":"plains","sea":1,"p":-1},{"r":9,"c":12,"t":"plains","sea":1,"p":-1},{"r":9,"c":13,"t":"plains","sea":1,"p":-1},{"r":9,"c":14,"t":"plains","sea":1,"p":-1},{"r":10,"c":0,"t":"plains","sea":1,"p":-1},{"r":10,"c":1,"t":"plains","sea":1,"p":-1},{"r":10,"c":2,"t":"plains","sea":1,"p":-1},{"r":10,"c":3,"t":"plains","sea":1,"p":-1},{"r":10,"c":4,"t":"plains","sea":1,"p":-1},{"r":10,"c":5,"t":"plains","sea":1,"p":-1},{"r":10,"c":6,"t":"plains","sea":1,"p":-1},{"r":10,"c":7,"t":"plains","sea":1,"p":-1},{"r":10,"c":8,"t":"plains","sea":1,"p":-1},{"r":10,"c":9,"t":"plains","sea":1,"p":-1},{"r":10,"c":10,"t":"plains","sea":1,"p":-1},{"r":10,"c":11,"t":"plains","sea":1,"p":-1},{"r":10,"c":12,"t":"plains","sea":1,"p":-1},{"r":10,"c":13,"t":"plains","sea":1,"p":-1},{"r":10,"c":14,"t":"plains","sea":1,"p":-1},{"r":11,"c":0,"t":"plains","sea":1,"p":-1},{"r":11,"c":1,"t":"plains","sea":1,"p":-1},{"r":11,"c":2,"t":"plains","sea":1,"p":-1},{"r":11,"c":3,"t":"plains","sea":1,"p":-1},{"r":11,"c":4,"t":"plains","sea":1,"p":-1},{"r":11,"c":5,"t":"plains","sea":1,"p":-1},{"r":11,"c":6,"t":"plains","sea":1,"p":-1},{"r":11,"c":7,"t":"farmland","sea":0,"p":5},{"r":11,"c":8,"t":"plains","sea":1,"p":-1},{"r":11,"c":9,"t":"plains","sea":1,"p":-1},{"r":11,"c":10,"t":"plains","sea":1,"p":-1},{"r":11,"c":11,"t":"plains","sea":1,"p":-1},{"r":11,"c":12,"t":"plains","sea":1,"p":-1},{"r":11,"c":13,"t":"plains","sea":1,"p":-1},{"r":11,"c":14,"t":"plains","sea":1,"p":-1},{"r":12,"c":0,"t":"plains","sea":1,"p":-1},{"r":12,"c":1,"t":"plains","sea":1,"p":-1},{"r":12,"c":2,"t":"plains","sea":1,"p":-1},{"r":12,"c":3,"t":"plains","sea":1,"p":-1},{"r":12,"c":4,"t":"steppe","sea":0,"p":6},{"r":12,"c":5,"t":"plains","sea":0,"p":5},{"r":12,"c":6,"t":"steppe","sea":0,"p":5},{"r":12,"c":7,"t":"plains","sea":1,"p":-1},{"r":12,"c":8,"t":"plains","sea":1,"p":-1},{"r":12,"c":9,"t":"plains","sea":1,"p":-1},{"r":12,"c":10,"t":"plains","sea":1,"p":-1},{"r":12,"c":11,"t":"plains","sea":1,"p":-1},{"r":12,"c":12,"t":"plains","sea":1,"p":-1},{"r":12,"c":13,"t":"plains","sea":1,"p":-1},{"r":12,"c":14,"t":"plains","sea":1,"p":-1},{"r":13,"c":0,"t":"plains","sea":1,"p":-1},{"r":13,"c":1,"t":"plains","sea":1,"p":-1},{"r":13,"c":2,"t":"plains","sea":1,"p":-1},{"r":13,"c":3,"t":"steppe","sea":0,"p":6},{"r":13,"c":4,"t":"steppe","sea":0,"p":6},{"r":13,"c":5,"t":"savanna","sea":0,"p":5},{"r":13,"c":6,"t":"steppe","sea":0,"p":5},{"r":13,"c":7,"t":"farmland","sea":0,"p":5},{"r":13,"c":8,"t":"plains","sea":1,"p":-1},{"r":13,"c":9,"t":"plains","sea":1,"p":-1},{"r":13,"c":10,"t":"plains","sea":1,"p":-1},{"r":13,"c":11,"t":"plains","sea":1,"p":-1},{"r":13,"c":12,"t":"plains","sea":1,"p":-1},{"r":13,"c":13,"t":"plains","sea":1,"p":-1},{"r":13,"c":14,"t":"plains","sea":1,"p":-1},{"r":14,"c":0,"t":"plains","sea":1,"p":-1},{"r":14,"c":1,"t":"plains","sea":1,"p":-1},{"r":14,"c":2,"t":"steppe","sea":0,"p":6},{"r":14,"c":3,"t":"hills","sea":0,"p":6},{"r":14,"c":4,"t":"hills","sea":0,"p":6},{"r":14,"c":5,"t":"savanna","sea":0,"p":6},{"r":14,"c":6,"t":"savanna","sea":0,"p":6},{"r":14,"c":7,"t":"savanna","sea":0,"p":6},{"r":14,"c":8,"t":"steppe","sea":0,"p":5},{"r":14,"c":9,"t":"plains","sea":1,"p":-1},{"r":14,"c":10,"t":"plains","sea":1,"p":-1},{"r":14,"c":11,"t":"plains","sea":1,"p":-1},{"r":14,"c":12,"t":"plains","sea":1,"p":-1},{"r":14,"c":13,"t":"plains","sea":1,"p":-1},{"r":14,"c":14,"t":"plains","sea":1,"p":-1}]};

// ── Helpers ─────────────────────────────────────────────
const LAND = PROVINCES.map((_,i)=>i);
const INIT_ALLIANCES = [];
