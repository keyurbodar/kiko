import { BROWSER } from "../config"

const SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable='']",
  "[contenteditable='true']",
  ...["button", "link", "checkbox", "radio", "tab", "menuitem", "option", "combobox", "switch", "textbox", "searchbox"].map(
    (role) => `[role='${role}']`,
  ),
].join(",")

const RUNTIME = `
if (!window.__yuki) {
  const INPUT_ROLE = { file: "file", checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", image: "button", range: "slider", search: "searchbox", email: "textbox", tel: "textbox", url: "textbox", number: "spinbutton" };
  const clip = (s, n) => {
    s = (s || "").replace(/\\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "\\u2026" : s;
  };
  const role = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(" ")[0];
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") return INPUT_ROLE[el.type] || "textbox";
    return el.isContentEditable ? "textbox" : tag.toLowerCase();
  };
  const label = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const root = el.getRootNode();
      const text = by.split(/\\s+/).map((id) => { const t = root.getElementById ? root.getElementById(id) : document.getElementById(id); return t ? t.textContent : ""; }).join(" ");
      if (text.trim()) return clip(text, 80);
    }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria, 80);
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      const labels = el.labels;
      if (labels && labels.length) {
        const t = labels[0].innerText;
        if (t && t.trim()) return clip(t, 80);
      }
      if (tag === "INPUT" && (el.type === "submit" || el.type === "button" || el.type === "reset") && el.value) return clip(el.value, 80);
      const p = el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name");
      return clip(p, 80);
    }
    const text = el.innerText;
    if (text && text.trim()) return clip(text, 80);
    const t = el.getAttribute("title");
    if (t) return clip(t, 80);
    const inner = el.querySelector("[title],img[alt],svg title");
    return clip(inner ? (inner.getAttribute("title") || inner.getAttribute("alt") || inner.textContent) : "", 80);
  };
  const visible = (el, rect) => {
    if (rect.width === 0 && rect.height === 0) return false;
    if (rect.bottom + window.scrollY < 0 || rect.right + window.scrollX < 0) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return false;
    return true;
  };
  window.__yuki = { n: 0, els: new Map(), clip, role, label, visible };
}
`

export const GZIP_MARK = "gz:"
const GZIP_FROM = 8_000

const READ_BODY = `
// A load event can fire for the previous document, so a read can land mid-parse on a body-less html.
// Wait, bounded, until this document really has a body.
if (!document.body || document.readyState === "loading") {
  const until = performance.now() + ${BROWSER.loadMs};
  while ((!document.body || document.readyState === "loading") && performance.now() < until) {
    const { promise, resolve } = Promise.withResolvers();
    // check-rules: allow no-timer-in-do page script text the browser runs, not the Durable Object
    setTimeout(resolve, 50);
    await promise;
  }
}
const Y = window.__yuki;
const CAP = ${BROWSER.controlsMax};
const SELECTOR = ${JSON.stringify(SELECTOR)};
const found = [];
const roots = [document];
for (let r = 0; r < roots.length; r++) {
  const root = roots[r];
  const list = root.querySelectorAll(SELECTOR);
  for (let i = 0; i < list.length; i++) found.push(list[i]);
  const all = root.querySelectorAll("*");
  for (let i = 0; i < all.length; i++) if (all[i].shadowRoot) roots.push(all[i].shadowRoot);
}
const vh = window.innerHeight;
const candidates = [];
for (let i = 0; i < found.length; i++) {
  const el = found[i];
  if (el.tagName === "INPUT" && el.type === "hidden") continue;
  const file = el.tagName === "INPUT" && el.type === "file";
  if (el.closest("[aria-hidden='true'],[inert]")) continue;
  const rect = el.getBoundingClientRect();
  if (!file && !Y.visible(el, rect)) continue;
  const dist = rect.bottom < 0 ? -rect.bottom : rect.top > vh ? rect.top - vh : 0;
  candidates.push({ el, rect, dist, order: i });
}
let kept = candidates;
if (candidates.length > CAP) {
  kept = candidates.slice().sort((a, b) => a.dist - b.dist || a.order - b.order).slice(0, CAP);
  kept.sort((a, b) => a.order - b.order);
}
const sigCounts = new Map();
const blockOf = new Map();
const sig = (el) => el.tagName + "|" + (el.getAttribute("class") || "");
const siblingsBySig = (parent) => {
  let m = sigCounts.get(parent);
  if (m) return m;
  m = new Map();
  const kids = parent.children;
  for (let i = 0; i < kids.length; i++) {
    const s = sig(kids[i]);
    const list = m.get(s);
    if (list) list.push(kids[i]); else m.set(s, [kids[i]]);
  }
  sigCounts.set(parent, m);
  return m;
};
const block = (el) => {
  const seen = [];
  let node = el;
  let hit = null;
  for (let depth = 0; node && depth < 10; depth++) {
    if (blockOf.has(node)) { hit = blockOf.get(node); break; }
    seen.push(node);
    const parent = node.parentElement;
    if (!parent || parent === document.documentElement) break;
    const same = siblingsBySig(parent).get(sig(node));
    if (same && same.length >= 3) {
      let head = node.querySelector("h1,h2,h3,h4,h5,h6");
      if (!head) {
        const links = node.querySelectorAll("a[href]");
        for (let i = 0; i < links.length && !head; i++) if (links[i].textContent.trim()) head = links[i];
      }
      hit = { n: same.indexOf(node) + 1, title: head ? Y.clip(head.textContent, 40) : "" };
      break;
    }
    node = parent;
  }
  for (const s of seen) blockOf.set(s, hit);
  return hit;
};
const origin = location.origin;
const controls = [];
for (const c of kept) {
  const el = c.el;
  let id = Number(el.getAttribute("data-yuki-id"));
  if (!id || Y.els.get(id)?.deref() !== el) {
    id = ++Y.n;
    el.setAttribute("data-yuki-id", String(id));
  }
  Y.els.set(id, new WeakRef(el));
  const role = Y.role(el);
  const label = Y.label(el);
  const out = { id, role, label };
  const tag = el.tagName;
  if (tag === "SELECT") {
    const opt = el.selectedOptions && el.selectedOptions[0];
    if (opt) out.value = Y.clip(opt.text, 80);
  } else if ((tag === "INPUT" && el.type !== "checkbox" && el.type !== "radio" && el.type !== "submit" && el.type !== "button") || tag === "TEXTAREA") {
    if (el.value) out.value = Y.clip(el.value, 80);
  } else if (el.isContentEditable && tag !== "A") {
    const t = el.innerText;
    if (t && t.trim() && t.trim() !== label) out.value = Y.clip(t, 80);
  }
  const state = [];
  if (el.checked || el.getAttribute("aria-checked") === "true") state.push("checked");
  if (el.disabled || el.getAttribute("aria-disabled") === "true") state.push("disabled");
  const exp = el.getAttribute("aria-expanded");
  if (exp) state.push(exp === "true" ? "expanded" : "collapsed");
  if (el.getAttribute("aria-selected") === "true") state.push("selected");
  if (el.getAttribute("aria-pressed") === "true") state.push("pressed");
  if (el.getAttribute("aria-current") && el.getAttribute("aria-current") !== "false") state.push("current");
  if (el.type === "password" || /one-time-code|cc-number|cc-csc|cc-exp|current-password|new-password/.test(el.getAttribute("autocomplete") || "")) state.push("secret");
  if (c.dist > 0) state.push("offscreen");
  if (state.length) out.state = state.join(" ");
  const b = block(el);
  if (b) out.hint = "item " + b.n + (b.title && b.title !== label ? ", " + b.title : "");
  if (tag === "A" && el.href && !el.href.startsWith("javascript:")) {
    const href = el.href.startsWith(origin + "/") ? el.href.slice(origin.length) : el.href;
    out.href = href.length > 200 ? href.slice(0, 200) : href;
  }
  controls.push(out);
}
const text = (document.body ? document.body.innerText : "").slice(0, ${BROWSER.textMax});
let h = 2166136261;
// Field values and checked state are part of the key, so filling a form reads as progress. Scrolling is not.
let head = text.slice(0, 2000);
for (const c of controls) {
  const s = (c.state || "").replace("offscreen", "");
  if (c.value || s.trim()) head += "|" + (c.value || "") + s;
}
for (let i = 0; i < head.length; i++) { h ^= head.charCodeAt(i); h = Math.imul(h, 16777619); }
const url = location.href;
const json = JSON.stringify({
  key: url + "#" + controls.length + "#" + (h >>> 0).toString(36),
  url,
  title: document.title,
  controls,
  text,
  omitted: candidates.length - kept.length,
});
if (json.length < ${GZIP_FROM} || typeof CompressionStream !== "function") return json;
return new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer().then((buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return "${GZIP_MARK}" + btoa(bin);
});
`

