// Home feed service — personalized customer home content.
// GET /home/feed/me (auth) with fallback to public /home/feed/.
import { b2cGet } from '../../api/b2cClient';
import type { HomeFeed } from '../../types/customerModels';

/** Personalized home feed; falls back to the public feed when logged out. */
export async function getHomeFeed(): Promise<HomeFeed> {
  try {
    return await b2cGet<HomeFeed>('/api/v1/home/feed/me');
  } catch {
    return b2cGet<HomeFeed>('/api/v1/home/feed/');
  }
}
