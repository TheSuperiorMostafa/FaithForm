import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

export function Logo({ size = 40, className, priority = false }: LogoProps) {
  return (
    <Image
      src="/faithform-logo.png"
      alt="FaithForm"
      width={size}
      height={size}
      priority={priority}
      className={cn("rounded-xl object-contain", className)}
    />
  );
}
