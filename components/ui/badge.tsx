import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-[13px] font-semibold leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-accent-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-primary/30 text-primary dark:border-accent/50 dark:text-accent",
        success: "border-transparent bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
        warning: "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
        destructive: "border-transparent bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
        info: "border-transparent bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
