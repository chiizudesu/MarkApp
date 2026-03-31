/**
 * Chakra v3 IconButton/Button inherit the button recipe’s `focusVisibleRing: "outside"` on the base
 * layer. `focusRing` / `focusVisibleRing` are styled-system props (see Chakra’s generated system
 * types) — setting both to `"none"` is the supported way to suppress the ring.
 *
 * Menu triggers keep focus while open, which would otherwise show a persistent ring. Use
 * `quietFocusRing` on those controls; pair with `chromeGhostIconProps` on `bg.muted` chrome so hover
 * stays visible (ghost variant’s default `colorPalette.subtle` hover often blends into the bar).
 */
export const quietFocusRing = {
  focusRing: "none" as const,
  focusVisibleRing: "none" as const,
};

/** Ghost icon targets on title/tool bars: visible hover without changing focus behavior. */
export const chromeGhostIconProps = {
  ...quietFocusRing,
  _hover: { bg: "bg.emphasized" },
} as const;
