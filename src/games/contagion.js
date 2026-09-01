import { BaseGame } from '../core/game.js';

/**
 * CONTAGION — start an illness, end a world
 *
 * You are the disease. One country, one cluster of cases, and a genome you get
 * to write while the world works out what you are. Infect everybody, kill
 * everybody, and do it before the cure lands.
 *
 * The whole genre lives in one tension: every gene that makes you *spread*
 * also makes you *noticeable*, and being noticed starts the clock you cannot
 * stop. So the game is not "buy the best upgrades" — it is "stay boring for as
 * long as you can afford to". A player who evolves haemorrhaging on day thirty
 * has a terrifying disease in four countries and a cure at 40%.
 *
 * The model
 * ---------
 * Three decisions carry it.
 *
 * **The world is a string.** The map is eighteen lines of ASCII, one character
 * per cell, the letter naming the region. Centroids, outlines and the click
 * targets are all derived from it at setup, which means the map is editable by
 * anyone who can type and there is no coordinate data to keep in sync with the
 * art. The chunky cells that fall out of it are also the honest rendering: a
 * region is a *population*, not a shape, and painting it as blocks that fill
 * with red says that better than a smooth border would.
 *
 * **The simulation runs per day, not per tick.** Everything epidemiological
 * happens once a game-day ({@link DAY_SECONDS} of real time); `update` only
 * moves bubbles, particles and the clock. Growth inside a region is logistic —
 * `infectivity x susceptibles x infected` — which is the one differential
 * equation this genre needs and is stable at any step size you like, whereas
 * the same maths at 60 Hz would spend sixty multiplications a second to move
 * numbers by a rounding error.
 *
 * **Regions are seeded by links, not by geography.** Land, sea and air are
 * three separate channels between the same twelve regions, each with its own
 * traffic and its own gene track. A pathogen with no air gene walks; one with
 * Air 2 is in Japan before anyone in Europe has coughed. Closing borders
 * multiplies the channel rather than cutting it, because a closed border in
 * this genre is a delay, not a wall — and a wall would make the late game a
 * coin flip on whether you got out in time.
 *
 * Why lethality is a trap
 * ----------------------
 * Deaths are drawn from the infected, and the dead cannot infect. Kill fast
 * and you burn out the very population that was carrying you — the classic
 * loss is a lethal plague that wipes Africa and never reaches Oceania. The
 * numbers are set so that the whole symptom track kills a fully-infected world
 * in about seventy days, which is short enough to be worth racing for and long
 * enough that reaching for it early costs you the world.
 *
 * The cure is funded by the living rich, so killing wealthy regions genuinely
 * slows the research. That is the one place where the lethal path pays before
 * the end, and it is deliberate: a strategy that is wrong everywhere is not a
 * choice, it is a trap with a label on it.
 *
 * Where the run starts
 * --------------------
 * Patient zero is a thousand cases, not one. Getting from one person to a
 * thousand takes ninety in-game days during which no decision exists and no
 * DNA is earned, and ninety days is thirty seconds of a player watching a
 * static map. The run starts where the decisions do.
 */

/* ============================================================== the world */

/**
 * One character per cell, the letter naming the region that owns it. Rows are
 * padded to {@link MAP_COLS} at setup, so a row may be short but never long.
 */
const WORLD = [
  '                                              ',
  '   NNNNNNN          EEEEE   RRRRRRRRRRRRRR    ',
  '  NNNNNNNNN        EEEEEEE RRRRRRRRRRRRRRRR   ',
  '  NNNNNNNNNN       EEEEEEE RRRRRRRRRRRRRRRR   ',
  '   NNNNNNNN         EEEEE  RRRRRRRRRRRRRRR    ',
  '    NNNNNN           EEE    RRRRRRRHHHHHHH    ',
  '     CCCC           AAAAAAAAA  HHHHHHHHHH  JJ ',
  '      CCC          AAAAAAAAAA  HHHHHHHHH   JJ ',
  '       CC           AAAAAAA   IIIIIHHHHH    J ',
  '        SSSS        FFFFFFF   IIIIIII  TTT    ',
  '        SSSSS       FFFFFFF   IIIIII  TTTTT   ',
  '        SSSSS        FFFFF     III     TTT  T ',
  '         SSSS        FFFFF              T     ',
  '          SSS         FFF                     ',
  '          SS                          OOOOOO  ',
  '                                      OOOOOO  ',
  '                                       OOOO   ',
  '                                              ',
];

const MAP_COLS = 46;
const MAP_ROWS = WORLD.length;
const CELL = 14;

const MAP_X = 16;
const MAP_Y = 56;
const MAP_W = MAP_COLS * CELL;
const MAP_H = MAP_ROWS * CELL;

const PANEL_X = MAP_X + MAP_W + 18;
const PANEL_W = 206;

const W = PANEL_X + PANEL_W + 16;
const H = 502;

const INFO_Y = 322;
const METER_Y = 382;
const TICKER_Y = 456;

/**
 * Population in millions, wealth 0..1 (healthcare and, later, research money),
 * density 0..1, and a climate band the ability track answers.
 *
 * The populations are roughly the real world's, which matters for one reason:
 * South Asia and Sub-Saharan Africa hold a third of everyone and are both hot,
 * so a pathogen that skips Heat Resistance is capped at two thirds of the
 * planet no matter what else it buys.
 */
const REGIONS = [
  { key: 'N', name: 'North America', short: 'N.AMER', pop: 592, wealth: 0.90, density: 0.30, climate: 'temperate' },
  { key: 'C', name: 'Central America', short: 'C.AMER', pop: 214, wealth: 0.38, density: 0.55, climate: 'humid' },
  { key: 'S', name: 'South America', short: 'S.AMER', pop: 438, wealth: 0.44, density: 0.35, climate: 'humid' },
  { key: 'E', name: 'Europe', short: 'EUROPE', pop: 745, wealth: 0.86, density: 0.70, climate: 'temperate' },
  { key: 'R', name: 'Northern Asia', short: 'N.ASIA', pop: 186, wealth: 0.50, density: 0.08, climate: 'cold' },
  { key: 'A', name: 'Arabia & N. Africa', short: 'ARABIA', pop: 571, wealth: 0.52, density: 0.30, climate: 'arid' },
  { key: 'F', name: 'Sub-Saharan Africa', short: 'AFRICA', pop: 1150, wealth: 0.18, density: 0.32, climate: 'hot' },
  { key: 'I', name: 'South Asia', short: 'S.ASIA', pop: 1892, wealth: 0.24, density: 0.95, climate: 'hot' },
  { key: 'H', name: 'East Asia', short: 'E.ASIA', pop: 1604, wealth: 0.58, density: 0.72, climate: 'temperate' },
  { key: 'J', name: 'Japan & Korea', short: 'JPN-KR', pop: 178, wealth: 0.92, density: 0.94, climate: 'temperate' },
  { key: 'T', name: 'Southeast Asia', short: 'SE.ASIA', pop: 684, wealth: 0.34, density: 0.62, climate: 'humid' },
  { key: 'O', name: 'Oceania', short: 'OCEANIA', pop: 44, wealth: 0.88, density: 0.04, climate: 'arid' },
];

const WORLD_POP = REGIONS.reduce((n, r) => n + r.pop, 0);
/** Wealth-weighted population, i.e. what a fully healthy world can spend on a cure. */
const WORLD_RESEARCH = REGIONS.reduce((n, r) => n + r.pop * r.wealth, 0);

/**
 * Three channels over the same twelve nodes. A pair may appear on more than
 * one channel — Europe and Arabia share a land border, a sea and a flight —
 * and each is gated separately, which is the whole point of the gene track.
 */
const LINKS = [
  ['N', 'C', 'land'], ['C', 'S', 'land'], ['E', 'R', 'land'], ['E', 'A', 'land'],
  ['R', 'H', 'land'], ['A', 'F', 'land'], ['A', 'I', 'land'], ['I', 'H', 'land'],
  ['I', 'T', 'land'],

  ['N', 'E', 'sea'], ['N', 'C', 'sea'], ['N', 'J', 'sea'], ['C', 'S', 'sea'],
  ['S', 'F', 'sea'], ['S', 'O', 'sea'], ['F', 'I', 'sea'], ['F', 'A', 'sea'],
  ['E', 'A', 'sea'], ['H', 'J', 'sea'], ['H', 'T', 'sea'], ['T', 'O', 'sea'],
  ['I', 'T', 'sea'], ['R', 'J', 'sea'],

  ['N', 'E', 'air'], ['N', 'H', 'air'], ['N', 'J', 'air'], ['N', 'S', 'air'],
  ['N', 'O', 'air'], ['N', 'C', 'air'], ['E', 'A', 'air'], ['E', 'R', 'air'],
  ['E', 'F', 'air'], ['E', 'H', 'air'], ['E', 'I', 'air'], ['H', 'J', 'air'],
  ['H', 'T', 'air'], ['H', 'O', 'air'], ['H', 'R', 'air'], ['I', 'A', 'air'],
  ['I', 'H', 'air'], ['S', 'F', 'air'], ['T', 'O', 'air'], ['A', 'F', 'air'],
];

