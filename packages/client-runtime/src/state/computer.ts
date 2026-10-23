import type { ComputerFrame } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import { subscribe } from "../rpc/client"
import type { OwnerRuntimeServices } from "./runtime"

export function createComputerAtoms<E>(runtime: Atom.AtomRuntime<OwnerRuntimeServices, E>) {
  const framesAtom = Atom.family((pcId: string) =>
    runtime
      .atom(
        subscribe("pc.frames", () => Effect.succeed({ pcId })).pipe(
          Stream.map((frame) => Option.some<ComputerFrame>(frame)),
        ),
        { initialValue: Option.none<ComputerFrame>() },
      )
      .pipe(Atom.withLabel(`kiko-pc-frames:${pcId}`)),
  )

  return { framesAtom }
}
