import { worldMapNodes } from "../domain/worldMap";

type Waypoint = readonly [number, number];

export const atlasNodes = new Map(worldMapNodes.map(node => [node.id, node]));
const routeKey = (from: string, to: string) => [from, to].sort().join("|");

// Percent coordinates on the 1672 × 941 atlas. Waypoints track trails,
// bridges and coastlines, while the domain graph defines the connections.
const trails: Array<[string, string, Waypoint[]]> = [
  ["home", "southwest", [[20, 77], [15, 78]]],
  ["home", "south", [[21, 80]]],
  ["west", "south", [[13, 78], [18, 80]]],
  ["south", "southeast", [[24.1, 83.5], [25.2, 79.8]]],
  ["southeast", "east", [[26.5, 77.5], [28.3, 73.5]]],
  ["east", "center", [[24.6, 72.5], [22.2, 66.8], [19.8, 66.6]]],
  ["south", "center", [[19.1, 81], [17.1, 77.5], [18.4, 72.8]]],
  ["center", "northwest", [[13, 71.6], [10.8, 69.4]]],
  ["northwest", "northeast", [[12.6, 61.8], [14.1, 59.3]]],
  ["northeast", "island", [[19.8, 61.4], [24.2, 62.9], [27.4, 65.6], [30.4, 66.8], [33.1, 63.7], [35.4, 61.5]]],
  ["center", "island", [[20.7, 64.3], [24.4, 65], [27.8, 69], [30.6, 66.8], [32.7, 64.6], [35.3, 62.1]]],
  ["island", "nw-01", [[38.1, 53.8], [35.3, 52.5]]],
  ["nw-01", "nw-02", [[32, 44.5], [31.3, 39.2]]],
  ["nw-02", "nw-03", [[31.5, 37.1], [28.6, 35.8]]],
  ["nw-03", "nw-04", [[31.2, 38.4], [35.0, 37.1], [38.7, 34.5], [42.5, 35.3], [45.9, 34.5]]],
  ["nw-01", "nw-04", [[38.1, 45.7], [43.2, 45.3], [46.8, 42.1], [47.3, 37.8]]],
  ["nw-04", "nw-05", [[46.7, 35.4], [43.7, 35.5], [40.4, 34.8]]],
  ["nw-05", "nw-06", [[39.9, 29.6]]],
  ["nw-06", "nw-07", [[43.2, 24.7], [42.3, 22.7]]],
  ["nw-04", "nw-07", [[44.4, 30.4], [42.5, 26.4], [42.2, 23.1]]],
  ["nw-07", "nw-08", [[36.1, 20], [34, 19]]],
  ["nw-08", "nw-09", [[32, 15], [33.4, 14]]],
  ["nw-09", "nw-10", [[37.2, 12.8]]],
  ["nw-07", "nw-10", [[36.8, 17.2], [38.2, 14.2]]],
  ["island", "se-01", [[43.9, 52.6], [47.1, 46.5], [49, 47.4], [50.3, 51.7], [52.6, 52.6]]],
  ["se-01", "se-02", [[58.7, 47.1], [62.7, 46.8]]],
  ["se-02", "se-03", [[66.8, 54], [69.1, 59.3]]],
  ["se-03", "se-04", [[74.6, 66.7], [76.7, 69.3]]],
  ["se-01", "se-04", [[59.2, 52.3], [62.2, 54.7], [68.6, 56.4], [70.4, 60], [75.5, 67.4]]],
  ["se-04", "se-05", [[78.0, 75.8], [74.3, 77.6]]],
  ["se-05", "se-06", [[73.4, 83.3], [75.5, 85.7]]],
  ["se-06", "se-07", [[73.9, 85.4], [68.4, 87.1], [65.3, 85.5]]],
  ["se-04", "se-07", [[76.7, 77.1], [70.0, 81.4], [65.3, 78.1]]],
  ["se-07", "se-08", [[63.6, 78], [61.6, 75.4], [59.1, 74.1]]],
  ["se-08", "se-09", [[56.3, 68.2], [53.3, 65.0], [51.1, 60.4]]],
  ["se-09", "se-10", [[54.7, 53.5], [57.9, 54.0]]],
  ["se-07", "se-10", [[62.3, 76.2], [56, 71.5], [61.3, 65.8], [64.9, 62.7], [65.0, 59.0]]],
  ["nw-04", "ne-01", [[51.6, 32.4], [56.4, 30.1], [60.9, 28.5], [65.3, 30.4]]],
  ["se-09", "ne-02", [[57.5, 52.2], [64.5, 53.4], [69.8, 53.5], [73.4, 53.9], [76.1, 49.5], [80.1, 44.9]]],
  ["ne-01", "ne-02", [[70.3, 37.1], [74.7, 38]]],
  ["ne-02", "ne-03", [[83.3, 43.1], [89.5, 43.8]]],
  ["ne-03", "ne-04", [[90.6, 38.9], [89.3, 35.8], [90.2, 32.4]]],
  ["ne-01", "ne-04", [[75.1, 35], [79.5, 34.6], [81.8, 32.5], [86.1, 31.2]]],
  ["ne-04", "ne-05", [[89.3, 26.2], [91, 23.5]]],
  ["ne-05", "ne-06", [[86.4, 23.7], [83.3, 24.4]]],
  ["ne-06", "ne-07", [[77.9, 24.3], [74.1, 22.4]]],
  ["ne-04", "ne-07", [[85.9, 29.6], [83.2, 27.1], [79.3, 25.8], [75.3, 23.2]]],
  ["ne-07", "ne-08", [[75.2, 17.7], [77.7, 17.8]]],
  ["ne-08", "ne-09", [[77.8, 14.3], [77.5, 11.9]]],
  ["ne-09", "ne-10", [[82.4, 10.9]]],
  ["ne-07", "ne-10", [[76.6, 17.9], [81.1, 16.6], [84.2, 13.6]]],
];

const waypoints = new Map(trails.map(([from, to, points]) =>
  [routeKey(from, to), from < to ? points : points.slice().reverse()],
));

function routePath(points: Waypoint[]) {
  const [start, ...rest] = points;
  const path = rest.slice(0, -1).map(([x, y], index) => {
    const [nextX, nextY] = rest[index + 1];
    return `Q ${x} ${y} ${(x + nextX) / 2} ${(y + nextY) / 2}`;
  });
  return `M ${start.join(" ")} ${path.join(" ")} L ${rest.at(-1)!.join(" ")}`;
}

export const atlasRoutes = worldMapNodes.flatMap(node =>
  node.neighbors.filter(neighbor => node.id < neighbor).map(neighbor => {
    const to = atlasNodes.get(neighbor)!;
    const key = routeKey(node.id, neighbor);
    const via = waypoints.get(key) ?? [];
    return {
      key, from: node.id, to: neighbor,
      path: routePath([[node.x, node.y], ...via, [to.x, to.y]]),
      crossing: (node.region !== to.region && key !== routeKey("island", "nw-01")) || key === routeKey("island", "se-01"),
    };
  }),
);