/** Daily odds a fully-infected region seeds an untouched neighbour, ungated. */
const CHANNELS = {
  land: { base: 0.055, color: '#a3e635', label: 'Land' },
  sea: { base: 0.030, color: '#38bdf8', label: 'Sea' },
  air: { base: 0.026, color: '#fbbf24', label: 'Air' },
};

/* =============================================================== the genes */

/**
 * Three tracks. Every field is read directly by the simulation rather than
 * being an opaque "effect" blob, because the balance of this game is entirely
 * in these numbers and they should be legible next to the rules that use them.
 *
 *   inf     added to daily infectivity
 *   lethal  deaths per infected per day
 *   sev     severity, which drives DNA income, detection and border closures
 *   chan    channel this gene raises a level of
 *   resist  divides the cure rate
 *   flag    a trait the susceptibility and detection maths look for
 */
const GENES = {
  transmission: [
    { id: 'air1', name: 'Air 1', cost: 7, chan: 'air', inf: 0.005, sev: 0.01,
      blurb: 'Coughs travel a cabin.' },
    { id: 'air2', name: 'Air 2', cost: 15, req: ['air1'], chan: 'air', inf: 0.008, sev: 0.02,
      blurb: 'A hub is a lottery with daily draws.' },
    { id: 'water1', name: 'Water 1', cost: 7, chan: 'sea', inf: 0.005, sev: 0.01,
      blurb: 'Survives in the bilge.' },
    { id: 'water2', name: 'Water 2', cost: 15, req: ['water1'], chan: 'sea', inf: 0.008, sev: 0.02,
      blurb: 'Every port is a doorway.' },
    { id: 'livestock', name: 'Livestock', cost: 9, chan: 'land', inf: 0.012, sev: 0.02, flag: 'rural',
      blurb: 'Herds cross what people cannot.' },
    { id: 'insect', name: 'Insect', cost: 13, chan: 'land', inf: 0.010, sev: 0.03, flag: 'insect',
      blurb: 'Bites where it is warm and wet.' },
  ],
  symptoms: [
    { id: 'cough', name: 'Coughing', cost: 4, inf: 0.028, sev: 0.06,
      blurb: 'Cheap, catching, ignorable.' },
    { id: 'pneumonia', name: 'Pneumonia', cost: 12, req: ['cough'], inf: 0.040, sev: 0.14, lethal: 0.0040,
      blurb: 'Fills the lungs. Fills the wards.' },
    { id: 'nausea', name: 'Nausea', cost: 4, inf: 0.020, sev: 0.05,
      blurb: 'Spreads by everything you touch.' },
    { id: 'haemorrhage', name: 'Haemorrhage', cost: 16, req: ['nausea'], inf: 0.012, sev: 0.22, lethal: 0.0120,
      blurb: 'Kills fast. Noticed faster.' },
    { id: 'insomnia', name: 'Insomnia', cost: 6, inf: 0.006, sev: 0.10, resist: 0.12,
      blurb: 'Exhausted researchers work slower.' },
    { id: 'necrosis', name: 'Necrosis', cost: 24, req: ['pneumonia', 'haemorrhage'], inf: 0.010, sev: 0.34, lethal: 0.0300,
      blurb: 'The last gene. Save it for last.' },
  ],
  abilities: [
    { id: 'cold', name: 'Cold Resistance', cost: 9, flag: 'cold',
      blurb: 'Northern Asia stops being a wall.' },
    { id: 'heat', name: 'Heat Resistance', cost: 9, flag: 'heat',
      blurb: 'Africa and South Asia give way.' },
    { id: 'drug', name: 'Drug Resistance', cost: 13, flag: 'drug',
      blurb: 'Money stops buying so much safety.' },
    { id: 'hardening', name: 'Genetic Hardening', cost: 15, resist: 0.30,
      blurb: 'The cure takes longer to hold.' },
    { id: 'reshuffle', name: 'Gene Reshuffle', cost: 22, req: ['hardening'], resist: 0.35, setback: 10,
      blurb: 'Throws ten cure points away.' },
    { id: 'camouflage', name: 'Camouflage', cost: 11, flag: 'stealth',
      blurb: 'Looks like flu for twice as long.' },
  ],
};

const TABS = [
  { id: 'transmission', label: 'SPREAD', color: '#4ade80' },
  { id: 'symptoms', label: 'SYMPTOM', color: '#f43f5e' },
  { id: 'abilities', label: 'ABILITY', color: '#a78bfa' },
];

const GENE_BY_ID = {};
for (const track of Object.values(GENES)) for (const g of track) GENE_BY_ID[g.id] = g;

/* ============================================================== the strains */

/**
 * The three-way trade the whole run is played inside. Each buys speed with
 * control, or control with tempo — none of them is simply better.
 */
const STRAINS = {
  bacteria: {
    name: 'Bacteria', color: '#4ade80', dna: 1.25, cure: 1, symptomCost: 1, devolve: 1, mutate: 0, mult: 1.0,
  },
  virus: {
    name: 'Virus', color: '#f43f5e', dna: 1.0, cure: 1, symptomCost: 1, devolve: 1.35, mutate: 32, mult: 1.25,
  },
  prion: {
    name: 'Prion', color: '#a78bfa', dna: 1.0, cure: 0.7, symptomCost: 1.3, devolve: 1, mutate: 0, mult: 1.35,
  },
};

const DIFFICULTY = {
  casual: { name: 'Casual', cure: 0.75, close: 0.6, mult: 1.0 },
  normal: { name: 'Normal', cure: 1.0, close: 1.0, mult: 1.4 },
  brutal: { name: 'Brutal', cure: 1.3, close: 1.5, mult: 1.9 },
};

/* ============================================================== the numbers */

/** Real seconds per in-game day. Three days a second; a run is a minute or three. */
const DAY_SECONDS = 0.30;

const INFECTIVITY_BASE = 0.10;
const START_INFECTED = 0.001; // a thousand cases — see the header
const CURE_BASE = 0.0105;

/** In-game days for the world's labs to reach full output after the news breaks. */
const RESEARCH_RAMP = 150;

/**
 * The share of research effort a wiped-out world still musters. Without a
 * floor, `power` is proportional to the living rich and collapses to nothing
 * exactly when the plague is winning — which sounds right and plays terribly,
 * because it means the cure can never finish once you are ahead and there is
 * no race left to run. Forty percent keeps the clock ticking on a dead planet
 * without making the lethal path pointless.
 */
const RESEARCH_FLOOR = 0.40;

/**
 * A region is finished when this little of it is left alive, and an outbreak
 * inside one is finished when this few are still carrying it. Deaths and a
 * dying outbreak are both exponential decay, which reaches zero at infinity;
 * without a floor to snap to, a run that is unambiguously over spends another
 * thousand days rounding down and never ends.
 */
const COLLAPSE_LIVING = 0.004; // fraction of the original population
const FIZZLE_INFECTED = 1e-5;  // millions, i.e. ten people
const DETECT_BASE = 0.012;

const BUBBLE_LIFE = 5.5;
const BUBBLE_MAX = 4;

const INK = {
  bg: '#04070c',
  ocean: '#070d18',
  land: '#35597f',
  infected: '#f43f5e',
  dead: '#5b4470',
  cure: '#38bdf8',
  dim: '#5c6478',
  text: '#e9edf6',
};

/**
 * Millions, rendered at whatever scale the number actually is. A plague spends
 * its first fifty days below one million, and "0.0M" for fifty days is a
 * readout that looks broken rather than one that looks early.
 */