// Large views come back gzipped: 41 KB of JSON took 2-4 round trips from Kernel, 8.7 KB took one.
export const READ_SCRIPT = `(async () => {${RUNTIME}${READ_BODY}})()`

export const guardScript = (id: number, label: string, focus: boolean) => `(() => {
  const Y = window.__yuki;
  const el = Y && Y.els.get(${id})?.deref();
  if (!el || !el.isConnected) return { status: "gone" };
  let rect = el.getBoundingClientRect();
  if (!Y.visible(el, rect)) return { status: "hidden" };
  const now = Y.label(el);
  if (now !== ${JSON.stringify(label)}) return { status: "stale", label: now };
  if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    rect = el.getBoundingClientRect();
  }
  ${focus ? "el.focus(); if (typeof el.select === 'function') el.select(); else if (el.isContentEditable) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }" : ""}
  const role = Y.role(el);
  return { status: "ok", x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, menu: role === "combobox" || el.hasAttribute("aria-haspopup") };
})()`

export const selectScript = (id: number, option: string) => `(() => {
  const el = window.__yuki?.els.get(${id})?.deref();
  if (!el || !el.isConnected) return "gone";
  if (el.tagName !== "SELECT") return "not a select";
  const want = ${JSON.stringify(option)}.trim().toLowerCase();
  const opts = Array.from(el.options);
  const opt = opts.find((o) => o.text.trim().toLowerCase() === want) || opts.find((o) => o.value.toLowerCase() === want) || opts.find((o) => o.text.trim().toLowerCase().includes(want));
  if (!opt) return "no option";
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
})()`

export const settleScript = (menu: boolean) => `new Promise((done) => {
  let frames = 0;
  const finish = () => {
    if (!${menu}) return done(true);
    const start = performance.now();
    const look = () => {
      const m = document.querySelector("[role=listbox],[role=menu]");
      if ((m && m.getBoundingClientRect().height > 0) || performance.now() - start > ${BROWSER.menuSettleMs}) return done(true);
      // check-rules: allow no-timer-in-do page script text the browser runs, not the Durable Object
      setTimeout(look, 16);
    };
    look();
  };
  let finished = false;
  const once = () => { if (!finished) { finished = true; finish(); } };
  // check-rules: allow no-timer-in-do page script text the browser runs, not the Durable Object
  setTimeout(once, ${BROWSER.settleMs});
  const tick = () => { if (++frames >= 2) once(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})`
