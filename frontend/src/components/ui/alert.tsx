import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

const alertVariants = cva("rounded-md p-3.5 text-sm", {
  variants: {
    variant: {
      destructive: "bg-destructive-muted text-destructive-foreground",
      info: "bg-muted text-foreground",
    },
  },
  defaultVariants: { variant: "destructive" },
});

type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