function fmtPop(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)}B`;
  if (m >= 10) return `${Math.round(m)}M`;
  if (m >= 1) return `${m.toFixed(1)}M`;
  if (m > 0) return `${Math.max(1, Math.round(m * 1000))}K`;
  return '0';
}

const pct = (f) => `${(f * 100).toFixed(f < 0.1 ? 2 : 1)}%`;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export default class Contagion extends BaseGame {
  static id = 'contagion';
  static width = W;
  static height = H;
  static renderer = '2d';
  static touch = 'point';
  static smooth = true;
  static hudPad = { top: 40, bottom: 16 };
  static hudLabels = { score: 'Score', secondary: 'Day' };
  static touchButtons = { action: 'GRAB' };

  /**
   * The gene tree, hung off the class so a probe reads the same object the
   * game plays with. `balance-contagion.mjs` scripts a competent player over
   * `begin`, `collect`, `evolve` and `cost`, and every one of those numbers
   * drifting out of sync with a mirrored copy is a probe that reports on a
   * game nobody is playing.
   */
  static tree = GENES;

  static options = [
    {
      id: 'strain',
      label: 'Strain',
      default: 'bacteria',
      choices: [
        { value: 'bacteria', label: 'Bacteria', hint: 'Hardy and obedient. A quarter more DNA from every bubble, and it never evolves behind your back.' },
        { value: 'virus', label: 'Virus', hint: 'Mutates a symptom of its own choosing every few weeks, free but never when you wanted it \u2014 and shedding one costs a third more. Scores 1.25x.' },
        { value: 'prion', label: 'Prion', hint: 'Nothing about it is easy to study — the cure crawls at seven tenths speed — but symptoms cost a third more. Scores 1.35x.' },
      ],
    },
    {
      id: 'difficulty',
      label: 'World',
      default: 'normal',
      choices: [
        { value: 'casual', label: 'Casual', hint: 'Slow to react, slower to research. Somewhere to learn what the genes actually do.' },
        { value: 'normal', label: 'Normal', hint: 'Borders close when the news breaks and the labs are properly funded. Scores 1.4x.' },
        { value: 'brutal', label: 'Brutal', hint: 'Half the world shuts its airports on the first bad headline and the cure runs 40% faster. Scores 1.9x.' },
      ],
    },
  ];

  /* ============================================================== lifecycle */

  setup() {
    this.strain = STRAINS[this.option('strain')] ?? STRAINS.bacteria;
    this.diff = DIFFICULTY[this.option('difficulty')] ?? DIFFICULTY.normal;
    this.scoreMult = this.strain.mult * this.diff.mult;

    this.#buildWorld();

    this.owned = new Set();
    this.dna = 0;
    this.day = 0;
    this.clock = 0;
    this.time = 0;

    this.cure = 0;
    this.cureMarks = new Set();
    this.newsBroken = false;
    this.newsDay = 0;
    this.bordersClosing = false;

    this.bubbles = [];
    this.bubbleTimer = 2;
    this.mutateTimer = this.strain.mutate;
    this.travellers = [];
    this.news = [];

    this.tab = 0;
    this.cursor = 0;
    this.devolving = false;
    this.patientZero = null;
    this.selected = null;
    this.regionCursor = REGIONS.findIndex((r) => r.key === 'E');
    this.state = 'select';
    this.outcome = null;
    this.scoreBank = 0;
    this.peakInfected = 0;

    this.recompute();

    // No lives — the cure bar is the only thing that can end you, and three
    // bright pips in the HUD would promise a second chance that does not exist.
    this.setLives(0);
    this.host.setSecondaryLabel('Day');
    this.host.setSecondary(0);
    this.host.setHint(
      'Click a country to begin the outbreak',
      'Tap a country to begin the outbreak',
    );
    this.banner('Patient Zero');
    this.play('ready');
  }

  /**
   * Turn {@link WORLD} into everything the rest of the file needs: the cell
   * list per region, a centroid to hang labels and links off, and a single
   * Path2D of every border, traced once because the outlines never move.
   */
  #buildWorld() {
    const byKey = new Map();
    this.regions = REGIONS.map((def, index) => {
      const r = {
        ...def,
        index,
        pop0: def.pop,
        living: def.pop,
        infected: 0,
        dead: 0,
        cells: [],
        cx: 0,
        cy: 0,
        aware: false,
        closed: false,
        seen: false,
        flash: 0,
      };
      byKey.set(def.key, r);
      return r;
    });

    /** grid[row][col] = region index, or -1 for ocean. */
    this.grid = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      const line = (WORLD[row] ?? '').padEnd(MAP_COLS, ' ');
      const cells = [];
      for (let col = 0; col < MAP_COLS; col++) {
        const region = byKey.get(line[col]);
        cells.push(region ? region.index : -1);
        if (!region) continue;
        // A deterministic per-cell shade, so the landmasses have grain rather
        // than reading as twelve flat rectangles.
        const n = (row * 73 + col * 151) % 97;
        region.cells.push({ col, row, tint: 0.82 + (n / 97) * 0.34 });
      }
      this.grid.push(cells);
    }

    for (const r of this.regions) {
      const n = r.cells.length || 1;
      r.cx = MAP_X + (r.cells.reduce((s, c) => s + c.col, 0) / n + 0.5) * CELL;
      r.cy = MAP_Y + (r.cells.reduce((s, c) => s + c.row, 0) / n + 0.5) * CELL;
    }

    // Borders: any cell edge where the neighbour is a different region.
    this.outline = new Path2D();
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const id = this.grid[row][col];
        if (id < 0) continue;
        const x = MAP_X + col * CELL;
        const y = MAP_Y + row * CELL;
        const at = (c, r2) => (r2 < 0 || r2 >= MAP_ROWS || c < 0 || c >= MAP_COLS ? -1 : this.grid[r2][c]);
        if (at(col, row - 1) !== id) { this.outline.moveTo(x, y); this.outline.lineTo(x + CELL, y); }
        if (at(col, row + 1) !== id) { this.outline.moveTo(x, y + CELL); this.outline.lineTo(x + CELL, y + CELL); }
        if (at(col - 1, row) !== id) { this.outline.moveTo(x, y); this.outline.lineTo(x, y + CELL); }
        if (at(col + 1, row) !== id) { this.outline.moveTo(x + CELL, y); this.outline.lineTo(x + CELL, y + CELL); }
      }
    }

    this.links = LINKS.map(([a, b, type]) => ({
      a: byKey.get(a).index,
      b: byKey.get(b).index,
      type,
      flash: 0,
    }));

    this.backdrop = null;
  }

  teardown() {
    this.backdrop = null;
  }

  /* ========================================================== disease stats */

  has(flag) {
    for (const id of this.owned) if (GENE_BY_ID[id].flag === flag) return true;
    return false;
  }

  /**
   * Roll the owned genes up into the six numbers the simulation reads. Called
   * on every evolve and devolve rather than every tick, because the genome
   * changes a few dozen times a run and the day step runs a few hundred.
   */
  recompute() {
    let inf = INFECTIVITY_BASE;
    let lethal = 0;
    let sev = 0;
    let resist = 0;
    const chan = { land: 0, sea: 0, air: 0 };

    for (const id of this.owned) {
      const g = GENE_BY_ID[id];
      inf += g.inf ?? 0;
      lethal += g.lethal ?? 0;
      sev += g.sev ?? 0;
      resist += g.resist ?? 0;
      if (g.chan) chan[g.chan]++;
    }

    this.infectivity = inf;
    this.lethality = lethal;
    this.severity = Math.min(1, sev);
    this.cureResist = resist;
    this.chan = chan;
  }

  cost(gene) {
    const track = this.#trackOf(gene);
    const raw = track === 'symptoms' ? gene.cost * this.strain.symptomCost : gene.cost;
    return Math.ceil(raw);
  }

  #trackOf(gene) {
    for (const [track, list] of Object.entries(GENES)) if (list.includes(gene)) return track;
    return 'abilities';
  }

  /** Why a gene cannot be bought right now, or null if it can. */
  blockedBy(gene) {
    if (this.owned.has(gene.id)) return 'owned';
    if (gene.req) {
      const missing = gene.req.filter((id) => !this.owned.has(id));
      if (missing.length) return GENE_BY_ID[missing[0]].name;
    }
    if (this.dna < this.cost(gene)) return 'dna';
    return null;
  }

  evolve(gene, { free = false } = {}) {
    if (this.owned.has(gene.id)) return false;
    if (gene.req && gene.req.some((id) => !this.owned.has(id))) return false;
    const price = this.cost(gene);
    if (!free && this.dna < price) {
      this.play('back');
      return false;
    }
    if (!free) this.dna -= price;
    this.owned.add(gene.id);
    if (gene.setback) {
      this.cure = Math.max(0, this.cure - gene.setback);
      this.#log(`Gene reshuffle sets the cure back ${gene.setback} points`, INK.cure);
    }
    this.recompute();
    this.play(free ? 'merge' : 'powerup');
    this.shake.add(free ? 2 : 3);
    return true;
  }

  /**
   * Symptoms, and only symptoms, can be taken back — at a premium, because a
   * plague that can freely un-notice itself has no reason ever to be careful.
   * The virus pays double, which is the price of the free mutations it gets.
   */
  devolveCost(gene) {
    return Math.ceil(this.cost(gene) * 0.55 * this.strain.devolve);
  }

  devolve(gene) {
    if (!this.owned.has(gene.id)) return false;
    if (this.#trackOf(gene) !== 'symptoms') {
      this.#log('Only symptoms can be devolved', INK.dim);
      this.play('back');
      return false;
    }
    // Anything built on top of it would be left hanging.
    const dependent = GENES.symptoms.find((g) => this.owned.has(g.id) && g.req?.includes(gene.id));
    if (dependent) {
      this.#log(`${dependent.name} depends on ${gene.name}`, INK.dim);
      this.play('back');
      return false;
    }
    const price = this.devolveCost(gene);
    if (this.dna < price) {
      this.play('back');
      return false;
    }
    this.dna -= price;
    this.owned.delete(gene.id);
    this.recompute();
    this.#log(`${gene.name} devolved`, '#94a3b8');
    this.play('rotate');
    return true;
  }

  /* =============================================================== the day */

  update(dt) {
    this.time += dt;
    this.updateEffects(dt);
    this.#handleInput();

    for (const b of this.bubbles) b.life -= dt;
    this.bubbles = this.bubbles.filter((b) => b.life > 0);
    for (const t of this.travellers) t.t += dt / t.dur;
    this.travellers = this.travellers.filter((t) => t.t < 1);
    for (const l of this.links) if (l.flash > 0) l.flash -= dt;
    for (const r of this.regions) if (r.flash > 0) r.flash -= dt;

    if (this.state !== 'playing') return;

    this.clock += dt;
    while (this.clock >= DAY_SECONDS) {
      this.clock -= DAY_SECONDS;
      this.#advanceDay();
      if (this.state !== 'playing') break;
    }
  }

  #advanceDay() {
    this.day++;
    this.host.setSecondary(this.day);

    this.#grow();
    this.#travel();
    this.#detect();
    this.#research();
    this.#spawnBubbles();
    this.#mutate();
    this.#checkEnd();
  }

  /**
   * Logistic growth inside each region, then the deaths that growth pays for.
   * Susceptibility is where every ability gene lands, so the same equation
   * describes a rich cold country and a poor crowded one.
   */
  #grow() {
    let infectedTotal = 0;
    let newInfected = 0;
    let newDead = 0;

    for (const r of this.regions) {
      if (r.infected <= 0) continue;
      const healthy = Math.max(0, r.living - r.infected);
      if (healthy > 0) {
        const beta = this.infectivity * this.#susceptibility(r);
        const gained = Math.min(healthy, beta * r.infected * (healthy / r.pop0));
        r.infected += gained;
        newInfected += gained;
      }
      if (this.lethality > 0) {
        const died = Math.min(r.infected, r.infected * this.lethality);
        r.infected -= died;
        r.living -= died;
        r.dead += died;
        newDead += died;
      }
      // Snap the two exponential tails to zero. See COLLAPSE_LIVING.
      if (r.infected > 0 && r.infected < FIZZLE_INFECTED) {
        r.infected = 0;
        if (r.living > 0) this.#log(`The outbreak in ${r.name} dies out`, '#94a3b8');
      }
      if (r.living > 0 && r.living <= r.pop0 * COLLAPSE_LIVING) {
        newDead += r.living;
        r.dead = r.pop0;
        r.living = 0;
        r.infected = 0;
        this.#log(`${r.name} has no survivors`, INK.dead);
        this.shake.add(4);
      }
      infectedTotal += r.infected;
    }

    this.peakInfected = Math.max(this.peakInfected, infectedTotal);
    this.#award(newInfected * 18 + newDead * 42);
  }

  /**
   * Wealth is healthcare, density is opportunity, and climate is the wall the
   * ability track is there to knock down. The product is deliberately allowed
   * to range from about 0.25 to about 1.5 — a fivefold spread between the
   * easiest and hardest country on the board is what makes the opening choice
   * of patient zero a real one.
   */
  #susceptibility(r) {
    let m = 0.55 + r.density * 0.85;

    if (r.climate === 'cold') m *= this.has('cold') ? 1.0 : 0.45;
    else if (r.climate === 'hot') m *= this.has('heat') ? 1.05 : 0.62;
    else if (r.climate === 'arid') m *= this.has('heat') ? 1.0 : 0.55;
    else if (r.climate === 'humid') m *= 1.15;

    m *= 1 - r.wealth * (this.has('drug') ? 0.18 : 0.48);

    if (this.has('insect') && (r.climate === 'hot' || r.climate === 'humid')) m *= 1.25;
    if (this.has('rural')) m *= 1 + (1 - r.density) * 0.30;

    return m;
  }

  /**
   * Seeding across links. Pressure is the source's infected share, saturating
   * at 5% — past that a border is either open or it is not, and the difference
   * between a source at 40% and one at 90% is not what decides it.
   */
  #travel() {
    for (const link of this.links) {
      const a = this.regions[link.a];
      const b = this.regions[link.b];
      for (const [from, to] of [[a, b], [b, a]]) {
        if (from.infected <= 0 || to.living <= 0) continue;
        if (to.infected > 0) continue;

        const ch = CHANNELS[link.type];
        const level = this.chan[link.type];
        const pressure = clamp(from.infected / from.pop0 / 0.05, 0, 1);
        const openness = to.closed ? 0.25 : 1;
        const p = ch.base * (1 + level * 1.6) * pressure * openness;

        if (this.random() >= p) continue;

        to.infected = Math.min(to.living, 0.0004);
        to.flash = 1.2;
        link.flash = 1.2;
        this.travellers.push({ link, from: from.index, t: 0, dur: 1.1, color: ch.color });
        this.dna += 1;
        this.#award(500);
        this.popups.add(to.cx, to.cy - 10, '+1 DNA', '#fbbf24');
        this.#log(`${to.name} reports its first case (${ch.label.toLowerCase()})`, INK.infected);
        this.play('blip');
      }
    }
  }

  /**
   * A country notices when its own case count crosses a threshold that shrinks
   * as the disease gets nastier — a mild bug hides at 3% of the population, a
   * haemorrhagic one is on the news at a fraction of that. Once two countries
   * know, everybody knows, and that is the moment the cure clock starts.
   */
  #detect() {
    const threshold = DETECT_BASE * (this.has('stealth') ? 2.4 : 1) / (1 + this.severity * 1.5);

    for (const r of this.regions) {
      if (r.aware || r.pop0 <= 0) continue;
      if (r.infected / r.pop0 < threshold) continue;
      r.aware = true;
      this.#log(`${r.name} identifies the pathogen`, '#fbbf24');
    }

    const awake = this.regions.filter((r) => r.aware).length;
    if (!this.newsBroken && awake >= 2) {
      this.newsBroken = true;
      this.newsDay = this.day;
      for (const r of this.regions) r.aware = true;
      this.#log('The world names it. Cure research begins.', INK.cure);
      this.banner('Detected');
      this.play('levelup');
    }

    if (!this.bordersClosing && this.newsBroken) {
      const infectedFrac = this.#infectedTotal() / WORLD_POP;
      if (this.severity > 0.24 / this.diff.close || infectedFrac > 0.12 / this.diff.close) {
        this.bordersClosing = true;
        this.#log('Borders begin to close', '#fb923c');
      }
    }

    if (this.bordersClosing) {
      for (const r of this.regions) {
        if (r.closed || !r.aware) continue;
        // Rich countries shut first; the poor ones cannot afford to.
        if (this.random() < 0.02 * this.diff.close * (0.3 + r.wealth)) {
          r.closed = true;
          this.#log(`${r.name} closes its borders`, '#fb923c');
        }
      }
    }
  }

  /**
   * The cure is paid for by the living rich, which is why killing them works.
   *
   * Three factors, and they are three because a single constant could not be
   * both survivable on the day the news breaks and frightening two hundred
   * days later. Labs *ramp*: the world takes {@link RESEARCH_RAMP} days to get
   * properly organised, which is the window the whole game is played in.
   * *Attention* scales with how nasty the disease looks, so a quiet plague is
   * funded like a quiet plague. And *power* is the wealth still breathing.
   */
  #research() {
    if (!this.newsBroken || this.cure >= 100) return;
    let alive = 0;
    for (const r of this.regions) alive += r.wealth * r.living;
    const share = WORLD_RESEARCH > 0 ? alive / WORLD_RESEARCH : 0;
    const power = RESEARCH_FLOOR + (1 - RESEARCH_FLOOR) * share;
    const attention = 0.55 + 0.45 * Math.min(1, this.severity * 1.6);
    const ramp = 0.35 + 0.65 * Math.min(1, (this.day - this.newsDay) / RESEARCH_RAMP);

    const rate = CURE_BASE * power * attention * ramp * this.diff.cure * this.strain.cure
      / (1 + this.cureResist);
    const before = this.cure;
    this.cure = Math.min(100, this.cure + rate * 100);
    for (const mark of [25, 50, 75, 90]) {
      // Announced once per run, not once per crossing — a cure bubble popped
      // at 75.2% would otherwise re-announce 75% a fortnight later.
      if (before < mark && this.cure >= mark && !this.cureMarks.has(mark)) {
        this.cureMarks.add(mark);
        this.#log(`Cure research reaches ${mark}%`, INK.cure);
        this.banner(`Cure ${mark}%`);
        this.play('hit');
      }
    }
  }

  /**
   * The action layer. Bubbles are the only way to earn real DNA, they sit on
   * infected ground, and they expire — so a player who stops watching the map
   * to read the gene panel pays for it, which is exactly the attention split
   * the genre is made of.
   */
  #spawnBubbles() {
    this.bubbleTimer -= 1;
    if (this.bubbleTimer > 0) return;

    const hosts = this.regions.filter((r) => r.infected > 0.0001);
    this.bubbleTimer = 3 + this.random() * 4;
    if (!hosts.length || this.bubbles.length >= BUBBLE_MAX) return;

    const r = hosts[Math.floor(this.random() * hosts.length)];
    const cell = r.cells[Math.floor(this.random() * r.cells.length)];
    // Rarer and smaller than they were: at 28% and two points a pop, a player
    // who caught every one of them cancelled the world's research outright and
    // the cure stopped being a clock at all.
    const cureBubble = this.newsBroken && this.cure > 6 && this.random() < 0.18;

    this.bubbles.push({
      x: MAP_X + (cell.col + 0.5) * CELL,
      y: MAP_Y + (cell.row + 0.5) * CELL,
      kind: cureBubble ? 'cure' : 'dna',
      value: cureBubble
        ? 0.6 + this.random() * 0.8
        : Math.max(2, Math.round((2 + this.random() * 2 + this.severity * 1.5) * this.strain.dna)),
      life: BUBBLE_LIFE,
      born: this.time,
    });
  }

  /** The virus tax: a symptom you did not choose, at a moment you did not pick. */
  #mutate() {
    if (!this.strain.mutate) return;
    this.mutateTimer -= 1;
    if (this.mutateTimer > 0) return;
    this.mutateTimer = this.strain.mutate;

    const options = GENES.symptoms
      .filter((g) => !this.owned.has(g.id) && (!g.req || g.req.every((id) => this.owned.has(id))))
      .sort((a, b) => (a.sev ?? 0) - (b.sev ?? 0));
    if (!options.length) return;

    // A virus drifts in small steps. Squaring the roll biases the pick hard
    // toward the mildest symptom still available, so the strain reaches for
    // haemorrhaging only once the cheap mutations are spent — a virus that
    // rolled necrosis on day forty was not a difficult strain, it was a
    // coin flip that ended the run before the player had made a decision.
    const roll = this.random();
    const gene = options[Math.floor(roll * roll * options.length)];
    this.evolve(gene, { free: true });
    this.#log(`The strain mutates: ${gene.name}`, this.strain.color);
    this.banner('Mutation');
  }

  #checkEnd() {
    const infected = this.#infectedTotal();
    const living = this.regions.reduce((n, r) => n + r.living, 0);

    if (living <= 0.001) return this.#finish('extinct');
    if (this.cure >= 100) return this.#finish('cured');
    if (infected <= 0 && this.day > 5) return this.#finish('burnout');
    return undefined;
  }

  #finish(outcome) {
    this.outcome = outcome;
    this.state = 'ended';
    const dead = this.regions.reduce((n, r) => n + r.dead, 0);
    const living = this.regions.reduce((n, r) => n + r.living, 0);

    if (outcome === 'extinct') {
      const speed = Math.max(0, 1 - this.day / 500);
      this.#award(60000 * speed + 400 * (100 - this.cure));
      this.banner('Extinction');
      this.play('highscore');
    } else if (outcome === 'cured') {
      this.banner('Cured');
      this.play('gameover');
    } else {
      this.banner('Burned Out');
      this.play('die');
    }

    this.meta = {
      strain: this.strain.name,
      world: this.diff.name,
      days: this.day,
      dead: Math.round(dead),
      survivors: Math.round(living),
      cure: Math.round(this.cure),
      outcome,
    };
    this.end();
  }

  /**
   * Score is banked as a float and paid out in whole points, so a HUD that can
   * only show integers still ticks up smoothly instead of standing still for
   * eight days and then jumping.
   */
  #award(points) {
    this.scoreBank += points * this.scoreMult;
    const whole = Math.floor(this.scoreBank);
    if (whole >= 1) {
      this.scoreBank -= whole;
      this.addScore(whole);
    }
  }

  #infectedTotal() {
    return this.regions.reduce((n, r) => n + r.infected, 0);
  }

  #log(text, color = INK.text) {
    this.news.unshift({ text, color, day: this.day, born: this.time });
    if (this.news.length > 6) this.news.pop();
  }

  /* ================================================================ input */
  /*
   * `begin`, `collect`, `evolve`, `devolve` and `recompute` are the five things
   * a player does to this game, and they are public for that reason: the debug
   * hook documented in docs/adding-a-game.md is meant to be able to drive a
   * cabinet, and random clicking cannot reach a twenty-gene decision tree.
   */


  #handleInput() {
    if (this.state === 'ended') return;

    /* --- keyboard --- */
    for (let i = 0; i < TABS.length; i++) {
      if (this.input.keyPressed(`Digit${i + 1}`)) {
        this.tab = i;
        this.cursor = 0;
        this.play('toggle');
      }
    }

    if (this.state === 'select') {
      const dir = this.input.takeDirection();
      if (dir) this.#stepRegionCursor(dir);
      if (this.input.pressed('action')) this.begin(this.regions[this.regionCursor]);
    } else {
      if (this.input.pressed('left')) { this.tab = (this.tab + TABS.length - 1) % TABS.length; this.cursor = 0; this.play('toggle'); }
      if (this.input.pressed('right')) { this.tab = (this.tab + 1) % TABS.length; this.cursor = 0; this.play('toggle'); }
      const list = GENES[TABS[this.tab].id];
      if (this.input.pressed('up')) { this.cursor = (this.cursor + list.length - 1) % list.length; this.play('hover'); }
      if (this.input.pressed('down')) { this.cursor = (this.cursor + 1) % list.length; this.play('hover'); }

      // One button, two jobs, in the order that matters: DNA on the map is on
      // a timer, the gene panel is not.
      if (this.input.pressed('action')) {
        if (this.bubbles.length) this.collect(this.bubbles[0]);
        else this.#geneAction(list[this.cursor]);
      }
      if (this.input.keyPressed('KeyX')) this.devolving = !this.devolving;
    }

    /* --- pointer --- */
    const m = this.mouse;
    if (!m.pressed) return;

    if (m.x >= PANEL_X) {
      this.#panelClick(m.x, m.y);
      return;
    }

    // Bubbles sit on top of the map and are the thing most worth clicking, so
    // they get first refusal on any press inside their radius.
    const hit = this.#bubbleAt(m.x, m.y);
    if (hit) {
      this.collect(hit);
      return;
    }

    const region = this.#regionAt(m.x, m.y);
    if (!region) return;
    if (this.state === 'select') this.begin(region);
    else {
      this.selected = region;
      this.play('hover');
    }
  }

  #stepRegionCursor(dir) {
    const from = this.regions[this.regionCursor];
    const want = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    if (!want) return;
    let best = null;
    let bestScore = Infinity;
    for (const r of this.regions) {
      if (r === from) continue;
      const dx = r.cx - from.cx;
      const dy = r.cy - from.cy;
      const along = dx * want[0] + dy * want[1];
      if (along <= 6) continue;
      const off = Math.abs(dx * want[1] - dy * want[0]);
      const score = along + off * 1.8;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    if (best) {
      this.regionCursor = best.index;
      this.play('hover');
    }
  }

  /**
   * The cell under the pointer, or — when that is ocean — the nearest region
   * within reach. A cell is fourteen units wide, which on a phone is about six
   * pixels, so requiring an exact hit would make Japan and Oceania unplayable
   * with a thumb.
   */
  #regionAt(x, y) {
    if (x < MAP_X - 20 || x > MAP_X + MAP_W + 20 || y < MAP_Y - 20 || y > MAP_Y + MAP_H + 20) return null;
    const col = Math.floor((x - MAP_X) / CELL);
    const row = Math.floor((y - MAP_Y) / CELL);
    if (row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS) {
      const id = this.grid[row][col];
      if (id >= 0) return this.regions[id];
    }

    let best = null;
    let bestDist = 46 * 46;
    for (const r of this.regions) {
      for (const c of r.cells) {
        const cx = MAP_X + (c.col + 0.5) * CELL;
        const cy = MAP_Y + (c.row + 0.5) * CELL;
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bestDist) { bestDist = d; best = r; }
      }
    }
    return best;
  }

  #bubbleAt(x, y) {
    for (const b of this.bubbles) {
      if ((b.x - x) ** 2 + (b.y - y) ** 2 <= 16 * 16) return b;
    }
    return null;
  }

  collect(bubble) {
    const i = this.bubbles.indexOf(bubble);
    if (i < 0) return;
    this.bubbles.splice(i, 1);

    if (bubble.kind === 'cure') {
      this.cure = Math.max(0, this.cure - bubble.value);
      this.#award(bubble.value * 120);
      this.popups.add(bubble.x, bubble.y, `-${bubble.value.toFixed(1)}% CURE`, INK.cure);
      this.particles.emit(bubble.x, bubble.y, { count: 12, color: INK.cure, speed: 70, life: 0.5, shape: 'circle' });
      this.play('clear');
    } else {
      this.dna += bubble.value;
      this.#award(bubble.value * 40);
      this.popups.add(bubble.x, bubble.y, `+${bubble.value} DNA`, '#fbbf24');
      this.particles.emit(bubble.x, bubble.y, { count: 10, color: '#fbbf24', speed: 65, life: 0.45, shape: 'circle' });
      this.play('coin');
    }
  }

  begin(region) {
    if (this.state !== 'select' || !region) return;
    this.state = 'playing';
    this.patientZero = region;
    this.selected = region;
    region.infected = Math.min(region.living, START_INFECTED);
    region.flash = 1.5;
    this.#log(`Outbreak begins in ${region.name}`, this.strain.color);
    this.host.setHint(
      '← → tabs · ↑ ↓ pick a gene · Space grabs DNA',
      'Tap the bubbles for DNA · tap a gene to evolve it',
    );
    this.banner(region.short);
    this.play('powerup');
  }

  #panelClick(x, y) {
    for (let i = 0; i < TABS.length; i++) {
      const [tx, ty, tw, th] = this.#tabRect(i);
      if (this.hits(x, y, tx, ty, tw, th)) {
        this.tab = i;
        this.cursor = 0;
        this.play('toggle');
        return;
      }
    }

    const [dx, dy, dw, dh] = this.#devolveRect();
    if (this.hits(x, y, dx, dy, dw, dh)) {
      this.devolving = !this.devolving;
      this.play('toggle');
      return;
    }

    const list = GENES[TABS[this.tab].id];
    for (let i = 0; i < list.length; i++) {
      const [gx, gy, gw, gh] = this.#geneRect(i);
      if (!this.hits(x, y, gx, gy, gw, gh)) continue;
      this.cursor = i;
      this.#geneAction(list[i]);
      return;
    }
  }

  #geneAction(gene) {
    if (!gene || this.state !== 'playing') return;
    if (this.devolving && this.owned.has(gene.id)) this.devolve(gene);
    else this.evolve(gene);
  }

  /* =============================================================== layout */

  /*
   * Every y below starts well under the HUD band — 78 units of empty panel,
   * which looks like waste on a desktop and is not. The HUD is DOM text scaled from
   * the frame's width, not from the playfield's, so on a phone in landscape it
   * is proportionally much taller than it is on a desktop. The first version
   * put the strain name and the gene tabs in exactly the two corners the score
   * and the day counter land in, and the row of life pips under the day
   * counter sat squarely on the ABILITY tab on a phone held sideways. 78 is
   * the worst case, measured at the frame width where the HUD's own scale
   * factor bottoms out and it stops shrinking with the cabinet.
   */
  #tabRect(i) {
    return [PANEL_X + i * 70, 78, 66, 26];
  }

  #geneRect(i) {
    return [PANEL_X, 140 + i * 46, PANEL_W, 42];
  }

  #devolveRect() {
    return [PANEL_X, 424, PANEL_W, 26];
  }

  /* ================================================================= draw */

  draw(ctx) {
    this.clear(ctx, INK.bg);
    ctx.save();
    this.shake.apply(ctx);

    ctx.drawImage(this.#backdropLayer(), 0, 0, W, H);

    this.#drawHeader(ctx);
    this.#drawMap(ctx);
    this.#drawLinks(ctx);
    this.#drawBubbles(ctx);
    this.drawEffects(ctx);
    this.#drawInfo(ctx);
    this.#drawMeters(ctx);
    this.#drawTicker(ctx);
    this.#drawPanel(ctx);

    if (this.state === 'select') this.#drawSelectPrompt(ctx);

    ctx.restore();
  }

  /**
   * Ocean, latitude lines and the panel well — none of which ever change, and
   * all of which are gradients that are not worth rebuilding sixty times a
   * second.
   */
  #backdropLayer() {
    if (this.backdrop) return this.backdrop;
    const dpr = Math.min(2, this.host.dpr || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);

    const sea = g.createLinearGradient(0, MAP_Y, 0, MAP_Y + MAP_H);
    sea.addColorStop(0, '#050a13');
    sea.addColorStop(0.5, INK.ocean);
    sea.addColorStop(1, '#050a13');
    g.fillStyle = sea;
    g.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    g.strokeStyle = 'rgba(120,180,255,0.05)';
    g.lineWidth = 1;
    for (let row = 0; row <= MAP_ROWS; row += 3) {
      g.beginPath();
      g.moveTo(MAP_X, MAP_Y + row * CELL + 0.5);
      g.lineTo(MAP_X + MAP_W, MAP_Y + row * CELL + 0.5);
      g.stroke();
    }
    for (let col = 0; col <= MAP_COLS; col += 4) {
      g.beginPath();
      g.moveTo(MAP_X + col * CELL + 0.5, MAP_Y);
      g.lineTo(MAP_X + col * CELL + 0.5, MAP_Y + MAP_H);
      g.stroke();
    }

    g.strokeStyle = 'rgba(255,255,255,0.06)';
    this.roundRect(g, MAP_X - 0.5, MAP_Y - 0.5, MAP_W + 1, MAP_H + 1, 6).stroke();

    g.fillStyle = 'rgba(255,255,255,0.018)';
    this.roundRect(g, PANEL_X - 8, 8, PANEL_W + 16, H - 16, 12).fill();

    this.backdrop = c;
    return c;
  }

  #drawHeader(ctx) {
    this.text(ctx, this.strain.name.toUpperCase(), MAP_X, 46, {
      size: 13, color: this.strain.color, align: 'left', glow: 8,
    });
    this.text(ctx, `${this.diff.name} world`, MAP_X + 96, 47, {
      size: 10, color: INK.dim, align: 'left', weight: 500,
    });

    let status = 'Undetected';
    let color = '#4ade80';
    if (this.cure >= 100) { status = 'Cured'; color = INK.cure; }
    else if (this.bordersClosing) { status = 'Borders closing'; color = '#fb923c'; }
    else if (this.newsBroken) { status = 'Cure research active'; color = INK.cure; }

    this.text(ctx, status.toUpperCase(), MAP_X + MAP_W, 46, {
      size: 10, color, align: 'right', glow: 6,
    });
  }

  #drawMap(ctx) {
    for (const r of this.regions) {
      const infFrac = r.pop0 > 0 ? r.infected / r.pop0 : 0;
      const deadFrac = r.pop0 > 0 ? r.dead / r.pop0 : 0;
      const base = blend(LAND_RGB, INFECTED_RGB, Math.min(1, infFrac * 1.25));
      const shade = blend(base, DEAD_RGB, Math.min(1, deadFrac * 1.4));

      for (const cell of r.cells) {
        const x = MAP_X + cell.col * CELL;
        const y = MAP_Y + cell.row * CELL;
        ctx.fillStyle = shadeOf(shade, cell.tint);
        ctx.fillRect(x, y, CELL - 1, CELL - 1);
      }

      // A country that has just been seeded flares, because a single cell
      // turning one shade redder is not something a player can notice.
      if (r.flash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, r.flash * 0.6);
        this.glowCircle(ctx, r.cx, r.cy, 10 + (1.5 - r.flash) * 14, INK.infected, 16);
        ctx.restore();
      }
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(8,14,24,0.75)';
    ctx.lineWidth = 1;
    ctx.stroke(this.outline);
    ctx.restore();

    // Status pins: a lab for a country funding research, a bar for a closed one.
    for (const r of this.regions) {
      if (r.closed) {
        this.glowRect(ctx, r.cx - 7, r.cy - 11, 14, 2.5, '#fb923c', 6);
      } else if (r.aware) {
        this.glowCircle(ctx, r.cx, r.cy - 10, 2.2, INK.cure, 6);
      }
    }

    const focus = this.state === 'select' ? this.regions[this.regionCursor] : this.selected;
    if (focus) this.#drawFocusRing(ctx, focus);
  }

  #drawFocusRing(ctx, r) {
    let minC = Infinity; let maxC = -Infinity; let minR = Infinity; let maxR = -Infinity;
    for (const c of r.cells) {
      minC = Math.min(minC, c.col); maxC = Math.max(maxC, c.col);
      minR = Math.min(minR, c.row); maxR = Math.max(maxR, c.row);
    }
    const x = MAP_X + minC * CELL - 3;
    const y = MAP_Y + minR * CELL - 3;
    const w = (maxC - minC + 1) * CELL + 5;
    const h = (maxR - minR + 1) * CELL + 5;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);

    ctx.save();
    ctx.strokeStyle = `rgba(233,237,246,${0.25 + pulse * 0.4})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -this.time * 14;
    this.roundRect(ctx, x, y, w, h, 4).stroke();
    ctx.restore();
  }

  /**
   * Only links out of infected ground are drawn. Forty faint arcs over the
   * whole map is noise; the four that could carry the disease tomorrow is
   * information.
   */
  #drawLinks(ctx) {
    ctx.save();
    for (const link of this.links) {
      const a = this.regions[link.a];
      const b = this.regions[link.b];
      const live = a.infected > 0 || b.infected > 0;
      if (!live && link.flash <= 0) continue;
      const ch = CHANNELS[link.type];
      const both = a.infected > 0 && b.infected > 0;
      ctx.globalAlpha = link.flash > 0 ? 0.85 : both ? 0.10 : 0.26;
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = link.flash > 0 ? 1.8 : 0.9;
      ctx.setLineDash(link.type === 'air' ? [3, 4] : link.type === 'sea' ? [1.5, 3] : []);
      ctx.beginPath();
      ctx.moveTo(a.cx, a.cy);
      ctx.lineTo(b.cx, b.cy);
      ctx.stroke();
    }
    ctx.restore();

    for (const t of this.travellers) {
      const a = this.regions[t.link.a];
      const b = this.regions[t.link.b];
      const from = t.from === t.link.a ? a : b;
      const to = t.from === t.link.a ? b : a;
      const x = from.cx + (to.cx - from.cx) * t.t;
      const y = from.cy + (to.cy - from.cy) * t.t;
      this.glowCircle(ctx, x, y, 2.6, t.color, 12);
    }
  }

  #drawBubbles(ctx) {
    for (const b of this.bubbles) {
      const age = this.time - b.born;
      const grow = Math.min(1, age * 6);
      const fade = Math.min(1, b.life / 1.2);
      const pulse = 1 + Math.sin(this.time * 7 + b.x) * 0.09;
      const r = 9 * grow * pulse;
      const color = b.kind === 'cure' ? INK.cure : '#fbbf24';

      ctx.save();
      ctx.globalAlpha = fade;
      this.glowCircle(ctx, b.x, b.y, r, color, 16);
      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = 'rgba(4,7,12,0.85)';
      ctx.lineWidth = 1.4;

      if (b.kind === 'cure') {
        // A cross: the research you are stealing back.
        ctx.beginPath();
        ctx.moveTo(b.x - r * 0.42, b.y);
        ctx.lineTo(b.x + r * 0.42, b.y);
        ctx.moveTo(b.x, b.y - r * 0.42);
        ctx.lineTo(b.x, b.y + r * 0.42);
        ctx.stroke();
      } else {
        // A helix: two strands and a rung.
        ctx.beginPath();
        for (const dir of [-1, 1]) {
          ctx.moveTo(b.x + dir * r * 0.34, b.y - r * 0.46);
          ctx.quadraticCurveTo(b.x - dir * r * 0.42, b.y, b.x + dir * r * 0.34, b.y + r * 0.46);
        }
        ctx.moveTo(b.x - r * 0.3, b.y);
        ctx.lineTo(b.x + r * 0.3, b.y);
        ctx.stroke();
      }

      // The last second and a half of a bubble's life shows as a shrinking ring.
      if (b.life < 1.8) {
        ctx.globalAlpha = fade * 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (b.life / 1.8));
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  #drawInfo(ctx) {
    const r = this.selected ?? this.regions[this.regionCursor];
    if (!r) return;
    const infFrac = r.pop0 > 0 ? r.infected / r.pop0 : 0;
    const deadFrac = r.pop0 > 0 ? r.dead / r.pop0 : 0;
    const suscept = this.#susceptibility(r);

    this.text(ctx, r.name.toUpperCase(), MAP_X, INFO_Y, {
      size: 12, color: INK.text, align: 'left', glow: 4,
    });

    const chips = [];
    if (r === this.patientZero) chips.push(['PATIENT ZERO', this.strain.color]);
    if (r.closed) chips.push(['BORDERS CLOSED', '#fb923c']);
    else if (r.aware) chips.push(['ALERTED', INK.cure]);
    if (r.living <= 0) chips.push(['NO SURVIVORS', INK.dead]);

    let cx = MAP_X + MAP_W;
    for (const [label, color] of chips.reverse()) {
      const w = label.length * 5.6 + 14;
      cx -= w;
      ctx.save();
      ctx.fillStyle = `${color}1f`;
      this.roundRect(ctx, cx, INFO_Y - 8, w, 16, 5).fill();
      ctx.restore();
      this.text(ctx, label, cx + w / 2, INFO_Y, { size: 8.5, color });
      cx -= 6;
    }

    const cols = [
      ['POPULATION', fmtPop(r.pop0), INK.text],
      ['INFECTED', `${fmtPop(r.infected)}  ${pct(infFrac)}`, INK.infected],
      ['DEAD', `${fmtPop(r.dead)}  ${pct(deadFrac)}`, INK.dead],
      ['HEALTHCARE', `${Math.round(r.wealth * 100)}`, '#94a3b8'],
      ['CLIMATE', r.climate.toUpperCase(), '#94a3b8'],
      ['SUSCEPTIBLE', `${suscept.toFixed(2)}x`, suscept > 0.9 ? '#4ade80' : suscept > 0.55 ? '#fbbf24' : '#fb7185'],
    ];
    const step = MAP_W / cols.length;
    cols.forEach(([label, value, color], i) => {
      const x = MAP_X + i * step;
      this.text(ctx, label, x, INFO_Y + 18, { size: 8, color: INK.dim, align: 'left', weight: 500 });
      this.text(ctx, value, x, INFO_Y + 32, { size: 12, color, align: 'left' });
    });
  }

  #drawMeters(ctx) {
    const infected = this.#infectedTotal();
    const dead = this.regions.reduce((n, r) => n + r.dead, 0);
    const rows = [
      ['INFECTED', infected / WORLD_POP, INK.infected, fmtPop(infected)],
      ['DEAD', dead / WORLD_POP, INK.dead, fmtPop(dead)],
      ['CURE', this.cure / 100, INK.cure, `${this.cure.toFixed(1)}%`],
    ];

    rows.forEach(([label, frac, color, value], i) => {
      const y = METER_Y + i * 22;
      this.text(ctx, label, MAP_X, y, { size: 9, color: INK.dim, align: 'left', weight: 500 });
      this.text(ctx, value, MAP_X + MAP_W, y, { size: 10, color, align: 'right' });
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      this.roundRect(ctx, MAP_X, y + 6, MAP_W, 6, 3).fill();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      this.roundRect(ctx, MAP_X, y + 6, Math.max(2, MAP_W * clamp(frac, 0, 1)), 6, 3).fill();
      ctx.restore();
    });
  }

  #drawTicker(ctx) {
    const shown = this.news.slice(0, 3);
    shown.forEach((item, i) => {
      const alpha = i === 0 ? 1 : i === 1 ? 0.62 : 0.34;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.text(ctx, `DAY ${item.day}`, MAP_X, TICKER_Y + i * 14, {
        size: 8.5, color: INK.dim, align: 'left', weight: 500,
      });
      this.text(ctx, item.text, MAP_X + 52, TICKER_Y + i * 14, {
        size: 9.5, color: item.color, align: 'left', weight: 600,
      });
      ctx.restore();
    });
  }

  #drawSelectPrompt(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,7,12,0.55)';
    ctx.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);
    ctx.restore();

    const pulse = 0.65 + 0.35 * Math.sin(this.time * 3);
    this.text(ctx, 'WHERE DOES IT START?', MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2 - 10, {
      size: 18, color: this.strain.color, glow: 14 * pulse,
    });
    this.text(ctx, 'Crowded and poor spreads fastest. Heat, cold and money all fight back.',
      MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2 + 12, { size: 10, color: '#94a3b8', weight: 500 });

    const r = this.regions[this.regionCursor];
    this.text(ctx, r.name.toUpperCase(), MAP_X + MAP_W / 2, MAP_Y + MAP_H / 2 + 34, {
      size: 11, color: INK.text, glow: 6,
    });
  }

  /**
   * Trim a string to fit a box, with an ellipsis. The panel is 206 units wide
   * and a gene blurb is the one piece of copy in this file that someone will
   * later want to make one word longer; silently clipping it at the panel edge
   * is how "Africa and South Asia are a third of every" shipped once already.
   */
  #fit(ctx, str, maxWidth, size, weight = 500) {
    ctx.save();
    ctx.font = `${weight} ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
    let out = str;
    if (ctx.measureText(out).width > maxWidth) {
      while (out.length > 1 && ctx.measureText(`${out}\u2026`).width > maxWidth) out = out.slice(0, -1);
      out = `${out.trimEnd()}\u2026`;
    }
    ctx.restore();
    return out;
  }

  /* ================================================================ panel */

  #drawPanel(ctx) {
    /* --- tabs --- */
    TABS.forEach((tab, i) => {
      const [x, y, w, h] = this.#tabRect(i);
      const on = i === this.tab;
      ctx.save();
      ctx.fillStyle = on ? `${tab.color}22` : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, x, y, w, h, 7).fill();
      ctx.strokeStyle = on ? tab.color : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = on ? 1.5 : 1;
      this.roundRect(ctx, x, y, w, h, 7).stroke();
      ctx.restore();
      this.text(ctx, tab.label, x + w / 2, y + h / 2, {
        size: 9.5, color: on ? tab.color : INK.dim,
      });
    });

    /* --- purse --- */
    // The label follows the number rather than sitting at a fixed offset: a
    // hoarded four-digit balance used to run straight through it.
    const purse = `${Math.floor(this.dna)}`;
    this.text(ctx, purse, PANEL_X, 122, { size: 22, color: '#fbbf24', align: 'left', glow: 9 });
    ctx.save();
    ctx.font = '700 22px ui-monospace, "SF Mono", Menlo, monospace';
    const purseW = ctx.measureText(purse).width;
    ctx.restore();
    this.text(ctx, 'DNA', PANEL_X + purseW + 8, 126, {
      size: 9, color: INK.dim, align: 'left', weight: 500,
    });
    this.text(ctx, `SEVERITY ${Math.round(this.severity * 100)}`, PANEL_X + PANEL_W, 118, {
      size: 9, color: this.severity > 0.4 ? '#fb923c' : INK.dim, align: 'right', weight: 500,
    });
    this.text(ctx, `LETHALITY ${(this.lethality * 1000).toFixed(1)}`, PANEL_X + PANEL_W, 132, {
      size: 9, color: this.lethality > 0 ? INK.infected : INK.dim, align: 'right', weight: 500,
    });

    /* --- genes --- */
    const list = GENES[TABS[this.tab].id];
    const accent = TABS[this.tab].color;

    list.forEach((gene, i) => {
      const [x, y, w, h] = this.#geneRect(i);
      const owned = this.owned.has(gene.id);
      const blocked = this.blockedBy(gene);
      const price = this.cost(gene);
      const focused = i === this.cursor;
      const canDevolve = this.devolving && owned && this.#trackOf(gene) === 'symptoms';

      ctx.save();
      ctx.fillStyle = owned ? `${accent}1c` : 'rgba(255,255,255,0.03)';
      this.roundRect(ctx, x, y, w, h, 8).fill();
      ctx.strokeStyle = canDevolve
        ? '#fb7185'
        : owned ? accent : focused ? 'rgba(233,237,246,0.42)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = owned || focused || canDevolve ? 1.5 : 1;
      this.roundRect(ctx, x, y, w, h, 8).stroke();
      ctx.restore();

      const affordable = !blocked;
      const nameColor = owned ? accent : affordable ? INK.text : '#5c6478';
      this.glowCircle(ctx, x + 15, y + 14, 5, owned ? accent : affordable ? `${accent}` : '#39415a', owned ? 10 : 3);
      this.text(ctx, gene.name, x + 28, y + 13, { size: 11, color: nameColor, align: 'left' });

      if (owned) {
        this.text(ctx, canDevolve ? `-${this.devolveCost(gene)}` : 'HELD', x + w - 10, y + 13, {
          size: 9.5, color: canDevolve ? '#fb7185' : accent, align: 'right', weight: 600,
        });
      } else {
        this.text(ctx, `${price}`, x + w - 10, y + 13, {
          size: 11, color: affordable ? '#fbbf24' : '#5c6478', align: 'right',
        });
      }

      const note = blocked && blocked !== 'dna' && blocked !== 'owned'
        ? `needs ${blocked}`
        : gene.blurb;
      this.text(ctx, this.#fit(ctx, note, w - 18, 8.5), x + 10, y + 30, {
        size: 8.5,
        color: blocked && blocked !== 'dna' && blocked !== 'owned' ? '#fb923c' : INK.dim,
        align: 'left',
        weight: 500,
      });
    });

    /* --- devolve chip --- */
    const [dx, dy, dw, dh] = this.#devolveRect();
    ctx.save();
    ctx.fillStyle = this.devolving ? 'rgba(251,113,133,0.18)' : 'rgba(255,255,255,0.03)';
    this.roundRect(ctx, dx, dy, dw, dh, 8).fill();
    ctx.strokeStyle = this.devolving ? '#fb7185' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = this.devolving ? 1.5 : 1;
    this.roundRect(ctx, dx, dy, dw, dh, 8).stroke();
    ctx.restore();
    this.text(ctx, this.devolving ? 'DEVOLVE: PICK A SYMPTOM' : 'DEVOLVE A SYMPTOM', dx + dw / 2, dy + dh / 2, {
      size: 9, color: this.devolving ? '#fb7185' : INK.dim,
    });

    /* --- channel readout, so the transmission levels are visible at all --- */
    const chans = Object.entries(CHANNELS);
    chans.forEach(([id, ch], i) => {
      const x = PANEL_X + i * 70;
      const level = this.chan[id];
      this.text(ctx, ch.label.toUpperCase(), x, 464, { size: 8, color: INK.dim, align: 'left', weight: 500 });
      for (let p = 0; p < 2; p++) {
        ctx.save();
        ctx.fillStyle = p < level ? ch.color : 'rgba(255,255,255,0.08)';
        this.roundRect(ctx, x + p * 13, 472, 10, 4, 2).fill();
        ctx.restore();
      }
    });

    this.text(ctx, `INFECTIVITY ${(this.infectivity * 100).toFixed(1)}`, PANEL_X, 488, {
      size: 8.5, color: INK.dim, align: 'left', weight: 500,
    });
    this.text(ctx, `${this.owned.size}/18 GENES`, PANEL_X + PANEL_W, 488, {
      size: 8.5, color: INK.dim, align: 'right', weight: 500,
    });
  }
}

/* ============================================================== colour bits */

/**
 * Everything below works in `[r, g, b]` triples and only becomes a string at
 * the moment it is assigned to a fillStyle. That is not fussiness: the first
 * version blended hex strings and returned `rgb(...)`, so the second blend —
 * land to red, then that to the colour of the dead — parsed its own output as
 * hex and produced `rgb(NaN,NaN,59)`. Canvas *ignores* an invalid fillStyle
 * rather than throwing, so every country on the map silently drew in whatever
 * colour happened to be set last, no error was logged anywhere, and the only
 * symptom was a world map that never turned red.
 */
const rgbOf = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const LAND_RGB = rgbOf(INK.land);
const INFECTED_RGB = rgbOf(INK.infected);
const DEAD_RGB = rgbOf(INK.dead);

/** Blend two triples. Takes triples, returns a triple — never a string. */
function blend(a, b, t) {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** A triple, scaled for the per-cell grain, as a CSS colour. */
function shadeOf(c, k) {
  return `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
}
