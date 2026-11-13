// The story the places above the cell tell, in order, coming down: where we are, one address from the edge of what can
// be seen to the ground under someone's back. The same shape as the cell's story (ui/story.ts, from Cell): each chapter
// is a place with what it is, things to look for (each lights up in the view when chosen), how its size compares with
// something to hand, something to know — and here also how we know (whose measurement the picture is drawn from) and,
// for most, an instrument: a small plot or readout drawn from the same data the view draws, that answers when a thing
// in the view is tapped. Plain data: the guide (ui/) shows it, a console or a dome's script can read it.
//
// Every number here is checked against its source before it ships: `check` lists what a chapter still owes (emptied as
// each is confirmed, with the source in the commit that confirms it). Each comparison ("like") is the arithmetic done.

/** something in the view to light up: a named star (sky/names.json), a galaxy of the Local Group (galaxies/
 *  localgroup.json), a named structure (galaxies/structures.json), a body of the solar system (levels/solar.ts,
 *  orbits/orbits.json), or a whole level (cosmos/renderer.ts's ids) */
export type Thing = { star: string } | { galaxy: string } | { structure: string } | { body: string } | { level: string } | { figure: string };
export interface Look { t: string; spot?: Thing[] }

/** an instrument: what it plots, from what, and what a tap in the view does to it */
export interface Instrument {
  id: 'cmb' | 'lookback' | 'rotation' | 'hr' | 'kepler' | 'moon' | 'altitude';
  label: string;
  /** what it shows, said in a line under it */
  about: string;
  /** the data it's drawn from (public/data/…), or 'model' with the paper its curve is from */
  from: string;
}

export interface CosmosChapter {
  /** the place it's told at (cosmos/places.ts) */
  place: string;
  short: string;
  /** what this step of the address is */
  part: string;
  title: string;
  scale: string;
  /** the scale against something familiar */
  like: string;
  text: string;
  look: Look[];
  know?: string;
  /** how we know: the measurement the picture is drawn from */
  how?: string;
  instrument?: Instrument;
  /** what's still to be confirmed against a source */
  check?: string[];
}

/** the address, coarsest first: what the crumbs read on the way down */
export const ADDRESS = ['The observable universe', 'Laniakea', 'The Local Group', 'The Milky Way', 'The Orion Spur', 'The solar system', 'The Earth'];

