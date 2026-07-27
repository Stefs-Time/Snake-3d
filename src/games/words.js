/**
 * Word data for the two word cabinets.
 *
 * There is no dictionary to call and no network to rely on — the arcade has to
 * work offline — so the lists are embedded. They live in their own module so
 * both word games share one copy in the bundle.
 */

/**
 * Answers for Lexicon: common five-letter words, no proper nouns, nothing
 * obscure enough to feel unfair when you are down to your last guess.
 */
const ANSWER_SOURCE = `
about above abuse actor acute admit adopt adult after again agent agree ahead
alarm album alert alike alive allow alone along alter among anger angle angry
apart apple apply arena argue arise array aside asset audio audit avoid award
aware badly baker bases basic basis beach began begin begun being below bench
birth black blame blind block blood board boost booth bound brain brand bread
break breed brief bring broad broke brown build built buyer cable carry catch
cause chain chair chart chase cheap check chest chief child chose civil claim
class clean clear click clock close coach coast could count court cover craft
crash cream crime cross crowd crown curve cycle daily dance dated dealt death
debut delay depth doing doubt dozen draft drama drawn dream dress drill drink
drive drove dying eager early earth eight elite empty enemy enjoy enter entry
equal error event every exact exist extra faith false fault fiber field fifth
fifty fight final first fixed flash fleet floor fluid focus force forth forty
forum found frame frank fraud fresh front fruit fully funny giant given glass
globe going grace grade grand grant grass great green gross group grown guard
guess guest guide happy heart heavy hence horse hotel house human ideal image
index inner input issue joint judge known label large laser later laugh layer
learn lease least leave legal level light limit links lives local loose lower
lucky lunch lying magic major maker march match maybe mayor meant media metal
might minor minus mixed model money month moral motor mount mouse mouth movie
music needs never newly night noise north noted novel nurse occur ocean offer
often order other ought paint panel paper party peace phase phone photo piece
pilot pitch place plain plane plant plate point pound power press price pride
prime print prior prize proof proud prove queen quick quiet quite radio raise
range rapid ratio reach ready refer right rival river rough round route royal
rural scale scene scope score sense serve seven shall shape share sharp sheet
shelf shell shift shirt shock shoot short shown sight since sixth sixty sized
skill sleep slide small smart smile smoke solid solve sorry sound south space
spare speak speed spend spent split spoke sport staff stage stake stand start
state steam steel stick still stock stone stood store storm story strip stuck
study stuff style sugar suite super sweet table taken taste taxes teach teeth
thank theft their theme there these thick thing think third those three threw
throw tight times tired title today topic total touch tough tower track trade
train treat trend trial tried tries truck truly trust truth twice under undue
union unity until upper upset urban usage usual valid value video virus visit
vital voice waste watch water wheel where which while white whole whose woman
women world worry worse worst worth would wound write wrong wrote yield young
yours youth
`;

/** @type {string[]} */
export const ANSWERS = ANSWER_SOURCE.trim().split(/\s+/).map((w) => w.toUpperCase());

/**
 * Guesses are not checked against a dictionary. A 550-word answer list would
 * reject far too many perfectly good English words, and "not in word list" is
 * a worse experience than letting someone waste a guess on nonsense — which
 * only costs them anyway.
 */
export function isValidGuess(word) {
  return /^[A-Z]{5}$/.test(word);
}

/**
 * Hangman words, grouped so the category can be shown as a hint. Lengths run
 * from four to eleven letters — a list of uniform length turns the game into
 * arithmetic. Single words only, all A-Z.
 */
