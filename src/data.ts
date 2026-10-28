import type { Media, Playlist } from './types';

const tmdb = (path: string) => `https://image.tmdb.org/t/p/w780${path}`;
const unsplash = (id: string, w = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=85`;
export const spaceImage = 'https://image.tmdb.org/t/p/original/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg';
const biliSearch = (title: string) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}`;
export const catalog: Media[] = [
  {
    id: 'interstellar', title: '星际穿越', subtitle: 'Interstellar', kind: '电影', platform: 'YouTube',
    cover: tmdb('/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'), hero: spaceImage, year: '2014', duration: '169 分钟', rating: '9.4',
    tags: ['科幻', '冒险', '宇宙'], description: '爱，是唯一可以超越时间与空间的事物。当人类面临生存危机，一支探险队穿越虫洞，在浩瀚宇宙中寻找新的家园。与重要的人，再赴一次星际之约。',
    url: 'https://www.youtube.com/watch?v=zSWdZVtXT7E', playbackUrl: 'https://www.youtube.com/embed/zSWdZVtXT7E', playbackType: 'embed', demo: true,
    attribution: '精选展示条目 · 播放内容为官方预告片，完整影片请前往授权平台。评分为示例推荐分。',
  },
  {
    id: 'spirited-away', title: '千与千寻', subtitle: 'Spirited Away', kind: '动漫', platform: '哔哩哔哩',
    cover: tmdb('/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg'), year: '2001', duration: '125 分钟', rating: '9.4',
    tags: ['治愈', '奇幻'], description: '穿过隧道，闯入一个神灵栖息的世界。关于成长、勇气，以及永远不要忘记自己的名字。',
    url: biliSearch('千与千寻'), playbackType: 'external', demo: true,
  },
  {
    id: 'your-name', title: '你的名字。', subtitle: 'Your Name.', kind: '动漫', platform: '哔哩哔哩',
    cover: tmdb('/q719jXXEzOoYaps6babgKnONONX.jpg'), year: '2016', duration: '106 分钟', rating: '8.5',
    tags: ['爱情', '动画'], description: '在不同的时间与天空下，两个陌生的灵魂被一条看不见的线连接。即使忘记你的名字，也会再次找到你。',
    url: biliSearch('你的名字'), playbackType: 'external', demo: true,
  },
  {
    id: 'lalaland', title: '爱乐之城', subtitle: 'La La Land', kind: '电影', platform: 'YouTube',
    cover: tmdb('/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg'), year: '2016', duration: '128 分钟', rating: '8.4',
    tags: ['爱情', '音乐'], description: '献给每一个心怀梦想的傻瓜。在洛杉矶的星光与爵士乐中，两个人相遇，也找到了各自的人生。',
    url: 'https://www.youtube.com/watch?v=0pdqf4P9MB8', playbackUrl: 'https://www.youtube.com/embed/0pdqf4P9MB8', playbackType: 'embed', demo: true,
    attribution: '精选展示条目 · 播放内容为官方预告片，评分为示例推荐分。',
  },
  {
    id: 'dune', title: '沙丘2', subtitle: 'Dune: Part Two', kind: '电影', platform: 'YouTube',
    cover: tmdb('/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg'), year: '2024', duration: '166 分钟', rating: '8.2',
    tags: ['科幻', '冒险'], description: '沙海深处，命运正在苏醒。保罗与弗雷曼人并肩，走向一场关乎宇宙未来的抉择。',
    url: 'https://www.youtube.com/watch?v=Way9Dexny3w', playbackUrl: 'https://www.youtube.com/embed/Way9Dexny3w', playbackType: 'embed', demo: true,
    attribution: '精选展示条目 · 播放内容为官方预告片，评分为示例推荐分。',
  },
  {
    id: 'soul', title: '心灵奇旅', subtitle: 'Soul', kind: '动漫', platform: '哔哩哔哩',
    cover: tmdb('/hm58Jw4Lw8OIeECIq5qyPYhAeRJ.jpg'), year: '2020', duration: '100 分钟', rating: '8.7',
    tags: ['治愈', '音乐'], description: '生活的意义，也许就藏在一片落叶、一块披萨与一段即兴旋律里。一起重新发现平凡日子的闪光。',
    url: biliSearch('心灵奇旅'), playbackType: 'external', demo: true,
  },
  {
    id: 'bunny', title: '大雄兔', subtitle: 'Big Buck Bunny', kind: '动漫', platform: '开放片源',
    cover: 'https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217', year: '2008', duration: '10 分钟',
    tags: ['动画', '开放电影', '可同步'], description: '一只大兔子，一片明亮的森林，还有一场充满笑料的小小冒险。Blender 开放电影，可直接创建放映室，体验同步观看。',
    url: 'https://peach.blender.org/', playbackUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4', playbackType: 'video',
    attribution: '© 2008 Blender Foundation · Big Buck Bunny · CC BY 3.0 · https://peach.blender.org/',
  },
  {
    id: 'sintel', title: '辛特尔：预告片', subtitle: 'Sintel · Trailer', kind: '电影', platform: '开放片源',
    cover: 'https://media.w3.org/2010/05/sintel/poster.png', year: '2010', duration: '52 秒',
    tags: ['奇幻', '开放电影', '可同步'], description: '少女辛特尔踏上寻找小龙的旅程。一起观看这部 Blender 开放电影的预告片。',
    url: 'https://durian.blender.org/', playbackUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4', playbackType: 'video',
    attribution: '© 2010 Blender Foundation · Sintel · CC BY 3.0 · https://durian.blender.org/',
  },
  {
    id: 'relax', title: '把日子过成一首诗', subtitle: '给独处的午后，一点温柔的声音', kind: '音乐', platform: '网易云音乐',
    cover: unsplash('photo-1470252649378-9c29740c9fa8'), duration: '精选歌单', tags: ['民谣', '放松'],
    description: '放下忙碌，给自己一点时间。在柔软的旋律里，找到属于自己的生活节奏。此条目为策展示例，点击前往网易云音乐发现歌曲。',
    url: 'https://music.163.com/#/discover/playlist/', playbackType: 'external', demo: true,
  },
  {
    id: 'night', title: '凌晨两点，还不想睡', subtitle: 'Lo-fi / Jazz / 深夜陪伴', kind: '音乐', platform: '网易云音乐',
    cover: unsplash('photo-1519608487953-e999c86e7455'), duration: '精选歌单', tags: ['Lo-fi', '爵士'],
    description: '城市睡了，音乐还醒着。为深夜的灵感和思绪，留一盏温暖的灯。此条目为策展示例。',
    url: 'https://music.163.com/#/discover/playlist/', playbackType: 'external', demo: true,
  },
  {
    id: 'planet', title: '地球脉动', subtitle: 'Planet Earth', kind: '电视剧', platform: '哔哩哔哩',
    cover: unsplash('photo-1441974231531-c6227db76b6e'), year: '2006', duration: '11 集', rating: '9.7', tags: ['自然', '纪录片'],
    description: '从极地冰原到热带雨林，重新认识我们共同的家园。精选展示条目，请在平台查看授权播放信息。',
    url: biliSearch('地球脉动'), playbackType: 'external', demo: true,
  },
  {
    id: 'travel', title: '去有风的地方', subtitle: '把生活，交还给生活', kind: '电视剧', platform: '哔哩哔哩',
    cover: unsplash('photo-1470770841072-f978cf4d019e'), year: '2023', duration: '40 集', rating: '8.7', tags: ['生活', '治愈'],
    description: '在小镇、田野与缓慢的日常中，重新找到生活的方向。精选展示条目，请在平台查看授权播放信息。',
    url: biliSearch('去有风的地方'), playbackType: 'external', demo: true,
  },
];
export const initialPlaylists: Playlist[] = [
  { id: 'weekend', title: '周末的电影时光', description: '把时间留给好故事，也留给自己。', ids: ['interstellar', 'lalaland', 'dune', 'bunny'], color: '#b6bfb5' },
  { id: 'healing', title: '在动画里，做一场梦', description: '总有一个世界，温柔地接住你。', ids: ['spirited-away', 'your-name', 'soul'], color: '#c2c9b5' },
  { id: 'music', title: '耳机里的小宇宙', description: '适合发呆、散步，和漫无目的的下午。', ids: ['relax', 'night'], color: '#abbec4' },
];
export const themes = [
  { title: '去宇宙，找一个答案', subtitle: '星空很远，我们很近', label: '科幻宇宙', image: spaceImage, tag: '科幻', color: '#182126' },
  { title: '今天，也要被温柔以待', subtitle: '给生活加一点治愈的魔法', label: '治愈时刻', image: unsplash('photo-1441974231531-c6227db76b6e'), tag: '治愈', color: '#687560' },
  { title: '让耳朵，去旅行', subtitle: '按下播放，世界就安静了', label: '音乐漫游', image: unsplash('photo-1470225620780-dba8ba36b745'), tag: '音乐', color: '#68675f' },
];