export const COSMOS_STORY: CosmosChapter[] = [
  {
    place: 'u:universe', short: 'Universe', part: 'Everything we can see', title: 'The observable universe', scale: '93 billion light-years', like: 'shrink it to the size of the Earth and the Milky Way is as long as a bus',
    text: 'This is everything whose light has had time to reach us in 13.8 billion years. It is not all there is: it is a horizon, like the sea\'s, and every place in the universe has its own. The mottled skin is the oldest light there is, the cosmic microwave background, let go when the universe was 380,000 years old and had cooled enough to turn clear.',
    look: [
      { t: 'The mottling is real: Planck\'s map of the sky, wrapped where that light comes from.', spot: [{ level: 'web.cmb' }] },
      { t: 'A warm patch and a cool one differ by a few ten-thousandths of a degree. Everything since grew from those ripples.' },
      { t: 'Each patch is about a degree across: nearly twice the width of the full Moon.' },
    ],
    know: 'That light left at 3,000 degrees, as an orange glow. The stretching of space since has cooled it to 2.725 degrees above absolute zero.',
    how: 'The Planck satellite measured the whole sky in microwaves from 2009 to 2013. The colours are false: red a little warmer than the mean, blue a little cooler.',
    instrument: { id: 'cmb', label: 'The oldest light', about: 'The map\'s scale: 500 millionths of a degree either side of 2.725 K, and the size of the full Moon against its patches.', from: 'cmb/smica.json' },
  },
  {
    place: 'u:web', short: 'Cosmic web', part: 'The largest pattern', title: 'The cosmic web', scale: '1 billion light-years', like: 'if our galaxy were a dinner plate, the nearest big cluster of galaxies would be 150 metres down the street',
    text: 'On the largest scales matter is a foam. Galaxies lie along threads and sheets, gather into clusters where the threads cross, and leave the spaces between almost empty. Round us every point of light is a real galaxy where a survey found it; farther out, where no survey is complete, the pattern is drawn to match.',
    look: [
      { t: 'The Virgo Cluster: 1,300 galaxies, 54 million light-years away, the nearest big knot.', spot: [{ structure: 'Virgo Cluster' }] },
      { t: 'The Great Wall: a sheet of galaxies at least 500 million light-years long, with the Coma Cluster at its heart.', spot: [{ structure: 'CfA2 Great Wall' }, { structure: 'Coma Cluster (Abell 1656)' }] },
      { t: 'The Boötes Void: a bubble about 300 million light-years across with almost nothing in it.', spot: [{ structure: 'Bootes Void' }] },
      { t: 'The empty wedge isn\'t empty. Our own galaxy\'s dust hides a tenth of the sky from us.' },
      { t: 'The Norma Cluster, in the hidden zone: the heart of the Great Attractor, which our whole neighbourhood is falling toward.', spot: [{ structure: 'Norma Cluster (Abell 3627)' }] },
    ],
    know: 'We live in a supercluster named Laniakea, "immeasurable heaven" in Hawaiian: 100,000 galaxies in a basin 520 million light-years across.',
    how: 'The 2MASS Redshift Survey: 43,533 galaxies, each one\'s distance read from how far its light has been stretched toward the red. That stretch is a speed away from us, and the speed grows with distance. Clusters come out drawn into fingers that point at us, because their galaxies\' own motions add to it.',
    instrument: { id: 'lookback', label: 'How far, how long ago', about: 'Tap a galaxy: its redshift, the speed that is, the distance that gives, and what was happening on Earth when the light you\'d see tonight set out.', from: 'galaxies/2mrs.json' },
  },
  {
    place: 'u:localgroup', short: 'Local Group', part: 'Our family of galaxies', title: 'The Local Group', scale: '10 million light-years', like: 'a dinner plate and a serving platter seven metres apart, and crumbs',
    text: 'Our galaxy is one of two big spirals held together by their gravity, with a third smaller one and more than a hundred dwarfs caught round them. Nothing here is flying apart with the universe: this is as large as a thing held by gravity gets round us.',
    look: [
      { t: 'Andromeda: a trillion stars, 2.5 million light-years off. The farthest thing most people can see without a telescope.', spot: [{ galaxy: 'Andromeda' }] },
      { t: 'Triangulum, the third spiral.', spot: [{ galaxy: 'Triangulum' }] },
      { t: 'The Magellanic Clouds, two small galaxies falling past ours, bright in the southern sky.', spot: [{ galaxy: 'LMC' }, { galaxy: 'SMC' }] },
      { t: 'Most of the rest are dwarfs with a few million stars, many found only in the last twenty years.' },
    ],
    know: 'Andromeda is coming toward us at 110 kilometres a second. The two will probably merge in the next ten billion years, though the measurements cannot yet say when, or quite for sure.',
    how: 'These are measured distances, not redshifts: from stars of known brightness (Cepheids, the tip of the red giant branch) found in each galaxy.',
  },
  {
    place: 'u:milkyway', short: 'Milky Way', part: 'Our galaxy', title: 'The Milky Way', scale: '100,000 light-years', like: 'if the solar system out to Neptune were a coin, the galaxy would stretch from London to Moscow',
    text: 'A disc of a few hundred billion stars, 100,000 light-years across and only about 1,000 thick, with a bar through its middle and arms wound round it. Nobody has seen it from here: we are inside it. This picture is put together from counts of stars made from within.',
    look: [
      { t: 'The bar: a long crowd of old stars through the centre.' },
      { t: 'In the very middle, a black hole four million times the Sun\'s mass.', spot: [{ body: 'sgr-a' }] },
      { t: 'The Sun: about 27,000 light-years out, in a small spur between two arms.', spot: [{ body: 'sun' }] },
      { t: 'The pink knots are clouds of glowing hydrogen where stars are being born.' },
    ],
    know: 'The Sun goes round the centre at 230 kilometres a second, and still takes about 220 million years a lap. It has made about twenty.',
    how: 'The map is an artist\'s reconstruction (Robert Hurt, NASA/JPL-Caltech) from the Spitzer telescope\'s infrared counts of stars through the dust. The far side is the least certain.',
    instrument: { id: 'rotation', label: 'Too fast to hold together', about: 'How fast stars orbit at each distance from the centre: what was measured, against what the stars and gas we can see would give. The gap is dark matter.', from: 'model: Eilers et al. 2019 (229 km/s at the Sun, falling 1.7 km/s per kiloparsec, measured from 5 to 25 kpc)' },
  },
  {
    place: 'u:neighbourhood', short: 'Neighbours', part: 'The stars next door', title: 'The Sun\'s neighbours', scale: '10 light-years', like: 'if the Sun were a football, the next star would be another football 6,500 kilometres away',
    text: 'Every star here is where it really is. Space between stars is almost all space: the nearest, Alpha Centauri, is 4.4 light-years off, nine thousand times farther than Neptune. The lines are the constellations. They are a view from one place, and as you move away from the Sun they come apart.',
    look: [
      { t: 'Alpha Centauri: three stars, the nearest to us.', spot: [{ star: 'Rigil Kentaurus' }] },
      { t: 'Sirius, the brightest star in our sky: twice the Sun\'s mass, and close.', spot: [{ star: 'Sirius' }] },
      { t: 'Orion from here: seven bright stars that are not near each other at all.', spot: [{ figure: 'Ori' }] },
      { t: 'Betelgeuse, a red supergiant: put it where the Sun is and it would swallow Mars.', spot: [{ star: 'Betelgeuse' }] },
    ],
    know: 'Most of the Sun\'s real neighbours are red dwarfs too faint to see without a telescope. The bright stars of the night sky are the rare powerful ones, seen from far away.',
    how: 'The Hipparcos satellite measured each star\'s tiny shift against the far background as the Earth went round the Sun, for 118,000 stars. The shift gives the distance by triangulation: a star that swings one second of arc either side of its mean place is one parsec away, 3.26 light-years.',
    instrument: { id: 'hr', label: 'Every star, by colour and power', about: 'Each star of the catalogue by its colour and its true brightness. Most fall on one line, the main sequence, where a star spends most of its life; the giants sit above it. Tap a star to find it.', from: 'sky/stars.json' },
  },
  {
    place: 'u:solar', short: 'Solar system', part: 'Our star and its planets', title: 'The solar system', scale: '70 AU', like: 'if the Sun were a football, the Earth would be a peppercorn 24 metres away, and Neptune a pea 700 metres off',
    text: 'One star, eight planets, and every one of them where it is today. An AU is the distance from the Earth to the Sun: 150 million kilometres, eight minutes and nineteen seconds for light. Sunlight takes a little over four hours to reach Neptune.',
    look: [
      { t: 'Jupiter: more than twice the mass of all the other planets together.', spot: [{ body: 'jupiter' }] },
      { t: 'Saturn, and rings 270,000 kilometres across and in most places about ten metres thick.', spot: [{ body: 'saturn' }] },
      { t: 'The asteroid belt, between Mars and Jupiter: all of it together is about a thirtieth of the Moon.', spot: [{ body: 'belt' }] },
      { t: 'Pluto and the Kuiper belt: thousands of small icy worlds beyond Neptune.', spot: [{ body: 'pluto' }] },
      { t: 'Voyager 1, launched in 1977, the farthest thing we have made: since 19 November 2026, more than a light-day from home.', spot: [{ body: 'voyager1' }] },
    ],
    know: 'The farther a planet is from the Sun, the slower it goes, by one rule that holds for all of them. Kepler found it in 1619, and it is how we weigh the Sun.',
    how: 'Positions are from the Jet Propulsion Laboratory\'s ephemerides, the same that fly spacecraft to these worlds.',
    instrument: { id: 'kepler', label: 'One rule for every orbit', about: 'Each planet\'s year against its distance from the Sun. They fall on one line: the square of the year goes as the cube of the distance. Tap a planet to find it.', from: 'orbits/orbits.json' },
  },
  {
    place: 'u:moon', short: 'Earth and Moon', part: 'A double world', title: 'The Earth and the Moon', scale: '384,400 km', like: 'a basketball and a tennis ball, seven metres apart',
    text: 'The Moon is thirty Earths away, farther than most pictures show it. Light crosses the gap in a second and a quarter. It is where it is tonight, lit as it is tonight.',
    look: [
      { t: 'The Moon keeps one face toward us: it turns once for each trip round.', spot: [{ body: 'moon' }] },
      { t: 'Side by side, the seven other planets would just about fill the gap.' },
    ],
    know: 'The Moon is leaving: 3.8 centimetres a year, about as fast as a fingernail grows. The tides it raises are slowing the Earth\'s spin to pay for it.',
    how: 'Apollo\'s astronauts left mirrors on the Moon. Timing a laser\'s flash there and back gives the distance to within millimetres.',
    instrument: { id: 'moon', label: 'Tonight\'s Moon', about: 'Its phase from where the Sun, the Earth and the Moon really are now, and the light-time between them.', from: 'the page\'s own ephemeris (cosmos/frames.ts)' },
  },
  {
    place: 'u:earth', short: 'Earth', part: 'Home', title: 'The Earth', scale: '12,742 km', like: 'on a basketball, all the weather would fit in the thickness of two sheets of paper',
    text: 'The land and sea are the real ones, from a satellite\'s month of clear views; the clouds are real ones, stitched from a few days of passes; the lights on the night side are the real cities. The line between day and night crosses the ground at the equator at 1,670 kilometres an hour.',
    look: [
      { t: 'The thin blue line at the edge is all the air there is. Half of it is below five and a half kilometres.' },
      { t: 'The glare on the sea is the Sun\'s own reflection. Land hardly shows it: that is how a far planet could be seen to have oceans.' },
      { t: 'On the night side, the lights trace coasts, rivers and roads.' },
    ],
    know: 'Everyone who ever lived, lived here.',
    how: 'NASA\'s Blue Marble (the Terra satellite) by day, and Black Marble (Suomi NPP) by night.',
    instrument: { id: 'altitude', label: 'How high', about: 'The height above the ground as you come down, against things that fly there: the space station at 400 kilometres, the edge of space at 100, airliners at 11, Everest\'s top at 8.8.', from: 'the view\'s own height (cosmos/controls.ts)' },
  },
];