export const HANGMAN_CATEGORIES = [
  {
    name: 'Animals',
    words: ['OTTER', 'PENGUIN', 'GIRAFFE', 'BADGER', 'DOLPHIN', 'TORTOISE', 'SQUIRREL', 'FLAMINGO', 'HEDGEHOG', 'ANTELOPE', 'MONGOOSE', 'PORCUPINE'],
  },
  {
    name: 'Countries',
    words: ['BRAZIL', 'FINLAND', 'MOROCCO', 'ECUADOR', 'THAILAND', 'PORTUGAL', 'MONGOLIA', 'TANZANIA', 'ARGENTINA', 'INDONESIA', 'SWITZERLAND', 'MADAGASCAR'],
  },
  {
    name: 'In the kitchen',
    words: ['KETTLE', 'SKILLET', 'COLANDER', 'TOASTER', 'SPATULA', 'CUPBOARD', 'BLENDER', 'TEAPOT', 'GRATER', 'SAUCEPAN', 'CORKSCREW', 'ROLLINGPIN'],
  },
  {
    name: 'Weather',
    words: ['BLIZZARD', 'DRIZZLE', 'THUNDER', 'MONSOON', 'TORNADO', 'HUMIDITY', 'OVERCAST', 'HAILSTONE', 'LIGHTNING', 'SUNSHINE', 'FROSTBITE', 'WHIRLWIND'],
  },
  {
    name: 'Music',
    words: ['TRUMPET', 'HARMONY', 'ORCHESTRA', 'SAXOPHONE', 'CONCERTO', 'MELODY', 'RHYTHM', 'BAGPIPES', 'CLARINET', 'PERCUSSION', 'CRESCENDO', 'TAMBOURINE'],
  },
  {
    name: 'Space',
    words: ['ECLIPSE', 'ASTEROID', 'GALAXY', 'NEBULA', 'SATELLITE', 'TELESCOPE', 'METEORITE', 'SUPERNOVA', 'GRAVITY', 'ORBITAL', 'COMET', 'STARLIGHT'],
  },
  {
    name: 'Sport',
    words: ['CRICKET', 'MARATHON', 'JAVELIN', 'HOCKEY', 'ARCHERY', 'CANOEING', 'SPRINTER', 'BADMINTON', 'GYMNAST', 'PADDLING', 'DECATHLON', 'GOALKEEPER'],
  },
  {
    name: 'Around town',
    words: ['LIBRARY', 'MARKET', 'BRIDGE', 'STATION', 'HARBOUR', 'CATHEDRAL', 'ROUNDABOUT', 'PAVEMENT', 'TERMINAL', 'ARCADE', 'MUSEUM', 'FOUNTAIN'],
  },
];

/** Themed grids for the word search, chosen so the letters mix well. */
export const THEMES = [
  {
    name: 'Arcade',
    words: ['ARCADE', 'PIXEL', 'JOYSTICK', 'TOKEN', 'LEVEL', 'BONUS', 'MAZE', 'GHOST', 'LASER', 'SCORE'],
  },
  {
    name: 'Space',
    words: ['COMET', 'ORBIT', 'PLANET', 'ROCKET', 'NEBULA', 'GALAXY', 'METEOR', 'LUNAR', 'SOLAR', 'COSMOS'],
  },
  {
    name: 'Weather',
    words: ['THUNDER', 'BREEZE', 'FROST', 'DRIZZLE', 'CLOUD', 'STORM', 'RAINBOW', 'HUMID', 'GALE', 'SLEET'],
  },
  {
    name: 'Kitchen',
    words: ['SKILLET', 'WHISK', 'KETTLE', 'LADLE', 'SIEVE', 'GRATER', 'TIMER', 'APRON', 'BLENDER', 'SPICE'],
  },
  {
    name: 'Animals',
    words: ['OTTER', 'FALCON', 'BADGER', 'IGUANA', 'WALRUS', 'MAGPIE', 'GECKO', 'BISON', 'LEMUR', 'HERON'],
  },
  {
    name: 'Music',
    words: ['RHYTHM', 'TEMPO', 'CHORUS', 'BANJO', 'OCTAVE', 'MELODY', 'CELLO', 'TREBLE', 'DRUMS', 'MINOR'],
  },
  {
    name: 'Ocean',
    words: ['CORAL', 'LAGOON', 'TIDAL', 'KELP', 'MARLIN', 'ANCHOR', 'HARBOR', 'PLANKTON', 'ABYSS', 'SHOAL'],
  },
];
