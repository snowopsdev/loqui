/** Browser companion: run against the actual ControlPanel/Notes editor fixture.
 * No replacement layout or CSS. Call after positioning a synthetic document's
 * real mention at a visible edge and opening its production preview.
 */
export function checkMentionHoverPlacement() {
  const card = document.querySelector<HTMLElement>("[data-mention-hover-card]");
  if (!card) throw new Error("No production mention card is mounted");
  const chip = card.parentElement!.querySelector<HTMLElement>("button[data-mention]")!;
  const bounds = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let el = chip.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      bounds.left = Math.max(bounds.left, rect.left + el.clientLeft);
      bounds.right = Math.min(bounds.right, rect.left + el.clientLeft + el.clientWidth);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      bounds.top = Math.max(bounds.top, rect.top + el.clientTop);
      bounds.bottom = Math.min(bounds.bottom, rect.top + el.clientTop + el.clientHeight);
    }
  }
  const rect = card.getBoundingClientRect();
  if (
    getComputedStyle(card).visibility !== "visible" ||
    rect.left < bounds.left ||
    rect.right > bounds.right ||
    rect.top < bounds.top ||
    rect.bottom > bounds.bottom
  )
    throw new Error(
      `Production hover card escapes visible bounds: ${JSON.stringify({ rect, bounds })}`
    );
  const actions = [...card.querySelectorAll("button")].map((button) => {
    const rect = button.getBoundingClientRect();
    const hit = button.contains(
      document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    );
    if (!hit) throw new Error(`Production ${button.textContent} is unreachable at ${rect.y}`);
    return { text: button.textContent, rect: rect.toJSON(), hit };
  });
  if (!actions.length) throw new Error("Wait for a ready or Retry preview before checking actions");
  return { chip: chip.getBoundingClientRect().toJSON(), card: rect.toJSON(), bounds, actions };
}
