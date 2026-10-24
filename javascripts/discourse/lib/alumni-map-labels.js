const LABEL_GAP = 8;

function validBox(box) {
  return (
    box &&
    [box.left, box.right, box.top, box.bottom].every(Number.isFinite) &&
    box.right > box.left &&
    box.bottom > box.top
  );
}

function boxesTooClose(left, right) {
  const horizontalGap = Math.max(
    left.left - right.right,
    right.left - left.right,
    0
  );
  const verticalGap = Math.max(
    left.top - right.bottom,
    right.top - left.bottom,
    0
  );
  return Math.hypot(horizontalGap, verticalGap) < LABEL_GAP;
}

export function labelFontSize(zoom) {
  return Math.max(10, Math.min(9 + zoom, 18));
}

export function visibleLabelLayers(candidates, size, excludedBoxes = []) {
  if (
    !size ||
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    size.x <= 0 ||
    size.y <= 0
  ) {
    return [];
  }
  const accepted = [];
  const excluded = excludedBoxes.filter(validBox);
  const count = (candidate) =>
    Number.isFinite(candidate.count) ? candidate.count : 0;
  const ordered = [...candidates].sort(
    (left, right) =>
      Number(Boolean(right.selected)) - Number(Boolean(left.selected)) ||
      count(right) - count(left)
  );
  for (const candidate of ordered) {
    const box = candidate.box;
    if (
      !validBox(box) ||
      box.left < 0 ||
      box.top < 0 ||
      box.right > size.x ||
      box.bottom > size.y ||
      excluded.some((other) => boxesTooClose(box, other)) ||
      accepted.some(({ box: other }) => boxesTooClose(box, other))
    ) {
      continue;
    }
    accepted.push(candidate);
  }
  return accepted.map(({ layer }) => layer);
}
