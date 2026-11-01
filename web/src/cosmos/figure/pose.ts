// Written by tools/figure-pose.mjs from public/data/figure/lyra.bin.gz: don't edit.
/** who lies in the meadow (figure/cast.ts) */
export const FIGURE = 'lyra';
/** bind -> the ground frame (m): the rotation (x y z w) and its dual part (Boulder's dual-quaternion skinning, every
 *  bone the same: lying still) */
export const POSE_R = [0.50000000, -0.50000000, -0.50000000, -0.50000000] as const;
export const POSE_D = [-0.42315958, 0.34723268, -0.40718328, -0.36320898] as const;
/** the target in the bind space and the skin's way out there (the drawn eye's chart is laid on that plane up close:
 *  the mesh's facets would kink it) */
export const FIGURE_FOCUS = [-0.03195261, 1.54078452, 0.10220253] as const;
export const FIGURE_FOCUS_N = [-0.34800468, 0.00449909, 0.93748200] as const;
/** the dive's target, on the drawn right iris (the ground frame, m) */
export const FIGURE_EYE = [0.00000000, 0.22210372, 0.00000000] as const;
