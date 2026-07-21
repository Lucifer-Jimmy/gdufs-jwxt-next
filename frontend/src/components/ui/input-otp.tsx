import { OTPInput, OTPInputContext, type SlotProps } from "input-otp";
import { Minus } from "lucide-react";
import {
  type ComponentProps,
  type HTMLAttributes,
  useContext,
} from "react";

import { cn } from "../../lib/utils";

type InputOTPProps = ComponentProps<typeof OTPInput> & {
  containerClassName?: string;
};

export function InputOTP({
  className,
  containerClassName,
  ...props
}: InputOTPProps) {
  return (
    <OTPInput
      containerClassName={cn(
        "flex items-center gap-2 has-[:disabled]:opacity-50",
        containerClassName,
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

export function InputOTPGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center", className)} {...props} />;
}

type InputOTPSlotProps = HTMLAttributes<HTMLDivElement> & { index: number };

export function InputOTPSlot({
  index,
  className,
  ...props
}: InputOTPSlotProps) {
  const context = useContext(OTPInputContext);
  const slot: SlotProps | undefined = context?.slots[index];
  const { char, hasFakeCaret, isActive } = slot ?? {};

  return (
    <div
      className={cn(
        "relative flex h-11 w-11 items-center justify-center border-y border-r border-input bg-background text-base font-semibold tabular-nums text-foreground transition-[border-color,box-shadow] duration-200 first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "z-10 border-ring ring-2 ring-ring/25",
        className,
      )}
      {...props}
    >
      {char ?? null}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-foreground" />
        </div>
      ) : null}
    </div>
  );
}

export function InputOTPSeparator({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-muted-foreground", className)}
      role="separator"
      {...props}
    >
      <Minus aria-hidden="true" className="size-4" />
    </div>
  );
}
