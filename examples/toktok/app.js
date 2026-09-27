/**
 * TokTok Clone - Main Application Controller
 * Pure Vanilla JS + CSS. No frameworks, no bundler, no server, no external URLs.
 *
 * Loaded as a classic script AFTER data.js, canvas-engine.js, audio-synth.js
 * (all of which publish their API on the shared `TokTok` namespace).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pure helpers (exposed for Node-based unit tests)                    *
   * ------------------------------------------------------------------ */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Escape a caption and linkify #hashtags (call AFTER escaping). */
  function buildCaptionHtml(text) {
    return escapeHtml(text).replace(
      /#([\p{L}\p{N}_]+)/gu,
      '<span class="hashtag" data-action="search-tag" data-tag="$1">#$1</span>'
    );
  }

  globalThis.TokTok = Object.assign(globalThis.TokTok || {}, {
    escapeHtml,
    buildCaptionHtml
  });

  /* Everything below needs a real DOM. */
  if (typeof document === 'undefined') return;

  const T = globalThis.TokTok;
  const { formatCount, audioSynth, renderCanvasScene } = T;

  /* ------------------------------------------------------------------ *
   * State                                                               *
   * ------------------------------------------------------------------ */

  const state = {
    videos: [],
    activeIndex: 0,
    isPlaying: true,
    elapsed: 0,
    feedTab: 'foryou', // 'foryu' | 'following'
    query: '',
    drawerVideoId: null,
    shareVideoId: null,
    nav: 'home'
  };

  const VALID_STATE_VERSION = 1;

  function cloneInitialVideos() {
    return JSON.parse(JSON.stringify(T.INITIAL_VIDEOS));
  }

  function loadVideos() {
    const saved = T.loadSavedState();
    const ok =
      saved &&
      saved.version === VALID_STATE_VERSION &&
      Array.isArray(saved.videos) &&
      saved.videos.length > 0 &&
      saved.videos.every((v) => v && v.id && v.visualType && v.creator && Array.isArray(v.comments));
    return ok ? saved.videos : cloneInitialVideos();
  }

  function persist() {
    T.saveAppState({ version: VALID_STATE_VERSION, videos: state.videos });
  }

  function activeVideo() {
    return visibleVideos()[state.activeIndex] || null;
  }

  function findVideo(id) {
    return state.videos.find((v) => v.id === id) || null;
  }

  function visibleVideos() {
    let list = state.videos;
    if (state.feedTab === 'following') {
      list = list.filter((v) => v.creator.isFollowing);
    }
    const q = state.query.trim().toLowerCase();
    if (q) {
      list = list.filter((v) => {
        const hay = [
          v.creator.handle,
          v.creator.name,
          v.caption,
          v.soundTitle,
          ...(Array.isArray(v.hashtags) ? v.hashtags : [])
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }

  /* ------------------------------------------------------------------ *
   * DOM refs                                                            *
   * ------------------------------------------------------------------ */

  const el = (id) => document.getElementById(id);

  const dom = {
    feed: el('feedContainer'),
    announcer: el('ariaAnnouncer'),
    toast: el('appToast'),
    progressContainer: el('progressBarContainer'),
    progressFill: el('progressBarFill'),
    tabForYou: el('tabForYou'),
    tabFollowing: el('tabFollowing'),
    searchOverlay: el('searchOverlay'),
    searchInput: el('searchInput'),
    searchClearBtn: el('searchClearBtn'),
    searchOpenBtn: el('searchOpenBtn'),
    searchCloseBtn: el('searchCloseBtn'),
    commentDrawer: el('commentDrawer'),
    commentBackdrop: el('commentBackdrop'),
    commentCloseBtn: el('commentCloseBtn'),
    commentList: el('commentList'),
    commentTitle: el('commentDrawerTitle'),
    commentForm: el('commentForm'),
    commentInput: el('commentTextInput'),
    commentSubmitBtn: el('commentSubmitBtn'),
    shareModal: el('shareModal'),
    shareCloseBtn: el('shareCloseBtn'),
    shareCopyLinkBtn: el('shareCopyLinkBtn'),
    createModal: el('createModal'),
    createCloseBtn: el('createCloseBtn'),
    createForm: el('createVideoForm'),
    navHome: el('navHome'),
    navDiscover: el('navDiscover'),
    navCreate: el('navCreate'),
    navInbox: el('navInbox'),
    navProfile: el('navProfile'),
    audioMasterBtn: el('audioMasterBtn'),
    audioStatusText: el('audioStatusText'),
    fullscreenBtn: el('fullscreenBtn'),
    liveBtn: el('liveBtn'),
    appContainer: el('appContainer')
  };

  /* ------------------------------------------------------------------ *
   * Feedback helpers                                                    *
   * ------------------------------------------------------------------ */

  let toastTimer = null;
  function toast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2200);
  }

  function announce(message) {
    if (dom.announcer) dom.announcer.textContent = message;
  }

  /* ------------------------------------------------------------------ *
   * Feed rendering                                                      *
   * ------------------------------------------------------------------ */

  const VERIFIED_SVG =
    '<svg class="verified-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 1.8l2.6 1.9 3.2-.4 1 3.1 2.8 1.6-1 3.2 1 3.2-2.8 1.6-1 3.1-3.2-.4L12 22.2l-2.6-1.9-3.2.4-1-3.1-2.8-1.6 1-3.2-1-3.2 2.8-1.6 1-3.1 3.2.4z"/>' +
    '<path d="M8.6 12.2l2.3 2.3 4.5-4.8" fill="none" stroke="#0e0e11" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const ICON_LIKE =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  const ICON_COMMENT =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  const ICON_BOOKMARK =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

  const ICON_SHARE =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';

  const ICON_NOTE =
    '<svg class="sound-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

  const ICON_PLAY_BADGE =
    '<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

  const ICON_PAUSE_BADGE =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  function slideTemplate(video, index) {
    const c = video.creator;
    const us = video.userState || (video.userState = { liked: false, bookmarked: false, shared: false });
    const captionHtml = buildCaptionHtml(video.caption);
    const showCaptionToggle = String(video.caption || '').length > 72;
    const avatarStyle = escapeHtml(c.avatarBg || '');

    return (
      '<article class="video-slide" data-index="' +
      index +
      '" data-id="' +
      escapeHtml(video.id) +
      '" aria-label="Video by ' +
      escapeHtml(c.handle) +
      '">' +
      '<canvas class="video-canvas"></canvas>' +
      '<div class="video-vignette-top" aria-hidden="true"></div>' +
      '<div class="video-vignette-bottom" aria-hidden="true"></div>' +
      '<div class="play-indicator-overlay" aria-hidden="true"><div class="play-badge">' +
      ICON_PLAY_BADGE +
      '</div></div>' +
      '<div class="action-sidebar">' +
      '<div class="avatar-wrap">' +
      '<div class="avatar-circle" style="background:' +
      avatarStyle +
      '">' +
      escapeHtml(c.avatarInitial || '#') +
      '</div>' +
      '<button type="button" class="follow-badge-btn' +
      (c.isFollowing ? ' following' : '') +
      '" data-action="follow" aria-pressed="' +
      (c.isFollowing ? 'true' : 'false') +
      '" aria-label="' +
      (c.isFollowing ? 'Unfollow ' : 'Follow ') +
      escapeHtml(c.handle) +
      '">' +
      (c.isFollowing ? '&#10003;' : '+') +
      '</button>' +
      '</div>' +
      '<div class="action-item">' +
      '<button type="button" class="action-btn like-btn' +
      (us.liked ? ' liked' : '') +
      '" data-action="like" aria-pressed="' +
      (us.liked ? 'true' : 'false') +
      '" aria-label="Like video">' +
      ICON_LIKE +
      '</button>' +
      '<span class="action-label" data-count="likes">' +
      formatCount(video.stats.likes) +
      '</span>' +
      '</div>' +
      '<div class="action-item">' +
      '<button type="button" class="action-btn comment-btn" data-action="comments" aria-label="Open comments">' +
      ICON_COMMENT +
      '</button>' +
      '<span class="action-label" data-count="comments">' +
      formatCount(video.stats.comments) +
      '</span>' +
      '</div>' +
      '<div class="action-item">' +
      '<button type="button" class="action-btn bookmark-btn' +
      (us.bookmarked ? ' saved' : '') +
      '" data-action="bookmark" aria-pressed="' +
      (us.bookmarked ? 'true' : 'false') +
      '" aria-label="Bookmark video">' +
      ICON_BOOKMARK +
      '</button>' +
      '<span class="action-label" data-count="bookmarks">' +
      formatCount(video.stats.bookmarks) +
      '</span>' +
      '</div>' +
      '<div class="action-item">' +
      '<button type="button" class="action-btn share-btn" data-action="share" aria-label="Share video">' +
      ICON_SHARE +
      '</button>' +
      '<span class="action-label" data-count="shares">' +
      formatCount(video.stats.shares) +
      '</span>' +
      '</div>' +
      '<div class="disc-wrap" aria-hidden="true">' +
      '<div class="music-disc"><div class="disc-inner-art">&#9834;</div></div>' +
      '<span class="floating-music-note">&#9834;</span>' +
      '<span class="floating-music-note note-2">&#9835;</span>' +
      '</div>' +
      '</div>' +
      '<div class="video-info-overlay">' +
      '<div class="creator-row">' +
      '<span class="creator-handle" data-action="profile" role="button" tabindex="0">' +
      escapeHtml(c.handle) +
      '</span>' +
      (c.verified ? VERIFIED_SVG : '') +
      '</div>' +
      '<div class="video-caption">' +
      captionHtml +
      (showCaptionToggle
        ? ' <button type="button" class="caption-toggle-btn" data-action="caption-toggle">more</button>'
        : '') +
      '</div>' +
      '<div class="sound-track-wrap" data-action="sound" role="button" tabindex="0">' +
      ICON_NOTE +
      '<div class="marquee-container"><span class="marquee-text">' +
      escapeHtml(video.soundTitle) +
      '</span></div>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  function emptyStateTemplate() {
    const q = state.query.trim();
    if (state.feedTab === 'following' && !q) {
      return (
        '<div class="empty-feed">' +
        '<h2>You are not following anyone yet</h2>' +
        '<p>Tap the + on a creator to follow them, or browse the For You feed.</p>' +
        '<button type="button" class="btn-primary-gradient" data-empty-action="foryou">Back to For You</button>' +
        '</div>'
      );
    }
    return (
      '<div class="empty-feed">' +
      '<h2>No videos found</h2>' +
      '<p>' +
      (q ? 'Nothing matches &ldquo;' + escapeHtml(q) + '&rdquo;.' : 'The feed is empty.') +
      '</p>' +
      '<button type="button" class="btn-primary-gradient" data-empty-action="reset">Clear filters</button>' +
      '</div>'
    );
  }

  let observer = null;

  function renderFeed(options) {
    const opts = options || {};
    const list = visibleVideos();
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (!list.length) {
      dom.feed.innerHTML = emptyStateTemplate();
      state.activeIndex = 0;
      stopAudioTrack();
      dom.progressFill.style.width = '0%';
      const btn = dom.feed.querySelector('[data-empty-action]');
      if (btn) {
        btn.addEventListener('click', () => {
          if (btn.dataset.emptyAction === 'foryou') {
            setFeedTab('foryou');
          } else {
            state.query = '';
            dom.searchInput.value = '';
            dom.searchClearBtn.style.display = 'none';
            setFeedTab('foryou');
          }
        });
      }
      announce('No videos to show.');
      return;
    }

    dom.feed.innerHTML = list.map(slideTemplate).join('');
    dom.feed.scrollTop = 0;

    const startAt = Math.min(opts.startIndex || 0, list.length - 1);
    setActive(startAt, { resetElapsed: true, scrollTo: false });
    observeSlides();
  }

  function observeSlides() {
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        let best = null;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
          }
        }
        if (best) {
          const idx = Number(best.target.dataset.index);
          if (!Number.isNaN(idx) && idx !== state.activeIndex) {
            setActive(idx, { resetElapsed: true, scrollTo: false });
          }
        }
      },
      { root: dom.feed, threshold: [0.6, 0.9] }
    );
    dom.feed.querySelectorAll('.video-slide').forEach((s) => observer.observe(s));
  }

  /* ------------------------------------------------------------------ *
   * Active slide / playback                                             *
   * ------------------------------------------------------------------ */

  function setActive(index, options) {
    const opts = options || {};
    const list = visibleVideos();
    if (!list.length) return;
    state.activeIndex = Math.max(0, Math.min(index, list.length - 1));
    if (opts.resetElapsed !== false) state.elapsed = 0;

    const video = list[state.activeIndex];
    if (state.drawerVideoId && state.drawerVideoId !== video.id) closeComments();

    if (opts.scrollTo !== false) {
      scrollSlideIntoView(slideAt(state.activeIndex));
    }

    updatePlaybackUI();
    if (state.isPlaying) {
      audioSynth.playTrack(video.visualType);
    } else {
      stopAudioTrack();
      drawActive(performance.now() / 1000);
    }
    announce(
      'Video ' +
        (state.activeIndex + 1) +
        ' of ' +
        list.length +
        ' by ' +
        video.creator.handle +
        '. ' +
        video.caption
    );
  }

  function slideAt(index) {
    return dom.feed.querySelector('.video-slide[data-index="' + index + '"]');
  }

  /** Smoothly scroll a slide into view when the engine supports it. */
  function scrollSlideIntoView(slide) {
    if (!slide) return;
    if (typeof slide.scrollIntoView === 'function') {
      slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      dom.feed.scrollTop = slide.offsetTop;
    }
  }

  function updatePlaybackUI() {
    dom.feed.querySelectorAll('.video-slide').forEach((slide) => {
      const isActive = Number(slide.dataset.index) === state.activeIndex;
      const disc = slide.querySelector('.music-disc');
      if (disc) disc.classList.toggle('paused', !(isActive && state.isPlaying));
    });
  }

  function stopAudioTrack() {
    audioSynth.stopTrack();
  }

  function showPlayBadge(slide, playing) {
    const badge = slide.querySelector('.play-badge');
    if (!badge) return;
    badge.innerHTML = playing ? ICON_PAUSE_BADGE : ICON_PLAY_BADGE;
    badge.classList.add('show');
    if (badge._hideTimer) clearTimeout(badge._hideTimer);
    badge._hideTimer = setTimeout(() => badge.classList.remove('show'), 700);
  }

  function togglePlay(slide) {
    state.isPlaying = !state.isPlaying;
    const video = activeVideo();
    if (state.isPlaying && video) {
      audioSynth.playTrack(video.visualType);
      toast('Playing');
    } else {
      stopAudioTrack();
      toast('Paused');
      drawActive(performance.now() / 1000);
    }
    if (slide) showPlayBadge(slide, state.isPlaying);
    updatePlaybackUI();
    announce(state.isPlaying ? 'Playing' : 'Paused');
  }

  function goTo(index) {
    const list = visibleVideos();
    if (!list.length) return;
    const target = Math.max(0, Math.min(index, list.length - 1));
    if (target === state.activeIndex) return;
    scrollSlideIntoView(slideAt(target));
    // IntersectionObserver commits the change; seed it in case scrolling is a no-op.
    setTimeout(() => {
      if (state.activeIndex !== target) setActive(target, { resetElapsed: true });
    }, 350);
  }

  /* ------------------------------------------------------------------ *
   * Canvas rendering loop                                               *
   * ------------------------------------------------------------------ */

  let lastTimestamp = 0;

  function drawActive(timeSeconds) {
    const video = activeVideo();
    if (!video) return;
    const slide = slideAt(state.activeIndex);
    if (!slide) return;
    const canvas = slide.querySelector('canvas');
    if (!canvas) return;

    const cssW = Math.max(1, slide.clientWidth);
    const cssH = Math.max(1, slide.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderCanvasScene(video.visualType, ctx, cssW, cssH, timeSeconds, audioSynth.getAudioEnergy());
  }

  function updateProgress() {
    const video = activeVideo();
    if (!video || !video.duration) return;
    const pct = Math.max(0, Math.min(100, (state.elapsed / video.duration) * 100));
    dom.progressFill.style.width = pct + '%';
    dom.progressContainer.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function loop(timestamp) {
    requestAnimationFrame(loop);
    const video = activeVideo();
    if (!video) {
      lastTimestamp = timestamp;
      return;
    }
    const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.1) : 0;
    lastTimestamp = timestamp;

    if (state.isPlaying) {
      state.elapsed += dt;
      if (state.elapsed >= video.duration) state.elapsed -= video.duration;
      drawActive(timestamp / 1000);
      updateProgress();
    }
  }

  /* ------------------------------------------------------------------ *
   * Likes / hearts                                                      *
   * ------------------------------------------------------------------ */

  function burstHearts(slide, clientX, clientY) {
    if (!slide) return;
    const rect = slide.getBoundingClientRect();
    const x = clientX == null ? rect.width / 2 : clientX - rect.left;
    const y = clientY == null ? rect.height / 2 : clientY - rect.top;
    for (let i = 0; i < 3; i++) {
      const heart = document.createElement('span');
      heart.className = 'burst-heart';
      heart.style.left = x + (i - 1) * 26 + 'px';
      heart.style.top = y + (i % 2 ? -14 : 6) + 'px';
      heart.style.animationDelay = i * 90 + 'ms';
      heart.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor" width="100%" height="100%" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.2C.4 8.9 1.7 5 5.2 5c2 0 3.4 1.1 4.3 2.4h5C15.4 6.1 16.8 5 18.8 5c3.5 0 4.8 3.9 3.2 6.8C19.5 16.1 12 21 12 21z"/></svg>';
      slide.appendChild(heart);
      setTimeout(() => heart.remove(), 1100);
    }
  }

  function syncVideoMetaUI(video) {
    const slide = dom.feed.querySelector('.video-slide[data-id="' + CSS.escape(video.id) + '"]');
    if (!slide) return;
    const us = video.userState;
    const likeBtn = slide.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.classList.toggle('liked', !!us.liked);
      likeBtn.setAttribute('aria-pressed', us.liked ? 'true' : 'false');
    }
    const bmBtn = slide.querySelector('.bookmark-btn');
    if (bmBtn) {
      bmBtn.classList.toggle('saved', !!us.bookmarked);
      bmBtn.setAttribute('aria-pressed', us.bookmarked ? 'true' : 'false');
    }
    const followBtn = slide.querySelector('.follow-badge-btn');
    if (followBtn) {
      const following = !!video.creator.isFollowing;
      followBtn.classList.toggle('following', following);
      followBtn.setAttribute('aria-pressed', following ? 'true' : 'false');
      followBtn.innerHTML = following ? '&#10003;' : '+';
      followBtn.setAttribute(
        'aria-label',
        (following ? 'Unfollow ' : 'Follow ') + video.creator.handle
      );
    }
    const counts = { likes: video.stats.likes, comments: video.stats.comments, bookmarks: video.stats.bookmarks, shares: video.stats.shares };
    for (const key of Object.keys(counts)) {
      const label = slide.querySelector('[data-count="' + key + '"]');
      if (label) label.textContent = formatCount(counts[key]);
    }
  }

  function setLiked(video, liked) {
    if (video.userState.liked === liked) return;
    video.userState.liked = liked;
    video.stats.likes = Math.max(0, video.stats.likes + (liked ? 1 : -1));
    syncVideoMetaUI(video);
    persist();
    announce((liked ? 'Liked ' : 'Unliked ') + video.creator.handle + "'s video");
  }

  function setBookmarked(video, bookmarked) {
    if (video.userState.bookmarked === bookmarked) return;
    video.userState.bookmarked = bookmarked;
    video.stats.bookmarks = Math.max(0, video.stats.bookmarks + (bookmarked ? 1 : -1));
    syncVideoMetaUI(video);
    persist();
    toast(bookmarked ? 'Added to Favorites' : 'Removed from Favorites');
  }

  function toggleFollow(video) {
    video.creator.isFollowing = !video.creator.isFollowing;
    syncVideoMetaUI(video);
    persist();
    toast(video.creator.isFollowing ? 'Following ' + video.creator.handle : 'Unfollowed ' + video.creator.handle);
    if (state.feedTab === 'following' && !video.creator.isFollowing) {
      renderFeed({ startIndex: 0 });
    }
  }

  /* ------------------------------------------------------------------ *
   * Tap handling (single = play/pause, double = like)                   *
   * ------------------------------------------------------------------ */

  let tapTimer = null;

  function handleCanvasTap(slide, event) {
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      const video = activeVideo();
      if (video) {
        setLiked(video, true);
        burstHearts(slide, event.clientX, event.clientY);
      }
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = null;
      togglePlay(slide);
    }, 260);
  }

  /* ------------------------------------------------------------------ *
   * Comments                                                            *
   * ------------------------------------------------------------------ */

  function commentTemplate(comment) {
    return (
      '<div class="comment-item" data-comment-id="' +
      escapeHtml(comment.id) +
      '">' +
      '<div class="comment-avatar" style="background:' +
      escapeHtml(comment.avatarBg || '') +
      '">' +
      escapeHtml(comment.avatarInitial || ':)') +
      '</div>' +
      '<div class="comment-body">' +
      '<div class="comment-user-row">' +
      '<span class="comment-username">' +
      escapeHtml(comment.username) +
      '</span>' +
      '<span class="comment-time">' +
      escapeHtml(comment.timeAgo) +
      '</span>' +
      '</div>' +
      '<p class="comment-text">' +
      escapeHtml(comment.text) +
      '</p>' +
      '<div class="comment-actions">' +
      '<span>Reply</span>' +
      '</div>' +
      '</div>' +
      '<div class="comment-like-wrap">' +
      '<button type="button" class="comment-like-btn' +
      (comment.liked ? ' liked' : '') +
      '" data-action="comment-like" aria-pressed="' +
      (comment.liked ? 'true' : 'false') +
      '" aria-label="Like comment">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="' +
      (comment.liked ? 'currentColor' : 'none') +
      '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
      '</button>' +
      '<span class="comment-like-count">' +
      formatCount(comment.likes) +
      '</span>' +
      '</div>' +
      '</div>'
    );
  }

  function renderComments() {
    const video = findVideo(state.drawerVideoId);
    if (!video) return;
    dom.commentTitle.textContent = 'Comments (' + formatCount(video.stats.comments) + ')';
    dom.commentList.innerHTML = video.comments.length
      ? video.comments.map(commentTemplate).join('')
      : '<p class="comment-text" style="opacity:.6">No comments yet. Be the first!</p>';
    dom.commentList.scrollTop = 0;
  }

  function openComments(video) {
    state.drawerVideoId = video.id;
    renderComments();
    dom.commentDrawer.classList.add('open');
    dom.commentBackdrop.classList.add('open');
    dom.commentDrawer.setAttribute('aria-hidden', 'false');
    dom.commentBackdrop.setAttribute('aria-hidden', 'false');
    announce('Comments opened for ' + video.creator.handle);
  }

  function closeComments() {
    state.drawerVideoId = null;
    dom.commentDrawer.classList.remove('open');
    dom.commentBackdrop.classList.remove('open');
    dom.commentDrawer.setAttribute('aria-hidden', 'true');
    dom.commentBackdrop.setAttribute('aria-hidden', 'true');
  }

  function commentsAreOpen() {
    return dom.commentDrawer.classList.contains('open');
  }

  function postComment(text) {
    const video = findVideo(state.drawerVideoId);
    if (!video || !text.trim()) return;
    video.comments.unshift({
      id: 'c-you-' + Date.now(),
      username: '@you',
      avatarInitial: '\u{1F642}',
      avatarBg: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
      timeAgo: 'just now',
      text: text.trim().slice(0, 200),
      likes: 0,
      liked: false
    });
    video.stats.comments += 1;
    persist();
    renderComments();
    syncVideoMetaUI(video);
    dom.commentInput.value = '';
    dom.commentSubmitBtn.disabled = true;
    toast('Comment posted');
    announce('Comment posted');
  }

  /* ------------------------------------------------------------------ *
   * Share                                                               *
   * ------------------------------------------------------------------ */

  function openShare(video) {
    state.shareVideoId = video.id;
    dom.shareModal.classList.add('open');
    dom.shareModal.setAttribute('aria-hidden', 'false');
  }

  function closeShare() {
    state.shareVideoId = null;
    dom.shareModal.classList.remove('open');
    dom.shareModal.setAttribute('aria-hidden', 'true');
  }

  function shareIsOpen() {
    return dom.shareModal.classList.contains('open');
  }

  async function copyShareLink(video) {
    const link = location.href.split('#')[0] + '#video/' + video.id;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch (_) {
      copied = false;
    }
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        ta.remove();
      } catch (_) {
        copied = false;
      }
    }
    if (!video.userState.shared) {
      video.userState.shared = true;
      video.stats.shares += 1;
      syncVideoMetaUI(video);
      persist();
    }
    toast(copied ? 'Link copied' : 'Share prepared (offline demo)');
  }

  /* ------------------------------------------------------------------ *
   * Create video                                                        *
   * ------------------------------------------------------------------ */

  function openCreate() {
    dom.createModal.classList.add('open');
    dom.createModal.setAttribute('aria-hidden', 'false');
  }

  function closeCreate() {
    dom.createModal.classList.remove('open');
    dom.createModal.setAttribute('aria-hidden', 'true');
  }

  function createIsOpen() {
    return dom.createModal.classList.contains('open');
  }

  function extractHashtags(text) {
    const out = [];
    const re = /#([\p{L}\p{N}_]+)/gu;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
    return out;
  }

  function handleCreateSubmit(event) {
    event.preventDefault();
    const visualType = el('createVisualType').value;
    let handle = el('createCreatorHandle').value.trim() || '@creator';
    if (!handle.startsWith('@')) handle = '@' + handle;
    const caption = el('createCaption').value.trim() || 'Fresh procedural video #fyp';
    const soundTitle = el('createSoundTitle').value.trim() || 'Original Sound - ' + handle;

    const palettes = [
      'linear-gradient(135deg, #ff0844, #ffb199)',
      'linear-gradient(135deg, #25f4ee, #0070f3)',
      'linear-gradient(135deg, #a8ff78, #78ffd6)',
      'linear-gradient(135deg, #f6d365, #fda085)'
    ];

    const video = {
      id: 'vid-custom-' + Date.now(),
      visualType: visualType,
      creator: {
        handle: handle,
        name: handle,
        avatarInitial: handle.slice(1, 2).toUpperCase() || 'U',
        avatarBg: palettes[Math.floor(Math.random() * palettes.length)],
        verified: false,
        isFollowing: true
      },
      caption: caption,
      hashtags: extractHashtags(caption),
      soundTitle: soundTitle,
      stats: { likes: 0, comments: 0, bookmarks: 0, shares: 0 },
      userState: { liked: false, bookmarked: false, shared: false },
      duration: 16,
      comments: []
    };

    state.videos.unshift(video);
    persist();
    closeCreate();
    state.query = '';
    dom.searchInput.value = '';
    dom.searchClearBtn.style.display = 'none';
    setFeedTab('foryou', { silent: true });
    renderFeed({ startIndex: 0 });
    toast('Published to your feed!');
    announce('New video published by ' + handle);
  }

  /* ------------------------------------------------------------------ *
   * Tabs / search / navigation                                          *
   * ------------------------------------------------------------------ */

  function setFeedTab(tab, options) {
    state.feedTab = tab;
    const isForYou = tab === 'foryou';
    dom.tabForYou.classList.toggle('active', isForYou);
    dom.tabFollowing.classList.toggle('active', !isForYou);
    dom.tabForYou.setAttribute('aria-selected', isForYou ? 'true' : 'false');
    dom.tabFollowing.setAttribute('aria-selected', isForYou ? 'false' : 'true');
    if (!(options && options.silent)) {
      renderFeed({ startIndex: 0 });
      announce(isForYou ? 'For You feed' : 'Following feed');
    }
  }

  function openSearch() {
    dom.searchOverlay.classList.add('open');
    dom.searchOverlay.setAttribute('aria-hidden', 'false');
    dom.searchInput.focus();
  }

  function closeSearch() {
    dom.searchOverlay.classList.remove('open');
    dom.searchOverlay.setAttribute('aria-hidden', 'true');
    if (state.query) {
      state.query = '';
      dom.searchInput.value = '';
      dom.searchClearBtn.style.display = 'none';
      renderFeed({ startIndex: 0 });
    }
  }

  function setNavActive(id) {
    [dom.navHome, dom.navDiscover, dom.navInbox, dom.navProfile].forEach((n) => {
      if (!n) return;
      const on = n.id === id;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
  }

  /* ------------------------------------------------------------------ *
   * Global click delegation (feed)                                      *
   * ------------------------------------------------------------------ */

  function handleAction(action, video, target, event) {
    switch (action) {
      case 'like': {
        setLiked(video, !video.userState.liked);
        if (video.userState.liked) {
          const slide = target.closest('.video-slide');
          burstHearts(slide, event.clientX, event.clientY);
        }
        break;
      }
      case 'bookmark':
        setBookmarked(video, !video.userState.bookmarked);
        break;
      case 'follow':
        toggleFollow(video);
        break;
      case 'comments':
        openComments(video);
        break;
      case 'share':
        openShare(video);
        break;
      case 'caption-toggle': {
        const caption = target.closest('.video-caption');
        if (caption) {
          const expanded = caption.classList.toggle('expanded');
          target.textContent = expanded ? 'less' : 'more';
        }
        break;
      }
      case 'search-tag': {
        const tag = target.dataset.tag || '';
        state.query = '#' + tag;
        dom.searchInput.value = '#' + tag;
        dom.searchClearBtn.style.display = 'flex';
        openSearch();
        renderFeed({ startIndex: 0 });
        break;
      }
      case 'profile':
        toast('Profile view is part of the offline demo: ' + video.creator.handle);
        break;
      case 'sound':
        toast(video.soundTitle);
        break;
      default:
        break;
    }
  }

  function bindFeedEvents() {
    dom.feed.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      const slide = event.target.closest('.video-slide');
      if (!slide) return;
      const video = findVideo(slide.dataset.id);
      if (!video) return;

      if (actionEl && slide.contains(actionEl)) {
        handleAction(actionEl.dataset.action, video, actionEl, event);
        return;
      }
      if (slide.contains(event.target)) {
        handleCanvasTap(slide, event);
      }
    });

    dom.feed.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl || actionEl.tagName === 'BUTTON') return;
      event.preventDefault();
      const slide = actionEl.closest('.video-slide');
      if (!slide) return;
      const video = findVideo(slide.dataset.id);
      if (video) {
        handleAction(actionEl.dataset.action, video, actionEl, event);
        event.stopPropagation();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Static UI bindings                                                  *
   * ------------------------------------------------------------------ */

  function bindStaticEvents() {
    dom.tabForYou.addEventListener('click', () => setFeedTab('foryou'));
    dom.tabFollowing.addEventListener('click', () => setFeedTab('following'));

    dom.searchOpenBtn.addEventListener('click', openSearch);
    dom.searchCloseBtn.addEventListener('click', closeSearch);
    dom.searchClearBtn.addEventListener('click', () => {
      state.query = '';
      dom.searchInput.value = '';
      dom.searchClearBtn.style.display = 'none';
      dom.searchInput.focus();
      renderFeed({ startIndex: 0 });
    });
    dom.searchInput.addEventListener('input', () => {
      state.query = dom.searchInput.value;
      dom.searchClearBtn.style.display = state.query ? 'flex' : 'none';
      renderFeed({ startIndex: 0 });
    });

    dom.commentCloseBtn.addEventListener('click', closeComments);
    dom.commentBackdrop.addEventListener('click', closeComments);
    dom.commentForm.addEventListener('submit', (event) => {
      event.preventDefault();
      postComment(dom.commentInput.value);
    });
    dom.commentInput.addEventListener('input', () => {
      dom.commentSubmitBtn.disabled = !dom.commentInput.value.trim();
    });
    dom.commentList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="comment-like"]');
      if (!btn) return;
      const item = btn.closest('.comment-item');
      const video = findVideo(state.drawerVideoId);
      if (!item || !video) return;
      const comment = video.comments.find((c) => c.id === item.dataset.commentId);
      if (!comment) return;
      comment.liked = !comment.liked;
      comment.likes = Math.max(0, comment.likes + (comment.liked ? 1 : -1));
      persist();
      renderComments();
    });
    document.querySelectorAll('.emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dom.commentInput.value += btn.dataset.emoji;
        dom.commentSubmitBtn.disabled = !dom.commentInput.value.trim();
        dom.commentInput.focus();
      });
    });

    dom.shareCloseBtn.addEventListener('click', closeShare);
    dom.shareModal.addEventListener('click', (event) => {
      if (event.target === dom.shareModal) closeShare();
    });
    dom.shareCopyLinkBtn.addEventListener('click', () => {
      const video = findVideo(state.shareVideoId) || activeVideo();
      if (video) copyShareLink(video);
    });
    document.querySelectorAll('.share-opt-btn').forEach((btn) => {
      if (btn.id === 'shareCopyLinkBtn') return;
      btn.addEventListener('click', () => {
        const video = findVideo(state.shareVideoId) || activeVideo();
        if (video && !video.userState.shared) {
          video.userState.shared = true;
          video.stats.shares += 1;
          syncVideoMetaUI(video);
          persist();
        }
        toast('Simulated share — this demo has no network');
      });
    });

    dom.createCloseBtn.addEventListener('click', closeCreate);
    dom.createModal.addEventListener('click', (event) => {
      if (event.target === dom.createModal) closeCreate();
    });
    dom.createForm.addEventListener('submit', handleCreateSubmit);

    dom.navHome.addEventListener('click', () => {
      setNavActive('navHome');
      state.nav = 'home';
      closeSearch();
      closeComments();
      goTo(0);
    });
    dom.navDiscover.addEventListener('click', () => {
      setNavActive('navDiscover');
      state.nav = 'discover';
      openSearch();
    });
    dom.navCreate.addEventListener('click', openCreate);
    dom.navInbox.addEventListener('click', () => {
      toast('Inbox: 3 simulated notifications (offline demo)');
    });
    dom.navProfile.addEventListener('click', () => {
      toast('Profile screen is simulated in this offline demo');
    });

    dom.audioMasterBtn.addEventListener('click', () => {
      const muted = audioSynth.toggleMute();
      dom.audioStatusText.textContent = muted ? 'Muted' : 'Playing';
      dom.audioMasterBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
      const video = activeVideo();
      if (!muted && state.isPlaying && video) {
        audioSynth.playTrack(video.visualType);
      }
      toast(muted ? 'Audio muted' : 'Audio on (synthesized)');
    });

    dom.fullscreenBtn.addEventListener('click', () => {
      const on = dom.appContainer.classList.toggle('fullscreen-mode');
      toast(on ? 'Fullscreen mode' : 'Windowed mode');
    });

    dom.liveBtn.addEventListener('click', () => {
      toast('LIVE is simulated — no real streaming URLs in this demo');
    });

    dom.progressContainer.addEventListener('click', (event) => {
      const video = activeVideo();
      if (!video || !video.duration) return;
      const rect = dom.progressContainer.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      state.elapsed = ratio * video.duration;
      updateProgress();
      drawActive(performance.now() / 1000);
    });

    window.addEventListener('resize', () => {
      drawActive(performance.now() / 1000);
    });
  }

  /* ------------------------------------------------------------------ *
   * Keyboard shortcuts                                                  *
   * ------------------------------------------------------------------ */

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function anyOverlayOpen() {
    return shareIsOpen() || createIsOpen() || commentsAreOpen() || dom.searchOverlay.classList.contains('open');
  }

  function closeTopOverlay() {
    if (shareIsOpen()) {
      closeShare();
      return true;
    }
    if (createIsOpen()) {
      closeCreate();
      return true;
    }
    if (commentsAreOpen()) {
      closeComments();
      return true;
    }
    if (dom.searchOverlay.classList.contains('open')) {
      closeSearch();
      return true;
    }
    if (dom.appContainer.classList.contains('fullscreen-mode')) {
      dom.appContainer.classList.remove('fullscreen-mode');
      return true;
    }
    return false;
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (closeTopOverlay()) event.preventDefault();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          goTo(state.activeIndex + 1);
          break;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          goTo(state.activeIndex - 1);
          break;
        case ' ': {
          event.preventDefault();
          if (!anyOverlayOpen()) togglePlay(slideAt(state.activeIndex));
          break;
        }
        case 'm':
        case 'M': {
          dom.audioMasterBtn.click();
          break;
        }
        case 'l':
        case 'L': {
          const video = activeVideo();
          if (video) {
            setLiked(video, !video.userState.liked);
            if (video.userState.liked) burstHearts(slideAt(state.activeIndex), null, null);
          }
          break;
        }
        case 'c':
        case 'C': {
          if (commentsAreOpen()) closeComments();
          else {
            const video = activeVideo();
            if (video) openComments(video);
          }
          break;
        }
        default:
          break;
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Boot                                                                *
   * ------------------------------------------------------------------ */

  function init() {
    state.videos = loadVideos();
    bindFeedEvents();
    bindStaticEvents();
    bindKeyboard();
    renderFeed({ startIndex: 0 });
    dom.audioStatusText.textContent = audioSynth.isMuted() ? 'Muted' : 'Playing';
    dom.audioMasterBtn.setAttribute('aria-pressed', audioSynth.isMuted() ? 'false' : 'true');
    requestAnimationFrame(loop);
    announce('TokTok ready. ' + state.videos.length + ' videos in feed.');
  }

  init();
})();
