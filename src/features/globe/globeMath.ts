export interface GeoPoint { latitude: number; longitude: number }
export interface GlobeCamera { latitude: number; longitude: number }
export interface GlobeGeometry { width: number; height: number; centerX: number; centerY: number; radius: number }
export interface GlobeProjection { x: number; y: number; depth: number; visible: boolean }
export const INITIAL_GLOBE_CAMERA: GlobeCamera = { latitude: 2, longitude: 142 };
const radians = Math.PI / 180;
export function wrapLongitude(longitude: number) { return ((longitude + 180) % 360 + 360) % 360 - 180; }
export function clampLatitude(latitude: number) { return Math.max(-85, Math.min(85, latitude)); }

/** World axes: +Y north, +Z at (0°N, 0°E), +X at (0°N, 90°E). */
export function cameraBasis(camera: GlobeCamera) {
  const lat = camera.latitude * radians, lon = camera.longitude * radians;
  return {
    right: [Math.cos(lon), 0, -Math.sin(lon)],
    up: [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)],
    front: [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)],
  };
}
export function projectPoint(point: GeoPoint, camera: GlobeCamera, geometry: GlobeGeometry): GlobeProjection {
  const lat = point.latitude * radians, lon = point.longitude * radians;
  const world = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
  const basis = cameraBasis(camera);
  const dot = (axis: number[]) => axis.reduce((sum, value, index) => sum + value * world[index], 0);
  const depth = dot(basis.front);
  return { x: geometry.centerX + dot(basis.right) * geometry.radius, y: geometry.centerY - dot(basis.up) * geometry.radius,
    depth, visible: depth > 0.001 && geometry.radius > 0 };
}
/** Orthographic ray / unit-sphere intersection. The far hemisphere is never selectable. */
export function pickGlobePoint(x: number, y: number, camera: GlobeCamera, geometry: GlobeGeometry): GeoPoint | null {
  if (![x, y, geometry.radius, camera.latitude, camera.longitude].every(Number.isFinite) || geometry.radius <= 0 || geometry.width <= 0 || geometry.height <= 0) return null;
  if (x < 0 || x > geometry.width || y < 0 || y > geometry.height) return null;
  const nx = (x - geometry.centerX) / geometry.radius, ny = (geometry.centerY - y) / geometry.radius;
  const distance = nx * nx + ny * ny;
  if (distance > 1 + 1e-12) return null;
  const nz = Math.sqrt(Math.max(0, 1 - distance)), basis = cameraBasis(camera);
  const world = basis.right.map((value, index) => value * nx + basis.up[index] * ny + basis.front[index] * nz);
  return { latitude: Math.asin(Math.max(-1, Math.min(1, world[1]))) / radians, longitude: wrapLongitude(Math.atan2(world[0], world[2]) / radians) };
}
export function dragGlobe(camera: GlobeCamera, deltaX: number, deltaY: number, radius: number): GlobeCamera {
  if (!Number.isFinite(radius) || radius <= 0) return camera;
  return { longitude: wrapLongitude(camera.longitude - deltaX / radius / radians), latitude: clampLatitude(camera.latitude + deltaY / radius / radians) };
}
export function isGlobeClick(maxDistance: number) { return Number.isFinite(maxDistance) && maxDistance >= 0 && maxDistance <= 6; }
export function interpolateCamera(from: GlobeCamera, to: GlobeCamera, progress: number): GlobeCamera {
  const t = Math.max(0, Math.min(1, progress));
  const eased = t * t * (3 - 2 * t);
  return { latitude: from.latitude + (to.latitude-from.latitude)*eased, longitude: wrapLongitude(from.longitude + wrapLongitude(to.longitude-from.longitude)*eased) };
}

/** Fit the entire sphere and its atmosphere inside the viewport; picking uses CSS pixels. */
export function globeGeometry(width: number, height: number, centerX = .5, centerY = .5, radius = .46): GlobeGeometry {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const x = w * Math.max(0, Math.min(1, Number.isFinite(centerX) ? centerX : .5));
  const y = h * Math.max(0, Math.min(1, Number.isFinite(centerY) ? centerY : .5));
  const requested = Math.min(w, h) * (Number.isFinite(radius) ? Math.max(0, radius) : .46);
  const available = Math.min(x, w-x, y, h-y) - 16;
  return { width: w, height: h, centerX: x, centerY: y, radius: Math.max(0, Math.min(requested, available)) };
}
