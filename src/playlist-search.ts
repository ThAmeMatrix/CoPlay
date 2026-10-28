import type { Media, Playlist } from './types';

export function matchesSearch(query: string, ...values: (string | undefined)[]): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const text = normalize(values.filter(Boolean).join(' '));
  return terms.every(term => text.includes(term));
}

export const mediaMatchesSearch = (media: Media, query: string) =>
  matchesSearch(query, media.title, media.subtitle, media.platform, media.kind, ...media.tags);
export const playlistMatchesSearch = (playlist: Playlist, query: string) =>
  matchesSearch(query, playlist.title, playlist.description);
