// The parts library (README.md beside this): the town's repeated pieces as parametric, seeded prototypes laid through
// an ArchBuilder at a detail level, each under its own owner inside the caller's.
export { PROUD, DETAILS, byDetail, Rand, LAMP, CLOTHS, GLAZES, PAINTS, GLASS, sheet, revolve, annulus, facets, region, rectOn, proud, lightAt } from './kit';
export type { Detail, PartOpts, Laid } from './kit';
export { column, abacusOf, type Order, type ColumnOpts } from './columns';
export { archCurve, pierced, soffitOf, archivolt, arcade, type ArchKind, type Curve, type CurveOpts, type Bay, type PiercedOpts, type ArcadeOpts } from './arches';
export { windowPart, door, portal, grillePart, shapeOf, reveal, fillAt, type WindowKind, type WindowOpts, type DoorKind, type DoorOpts, type PortalOpts, type GrilleKind, type GrilleOpts, type Shape } from './openings';
export { lantern, type LanternKind, type LanternOpts } from './lanterns';
export { domePart, domeProfile, finialPart, merlon, crenellation, awning, bracket, slabXY, stay, smooth, type DomeKind, type DomeOpts, type FinialKind, type FinialOpts, type MerlonKind, type MerlonOpts, type CrenellationOpts, type AwningKind, type AwningOpts, type BracketKind, type BracketOpts } from './roofs';
export { moulding, profileOf, type ProfileName, type Profile, type MouldingOpts } from './mouldings';
export { flight, type FlightOpts } from './stairs';
export { balustrade, baluster, type BalusterKind, type BalusterOpts, type BalustradeOpts } from './balustrade';
