// The places above the cell, as the dock and the intro know places: each a zoom (log10 of the view distance in metres)
// and a look, with its scale, a line and things to look for. Their ids start 'u:' so the app knows whose camera
// flies there.
import type { Place } from '../ui/places';
import { INTRO } from '../ui/intro';

export interface CosmosPlace extends Place { logS: number }

const place = (id: string, name: string, logS: number, pitch: number, line: string, size: string, tips: [string, string, string?][]): CosmosPlace => {
  INTRO[id] = { size, tips: tips.map(([k, t, act]) => ({ k, t, act })) };
  return { id, name, logS, pitch, yaw: 0.4, line, art: '', at: [0, 0, 0], scale: 0 };
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
    ['Next', 'Someone lying in the grass', 'place:u:hand'],
  ]),
  place('u:hand', 'A hand in the grass', -0.35, -0.75, 'Resting in the meadow, in the sun.', '50 cm', [
    ['Try', 'Scroll toward the back of the hand.'],
    ['Next', 'The skin, close', 'place:u:skin'],
  ]),
  place('u:skin', 'Skin', -2.4, -0.95, 'Creases, pores, a hair, and the flat dead cells that cover us.', '5 mm', [
    ['Look', 'The diamond net of creases lets skin stretch.'],
    ['Look', 'Closer, the surface breaks into plates 30 µm across: cells that have died to protect the living ones below.'],
    ['Next', 'The living cells beneath', 'place:tissue'],
  ]),
];
