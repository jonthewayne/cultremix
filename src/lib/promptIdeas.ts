// Starting points for designs made from scratch (no reference image). Picking one
// fills the prompt box, and people can change it before they generate.
export const PROMPT_IDEAS: Array<{ group: string; ideas: Array<string> }> = [
  {
    group: "Retro",
    ideas: [
      "A 70s sunset badge with saguaros that says DESERT PEOPLE CLUB",
      "A retro racing crest with a hot rod that says SLOW LANE RACING TEAM",
      "A faded 80s arcade marquee that says INSERT COIN TO CONTINUE",
      "A vintage national park poster of a moon over pines that says NIGHT SHIFT RANGERS",
      "A 60s surf club patch with a longboard that says SALT WATER SOCIETY",
      "A retro diner sign with a steaming coffee cup that says BOTTOMLESS OPTIMISM",
    ],
  },
  {
    group: "Street",
    ideas: [
      "Huge stacked block letters that say MAIN CHARACTER ENERGY",
      "Chrome Y2K bubble letters that say LOADING…",
      "A dripping graffiti tag that says SOFT LIFE",
      "A varsity arch with a star that says OFFLINE ATHLETICS",
      "A brutalist grid of bold type that says TOUCH GRASS",
      "A sticker-bomb collage around the words CERTIFIED LOCAL",
    ],
  },
  {
    group: "Nature",
    ideas: [
      "A psychedelic 70s mushroom graphic that says GROW SLOW",
      "A woodblock-print wave with the words OFFLINE IS THE NEW LUXURY",
      "A botanical engraving of a fern that says LEAF ME ALONE",
      "A tarot card of a sleepy crescent moon that says THE NAP",
      "A cosmic cat floating past Saturn that says SPACE CADET",
      "A hand-drawn honeybee in wildflowers that says BUSY DOING NOTHING",
    ],
  },
  {
    group: "Animals",
    ideas: [
      "A cartoon cat on a washing machine that says SPIN CYCLE SOCIAL CLUB",
      "A raccoon in a tiny crown that says TRASH ROYALTY",
      "A frog in a cowboy hat that says HOP ALONG",
      "A pigeon in a beanie and headphones that says CITY BIRD",
      "A dog in sunglasses on a pool float that says GOOD BOY SUMMER",
      "A sloth holding an iced coffee that says IN NO RUSH",
    ],
  },
  {
    group: "City",
    ideas: [
      "A bodega cat under a neon sign that says OPEN 24 HOURS",
      "A cassette tape with tangled ribbon that says REWIND THE NIGHT",
      "A subway map in bright lines that says LOST ON PURPOSE",
      "A boombox with flowers growing out of it that says TURN IT UP",
      "A fire escape strung with lights that says ROOFTOP SEASON",
      "A slice of pizza in sunglasses that says LATE NIGHT LEGEND",
    ],
  },
  {
    group: "Clubs",
    ideas: [
      "A tennis club crest with crossed rackets that says LOVE ALL",
      "A running club crest with a sneaker that says RUN CLUB, THEN BRUNCH",
      "A bowling pin badge that says SPARE ME",
      "A skate shop logo with a flaming wheel that says ROLL WITH IT",
      "A fishing lure patch that says GONE FISHING, BACK NEVER",
      "A chess club crest with a knight that says YOUR MOVE",
    ],
  },
  {
    group: "Minimal",
    ideas: [
      "A single-line drawing of a coffee cup that says BUT FIRST",
      "A tiny sun over a wave in thin lines that says SLOW MORNINGS",
      "Clean Swiss-style type that says DO LESS, BETTER",
      "A small hand-drawn heart with the words SOFT BUT STRONG",
      "A row of moon phases that says IT'S JUST A PHASE",
      "A paper airplane with a dotted trail that says ELSEWHERE",
    ],
  },
];

export const ALL_IDEAS = PROMPT_IDEAS.flatMap((group) => group.ideas);

// A few different ideas, skipping the ones on screen now.
export function pickIdeas(count: number, skip: Array<string> = [], random = Math.random) {
  const pool = ALL_IDEAS.filter((idea) => !skip.includes(idea));
  const picked: Array<string> = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}
