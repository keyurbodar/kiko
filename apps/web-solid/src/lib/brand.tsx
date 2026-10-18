/*
 * Kiko's logo. The mark is Lahn's bunny from the warm-refresh PR, flattened: one cream body, two
 * leaves, red eyes with a white catchlight. No gradient, no glow, no drop shadow, because the mark
 * sits on the aurora band, on a black favicon tile and on near-white, and a lit edge would only work
 * on one of the three.
 *
 * Each leaf is a `[data-leaf]` group that turns about its stem, so onboarding can wiggle it. The eyes
 * are one `[data-eyes]` group so a blink is a transform on the group, not a path swap.
 */

const MARK_VIEWBOX = "14 4 92 100"
const MARK_CENTER = { x: 60, y: 54 }

function MarkPaths() {
  return (
    <g transform="translate(0 7)">
      <g transform="translate(48.5 50.5) rotate(-38)">
        <path data-leaf="back" d="M0 0C13-6 13-24 0-33C-13-24-13-6 0 0Z" fill="#55685A" />
      </g>
      <path
        d="M31 88C26 88 24 85 24.4 80C26.2 59 40.5 46 60 46C79.5 46 93.8 59 95.6 80C96 85 94 88 89 88Z"
        fill="#FBF6EC"
      />
      <g transform="translate(68 48.5) rotate(22)">
        <g data-leaf="front">
          <path d="M0 0C14-7 14-27 0-37C-14-27-14-7 0 0Z" fill="#86A38D" />
          <path
            d="M0-3Q1.6-18 0-32"
            stroke="#C3D5C6"
            stroke-width="1.5"
            fill="none"
            stroke-linecap="round"
          />
        </g>
      </g>
      <ellipse cx="38.5" cy="76.5" rx="5" ry="2.7" fill="#F2A08E" opacity=".6" />
      <ellipse cx="81" cy="74.5" rx="4.6" ry="2.5" fill="#F2A08E" opacity=".6" />
      <g data-eyes>
        <circle cx="46.4" cy="67" r="3.4" fill="#C22F2A" />
        <circle cx="70.6" cy="65.6" r="3.4" fill="#C22F2A" />
        <circle cx="45.4" cy="65.9" r="1.15" fill="#FFF" opacity=".9" />
        <circle cx="69.6" cy="64.5" r="1.15" fill="#FFF" opacity=".9" />
      </g>
    </g>
  )
}

export function KikoMark(props: { class?: string; size?: number; mood?: string }) {
  return (
    <svg
      class={props.class}
      viewBox={MARK_VIEWBOX}
      height={props.size}
      aria-hidden="true"
      data-component="kiko-mark"
      data-mood={props.mood}
    >
      <MarkPaths />
    </svg>
  )
}

/**
 * The "kiko" wordmark: Bricolage Grotesque ExtraBold, the face of the app's headings, as outlines so
 * it needs no font. The dot of its "i" is the bunny's red berry. It takes the text color.
 */
export function KikoWordmark(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="41 -769 1942 793"
      aria-hidden="true"
      data-component="kiko-wordmark"
    >
      <path
        fill="currentColor"
        d="M51 0V-712H209V-326Q241 -345 266 -368Q291 -392 310 -418Q330 -445 344 -472Q359 -500 369 -528H554Q542 -489 520 -450Q498 -412 466 -380Q435 -347 392 -323Q349 -299 295 -287V-273Q363 -286 406 -275Q450 -264 476 -238Q502 -211 516 -175Q530 -139 539 -100L561 0H386L375 -66Q368 -107 357 -140Q346 -172 324 -190Q301 -209 255 -209H209V0ZM630 0V-528H792V0ZM894 0V-712H1052V-326Q1084 -345 1109 -368Q1134 -392 1154 -418Q1173 -445 1188 -472Q1202 -500 1212 -528H1397Q1385 -489 1363 -450Q1341 -412 1310 -380Q1278 -347 1235 -323Q1192 -299 1138 -287V-273Q1206 -286 1250 -275Q1293 -264 1319 -238Q1345 -211 1359 -175Q1373 -139 1382 -100L1404 0H1229L1218 -66Q1211 -107 1200 -140Q1189 -172 1166 -190Q1144 -209 1098 -209H1052V0ZM1703 14Q1624 14 1564 -17Q1503 -48 1469 -110Q1435 -171 1435 -264Q1435 -359 1470 -420Q1504 -482 1565 -512Q1626 -542 1704 -542Q1784 -542 1844 -511Q1905 -480 1939 -418Q1973 -357 1973 -264Q1973 -168 1938 -106Q1902 -45 1840 -16Q1779 14 1703 14ZM1707 -104Q1741 -104 1764 -121Q1787 -138 1798 -172Q1810 -206 1810 -254Q1810 -307 1798 -343Q1785 -379 1760 -398Q1736 -418 1700 -418Q1667 -418 1644 -401Q1621 -384 1610 -350Q1598 -316 1598 -266Q1598 -187 1626 -146Q1655 -104 1707 -104Z"
      />
      <circle cx="712" cy="-664" r="96" fill="#C22F2A" />
    </svg>
  )
}

/**
 * The mark on its tile, for the favicon, the app icon and the boot screen. `tile` is the tile colour,
 * so the light-mode favicon can sit on near-white without a black square in the tab.
 */
export function KikoIcon(props: { class?: string; size?: number; tile?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 120 120"
      width={props.size}
      height={props.size}
      aria-hidden="true"
      data-component="kiko-icon"
    >
      <rect width="120" height="120" rx="27" fill={props.tile ?? "#0a0a0a"} />
      <g transform={`translate(60 61) scale(1.04) translate(${-MARK_CENTER.x} ${-MARK_CENTER.y})`}>
        <MarkPaths />
      </g>
    </svg>
  )
}
