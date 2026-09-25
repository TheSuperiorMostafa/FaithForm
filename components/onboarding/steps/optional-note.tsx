/** Said the same way on every optional connect step. */
export function OptionalNote() {
  return (
    <p className="rounded-xl bg-muted/60 px-4 py-3 text-base text-muted-foreground">
      This is optional. You can do it later in{" "}
      <span className="font-semibold text-foreground">Settings → Connected accounts</span>.
    </p>
  );
}
