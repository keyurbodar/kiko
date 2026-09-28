import { Blobatar as Generated } from "@blobatar/react";
import type * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { cn } from "./cn";

export const FACE_SCALE = "scale-[1.18]";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type GeneratedOptions = DistributiveOmit<React.ComponentProps<typeof Generated>, "name">;

export type BlobatarProps = React.ComponentProps<typeof Avatar> & {
  name: string;
  src?: string;
  alt?: string;
  blobatar?: GeneratedOptions;
};

export function Blobatar({ name, src, alt, blobatar, className, ...props }: BlobatarProps) {
  return (
    <Avatar {...props} className={cn("after:hidden", className)}>
      {src ? <AvatarImage src={src} alt={alt ?? name} /> : null}
      <AvatarFallback className="bg-transparent">
        <Generated {...blobatar} name={name} className="size-full" />
      </AvatarFallback>
    </Avatar>
  );
}
