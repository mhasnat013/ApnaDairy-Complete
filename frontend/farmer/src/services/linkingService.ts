// Manager linking — the exclusive farmer <-> area manager relationship.
// Flow: farmer picks a city -> lists that city's area managers -> sends a
// registration request to ONE manager -> manager accepts -> the farmer then
// sells daily ONLY to that manager.
//
// Backend:
//   GET    /api/v1/farmer/cities
//   GET    /api/v1/farmer/managers?city=X
//   POST   /api/v1/farmer/manager-request { area_manager_id, note? }
//          (409 when an open request already exists)
//   GET    /api/v1/farmer/manager-request   (request + status + manager, or null)
//   DELETE /api/v1/farmer/manager-request   (cancels a pending request)

import { del, get, post } from './http';

/** An area manager the farmer can link with. */
export interface AreaManager {
  id: string;
  center_name: string;
  address: string;
  city: string;
  manager_name: string;
  phone: string;
}

/** The manager attached to a registration request (backend LinkedManagerOut). */
export interface LinkedManager {
  id: string;
  center_name: string;
  city: string | null;
}

/** A registration request to an area manager. */
export interface ManagerRequest {
  id: string;
  status: string;
  note: string | null;
  reason: string | null;
  created_at: string | null;
  answered_at: string | null;
  manager: LinkedManager | null;
}

/** Cities that have area managers. */
/** A city with its area-manager availability count. */
export interface CityInfo {
  city: string;
  manager_count: number;
}

/** All cities with manager availability. Backwards-compatible: accepts the
 *  old string[] shape too (treated as cities with unknown counts). */
export async function getCities(): Promise<CityInfo[]> {
  const raw = await get<string[] | CityInfo[]>('/api/v1/farmer/cities');
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (typeof raw[0] === 'string') {
    return (raw as string[]).map((city) => ({ city, manager_count: -1 }));
  }
  return raw as CityInfo[];
}

/** Area managers serving a city. */
export async function getManagersByCity(city: string): Promise<AreaManager[]> {
  if (!city.trim()) throw new Error('Please select a city first.');
  return get<AreaManager[]>(`/api/v1/farmer/managers?city=${encodeURIComponent(city)}`);
}

/**
 * Send a registration request to ONE area manager.
 * Throws the backend's message when an open request already exists (409).
 */
export async function requestManager(
  areaManagerId: string,
  note?: string,
): Promise<ManagerRequest> {
  if (!areaManagerId) throw new Error('Please choose a manager first.');
  return post<ManagerRequest>('/api/v1/farmer/manager-request', {
    area_manager_id: areaManagerId,
    ...(note && note.trim() ? { note: note.trim() } : {}),
  });
}

/** The farmer's current registration request (null when there is none). */
export async function getManagerRequest(): Promise<ManagerRequest | null> {
  return get<ManagerRequest | null>('/api/v1/farmer/manager-request');
}

/** Cancel the pending registration request. */
export async function cancelManagerRequest(): Promise<void> {
  return del('/api/v1/farmer/manager-request');
}
