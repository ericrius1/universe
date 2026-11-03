// A sip of tea's shape (boulder's cast/sip.ts, its timeline and cups left there): what face.ts's drink() takes. Nothing
// here sips yet; the type keeps the face model whole.

export interface SipShape {
  /** the cup's way from the lap to the lips (0..1) */
  k: number;
  /** tipped to drink (0..1) */
  tip: number;
  /** the lips parted to the rim (0..1) */
  lips: number;
  /** the eyes closed while drinking (0..1) */
  eyes: number;
  /** the head: down to meet the cup (negative), then back a little as it tips (radians of pitch, + up) */
  nod: number;
  /** the breath out after it: content (0..1) */
  ahh: number;
}
