/**
 * TokTok Clone - Core Data Store & Initial Datasets
 * Pure Vanilla JS - Zero external dependencies, runs offline.
 *
 * Classic (non-module) script so the app runs from file:// with no server.
 * Public API is exposed on the shared `TokTok` namespace.
 */

const INITIAL_VIDEOS = [
  {
    id: 'vid-cyber-neon',
    visualType: 'cyber-neon',
    creator: {
      handle: '@cyber_pulse',
      name: 'Cyber Pulse Studio',
      avatarInitial: '⚡',
      avatarBg: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
      verified: true,
      isFollowing: false
    },
    caption: 'Neon visualizer reacting to live audio spectrum frequencies! ⚡ What procedural track next? #cyberpunk #neon #audioviz #toktok #fyp',
    hashtags: ['cyberpunk', 'neon', 'audioviz', 'toktok', 'fyp'],
    soundTitle: 'Original Sound - Neon Overdrive (140 BPM Synthesized Lead)',
    stats: {
      likes: 124800,
      comments: 1842,
      bookmarks: 34100,
      shares: 9420
    },
    userState: {
      liked: false,
      bookmarked: false,
      shared: false
    },
    duration: 16,
    comments: [
      {
        id: 'c-101',
        username: '@neon_rider',
        avatarInitial: '🏍️',
        avatarBg: '#ff007f',
        timeAgo: '2h ago',
        text: 'The bass reactive pulses are insane! 🔥 Is this really pure canvas?!',
        likes: 342,
        liked: false
      },
      {
        id: 'c-102',
        username: '@synth_coder',
        avatarInitial: '💻',
        avatarBg: '#00e5ff',
        timeAgo: '5h ago',
        text: 'Zero video servers, pure code rendering at 60fps. Legendary work! 👏',
        likes: 189,
        liked: true
      },
      {
        id: 'c-103',
        username: '@digital_ghost',
        avatarInitial: '👻',
        avatarBg: '#7c3aed',
        timeAgo: '1d ago',
        text: 'Turned audio ON and my desk started vibrating 💯🚀',
        likes: 74,
        liked: false
      }
    ]
  },
  {
    id: 'vid-lofi-coffee',
    visualType: 'lofi-coffee',
    creator: {
      handle: '@cozy_vibes',
      name: 'Cozy Lo-Fi Cafe',
      avatarInitial: '☕',
      avatarBg: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
      verified: false,
      isFollowing: true
    },
    caption: 'Rainy evening coffee study session ☕🌧️ Listen with headphones for binaural rain simulation! #lofi #chill #rain #studymusic #cozy',
    hashtags: ['lofi', 'chill', 'rain', 'studymusic', 'cozy'],
    soundTitle: 'Original Sound - Rainy Window Lo-Fi E-Piano & Noise',
    stats: {
      likes: 89450,
      comments: 720,
      bookmarks: 21900,
      shares: 4120
    },
    userState: {
      liked: true,
      bookmarked: true,
      shared: false
    },
    duration: 20,
    comments: [
      {
        id: 'c-201',
        username: '@midnight_study',
        avatarInitial: '📚',
        avatarBg: '#3b82f6',
        timeAgo: '4h ago',
        text: 'Bookmarked for tonight’s cramming session. So cozy ❤️',
        likes: 156,
        liked: false
      },
      {
        id: 'c-202',
        username: '@cafe_cat',
        avatarInitial: '🐱',
        avatarBg: '#ec4899',
        timeAgo: '7h ago',
        text: 'The coffee steam physics are so satisfying to watch ✨',
        likes: 88,
        liked: false
      }
    ]
  },
  {
    id: 'vid-fluid-wave',
    visualType: 'fluid-wave',
    creator: {
      handle: '@satisfy_art',
      name: 'Satisfying Kinetic Art',
      avatarInitial: '🌊',
      avatarBg: 'linear-gradient(135deg, #a8ff78 0%, #78ffd6 100%)',
      verified: true,
      isFollowing: false
    },
    caption: 'Hypnotic organic liquid wave sim. Stare at the center for 10 seconds! 🫧 Mind relaxing physics #satisfying #fluid #visualart #relax #fyp',
    hashtags: ['satisfying', 'fluid', 'visualart', 'relax', 'fyp'],
    soundTitle: 'Original Sound - Ambient Resonant Sine Chimes & Water Drop',
    stats: {
      likes: 312600,
      comments: 4210,
      bookmarks: 84300,
      shares: 28900
    },
    userState: {
      liked: false,
      bookmarked: false,
      shared: false
    },
    duration: 14,
    comments: [
      {
        id: 'c-301',
        username: '@zen_master',
        avatarInitial: '🧘',
        avatarBg: '#10b981',
        timeAgo: '1h ago',
        text: 'My stress disappeared after watching this on loop 3 times ✨',
        likes: 520,
        liked: false
      },
      {
        id: 'c-302',
        username: '@color_thief',
        avatarInitial: '🎨',
        avatarBg: '#f59e0b',
        timeAgo: '6h ago',
        text: 'Those iridescent color gradients are pure perfection!',
        likes: 214,
        liked: false
      }
    ]
  },
  {
    id: 'vid-matrix-code',
    visualType: 'matrix-code',
    creator: {
      handle: '@dev_ninja',
      name: 'Terminal Velocity',
      avatarInitial: '📟',
      avatarBg: 'linear-gradient(135deg, #0575E6 0%, #00F260 100%)',
      verified: true,
      isFollowing: false
    },
    caption: 'Hacking the mainframe with zero dependencies! Digital rain cascading in pure JS 🟢 Wake up Neo... #matrix #coding #developer #hacker #tech',
    hashtags: ['matrix', 'coding', 'developer', 'hacker', 'tech'],
    soundTitle: 'Original Sound - Cyber Glitch Sub-Bass & Data Stream Arp',
    stats: {
      likes: 245000,
      comments: 3150,
      bookmarks: 48900,
      shares: 15300
    },
    userState: {
      liked: false,
      bookmarked: false,
      shared: false
    },
    duration: 18,
    comments: [
      {
        id: 'c-401',
        username: '@linux_guru',
        avatarInitial: '🐧',
        avatarBg: '#64748b',
        timeAgo: '3h ago',
        text: 'There is no spoon 🥄 Pure green phosphor aesthetics!',
        likes: 410,
        liked: false
      },
      {
        id: 'c-402',
        username: '@web_dev_101',
        avatarInitial: '🚀',
        avatarBg: '#8b5cf6',
        timeAgo: '12h ago',
        text: 'The glitch bursts line up with the audio pops so nicely.',
        likes: 95,
        liked: false
      }
    ]
  },
  {
    id: 'vid-sunset-drive',
    visualType: 'sunset-drive',
    creator: {
      handle: '@retro_driver',
      name: 'Outrun Highway',
      avatarInitial: '🏎️',
      avatarBg: 'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)',
      verified: false,
      isFollowing: false
    },
    caption: 'Cruising into the 80s synth sunset forever 🌅 Wireframe horizon and neon palm vibes #synthwave #outrun #retrowave #80s #aesthetic',
    hashtags: ['synthwave', 'outrun', 'retrowave', '80s', 'aesthetic'],
    soundTitle: 'Original Sound - 80s Analog Saw Arpeggiator & 4-on-Floor',
    stats: {
      likes: 198700,
      comments: 1980,
      bookmarks: 39500,
      shares: 11200
    },
    userState: {
      liked: false,
      bookmarked: false,
      shared: false
    },
    duration: 15,
    comments: [
      {
        id: 'c-501',
        username: '@vapor_kid',
        avatarInitial: '🌴',
        avatarBg: '#06b6d4',
        timeAgo: '30m ago',
        text: 'Take me to 1984! The striped sun and road grid look so smooth 🏎️',
        likes: 290,
        liked: false
      },
      {
        id: 'c-502',
        username: '@cassette_lover',
        avatarInitial: '📼',
        avatarBg: '#d946ef',
        timeAgo: '2h ago',
        text: 'Put this on full screen on my monitor, peak aesthetic!',
        likes: 114,
        liked: false
      }
    ]
  }
];

