export type Kind = '电影' | '动漫' | '电视剧' | '音乐' | '视频';
export type Platform = string;
export interface LocalFileInfo { name: string; size: number; mime: string; fingerprint: string; lastModified: number }
export interface Media {
  id: string; title: string; subtitle: string; kind: Kind; platform: Platform;
  cover: string; hero?: string; year?: string; duration: string; rating?: string;
  tags: string[]; description: string; url: string; playbackUrl?: string;
  playbackType: 'video' | 'audio' | 'embed' | 'external' | 'local';
  localFile?: LocalFileInfo; episodes?: { title: string; url: string; page?: number }[]; defaultEpisode?: number;
  download?: { provider: 'bilibili'; bvid: string; page: number; available?: boolean };
  sourceId?: string; sourceKey?: string; live?: boolean;
  demo?: boolean; attribution?: string; stats?: { views?: number; danmaku?: number; comments?: number; favorites?: number };
}
export interface Playlist { id: string; title: string; description: string; ids: string[]; color: string }
export interface Member { id: string; nickname: string; mic: boolean }
export interface ChatMessage { id: string; nickname: string; text: string; at: number; type: 'chat' | 'danmaku' | 'system'; sender?: string }
export interface PlaybackState { playing: boolean; time: number; updatedAt: number }
export interface RoomState {
  id: string; name: string; media: Media; hostId: string; seedId?: string; members: Member[];
  messages: ChatMessage[]; playback: PlaybackState; public: boolean;
}
export interface PublicRoom { id: string; name: string; media: Media; count: number; createdAt: number }
export interface Comment { id: string; nickname: string; text: string; at: number }
export interface CatalogSource { id: string; name: string; type: string; url: string; searchUrl?: string; kind: string; enabled: boolean; description: string; status: { state: string; message: string; count?: number } }
export interface NetworkInfo { state: string; publicUrl: string; message: string; temporary: boolean; canManage: boolean; lanUrls: string[]; turnConfigured: boolean }
