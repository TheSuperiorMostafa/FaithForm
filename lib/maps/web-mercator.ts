/**
 * The Web Mercator arithmetic behind the campus map in check-in setup.
 *
 * Pure and dependency-free, so it runs in the browser and in a unit test. It
 * places standard 256-pixel OpenStreetMap tiles around a point, turns a click
 * back into a coordinate, and sizes the check-in circle in pixels. No map
 * library and no API key: a church positioning its building needs a picture
 * and a pin, not a mapping platform.
 */

export const TILE_SIZE = 256;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;

/** Mercator is undefined at the poles; tiles stop at this latitude. */
const MAX_LATITUDE = 85.05112878;

const clampLatitude = (latitude: number) =>
  Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));

function worldSize(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** A coordinate as global pixels at `zoom`. */
export function project(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number } {
  const size = worldSize(zoom);
  const sin = Math.sin((clampLatitude(latitude) * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Global pixels at `zoom` back to a coordinate, longitude wrapped to ±180. */
export function unproject(
  x: number,
  y: number,
  zoom: number,
): { latitude: number; longitude: number } {
  const size = worldSize(zoom);
  // x / size * 360 is longitude + 180; wrapped into [0, 360) first so a click
  // across the antimeridian lands on the other side rather than past ±180.
  const longitude = ((((x / size) * 360) % 360) + 360) % 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude: clampLatitude(latitude), longitude };
}

/** Ground metres covered by one pixel at this latitude and zoom. */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (
    (Math.cos((clampLatitude(latitude) * Math.PI) / 180) * 2 * Math.PI * 6_378_137) /
    worldSize(zoom)
  );
}

/**
 * The closest zoom at which a circle of `radiusMeters` fills about
 * `fillFraction` of the shorter side of the map, so the whole check-in area is
 * visible with some street around it.
 */
export function zoomToFit(
  latitude: number,
  radiusMeters: number,
  shortSidePixels: number,
  fillFraction = 0.6,
): number {
  if (!(radiusMeters > 0) || !(shortSidePixels > 0)) return 16;
  const targetMpp = (2 * radiusMeters) / (shortSidePixels * fillFraction);
  const zoom = Math.floor(
    Math.log2(
      (Math.cos((clampLatitude(latitude) * Math.PI) / 180) * 2 * Math.PI * 6_378_137) /
        (TILE_SIZE * targetMpp),
    ),
  );
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export type PlacedTile = {
  key: string;
  url: string;
  left: number;
  top: number;
};

/**
 * Every tile needed to cover a `width` by `height` viewport centred on a
 * coordinate, positioned relative to the viewport's top-left corner.
 */
export function tilesForViewport(input: {
  latitude: number;
  longitude: number;
  zoom: number;
  width: number;
  height: number;
  tileUrl?: (z: number, x: number, y: number) => string;
}): PlacedTile[] {
  const { zoom, width, height } = input;
  const center = project(input.latitude, input.longitude, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;
  const count = 2 ** zoom;
  const url =
    input.tileUrl ??
    ((z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`);

  const tiles: PlacedTile[] = [];
  for (let ty = Math.floor(originY / TILE_SIZE); ty * TILE_SIZE < originY + height; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(originX / TILE_SIZE); tx * TILE_SIZE < originX + width; tx++) {
      const wrapped = ((tx % count) + count) % count;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: url(zoom, wrapped, ty),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** The coordinate under a point in a viewport centred on `center`. */
export function coordinateAtViewportPoint(input: {
  center: { latitude: number; longitude: number };
  zoom: number;
  width: number;
  height: number;
  pointX: number;
  pointY: number;
}): { latitude: number; longitude: number } {
  const center = project(input.center.latitude, input.center.longitude, input.zoom);
  return unproject(
    center.x - input.width / 2 + input.pointX,
    center.y - input.height / 2 + input.pointY,
    input.zoom,
  );
}
