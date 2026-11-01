// The places above the cell: each a zoom (log10 of the view distance in metres) and a look, with its scale, a line
// and things to look for (`act` a button's: 'place:<id>'). Their ids start 'u:' so an app knows whose camera flies
// there. Plain data: the Universe's dock and intros show them, Fiske's console has them as its buttons.
export interface CosmosTip { k: string; t: string; act?: string }
export interface CosmosPlace { id: string; name: string; short: string; logS: number; yaw: number; pitch: number; line: string; size: string; tips: CosmosTip[] }

const place = (id: string, name: string, logS: number, pitch: number, line: string, size: string, tips: [string, string, string?][]): CosmosPlace =>
  ({ id, name, short: SHORT[id] ?? name, logS, pitch, yaw: 0.4, line, size, tips: tips.map(([k, t, act]) => ({ k, t, act })) });

const SHORT: Record<string, string> = {
  'u:universe': 'Universe', 'u:web': 'Cosmic web', 'u:milkyway': 'Milky Way', 'u:neighbourhood': 'Neighbours', 'u:solar': 'Solar system',
  'u:earth': 'Earth', 'u:boulder': 'Boulder', 'u:person': 'In the grass', 'u:eye': 'An eye',
};

export const COSMOS_PLACES: CosmosPlace[] = [
  place('u:universe', 'The observable universe', 26.95, -0.25, 'Everything whose light has had time to reach us: 93 billion light-years across.', '93 billion ly', [
    ['Look', 'The glowing shell is the cosmic microwave background, the oldest light there is.'],
    ['Look', 'Its warm and cool mottle is the seed of every galaxy inside it.'],
    ['Try', 'Scroll in. Keep going: a single molecule is 35 powers of ten away.'],
  ]),
  place('u:web', 'The cosmic web', 24.3, -0.4, 'Galaxies strung along filaments round empty voids.', '100 million ly', [
    ['Look', 'Every point of light is a galaxy of billions of stars.'],
    ['Look', 'Where filaments meet, galaxies crowd into clusters: the gold one is Virgo.'],
    ['Next', 'Down to our galaxy', 'place:u:milkyway'],
  ]),
  place('u:milkyway', 'The Milky Way', 21.35, -0.75, 'Our galaxy: a barred spiral of two hundred billion stars.', '100,000 ly', [
    ['Look', 'Blue arms of young stars, dark lanes of dust inside them, an old gold bar at the heart.'],
    ['Look', 'The two smudges below it are the Magellanic Clouds.'],
    ['Next', 'The Sun is out in the Orion Arm', 'place:u:neighbourhood'],
  ]),
  place('u:neighbourhood', 'The Sun\'s neighbours', 17.7, -0.3, 'The stars within a few hundred light-years, where they really are.', '10 light-years', [
    ['Look', 'The nearest, α Centauri, is 4.4 light-years away. Sirius is the bright white one.'],
    ['Look', 'Behind them all, the band of the Milky Way.'],
    ['Next', 'Into the solar system', 'place:u:solar'],
  ]),
  place('u:solar', 'The solar system', 13.0, -0.62, 'The Sun, the eight planets where they are today, the belts beyond.', '70 AU', [
    ['Look', 'The orbits are real: each planet is where it is right now.'],
    ['Look', 'The ring of dust far out is the Kuiper belt; the asteroids lie between Mars and Jupiter.'],
    ['Next', 'Home', 'place:u:earth'],
  ]),
  place('u:earth', 'The Earth', 7.35, -0.15, 'Home: its air, its clouds, the Moon where it is tonight.', '10,000 km', [
    ['Look', 'The thin blue line at the edge is all the air there is.'],
    ['Look', 'On the night side, cities.'],
    ['Next', 'Boulder, Colorado', 'place:u:boulder'],
  ]),
  place('u:boulder', 'Boulder, Colorado', 3.5, -0.42, 'A meadow on the plains below the Flatirons.', '3 km', [
    ['Look', 'The Flatirons: slabs of red sandstone tilted up against the foothills.'],
    ['Look', 'The light is the Sun where it is over Boulder now.'],
    ['Next', 'Someone lying in the grass', 'place:u:person'],
  ]),
  place('u:person', 'Lying in the grass', 0.35, -0.95, 'Someone on their back in the meadow below the Flatirons, looking up at the sky.', '2 m', [
    ['Look', 'From up here, they could be looking at you, or past you at everything else.'],
    ['Try', 'Scroll in toward their eye.'],
    ['Next', 'Their eye, close', 'place:u:eye'],
  ]),
  place('u:eye', 'An eye', -1.75, -1.1, 'The iris through the clear cornea, the pupil, the lashes, the sky in the wet surface.', '2 cm', [
    ['Look', 'The iris\u2019s fibres and crypts are as unique as a fingerprint.'],
    ['Look', 'Closer, the cornea\u2019s own surface: a few layers of flat living cells over the iris.'],
    ['Next', 'Into one of those cells', 'place:tissue'],
  ]),
];
