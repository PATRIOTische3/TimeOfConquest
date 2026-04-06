// ══════════════════════════════════════════════════════════
//  TIME & SEASONS
//  Handles the game calendar and season logic.
//  getSeason() was previously missing — defined here.
// ══════════════════════════════════════════════════════════

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
const WEEK_NAMES = ['I','II','III','IV'];

function isLeapYear(y){ return (y%4===0&&y%100!==0)||(y%400===0); }
function daysInMonth(m,y){ return m===1&&isLeapYear(y)?29:MONTH_DAYS[m]; }

// Always 4 ticks per month; last tick of Feb in leap year includes day 29
function weeksInMonth(){ return 4; }

// ── SEASONS ───────────────────────────────────────────────
// Months: 0=Jan … 11=Dec
// Season definitions: incomeMod, moveMod, winterTerrain list
const SEASONS = [
  { name:'Winter', icon:'❄️', months:[11,0,1],
    incomeMod: 0.85,
    moveMod: 0.75,
    winterTerrain: ['mountain','highland','tundra','steppe','forest'],
  },
  { name:'Spring', icon:'🌸', months:[2,3,4],
    incomeMod: 1.00,
    moveMod: 1.00,
    winterTerrain: [],
  },
  { name:'Summer', icon:'☀️', months:[5,6,7],
    incomeMod: 1.10,
    moveMod: 1.00,
    winterTerrain: [],
  },
  { name:'Autumn', icon:'🍂', months:[8,9,10],
    incomeMod: 0.95,
    moveMod: 0.90,
    winterTerrain: ['mountain','highland'],
  },
];

/**
 * Returns the season object for a given month index (0–11).
 * This function was referenced throughout game.js but never defined — fixed here.
 */
function getSeason(month){
  return SEASONS.find(s => s.months.includes(month)) || SEASONS[1];
}

// Shortcut used throughout game logic
var season = () => getSeason(G.month);

// ── CALENDAR ──────────────────────────────────────────────
function weekToDay(week, month, year){
  const days = daysInMonth(month, year);
  return Math.min(days, 1 + Math.floor(week * days / 4));
}

function dateStr(){
  const day = weekToDay(G.week, G.month, G.year);
  return `${day} ${MONTHS[G.month]} ${G.year}`;
}

/**
 * Advance time by one week.
 * Returns true if a new month started.
 */
function advanceWeek(){
  G.tick = (G.tick || 0) + 1;
  G.week++;
  if(G.week >= 4){
    G.week = 0;
    G.month++;
    if(G.month >= 12){ G.month = 0; G.year++; }
    return true;
  }
  return false;
}
