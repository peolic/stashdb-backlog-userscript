// ==UserScript==
// @name        StashDB Backlog
// @author      peolic
// @version     1.35.0
// @description Highlights backlogged changes to scenes, performers and other entities on StashDB.org
// @icon        https://cdn.discordapp.com/attachments/559159668912553989/841890253707149352/stash2.png
// @namespace   https://github.com/peolic
// @match       https://stashdb.org/*
// @grant       GM.setValue
// @grant       GM.getValue
// @grant       GM.deleteValue
// @grant       GM.xmlHttpRequest
// @grant       GM.registerMenuCommand
// @grant       GM.addStyle
// @connect     github.com
// @connect     githubusercontent.com
// @homepageURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7
// @downloadURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @updateURL   https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// ==/UserScript==

//@ts-check
/// <reference path="typings.d.ts" />

const dev = false;

const devUsernames = ['peolic', 'root'];

async function inject() {
  const backlogSpreadsheet = 'https://docs.google.com/spreadsheets/d/1eiOC-wbqbaK8Zp32hjF8YmaKql_aH-yeGLmvHP1oBKQ';
  const BASE_URL =
    dev
      ? 'http://localhost:8000'
      : 'https://github.com/peolic/stashdb_backlog_data/releases/download/cache';

  const urlRegex = new RegExp(
    String.raw`(?:/([a-z]+)`
      + String.raw`(?:/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w\d. -]+)`
        + String.raw`(?:/([a-z]+)`
        + String.raw`)?`
      + String.raw`)?`
    + String.raw`)?`
  );

  /**
   * @param {string} [inputUrl]
   * @returns {LocationData}
   */
  const parsePath = (inputUrl) => {
    const { pathname } = inputUrl ? new URL(inputUrl) : window.location;

    /** @type {LocationData} */
    const result = {
      object: null,
      ident: null,
      action: null,
    };

    if (!pathname) return result;

    const match = urlRegex.exec(decodeURIComponent(pathname));
    if (!match || match.length === 0) return result;

    result.object = /** @type {AnyObject} */ (match[1]) || null;
    result.ident = match[2] || null;
    result.action = match[3] || null;

    if (result.ident === 'add' && !result.action) {
      result.action = result.ident;
      result.ident = null;
    }

    return result;
  };

  const getUser = async () => {
    const profile = /** @type {HTMLAnchorElement} */ (await elementReadyIn('#root nav a[href^="/users/"]', 1000));
    if (!profile) return null;
    return profile.innerText;
  };

  const wait = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * @param {AnyObject | null} object
   * @returns {object is SupportedObject}
   */
  const isSupportedObject = (object) => {
    return !!object && ['scenes', 'performers'].includes(object);
  };

  /**
   * @param {string} selector
   * @param {number} [timeout] fail after, in milliseconds
   * @param {HTMLElement} [parentEl]
   */
  const elementReadyIn = (selector, timeout, parentEl) => {
    const promises = [elementReady(selector, parentEl)];
    if (timeout) promises.push(wait(timeout).then(() => null));
    return Promise.race(promises);
  };

  /**
   * @param {Element} el
   * @returns {Record<string, any> | undefined}
   */
  const getReactFiber = (el) =>
    //@ts-expect-error
    el[Object.getOwnPropertyNames(el).find((p) => p.startsWith('__reactFiber$'))];

  const reactRouterHistory = await (async () => {
    const getter = () => {
      const e = document.querySelector('#root > div');
      if (!e) return undefined;
      const f = getReactFiber(e);
      if (!f) return undefined;
      let r = f;
      while ((r = r.return) && r !== null && !r.memoizedProps?.value?.navigator);
      return r?.memoizedProps?.value?.navigator;
    };

    let attempt = 0;
    let history = getter();
    while (!history) {
      if (attempt === 5) return undefined;
      attempt++;
      await wait(100);
      history = getter();
    }
    return history;
  })();

  let isDev = false;
  /** @type {Settings} */
  let settings;

  async function dispatcher(init=false) {
    const loc = parsePath();
    if (!loc) {
      throw new Error('[backlog] Failed to parse location!');
    }

    await Promise.all([
      elementReadyIn('#root > *'),
      elementReadyIn('.MainContent .LoadingIndicator', 100),
    ]);

    if (document.querySelector('.LoginPrompt')) return;

    isDev = devUsernames.includes(await getUser());
    settings = await Cache.getSettings();

    setUpStatusDiv();
    setUpInfo();

    // Ensure data is populated
    if (!await Cache.getStoredData(true)) {
      return setStatus('[backlog] failed to ensure cache data', 10000);
    }

    if (init) {
      console.log('[backlog] init');
      await updateBacklogData();
      setUpMenu();
      globalStyle();
    }

    const { object, ident, action } = loc;

    if (object === 'scenes') {
      if (ident) {
        // Scene page
        if (!action) {
          await iScenePage(ident);
          if (window.location.hash === '#edits') {
            await iEditCards();
          }
          return;
        }
        // Scene edit page
        else if (action === 'edit') return await iSceneEditPage(ident);
      } else {
        // Main scene cards list
        return await highlightSceneCards(object);
      }
    }

    if (object === 'studios' && ident && !action) {
      await iStudioPage(ident);
      if (window.location.hash === '#edits') {
        await iEditCards();
      } else if (window.location.hash === '#performers') {
        await highlightPerformerCards();
      }
      return;
    }

    // Scene cards lists on Tag pages
    if (object === 'tags' && ident && !action) {
      return await highlightSceneCards(object);
    }

    if (object === 'performers') {
      if (!ident && !action) {
        return await highlightPerformerCards();
      }

      if (ident && !action) {
        await iPerformerPage(ident);
        if (window.location.hash === '#edits') {
          await iEditCards();
        } else if (window.location.hash === '#scenePairings') {
          await highlightPerformerCards();
        }
        return;
      }

      if (ident) {
        if (action === 'edit')
          return await iPerformerEditPage(ident);
        if (action === 'merge')
          return await iPerformerMergePage(ident);
      }
    }

    // /edits
    // /edits/:uuid
    // /users/:user/edits
    if (
      (object === 'edits' && !action)
      || (object === 'users' && ident && action === 'edits')
    ) {
      return await iEditCards();
    }

    // Search results
    if (object === 'search') {
      return await iSearchPage();
    }

    // Backlog - generated pages

    // FIXME: (2024-01-07) temporary - redirect old
    const newBacklogPath = ({
      'pbacklog': ['backlog', 'performers'],
      'preadyfragments': ['backlog', 'fragments-ready'],
      'pfragments': ['backlog', 'fragment-search'],
    })[/** @type {string} */ (object)];

    if (newBacklogPath) {
      document.body.innerHTML = '<div align="center" class="mt-5 fs-1 fw-bold">Redirecting\u{2026}</div>';
      setTimeout(() => {
        window.location.pathname = '/' + newBacklogPath.join('/');
      }, 500);
      return;
    }

    //@ts-expect-error
    if (object === 'backlog') {
      if (!ident) {
        // Backlog info page
        toggleBacklogInfo(true);

        const backlogInfoStyle = document.createElement('style');
        backlogInfoStyle.id = 'backlog-info-page';
        backlogInfoStyle.textContent = [
          `nav > .backlog-info > div { margin-top: 2em; margin-right: calc(50vw - 7em); font-size: 1.3em; width: 450px !important; }`,
          `nav > .backlog-info > span { opacity: 0.5; pointer-events: none; }`,
        ].join('\n');
        document.head.append(backlogInfoStyle);

        window.addEventListener(locationChanged, () => {
          toggleBacklogInfo(false);
          backlogInfoStyle.remove();
        }, { once: true });

        return;
      }

      // Backlog scenes list page
      if (ident === 'scenes') {
        return await iSceneBacklogPage();
      }

      // Backlog performers list page
      if (ident === 'performers') {
        return await iPerformerBacklogPage();
      }

      // Backlog performers to split with ready fragments list page
      if (ident === 'fragments-ready') {
        return await iPerformersSplitReadyFragmentsPage();
      }

      // Fragments list page
      if (ident === 'fragment-search') {
        return await iPerformerFragmentsPage();
      }

      // Search performer by URL page
      if (ident === 'url-search') {
        return await iPerformerURLSearchPage();
      }
    }

    // Home page
    if (!object && !ident && !action) {
      return await iHomePage();
    }

    const identAction = ident ? `${ident}/${action}` : `${action}`;
    console.debug(`[backlog] nothing to do for ${object}/${identAction}.`);
  }

  if (reactRouterHistory) {
    // reactRouterHistory.listen(() => dispatcher());
    console.debug(`[backlog] hooked into react router`);
  }
  window.addEventListener(locationChanged, async (ev) => {
    if (/** @type {CustomEvent<string>} */ (ev).detail === 'popstate') await wait(200);
    dispatcher();
  });

  setTimeout(dispatcher, 0, true);

  async function setUpStatusDiv() {
    if (document.querySelector('div#backlogStatus')) return;
    const statusDiv = document.createElement('div');
    statusDiv.id = 'backlogStatus';
    statusDiv.classList.add('me-auto', 'd-none');
    const navLeft = await elementReadyIn('nav > :first-child', 1000);
    navLeft.after(statusDiv);

    window.addEventListener(locationChanged, () => setStatus(''));

    new MutationObserver(() => {
      statusDiv.classList.toggle('d-none', !statusDiv.innerText);
    }).observe(statusDiv, { childList: true, subtree: true });
  }

  async function setUpMenu() {
    /** @param {boolean} forceFetch */
    const fetchData = async (forceFetch) => {
      const result = await (forceFetch ? fetchBacklogData() : updateBacklogData(true));
      if (result === 'ERROR') {
        setStatus('[backlog] failed to download cache', 10000);
        return;
      }
      if (result === 'UPDATED') {
        setStatus('[backlog] cache downloaded, reloading page...');
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setStatus('[backlog] no updates found', 5000);
      }
    }

    //@ts-expect-error
    GM.registerMenuCommand('🔄 Check for updates', () => {
      fetchData(false);
    });

    if (isDev) {
      //@ts-expect-error
      GM.registerMenuCommand('📥 Download cache', () => {
        fetchData(true);
      });
    }
  }

  function globalStyle() {
    //@ts-expect-error
    GM.addStyle(`
.performer-backlog:empty,
.scene-backlog:empty,
.studio-backlog:empty {
  display: none;
}

.SceneCard.backlog-highlight .card-footer {
  padding: .5rem;
}

.backlog-fingerprint {
  background-color: var(--bs-warning);
}

.backlog-fingerprint-duration {
  background-color: #4691ff;
}

.performer-backlog [data-backlog="split"] s {
  /* text-muted */
  --bs-text-opacity: 1;
  color: #bfccd6;
}

.performer-backlog [data-backlog="split"] a[href^="/scenes/"] {
  color: rgba(0,212,255,1) !important;
}

/* https://codepen.io/zachhanding/pen/MKyVPq */
.line-clamp {
  display: block;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  position: relative;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 !important;
  -webkit-line-clamp: var(--line-clamp);
  max-height: calc(1em * var(--bs-body-line-height) * var(--line-clamp));
}

input.backlog-flash,
textarea.backlog-flash {
  background-color: #0060df;
  color: #ffffff;
}

button.nav-link.backlog-flash {
  background-color: var(--bs-yellow);
  color: var(--bs-dark);
}

.backlog-flash:not(input, textarea, button.nav-link) {
  outline: .5rem solid var(--bs-yellow);
}

details.backlog-fragment:not([open]) > summary > span:first-child,
details.backlog-fragment:not([open]) > summary::marker {
  color: var(--bs-orange);
}
    `);
  }

  /**
   * @param {string} text
   * @param {number} [resetAfter] in milliseconds
   */
  function setStatus(text, resetAfter) {
    /** @type {HTMLDivElement} */
    const statusDiv = (document.querySelector('div#backlogStatus'));
    statusDiv.innerText = text;
    if (isDev && text)
      console.debug(text);
    const id = Number(statusDiv.dataset.reset);
    if (id) {
      clearTimeout(id);
      statusDiv.dataset.reset = '';
    }
    if (resetAfter) {
      const id = setTimeout(() => {
        statusDiv.innerText = '';
        statusDiv.dataset.reset = '';
      }, resetAfter);
      statusDiv.dataset.reset = String(id);
    }
  }

  function setUpInfo() {
    let info = /** @type {HTMLDivElement} */ (document.querySelector('#root nav > .backlog-info > div'));
    if (!info) {
      const infoContainer = document.createElement('div');
      infoContainer.classList.add('backlog-info');
      infoContainer.style.position = 'relative';

      const icon = document.createElement('span');
      icon.innerText = '📃';
      icon.title = 'Backlog Info';
      setStyles(icon, {
        cursor: 'pointer',
        position: 'absolute',
        left: '2px',
        top: '-12px',
      });

      info = document.createElement('div');
      setStyles(info, {
        position: 'absolute',
        width: '280px',
        top: '32px',
        right: '-20px',
        textAlign: 'center',
        border: '.25rem solid #cccccc',
        padding: '0.3rem',
        zIndex: '100',
        backgroundColor: 'var(--bs-gray-dark)',
        display: 'none',
      });

      icon.addEventListener('click', () => toggleBacklogInfo());

      infoContainer.append(icon, info);

      const target = document.querySelector('#root nav');
      target.appendChild(infoContainer);
    }
  }

  /** @param {boolean} [newState] */
  function toggleBacklogInfo(newState) {
    const info = /** @type {HTMLDivElement} */ (document.querySelector('#root nav > .backlog-info > div'));

    if (newState === undefined) {
      newState = info.style.display === 'none';
    }

    if (newState) {
      updateInfo();
      info.style.display = '';
    } else {
      info.style.display = 'none';
    }
  }

  function updateInfo() {
    const info = /** @type {HTMLDivElement} */ (document.querySelector('#root nav > .backlog-info > div'));

    /**
     * @param {string} text
     * @param {...string} cls
     */
    const block = (text, ...cls) => {
      const div = document.createElement('div');
      if (cls.length > 0) div.classList.add(...cls);
      div.innerText = text;
      return div;
    };

    info.innerHTML = '';
    info.append(block('backlog data last updated:'));

    const { lastUpdated } = Cache.data;
    if (!lastUpdated) {
      info.append(block('?', 'd-inline-block'));
    } else {
      const ago = humanRelativeDate(new Date(lastUpdated));
      info.append(
        block(ago, 'd-inline-block', 'me-1'),
        block(`(${formatDate(lastUpdated)})`, 'd-inline-block'),
      );

      const hr = document.createElement('hr');
      hr.style.backgroundColor = '#cccccc';

      //@ts-expect-error
      const usVersion = GM.info.script.version;
      const versionInfo = block(`userscript version: ${usVersion}`);
      info.append(hr, versionInfo);

      const toggleSceneCardPerformers = makeLink('#', 'Toggle scene card performers');
      setStyles(toggleSceneCardPerformers, {
        cursor: 'pointer',
        color: settings.sceneCardPerformers ? 'var(--bs-success)' : 'var(--bs-danger)',
      });
      toggleSceneCardPerformers.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const newState = await Cache.toggleSetting('sceneCardPerformers');
        toggleSceneCardPerformers.style.color = newState ? 'var(--bs-success)' : 'var(--bs-danger)';
      });

      info.append(
        toggleSceneCardPerformers,
        hr.cloneNode(),
        makeLink('/backlog/scenes', 'Scene Backlog Summary Page'),
        hr.cloneNode(),
        makeLink('/backlog/performers', 'Performer Backlog Summary Page'),
        hr.cloneNode(),
        makeLink('/backlog/fragments-ready', 'Performers with ready fragments'),
        hr.cloneNode(),
        makeLink('/backlog/fragment-search', 'Performer Fragments Search Page'),
        hr.cloneNode(),
        makeLink('/backlog/url-search', '[\u{03B1}] Performer URL Search Page'),
      );
    }
  }

  // =====

  /**
   * @template {HTMLElement | SVGSVGElement} E
   * @param {E} el
   * @param {Partial<CSSStyleDeclaration>} styles
   * @returns {E}
   */
  function setStyles(el, styles) {
    Object.assign(el.style, styles);
    return el;
  }

  /**
   * Format seconds as duration, adapted from stash-box
   * @param {number | null} [dur] seconds
   * @returns {string}
   */
  function formatDuration(dur) {
    if (!dur) return "";
    let value = dur;
    let hour = 0;
    let minute = 0;
    let seconds = 0;
    if (value >= 3600) {
      hour = Math.floor(value / 3600);
      value -= hour * 3600;
    }
    minute = Math.floor(value / 60);
    value -= minute * 60;
    seconds = value;

    const res = [
      minute.toString().padStart(2, "0"),
      seconds.toString().padStart(2, "0"),
    ];
    if (hour) res.unshift(hour.toString());
    return res.join(":");
  }

  /**
   * @param {Date} dt
   * @returns {string}
   * @see https://github.com/bahamas10/human/blob/a1dd7dab562fabce86e98395bc70ae8426bb188e/human.js
   */
  function humanRelativeDate(dt) {
    let seconds = Math.round((Date.now() - dt.getTime()) / 1000);
    const suffix = seconds < 0 ? 'from now' : 'ago';
    seconds = Math.abs(seconds);

    const times = [
      seconds / 60 / 60 / 24 / 365, // years
      seconds / 60 / 60 / 24 / 30,  // months
      seconds / 60 / 60 / 24 / 7,   // weeks
      seconds / 60 / 60 / 24,       // days
      seconds / 60 / 60,            // hours
      seconds / 60,                 // minutes
      seconds                       // seconds
    ];
    const names = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];

    for (let i = 0; i < names.length; i++) {
      const time = Math.floor(times[i]);
      let name = names[i];
      if (time > 1)
        name += 's';

      if (time >= 1)
        return `${time} ${name} ${suffix}`;
    }
    return 'now';
  }

  /**
   * Format date.
   * @param {string | Date} [date]
   * @returns {string}
   */
  function formatDate(date) {
    if (!date) return '';
    date = date instanceof Date ? date : new Date(date);
    return date.toLocaleString("en-us", { month: "short", year: "numeric", day: "numeric" })
      + ' ' + date.toLocaleTimeString(navigator.languages[0]);
  }

  /**
   * @see https://github.com/stashapp/stash/blob/v0.12.0/ui/v2.5/src/utils/hamming.ts
   * @param {string} hex
   */
  function hexToBinary(hex) {
    return hex.split('').map((i) => parseInt(i, 16).toString(2).padStart(4, '0')).join('');
  }

  /**
   * @see https://github.com/stashapp/stash/blob/v0.12.0/ui/v2.5/src/utils/hamming.ts
   * @param {string} a
   * @param {string | null} [b]
   * @returns {number}
   */
  function hammingDistance(a, b) {
    if (!b || a.length !== b.length) return 32;

    const aBinary = hexToBinary(a);
    const bBinary = hexToBinary(b);

    let counter = 0;
    for (let i = 0; i < aBinary.length; i++) {
      if (aBinary[i] !== bBinary[i]) counter++;
    }

    return counter;
  }

  /**
   * @param {string} url
   * @param {XMLHttpRequestResponseType} responseType
   */
  async function request(url, responseType) {
    const response = await new Promise((resolve, reject) => {
      console.debug(`[backlog] requesting ${responseType}: ${url}`);
      const headers = responseType === 'json'
        ? {'Cache-Control': 'no-cache, no-store, max-age=0'}
        : undefined;
      //@ts-expect-error
      GM.xmlHttpRequest({
        method: 'GET',
        url,
        headers,
        responseType,
        anonymous: true,
        timeout: 10000,
        onload: resolve,
        onerror: reject,
      });
    });

    const ok = response.status >= 200 && response.status <= 299;
    if (!ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} GET ${url}`);
    }
    return response.response;
  }

  /**
   * @param {BaseCache} storedObject
   * @param {number | Date} diff max time in hours or last updated date
   * @returns {boolean}
   */
  function shouldFetch(storedObject, diff) {
    if (!storedObject) return true;

    if (diff instanceof Date) {
      const { lastUpdated } = storedObject;
      return !lastUpdated || diff.getTime() > new Date(lastUpdated).getTime();
    }

    if (typeof diff === 'number') {
      const { lastUpdated, lastChecked } = storedObject;
      if (!lastUpdated) return true;
      const timestamp = new Date(lastChecked || lastUpdated).getTime();
      return new Date().getTime() >= (timestamp + 1000 * 60 * 60 * diff);
    }

    return false;
  }

  /**
   * @returns {Promise<Date | null>}
   */
  async function getDataLastUpdatedDate() {
    try {
      console.debug('[backlog] fetching last updated date for data');
      const response = await fetch(
        'https://api.github.com/repos/peolic/stashdb_backlog_data/releases',
        { credentials: 'same-origin', referrerPolicy: 'same-origin' },
      );
      if (!response.ok) {
        const body = await response.text();
        console.error('[backlog] api fetch bad response', response.status, body);
        return null;
      }
      /** @type {{ tag_name: string, created_at: string, [k: string]: unknown }[]} */
      const data = await response.json();
      const release = data.find((r) => r.tag_name === 'cache');
      if (!release) throw new Error('cache release not found');
      return new Date(release.created_at);

    } catch (error) {
      console.error('[backlog] api fetch error', error);
      throw error;
    }
  }

  class Cache {
    static _SETTINGS_KEY = 'settings';
    static _DATA_INDEX_KEY = 'stashdb_backlog_index';
    static _SCENES_DATA_KEY = 'stashdb_backlog_scenes';
    static _PERFORMERS_DATA_KEY = 'stashdb_backlog_performers';
    static _LEGACY_DATA_KEY = 'stashdb_backlog';

    /** @type {Settings | null} */
    static _settings = null;

    static async getSettings(invalidate = false) {
      if (!this._settings || invalidate) {
        this._settings = /** @type {Settings} */ (await this._getValue(this._SETTINGS_KEY));
      }
      return this._settings;
    }

    /**
     * @param {keyof Settings} name
     * @returns {Promise<boolean>} */
    static async toggleSetting(name) {
      if (!this._settings) await this.getSettings();
      this._settings[name] = !this._settings[name];
      await this._setValue(this._SETTINGS_KEY, this._settings);
      return this._settings[name];
    }

    /** @type {DataCache | null} */
    static _data = null;
    /** @type {PerformerScenes | null} */
    static _performerScenes = null;

    /** @param {boolean} invalidate Force reload of stored data */
    static async getStoredData(invalidate = false) {
      if (!this._data || invalidate) {
        const scenes = /** @type {DataCache['scenes']} */ (await this._getValue(this._SCENES_DATA_KEY));
        const performers = /** @type {DataCache['performers']} */ (await this._getValue(this._PERFORMERS_DATA_KEY));
        const cache = /** @type {BaseCache} */ (await this._getValue(this._DATA_INDEX_KEY));
        const { lastChecked, lastUpdated, submitted } = cache;
        /** @type {DataCache} */
        const dataCache = { scenes, performers, lastChecked, lastUpdated, submitted };
        if (Object.values(scenes).length === 0 && Object.values(performers).length === 0) {
          const legacyCache = /** @type {CompactDataCache} */ (await this._getValue(this._LEGACY_DATA_KEY));
          this._data = await applyDataCacheMigrations(legacyCache);
        } else {
          this._data = dataCache;
        }

        this._data = await applyMigrations(this._data);
        await this.setData(this._data);

        this._performerScenes = this._generatePerformerScenes();
      }
      return this._data;
    }
    static async setData(/** @type {DataCache} */ data) {
      const { scenes, performers, ...cache } = data;
      await this._setValue(this._SCENES_DATA_KEY, scenes);
      await this._setValue(this._PERFORMERS_DATA_KEY, performers);
      await this._setValue(this._DATA_INDEX_KEY, cache);
      this._data = data;
    }
    static async clearData() {
      await this._deleteValue(this._SCENES_DATA_KEY);
      await this._deleteValue(this._PERFORMERS_DATA_KEY);
      await this._deleteValue(this._DATA_INDEX_KEY);
      this._data = null;
      this._performerScenes = null;
    }

    static _generatePerformerScenes() {
      if (!this._data) return null;
      /** @type {PerformerScenes} */
      const result = {};
      for (const [sceneId, scene] of Object.entries(this._data.scenes)) {
        if (!scene.performers) continue;
        for (const [actionStr, entries] of Object.entries(scene.performers)) {
          const action = /** @type {keyof SceneDataObject["performers"]} */ (actionStr);
          for (const entry of entries) {
            if (!entry.id) continue;
            if (!result[entry.id]) result[entry.id] = [];
            result[entry.id].push({ sceneId, action });
          }
        }
      }
      return result;
    }

    static get data() {
      if (!this._data) throw new Error('Unexpected: null data');
      return Object.freeze(this._data);
    }

    /**
     * @param {string} performerId
     */
    static performerScenes(performerId) {
      if (!this._performerScenes) throw new Error('No performer-scenes data');
      return this._performerScenes[performerId] ?? [];
    }

    // ===

    /**
     * @template T
     * @param {string} key
     * @returns {Promise<T>}
     */
    static async _getValue(key) {
      //@ts-expect-error
      let stored = await GM.getValue(key, {});
      // Legacy stored as JSON
      if (typeof stored === 'string') stored = JSON.parse(stored);
      if (!stored) {
        throw new Error(`[backlog] invalid data stored in ${key}`);
      }
      return stored;
    }

    /**
     * @template T
     * @param {string} key
     * @param {T} value
     */
    static async _setValue(key, value) {
      //@ts-expect-error
      return await GM.setValue(key, value);
    }

    /** @param {string} key */
    static async _deleteValue(key) {
      //@ts-expect-error
      return await GM.deleteValue(key);
    }
  } // Cache

  /**
   * @template {DataObject} T
   * @param {T} dataObject
   * @returns {DataObjectKeys<T>[]}
   */
  function dataObjectKeys(dataObject) {
    return (
      /** @type {DataObjectKeys<T>[]} */
      (Object.keys(dataObject).filter((key) => key !== 'comments' && key !== 'c_studio' && key !== 'name'))
    );
  }

  /**
   * @param {CompactDataCache} legacyCache
   * @returns {Promise<DataCache>}
   */
  async function applyDataCacheMigrations(legacyCache) {
    const { lastChecked, lastUpdated, submitted: legacySubmitted } = legacyCache;
    /** @type {DataCache} */
    const dataCache = {
      scenes: {},
      performers: {},
      lastChecked,
      lastUpdated,
      submitted: {
        scenes: (Array.isArray(legacySubmitted) ? legacySubmitted : legacySubmitted?.scenes) ?? [],
        performers: (Array.isArray(legacySubmitted) ? [] : legacySubmitted?.performers) ?? [],
      },
    };

    // `scene/${uuid}` | `performer/${uuid}`
    const allKeys = Object.keys(legacyCache);
    const oldKeys = allKeys.filter((k) => k.includes('/'));
    if (oldKeys.length === 0) {
      if (allKeys.length === 0) return dataCache;
      else throw new Error(`migration failed: invalid object`);
    }

    /** @type {SupportedObject[]} */
    let seen = [];
    const log = (/** @type {SupportedObject} */ object) => {
      if (!seen.includes(object)) {
        console.debug(`[backlog] data-cache migration: convert from '${object}/uuid' key format`);
        seen.push(object);
      }
    };

    for (const cacheKey of oldKeys) {
      const [oldObject, uuid] = /** @type {['scene' | 'performer', string]} */ (cacheKey.split('/'));
      const object = /** @type {SupportedObject} */ (`${oldObject}s`);
      log(object);
      if (!(object in dataCache)) {
        throw new Error(`migration failed: ${object} missing from new data cache object`);
      }
      dataCache[object][uuid] = legacyCache[cacheKey];
    }

    await Cache.setData(dataCache);

    if (oldKeys.length > 0) {
      await Cache._deleteValue(Cache._LEGACY_DATA_KEY);
    }

    return dataCache;
  }

  /**
   * @param {MigrationDataCache} dataCache
   * @returns {Promise<DataCache>}
   */
  async function applyMigrations(dataCache) {
    const performersMigration = Object.values(dataCache.performers);

    // performer split `shards` -> `fragments`
    performersMigration.forEach((item) => {
      if (!item.split?.shards) return;
      item.split.fragments = item.split.shards;
      delete item.split.shards;
    });

    return dataCache;
  }

  async function fetchBacklogData() {
    try {
      setStatus(`[backlog] getting cache...`);

      /** @type {CompactDataCache} */
      const legacyCache = (await request(`${BASE_URL}/stashdb_backlog.json`, 'json'));
      let dataCache = await applyDataCacheMigrations(legacyCache);
      dataCache = await applyMigrations(dataCache);
      await Cache.setData(dataCache);

      setStatus('[backlog] data updated', 5000);
      return 'UPDATED';

    } catch (error) {
      setStatus(`[backlog] error:\n${error}`);
      console.error('[backlog] error getting cache', error);
      return 'ERROR';
    }
  }

  async function updateBacklogData(forceCheck=false) {
    let updateData = shouldFetch(Cache.data, 1);
    if (!dev && (forceCheck || updateData)) {
      try {
        // Only fetch if there really was an update
        setStatus(`[backlog] checking for updates`);
        const lastUpdated = await getDataLastUpdatedDate();
        if (lastUpdated) {
          updateData = shouldFetch(Cache.data, lastUpdated);
          console.debug(
            `[backlog] latest remote update: ${formatDate(lastUpdated)}`
            + ` - updating: ${updateData}`
          );
        }
        setStatus('');
      } catch (error) {
        setStatus(`[backlog] error:\n${error}`);
        console.error('[backlog] error trying to determine latest data update', error);
        return 'ERROR';
      } finally {
        // Store the last-checked timestamp as to not spam GitHub API
        const newData = { ...Cache.data, lastChecked: new Date().toISOString() };
        await Cache.setData(newData);
      }
    }

    if (!updateData) {
      return 'CACHED';
    }

    const result = await fetchBacklogData();
    if (result === 'UPDATED') updateInfo();
    return result;
  }

  /**
   * @template {SupportedObject} T
   * @template {string} I
   * @param {T} object
   * @param {I} uuid
   * @returns {DataCache[T][I] | null}
   */
  function getDataFor(object, uuid) {
    return Cache.data[object][uuid];
  }

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @returns {boolean | null}
   */
  function isSubmitted(object, uuid) {
    if (object !== 'scenes' && object !== 'performers') return null;
    return Cache.data.submitted[object].find((i) => i === uuid) !== undefined;
  }

  /**
   * @param {string} url
   * @returns {Promise<Blob>}
   */
  function getImageBlob(url) {
    return request(url, 'blob');
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobAsDataURI(blob) {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    return new Promise((resolve) => {
      reader.addEventListener('loadend', () => {
        resolve(/** @type {string} */ (reader.result));
      });
    });
  }

  /**
   * @param {HTMLImageElement} img
   * @returns {Promise<void>}
   */
  async function imageReady(img) {
    if (img.complete && img.naturalHeight !== 0) return;
    return new Promise((resolve, reject) => {
      const onLoad = () => {
        img.removeEventListener('error', onError);
        resolve();
      }
      const onError = (/** @type {ErrorEvent} */ event) => {
        img.removeEventListener('load', onLoad);
        reject(event.message || 'unknown');
      }
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });
  }

  /**
   * @param {Promise<Blob>} image
   * @param {Promise<Blob>} newImage
   * @returns {Promise<boolean | Error>} same image?
   */
  async function compareImages(image, newImage) {
    try {
      const dataURI = await blobAsDataURI(await image);
      const newDataURI = await blobAsDataURI(await newImage);
      return dataURI === newDataURI;
    } catch (error) {
      return /** @type {Error} **/ (error);
    }
  }

  /**
   * @param {HTMLImageElement} img
   * @param {'start' | 'end' | null} [hPosition]
   * @param {'top' | 'bottom' | null} [vPosition]
   * @param {ScenePerformance_Image} [full]
   * @returns {HTMLDivElement}
   */
  function makeImageResolution(img, hPosition, vPosition, full) {
    const imgRes = document.createElement('div');
    const hPositionClasses = !hPosition ? [] : [`${hPosition}-0`, `m${hPosition.charAt(0)}-2`];
    const vPositionClasses = !vPosition ? [] : [`${vPosition}-0`, `m${vPosition.charAt(0)}-2`];
    imgRes.classList.add('position-absolute', ...hPositionClasses, ...vPositionClasses, 'px-2', 'fw-bold');
    setStyles(imgRes, { backgroundColor: '#00689b', transition: 'opacity .2s ease' });

    imageReady(img).then(
      () => imgRes.innerText =
        full
          ? `${full.width} x ${full.height}`
          : `${img.naturalWidth} x ${img.naturalHeight}`,
      () => imgRes.innerText = `??? x ???`,
    );

    img.addEventListener('mouseover', () => imgRes.style.opacity = '0');
    img.addEventListener('mouseout', () => imgRes.style.opacity = '');
    return imgRes;
  }

  /**
   * All external links are made with `_blank` target.
   * @param {string} url
   * @param {string | null} [text] if not provided, text is the url itself, null to keep contents as is
   * @param {Partial<CSSStyleDeclaration>} [style]
   * @param {HTMLAnchorElement} [el] anchor element to use
   * @returns {HTMLAnchorElement}
   */
  function makeLink(url, text, style, el) {
    const a = el instanceof HTMLAnchorElement ? el : document.createElement('a');

    if (style) {
      setStyles(a, style);
    }

    if (text !== null) {
      a.innerText = text === undefined ? url : text;
    }
    // Relative
    if (url.startsWith('/') || !/^https?:/.test(url)) {
      a.href = url;
      routerLink(a);
      return a;
    }

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (error) {
      console.error(url, error);
    }

    // Safe, make relative
    if (urlObj && urlObj.hostname === 'stashdb.org') {
      a.href = urlObj.href.slice(urlObj.origin.length);
      routerLink(a);
      return a;
    }

    // External
    a.href = urlObj ? urlObj.href : url;
    a.target = '_blank';
    a.rel = 'nofollow noopener noreferrer';
    return a;
  }

  /**
   * @param {HTMLAnchorElement} el
   * @param {string} [url]
   */
  function routerLink(el, url) {
    if (!reactRouterHistory) return;
    url = url ? url : el.getAttribute('href');
    el.addEventListener('click', (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const state = el.dataset.state ? JSON.parse(el.dataset.state) : undefined;
      reactRouterHistory.push(url, { state });
    });
  }

  /**
   * @param {HTMLElement} element
   * @param {string} value
   * @see https://stackoverflow.com/a/48890844
   * @see https://github.com/facebook/react/issues/10135#issuecomment-401496776
   */
  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      throw new Error('The given element does not have a value setter');
    }

    const eventName = element instanceof HTMLSelectElement ? 'change' : 'input';
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  /**
   * @param {string} sheetId
   * @param {string} query
   * @returns {string}
   */
  function backlogQuickViewURL(sheetId, query) {
    const search = new URLSearchParams({ gid: sheetId, tqx: 'out:html', tq: query }).toString();
    return `${backlogSpreadsheet}/gviz/tq?${search}`;
  }

  const parseFingerprintTableRows = (/** @type {HTMLTableRowElement[]} */ rows) => {
    const headers =
      /** @type {HTMLTableCellElement[]} */
      (Array.from(rows[0].children))
        .reduce((r, cell, cellIndex) => {
          if (cell.innerText === 'Algorithm') r.algorithm = cellIndex;
          else if (cell.innerText === 'Hash') r.hash = cellIndex;
          else if (cell.innerText === 'Duration') r.duration = cellIndex;
          else if (cell.innerText === 'Submissions') r.submissions = cellIndex;
          return r;
        }, /** @type {FingerprintsColumnIndices} */ ({}));
    /** @type {FingerprintsRow[]} */
    const fingerprints = rows.slice(1).map((row) => {
      const cells = /** @type {HTMLTableCellElement[]} */ (Array.from(row.children));
      const durationEl = /** @type {HTMLSpanElement} */ (cells[headers.duration].firstElementChild);
      const duration = durationEl?.title.match(/(\d+)( second)?s$/)?.[1];
      if (!durationEl || !duration) throw new Error('[backlog] unable to parse fingerprint duration!');
      return {
        row,
        algorithm: /** @type {FingerprintsRow["algorithm"]} */ (cells[headers.algorithm].innerText),
        hash: cells[headers.hash].innerText,
        duration: duration ? Number(duration) : null,
        submissions: Number(cells[headers.submissions].innerText) || null,
      };
    });
    return { headers, fingerprints };
  };

  /**
   * @param {Pick<SceneFingerprint, "algorithm" | "hash">} fp fingerprint to search for
   * @returns {(cfp: Pick<FingerprintsRow, "algorithm" | "hash">) => boolean} predicate
   */
  const findFingerprint = (fp) =>
    (cfp) => (cfp.algorithm === fp.algorithm.toUpperCase() && cfp.hash === fp.hash);

  /**
   * @param {PerformerEntry} [entry]
   * @returns {HTMLElement[]}
   */
  function makeNoteElements(entry) {
    /** @type {HTMLElement[]} */
    const result = [];
    if (!entry.notes) return result;

    const links = /** @type {string[]} */ ([]);
    const notes = /** @type {string[]} */ ([]);
    entry.notes.forEach((note) => (/^https?:/.test(note) ? links : notes).push(note));

    if (notes.length > 0) {
      const sup = document.createElement('sup');
      sup.title = notes.join('\n');
      sup.innerText = '📝';
      setStyles(sup, { cursor: 'help' });
      result.push(sup);
    }

    return result.concat(
      links.map((url, cite) => {
        const sup = document.createElement('sup');
        const link = sup.appendChild(
          makeLink(url, `[${cite + 1}]`, { color: 'var(--bs-teal)' })
        );
        link.title = url;
        return sup;
      })
    );
  }

  /**
   * @param {string} text
   * @param {Partial<CSSStyleDeclaration>} [style]
   * @returns {HTMLSpanElement}
   */
  function createSelectAllSpan(text, style) {
    const span = document.createElement('span');
    span.innerText = text;
    return setStyles(span, { userSelect: 'all', ...style });
  };

  /** @param {HTMLElement | string} fieldOrText */
  const getTabButton = (fieldOrText) => {
    /** @type {HTMLButtonElement[]} */
    const buttons = (Array.from(document.querySelectorAll('form ul.nav button.nav-link')));

    if (typeof fieldOrText === 'string') {
      return buttons.find((btn) => btn.textContent.trim() === fieldOrText);
    }

    const tabContent = fieldOrText.closest('form > .tab-content > *');
    const index = Array.prototype.indexOf.call(tabContent.parentElement.children, tabContent);
    const button = buttons[index];
    if (!button) throw new Error('tab button not found');
    return button;
  };

  /** @param {HTMLElement} fieldEl */
  const flashField = (fieldEl) => {
    const activeTabButton = document.querySelector('form ul.nav button.nav-link.active');
    const fieldTabButton = getTabButton(fieldEl);
    const tabFlash = activeTabButton !== fieldTabButton && !fieldTabButton.classList.contains('backlog-flash');

    fieldEl.classList.add('backlog-flash');
    if (tabFlash)
      fieldTabButton.classList.add('backlog-flash');
    setTimeout(() => {
      fieldEl.classList.remove('backlog-flash');
      if (tabFlash)
        fieldTabButton.classList.remove('backlog-flash');
    }, 1500);
  };

  const getLinks = () =>
    Array.from(document.querySelectorAll('form .URLInput > ul > li > .input-group'))
      .map(({ children }) => ({
        remove: () => /** @type {HTMLButtonElement} */ (children[0]).click(),
        type: /** @type {HTMLSpanElement} */ (children[1]).textContent,
        value: /** @type {HTMLSpanElement} */ (children[2]).textContent,
      }));

  /** @param {string} site */
  const getLinkBySiteType = (site) => getLinks()
    .find((l) => l.type.localeCompare(site, undefined, { sensitivity: 'accent' }) === 0);

  /** @param {string} url */
  const getLinkByURL = (url) => getLinks().find((l) => l.value === url);

  /**
   * @param {string} site
   * @param {string} url
   * @param {boolean} [replace=false]
   */
  const addSiteURL = async (site, url, replace = false) => {
    const link = getLinkBySiteType(site);

    if (link) {
      if (!replace && link.value === url) {
        return alert(`${site} link already correct`);
      }
      link.remove();
    }

    const linksContainer = /** @type {HTMLDivElement} */ (document.querySelector('form .URLInput'));
    const urlInput = linksContainer.querySelector(':scope > .input-group');
    const siteSelect = /** @type {HTMLSelectElement} */ (urlInput.children[1]);
    const inputField = /** @type {HTMLInputElement} */ (urlInput.children[2]);
    const addButton = /** @type {HTMLButtonElement} */ (urlInput.children[3]);
    const linkSite = Array.from(siteSelect.options)
      .find((o) => o.text.localeCompare(site, undefined, { sensitivity: 'accent' }) === 0).value;
    setNativeValue(siteSelect, linkSite);
    setNativeValue(inputField, url);
    if (addButton.disabled) {
      getTabButton(addButton).click();
      return alert('unable to add url (add button disabled)');
    }
    addButton.click();
    const result = /** @type {HTMLAnchorElement | null} */ (await elementReadyIn(`a[href="${url}"]`, 250, linksContainer));
    if (result) {
      const newLink = /** @type {HTMLDivElement} */ (result?.closest('.input-group'));
      flashField(newLink);
    }
  };

  /** @param {[name: string, parent: string | null]} [studio] */
  const studioArrayToString = (studio) => {
    if (!studio) return '';
    const [name, parent] = studio;
    return name + (parent ? ` [${parent}]` : '');
  };

  /**
   * @param {string} text
   * @returns {HTMLElement[]}
   */
  const strikethroughTextElements = (text) => {
    if (!text.includes('\u{0002}')) {
      const s = document.createElement('span');
      s.innerText = text;
      return [s];
    }

    /** @type {HTMLElement[]} */
    const out = [];
    let i = 0;

    while (i < text.length) {
      const del = text[i] === '\u{0002}';
      let start, end;
      if (del) {
        start = i + 1;
        end = text.indexOf('\u{0003}', i);
        i = end + 1;
      } else {
        start = i;
        end = text.indexOf('\u{0002}', i);
        if (end === -1)
          end = text.length;
        i = end;
      }

      const s = document.createElement(del ? 's' : 'span');
      s.innerText = text.slice(start, end);
      out.push(s);
    }

    return out;
  };

  const makeSep = () => {
    const sep = document.createElement('span');
    sep.classList.add('mx-2');
    sep.innerHTML = '&mdash;';
    return sep;
  };

  /**
   * @param {HTMLElement} element
   * @see https://www.javascripttutorial.net/dom/css/check-if-an-element-is-visible-in-the-viewport/
   */
  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  /**
   * @param {SceneEntriesItem[]} list
   * @param {HTMLOListElement} target
   * @param {AnyObject | null} object
   */
  const renderScenesList = (list, target, object) =>
    list.forEach(([sceneId, sceneData], idx) => {
      if (idx > 0 && idx % 10 === 0)
        target.appendChild(document.createElement('br'));

      const row = document.createElement('li');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.classList.add('me-1');

      const viewURL = `/scenes/${sceneId}`;
      const view = makeLink(viewURL, '⭕');
      view.classList.add('me-1', 'text-decoration-none');
      view.title = 'View scene';

      const editURL = `${viewURL}/edit`;
      const link = makeLink(editURL, sceneId);
      link.classList.add('font-monospace', 'text-decoration-underline');
      link.title = 'Edit scene';
      const editClick = () => check.checked = true;
      link.addEventListener('click', editClick);
      link.addEventListener('auxclick', editClick);

      if (!object && isSubmitted('scenes', sceneId)) {
        link.style.color = 'var(--bs-cyan)';
        link.title += ' (This entry may have already been submitted, please double-check before submitting an edit)';
      }

      const keys = dataObjectKeys(sceneData)
        .map((k) => k === 'performers' ? `${Object.values(sceneData.performers).flat().length}x ${k}` : k)
        .join(', ');

      row.append(check, view, link, makeSep(), keys);

      if (object !== 'studios' && sceneData.c_studio) {
        const studio = document.createElement('span');
        studio.innerText = studioArrayToString(sceneData.c_studio);
        row.append(makeSep(), studio);
      }

      target.appendChild(row);
    });

  /** @param {string} url */
  const getSiteName = (url) => {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    let siteName = hostname.match(/(.+)(?=\..+$)/)?.[1] ?? hostname;
    if (siteName === 'stashdb') {
      const obj = parsed.pathname.match(/^\/([a-z]+)\/.+/)?.[1]?.slice(0, -1);
      if (obj)
        siteName += ` ${obj}`;
    }
    if (hostname === 'cdn.stashdb.org') {
      if (siteName !== 'stashdb')
        siteName = 'stashdb';
      siteName += parsed.pathname.startsWith('/images/') ? ' image' : ' cdn';
    }
    if (hostname === 'web.archive.org') {
      const archived = parsed.pathname.match(/\/(http:.+$)/)?.[1];
      if (archived) {
        const actual = new URL(archived);
        siteName = `${actual.hostname.split(/\./).slice(-2)[0]}`;
      } else {
        siteName = 'web archive';
      }
    }
    if (siteName === 'iafd') {
      const obj = parsed.pathname.match(/^\/([a-z]+)\.(rme\/|asp\?)/)?.[1];
      if (obj && obj !== 'person')
        siteName += ` ${obj}`;
    }
    if (siteName === 'indexxx') {
      const obj = parsed.pathname.match(/^\/([a-z]+)\//)?.[1];
      if (obj && obj !== 'm')
        siteName += ` ${obj}`;
    }
    if (siteName === 'data18') {
      const obj = parsed.pathname.match(/^\/([a-z]+?)s?\//)?.[1];
      if (obj && obj !== 'name')
        siteName += ` ${obj}`;
    }
    return siteName;
  };

  /** @type {(string | RegExp)[]} */
  const fragmentLinksToIgnore = [
    'https://www.iafd.com/title.rme/',
    'https://www.indexxx.com/set/',
    'https://www.data18.com/scenes/',
    'https://www.data18.com/movies/',
    'https://gayeroticvideoindex.com/video/',
    'https://www.freeones.com/forums/threads/performer-guide-netvideogirls-com.101884/',
    'https://stashdb.org/scenes/'
  ];

  /** @param {string} url */
  const validFragmentLink = (url) =>
    !fragmentLinksToIgnore.some((i) => i instanceof RegExp ? i.test(url) : url.startsWith(i))

  /**
   * @param {{ performerId?: string; urls: string[]; }} data
   * @returns {{
   *   performerFragments: PerformerEntriesItem[];
   *   fragmentIndexMap: FragmentIndexMap;
   *   possibleLinks: string[];
   * }}
   */
  const getPerformerFragments = ({ performerId, urls }) => {
    /** @type {FragmentIndexMap} */
    const fragmentIndexMap = {};

    /** @param {string} s */
    const reNoSchemeWWW = (s) => s.replace(/^https?:\/\/(www\.)?/, '');
    /**
     * @param {string[]} arr
     * @param {string} search
     * @returns {Boolean}
     */
    const arrayIncludesURL = (arr, search) => {
      const searchNoSchemeWWW = reNoSchemeWWW(search);
      return arr.some((v) => (
        0 === v.localeCompare(search, undefined, { sensitivity: 'base' })
        || 0 === reNoSchemeWWW(v).localeCompare(searchNoSchemeWWW, undefined, { sensitivity: 'base' })
      ));
    };

    /** @type {string[]} */
    const possibleLinks = [];

    const performerFullURL = `${window.location.origin}/performers/${performerId}`;
    const performerFragments = Object.entries(Cache.data.performers).filter(([id, { split }]) => {
      if ((performerId && id === performerId) || !split) return false;
      const { fragments } = split;
      const matchedFragments = fragments.filter(({ id: fragmentId, links }) => (
        // fragment id is currently viewed performer
        (performerId && fragmentId === performerId) ||
        !!links && (
          // any performer url listed in fragment links?
          urls.some((url) => arrayIncludesURL(links, url)) ||
          // current performer url listed in fragment links? (additional performers)
          links.some((link) => link.startsWith(performerFullURL))
        )
      ));

      matchedFragments.forEach((matchedFragment) => {
        if (matchedFragment.id && performerId && matchedFragment.id !== performerId) {
          const fragmentPerformerURL = `${window.location.origin}/performers/${matchedFragment.id}`;
          if (!arrayIncludesURL(possibleLinks, fragmentPerformerURL))
            possibleLinks.push(fragmentPerformerURL);
        }
        if (matchedFragment.links) {
          const newLinks = matchedFragment.links
            .filter((link) => (
              !arrayIncludesURL(urls, link) // is new link
              && link !== performerFullURL // is not a link to current performer
            ));
          newLinks.forEach((newLink) => {
            if (!arrayIncludesURL(possibleLinks, newLink))
              possibleLinks.push(newLink);
          });
        }
        // Store fragment index for matching later
        const fragmentIndex = fragments.indexOf(matchedFragment);
        if (!fragmentIndexMap[id])
          fragmentIndexMap[id] = [fragmentIndex];
        else if (!fragmentIndexMap[id].includes(fragmentIndex))
          fragmentIndexMap[id].push(fragmentIndex);
      })

      return matchedFragments.length > 0;
    });

    return {
      performerFragments,
      fragmentIndexMap,
      possibleLinks,
    };
  };

  /**
   * @param {PerformerEntriesItem[]} list
   * @param {HTMLOListElement} target
   * @param {'simple' | 'fragments' | 'fragment-search' | 'ready-fragments'} [custom]
   * @param {FragmentIndexMap | { [performerId: string]: string }} [customData]
   */
  const renderPerformersList = (list, target, custom, customData) =>
    list.forEach(([performerId, performerData], idx) => {
      if (idx > 0 && idx % 10 === 0)
        target.appendChild(document.createElement('br'));

      const row = document.createElement('li');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.classList.add('me-1');
      row.append(check);

      const viewURL = `/performers/${performerId}`;
      if (!custom) {
        const view = makeLink(viewURL, '⭕');
        view.classList.add('me-1', 'text-decoration-none');
        view.title = 'View performer';
        row.append(view);
      }

      const mainURL = !custom
        ? (!performerData.duplicates ? `${viewURL}/edit` : `${viewURL}/merge`)
        : viewURL;
      const name = [performerData.name, performerData.split?.name, performerData.duplicates?.name].find((n) => !!n);
      const link = makeLink(mainURL, name || performerId);
      if (!name)
        link.classList.add('font-monospace');
      link.classList.add('text-decoration-underline');
      link.title = mainURL === viewURL ? 'View performer' : 'Edit performer';
      const mainClick = () => check.checked = true;
      link.addEventListener('click', mainClick);
      link.addEventListener('auxclick', mainClick);

      if (isSubmitted('performers', performerId)) {
        link.style.color = 'var(--bs-cyan)';
        link.title += ' (This entry may have already been submitted, please double-check before submitting an edit)';
      }

      row.append(link);

      if (!custom || custom === 'simple') {
        const keys = dataObjectKeys(performerData)
          .map((k) => {
            switch (k) {
              case 'urls':
                return `${Object.values(performerData[k]).length}x ${k}`;
              case 'duplicates':
                return `${performerData[k].ids.length}x ${k}`;
              case 'split':
                const { fragments } = performerData[k];
                return fragments.length > 0 ? `${fragments.length}x fragments` : k;
              default:
                return k;
            }
          })
          .join(', ');

        row.append(makeSep(), keys);
      } else if ((custom === 'fragments' || custom === 'fragment-search') && customData?.[performerId] !== undefined) {
        const fragmentNumbers = customData[performerId];
        const label = Array.isArray(fragmentNumbers)
          ? fragmentNumbers.map((index) => `fragment #${index + 1}`).join(', ')
          : fragmentNumbers;
        row.append(makeSep(), label);

        if (Array.isArray(fragmentNumbers))
          link.dataset.state = JSON.stringify({ performerFragment: fragmentNumbers });

        if (custom === 'fragment-search' && Array.isArray(fragmentNumbers)) {
          const { fragments } = performerData.split;

          const fragmentDetails = document.createElement('div');
          fragmentDetails.style.marginLeft = '1.2rem';

          row.append(makeSep());
          fragmentNumbers.forEach((fragmentIndex, i) => {
            if (i > 0) row.append(' / ');
            const { id, name, ...fragment } = fragments[fragmentIndex];
            let fragmentName;
            if (id) {
              fragmentName = makeLink(`/performers/${id}`, name, { color: 'var(--bs-teal)' });
              fragmentName.target = '_blank';
            } else {
              fragmentName = document.createElement('span');
              fragmentName.innerText = name;
            }
            row.append(fragmentName);

            if (fragment.text || fragment.notes) {
              const shortFragment = ((fragment.text?.match(/\n/g)?.length || 1) + (fragment.notes?.length || 0)) <= 6;
              const notes = [].concat([fragment.text], fragment.notes).filter(Boolean);
              /** @type {HTMLSpanElement | HTMLDetailsElement} */
              let text;
              if (shortFragment) {
                text = document.createElement('div');
              } else {
                text = document.createElement('details');
                const summary = document.createElement('summary');
                summary.style.maxWidth = 'fit-content';
                summary.innerText = `fragment #${fragmentIndex + 1}`;
                text.append(summary);
              }
              text.style.whiteSpace = 'pre-wrap';
              text.append(...strikethroughTextElements(notes.join('\n')));
              fragmentDetails.append(text);
            }
          });

          row.append(fragmentDetails);
        }
      } else if (custom === 'ready-fragments' && customData?.[performerId] !== undefined) {
        const fragmentNumbers = customData[performerId];
        const label = Array.isArray(fragmentNumbers)
          ? fragmentNumbers.length === 0
              ? 'no fragments'
              : 'fragments ' + fragmentNumbers.map((index) => `#${index + 1}`).join(', ')
          : fragmentNumbers;
        const flag = document.createTextNode('');
        row.append(makeSep(), flag, label);

        if (Array.isArray(fragmentNumbers)) {
          link.dataset.state = JSON.stringify({ performerFragment: fragmentNumbers });

          const { fragments } = performerData.split;

          // reminder: all entries reaching this point have been filtered through the 'complete list' note sieve.
          // is 'complete list', and also:
          if (fragments.length === 0)
            flag.textContent = '🟢 ';
          else if (fragments.length === 1)
            flag.textContent = '⭐ ';
          else if (fragmentNumbers.length === fragments.length && fragments.every(({ id }) => !!id))
            flag.textContent = '🔶 ';

          fragmentNumbers.forEach((fragmentIndex, i) => {
            const { id, name, ...fragment } = fragments[fragmentIndex];
            let fragmentName;
            if (id) {
              fragmentName = makeLink(`/performers/${id}`, name, { color: 'var(--bs-teal)' });
              fragmentName.target = '_blank';
            } else {
              fragmentName = document.createElement('span');
              fragmentName.innerText = name;
            }

            const fragmentLength = ((fragment.text?.match(/\n/g)?.length || 1) + (fragment.notes?.length || 0));
            const fragmentDetails = document.createElement('details');
            fragmentDetails.open = fragmentLength <= 6;
            fragmentDetails.classList.add('backlog-fragment');
            const fragmentNumber =  document.createElement('span');
            fragmentNumber.innerText = `fragment #${fragmentIndex + 1}`;
            const fragmentSummary = document.createElement('summary');
            fragmentSummary.style.maxWidth = 'fit-content';
            fragmentSummary.append(fragmentNumber, makeSep(), fragmentName);
            fragmentDetails.append(fragmentSummary);
            row.append(fragmentDetails);

            if (fragment.text || fragment.notes) {
              const notes = [].concat([fragment.text], fragment.notes).filter(Boolean);
              const text = document.createElement('div');
              text.classList.add('d-inline-block');
              Object.assign(text.style, { marginLeft: '1.2rem', whiteSpace: 'pre-wrap' });
              text.append(...strikethroughTextElements(notes.join('\n')));
              fragmentDetails.append(text);
            }
          });
        }
      }

      target.appendChild(row);
    });

  /**
   * @template T
   * @param {T} obj
   * @param {string[]} keySortOrder
   * @returns {Array<keyof T>}
   */
  const sortedKeys = (obj, keySortOrder) =>
    /** @type {Array<keyof T>} */ (/** @type {unknown} */ (Object.keys(obj)
      .sort((aKey, bKey) => {
        const aPos = keySortOrder.indexOf(aKey);
        const bPos = keySortOrder.indexOf(bKey);
        if (bPos === -1) return -1;
        else if (aPos === -1) return 1;
        else if (aPos < bPos) return -1;
        else if (aPos > bPos) return 1;
        else return 0;
      })));

  // SVG is rendered huge if FontAwesome was tree-shaken in compilation?
  const svgStyleFix = {
    overflow: 'visible', // svg:not(:root).svg-inline--fa || .svg-inline--fa
    width: '1.125em', // .svg-inline--fa.fa-w-18
    display: 'inline-block', // .svg-inline--fa
    fontSize: 'inherit', // .svg-inline--fa
    height: '1em', // .svg-inline--fa
    verticalAlign: '-0.125em', // .svg-inline--fa
  };

  /**
   * @param {boolean} fixStyle
   * @returns {SVGSVGElement}
   */
  const genderIcon = (fixStyle) => {
    const div = document.createElement('div');
    div.innerHTML = (
      '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="venus-mars" role="img"'
      + ' class="svg-inline--fa fa-venus-mars fa-w-18 " xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">'
        + '<path fill="currentColor" d="M564 0h-79c-10.7 0-16 12.9-8.5 20.5l16.9 16.9-48.7 48.7C422.5 72.1'
        + ' 396.2 64 368 64c-33.7 0-64.6 11.6-89.2 30.9 14 16.7 25 36 32.1 57.1 14.5-14.8 34.7-24 57.1-24'
        + ' 44.1 0 80 35.9 80 80s-35.9 80-80 80c-22.3 0-42.6-9.2-57.1-24-7.1 21.1-18 40.4-32.1 57.1 24.5'
        + ' 19.4 55.5 30.9 89.2 30.9 79.5 0 144-64.5 144-144 0-28.2-8.1-54.5-22.1-76.7l48.7-48.7 16.9 16.9c2.4'
        + ' 2.4 5.4 3.5 8.4 3.5 6.2 0 12.1-4.8 12.1-12V12c0-6.6-5.4-12-12-12zM144 64C64.5 64 0 128.5 0 208c0'
        + ' 68.5 47.9 125.9 112 140.4V400H76c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h36v36c0 6.6 5.4 12 12'
        + ' 12h40c6.6 0 12-5.4 12-12v-36h36c6.6 0 12-5.4 12-12v-40c0-6.6-5.4-12-12-12h-36v-51.6c64.1-14.6'
        + ' 112-71.9 112-140.4 0-79.5-64.5-144-144-144zm0 224c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80'
        + ' 80-35.9 80-80 80z"></path>'
      + '</svg>'
    );
    const svg = div.getElementsByTagName('svg')[0];
    if (fixStyle) setStyles(svg, svgStyleFix);
    return svg;
  };

  /** @returns {{ div: HTMLDivElement, svg: SVGSVGElement }} */
  const performersIcon = () => {
    const div = document.createElement('div');
    div.innerHTML = (
      '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="users" role="img"'
      + ' class="svg-inline--fa fa-users fa-w-20 fa-icon " xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512">'
        + '<path fill="currentColor" d="M96 224c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm448'
        + ' 0c35.3 0 64-28.7 64-64s-28.7-64-64-64-64 28.7-64 64 28.7 64 64 64zm32 32h-64c-17.6 0-33.5 7.1-45.1 18.6'
        + ' 40.3 22.1 68.9 62 75.1 109.4h66c17.7 0 32-14.3 32-32v-32c0-35.3-28.7-64-64-64zm-256 0c61.9 0 112-50.1'
        + ' 112-112S381.9 32 320 32 208 82.1 208 144s50.1 112 112 112zm76.8 32h-8.3c-20.8 10-43.9 16-68.5 16s-47.6-6'
        + '-68.5-16h-8.3C179.6 288 128 339.6 128 403.2V432c0 26.5 21.5 48 48 48h288c26.5 0 48-21.5 48-48v-28.8c0-63.6'
        + '-51.6-115.2-115.2-115.2zm-223.7-13.4C161.5 263.1 145.6 256 128 256H64c-35.3 0-64 28.7-64 64v32c0 17.7 14.3'
        + ' 32 32 32h65.9c6.3-47.4 34.9-87.3 75.2-109.4z"></path>'
      + '</svg>'
    );
    const svg = div.getElementsByTagName('svg')[0];
    return { div, svg };
  };

  /**
   * @param {HTMLElement} el
   * @param {AnyObject} object
   * @param {string} uuid
   * @see https://stackoverflow.com/a/48890844
   */
  const removeHook = (el, object, uuid) => {
    const hook = () => {
      const loc = parsePath();
      if (loc.object === object && loc.ident === uuid && !loc.action) return;
      el.remove();
      window.removeEventListener(locationChanged, hook);
    };
    // Hook to remove it
    window.addEventListener(locationChanged, hook);
  };

  /**
   * @param {string} sceneId
   */
  async function iScenePage(sceneId) {
    const sceneInfo = /** @type {HTMLDivElement} */ (await elementReadyIn('.scene-info', 2000));
    if (!sceneInfo) {
      console.error('[backlog] scene info not found');
      return;
    }

    const markerDataset = sceneInfo.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected');
    }

    const _sceneFiberEl = getReactFiber(sceneInfo)?.return?.return;
    const _sceneFiberCur = _sceneFiberEl?.memoizedProps?.scene;
    const _sceneFiberAlt = _sceneFiberEl?.alternate?.memoizedProps?.scene;

    /** @type {ScenePerformance} */
    const sceneFiber = _sceneFiberAlt?.id && _sceneFiberAlt.id !== _sceneFiberCur?.id ? _sceneFiberAlt : _sceneFiberCur;

    (function parentStudio() {
      if (!sceneFiber.studio.parent?.name) return;
      const studioElement = /** @type {HTMLAnchorElement} */ (sceneInfo.querySelector(':scope > .card-header > h6 > a'));
      if (studioElement.parentElement.querySelector('.backlog-scene-studio-parent')) return;
      const parentStudio = document.createElement('small');
      parentStudio.classList.add('backlog-scene-studio-parent', 'fst-italic');
      const parentStudioLink = makeLink(`/studios/${sceneFiber.studio.parent.id}`, sceneFiber.studio.parent.name, { color: 'var(--bs-yellow)' });
      parentStudio.append(' of ', parentStudioLink, '');
      parentStudio.title = 'added by the StashDB Backlog userscript';
      studioElement.after(parentStudio);
      removeHook(parentStudio, 'scenes', sceneId);
    })();

    const found = getDataFor('scenes', sceneId);
    if (!found) return;
    console.debug('[backlog] found', found);

    const sceneHeader = /** @type {HTMLDivElement} */ (sceneInfo.querySelector(':scope > .card-header'));
    sceneHeader.style.borderTop = '1rem solid var(--bs-warning)';
    sceneHeader.title = 'pending changes (backlog)';

    const sceneFooter = /** @type {HTMLDivElement} */ (sceneInfo.querySelector(':scope > .card-footer'));
    if (found.performers || found.duration || found.director) {
      for (const el of sceneFooter.querySelectorAll(':scope > *')) {
        el.classList.add('my-auto');
      }
    }

    /** @type {HTMLDivElement} */
    const sceneDescTab = (document.querySelector('div#scene-tabs-tabpane-description'));

    const makeAlreadyCorrectTitle = (/** @type {string} */ status='correct', /** @type {string} */ field='') =>
      `<already ${status}>${field ? ` ${field}`: ''}\nshould mark the entry on the backlog sheet as completed`;

    (function comments() {
      if (!(found.comments && found.comments.length > 0)) return;
      if (markerDataset.backlogInjected) return;

      const comments = document.createElement('div');
      setStyles(comments, { padding: '0 .25rem', backgroundColor: '#17a2b8' /* Bootstrap4 info color */ });

      found.comments.forEach((comment, index) => {
        if (index > 0) comments.append(document.createElement('br'));
        const commentElement = /^https?:/.test(comment) ? makeLink(comment) : document.createElement('span');
        commentElement.innerText = comment;
        comments.appendChild(commentElement);
      });

      sceneHeader.appendChild(comments);
    })();

    /** @type {HTMLDivElement} */
    let backlogDiv = (document.querySelector('.scene-backlog'));
    if (!backlogDiv) {
      backlogDiv = document.createElement('div');
      backlogDiv.classList.add('scene-backlog');
      setStyles(backlogDiv, {
        maxWidth: 'max-content',
        minWidth: 'calc(50% - 15px)',
        transition: 'background-color .5s',
      });
      sceneInfo.before(backlogDiv);
      removeHook(backlogDiv, 'scenes', sceneId);

      /** @type {HTMLDivElement} */
      const actionsContainer = (sceneHeader.querySelector(':scope > .float-end'));
      if (actionsContainer) {
        actionsContainer.addEventListener('mouseover', () => {
          backlogDiv.style.backgroundColor = '#8c2020';
        });
        actionsContainer.addEventListener('mouseout', () => {
          backlogDiv.style.backgroundColor = '';
        });
      }
    }

    (function duplicates() {
      if (!found.duplicates) return;
      if (backlogDiv.querySelector('[data-backlog="duplicates"]')) return;

      const hasDuplicates = document.createElement('div');
      hasDuplicates.dataset.backlog = 'duplicates';
      hasDuplicates.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This scene has duplicates:';
      hasDuplicates.appendChild(label);

      found.duplicates.forEach((dupId) => {
        hasDuplicates.append(document.createElement('br'));
        const a = makeLink(`/scenes/${dupId}`, dupId, { color: 'var(--bs-teal)', marginLeft: '1.75rem' });
        a.target = '_blank';
        a.classList.add('fw-normal');
        hasDuplicates.append(a);
      });
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      hasDuplicates.prepend(emoji);
      backlogDiv.append(hasDuplicates);
    })();

    (function duplicateOf() {
      if (!found.duplicate_of) return;
      if (backlogDiv.querySelector('[data-backlog="duplicate-of"]')) return;

      const duplicateOf = document.createElement('div');
      duplicateOf.dataset.backlog = 'duplicate-of';
      duplicateOf.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This scene is a duplicate of: ';
      duplicateOf.appendChild(label);

      const a = makeLink(`/scenes/${found.duplicate_of}`, found.duplicate_of, { color: 'var(--bs-teal)' });
      a.target = '_blank';
      a.classList.add('fw-normal');
      duplicateOf.append(a);
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      duplicateOf.prepend(emoji);
      backlogDiv.append(duplicateOf);
    })();

    (function title() {
      if (!found.title) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLHeadingElement} */
      const title = (document.querySelector('.scene-info h3'));
      const currentTitle = title.innerText;
      if (!currentTitle) {
        const titleSpan = document.createElement('span');
        titleSpan.classList.add('bg-success', 'p-1');
        titleSpan.innerText = found.title;
        titleSpan.title = '<MISSING> Title';
        title.prepend(titleSpan);

        const status = document.createElement('span');
        status.classList.add('me-2', 'bg-success', 'p-1');
        status.style.fontSize = '1.25rem';
        status.innerText = '<MISSING> \u{22D9}';
        title.prepend(status);
      } else if (currentTitle === found.title) {
        const titleSpan = title.querySelector('span');
        titleSpan.classList.add('bg-warning', 'p-1');
        titleSpan.title = makeAlreadyCorrectTitle('correct', 'Title');

        const status = document.createElement('span');
        status.classList.add('me-2', 'bg-warning', 'p-1');
        status.style.fontSize = '1.25rem';
        status.innerText = '<already correct> \u{22D9}';
        title.prepend(status);
      } else {
        title.title = `<pending> Title`;
        title.style.fontSize = '1.25rem';
        const titleSpan = title.querySelector('span');
        titleSpan.classList.add('bg-danger', 'p-1');
        titleSpan.style.fontSize = '1rem';

        const arrow = document.createElement('span');
        arrow.classList.add('mx-2');
        arrow.innerText = '\u{22D9}';
        titleSpan.after(arrow);

        const newTitle = document.createElement('span');
        newTitle.classList.add('bg-primary', 'p-1');
        newTitle.innerText = found.title;
        title.append(newTitle);
      }
    })();

    (function studio() {
      if (!found.studio) return;
      if (markerDataset.backlogInjected) return;

      const studio_date = /** @type {HTMLHeadingElement} */ (sceneHeader.querySelector(':scope > h6'));
      const studioElement = studio_date.querySelector('a');

      const [studioId, studioName] = found.studio;
      const alreadyCorrectStudioId = studioId && studioId === parsePath(studioElement.href).ident;

      const newStudio = document.createElement('span');
      let title, colorClass, currentColorClass;
      if (!alreadyCorrectStudioId) {
        currentColorClass = 'bg-danger';
        if (studioId) {
          colorClass = 'bg-primary';
          title = `<pending> Studio\n${studioName ? `${studioName} (${studioId})` : studioId}`;
          newStudio.append(makeLink(`/studios/${studioId}`, studioName ? studioName : `[${studioId}]`), ' \u{22D8}');
        } else {
          colorClass = 'bg-success';
          title = `<pending> Studio (new / unknown ID)\n${studioName || '?'}`;
          newStudio.append(studioName, ' \u{22D8}');
        }
      } else {
        colorClass = 'bg-warning';
        currentColorClass = 'bg-warning';
        title = makeAlreadyCorrectTitle('correct', 'Studio');
        newStudio.innerText = '<already correct> \u{22D9}';
      }

      newStudio.classList.add(colorClass, 'p-1');
      newStudio.title = title;
      studioElement.title = title;
      studioElement.classList.add(currentColorClass, 'p-1');
      studioElement.before(newStudio);
    })();

    (function date() {
      if (!found.date) return;
      if (markerDataset.backlogInjected) return;

      const studio_date = /** @type {HTMLHeadingElement} */ (sceneHeader.querySelector(':scope > h6'));
      const dateNode = Array.from(studio_date.childNodes).slice(-1)[0];
      const separator = studio_date.querySelector('span.mx-1');

      const alreadyCorrectDate = found.date === dateNode.nodeValue;

      // convert date text node to element
      const dateElement = document.createElement('span');
      dateElement.append(dateNode);
      separator.after(dateElement);

      const newDate = document.createElement('span');
      let title, colorClass, currentColorClass;
      if (!alreadyCorrectDate) {
        colorClass = 'bg-primary';
        currentColorClass = 'bg-danger';
        title = `<pending> Date\n${found.date}`;
        newDate.innerText = `\u{22D9} ${found.date}`;
      } else {
        colorClass = 'bg-warning';
        currentColorClass = 'bg-warning';
        title = makeAlreadyCorrectTitle('correct', 'Date');
        newDate.innerText = '\u{22D8} <already correct>';
      }

      newDate.classList.add(colorClass, 'p-1');
      newDate.title = title;
      dateElement.title = title;
      dateElement.classList.add(currentColorClass, 'p-1');
      dateElement.after(newDate);
    })();

    (function image() {
      if (!found.image) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLDivElement} */
      const scenePhoto = document.querySelector('.ScenePhoto');
      const img = scenePhoto.querySelector('img');

      const newImageBlob = getImageBlob(found.image);

      if (img) {
        setStatus(`[backlog] fetching/comparing images...`);

        const onCurrentImageReady = async () => {
          const fullImage = sceneFiber?.images?.find((i) => i.url === img.src);
          const [isResized, fullImageURL] = (() => {
            if (!fullImage) return [false, undefined];
            const { id } = fullImage;
            const imgURL = new URL(img.src);
            const url = [imgURL.origin, 'images', id.slice(0, 2), id.slice(2, 4), id].join('/');
            // image id different from id in url = resized image
            const resized = fullImage.id !== imgURL.pathname.split(/\//g).pop();
            return [resized, url];
          })();

          const imageBlob = getImageBlob(isResized ? fullImageURL : img.src);
          const newImage = await compareImages(imageBlob, newImageBlob);
          scenePhoto.classList.add('p-2');

          if (newImage === true) {
            scenePhoto.style.backgroundColor = 'var(--bs-warning)';
            scenePhoto.title = `${makeAlreadyCorrectTitle('added')}\n\n${found.image}`;
            setStatus('');
            return;
          }

          scenePhoto.classList.add('flex-row');
          scenePhoto.title = `<pending>\n${found.image}`;

          const imgNewLink = makeLink(found.image, '');

          if (newImage instanceof Error) {
            scenePhoto.style.backgroundColor = 'var(--bs-purple)';
            scenePhoto.title = 'error comparing image';
            console.error('[backlog] error comparing image', newImage);
            imgNewLink.innerText = found.image;
            imgNewLink.classList.add('p-1');
            imgNewLink.style.flex = '50%';

            scenePhoto.appendChild(imgNewLink);
            setStatus(`[backlog] error fetching/comparing images:\n${newImage}`);
            return;
          }

          const imgContainer = document.createElement('div');
          imgContainer.classList.add('position-relative');
          setStyles(imgContainer, { alignSelf: 'center', flex: '50%' });
          setStyles(img, { border: '.5rem solid var(--bs-danger)' });
          const cImgRes = makeImageResolution(img, 'start', 'top', fullImage);
          imgContainer.append(img.parentElement, cImgRes);

          scenePhoto.appendChild(imgContainer);

          const imgNew = document.createElement('img');
          imgNew.src = URL.createObjectURL(await newImageBlob);
          setStyles(imgNew, { width: '100%', height: 'auto', border: '.5rem solid var(--bs-success)' });

          imgNewLink.appendChild(imgNew);

          const newImgContainer = document.createElement('div');
          newImgContainer.classList.add('position-relative');
          const isCurrentVertical =
            fullImage
              ? fullImage.height > fullImage.width
              : img.naturalHeight > img.naturalWidth;
          setStyles(newImgContainer, { alignSelf: 'center', flex: isCurrentVertical ? 'auto' : '50%' });
          const imgRes = makeImageResolution(imgNew, 'end', 'top');
          newImgContainer.append(imgRes, imgNewLink);

          scenePhoto.appendChild(newImgContainer);
          setStatus('');
        };

        /** @param {any} reason */
        const onCurrentImageFailed = async (reason) => {
          scenePhoto.style.backgroundColor = 'var(--bs-purple)';

          scenePhoto.classList.add('p-2', 'd-flex');
          scenePhoto.title = `error loading current image\n<pending>\n${found.image}`;

          const imgNewLink = makeLink(found.image, '');

          const imgNew = document.createElement('img');
          imgNew.src = URL.createObjectURL(await newImageBlob);
          setStyles(imgNew, { width: '100%', height: 'auto' });

          imgNewLink.appendChild(imgNew);

          const newImageContainer = document.createElement('div');
          newImageContainer.style.flex = 'auto';
          const imgRes = makeImageResolution(imgNew, 'end');
          newImageContainer.append(imgRes, imgNewLink);

          scenePhoto.appendChild(newImageContainer);

          setStatus(`[backlog] error loading current image:\n${reason}`);
        };

        imageReady(img).then(
          onCurrentImageReady,
          onCurrentImageFailed,
        );

      } else {
        // missing image
        setStatus(`[backlog] fetching new image...`);

        scenePhoto.classList.add('bg-danger', 'p-2');
        scenePhoto.style.transition = 'min-height 1s ease';
        scenePhoto.title = `<MISSING>\n${found.image}`;

        const imgContainer = /** @type {HTMLDivElement} */ (scenePhoto.querySelector('.Image'));

        const imgLink = makeLink(found.image, '');
        imgLink.classList.add('Image-image');
        imgContainer.appendChild(imgLink);

        const img = document.createElement('img');
        img.classList.add('Image-image');
        imgLink.appendChild(img);

        /** @param {any} reason */
        const onFailure = (reason) => {
          setStyles(scenePhoto, { minHeight: '150px', textAlign: 'center', fontSize: '1.2em', fontWeight: '600' });
          imgLink.prepend(found.image);
          img.remove();
          scenePhoto.append(imgLink);
          setStatus(`[backlog] error fetching new image:\n${reason}`);
        };
        newImageBlob.then(
          (blob) => {
            imgContainer.querySelector('.Image-missing').classList.add('d-none');
            const imgRes = makeImageResolution(img, 'end', null);
            imgContainer.after(imgRes);
            img.src = URL.createObjectURL(blob);
            setStatus('');
          },
          onFailure
        );
      }
    })();

    (function performers() {
      if (!found.performers) return;
      if (markerDataset.backlogInjected) return;

      const remove = Array.from(found.performers.remove); // shallow clone
      const append = Array.from(found.performers.append); // shallow clone
      const update = Array.from(found.performers.update || []); // shallow clone

      const removeFrom = (/** @type {PerformerEntry} */ entry, /** @type {PerformerEntry[]} */ from) => {
        const index = from.indexOf(entry);
        if (index === -1) console.error('[backlog] entry not found', entry, 'in', from);
        from.splice(index, 1);
      };

      const parsePerformerAppearance = (/** @type {HTMLAnchorElement} */ pa) => {
        const { ident: uuid } = parsePath(pa.href);
        const nameElements = /** @type {HTMLElement[]} */ (Array.from(pa.children).slice(1));
        const nameParts = [nameElements.shift().textContent];
        const mainNameOrDsmbgEl = nameElements.shift();
        if (mainNameOrDsmbgEl) {
          if (!mainNameOrDsmbgEl.firstElementChild)
            nameParts.push(mainNameOrDsmbgEl.textContent);
          else {
            const nodes = Array.from(mainNameOrDsmbgEl.childNodes);
            const dsmbg = /** @type {HTMLElement} */ (nodes.pop());
            nameParts.push(nodes.map(n => n.textContent).join(''));
            nameParts.push(dsmbg.textContent);
          }
        }
        let status;
        const statusMatch = nameParts[0].match(/^\[([a-z]+?)\] .+$/i);
        if (statusMatch) {
          status = statusMatch[1];
          nameParts[0] = nameParts[0].slice(status.length + 3);
        }
        const fullName = nameParts.join(' ');
        return { uuid, fullName, first: nameParts[0], status };
      };

      const formatName = (/** @type {PerformerEntry} */ entry) => {
        const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
        if (!entry.appearance) return entry.name + disambiguation;
        return entry.appearance + ` (${entry.name})` + disambiguation;
      };

      const paStatus = (/** @type {string} */ status) => {
        const statusEl = document.createElement('sup');
        statusEl.innerText = `[${status}]`;
        const statusSep = document.createElement('span');
        statusSep.innerText = ' ';
        return [statusEl, statusSep];
      };

      const nameElements = (/** @type {PerformerEntry} */ entry) => {
        const c = (/** @type {string} */ text, small=false) => {
          const el = document.createElement(small ? 'small' : 'span');
          if (small) el.classList.add('ms-1', 'text-small', 'text-muted');
          el.innerText = small ? `(${text})` : text;
          return el;
        };

        const { status, appearance, name, disambiguation } = entry;
        const namePart = c(name, !!appearance);
        const parts = /** @type {Array<HTMLElement | string>} */ ([]);
        if (status) parts.push(...paStatus(entry.status));
        if (appearance) parts.push(c(appearance));
        parts.push(namePart);
        if (disambiguation) {
          const dsmbg = c(disambiguation, true);
          if (appearance) namePart.appendChild(dsmbg);
          else parts.push(dsmbg);
        }
        return parts;
      }

      const makePerformerAppearance = (/** @type {PerformerEntry} */ entry) => {
        const pa = document.createElement('a');
        pa.classList.add('scene-performer');
        if (entry.id) {
          pa.href = `/performers/${entry.id}`;
          routerLink(pa);
        }

        pa.append(genderIcon(existingPerformers.length === 0), ...nameElements(entry));
        return pa;
      };

      const highlight = (/** @type {HTMLElement} */ el, /** @type {string} */ color) => {
        color = color.startsWith('--') ? `var(${color})` : color;
        setStyles(el, { border: `6px solid ${color}`, borderRadius: '6px', padding: '.1rem .25rem' });
        el.classList.add('d-inline-block');
      };

      const scenePerformers = sceneFooter.querySelector('.scene-performers');
      /** @type {HTMLAnchorElement[]} */
      const existingPerformers = Array.from(scenePerformers.querySelectorAll(':scope > a.scene-performer'));

      existingPerformers.forEach((performer) => {
        const { uuid, fullName } = parsePerformerAppearance(performer);
        const toRemove = remove.find((e) => e.id ? e.id === uuid : formatName(e) === fullName);
        const toAppend = append.find((e) => e.id ? e.id === uuid : formatName(e) === fullName);
        const toUpdate = update.find((e) => e.id === uuid);

        if (toRemove) {
          highlight(performer, '--bs-danger');
          performer.classList.add('backlog-remove'); // Useful for new performers below
          if (toRemove.status) {
            performer.children[1].prepend(...paStatus(toRemove.status));
            performer.title = `<pending>\n${toRemove.status}`;
            setStyles(performer, { color: 'violet', fontStyle: 'italic' });
            if (toRemove.status == 'edit') {
              performer.title += (
                ' (performer needs to edited to become \n'
                + 'one of the performers that need to be created)'
              );
            } else if (toRemove.status == 'merge') {
              performer.title += (
                ' (performer needs to be merged into \n'
                + 'one of the performers that need to be added to the scene)'
              );
            }
          } else {
            /** @type {NodeListOf<HTMLElement>} */
            (performer.querySelectorAll('span, small')).forEach((el) => el.classList.add('text-decoration-line-through'));
            performer.title = `<pending>\nremoval`;
          }
          if (!toRemove.id) {
            performer.title += '\n[missing ID - matched by name]';
            performer.classList.add('bg-danger');
          }
          (performer.querySelector('sup') /* status */ || performer.querySelector('svg') /* icon */)
            .after(...makeNoteElements(toRemove));
          removeFrom(toRemove, remove);
        }

        if (toAppend) {
          const entryFullName = formatName(toAppend);
          if (fullName === entryFullName) {
            highlight(performer, '--bs-warning');
            performer.title = makeAlreadyCorrectTitle('added');
            if (!toAppend.id) {
              performer.title += '\n[missing ID - matched by name]';
              performer.style.color = 'var(--bs-yellow)';
            }
          } else {
            highlight(performer, '--bs-primary');
            performer.title = `<already added>\nbut needs an update to\n${entryFullName}`;
          }
          removeFrom(toAppend, append);
        }

        if (toUpdate) {
          const entryFullName = formatName(toUpdate);
          if (fullName === entryFullName) {
            highlight(performer, '--bs-warning');
            performer.title = makeAlreadyCorrectTitle('updated');
          } else {
            const arrow = document.createElement('span');
            arrow.classList.add('mx-1');
            arrow.innerText = '\u{22D9}';
            performer.appendChild(arrow);
            performer.append(...nameElements(toUpdate));
            highlight(performer, '--bs-primary');
            performer.title = `<pending>\nupdate to\n${entryFullName}`;
          }
          removeFrom(toUpdate, update);
        }
      });

      append.forEach((entry) => {
        const pa = makePerformerAppearance(entry);
        let hColor = '--bs-success';
        pa.title = `<pending>\naddition`;
        if (!entry.id) {
          if (entry.status === 'new') {
            pa.title += ' (performer needs to be created)';
            hColor = 'turquoise';
          } else if (entry.status == 'c') {
            pa.title += ' (performer created, pending approval)';
            hColor = 'turquoise';
          } else {
            pa.title += ' (missing performer ID)';
          }
          if (entry.status_url) {
            makeLink(entry.status_url, null, null, pa);
          }
        }
        if (entry.notes) {
          (pa.querySelector('sup') /* status */ || pa.querySelector('svg') /* icon */)
            .after(...makeNoteElements(entry));
        }
        highlight(pa, hColor);

        // Attempt to insert new performer next to performer-to-remove with the same name
        const pendingRemoval = existingPerformers
          .reduce((pending, el) => {
            if (el.classList.contains('backlog-remove')) {
              const { first, status } = parsePerformerAppearance(el);
              pending.push({ first, status, pa: el });
            }
            return pending;
          }, /** @type {{ first: string, status?: string, pa: HTMLAnchorElement }[]} */ ([]));
        const matchedToRemove = (
          pendingRemoval.find(({ first }) => [entry.appearance, entry.name].includes(first))
          || pendingRemoval.find(({ first }) => entry.name.split(/\b/)[0] == first.split(/\b/)[0])
        );
        if (matchedToRemove) {
          if (matchedToRemove.status)
            pa.style.color = 'violet';
          matchedToRemove.pa.after(pa);
        } else {
          scenePerformers.appendChild(pa);
        }
      });

      remove.forEach((entry) => {
        console.warn('[backlog] entry to remove not found. already removed?', entry);
        const pa = makePerformerAppearance(entry);
        highlight(pa, '--bs-warning');
        pa.style.color = 'var(--bs-yellow)';
        pa.title = `performer-to-remove not found. already removed?`;
        scenePerformers.appendChild(pa);
      });

      update.forEach((entry) => {
        console.warn('[backlog] entry to update not found.', entry);
        const expectedEntry = { ...entry, appearance: entry.old_appearance };
        const pa = makePerformerAppearance(expectedEntry);
        highlight(pa, '--bs-warning');
        pa.style.color = 'var(--bs-yellow)';
        pa.title = `performer-to-update is missing: ${formatName(expectedEntry)}.`;
        const arrow = document.createElement('span');
        arrow.classList.add('mx-1');
        arrow.innerText = '\u{22D9}';
        pa.append(arrow, ...nameElements(entry));
        scenePerformers.appendChild(pa);
      });
    })();

    (function duration() {
      if (!found.duration) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLDivElement | null} */
      let duration = (sceneFooter.querySelector(':scope > div[title $= " seconds"]'));
      const foundDuration = Number(found.duration);
      const formattedDuration = formatDuration(foundDuration);
      if (!duration) {
        const newDuration = document.createElement('b');
        newDuration.innerText = formattedDuration;
        duration = document.createElement('div');
        duration.append('<MISSING>', ' Duration: ', newDuration);
        duration.classList.add('bg-success', 'p-1', 'my-auto');
        duration.title = `Duration is missing; ${foundDuration} seconds`;
        sceneFooter.querySelector('.scene-performers').after(duration);
      } else {
        const currentDuration = duration.title.match(/(\d+)/)[1];
        if (found.duration === currentDuration) {
          duration.classList.add('bg-warning', 'p-1');
          duration.prepend('<already correct> ');
          duration.title = `${makeAlreadyCorrectTitle('correct')}; ${foundDuration} seconds`;
        } else {
          duration.classList.add('bg-primary', 'p-1');
          duration.append(` \u{22D9} ${formattedDuration}`);
          duration.title = `<pending> Duration: ${formattedDuration}; ${foundDuration} seconds`;
        }
      }
    })();

    (function director() {
      if (!found.director) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLDivElement | null} */
      let director = (sceneFooter.querySelector(':scope > div:last-of-type'));
      if (!director || !/^Director:/.test(director.innerText)) {
        const newDirector = document.createElement('b');
        newDirector.innerText = found.director;
        director = document.createElement('div');
        director.append('<MISSING>', ' Director: ', newDirector);
        director.title = '<MISSING> Director';
        director.classList.add('ms-3', 'bg-success', 'p-1', 'my-auto');
        sceneFooter.append(director);
      } else {
        const currentDirector = director.innerText.match(/^Director: (.+)$/)[1];
        if (found.director === currentDirector) {
          director.classList.add('bg-warning', 'p-1');
          director.prepend('<already correct> ');
          director.title = makeAlreadyCorrectTitle('correct');
        } else {
          director.classList.add('bg-primary', 'p-1');
          director.append(` \u{22D9} ${found.director}`);
          director.title = `<pending> Director\n${found.director}`;
        }
      }
    })();

    (function code() {
      if (!found.code) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLDivElement | null} */
      let code = (sceneFooter.querySelector(':scope > div:last-of-type'));
      if (!code || !/^Studio Code:/.test(code.innerText)) {
        const newCode = document.createElement('b');
        newCode.innerText = found.code;
        code = document.createElement('div');
        code.append('<MISSING>', ' Studio Code: ', newCode);
        code.title = '<MISSING> Studio Code';
        code.classList.add('ms-3', 'bg-success', 'p-1', 'my-auto');
        sceneFooter.append(code);
      } else {
        const currentCode = code.innerText.match(/^Studio Code: (.+)$/)[1];
        if (found.code === currentCode) {
          code.classList.add('bg-warning', 'p-1');
          code.prepend('<already correct> ');
          code.title = makeAlreadyCorrectTitle('correct');
        } else {
          code.classList.add('bg-primary', 'p-1');
          code.append(` \u{22D9} ${found.code}`);
          code.title = `<pending> Studio Code\n${found.code}`;
        }
      }
    })();

    (function details() {
      if (!found.details) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLDivElement} */
      const desc = (sceneDescTab.querySelector('.scene-description > h4 + div'));
      const currentDetails = desc.textContent;
      if (!currentDetails) {
        desc.classList.add('bg-success', 'p-1');
        desc.innerText = found.details;
        desc.title = `<MISSING> Description`;
      } else if (currentDetails === found.details) {
        desc.classList.add('bg-warning', 'p-1');
        desc.title = makeAlreadyCorrectTitle('correct', 'Description');
      } else {
        const compareDiv = document.createElement('div');
        compareDiv.classList.add('d-flex', 'flex-column');
        compareDiv.title = '<pending> Description';
        desc.before(compareDiv);
        desc.classList.add('bg-danger', 'p-1');
        compareDiv.appendChild(desc);

        const buffer = document.createElement('div');
        buffer.classList.add('my-1');
        compareDiv.appendChild(buffer);

        const newDetails = document.createElement('div');
        newDetails.classList.add('bg-primary', 'p-1');
        newDetails.textContent = found.details;
        compareDiv.appendChild(newDetails);
      }
    })();

    (function url() {
      if (!found.url) return;
      if (markerDataset.backlogInjected) return;

      /** @type {HTMLAnchorElement} */
      const studioUrl = (sceneDescTab.querySelector(':scope > div:last-of-type > a'));
      const currentURL = studioUrl?.getAttribute('href');
      if (!studioUrl) {
        const missing = sceneDescTab.appendChild(document.createElement('div'));
        const missingLabel = missing.appendChild(document.createElement('b'));
        missingLabel.classList.add('me-2');
        missingLabel.innerText = 'Studio URL:';
        const studioURL = missing.appendChild(document.createElement('a'));
        studioURL.target = '_blank';
        studioURL.rel = 'noopener noreferrer';
        studioURL.classList.add('bg-success', 'p-1');
        studioURL.innerText = found.url;
        studioURL.href = found.url;
        studioURL.title = `<MISSING> Studio URL`;
      } else if (currentURL === found.url) {
        studioUrl.classList.add('bg-warning', 'p-1');
        studioUrl.title = makeAlreadyCorrectTitle('correct', 'Studio URL');
      } else {
        const compareSpan = document.createElement('span');
        compareSpan.title = '<pending> Studio URL';
        studioUrl.before(compareSpan);
        studioUrl.classList.add('bg-danger', 'p-1');
        compareSpan.appendChild(studioUrl);

        const arrow = document.createElement('span');
        arrow.classList.add('mx-1');
        arrow.innerText = '\u{22D9}';
        compareSpan.appendChild(arrow);

        const newURL = makeLink(found.url);
        newURL.classList.add('bg-primary', 'p-1');
        newURL.rel = studioUrl.rel;
        compareSpan.appendChild(newURL);
      }
    })();

    (function fingerprints() {
      if (!found.fingerprints) return;
      if (document.querySelector('[data-backlog="fingerprints"]')) return;

      // Parse current
      /** @type {HTMLTableRowElement[]} */
      const fingerprintsTableRows = (Array.from(document.querySelectorAll('.scene-fingerprints > table tr')));
      if (fingerprintsTableRows.length === 0) return;
      const { headers, fingerprints: currentFingerprints } = parseFingerprintTableRows(fingerprintsTableRows);

      /**
       * @param {FingerprintsRow} cfp
       * @param {SceneFingerprint} fp
       * @param {boolean} exact
       */
      const markFingerprint = (cfp, fp, exact) => {
        const { row } = cfp;
        row.classList.add('backlog-fingerprint' + (exact ? '' : '-duration'));
        if (fp.correct_scene_id) {
          const correct = makeLink(`/scenes/${fp.correct_scene_id}`, 'correct scene', { fontWeight: 'bolder' });
          row.children[headers.submissions].append(' | ', correct);
        }
      };

      // Compare
      const reportedExact = found.fingerprints;
      const exactMatches = reportedExact.filter((fp) => {
        const cfp = currentFingerprints.find(findFingerprint(fp));
        if (!cfp) return false;
        markFingerprint(cfp, fp, true);
        return true;
      }).length;

      const reportedDurations = found.fingerprints.filter((fp) => !!fp.duration);
      const uniqueDurations = reportedDurations.filter(
        (fp, i, self) => i === self.findIndex(
          (other) => fp.duration && other.duration && fp.duration === other.duration
        )
      );

      const durationsFound = uniqueDurations.reduce((count, fp) => {
        const matches = currentFingerprints.filter((cfp) =>
          cfp.duration === fp.duration && !cfp.row.classList.contains('backlog-fingerprint')
        );
        if (matches.length === 0) return count;
        matches.forEach((cfp) => markFingerprint(cfp, fp, false));
        count += matches.length;
        return count;
      }, 0);

      const notFound = found.fingerprints.length - exactMatches;

      if (exactMatches || durationsFound || notFound) {
        const fpInfoWrapper = document.createElement('div');
        fpInfoWrapper.dataset.backlog = 'fingerprints';
        fpInfoWrapper.classList.add('position-relative');
        fpInfoWrapper.style.top = '22px';

        const fpInfo = document.createElement('div');
        fpInfo.classList.add('position-absolute', 'end-0', 'd-flex', 'flex-column');
        fpInfoWrapper.appendChild(fpInfo);

        const backlogSheetId = '357846927'; // Fingerprints
        /** @param {[column: string, label?: string][]} fields */
        const makeQuery = (fields) => [
              'select',
              fields.map(([c]) => c).join(','),
              `where F="${sceneId}"`,
              'label',
              fields
                .reduce(
                  (r, [c, l]) => l ? r.concat(`${c} "${l}"`) : r,
                  /** @type {string[]} */ ([])
                )
                .join(', '),
            ].join(' ');
        const quickViewLink = makeLink(
          backlogQuickViewURL(
            backlogSheetId,
            makeQuery([
              ['B', 'Done'],
              ['G', 'Algorithm'],
              ['H', 'Hash'],
              ['I', 'Correct Scene ID'],
              ['J', 'Duration'],
              ['K'],
              ['L'],
            ]),
          ),
          'quick view',
          { color: 'var(--bs-cyan)' },
        );
        const sheetLink = makeLink(
          `${backlogSpreadsheet}/edit#gid=${backlogSheetId}`,
          'Fingerprints backlog sheet',
          { color: 'var(--bs-teal)' },
        );

        const backlogInfo = document.createElement('span');
        backlogInfo.classList.add('text-end');
        backlogInfo.append(sheetLink, ' (', quickViewLink, ')');
        fpInfo.append(backlogInfo);

        const makeNode = (/** @type {string} */ content) => {
          const b = document.createElement('b');
          b.classList.add('ms-2');
          b.innerText = content;
          return b;
        };

        const makeElement = (/** @type {(string | Node)[]} */ ...content) => {
          const span = document.createElement('span');
          span.classList.add('d-flex', 'justify-content-between');
          span.append(...content.map((c) => c instanceof Node ? c : makeNode(c)))
          return span;
        };

        if (exactMatches) {
          const el = makeElement('Incorrect fingerprints:');
          el.classList.add('text-warning');
          const count = document.createElement('b');
          count.classList.add('ms-2');
          el.appendChild(count);
          const countExact = document.createElement('span');
          countExact.innerText = `${exactMatches}`;
          count.append(countExact);
          if (durationsFound) {
            const countDuration = document.createElement('span');
            countDuration.style.color = '#4691ff';
            countDuration.innerText = ` +⌚${durationsFound}`;
            countDuration.title = 'Fingerprints by duration';
            count.append(countDuration);
          }
          count.append(' \u{2139}');
          fpInfo.appendChild(el);
        }
        if (notFound)
          fpInfo.appendChild(makeElement('Missing fingerprints:', `${notFound} ⚠`))
            .classList.add('text-danger');
        sceneInfo.parentElement.querySelector('ul.nav[role="tablist"]').before(fpInfoWrapper);
        removeHook(fpInfoWrapper, 'scenes', sceneId);
      }
    })();

    markerDataset.backlogInjected = 'true';
  } // iScenePage

  // =====

  /**
   * @param {string} sceneId
   */
  async function iSceneEditPage(sceneId) {
    const pageTitle = /** @type {HTMLHeadingElement} */ (await elementReadyIn('h3', 1000));
    if (!pageTitle) return;

    const markerDataset = pageTitle.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected, skipping');
      return;
    } else {
      markerDataset.backlogInjected = 'true';
    }

    const found = getDataFor('scenes', sceneId);
    if (!found) return;
    console.debug('[backlog] found', found);

    const sceneForm = /** @type {HTMLFormElement} */ (document.querySelector('.SceneForm'));
    const sceneFormTabs = /** @type {HTMLDivElement[]} */ (Array.from(sceneForm.querySelector(':scope > .tab-content').children));

    sceneFormTabs.find(tab => tab.id.endsWith('-images')).style.maxWidth = '75%';

    (function submittedWarning() {
      if (!isSubmitted('scenes', sceneId)) return;

      const editsLink = makeLink(`/scenes/${sceneId}#edits`, 'double-check');
      editsLink.classList.add('fw-bold', 'text-decoration-underline');

      const warning = document.createElement('h3');
      warning.classList.add('text-center', 'w-75', 'py-2', 'bg-gradient', 'bg-primary');
      warning.append(
        'This entry may have already been submitted, ',
        document.createElement('br'),
        'please ', editsLink, ' before submitting an edit.',
      );

      sceneForm.prepend(warning);
      removeHook(warning, 'scenes', sceneId);
    })();

    const pendingChangesContainer = document.createElement('div');
    pendingChangesContainer.classList.add('PendingChanges');
    setStyles(pendingChangesContainer, { position: 'absolute', top: '6rem', right: '1vw', width: '24vw' });
    const pendingChangesTitle = document.createElement('h3');
    pendingChangesTitle.innerText = 'Backlogged Changes';
    pendingChangesContainer.appendChild(pendingChangesTitle);
    const pendingChanges = document.createElement('dl');
    pendingChangesContainer.appendChild(pendingChanges);

    sceneForm.append(pendingChangesContainer);

    /**
     * @param {HTMLElement} field
     * @param {string} fieldName
     * @param {string | ((current?: string) => string)} value
     * @param {boolean} [activeTab=false]
     */
    const settableField = (field, fieldName, value, activeTab) => {
      /** @type {HTMLInputElement | HTMLTextAreaElement} */
      const fieldEl = sceneForm.querySelector(`*[name="${fieldName}"]`);
      if (!fieldEl) {
        console.error(`form field with name="${fieldName}" not found`);
        return;
      }
      const set = document.createElement('a');
      set.innerText = 'set field';
      setStyles(set, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
      set.addEventListener('click', () => {
        setNativeValue(fieldEl, value instanceof Function ? value(fieldEl.value) : value);
        if (activeTab) getTabButton(fieldEl).click();
        flashField(fieldEl);
      });
      field.innerText += ':';
      field.append(set);
    };

    // if no comments, set empty comment to enable field setter
    if (!found.comments)
      found.comments = [];

    const keySortOrder = [
      'title', 'date', 'duration',
      'performers', 'studio', 'code', 'url',
      'details', 'director', 'tags',
      'image', 'fingerprints',
    ];
    sortedKeys(found, keySortOrder).forEach((field) => {
      if (field === 'c_studio')
        return;

      const dt = document.createElement('dt');
      dt.innerText = field;
      dt.id = `backlog-pending-${field}-title`;
      pendingChanges.appendChild(dt);

      const dd = document.createElement('dd');
      dd.id = `backlog-pending-${field}`;
      pendingChanges.appendChild(dd);

      if (field === 'title') {
        const title = found[field];
        dd.innerText = title;
        dd.style.userSelect = 'all';
        settableField(dt, field, title);
        return;
      }

      if (field === 'date') {
        const date = found[field];
        dd.innerText = date;
        dd.style.userSelect = 'all';
        settableField(dt, field, date);
        return;
      }

      if (field === 'duration') {
        const duration = found[field];
        const formattedDuration = formatDuration(parseInt(duration));
        dd.innerText = `${formattedDuration} (${duration})`;
        settableField(dt, field, formattedDuration);
        return;
      }

      if (field === 'duplicate_of' || field === 'duplicates') {
        const value = found[field];
        const values = Array.isArray(value) ? value : [value];
        dt.innerText = field.replace(/_/g, ' ');

        values.map((dupId, index) => {
          if (index > 0) dd.append(document.createElement('br'));
          const a = makeLink(`/scenes/${dupId}`, dupId, { color: 'var(--bs-teal)' });
          a.target = '_blank';
          dd.append(a);
        });
        return;
      }

      if (field === 'performers') {
        const performers = found[field];

        const getPerformerItem = async (/** @type {string} */ id) =>
          /** @type {HTMLDivElement} */
          ((await elementReadyIn(`input[type="hidden"][value="${id}"]`, 100, sceneForm))?.parentElement);

        /** @param {PerformerEntry} entry */
        const addPerformer = async (entry) => {
          /** @type {HTMLInputElement} */
          const fieldEl = (sceneForm.querySelector('.add-performer input'));
          setNativeValue(fieldEl, entry.id);
          const result = /** @type {HTMLDivElement | null} */ (await elementReadyIn('.add-performer .react-select__option', 2000, sceneForm));
          if (result) {
            result.click();
            const performerItem = await getPerformerItem(entry.id);
            flashField(performerItem);

            /** @type {HTMLInputElement} */
            const aliasEl = performerItem.querySelector('input[role="combobox"]'); // input.performer-alias
            if (!aliasEl) return alert('performer alias field not found');
            setNativeValue(aliasEl, entry.appearance || '');
            if (entry.appearance) flashField(aliasEl);
            return;
          }
          alert('failed to add performer');
        };

        /**
         * @param {PerformerEntry} a
         * @param {PerformerEntry} b
         */
        const nameSort = (a, b) => (a.appearance || a.name).localeCompare(b.appearance || b.name);

        const ul = document.createElement('ul');
        ul.classList.add('p-0');
        sortedKeys(performers, ['update', 'remove', 'append']).forEach((action) => {
          performers[action].slice().sort(nameSort).forEach((entry) => {
            const li = document.createElement('li');
            li.classList.add('d-flex', 'justify-content-between');
            /** @type {HTMLElement} */
            let insertAfter;

            const label = document.createElement('a');
            setStyles(label, { flex: '0.25 0 0', height: '1.5rem' });
            if (entry.id) {
              label.classList.add('fw-bold');
              setStyles(label, { color: 'var(--bs-yellow)', cursor: 'pointer' });
            }
            label.innerText = '[' + (action === 'append' ? 'add' : action) + ']';
            li.appendChild(label);

            const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
            let name = entry.name + disambiguation;

            const info = document.createElement('span');
            setStyles(info, { flex: '1', whiteSpace: 'pre-wrap' });

            if (!entry.id) {
              const statusText = `<${entry.status || 'no id'}>`;
              const status = entry.status_url
                ? makeLink(entry.status_url, statusText, { color: 'var(--bs-teal)' })
                : statusText;
              info.append(status, ` ${name}`);
              if (entry.appearance) {
                const appearanceSpan = createSelectAllSpan(entry.appearance);
                appearanceSpan.classList.add('fw-bold');
                info.append(' (as ', appearanceSpan, ')');
              }
            } else if (action === 'update') {
              const a = makeLink(`/performers/${entry.id}`, name, { color: 'var(--bs-teal)' });
              a.target = '_blank';
              /** @type {Array<HTMLElement | string>} */
              const nodes = [
                a,
                document.createElement('br'),
                `from "${entry.old_appearance || ''}"`,
                document.createElement('br'),
                'to "', createSelectAllSpan(entry.appearance || ''), '"',
              ];
              if (entry.status) {
                nodes.unshift(`<${entry.status}> `);
              }
              info.append(...nodes);

              label.addEventListener('click', async () => {
                const performerItem = await getPerformerItem(entry.id);
                if (!performerItem) return alert('performer not found');

                /** @type {HTMLInputElement} */
                const aliasEl = performerItem.querySelector('input[role="combobox"]'); // input.performer-alias
                if (!aliasEl) return alert('performer alias field not found');
                setNativeValue(aliasEl, entry.appearance || '');
                flashField(aliasEl);
              });
            } else {
              const a = makeLink(`/performers/${entry.id}`, name, { color: 'var(--bs-teal)' });
              a.target = '_blank';
              info.appendChild(a);

              if (entry.status) {
                a.before(`<${entry.status}> `);
              }

              if (entry.appearance) {
                const appearanceSpan = createSelectAllSpan(entry.appearance);
                appearanceSpan.classList.add('fw-bold');
                info.append(' (as ', appearanceSpan, ')');
              }

              if (action === 'append') {
                info.append(
                  document.createElement('br'),
                  createSelectAllSpan(entry.id, { fontSize: '.9rem' }),
                );

                // Attempt to find a performer-to-remove with the same name
                const replacement = (
                  performers.remove.find((toRemove) => [entry.appearance, entry.name].includes(toRemove.appearance || toRemove.name))
                  || performers.remove.find((toRemove) => entry.name.split(/\b/)[0] == (toRemove.appearance || toRemove.name).split(/\b/)[0])
                );
                if (replacement) {
                  label.innerText = '[replace]';
                  label.style.color = 'var(--bs-cyan)';
                  insertAfter = Array.from(ul.querySelectorAll('li')).find((li) => {
                    const href = /** @type {HTMLAnchorElement} */ (li.querySelector('a[href]')).href;
                    return parsePath(href).ident === replacement.id;
                  });

                  label.title = 'Hold <CTRL> to add instead.';

                  const keydown = (/** @type {KeyboardEvent} */ e) => {
                    if (e.ctrlKey) {
                      label.firstChild.textContent = '[add]';
                      label.style.color = 'var(--bs-yellow)';
                    }
                  };
                  const keyup = () => {
                    label.firstChild.textContent = '[replace]';
                    label.style.color = 'var(--bs-cyan)';
                  };
                  window.addEventListener('keydown', keydown);
                  window.addEventListener('keyup', keyup);

                  window.addEventListener(locationChanged, () => {
                    window.removeEventListener('keydown', keydown);
                    window.removeEventListener('keyup', keyup);
                  }, { once: true });
                }

                label.addEventListener('click', async (e) => {
                  const performerItem = await getPerformerItem(entry.id);

                  if (performerItem) {
                    if (e.ctrlKey) window.dispatchEvent(new KeyboardEvent('keyup'));
                    return alert('performer already added');
                  }

                  if (!replacement || e.ctrlKey) {
                    return addPerformer(entry);
                  }

                  /** @type {HTMLDivElement} */
                  const replPerformerItem = await getPerformerItem(replacement.id);
                  if (!replPerformerItem) {
                    alert('replacement performer not found or already removed\n\nadding as new performer');
                    return addPerformer(entry);
                  }

                  const buttons = Array.from(replPerformerItem.querySelectorAll('button'));
                  buttons
                    .find((btn) => btn.innerText === 'Change')
                    ?.click();

                  const failHandler = () => {
                    const replName = replacement.name + (replacement.disambiguation ? ` [${replacement.disambiguation}]` : '');
                    alert(`failed to replace performer ${replName} with ${name}`);
                  };

                  const searchField = /** @type {HTMLDivElement | null} */ (await elementReadyIn('.SearchField', 2000, replPerformerItem));
                  if (!searchField) {
                    return failHandler();
                  }
                  const fieldEl = /** @type {HTMLInputElement} */ (searchField.querySelector('input'));
                  setNativeValue(fieldEl, entry.id);
                  const result = /** @type {HTMLDivElement | null} */ (await elementReadyIn('.react-select__option', 2000, searchField));
                  if (result) {
                    result.click();
                    const performerItem = await getPerformerItem(entry.id);
                    flashField(performerItem);

                    /** @type {HTMLInputElement} */
                    const aliasEl = performerItem.querySelector('input[role="combobox"]'); // input.performer-alias
                    if (!aliasEl) return alert('performer alias field not found');
                    setNativeValue(aliasEl, entry.appearance || '');
                    flashField(aliasEl);
                    return;
                  }
                  try {
                    Array.from(replPerformerItem.querySelectorAll('button'))
                      .find((btn) => btn.innerText === 'Cancel')
                      .click();
                  } finally {
                    failHandler();
                  }
                });
              }

              if (action === 'remove') {
                label.addEventListener('click', async () => {
                  const performerItem = await getPerformerItem(entry.id);
                  if (!performerItem) return alert('performer not found or already removed');

                  const buttons = Array.from(performerItem.querySelectorAll('button'));
                  const removeButton = buttons.find((btn) => btn.innerText === 'Remove');
                  removeButton.click();
                });
              }
            }

            if (entry.notes) {
              label.append(...makeNoteElements(entry));
            }

            li.appendChild(info);

            if (insertAfter === undefined) ul.appendChild(li);
            else insertAfter.after(li);
          });
        });
        dd.appendChild(ul);
        return;
      }

      if (field === 'studio') {
        const [studioId, studioName] = found[field];

        if (studioId) {
          const a = makeLink(`/studios/${studioId}`, studioName, { color: 'var(--bs-teal)' });
          a.target = '_blank';
          dd.append(a, document.createElement('br'), createSelectAllSpan(studioId));
        } else {
          dd.append(createSelectAllSpan(studioName), document.createElement('br'), '(missing ID)');
        }

        const studioSelect = /** @type {HTMLDivElement} */ (sceneForm.querySelector('.StudioSelect'));
        const fieldEl = /** @type {HTMLInputElement} */ (studioSelect.querySelector('input'));
        const set = document.createElement('a');
        set.innerText = 'set field';
        setStyles(set, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
        set.addEventListener('click', async () => {
          setNativeValue(fieldEl, studioId ? studioId : `"${studioName}"`);
          await Promise.race([
            elementReady('.react-select__option', studioSelect),
            elementReady('.react-select__menu-notice--no-options', studioSelect),
            wait(2000),
          ]);
          /** @type {HTMLDivElement[]} */
          const results = (Array.from(studioSelect.querySelectorAll('.react-select__option')));
          if (results.length === 1) results[0].click();
          else getTabButton(fieldEl).click();
          flashField(studioSelect);
        });
        dt.innerText += ':';
        dt.append(set);
        return;
      }

      if (field === 'code') {
        const code = found[field];
        dd.innerText = code;
        dd.style.userSelect = 'all';
        settableField(dt, field, code);
        return;
      }

      if (field === 'url') {
        const studioUrl = found[field];
        dt.innerText = 'studio link';
        dd.appendChild(makeLink(studioUrl));

        const set = document.createElement('a');
        set.innerText = 'set field';
        setStyles(set, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
        set.addEventListener('click', () => addSiteURL('Studio', studioUrl, true));
        dt.innerText += ':';
        dt.append(set);
        return;
      }

      if (field === 'details') {
        const details = found[field];
        dd.innerText = details;
        setStyles(dd, {
          whiteSpace: 'pre-line',
          userSelect: 'all',
          maxHeight: '20vh',
          overflow: 'auto',
        });
        settableField(dt, field, details);
        return;
      }

      if (field === 'director') {
        const director = found[field];
        dd.innerText = director;
        dd.style.userSelect = 'all';
        settableField(dt, field, director);
        return;
      }

      // tags

      if (field === 'image') {
        const image = found[field];
        const imgContainer = document.createElement('div');
        imgContainer.classList.add('position-relative');
        setStyles(imgContainer, { border: '2px solid var(--bs-teal)', width: 'fit-content' });
        const imgLink = makeLink(image, '', { color: 'var(--bs-teal)' });
        imgContainer.appendChild(imgLink);
        dd.appendChild(imgContainer);
        const onSuccess = (/** @type {Blob} **/ blob) => {
          const img = document.createElement('img');
          setStyles(img, { maxHeight: '200px' });
          img.src = URL.createObjectURL(blob);
          imgLink.prepend(img);

          const imgRes = makeImageResolution(img);
          imgRes.classList.add('end-0');
          imgContainer.prepend(imgRes);

          const set = document.createElement('a');
          set.innerText = 'set field';
          setStyles(set, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
          set.addEventListener('click', () => {
            const imagesTab = getTabButton('Images');
            /** @type {HTMLInputElement} */
            const fieldEl = (sceneForm.querySelector('.EditImages input[type="file"]'));
            if (!fieldEl) {
              imagesTab.click();
              return alert('max images reached');
            }

            const filename = image.slice(image.lastIndexOf('/') + 1);
            const file = new File([blob], filename, {
              type: blob.type,
              lastModified: new Date().getTime(),
            });
            const container = new DataTransfer();
            container.items.add(file);

            imagesTab.click();

            fieldEl.files = container.files;
            fieldEl.dispatchEvent(new Event('change', { bubbles: true }));
          });
          dt.innerText += ':';
          dt.append(set);
        };
        const onFailure = () => imgLink.innerText = image;
        getImageBlob(image).then(onSuccess, onFailure);
        return;
      }

      if (field === 'fingerprints') {
        const fingerprintsTab = sceneFormTabs.find(tab => tab.id.endsWith('-fingerprints'));
        // Fingerprint editing removed from Scene Edit Form
        if (!fingerprintsTab) {
          dd.append(`${found[field].length} reported submissions`);
          return;
        }

        /** @type {HTMLTableRowElement[]} */
        const fingerprintsTableRows = (Array.from(fingerprintsTab.querySelectorAll('table tr')));
        if (fingerprintsTableRows.length === 0) return;
        const { fingerprints: currentFingerprints } = parseFingerprintTableRows(fingerprintsTableRows);

        found[field].forEach((fp, index) => {
          if (index > 0) dd.append(document.createElement('br'));
          const fpElement = document.createElement('span');
          fpElement.append(
            fp.algorithm.toUpperCase(),
            createSelectAllSpan(fp.hash, { marginLeft: '.5rem' }),
          );

          const remove = document.createElement('a');
          remove.innerText = 'remove';
          setStyles(remove, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
          fpElement.appendChild(remove);
          remove.addEventListener('click', () => {
            const row = currentFingerprints.find(findFingerprint(fp))?.row;
            if (row) {
              /** @type {HTMLButtonElement} */
              (row.querySelector('.remove-item')).click();
            }
            fpElement.style.textDecoration = 'line-through';
            remove.remove();
          });

          if (fp.correct_scene_id) {
            const correct = makeLink(`/scenes/${fp.correct_scene_id}`, 'correct scene', { color: 'var(--bs-teal)' });
            correct.target = '_blank';
            fpElement.append(
              document.createElement('br'),
              '\u{22D9} ', correct, ': ',
              createSelectAllSpan(fp.correct_scene_id, { fontSize: '.9rem' }),
            );
          }

          const cfp = currentFingerprints.find(findFingerprint(fp));
          if (cfp) {
            cfp.row.classList.add(fp.correct_scene_id ? 'bg-warning' : 'bg-danger');
          }

          dd.appendChild(fpElement);
        });
        return;
      }

      if (field === 'comments') {
        const comments = found[field];
        setStyles(dd, { maxHeight: '20vh', overflow: 'auto' });

        /** @param {string} comment */
        const prefixToName = (comment) => {
          if (comment.startsWith('https://www.freeones.com/forums/threads/performer-guide-netvideogirls-com.101884/'))
            return 'Freeones NVG Performer Guide';
          return null;
        };

        const fauxComment = comments.length === 0 ? [Symbol('Backlog')] : undefined;
        (fauxComment || comments).forEach((comment, index) => {
          if (index > 0) dd.append(document.createElement('br'));
          const text = typeof comment === 'string' ? comment : comment.description;
          const commentElement =
            /^https?:/.test(text)
              ? makeLink(text, null, { color: 'var(--bs-teal)' })
              : document.createElement(typeof comment === 'string' ? 'span' : 'code');
          commentElement.innerText = prefixToName(text) || text;
          dd.appendChild(commentElement);
        });

        /** @param {string} current */
        const editNote = (current) => [current]
          .filter(Boolean)
          .concat(comments)
          // Non-URLs or URLs that have not been added as links
          .filter((comment) => !/^https?:/.test(comment) || !getLinkByURL(comment))
          .map((comment) => {
            const prefixName = prefixToName(comment);
            return prefixName
              ? `[${prefixName}](${comment}):`
              : comment;
          })
          .concat(['', '`Backlog`'])
          .join('\n')
          .trim();

        settableField(dt, 'note', editNote, true);

        // URLs from comments
        const dtLinks = document.createElement('dt');
        dtLinks.innerText = 'links from comments:';
        const ddLinks = document.createElement('dd');

        found.comments.forEach((comment) => {
          if (!/^https?:/.test(comment))
            return;

          /** @type {string} */
          let site;
          if (/iafd\.com\/title\.rme\//.test(comment)) {
            site = 'IAFD';
          } else if (/indexxx\.com\/set\//.test(comment)) {
            site = 'Indexxx';
          } else if (/data18.com\/(content|scenes)\//.test(comment)) {
            site = 'DATA18';
          } else {
            return;
          }
          const container = document.createElement('div');
          const set = document.createElement('a');
          set.innerText = `add ${site} link`;
          set.classList.add('fw-bold');
          setStyles(set, { color: 'var(--bs-yellow)', cursor: 'pointer' });
          set.addEventListener('click', () => addSiteURL(site, comment, true));
          container.append(set, ':');
          const link = makeLink(comment);
          link.classList.add('text-truncate', 'd-block', 'ms-2');
          container.appendChild(link);
          ddLinks.appendChild(container);
        });

        if (ddLinks.children.length > 0) {
          const pendingUrl = pendingChanges.querySelector('dd#backlog-pending-url');
          if (pendingUrl) pendingUrl.after(dtLinks, ddLinks);
          else dt.before(dtLinks, ddLinks);
        }

        return;
      }

      // unmatched
      dd.innerText = found[field];
    });

  } // iSceneEditPage

  // =====

  /**
   * @param {string} performerId
   */
  async function iPerformerPage(performerId) {
    const performerInfo = /** @type {HTMLDivElement} */ (await elementReadyIn('.PerformerInfo', 1000));
    if (!performerInfo) return;

    const _performerFiberEl = getReactFiber(performerInfo)?.return;
    const _performerFiberCur = _performerFiberEl?.memoizedProps?.performer;
    const _performerFiberAlt = _performerFiberEl?.alternate?.memoizedProps?.performer;

    /** @type {{ urls: ScenePerformance_URL[] }} */
    const performerFiber = _performerFiberAlt?.id && _performerFiberAlt.id !== _performerFiberCur?.id ? _performerFiberAlt : _performerFiberCur;

    /** @type {string[] | undefined} */
    const performerUrls = performerFiber?.urls.map((u) => u.url);

    (function performerLinks() {
      // Don't show if native links exist (#439)
      const nativeLinks = performerInfo.querySelector('.card + .float-end');
      if (nativeLinks) {
        if (isDev) nativeLinks.classList.add('d-none');
        else return;
      }

      const header = performerInfo.querySelector('.card-header');
      if (header.querySelector('[data-backlog="links"]')) return;

      if (!performerFiber) return;

      const sortedUrls = performerFiber.urls
        .slice().sort((a, b) => a.site.name.localeCompare(b.site.name));

      const links = document.createElement('div');
      links.classList.add('ms-auto', 'mt-auto', 'text-end', 'lh-sm');
      const pxWidth = Math.ceil(sortedUrls.length / 2) * 1.25;
      setStyles(links, { flexBasis: `${pxWidth}em`, marginRight: '-.5em' });
      links.dataset.backlog = 'links';
      header.appendChild(links);
      removeHook(links, 'performers', performerId);

      links.append(...sortedUrls.map(({ url, site }) => {
        const icon = document.createElement('img');
        icon.classList.add('SiteLink-icon', 'mx-0');
        icon.src = site.icon;
        icon.alt = '';
        const a = makeLink(url, '');
        a.classList.add('SiteLink', 'me-0', 'ms-1');
        a.title = site.name;
        a.appendChild(icon);
        return a;
      }));
    })();

    highlightSceneCards('performers');

    /** @type {HTMLDivElement} */
    let backlogDiv = (document.querySelector('.performer-backlog'));
    if (!backlogDiv) {
      backlogDiv = document.createElement('div');
      backlogDiv.classList.add('performer-backlog', 'mb-2');
      setStyles(backlogDiv, {
        maxWidth: '75%',
        minWidth: 'calc(50% - 15px)',
        transition: 'background-color .5s',
      });
      performerInfo.before(backlogDiv);
      removeHook(backlogDiv, 'performers', performerId);

      /** @type {HTMLDivElement} */
      const actionsContainer = (performerInfo.querySelector('.PerformerInfo-actions .text-end'));
      if (actionsContainer) {
        actionsContainer.style.width = 'fit-content';
        actionsContainer.classList.add('ms-auto');

        actionsContainer.addEventListener('mouseover', () => {
          backlogDiv.style.backgroundColor = '#8c2020';
        });
        actionsContainer.addEventListener('mouseout', () => {
          backlogDiv.style.backgroundColor = '';
        });
      }
    }

    // Performer scene changes based on cached data
    (function sceneChanges() {
      if (backlogDiv.querySelector('[data-backlog="scene-changes"]')) return;

      try {
        /** @typedef {[sceneId: string, entry: PerformerEntry, studio: string]} performerScene */
        /** @type {Record<keyof SceneDataObject["performers"], performerScene[]>} */
        const performerScenes = { append: [], remove: [], update: [] };
        /** @type {{ [sceneId: string]: null }} */
        const sceneIds = {};

        for (const { sceneId, action } of Cache.performerScenes(performerId)) {
          const scene = Cache.data.scenes[sceneId];
          const studio = studioArrayToString(scene.c_studio);

          const { append, remove, update } = scene.performers;
          if (action === 'append') {
            const appendEntry = append.find(({ id }) => id === performerId);
            performerScenes.append.push([sceneId, appendEntry, studio]);
            sceneIds[sceneId] = null;
          } else if (action === 'remove') {
            const removeEntry = remove.find(({ id }) => id === performerId);
            const targetEntry = append.find(({ appearance, name }) => {
              if (!appearance) return name.split(/\b/)[0] === removeEntry.name.split(/\b/)[0];
              return [appearance, name].some((a) => [removeEntry.appearance, removeEntry.name].includes(a));
            });
            if (targetEntry && (removeEntry.status === 'edit' || removeEntry.status === 'merge'))
              targetEntry.status = removeEntry.status;
            performerScenes.remove.push([sceneId, targetEntry, studio]);
            sceneIds[sceneId] = null;
          } else if (action === 'update') {
            const updateEntry = update.find(({ id }) => id === performerId);
            performerScenes.update.push([sceneId, updateEntry, studio]);
            sceneIds[sceneId] = null;
          }
        }

        // Pending scenes by URLs
        if (performerUrls) {
          Object.entries(Cache.data.scenes).forEach(([sceneId, { performers, c_studio }]) => {
            if (sceneIds[sceneId])
              return;

            const appendEntry = performers?.append.find((entry) => {
              if (entry.status !== 'new')
                return false;
              const backlogUrls = (entry.notes || []).filter((u) => /https?:\/\//.test(u));
              if (entry.status_url)
                backlogUrls.splice(0, 0, entry.status_url);
              return performerUrls.some((url) => backlogUrls.includes(url));
            });

            if (!appendEntry)
              return;

            const studio = studioArrayToString(c_studio);
            performerScenes.append.push([sceneId, appendEntry, studio]);
            sceneIds[sceneId] = null;
          });
        }

        if (Object.values(performerScenes).every((v) => v.length === 0)) return;

        const pName = {
          /** @param {PerformerEntry} entry */
          append: (entry) => {
            if (!entry) return null;
            const { appearance, name } = entry;
            return appearance || name;
          },
          /** @param {PerformerEntry} entry */
          remove: (entry) => {
            if (!entry) return null;
            const { name, disambiguation } = entry;
            return name + (disambiguation ? ` (${disambiguation})` : '');
          },
          /** @param {PerformerEntry} entry */
          update: (entry) => {
            if (!entry) return null;
            return entry.appearance || '""';
          },
        };
        const actionPrefix = {
          append: '\u{FF0B}', // ＋
          remove: '\u{FF0D}', // －
          update: '\u{FF5E}', // ～
        };

        const sceneChanges = document.createElement('div');
        sceneChanges.dataset.backlog = 'scene-changes';
        sceneChanges.classList.add('mb-1', 'p-1', 'fw-bold');
        sceneChanges.innerText = 'This performer has pending scene changes:';
        for (const [actionStr, scenes] of Object.entries(performerScenes)) {
          if (scenes.length === 0) continue;
          const action = /** @type {keyof SceneDataObject["performers"]} */ (actionStr);
          const details = document.createElement('details');
          details.style.marginLeft = '1.5rem';
          const summary = document.createElement('summary');
          setStyles(summary, { color: 'tan', width: 'max-content' });
          summary.innerText = `${actionPrefix[action]} ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
          details.append(summary);
          const sceneLinks = document.createElement('ol');
          sceneLinks.classList.add('mb-0');
          setStyles(sceneLinks, { paddingLeft: '2rem', fontWeight: 'normal' });
          scenes
            .slice()
            .sort(([, a], [, b]) => {
              const aName = pName[action](a), bName = pName[action](b);
              if (aName !== null && bName !== null) return aName.localeCompare(bName);
              if (aName === null) return 1;
              if (bName === null) return -1;
              return 0;
            })
            .forEach(([sceneId, entry, studio], idx) => {
              if (idx > 0 && idx % 10 === 0) {
                const groupSep = document.createElement('br');
                sceneLinks.appendChild(groupSep);
              }
              const changeItem = document.createElement('li');
              const a = makeLink(`/scenes/${sceneId}`, sceneId, {
                color: 'var(--bs-teal)',
                fontFamily: 'monospace',
                fontSize: '16px',
              });
              a.target = '_blank';
              changeItem.append(a);
              if (action === 'append')
                changeItem.append(` (as ${pName[action](entry)})`);
              else if (action === 'remove') {
                if (!entry) {
                  changeItem.append(' (unknown target)');
                } else {
                  const pLink = entry.id
                    ? makeLink(`/performers/${entry.id}`, pName[action](entry), { color: 'var(--bs-teal)' })
                    : pName[action](entry);
                  // status is set to the remove entry's status above
                  const status =
                    entry.status === 'edit' || entry.status === 'merge'
                      ? `${entry.status} into`
                      : 'target';
                  changeItem.append(` (${status}: `, pLink, ')');
                }
              } else if (action === 'update')
                changeItem.append(` (to ${pName[action](entry)})`);
              if (studio)
                changeItem.append(` - ${studio}`);
              sceneLinks.appendChild(changeItem);
            });
          details.append(sceneLinks);
          sceneChanges.append(details);
        }
        const emoji = document.createElement('span');
        emoji.classList.add('me-1');
        emoji.innerText = '📹';
        sceneChanges.prepend(emoji);
        backlogDiv.prepend(sceneChanges);
      } catch (error) {
        console.error(error);
      }
    })();

    const foundData = getDataFor('performers', performerId);

    (function fragments() {
      // merge current links with backlogged links
      const urls = performerUrls.concat(foundData?.urls || []);
      const { performerFragments, fragmentIndexMap, possibleLinks } = getPerformerFragments({ performerId, urls });

      if (performerFragments.length === 0)
        return;

      if (backlogDiv.querySelector('[data-backlog="fragments"]')) return;
      const hasFragments = document.createElement('div');
      hasFragments.dataset.backlog = 'fragments';
      hasFragments.classList.add('mb-1', 'p-1');

      const label = document.createElement('span');
      label.classList.add('fw-bold');
      label.innerText = `✂ Performer is listed as a fragment for ${performerFragments.length} performer${
        performerFragments.length !== 1 ? 's' : ''} to split up:`;
      hasFragments.appendChild(label);

      const performersList = document.createElement('ol');
      setStyles(performersList, { paddingLeft: '2rem' });
      renderPerformersList(performerFragments, performersList, 'fragments', fragmentIndexMap);

      hasFragments.append(performersList);

      backlogDiv.append(hasFragments);

      (function possibleLinksFromFragments() {
        if (possibleLinks.length === 0) return;
        const linksFromFragments = document.createElement('div');

        const label = document.createElement('span');
        label.classList.add('fw-bold');
        label.innerText = 'Possible links for this performer (sourced from fragments):';
        linksFromFragments.appendChild(label);

        possibleLinks.forEach((url) => {
          linksFromFragments.append(document.createElement('br'));
          const container = document.createElement('span');
          container.style.marginLeft = '1.75rem';
          const site = document.createElement('i');
          setStyles(site, { color: 'var(--bs-yellow)' });
          site.innerText = `${getSiteName(url)}: `;
          const a = makeLink(url, undefined, { color: 'var(--bs-teal)' });
          a.target = '_blank';
          container.append(site, a);
          linksFromFragments.appendChild(container);
        });

        const emoji = document.createElement('span');
        emoji.classList.add('me-1');
        emoji.innerText = '🔗';
        linksFromFragments.prepend(emoji);

        hasFragments.append(linksFromFragments);
      })();

    })();

    if (!foundData) return;
    console.debug('[backlog] found', foundData);

    const isMarkedForSplit = (/** @type {string} */ uuid) => {
      const dataEntry = Cache.data.performers[uuid];
      return dataEntry && !!dataEntry.split;
    };

    (function split() {
      if (!foundData.split) return;
      if (backlogDiv.querySelector('[data-backlog="split"]')) return;
      const splitItem = foundData.split;

      const toSplit = document.createElement('div');
      toSplit.dataset.backlog = 'split';
      toSplit.classList.add('mb-1', 'p-1');

      const backlogSheetId = '1067038397'; // Performers To Split Up
      const sheetLink = makeLink(
        `${backlogSpreadsheet}/edit#gid=${backlogSheetId}`,
        'Performers To Split Up',
        { color: 'var(--bs-orange)' },
      );

      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '🔀';
      const label = document.createElement('span');
      label.classList.add('fw-bold');
      label.append('This performer is listed on ', sheetLink, ':');
      toSplit.append(emoji, label);

      const performerName =
        /** @type {HTMLElement[]} */
        (Array.from(performerInfo.querySelectorAll('h3 > span, h3 > small')))
          .map(e => e.innerText).join(' ');
      if (performerName !== splitItem.name) {
        const unexpectedName = document.createElement('div');
        unexpectedName.classList.add('bg-danger', 'fw-bold');
        setStyles(unexpectedName, { marginLeft: '1.75rem', padding: '.15rem .25rem', width: 'fit-content' });
        unexpectedName.innerText = `Unexpected performer name - expected "${splitItem.name}"`;
        toSplit.appendChild(unexpectedName);
      }

      if (splitItem.notes) {
        const notes = document.createElement('div');
        notes.style.marginLeft = '1.75rem';
        notes.append(...strikethroughTextElements(splitItem.notes.join('\n')));
        toSplit.append(notes);
      }

      if (splitItem.links) {
        const links = document.createElement('div');
        links.classList.add('fw-bold');
        links.style.marginLeft = '1.75rem';
        splitItem.links.forEach((url) => {
          const link = makeLink(url, `[${getSiteName(url)}]`, { color: 'var(--bs-yellow)' });
          link.classList.add('me-1');
          link.title = url;
          links.appendChild(link);
        });
        toSplit.append(links);
      }

      const { fragments } = splitItem;

      if (fragments.length === 0) {
        const noFragments = document.createElement('div');
        noFragments.classList.add('fw-bold');
        setStyles(noFragments, { marginLeft: '1.75rem', color: 'tan', width: 'max-content' });
        noFragments.innerText = 'No fragments listed.';
        toSplit.appendChild(noFragments);
        backlogDiv.append(toSplit);
        return;
      }

      const fragmentsDetails = document.createElement('details');
      fragmentsDetails.style.marginLeft = '1.5rem';
      const summary = document.createElement('summary');
      summary.classList.add('fw-bold');
      setStyles(summary, { color: 'tan', width: 'max-content' });
      summary.innerText = `${fragments.length} fragment${fragments.length === 1 ? '' : 's'}`;
      fragmentsDetails.append(summary);

      const fragmentsAreShort = (
        fragments.length === 1
        && ((fragments[0].text?.match(/\n/g)?.length || 1) + (fragments[0].notes?.length || 0)) <= 5
      );
      /** @type {number[]} */
      const highlightFragments = history.state?.usr?.state?.performerFragment || [];
      fragmentsDetails.open = highlightFragments.length > 0 || fragmentsAreShort;

      const fragmentsList = document.createElement('ol');
      setStyles(fragmentsList, { padding: '0', margin: '0 0 0 2rem' });
      fragmentsDetails.append(fragmentsList);

      /** @type {HTMLLIElement} */
      let firstHighlighedFragmentEl;
      fragments.forEach((fragment, index) => {
        const fragmentEl = document.createElement('li');
        fragmentEl.classList.add('mt-1');

        if (highlightFragments.includes(index)) {
          fragmentEl.classList.add('bg-primary', 'bg-opacity-50');
          if (!firstHighlighedFragmentEl)
            firstHighlighedFragmentEl = fragmentEl;
        }

        const params = new URLSearchParams();
        if (fragment.id) params.append('id', fragment.id);
        fragment.links?.filter(validFragmentLink)?.forEach((link) => params.append('url', link));
        const fragmentSearchQS = params.toString();
        if (fragmentSearchQS) {
          const fragmentSearch = makeLink(`/backlog/fragment-search?${fragmentSearchQS}`, '🔎');
          fragmentSearch.classList.add('me-1', 'fw-bold', 'text-decoration-none', 'user-select-none');
          fragmentSearch.title = 'Search for other fragments...';
          fragmentEl.appendChild(fragmentSearch);
        }

        let fragmentName;
        if (fragment.id) {
          fragmentName = makeLink(`/performers/${fragment.id}`, fragment.name, { color: 'var(--bs-teal)' });
          fragmentName.target = '_blank';
        } else {
          fragmentName = document.createElement('span');
          fragmentName.innerText = fragment.name;
        }
        fragmentName.classList.add('fw-bold');
        fragmentEl.appendChild(fragmentName);

        if (fragment.id && isMarkedForSplit(fragment.id)) {
          const hasFragments = document.createElement('abbr');
          hasFragments.classList.add('ms-1', 'text-decoration-none');
          hasFragments.innerText = '🔀';
          hasFragments.title = 'Linked performer needs to be split up.';
          fragmentEl.append(hasFragments);
        }

        if (fragment.text || fragment.notes) {
          const notes = [fragment.text || ''].concat(fragment.notes || []).join('\n');
          const text = document.createElement('span');
          text.style.whiteSpace = 'pre-wrap';
          text.append(...strikethroughTextElements(notes));
          fragmentEl.append(': ', text);
        }

        const links = document.createElement('div');
        (fragment.links || []).forEach((url) => {
          const link = makeLink(url, `[${getSiteName(url)}]`, { color: 'var(--bs-yellow)' });
          link.classList.add('me-1', 'fw-bold');
          link.title = url;
          links.appendChild(link);
        });
        fragmentEl.appendChild(links);

        fragmentsList.appendChild(fragmentEl);
      });
      toSplit.appendChild(fragmentsDetails);
      backlogDiv.append(toSplit);

      if (firstHighlighedFragmentEl && !isInViewport(firstHighlighedFragmentEl)) {
        firstHighlighedFragmentEl.scrollIntoView();
      }

    })();

    (function duplicates() {
      if (!foundData.duplicates) return;
      if (backlogDiv.querySelector('[data-backlog="duplicates"]')) return;

      const { ids, name: expectedName, notes } = foundData.duplicates;

      const hasDuplicates = document.createElement('div');
      hasDuplicates.dataset.backlog = 'duplicates';
      hasDuplicates.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This performer has duplicates:';
      hasDuplicates.appendChild(label);

      const performerName =
        /** @type {HTMLElement[]} */
        (Array.from(performerInfo.querySelectorAll('h3 > span, h3 > small')))
          .map(e => e.innerText).join(' ');
      if (performerName !== expectedName) {
        const warning = document.createElement('div');
        warning.classList.add('bg-danger', 'fw-bold');
        setStyles(warning, { marginLeft: '1.75rem', padding: '.15rem .25rem', width: 'fit-content' });
        warning.innerText = `Unexpected performer name - expected "${expectedName}"`;
        hasDuplicates.appendChild(warning);
      }

      const linksSpan = document.createElement('span');

      const notesDiv = document.createElement('div');
      setStyles(notesDiv, { marginLeft: '1.75rem', whiteSpace: 'pre-wrap' });
      notesDiv.classList.add('fw-normal');

      (notes || []).forEach((note) => {
        if (/^https?:/.test(note)) {
          const siteName = getSiteName(note);
          const link = makeLink(note, `[${siteName}]`, { color: 'var(--bs-yellow)' });
          link.classList.add('ms-1');
          link.title = note;
          linksSpan.appendChild(link);
        } else {
          notesDiv.append((notesDiv.textContent ? '\n' : '') + note);
        }
      });

      if (linksSpan.textContent) {
        label.after(linksSpan);
      }

      if (notesDiv.textContent) {
        notesDiv.prepend('📝 ');
        hasDuplicates.appendChild(notesDiv);
      }

      ids.forEach((dupId) => {
        const dupDiv = document.createElement('div');
        dupDiv.classList.add('fw-normal');
        dupDiv.style.marginLeft = '1.75rem';
        const a = makeLink(`/performers/${dupId}`, dupId, { color: 'var(--bs-teal)' });
        a.target = '_blank';
        dupDiv.append(a);

        if (isMarkedForSplit(dupId)) a.after(' 🔀 needs to be split up');
        hasDuplicates.append(dupDiv);
      });
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      hasDuplicates.prepend(emoji);
      backlogDiv.append(hasDuplicates);
    })();

    (function duplicateOf() {
      if (!foundData.duplicate_of) return;
      if (backlogDiv.querySelector('[data-backlog="duplicate-of"]')) return;

      const duplicateOf = document.createElement('div');
      duplicateOf.dataset.backlog = 'duplicate-of';
      duplicateOf.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This performer is a duplicate of: ';
      duplicateOf.appendChild(label);

      const a = makeLink(`/performers/${foundData.duplicate_of}`, foundData.duplicate_of, { color: 'var(--bs-teal)' });
      a.target = '_blank';
      a.classList.add('fw-normal');
      duplicateOf.append(a);
      if (isMarkedForSplit(foundData.duplicate_of)) a.after(' 🔀 needs to be split up');
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      duplicateOf.prepend(emoji);

      const mainData = getDataFor('performers', foundData.duplicate_of);
      const mainNotes = mainData?.duplicates.notes?.filter((note) => !/^https?:/.test(note));
      if (mainNotes?.length > 0) {
        const notesDiv = document.createElement('div');
        setStyles(notesDiv, { marginLeft: '1.75rem', whiteSpace: 'pre-wrap' });
        notesDiv.classList.add('fw-normal');
        notesDiv.append('📝 ', mainNotes.join('\n'));
        duplicateOf.appendChild(notesDiv);
      }

      backlogDiv.append(duplicateOf);
    })();

    (function urls() {
      if (!foundData.urls) return;
      if (backlogDiv.querySelector('[data-backlog="urls"]')) return;

      const existingURLs = performerUrls ?? [];

      const pendingURLs = document.createElement('div');
      pendingURLs.dataset.backlog = 'urls';
      pendingURLs.classList.add('mb-1', 'p-1');

      const label = document.createElement('span');
      label.classList.add('fw-bold');
      label.innerText = 'This performer has pending URLs:';
      pendingURLs.appendChild(label);

      const expectedName = foundData.name.replace(/\[(?<! )/, '(').replace(/\]$/, ')');
      const performerName =
        /** @type {HTMLElement[]} */
        (Array.from(performerInfo.querySelectorAll('h3 > span, h3 > small')))
          .map(e => e.innerText).join(' ');
      if (performerName !== expectedName) {
        const unexpectedName = document.createElement('div');
        unexpectedName.classList.add('bg-danger', 'fw-bold');
        setStyles(unexpectedName, { marginLeft: '1.75rem', padding: '.15rem .25rem', width: 'fit-content' });
        unexpectedName.innerText = `Unexpected performer name - expected "${expectedName}"`;
        pendingURLs.append(unexpectedName);
      }

      if (foundData.urls_notes && foundData.urls_notes.length > 0) {
        const notesDiv = document.createElement('div');
        setStyles(notesDiv, { marginLeft: '1.75rem', whiteSpace: 'pre-wrap' });
        notesDiv.classList.add('fw-normal');
        notesDiv.append('📝 ', (foundData.urls_notes || []).join('\n'));
        pendingURLs.appendChild(notesDiv);
      }

      if (foundData.urls.every((url) => existingURLs.includes(url))) {
        pendingURLs.append(
          document.createElement('br'),
          'All pending URLs have been added, mark as done on the backlog sheet.',
        );
      }

      foundData.urls.forEach((url) => {
        const container = document.createElement('div');
        container.style.marginLeft = '1.75rem';
        const a = makeLink(url, undefined, { color: 'var(--bs-teal)' });
        a.target = '_blank';
        if (existingURLs.includes(url)) {
          a.classList.add('text-decoration-line-through', 'text-muted');
          container.prepend('✔ ');
        }
        container.appendChild(a);
        pendingURLs.appendChild(container);
      });

      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '🔗';
      pendingURLs.prepend(emoji);
      backlogDiv.append(pendingURLs);
    })();

    // const markerDataset = performerInfo.dataset;
    // if (markerDataset.backlogInjected) {
    //   console.debug('[backlog] already injected');
    // }

    // markerDataset.backlogInjected = 'true';
  } // iPerformerPage

  // =====

  /**
   * @param {string} performerId
   */
  async function iPerformerEditPage(performerId) {
    const pageTitle = /** @type {HTMLHeadingElement} */ (await elementReadyIn('h3', 1000));
    if (!pageTitle) return;

    const markerDataset = pageTitle.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected, skipping');
      return;
    } else {
      markerDataset.backlogInjected = 'true';
    }

    const found = getDataFor('performers', performerId);
    if (!found || !found.urls) return;
    console.debug('[backlog] found', found);

    const performerForm = /** @type {HTMLFormElement} */ (document.querySelector('.PerformerForm'));

    (function submittedWarning() {
      if (!isSubmitted('performers', performerId)) return;

      const editsLink = makeLink(`/performers/${performerId}#edits`, 'double-check');
      editsLink.classList.add('fw-bold', 'text-decoration-underline');

      const warning = document.createElement('h3');
      warning.classList.add('text-center', 'w-75', 'py-2', 'bg-gradient', 'bg-primary');
      warning.append(
        'This backlog entry (or parts of it) may have already been submitted, ',
        document.createElement('br'),
        'please ', editsLink, ' before submitting an edit.',
      );

      performerForm.prepend(warning);
      removeHook(warning, 'performers', performerId);
    })();

    const pendingChangesContainer = document.createElement('div');
    pendingChangesContainer.classList.add('PendingChanges');
    setStyles(pendingChangesContainer, { position: 'absolute', top: '6rem', right: '1vw', width: '24vw' });
    const pendingChangesTitle = document.createElement('h3');
    pendingChangesTitle.innerText = 'Backlogged Changes';
    pendingChangesContainer.appendChild(pendingChangesTitle);
    const pendingChanges = document.createElement('dl');
    pendingChangesContainer.appendChild(pendingChanges);

    performerForm.append(pendingChangesContainer);

    const dtLinks = document.createElement('dt');
    dtLinks.innerText = 'urls';
    dtLinks.id = `backlog-pending-urls-title`;
    pendingChanges.appendChild(dtLinks);

    const ddLinks = document.createElement('dd');
    ddLinks.id = `backlog-pending-urls`;
    pendingChanges.appendChild(ddLinks);

    /** @type {(() => void)[]} */
    const addAll = [];

    found.urls.forEach((url) => {
      const site = (new URL(url)).hostname.replace(/^www\.|\.[a-z]{3}$/ig, '');
      const container = document.createElement('div');
      const set = document.createElement('a');
      set.innerText = `add ${site} link`;
      set.classList.add('fw-bold');
      setStyles(set, { color: 'var(--bs-yellow)', cursor: 'pointer' });
      const addFunc = () => addSiteURL(site, url, true);
      set.addEventListener('click', addFunc);
      addAll.push(addFunc);
      container.append(set, ':');
      const link = makeLink(url);
      link.classList.add('text-truncate', 'd-block', 'ms-2');
      container.appendChild(link);
      ddLinks.appendChild(container);
    });

    const set = document.createElement('a');
    set.innerText = 'add all';
    setStyles(set, { marginLeft: '.5rem', color: 'var(--bs-yellow)', cursor: 'pointer' });
    set.addEventListener('click', () => addAll.forEach((f) => f()));
    dtLinks.innerText += ':';
    dtLinks.append(set);

    pendingChanges.append(dtLinks, ddLinks);
  }

  // =====

  /**
   * @param {string} performerId
   */
   async function iPerformerMergePage(performerId) {
    const performerMerge = /** @type {HTMLDivElement} */ (await elementReadyIn('.PerformerMerge', 1000));
    if (!performerMerge) return;

    const performerSelect = /** @type {HTMLDivElement} */ (performerMerge.querySelector('.PerformerSelect'));

    /** @type {HTMLDivElement} */
    let backlogDiv = (document.querySelector('.performer-backlog'));
    if (!backlogDiv) {
      backlogDiv = document.createElement('div');
      backlogDiv.classList.add('performer-backlog', 'mb-2');
      setStyles(backlogDiv, {
        maxWidth: 'max-content',
        minWidth: 'calc(50% - 15px)',
        transition: 'background-color .5s',
      });
      const target = performerMerge.querySelector(':scope > .row > .col-6:last-child');
      target.append(backlogDiv);
      removeHook(backlogDiv, 'performers', performerId);

      performerSelect.addEventListener('mouseover', () => {
        backlogDiv.style.backgroundColor = '#8c2020';
      });
      performerSelect.addEventListener('mouseout', () => {
        backlogDiv.style.backgroundColor = '';
      });
    }

    const foundData = getDataFor('performers', performerId);
    if (!foundData) return;
    console.debug('[backlog] found', foundData);

    (async function submittedWarning() {
      if (!isSubmitted('performers', performerId)) return;

      await elementReady('.PerformerForm', performerMerge);

      const editsLink = makeLink(`/performers/${performerId}#edits`, 'double-check');
      editsLink.classList.add('fw-bold', 'text-decoration-underline');

      const warning = document.createElement('h3');
      warning.classList.add('text-center', 'w-75', 'py-2', 'bg-gradient', 'bg-primary');
      warning.append(
        'This backlog entry (or parts of it) may have already been submitted, ',
        document.createElement('br'),
        'please ', editsLink, ' before submitting an edit.',
      );

      performerMerge.prepend(warning);
      removeHook(warning, 'performers', performerId);
    })();

    const isMarkedForSplit = (/** @type {string} */ uuid) => {
      const dataEntry = Cache.data.performers[uuid];
      return dataEntry && !!dataEntry.split;
    };

    /** @type {string[]} */
    const profiles = [];

    (function duplicates() {
      if (!foundData.duplicates) return;
      if (backlogDiv.querySelector('[data-backlog="duplicates"]')) return;

      const { ids, notes } = foundData.duplicates;

      /** @param {string} uuid */
      const addPerformer = async (uuid) => {
        /** @type {HTMLInputElement} */
        const fieldEl = (performerSelect.querySelector('input'));
        setNativeValue(fieldEl, uuid);
        const result = /** @type {HTMLDivElement | null} */ (await elementReadyIn('.react-select__option', 2000, performerSelect));
        if (result) result.click();
        else alert('failed to add performer');
      };

      const hasDuplicates = document.createElement('div');
      hasDuplicates.dataset.backlog = 'duplicates';
      hasDuplicates.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This performer has duplicates:';
      hasDuplicates.appendChild(label);

      const linksSpan = document.createElement('span');

      const infoSpan = document.createElement('span');
      setStyles(infoSpan, { marginLeft: '1.75rem', whiteSpace: 'pre-wrap' });
      infoSpan.classList.add('d-inline-block', 'fw-normal');

      (notes || []).forEach((note) => {
        if (/^https?:/.test(note)) {
          const siteName = getSiteName(note);
          const link = makeLink(note, `[${siteName}]`, { color: 'var(--bs-yellow)' });
          link.classList.add('ms-1');
          link.title = note;
          linksSpan.appendChild(link);
          profiles.push(note);
        } else {
          infoSpan.append((infoSpan.textContent ? '\n' : '') + note);
        }
      });

      if (linksSpan.textContent) {
        label.after(linksSpan);
      }

      if (infoSpan.textContent) {
        infoSpan.prepend('📝 ');
        hasDuplicates.append(document.createElement('br'), infoSpan);
      }

      ids.forEach((dupId) => {
        hasDuplicates.append(document.createElement('br'));

        const add = document.createElement('span');
        setStyles(add, { marginLeft: '1.5rem', marginRight: '0.5rem', cursor: 'pointer' });
        add.innerText = '\u{2795}'; // ➕
        add.addEventListener('click', () => {
          addPerformer(dupId);
        });
        hasDuplicates.append(add);

        const a = makeLink(`/performers/${dupId}`, dupId, { color: 'var(--bs-teal)' });
        a.target = '_blank';
        a.classList.add('fw-normal');
        hasDuplicates.append(a);

        if (isMarkedForSplit(dupId)) a.after(' 🔀 needs to be split up');
      });
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      hasDuplicates.prepend(emoji);
      backlogDiv.append(hasDuplicates);
    })();

    (function duplicateOf() {
      if (!foundData.duplicate_of) return;
      if (backlogDiv.querySelector('[data-backlog="duplicate-of"]')) return;

      const duplicateOf = document.createElement('div');
      duplicateOf.dataset.backlog = 'duplicate-of';
      duplicateOf.classList.add('mb-1', 'p-1', 'fw-bold');

      const label = document.createElement('span');
      label.innerText = 'This performer is a duplicate of: ';
      duplicateOf.appendChild(label);

      const a = makeLink(`/performers/${foundData.duplicate_of}`, foundData.duplicate_of, { color: 'var(--bs-teal)' });
      a.target = '_blank';
      a.classList.add('fw-normal');
      duplicateOf.append(a);
      if (isMarkedForSplit(foundData.duplicate_of)) a.after(' 🔀 needs to be split up');
      const emoji = document.createElement('span');
      emoji.classList.add('me-1');
      emoji.innerText = '♊';
      duplicateOf.prepend(emoji);

      const mainData = getDataFor('performers', foundData.duplicate_of);
      if (mainData && mainData.duplicates.notes?.length > 0) {
        const notesDiv = document.createElement('div');
        setStyles(notesDiv, { marginLeft: '1.75rem', whiteSpace: 'pre-wrap' });
        notesDiv.classList.add('fw-normal');
        notesDiv.append('📝 ', mainData.duplicates.notes.filter((note) => !/^https?:/.test(note)).join('\n'));
        duplicateOf.appendChild(notesDiv);
      }

      backlogDiv.append(duplicateOf);
    })();

    (async function profileUrls() {
      if (!foundData.duplicates) return;

      await elementReady('.PerformerForm', performerMerge);

      const duplicatesDiv = backlogDiv.querySelector('[data-backlog="duplicates"]');
      duplicatesDiv.remove();

      const list = document.createElement('ul');
      setStyles(list, {
        listStyle: 'square inside',
        paddingLeft: '0.5rem',
      });

      const urls = foundData.urls || [];
      urls.forEach((url) => {
        const site = (new URL(url)).hostname.replace(/^www\.|\.[a-z]{3}$/ig, '');
        const li = document.createElement('li');
        const set = document.createElement('a');
        set.innerText = `add ${site} profile link`;
        set.classList.add('fw-bold');
        setStyles(set, { color: 'var(--bs-yellow)', cursor: 'pointer' });
        set.addEventListener('click', () => addSiteURL(site, url, true));
        li.append(set, ':');
        const link = makeLink(url);
        link.classList.add('text-truncate', 'd-block', 'ms-4');
        li.appendChild(link);
        list.appendChild(li);
      });

      profiles.filter((u) => !urls.includes(u)).forEach((url) => {
        /** @type {string} */
        let site;
        if (/iafd\.com\/person\.rme\/perfid=/.test(url)) {
          site = 'IAFD';
        } else if (/indexxx\.com\/m\//.test(url)) {
          site = 'Indexxx';
        } else if (/thenude\.com\/.*?_\d+.htm/.test(url)) {
          site = 'theNude';
        } else if (/data18\.com\/pornstars\/.+/.test(url)) {
          site = 'DATA18';
        } else {
          return;
        }
        const li = document.createElement('li');
        const set = document.createElement('a');
        set.innerText = `add ${site} profile link`;
        set.classList.add('fw-bold');
        setStyles(set, { color: 'var(--bs-yellow)', cursor: 'pointer' });
        set.addEventListener('click', () => addSiteURL(site, url, true));
        li.append(set, ':');
        const link = makeLink(url);
        link.classList.add('text-truncate', 'd-block', 'ms-4');
        li.appendChild(link);
        list.appendChild(li);
      });

      if (foundData.duplicates.notes?.length > 0) {
        const notesDiv = document.createElement('div');
        setStyles(notesDiv, { whiteSpace: 'pre-wrap' });
        notesDiv.append('📝 ', foundData.duplicates.notes.filter((note) => !/^https?:/.test(note)).join('\n'));
        backlogDiv.appendChild(notesDiv);
      }

      backlogDiv.appendChild(list);
  })();

  } // iPerformerMergePage

  // =====

  /**
   * @param {string} studioId
   */
  async function iStudioPage(studioId) {
    const studioInfo = /** @type {HTMLDivElement} */ (await elementReadyIn('.studio-title', 2000));
    if (!studioInfo) {
      console.error('[backlog] studio info not found');
      return;
    }

    highlightSceneCards('studios');

    const studioName =
      /** @type {HTMLSpanElement} */
      (studioInfo.querySelector(':scope > h3 > span'))?.innerText?.trim();
    const parentName =
      /** @type {HTMLSpanElement} */
      (studioInfo.querySelector(':scope > span:last-child a'))?.innerText || null;

    if (!studioName) {
      console.error('[backlog] studio name not found');
      return;
    }

    /** @type {HTMLDivElement} */
    let backlogDiv = (document.querySelector('.studio-backlog'));
    if (!backlogDiv) {
      backlogDiv = document.createElement('div');
      backlogDiv.classList.add('studio-backlog');
      setStyles(backlogDiv, {
        maxWidth: 'max-content',
        minWidth: 'calc(50% - 15px)',
        transition: 'background-color .5s',
      });
      studioInfo.parentElement.before(backlogDiv);
      removeHook(backlogDiv, 'scenes', studioId);
    }

    // Performer scene changes based on cached data
    (function sceneChanges() {
      if (backlogDiv.querySelector('[data-backlog="scene-changes"]')) return;

      try {
        /** @param {SceneDataObject["c_studio"]} current */
        const compare = ([name, parent]) =>
          name.localeCompare(studioName, undefined, { sensitivity: 'base' }) === 0
          && (
            parent === null
            || (parentName && parent.localeCompare(parentName, undefined, { sensitivity: 'base' }) === 0)
          );

        const studioScenes = Object.entries(Cache.data.scenes)
          .filter(([, scene]) => !!scene.c_studio && compare(scene.c_studio));

        if (studioScenes.length === 0) return;

        const sceneChanges = document.createElement('div');
        sceneChanges.dataset.backlog = 'scene-changes';
        sceneChanges.classList.add('mb-1', 'p-1', 'fw-bold');
        sceneChanges.innerText = 'This studio has scenes with pending changes:';

        const details = document.createElement('details');
        details.style.marginLeft = '1.5rem';
        const summary = document.createElement('summary');
        setStyles(summary, { color: 'tan', width: 'max-content' });
        summary.innerText = `${studioScenes.length} scene${studioScenes.length === 1 ? '' : 's'}`;
        details.append(summary);

        const scenesList = document.createElement('ol');
        scenesList.classList.add('mb-0');
        setStyles(scenesList, { paddingLeft: '2rem', fontWeight: 'normal' });
        details.append(scenesList);

        renderScenesList(studioScenes, scenesList, 'studios');

        sceneChanges.append(details);

        const emoji = document.createElement('span');
        emoji.classList.add('me-1');
        emoji.innerText = '📹';
        sceneChanges.prepend(emoji);
        backlogDiv.prepend(sceneChanges);
      } catch (error) {
        console.error(error);
      }
    })();

  } // iStudioPage

  // =====

  async function iHomePage() {
    if (document.querySelector('.MainContent .LoadingIndicator')) {
      await Promise.all([
        elementReadyIn(`.HomePage-scenes:nth-of-type(1) .SceneCard`, 2000),
        elementReadyIn(`.HomePage-scenes:nth-of-type(2) .SceneCard`, 2000),
      ]);
    } else {
      await elementReadyIn(`.HomePage-scenes .SceneCard`, 2000);
    }
    return await highlightSceneCards();
  } // iHomePage

  // =====

  async function iSearchPage() {
    const selector = 'a.SearchPage-scene, a.SearchPage-performer';
    const isLoading = !!document.querySelector('.LoadingIndicator');
    if (!await elementReadyIn(selector, isLoading ? 5000 : 2000)) {
      console.debug('[backlog] no scene/performer search results found, skipping');
      return;
    }

    /** @type {HTMLAnchorElement[]} */
    (Array.from(document.querySelectorAll(selector))).forEach((cardLink) => {
      const markerDataset = cardLink.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = 'true';

      const { object, ident: uuid } = parsePath(cardLink.href);
      if (!isSupportedObject(object)) return;

      const found = getDataFor(object, uuid);
      const changes = dataObjectKeys(found || {});
      if (object === 'performers') {
        if (Cache.performerScenes(uuid).length > 0)
          changes.push('scenes');

        /** @type {{ urls: ScenePerformance_URL[] }} */
        const performerFiber = getReactFiber(cardLink)?.return?.return?.return?.return?.memoizedProps?.performer;
        const urls = performerFiber?.urls.map((u) => u.url) || [];
        const { fragmentIndexMap: fragments } = getPerformerFragments({ performerId: uuid, urls });
        if (Object.keys(fragments).length > 0)
          changes.push('fragments');
      }

      if (changes.length === 0)
        return;

      if (changes) {
        const card = /** @type {HTMLDivElement} */ (cardLink.querySelector(':scope > .card'));
        card.style.outline = getHighlightStyle(object, changes);
        if (object === 'scenes') {
          const sceneChanges = /** @type {ObjectKeys["scenes"][]} */ (changes);
          cardLink.title = `<pending> changes to:\n - ${sceneChanges.join('\n - ')}\n(click scene to view changes)`;
          sceneCardHighlightChanges(card, sceneChanges, uuid);
        } else if (object === 'performers') {
          cardLink.title = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
        }
      }
    });
  } // iSearchPage

  // =====

  /**
   * @template {SupportedObject} T
   * @param {T} object
   * @param {ObjectKeys[T][]} changes
   * @returns {string}
   */
  const getHighlightStyle = (object, changes) => {
    const style = '0.4rem solid';
    if (changes.length === 1) {
      if (changes[0] === 'duplicate_of' || changes[0] === 'duplicates') {
        return `${style} var(--bs-pink)`;
      }
      if (changes[0] === 'fingerprints' || changes[0] === 'urls') {
        return `${style} var(--bs-cyan)`;
      }
      if (changes[0] === 'scenes') {
        return `${style} var(--bs-green)`;
      }
    }
    return `${style} var(--bs-yellow)`;
  }

  /** @param {AnyObject} [object] */
  async function highlightSceneCards(object) {
    const selector = '.SceneCard:not([data-backlog-injected])';
    const isLoading = !!document.querySelector('.LoadingIndicator');
    if (!await elementReadyIn(selector, isLoading ? 5000 : 2000)) {
      console.debug('[backlog] no scene cards found, skipping');
      return;
    }

    /** @param {HTMLDivElement} card */
    const appendScenePerformers = (card) => {
      if (!settings.sceneCardPerformers) return;

      /** @type {ScenePerformance} */
      const data = getReactFiber(card)?.return?.return?.memoizedProps?.scene;
      if (data && data.performers) {
        const { performers } = data;
        const info = document.createElement('div');
        info.classList.add('backlog-scene-performers', 'mt-1', 'text-muted', 'border-top', 'line-clamp');
        info.style.setProperty('--line-clamp', '3');
        const { svg: icon } = performersIcon();
        icon.classList.add('me-1');
        info.append(icon);
        const performerId = object === 'performers' ? parsePath().ident : null;
        performers.forEach((p, i) => {
          const name = p.performer.name + (p.performer.disambiguation ? ` [${p.performer.disambiguation}]` : '');
          const label = p.as ? `${p.as} (${name})` : name;
          /** @type {HTMLAnchorElement | HTMLSpanElement} */
          let pa;
          if (performerId && p.performer.id === performerId) {
            pa = document.createElement('span');
            pa.innerText = label;
            pa.classList.add('fw-bold');
          } else {
            pa = makeLink(`/performers/${p.performer.id}`, label);
          }
          if (i > 0) info.append(' | ', pa);
          else info.appendChild(pa);
        });
        card.querySelector('.card-footer').appendChild(info);
      }
    };

    const highlight = () => {
      /** @type {HTMLDivElement[]} */
      (Array.from(document.querySelectorAll(selector))).forEach((card) => {
        const markerDataset = card.dataset;
        if (markerDataset.backlogInjected) return;
        else markerDataset.backlogInjected = 'true';

        appendScenePerformers(card);

        const sceneId = parsePath(card.querySelector('a').href).ident;
        const found = Cache.data.scenes[sceneId];
        if (!found) return;
        card.classList.add('backlog-highlight');
        const changes = dataObjectKeys(found);
        card.style.outline = getHighlightStyle('scenes', changes);
        card.title = `<pending> changes to:\n - ${changes.join('\n - ')}\n(click scene to view changes)`;

        sceneCardHighlightChanges(card, changes, sceneId);
      });
    };

    highlight();

    if (object === 'performers' && document.querySelector('.scenes-list')) {
      const studioSelectorValue = document.querySelector(
        '.PerformerScenes > .CheckboxSelect > .react-select__control > .react-select__value-container'
      );
      new MutationObserver(async (mutations, observer) => {
        console.debug('[backlog] detected change in performers studios selector, re-highlighting scene cards');
        await elementReadyIn('.LoadingIndicator', 100);
        if (!await elementReadyIn(selector, 2000)) return;
        highlight();
      }).observe(studioSelectorValue, { childList: true, subtree: true });
    }
  }

  async function highlightPerformerCards() {
    const selector = '.PerformerCard';
    const isLoading = !!document.querySelector('.LoadingIndicator');
    if (!await elementReadyIn(selector, isLoading ? 5000 : 2000)) {
      console.debug('[backlog] no performer cards found, skipping');
      return;
    }

    /** @type {HTMLDivElement[]} */
    (Array.from(document.querySelectorAll(selector))).forEach((card) => {
      const markerDataset = card.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = 'true';

      const performerId = parsePath(card.querySelector('a').href).ident;
      const found = Cache.data.performers[performerId];
      const changes = dataObjectKeys(found || {});
      if (Cache.performerScenes(performerId).length > 0)
        changes.push('scenes');
      /** @type {{ urls: ScenePerformance_URL[] }} */
      const performerFiber = getReactFiber(card)?.return?.return?.memoizedProps?.performer;
      const urls = performerFiber?.urls?.map((u) => u.url) || [];
      const { fragmentIndexMap: fragments } = getPerformerFragments({ performerId, urls });
      if (Object.keys(fragments).length > 0)
        changes.push('fragments');
      if (changes.length === 0)
        return;
      card.style.outline = getHighlightStyle('performers', changes);
      const info = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
      card.title = info;
      /** @type {HTMLImageElement} */
      (card.querySelector('.PerformerCard-image > img')).title += `\n\n${info}`;
    });
  }

  /**
   * Field-specific scene card highlighting
   * @param {HTMLDivElement} card
   * @param {ObjectKeys["scenes"][]} changes
   * @param {string} sceneId
   */
  function sceneCardHighlightChanges(card, changes, sceneId) {
    if (!(isDev || settings.sceneCardHighlightChanges)) return;

    const parent = /** @type {HTMLDivElement | HTMLAnchorElement} */ (card.parentElement);
    const isSearchCard = parent.classList.contains('SearchPage-scene');

    if (changes.includes('image')) {
      /** @type {HTMLImageElement} */
      const img = card.querySelector(
        !isSearchCard
          ? '.SceneCard-image > img'
          : ':scope > img.SearchPage-scene-image'
      );
      const imageSrc = img.getAttribute('src');
      setStyles(img, {
        color: `var(--bs-${imageSrc ? 'danger' : 'success'})`,
        background: ['left', 'right']
          .map((d) => `linear-gradient(to ${d} top, transparent 47.75%, currentColor 49.5% 50.5%, transparent 52.25%)`)
          .concat(`url('${imageSrc}') no-repeat top / cover`)
          .join(', '),
      });
      // set transparent source
      img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
    }

    const color = 'var(--bs-yellow)';

    if (changes.includes('title')) {
      if (!isSearchCard) {
        /** @type {HTMLHeadingElement} */
        const title = card.querySelector('h6');
        if (title.textContent) {
          title.style.color = color;
        } else {
          setStyles(title, { backgroundColor: color, height: '1.2rem' });
          const duration = /** @type {HTMLSpanElement} */ (title.parentElement.nextElementSibling);
          if (!duration.innerText && !changes.includes('duration'))
            duration.style.minWidth = '2rem';
        }
      } else {
        /** @type {HTMLHeadingElement} */
        const titleEl = card.querySelector('h5');
        const titleNode = /** @type {Text} */ (titleEl.childNodes[0]);
        const title = document.createElement('span');
        title.append(titleNode);
        titleEl.prepend(title);
        if (title.textContent) {
          title.style.color = color;
        } else {
          setStyles(title, { backgroundColor: color, display: 'inline-block', height: '1.5rem', width: '70%' });
        }
      }
    }

    if (changes.includes('duration')) {
      /** @type {HTMLSpanElement | HTMLElement} */
      const duration = card.querySelector(
        !isSearchCard
          ? '.card-footer span.text-muted'
          : 'h5 > small'
      );
      if (duration.textContent) {
        duration.style.color = color;
      } else {
        duration.textContent = '??:??';
        duration.style.color = color;
        duration.classList.remove('text-muted');
      }
    }

    if (changes.includes('studio')) {
      const studio =
        !isSearchCard
          ? /** @type {HTMLAnchorElement} */ (card.querySelector('.SceneCard-studio-name'))
          : card.querySelector('div > svg[data-icon="video"]').parentElement;
      studio.style.color = color;
    }

    if (changes.includes('date')) {
      const date =
        !isSearchCard
          ? card.querySelector('strong')
          : card.querySelector('div > svg[data-icon="calendar"]').parentElement;
      date.style.color = color;
    }

    if (changes.includes('performers')) {
      if (!isSearchCard) {
        const { div: iconDiv, svg: icon } = performersIcon();
        setStyles(iconDiv, { flex: '1', position: 'relative', marginTop: 'auto' });
        setStyles(icon, {
          color,
          fontSize: '2em',
          position: 'absolute',
          left: '4px',
          bottom: '4px',
          filter: 'drop-shadow(3px 3px 2px rgba(0, 0, 0, .7))',
        });
        card.querySelector('.SceneCard-image').prepend(iconDiv);

        const { object, ident: performerId } = parsePath();
        if (object === 'performers' && performerId) {
          const { performers } = getDataFor('scenes', sceneId);
          const thisPerformer = Object.values(performers).flat().find((p) => p.id === performerId);
          if (!thisPerformer) {
            icon.style.color = '';
          }
        }
      } else {
        const icon = card.querySelector('div > svg[data-icon="users"]');
        const performers = icon ? icon.parentElement : document.createElement('div');
        performers.style.color = color;
        if (!icon) {
          performers.innerText = '???';
          performers.prepend(performersIcon().svg);
          card.querySelector('h5 + div').append(performers);
        }
      }
    }
  }

  async function iEditCards() {
    const selector = '.EditCard';
    const isLoading = !!document.querySelector('.LoadingIndicator');
    if (!await elementReadyIn(selector, isLoading ? 5000 : 2000)) return;

    /**
     * @param {string} editUrl
     * @param {string[]} urls
     */
    const editPendingScenes = (editUrl, urls) =>
      Object.entries(Cache.data.scenes).filter(([, { performers }]) =>
        performers?.append.some(({ status, status_url, notes }) => {
          // by edit url
          if (status === 'c' && status_url === editUrl)
            return true;
          // by urls
          if (status === 'new') {
            const backlogUrls = (notes || []).filter((u) => /https?:\/\//.test(u));
            if (status_url)
              backlogUrls.splice(0, 0, status_url);
            return urls.some((url) => backlogUrls.includes(url));
          }
          return false;
        })
      );

    /** @param {HTMLDivElement} cardBody */
    const handleFingerprints = (cardBody) => {
      /** @type {HTMLAnchorElement[]} */
      const fingerprintLinks = Array.from(cardBody.querySelectorAll('.ListChangeRow-Fingerprints a'));
      /** @type {Array<Required<Omit<SceneFingerprint, "correct_scene_id"> & { el: HTMLElement }>>} */
      const editFingerprints = fingerprintLinks.map((el) => {
        const [algorithm, hash] = el.innerText.trim().split(': ');
        const durationEl = /** @type {HTMLSpanElement} */ (el.nextElementSibling);
        return {
          algorithm: /** @type {FingerprintAlgorithm} */ (algorithm.toLowerCase()),
          hash,
          duration: Number(durationEl.title.replace(/s$/, '')),
          el,
        };
      });

      Object.entries(Cache.data.scenes).forEach(([, { fingerprints }]) =>
        fingerprints?.forEach((fp) => {
          const match = editFingerprints.find((efp) =>
            fp.algorithm === efp.algorithm &&
            ((fp.algorithm === 'phash' && hammingDistance(fp.hash, efp.hash) <= 4) || fp.hash === efp.hash)
            && (!fp.duration || Math.abs(efp.duration - fp.duration) <= 5)
          );
          if (!match) return;
          const distance = fp.algorithm === 'phash' ? hammingDistance(fp.hash, match.hash) : undefined;
          match.el.classList.add('fw-bold');
          setStyles(match.el, {
            backgroundColor: 'var(--bs-indigo)',
            padding: '.2rem',
            maxWidth: 'max-content',
          });
          match.el.title = `Fingerprint is reported as incorrect` + (
            fp.algorithm === 'phash'
              ? `\nPHash distance: ${distance ? `${distance} to ${fp.hash}` : 'exact'}`
              : ''
          );
        })
      );
    };

    /**
     * @param {HTMLAnchorElement} entityLink
     * @param {EditTargetType} editEntity
     */
    const handleEntityLink = (entityLink, editEntity) => {
      const { ident, object } = parsePath(entityLink.href);
      if (!isSupportedObject(object)) return;
      const type = object.slice(0, -1);

      const found = getDataFor(object, ident);
      const changes = dataObjectKeys(found || {});

      if (object === 'performers') {
        if (Cache.performerScenes(ident).length > 0)
          changes.push('scenes');

        // FIXME: getPerformerFragments is too heavy for the edits pages
        //        optimize, we only need number of fragments
        if (false) { // disabled section
        /** @type {string[]} */
        const urls = (() => {
          /** @type {HTMLDivElement} */
          const changeRow = entityLink.closest('.ListChangeRow-Performers');
          if (!changeRow) return [];
          const { added, removed } = getReactFiber(changeRow)?.return?.return?.memoizedProps;
          const performerFiber =
            /** @type {{ performer: { id: string; urls: ScenePerformance_URL[] } }[]} */
            (added || removed || [])
              .map(({ performer }) => performer).find(({ id }) => id === ident);
          return performerFiber?.urls?.map((u) => u.url) || [];
        })();
        const { fragmentIndexMap: fragments } = getPerformerFragments({ performerId: ident, urls });
        if (Object.keys(fragments).length > 0)
          changes.push('fragments');
        } // disabled section
      }

      if (changes.length === 0)
        return;

      let backgroundColor = 'var(--bs-warning)';
      if (changes.length === 1) {
        if (changes[0] === 'scenes') {
          backgroundColor = 'var(--bs-green)';
        }
        if (changes[0] === 'fragments') {
          backgroundColor = 'var(--bs-blue)';
        }
        if (changes[0] === 'fingerprints' || changes[0] === 'urls') {
          backgroundColor = 'var(--bs-indigo)';
        }
      }

      const scenePerformer = object === 'performers' && editEntity === 'scene';
      entityLink.classList.add('fw-bold', 'd-inline-block');
      setStyles(entityLink, {
        backgroundColor,
        padding: scenePerformer ? '0.05rem 0.25rem' : '.2rem',
        maxWidth: 'max-content',
      });
      entityLink.title = `${type} is listed for:\n - ${changes.join('\n - ')}\n(click ${type} for more info)`;
    };

    /**
     * @template {Element} E
     * @param {E | undefined} v
     * @returns {E[]}
     */
    const makeArray = (v) => Array.isArray(v) ? v : [v].filter(Boolean);

    /**
     * @param {EditOperation} operation
     * @param {HTMLDivElement} body
     * @returns {HTMLAnchorElement[]}
     */
    const selectTargetLinks = (operation, body) => {
      switch (operation) {
        case 'create':
        case 'modify':
        case 'destroy':
          return makeArray(body.querySelector(':scope > .row:first-child a'));
        case 'merge':
          return Array.from(body.querySelectorAll(':scope > .row:first-child .row:nth-child(-n+2) a'));
        default:
          return [];
      }
    };

    const isEditsList = !!document.querySelector('ul.pagination');
    const cards = /** @type {HTMLDivElement[]} */ (Array.from(document.querySelectorAll(selector)));
    for (const card of cards) {
      /** @type {HTMLHeadingElement} */
      const cardHeading = card.querySelector('.card-header h5');
      const [operation, entity] =
        /** @type {[EditOperation, EditTargetType]} */
        (cardHeading.textContent.split(' ', 2));
      /** @type {HTMLDivElement} */
      const cardBody = card.querySelector('.card-body');

      const targetLinks = selectTargetLinks(operation, cardBody);
      if (targetLinks.length === 0 && operation !== 'create') {
        console.error(`${operation} edit target link(s) not found`, cardBody);
      }
      targetLinks.forEach((el) => handleEntityLink(el, entity));

      if (entity === 'scene') {
        /** @type {HTMLAnchorElement[]} */
        const performerLinks = Array.from(cardBody.querySelectorAll('.ListChangeRow-Performers a'));
        if (performerLinks.length > 0) {
          performerLinks.forEach((el) => handleEntityLink(el, entity));
        }

        handleFingerprints(cardBody);
      }

      if (entity === 'performer' && operation !== 'destroy') {
        const backlogDiv = document.createElement('div');
        backlogDiv.classList.add('performer-backlog', 'mb-4', 'pb-3', 'border-bottom');

        const editUrl = cardHeading.closest('a').href;
        const urls = /** @type {HTMLAnchorElement[]} */
          (Array.from(card.querySelectorAll('.SiteLink + a'))).map((a) => a.href);
        /** @type {HTMLDivElement[]} */
        (Array.from(card.querySelectorAll('.EditComment > .card-body')))
          .flatMap((cEl) => cEl.textContent.match(/(https?:\/\/[^\s]+)/g) ?? [])
          .forEach((cUrl) => {
            if (!validFragmentLink(cUrl)) return;
            // simple unique sites
            if (!urls.find((u) => u.startsWith(new URL(cUrl).origin)))
              urls.push(cUrl);
          });

        (function fragments() {
          const { performerFragments, fragmentIndexMap } = getPerformerFragments({ urls });
          if (performerFragments.length === 0) return;

          (function possibleExistingPerformers() {
            /** @type {{ url: string, id: string, name: string }[]} */
            let existingPerformers = [];
            performerFragments.forEach(([pId, data]) => {
              const { fragments } = data.split;
              for (const fragmentIndex of fragmentIndexMap[pId]) {
                const fragment = fragments[fragmentIndex];
                if (fragment.id)
                  existingPerformers.push({
                    url: `/performers/${fragment.id}`,
                    id: fragment.id,
                    name: fragment.name,
                  });
                fragment.links?.forEach((link) => {
                  if (!link.startsWith('https://stashdb.org/')) return;
                  const loc = parsePath(link);
                  if (loc.object === 'performers' && loc.ident && !loc.action) {
                    existingPerformers.push({
                      url: `/performers/${loc.ident}`,
                      id: loc.ident,
                      name: fragment.name
                    });
                  }
                });
              }
            });

            const targetPerformers = targetLinks.map(({ href }) => (new URL(href)).pathname);
            existingPerformers = existingPerformers.filter((p, i, self) => {
              return !targetPerformers.includes(p.url) && i === self.findIndex(({ url }) => url === p.url);
            });

            if (existingPerformers.length === 0) return;

            const header = document.createElement('h3');
            header.innerHTML = 'Backlog: <b><i>Possible</i></b> existing performers';

            const performersList = document.createElement('ul');
            setStyles(performersList, { paddingLeft: '2rem', fontWeight: 'normal' });

            backlogDiv.append(header, performersList);

            existingPerformers.forEach(({ url, id, name }) => {
              const li = document.createElement('li');
              li.append(
                makeLink(url, name, { color: 'var(--bs-teal)' }),
                ' \u2013 ',
                createSelectAllSpan(id, { fontFamily: 'monospace' }),
              );
              performersList.append(li);
            })
          })();

          const title = `✂ Performer is listed as a fragment for ${performerFragments.length} performer${
            performerFragments.length !== 1 ? 's' : ''} to split up`;
          if (isEditsList) {
            cardHeading.style.backgroundColor = 'var(--bs-success)';
            cardHeading.title = title;
          } else {
            const header = document.createElement('h3');
            header.innerText = `Backlog: ${title}`;

            const performersList = document.createElement('ol');
            setStyles(performersList, { paddingLeft: '2rem', fontWeight: 'normal' });

            backlogDiv.append(header, performersList);

            renderPerformersList(performerFragments, performersList, 'fragments', fragmentIndexMap);
          }
        })();

        const scenes = editPendingScenes(editUrl, urls);
        if (scenes.length > 0) {
          const pendingScenes = `📹 Performer has ${scenes.length} pending scene${scenes.length !== 1 ? 's' : ''}`;
          if (isEditsList) {
            cardHeading.style.backgroundColor = 'var(--bs-success)';
            cardHeading.title = (cardHeading.title ? `${cardHeading.title}\n` : '') + pendingScenes;
          } else {
            const header = document.createElement('h3');
            header.innerText = `Backlog: ${pendingScenes}`;

            const scenesList = document.createElement('ol');
            setStyles(scenesList, { paddingLeft: '2rem', fontWeight: 'normal' });

            backlogDiv.append(header, scenesList);

            renderScenesList(scenes, scenesList, 'edits');
          }
        }

        if (backlogDiv.childElementCount > 0) {
          cardBody.prepend(backlogDiv);
          removeHook(backlogDiv, 'edits', parsePath(editUrl).ident);
        }
      }
    }

  } // iEditCards

  async function iSceneBacklogPage() {
    const main = /** @type {HTMLDivElement} */ (await elementReadyIn('.NarrowPage', 200));
    if (!main) {
      alert('failed to construct backlog page');
      return;
    }

    toggleBacklogInfo(false);
    document.title = `Scene Backlog Summary | ${document.title}`;

    const scenes = document.createElement('div');
    main.appendChild(scenes);

    const scenesHeader = document.createElement('h3');
    scenesHeader.innerText = 'Scenes';
    scenes.appendChild(scenesHeader);

    const subTitle = document.createElement('h5');
    subTitle.innerText = 'Loading...';
    scenes.appendChild(subTitle);

    const desc = document.createElement('p');
    desc.innerText = '';
    scenes.appendChild(desc);

    const scenesList = document.createElement('ol');
    // scenesList.classList.add('ps-2');
    scenes.appendChild(scenesList);

    window.addEventListener(locationChanged, () => scenes.remove(), { once: true });

    await wait(0);

    const allPerformerNames = Object.values(Cache.data.scenes).reduce((result, entry) => {
      if (!entry.performers)
        return result;

      entry.performers.append.forEach((p) => {
        const name = p.name + (p.disambiguation ? ` [${p.disambiguation}]` : '');
        if (!result.includes(name))
          result.push(name);
      });
      return result;
    }, []);

    /** @type {string | null} */
    let performerFilter = null;
    const performerFilterRow = document.createElement('div');
    performerFilterRow.classList.add('d-flex', 'my-1');

    const performerFilterLabel = document.createElement('label');
    performerFilterLabel.innerText = 'Filter by performer name:';
    performerFilterLabel.classList.add('me-2', 'fw-bold');
    performerFilterRow.appendChild(performerFilterLabel);

    const performerFilterSelect = document.createElement('select');
    performerFilterRow.appendChild(performerFilterSelect);

    const opt = document.createElement('option');
    opt.value = '';
    opt.innerText = '[No filter]';
    performerFilterSelect.append(opt);

    allPerformerNames
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'accent' }))
      .forEach((name) => {
        const opt = document.createElement('option');
        opt.value = opt.innerText = name;
        performerFilterSelect.append(opt);
      });

    subTitle.after(performerFilterRow);

    performerFilterSelect.addEventListener('change', () => {
      performerFilter = performerFilterSelect.options[performerFilterSelect.selectedIndex].value || null;
      renderList(performerFilter ? '' : 'full');
    });

    /** @type {(keyof SceneDataObject)[]} */
    const unsubmittableKeys = ['fingerprints'];
    /** @param {string} key */
    const submittableKeys = (key) => !unsubmittableKeys.includes(/** @type {keyof SceneDataObject} */ (key));

    /**
     * @param {SceneEntriesItem[]} result
     * @param {SceneEntriesItem} item
     */
    const reduceKey = (result, item) => {
      const [key, value] = item;
      const { comments, duplicates, duplicate_of, ...rest } = value;
      return dataObjectKeys(rest).filter(submittableKeys).length > 0 ? result.concat([[key, rest]]) : result;
    };
    /** @param {SceneDataObject} item */
    const sortKey = (item) => {
      const performers = item.performers ? Object.values(item.performers).flat().length - 1 : 0;
      return dataObjectKeys(item).length + performers;
    };

    const sortedScenes =
      Object.entries(Cache.data.scenes)
        .reduce(reduceKey, [])
        .sort((a, b) => sortKey(b[1]) - sortKey(a[1]));

    const partiallySubmittable = sortedScenes.filter(([, item]) => {
      // Performers missing ID / having any status
      if (item.performers && Object.values(item.performers).flat().filter((p) => !(p.id && !p.status)).length > 0)
        return true;
      // No studio ID
      if (item.studio && !item.studio[0])
        return true;

      return false;
    });

    const fullySubmittable = sortedScenes.filter((entry) => !partiallySubmittable.includes(entry));

    const scenesForPerformerFilter = () =>
      sortedScenes.filter((entry) => {
        if (!entry[1].performers)
          return false;

        return entry[1].performers.append.some(
          (p) => performerFilter.localeCompare(
            p.name + (p.disambiguation ? ` [${p.disambiguation}]` : ''),
            undefined,
            { sensitivity: 'accent' }
          ) === 0
        );
      });

    /** @param {string} filter */
    const renderList = (filter) => {
      /** @type {NodeListOf<HTMLAnchorElement>} */
      (subTitle.querySelectorAll('a[data-filter]')).forEach((el) => {
        el.classList.toggle('fw-bold', el.dataset.filter === filter);
      });
      subTitle.classList.toggle('d-none', !!performerFilter);

      desc.innerText = (
        'The checkbox marks an entry as "seen" but leaving this page will reset that status.'
        + '\nMarking as "seen" does not do any action.'
      );

      scenesList.innerHTML = '';

      const list = performerFilter
        ? scenesForPerformerFilter()
        : ({
          all: sortedScenes,
          full: fullySubmittable,
          partial: partiallySubmittable,
        })[filter];

      renderScenesList(list, scenesList, null);
    };

    subTitle.innerText = 'Filter entries:';

    ['all', 'full', 'partial'].forEach((filter, i) => {
      const toggle = document.createElement('a');
      toggle.dataset.filter = filter;
      toggle.classList.add('mx-2');
      toggle.href = `#${filter}`;
      toggle.innerText = ({
        all: `all entries (${sortedScenes.length})`,
        full: `fully submittable (${fullySubmittable.length})`,
        partial: `partially submittable (${partiallySubmittable.length})`,
      })[filter];
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const activeFilter = /** @type {HTMLAnchorElement} */ (subTitle.querySelector('a[data-filter].fw-bold'));
        if (filter === activeFilter.dataset.filter)
          return;
        renderList(filter);
      });
      subTitle.append((i > 0 ? '|' : ''), toggle);
    });

    renderList(window.location.hash.slice(1) || 'full');
  } // iSceneBacklogPage

  async function iPerformerBacklogPage() {
    const main = /** @type {HTMLDivElement} */ (await elementReadyIn('.NarrowPage', 200));
    if (!main) {
      alert('failed to construct backlog page');
      return;
    }

    toggleBacklogInfo(false);
    document.title = `Performer Backlog Summary | ${document.title}`;

    const performers = document.createElement('div');
    main.appendChild(performers);

    const performersHeader = document.createElement('h3');
    performersHeader.innerText = 'Performers';
    performers.appendChild(performersHeader);

    const subTitle = document.createElement('h5');
    subTitle.innerText = 'Loading...';
    performers.appendChild(subTitle);

    const desc = document.createElement('p');
    desc.innerText = '';
    performers.appendChild(desc);

    const performersList = document.createElement('ol');
    // performersList.classList.add('ps-2');
    performers.appendChild(performersList);

    window.addEventListener(locationChanged, () => performers.remove(), { once: true });

    await wait(0);

    /** @type {(keyof PerformerDataObject)[]} */
    const unsubmittableKeys = ['name'];
    /** @param {string} key */
    const submittableKeys = (key) => !unsubmittableKeys.includes(/** @type {keyof PerformerDataObject} */ (key));

    /**
     * @param {PerformerEntriesItem[]} result
     * @param {PerformerEntriesItem} item
     */
    const reduceKey = (result, item) => {
      const [key, value] = item;
      const { urls_notes, ...rest } = value;
      return dataObjectKeys(rest).filter(submittableKeys).length > 0 ? result.concat([[key, rest]]) : result;
    };
    /** @param {PerformerDataObject} item */
    const sortKey = (item) => {
      return item.name || item.split?.name || item.duplicates?.name || dataObjectKeys(item).length;
    };

    const sortedPerformers =
      Object.entries(Cache.data.performers)
        .reduce(reduceKey, [])
        .sort((a, b) => {
          const aKey = sortKey(a[1]);
          const bKey = sortKey(b[1]);
          if (typeof bKey === 'string' && typeof aKey === 'string')
            return aKey.localeCompare(bKey, undefined, { sensitivity: 'accent' });
          if (typeof bKey === 'number' && typeof aKey === 'number')
            return bKey - aKey;
          if (typeof aKey === 'string')
            return -1;
          if (typeof bKey === 'string')
            return 1;
          return 0;
        });

    subTitle.innerText = (
      'Note: There is currently no automated check for submitted entries or completed entries.'
      + '\nSome entries need to be merged and/or split, take extra cake with those.'
    );

    desc.innerText = (
      'The checkbox marks an entry as "seen" but leaving this page will reset that status.'
      + '\nMarking as "seen" does not do any action.'
    );

    renderPerformersList(sortedPerformers, performersList, 'simple');

  } // iPerformerBacklogPage

  async function iPerformersSplitReadyFragmentsPage() {
    const main = /** @type {HTMLDivElement} */ (await elementReadyIn('.NarrowPage', 200));
    if (!main) {
      alert('failed to construct backlog page');
      return;
    }

    toggleBacklogInfo(false);
    document.title = `Performers To Split (with ready fragments) | ${document.title}`;

    const performers = document.createElement('div');
    main.appendChild(performers);

    const performersHeader = document.createElement('h3');
    performersHeader.innerText = 'Performers to split with ready fragments';
    performers.appendChild(performersHeader);

    const subTitle = document.createElement('h5');
    subTitle.innerText = 'Loading...';
    performers.appendChild(subTitle);

    const desc = document.createElement('p');
    desc.innerText = '';
    performers.appendChild(desc);

    const performersList = document.createElement('ol');
    // performersList.classList.add('ps-2');
    performers.appendChild(performersList);

    window.addEventListener(locationChanged, () => performers.remove(), { once: true });

    await wait(0);

    /** @type {FragmentIndexMap} */
    const fragmentIndexMap = {};

    /**
     * @param {PerformerEntriesItem[]} result
     * @param {PerformerEntriesItem} item
     */
    const reduceKey = (result, item) => {
      const [key, value] = item;
      if (!value.split) return result;
      const { fragments, notes } = value.split;

      let valid = fragments.filter((fragment, fragmentIndex) => {
        if (fragment.id === null || fragment.id === key) return false;

        // Store fragment index for matching later
        if (!fragmentIndexMap[key])
          fragmentIndexMap[key] = [fragmentIndex];
        else if (!fragmentIndexMap[key].includes(fragmentIndex))
          fragmentIndexMap[key].push(fragmentIndex);

        return true;
      }).length > 0;

      if (!valid && notes?.some((t) => t?.match(/\bcomplete list\b/i))) {
        if (valid = fragments.length <= 1) {
          fragmentIndexMap[key] = [];
          // Store fragment index for matching later
          if (fragments.length === 1) fragmentIndexMap[key].push(0);
        }
      }

      return valid ? result.concat([item]) : result;
    };
    /** @param {PerformerDataObject} item */
    const sortKey = (item) => {
      return item.name || item.split?.name;
    };

    const sortedPerformers =
      Object.entries(Cache.data.performers)
        .reduce(reduceKey, [])
        .sort((a, b) => {
          const aKey = sortKey(a[1]);
          const bKey = sortKey(b[1]);
          if (typeof bKey === 'string' && typeof aKey === 'string')
            return aKey.localeCompare(bKey, undefined, { sensitivity: 'accent' });
          if (typeof bKey === 'number' && typeof aKey === 'number')
            return bKey - aKey;
          if (typeof aKey === 'string')
            return -1;
          if (typeof bKey === 'string')
            return 1;
          return 0;
        });

    subTitle.innerText = (
      'Fragments of performers that might be ready to correct, or be marked as done.'
    );

    desc.innerText = (
      'The checkbox marks an entry as "seen" but leaving this page will reset that status.'
      + '\nMarking as "seen" does not do any action.'
    );

    renderPerformersList(sortedPerformers, performersList, 'ready-fragments', fragmentIndexMap);

    for (const li of Array.from(performersList.querySelectorAll('li'))) {
      if (li.nextElementSibling) {
        li.after(document.createElement('br'));
      }
    }

  } // iPerformersSplitReadyFragmentsPage

  async function iPerformerFragmentsPage() {
    const main = /** @type {HTMLDivElement} */ (await elementReadyIn('.NarrowPage', 200));
    if (!main) {
      alert('failed to construct backlog page');
      return;
    }

    toggleBacklogInfo(false);
    document.title = `Performer Fragments Search | ${document.title}`;

    const performers = document.createElement('div');
    main.appendChild(performers);

    const performersHeader = document.createElement('h3');
    performersHeader.innerText = 'Performer Fragments';
    performers.appendChild(performersHeader);

    const subTitle = document.createElement('h5');
    subTitle.innerText = 'Input performer ID and/or links to find fragments that match:';
    performers.appendChild(subTitle);

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('my-2');

    const inputLabel = document.createElement('label');
    inputLabel.setAttribute('for', 'idInput');
    inputLabel.innerText = 'Performer ID:';
    inputLabel.classList.add('font-bold', 'me-2');
    inputWrapper.appendChild(inputLabel);

    const idInput = document.createElement('input');
    idInput.id = 'idInput';
    setStyles(idInput, { fontFamily: 'monospace', width: '350px' });
    inputWrapper.appendChild(idInput);

    performers.appendChild(inputWrapper);

    const urlInputWrapper = document.createElement('div');
    urlInputWrapper.classList.add('my-2');

    const urlInputLabel = document.createElement('label');
    urlInputLabel.setAttribute('for', 'urlInput');
    urlInputLabel.innerText = 'Links:';
    urlInputLabel.classList.add('font-bold', 'd-block');
    urlInputWrapper.appendChild(urlInputLabel);

    const urlInput = document.createElement('textarea');
    urlInput.id = 'urlInput';
    urlInput.cols = 80;
    urlInput.rows = 5;
    urlInputWrapper.appendChild(urlInput);

    performers.appendChild(urlInputWrapper);

    const linksFromFragmentsDiv = document.createElement('div');
    linksFromFragmentsDiv.classList.add('d-none');
    const linksFromFragmentsHeading = document.createElement('h4');
    linksFromFragmentsDiv.appendChild(linksFromFragmentsHeading);
    linksFromFragmentsHeading.innerText = 'Links found in fragments:';
    const linksFromFragments = document.createElement('ul');
    linksFromFragmentsDiv.appendChild(linksFromFragments);
    performers.appendChild(linksFromFragmentsDiv);

    const desc = document.createElement('p');
    desc.innerText = (
      'The checkbox marks an entry as "seen" but leaving this page will reset that status.'
      + '\nMarking as "seen" does not do any action.'
    );
    performers.appendChild(desc);

    const performersList = document.createElement('ol');
    performers.appendChild(performersList);

    const scenesList = document.createElement('ol');
    performers.appendChild(scenesList);

    window.addEventListener(locationChanged, () => performers.remove(), { once: true });

    await wait(0);

    const renderList = () => {
      performersList.innerHTML = '';
      scenesList.innerHTML = '';
      linksFromFragments.innerHTML = '';

      const performerId = idInput.value.trim() || undefined;
      const urls = urlInput.value.replace(/^\s+|\s+$/g, '').split('\n');
      if (!performerId && urls.length === 0)
        return;
      const { performerFragments, possibleLinks, fragmentIndexMap } = getPerformerFragments({ performerId, urls });

      // find by pending links
      const performerByPendingLinks = Object.entries(Cache.data.performers).find(
        ([, { urls: pendingLinks }]) => !!pendingLinks && urls.some((url) => pendingLinks.includes(url))
      );
      if (performerByPendingLinks) {
        performerFragments.splice(0, 0, performerByPendingLinks);
        /** @type {FragmentIndexMap | { [performerId: string]: string }} */
        (fragmentIndexMap)[performerByPendingLinks[0]] = 'Matched main performer by pending links';
      }

      renderPerformersList(performerFragments, performersList, 'fragment-search', fragmentIndexMap);

      linksFromFragmentsDiv.classList.toggle('d-none', possibleLinks.length === 0);
      possibleLinks.forEach((url) => {
        const container = document.createElement('li');
        const a = makeLink(url, undefined, { color: 'var(--bs-teal)' });
        a.target = '_blank';
        container.appendChild(a);
        linksFromFragments.appendChild(container);
      });

      const scenesForPerformer = Object.entries(Cache.data.scenes).filter((entry) => {
        if (!entry[1].performers)
          return false;

        return entry[1].performers.append.some(({ id, status_url, notes }) => {
          // fragment id is currently viewed performer
          if (performerId && id === performerId)
            return true;
          const links = [status_url]
            .concat(notes?.filter((note) => /^https?:/.test(note)) || [])
            .filter(Boolean);
          return !!links && (
            // any fragment url listed in links?
            urls.some((url) => links.includes(url))
          );
        });
      });

      renderScenesList(scenesForPerformer, scenesList, null);
    };

    idInput.addEventListener('input', renderList);
    urlInput.addEventListener('input', renderList);

    const params = new URLSearchParams(window.location.search);
    const performerId = params.get('id');
    const urls = params.getAll('url');
    if (performerId)
      idInput.value = performerId;
    if (urls.length > 0)
      urlInput.value = urls.join('\n');

    renderList();

  } // iPerformerFragmentsPage

  async function iPerformerURLSearchPage() {
    const main = /** @type {HTMLDivElement} */ (await elementReadyIn('.NarrowPage', 200));
    if (!main) {
      alert('failed to construct page');
      return;
    }

    toggleBacklogInfo(false);
    document.title = `Performer URL Search | ${document.title}`;

    const performers = document.createElement('div');
    main.appendChild(performers);

    const performersHeader = document.createElement('h3');
    performersHeader.innerText = 'Performer URL Search';
    performers.appendChild(performersHeader);

    const subTitle = document.createElement('h5');
    subTitle.innerText = 'Input performer link to find performers that match:';
    performers.appendChild(subTitle);

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('my-2');

    const searchBtn = document.createElement('button');
    searchBtn.innerText = 'Search';
    searchBtn.classList.add('font-bold', 'me-2');
    inputWrapper.appendChild(searchBtn);

    const urlInput = document.createElement('input');
    urlInput.id = 'urlInput';
    setStyles(urlInput, { width: '600px' });
    inputWrapper.appendChild(urlInput);

    performers.appendChild(inputWrapper);

    const results = document.createElement('h4');
    results.innerText = '';
    performers.appendChild(results);

    const performersList = document.createElement('ol');
    performers.appendChild(performersList);

    window.addEventListener(locationChanged, () => performers.remove(), { once: true });

    await wait(0);

    const search = async () => {
      performersList.innerHTML = '';
      results.innerHTML = '';

      const url = urlInput.value.trim() || undefined;
      if (!url)
        return;

      const query = `query ($url: String!) {
        queryPerformers(input: {
          url: $url
          per_page: 40
        }) {
          count
          performers {
            id
            name
            disambiguation
            aliases
            urls {
              url
            }
          }
        }
      }`;

      results.innerText = 'Searching...';

      const response = await fetch(
        `${window.location.origin}/graphql`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            variables: { url },
            query,
          }),
        }
      );
      const { data, errors } = await response.json();

      if (errors) {
        results.innerText = `ERROR:\n${JSON.stringify(errors, null, 2)}`
        console.error(errors);
        return;
      }

      const { queryPerformers } = data;

      results.innerText = `Results (${queryPerformers.count}):`;

      for (const result of queryPerformers.performers) {
        const li = document.createElement('li');
        const name = result.name + (result.disambiguation ? ` [${result.disambiguation}]` : '');
        const link = makeLink(`/performers/${result.id}`, `${name} - ${result.id}`, { color: 'var(--bs-teal)' });
        li.appendChild(link);

        if (result.aliases.length > 0)
          li.append(document.createElement('br'), result.aliases.join(', '))

        const ul = document.createElement('ul');
        const urls = /** @type {{ url: string }[]} */ (result.urls);
        urls.forEach(({ url }) => {
          ul.appendChild(makeLink(url, undefined, { display: 'list-item', color: 'var(--bs-yellow)' }));
        });
        li.appendChild(ul);
        performersList.appendChild(li);
      }
    };

    searchBtn.addEventListener('click', search);
    urlInput.addEventListener('keypress', function (event) {
      if (event.key === 'Enter') {
        search();
      }
    });

  } // iPerformerURLSearchPage
}

