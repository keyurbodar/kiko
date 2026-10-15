# @kiko/avatar

Deterministic avatars from any string. The same name always gives the same picture. The art is a small loaf of snow with a face, drawn as SVG.

Vendored from an upstream MIT snow-avatar package, version 0.1.0 (see `LICENSE`). Names were changed to `avatar`, `avatarUri`, and `Avatar`.

## Use

```ts
import { avatar } from "@kiko/avatar";
import { avatarUri } from "@kiko/avatar/uri";
import { Avatar } from "@kiko/avatar/solid";

avatar("sora");
avatarUri("sora", { flavour: "matcha" });
<Avatar name="sora" size={32} />;
```

## Defaults

Every call applies these first, so a plain avatar has no charm, outfit, or pattern and a calm face:

```ts
{ charm: "none", outfit: "none", pattern: "none", mood: "calm" }
```

A pin you pass replaces the default for that trait only. `resolve` and `render` are the raw core and apply no defaults.

## Pins

A single value fixes a trait. A list lets the name choose among its values. Pinning one trait does not change the others.

## Rules

- Do not change the hash or the name tables. A changed hash changes every avatar. Append only.
- The core has no runtime dependencies. `solid-js` is a peer for `@kiko/avatar/solid` only.
- `test/golden.txt` records 400 renders. It must not change unless the hash is meant to change.
