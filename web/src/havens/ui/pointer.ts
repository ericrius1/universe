// The mouse looks with the pointer locked to the view: a click anywhere on the world locks it (boulder's: "to activate
// pointer lock, just click anywhere on canvas (not any ui elements)"). A click on the settings or any other part of the
// interface doesn't, nor a touch: on a touchscreen (and a coarse pointer, a phone's) you drag to look. If the browser
// lets go of the lock (Esc, switching windows), the next click on the world takes it back.

const fine = typeof matchMedia === 'function' ? !matchMedia('(pointer: coarse)').matches : true;
/** when the lock was asked for and not yet given or refused (-Infinity: no ask pending) */
let asking = -Infinity, heard = false;
const answered = () => { asking = -Infinity; };

export const pointer = {
  /** whether the mouse looks under the lock (a mouse, not a touchscreen) */
  get wanted() { return fine; },
  /** asks for the lock; the browser may refuse (too soon after Esc, the page not focused), and that's no error */
  lock(el: HTMLElement) {
    // (one ask at a time: a second ask while the first is being granted can have the lock let go and taken again — let
    // go behaves like the browser's Esc. An ask unanswered for 2 s is given up)
    if (document.pointerLockElement === el || performance.now() - asking < 2000) return;
    if (!heard) { heard = true; document.addEventListener('pointerlockchange', answered); document.addEventListener('pointerlockerror', answered); }
    asking = performance.now();
    try { (el.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(answered); } catch { answered(); /* (an older browser throws instead) */ }
  },
  /** the world's element: a click on it takes the lock */
  install(el: HTMLElement) {
    el.addEventListener('click', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      if (fine && document.pointerLockElement !== el) pointer.lock(el);
    });
  },
};
