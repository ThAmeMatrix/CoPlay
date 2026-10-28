import type { Media, Playlist } from './types';

export function transferPlaylistItem(playlists: Playlist[], source: string, target: string, id: string, move: boolean) {
  if (source === target || !playlists.find(item => item.id === source)?.ids.includes(id) || !playlists.some(item => item.id === target)) return playlists;
  return playlists.map(item => item.id === target ? { ...item, ids: item.ids.includes(id) ? item.ids : [...item.ids, id] } : item.id === source && move ? { ...item, ids: item.ids.filter(value => value !== id) } : item);
}
export function appendPlaylistItems(playlists: Playlist[], target: string, items: Media[]) {
  return playlists.map(playlist => playlist.id === target ? { ...playlist, ids: [...new Set([...playlist.ids, ...items.map(item => item.id)])] } : playlist);
}
export function mergeImportedResources(current: Media[], incoming: Media[]) {
  const result = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) {
    const existing = result.get(item.id);
    // Rich per-video metadata and selected parts survive a lightweight collection refresh.
    if (!existing) result.set(item.id, item);
  }
  return [...result.values()];
}
