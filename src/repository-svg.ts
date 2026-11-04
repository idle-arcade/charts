// Upstream circle packing can vary at ~1e-13 pixels between identical runs.
// Normalize geometry only; keep file names, labels, paths and colors untouched.
export function normalizeRepositorySvg(svg: string): string {
  return svg.replace(
    /(\b(?:transform|r|cx|cy|x|y|width|height|stroke-width|stroke-opacity|d|viewBox)=")([^"]*)(")/g,
    (_match, start: string, value: string, end: string) =>
      start +
      value.replace(/-?\d+\.\d+(?:e[-+]?\d+)?/gi, (number) =>
        String(Number(Number(number).toFixed(4))),
      ) +
      end,
  );
}