/**
 * Number formatting utility for high counts (e.g. 124800 -> "124.8K", 1500000 -> "1.5M")
 */
function formatCount(count) {
  if (typeof count !== 'number' || isNaN(count)) return '0';
  if (count < 1000) return String(count);
  if (count < 1000000) {
    const k = (count / 1000).toFixed(1).replace(/\.0$/, '');
    return `${k}K`;
  }
  const m = (count / 1000000).toFixed(1).replace(/\.0$/, '');
  return `${m}M`;
}

/**
 * Format timestamp relative time
 */
function getRelativeTime(timestamp) {
  if (!timestamp) return 'just now';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

const STORAGE_KEY = 'toktok_state_v1';

/**
 * Safely load persisted state
 */
function loadSavedState() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    // NOTE: accessing window.localStorage itself throws SecurityError on
    // opaque origins (e.g. some file:// implementations) — stay inside try.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Could not read from localStorage:', err);
    return null;
  }
}

/**
 * Safely save state
 */
function saveAppState(state) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    // Accessing window.localStorage itself throws SecurityError on opaque
    // origins (e.g. some file:// implementations) — stay inside try.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not write to localStorage:', err);
  }
}

/* Expose the public API on the shared namespace (works in browser + Node tests). */
globalThis.TokTok = Object.assign(globalThis.TokTok || {}, {
  INITIAL_VIDEOS,
  formatCount,
  getRelativeTime,
  loadSavedState,
  saveAppState
});
