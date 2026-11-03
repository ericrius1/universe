// The places above the cell: each a zoom (log10 of the view distance in metres) and a look, with its scale and a
// line. Their ids start 'u:' so an app knows whose camera flies there. Plain data: the Universe's dock and intros show them, Fiske's console has them as its buttons.
export interface CosmosPlace { id: string; name: string; short: string; logS: number; yaw: number; pitch: number; line: string; size: string }

const place = (id: string, name: string, logS: number, pitch: number, line: string, size: string): CosmosPlace =>
  ({ id, name, short: SHORT[id] ?? name, logS, pitch, yaw: 0.4, line, size });

const SHORT: Record<string, string> = {
  'u:universe': 'Universe', 'u:web': 'Cosmic web', 'u:milkyway': 'Milky Way', 'u:neighbourhood': 'Neighbours', 'u:solar': 'Solar system',
  'u:earth': 'Earth', 'u:boulder': 'Boulder', 'u:person': 'In the grass', 'u:eye': 'An eye',
};

/** what the bottom of the dive is called: the place (its name, short, line) and whoever lies there (name, short, line) */
export interface SpotWords { name: string; short: string; line: string; person: string; personShort: string; personLine: string }
export const BOULDER_WORDS: SpotWords = {
  name: 'Boulder, Colorado', short: 'Boulder', line: 'A meadow on the plains below the Flatirons.',
  person: 'Lying in the grass', personShort: 'In the grass', personLine: 'Someone on their back in the meadow below the Flatirons, looking up at the sky.',
};

/** the places, the bottom of the dive called as `w` says */
export function cosmosPlaces(w: SpotWords): CosmosPlace[] {
  return COSMOS_PLACES.map((p) => p.id === 'u:boulder' ? { ...p, name: w.name, short: w.short, line: w.line }
    : p.id === 'u:person' ? { ...p, name: w.person, short: w.personShort, line: w.personLine } : p);
}

export const COSMOS_PLACES: CosmosPlace[] = [
  place('u:universe', 'The observable universe', 26.95, -0.25, 'Everything whose light has had time to reach us: 93 billion light-years across.', '93 billion ly'),
  place('u:web', 'The cosmic web', 24.3, -0.4, 'Galaxies strung along filaments round empty voids.', '100 million ly'),
  place('u:milkyway', 'The Milky Way', 21.35, -0.75, 'Our galaxy: a barred spiral of two hundred billion stars.', '100,000 ly'),
  place('u:neighbourhood', 'The Sun\'s neighbours', 17.7, -0.3, 'The stars within a few hundred light-years, where they really are.', '10 light-years'),
  place('u:solar', 'The solar system', 13.0, -0.62, 'The Sun, the eight planets where they are today, the belts beyond.', '70 AU'),
  place('u:earth', 'The Earth', 7.35, -0.15, 'Home: its air, its clouds, the Moon where it is tonight.', '10,000 km'),
  place('u:boulder', 'Boulder, Colorado', 3.5, -0.42, 'A meadow on the plains below the Flatirons.', '3 km'),
  place('u:person', 'Lying in the grass', 0.35, -0.95, 'Someone on their back in the meadow below the Flatirons, looking up at the sky.', '2 m'),
  place('u:eye', 'An eye', -1.75, -1.1, 'The iris through the clear cornea, the pupil, the lashes, the sky in the wet surface.', '2 cm'),
];
