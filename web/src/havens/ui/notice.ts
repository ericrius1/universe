// A small notice at the top of the screen that fades on its own: who you've just become ("Aang · Airbender ..."). One
// at a time; a new one replaces the last. It wears the kit's glass (ui/kit.ts: its --k-* tokens, with their values to
// fall back on before the kit is in). It's part of the UI '/' hides (ui/panel.ts: everything under .havens-ui).

let el: HTMLDivElement | null = null;
let timer = 0;

export function notice(html: string, seconds = 4) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'havens-ui';
    el.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:30;pointer-events:none;padding:9px 16px;'
      + 'border-radius:999px;background:var(--k-glass,rgba(14,16,26,0.72));color:var(--k-text,#e9ecf8);border:1px solid var(--k-line,rgba(160,180,255,0.1));'
      + 'font:400 13px/1.3 var(--k-ui,ui-sans-serif,system-ui,sans-serif);letter-spacing:0.02em;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);'
      + 'opacity:0;transition:opacity 0.3s;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis';
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.style.opacity = '1';
  clearTimeout(timer);
  timer = window.setTimeout(() => { if (el) el.style.opacity = '0'; }, seconds * 1000);
}