// Based on: https://dirask.com/posts/JavaScript-on-location-changed-event-on-url-changed-event-DKeyZj
const locationChanged = (function() {
  const { pushState, replaceState } = history;

  // @ts-expect-error
  const prefix = GM.info.script.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-');

  const eventName = `${prefix}$locationchange`;
  const makeLocationChangeEvent = (/** @type {string} */ source) => new CustomEvent(eventName, { detail: source });

  history.pushState = function(...args) {
    pushState.apply(history, args);
    window.dispatchEvent(makeLocationChangeEvent('pushState'));
  }

  history.replaceState = function(...args) {
    replaceState.apply(history, args);
    window.dispatchEvent(makeLocationChangeEvent('replaceState'));
  }

  window.addEventListener('popstate', function() {
    window.dispatchEvent(makeLocationChangeEvent('popstate'));
  });

  return eventName;
})();

// MIT Licensed
// Author: jwilson8767
// https://gist.github.com/jwilson8767/db379026efcbd932f64382db4b02853e
/**
 * Waits for an element satisfying selector to exist, then resolves promise with the element.
 * Useful for resolving race conditions.
 *
 * @param {string} selector
 * @param {HTMLElement} [parentEl]
 * @returns {Promise<Element>}
 */
function elementReady(selector, parentEl) {
  return new Promise((resolve, reject) => {
    let el = (parentEl || document).querySelector(selector);
    if (el) {resolve(el);}
    new MutationObserver((mutationRecords, observer) => {
      // Query for elements matching the specified selector
      Array.from((parentEl || document).querySelectorAll(selector)).forEach((element) => {
        resolve(element);
        //Once we have resolved we don't need the observer anymore.
        observer.disconnect();
      });
    })
    .observe(parentEl || document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

inject();
