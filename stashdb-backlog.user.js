// ==UserScript==
// @name        StashDB Backlog
// @author      peolic
// @version     1.19.20
// @description Highlights backlogged changes to scenes, performers and other objects on StashDB.org
// @icon        https://cdn.discordapp.com/attachments/559159668912553989/841890253707149352/stash2.png
// @namespace   https://github.com/peolic
// @include     https://stashdb.org/*
// @grant       GM.setValue
// @grant       GM.getValue
// @grant       GM.deleteValue
// @grant       GM.xmlHttpRequest
// @homepageURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7
// @downloadURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @updateURL   https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// ==/UserScript==

//@ts-check
/// <reference path="typings.d.ts" />

const dev = false;

const eventPrefix = 'stashdb_backlog';

async function inject() {
  const BASE_URL =
    dev
      ? 'http://localhost:8000'
      : 'https://api.github.com/repos/peolic/stashdb_backlog_data/contents';

  const urlRegex = new RegExp(
    String.raw`(?:/([a-z]+)`
      + String.raw`(?:/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w\d.-]+)`
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

    const match = urlRegex.exec(pathname);
    if (!match || match.length === 0) return result;

    /** @type {AnyObject} */
    result.object = (match[1]) || null;
    result.ident = match[2] || null;
    result.action = match[3] || null;

    if (result.ident === 'add' && !result.action) {
      result.action = result.ident;
      result.ident = null;
    }

    return result;
  };

  const getUser = () => {
    /** @type {HTMLAnchorElement} */
    const profile = (document.querySelector('a[href^="/users/"]'));
    if (!profile) return null;
    return profile.innerText;
  };

  const isDev = () => getUser() === 'peolic';

  const wait = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const once = (/** @type {(() => any) | null} */ fn) => () => {
    if (!fn) return;
    fn();
    fn = null;
  };

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
   */
  const elementReadyIn = (selector, timeout) => {
    const promises = [elementReady(selector)];
    if (timeout) promises.push(wait(timeout).then(() => null));
    return Promise.race(promises);
  };

  async function dispatcher() {
    const loc = parsePath();
    if (!loc) {
      throw new Error('[backlog] Failed to parse location!');
    }

    await elementReadyIn('.StashDBContent > .LoadingIndicator', 100);

    const { object, ident, action } = loc;

    if (object === 'scenes') {
      if (ident) {
        // Scene page
        if (!action) return await iScenePage(ident);
        // Scene edit page
        else if (action === 'edit') return await iSceneEditPage(ident);
      } else {
        // Main scene cards list
        return await highlightSceneCards(object);
      }
    }

    // Scene cards lists on Studio/Tag pages
    if ((object === 'studios' || object === 'tags') && ident && !action) {
      return await highlightSceneCards(object);
    }

    if (object === 'performers') {
      if (!ident && !action) {
        return await highlightPerformerCards();
      }

      if (ident && !action) {
        return await iPerformerPage(ident);
      }
    }

    // Search results
    if (object === 'search') {
      return await highlightSearchResults();
    }

    // Home page
    if (!object && !ident && !action) {
      return await highlightSceneCards();
    }

    const identAction = ident ? `${ident}/${action}` : `${action}`;
    console.debug(`[backlog] nothing to do for ${object}/${identAction}.`);
  }

  let dispatchEnabled = true;

  window.addEventListener(`${eventPrefix}_locationchange`, () => {
    if (dispatchEnabled) {
      console.debug('[backlog] location change detected, executing');
      dispatcher();
    } else {
      console.debug('[backlog] location change detected, dispatch disabled');
    }
  });

  setTimeout(dispatcher, 0);

  // =====

  /**
   * @param {string} unsafe
   * @returns {string}
   */
  function escapeHTML(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * @template {HTMLElement} E
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
   * @template {BaseCache} T
   * @param {string} url
   * @returns {Promise<Omit<T, keyof BaseCache> | FetchError | null>}
   */
  async function fetchJSON(url) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        referrerPolicy: 'same-origin',
        cache: 'no-cache',
      });
      if (!response.ok) {
        const body = await response.text();
        console.error('[backlog] fetch bad response', response.status, response.url);
        console.debug(body);
        return { error: true, status: response.status, body };
      }

      let data = await response.json();

      // Handle GitHub Content API
      if ('content' in data) {
        const { content, encoding } = data;
        if (encoding !== 'base64') throw new Error(`Content in unsupported encoding ${encoding}`);
        const decodedContent = atob(content);
        data = JSON.parse(decodedContent);
      }

      return data;

    } catch (error) {
      console.error('[backlog] fetch error', url, error);
      return null;
    }
  }

  /**
   * @param {BaseCache} storedObject
   * @param {string | number | Date} diff new content hash or max time in hours
   * @returns {boolean}
   */
  function shouldFetch(storedObject, diff) {
    if (!storedObject) return true;

    if (diff instanceof Date) {
      const { lastUpdated } = storedObject;
      return !lastUpdated || diff.getTime() > new Date(lastUpdated).getTime();
    }

    if (typeof diff === 'string') {
      const { contentHash } = storedObject;
      return !contentHash || contentHash !== diff;
    }

    if (typeof diff === 'number') {
      const { lastUpdated } = storedObject;
      if (!lastUpdated) return true;
      const cacheInvalidation = (new Date(lastUpdated).getTime()) + 1000 * 60 * 60 * diff;
      return new Date().getTime() >= cacheInvalidation;
    }

    return false;
  }

  /**
   * @returns {Promise<Date | null>}
   */
  async function getDataIndexLastUpdatedDate() {
    try {
      console.debug('[backlog] fetching last updated date for data index');
      const response = await fetch(
        'https://api.github.com/repos/peolic/stashdb_backlog_data/commits?page=1&per_page=1&path=index.json',
        { credentials: 'same-origin', referrerPolicy: 'same-origin' },
      );
      if (!response.ok) {
        const body = await response.text();
        console.error('[backlog] api fetch bad response', response.status, body);
        return null;
      }
      const data = await response.json();
      return new Date(data[0].commit.committer.date);

    } catch (error) {
      console.error('[backlog] api fetch error', error);
      return null;
    }
  }

  class Cache {
    static _DATA_INDEX_KEY = 'stashdb_backlog_index';
    static _SCENES_DATA_KEY = 'stashdb_backlog_scenes';
    static _PERFORMERS_DATA_KEY = 'stashdb_backlog_performers';
    static _LEGACY_DATA_KEY = 'stashdb_backlog';

    static async getStoredDataIndex() {
      return /** @type {DataIndex} */ (await this._getValue(this._DATA_INDEX_KEY));
    }
    static async setDataIndex(/** @type {DataIndex} */ data) {
      return await this._setValue(this._DATA_INDEX_KEY, data);
    }
    static async clearDataIndex() {
      return await this._deleteValue(this._DATA_INDEX_KEY);
    }

    /**
     * @param {SupportedObject} object
     * @param {string} uuid
     * @param {DataIndex} [storedIndex]
     * @returns {Promise<boolean>}
     */
    static async removeIndexEntry(object, uuid, storedIndex) {
      if (!storedIndex) {
        try {
          storedIndex = await this.getStoredDataIndex();
        } catch (error) {
          return false;
        }
      }

      const haystack = storedIndex[object];

      let removed = false;
      if (haystack[uuid] !== undefined) {
        delete haystack[uuid];
        removed = true;
      }
      await this.setDataIndex(storedIndex);

      return removed;
    }

    static async getStoredData() {
      const scenes = /** @type {DataCache['scenes']} */ (await this._getValue(this._SCENES_DATA_KEY));
      const performers = /** @type {DataCache['performers']} */ (await this._getValue(this._PERFORMERS_DATA_KEY));
      /** @type {DataCache} */
      const dataCache = { scenes, performers };
      if (Object.values(scenes).length === 0 && Object.values(performers).length === 0) {
        const legacyCache = /** @type {MutationDataCache} */ (await this._getValue(this._LEGACY_DATA_KEY));
        return await applyDataCacheMigrations(legacyCache);
      }
      return dataCache;
    }
    static async setData(/** @type {DataCache} */ data) {
      const { scenes, performers } = data;
      this._setValue(this._SCENES_DATA_KEY, scenes);
      this._setValue(this._PERFORMERS_DATA_KEY, performers);
    }
    static async clearData() {
      await this._deleteValue(this._SCENES_DATA_KEY);
      await this._deleteValue(this._PERFORMERS_DATA_KEY);
    }

    /**
     * @param {SupportedObject} object
     * @param {string} uuid
     * @param {DataCache} [storedData]
     * @returns {Promise<boolean>}
     */
    static async removeObjectData(object, uuid, storedData) {
      if (!storedData) {
        try {
          storedData = await this.getStoredData();
        } catch (error) {
          return false;
        }
      }

      const objectCache = storedData[object];
      if (objectCache[uuid]) {
        delete objectCache[uuid];
        await this.setData(storedData);
        return true;
      }

      return false;
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
   * @param {MutationDataCache} legacyCache
   * @returns {Promise<DataCache>}
   */
  async function applyDataCacheMigrations(legacyCache) {
    /** @type {DataCache} */
    const dataCache = {
      scenes: {},
      performers: {},
    };

    // `scene/${uuid}` | `performer/${uuid}`
    const allKeys = Object.keys(legacyCache);
    const oldKeys = allKeys.filter((k) => k.includes('/'));
    if (oldKeys.length === 0) {
      if (allKeys.length === 0) return dataCache;
      else throw new Error(`migration failed: invalid object`);
    }

    let seen = Object.keys(dataCache);
    const log = (/** @type {string} */ object) => {
      if (!seen.includes(object)) {
        console.debug(`[backlog] data-cache migration: convert from '${object}/uuid' key format`);
        seen.splice(seen.indexOf(object), 1);
      }
    };

    for (const cacheKey of oldKeys) {
      const [oldObject, uuid] = /** @type {['scene' | 'performer', string]} */ (cacheKey.split('/'));
      log(oldObject);
      const object = /** @type {SupportedObject} */ (`${oldObject}s`);
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
   * @param {boolean} [forceFetch=false]
   * @returns {Promise<DataIndex | null>}
   */
  async function getOrFetchDataIndex(forceFetch=false) {
    const storedDataIndex = await Cache.getStoredDataIndex();
    let shouldFetchIndex = shouldFetch(storedDataIndex, 1);
    try {
      if (!dev && !forceFetch && shouldFetchIndex) {
        // Only fetch if there really was an update
        const lastUpdated = await getDataIndexLastUpdatedDate();
        if (lastUpdated) {
          shouldFetchIndex = shouldFetch(storedDataIndex, lastUpdated);
          console.debug(
            `[backlog] data index lastest remote update: ${formatDate(lastUpdated)}`
            + ` - updating: ${shouldFetchIndex}`
          );

          if (!shouldFetchIndex) {
            // Use this as a "last checked" timestamp as to not spam GitHub API
            storedDataIndex.lastUpdated = new Date().toISOString();
            await Cache.setDataIndex(storedDataIndex);
          }
        }
      }
    } catch (error) {
      console.error('[backlog] error trying to determine lastest data index update', error);
      shouldFetchIndex = shouldFetch(storedDataIndex, 1);
    }

    if (forceFetch || shouldFetchIndex) {
      const data = await fetchJSON(`${BASE_URL}/index.json`);
      if (data === null || 'error' in data) {
        console.error('[backlog] index error', data);
        return null;
      }
      const dataIndex = /** @type {DataIndex} */ (data);

      await applyDataIndexMigrations(dataIndex);

      const action = storedDataIndex.lastUpdated ? 'updated' : 'fetched';
      dataIndex.lastUpdated = new Date().toISOString();
      await Cache.setDataIndex(dataIndex);
      console.debug(`[backlog] index ${action}`);
      return dataIndex;
    } else {
      console.debug('[backlog] using stored index');
      return storedDataIndex;
    }
  }

  /**
   * Mutates `dataIndex`
   * @param {MutationDataIndex | DataIndex} dataIndex
   * @returns {Promise<DataIndex>}
   */
  async function applyDataIndexMigrations(dataIndex) {
    for (const key in dataIndex) {
      if (key === 'lastUpdated') continue;
      const thisIndex = dataIndex[/** @type {SupportedObject} */ (key)];
      const log = once(() => console.debug(`[backlog] \`index.${key}\` migration: convert comma-separated to array`));
      for (const thisId in thisIndex) {
        let oldValue = thisIndex[thisId];
        if (typeof oldValue === 'string') {
          log();
          thisIndex[thisId] = oldValue = [''].concat(...oldValue.split(/,/g));
        }
      }
    }

    dataIndex = /** @type {DataIndex} */ (dataIndex);
    await Cache.setDataIndex(dataIndex);
    return dataIndex;
  }

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @returns {string}
   */
  const makeDataUrl = (object, uuid) => `${BASE_URL}/${object}/${uuid.slice(0, 2)}/${uuid}.json`;

  /**
   * @template {DataObject} T
   * @param {SupportedObject} object
   * @param {string} uuid
   * @param {DataCache} storedData
   * @param {DataIndex} index
   * @returns {Promise<T | null>}
   */
  const _fetchObjectData = async (object, uuid, storedData, index) => {
    const data = await fetchJSON(makeDataUrl(object, uuid));
    if (data && 'error' in data && data.status === 404) {
      // remove from data index
      const removedIndex = await Cache.removeIndexEntry(object, uuid, index);
      // remove from data
      const removedData = await Cache.removeObjectData(object, uuid, storedData);

      if (removedIndex || removedData) {
        const from = [
          (removedIndex ? 'index cache' : null),
          (removedData ? 'data cache' : null)
        ].filter(Boolean).join(' and ');
        console.debug(`[backlog] <${object} ${uuid}> removed from ${from}, no longer valid`);
      }
      return null;
    } else if (data === null || 'error' in data) {
      console.error(`[backlog] <${object} ${uuid}> data error`, data);
      return null;
    }

    const haystack = index[object];
    const indexEntry = haystack[uuid];

    const objectCache = storedData[object];
    const action = objectCache[uuid] && objectCache[uuid].lastUpdated ? 'updated' : 'fetched';
    const dataObject = /** @type {T} */ (data);
    dataObject.contentHash = indexEntry[0];
    dataObject.lastUpdated = new Date().toISOString();
    objectCache[uuid] = dataObject;
    await Cache.setData(storedData);
    console.debug(`[backlog] <${object} ${uuid}> data ${action}`);

    // add to data index if not present
    if (haystack[uuid] === undefined) {
      haystack[uuid] = [''].concat(
        Object.keys(data)
          .filter((k) => !['contentHash', 'lastUpdated', 'comments'].includes(k))
      );
    }
    await Cache.setDataIndex(index);
    console.debug('[backlog] stored data index updated');

    return dataObject;
  };

  /**
   * @template {SupportedObject} T
   * @template {string} I
   * @param {T} object
   * @param {I} uuid
   * @param {DataIndex | null} [index]
   * @returns {Promise<DataCache[T][I] | null>}
   */
  async function getDataFor(object, uuid, index) {
    if (index === undefined) index = await getOrFetchDataIndex();
    if (!index) throw new Error("[backlog] failed to get index");

    const haystack = index[object];
    if (haystack[uuid] === undefined) {
      // Clear outdated
      if (await Cache.removeObjectData(object, uuid)) {
        console.debug(`[backlog] <${object} ${uuid}> cleared from cache (not found in index)`);
      }
      return null;
    }

    const storedData = await Cache.getStoredData();

    const indexEntry = haystack[uuid];
    const contentHash = indexEntry[0];
    const objectCache = storedData[object];

    // for performers, empty content hash = no file, usually
    if (object === 'performers' && contentHash === '' && !objectCache[uuid]) {
      return null;
    }

    if (shouldFetch(objectCache[uuid], contentHash)) {
      return await _fetchObjectData(object, uuid, storedData, index);
    }

    console.debug(`[backlog] <${object} ${uuid}> using stored data`);
    return objectCache[uuid];
  }

  // ===

  async function backlogClearCache(global = globalThis) {
    await Cache.clearDataIndex();
    await Cache.clearData();
    global.console.info('[backlog] stored data cleared');
  }
  //@ts-expect-error
  unsafeWindow.backlogClearCache = exportFunction(() => isDev() && backlogClearCache(unsafeWindow), unsafeWindow);

  // ===

  async function backlogRefetch(global = globalThis) {
    const { object, ident: uuid } = parsePath();

    const storedData = await Cache.getStoredData();

    const index = await getOrFetchDataIndex(true);
    if (!index) throw new Error("[backlog] failed to get index");

    if (!object) return false;

    if (!isSupportedObject(object) || !uuid) {
      global.console.warn(`[backlog] invalid request: <${object} ${uuid}>`);
      return false;
    }

    const data = await _fetchObjectData(object, uuid, storedData, index);
    if (data === null) {
      global.console.warn(`[backlog] <${object} ${uuid}> failed to refetch`);
      return false;
    }

    return true;
  }
  //@ts-expect-error
  unsafeWindow.backlogRefetch = exportFunction(() => isDev() && backlogRefetch(unsafeWindow), unsafeWindow);

  // ===

  async function backlogCacheReport(global = globalThis) {
    const index = await Cache.getStoredDataIndex();
    global.console.info('index', index);
    const data = await Cache.getStoredData();
    global.console.info('scenes', data.performers);
    global.console.info('performers', data.performers);
    return { index, ...data };
  }
  //@ts-expect-error
  unsafeWindow.backlogCacheReport = exportFunction(() => backlogCacheReport(unsafeWindow), unsafeWindow);

  // =====

  /**
   * @param {string} url
   * @returns {Promise<Blob>}
   */
   async function getImageBlob(url) {
    const response = await new Promise((resolve, reject) => {
      const details = {
        method: 'GET',
        url,
        responseType: 'blob',
        anonymous: true,
        timeout: 10000,
        onload: resolve,
        onerror: reject,
      };
      //@ts-expect-error
      GM.xmlHttpRequest(details);
    });

    const ok = response.status >= 200 && response.status <= 299;
    if (!ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} GET ${url}`);
    }

    /** @type {Blob} */
    return (response.response);
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  async function blobAsDataURI(blob) {
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
    return new Promise((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
    });
  }

  /**
   * @param {HTMLImageElement} img
   * @param {Promise<Blob>} newImage
   * @returns {Promise<boolean | Error>} same image?
   */
  async function compareImages(img, newImage) {
    try {
      const dataURI = await blobAsDataURI(await getImageBlob(img.src));
      const newDataURI = await blobAsDataURI(await newImage);
      return dataURI === newDataURI;
    } catch (error) {
      return error;
    }
  }

  /**
   * @param {HTMLImageElement} img
   * @param {'left' | 'right'} position
   * @returns {HTMLDivElement}
   */
  function makeImageResolution(img, position) {
    const imgRes = document.createElement('div');
    imgRes.classList.add('position-absolute', `m${position.charAt(0)}-2`, 'px-2', 'font-weight-bold');
    setStyles(imgRes, { [position]: '0', backgroundColor: '#2fb59c', transition: 'opacity .2s ease' });

    imageReady(img).then(() => {
      imgRes.innerText = `${img.naturalWidth} x ${img.naturalHeight}`;
    });

    img.addEventListener('mouseover', () => imgRes.style.opacity = '0');
    img.addEventListener('mouseout', () => imgRes.style.opacity = '');
    return imgRes;
  }

  /**
   * All external links are made with `_blank` target.
   * @param {string} url
   * @param {string | null} [text] if not provided, text is the url itself, null to keep contents as is
   * @param {HTMLAnchorElement} [el] anchor element to use
   * @returns {HTMLAnchorElement}
   */
  function makeLink(url, text, el) {
    const a = el instanceof HTMLAnchorElement ? el : document.createElement('a');

    if (text !== null) {
      a.innerText = text === undefined ? url : text;
    }
    // Relative
    if (url.startsWith('/') || !/^https?:/.test(url)) {
      a.href = url;
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
      return a;
    }

    // External
    a.href = urlObj ? urlObj.href : url;
    a.target = '_blank';
    a.rel = 'nofollow noopener noreferrer';
    return a;
  }

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
  const svgStyleFix = [
    'overflow: visible', // svg:not(:root).svg-inline--fa
    'width: 1.125em', // .svg-inline--fa.fa-w-18
    'display: inline-block', // .svg-inline--fa
    'font-size: inherit', // .svg-inline--fa
    'height: 1em', // .svg-inline--fa
    'overflow: visible', // .svg-inline--fa
    'vertical-align: -0.125em', // .svg-inline--fa
  ].join('; ');

  const genderIcon = (/** @type {boolean} */ fixStyle) => (
    '<svg'
    + (fixStyle ? ` style="${svgStyleFix}"`: '')
    + ' aria-hidden="true" focusable="false" data-prefix="fas" data-icon="venus-mars" role="img"'
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

  /**
   * @param {DataObject | null} data
   * @param {HTMLElement} target Checks `target` for existence of button
   * @returns {HTMLButtonElement | null}
   */
  const createFetchButton = (data, target) => {
    const className = 'backlog-refetch';
    if (!target || target.querySelector(`:scope > button.${className}`)) return null;

    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('ml-2');
    button.classList.add('btn', 'btn-light', className);
    if (data) {
      const update = data.lastUpdated ? `\nLast updated: ${formatDate(data.lastUpdated)}` : '';
      button.title = `Refetch backlog data${update}`;
      button.innerText = '🔄';
    } else {
      button.title = 'Fetch new backlog data';
      button.innerText = '📥';
    }

    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      button.textContent = '⏳';
      button.disabled = true;
      const result = await backlogRefetch();
      button.textContent = result ? '✔' : '❌';
      setStyles(button, { backgroundColor: result ? 'yellow' : 'var(--gray-dark)', fontWeight: '800' });
      if (result) {
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }
    });

    return button;
  };

  /**
   * @param {string} sceneId
   */
  async function iScenePage(sceneId) {
    await elementReadyIn('.StashDBContent .scene-info', 2000);

    const sceneInfo = /** @type {HTMLDivElement | null} */ (document.querySelector('.scene-info'));
    if (!sceneInfo) {
      console.error('[backlog] scene info not found');
      return;
    }

    const markerDataset = sceneInfo.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected, skipping');
      return;
    } else {
      markerDataset.backlogInjected = 'true';
    }

    const found = await getDataFor('scenes', sceneId);

    if (isDev()) {
      /** @type {HTMLDivElement} */
      const sceneButtons = (document.querySelector('.scene-info > .card-header > .float-right'));
      const buttonRefetch = createFetchButton(found, sceneButtons);
      if (buttonRefetch) sceneButtons.appendChild(buttonRefetch);
    }

    if (!found) {
      console.debug('[backlog] not found', sceneId);
      return;
    }
    console.debug('[backlog] found', found);

    const sceneHeader = /** @type {HTMLDivElement} */ (sceneInfo.querySelector(':scope > .card-header'));
    sceneHeader.style.borderTop = '1rem solid var(--warning)';
    sceneHeader.title = 'pending changes (backlog)';

    const makeAlreadyCorrectTitle = (/** @type {string} */ status='correct', /** @type {string} */ field='') =>
      `<already ${status}>${field ? ` ${field}`: ''}\nshould mark the entry on the backlog sheet as completed`;

    if (found.comments && found.comments.length > 0) {
      const comments = document.createElement('div');
      comments.classList.add('bg-info');

      found.comments.forEach((comment, index) => {
        if (index > 0) comments.insertAdjacentHTML('beforeend', '<br>');
        const commentElement = /^https?:/.test(comment) ? makeLink(comment) : document.createElement('span');
        commentElement.innerText = comment;
        comments.appendChild(commentElement);
      });

      sceneHeader.appendChild(comments);
    }

    if (found.title) {
      /** @type {HTMLHeadingElement} */
      const title = (document.querySelector('.scene-info h3'));
      const currentTitle = title.innerText;
      if (!currentTitle) {
        title.classList.add('bg-danger', 'p-1');
        title.innerText = found.title;
        title.title = '<MISSING> Title';

        const status = document.createElement('span');
        status.classList.add('mr-2');
        status.style.fontSize = '1.25rem';
        status.innerText = '<MISSING> \u{22D9}';
        title.prepend(status);
      } else if (currentTitle === found.title) {
        title.classList.add('bg-warning', 'p-1');
        title.title = makeAlreadyCorrectTitle('correct', 'Title');

        const status = document.createElement('span');
        status.classList.add('mr-2');
        status.style.fontSize = '1.25rem';
        status.innerText = '<already correct> \u{22D9}';
        title.prepend(status);
      } else {
        title.title = `<pending> Title`;
        title.style.fontSize = '1.25rem';
        // convert title text node to element
        const titleSpan = document.createElement('span');
        titleSpan.append(title.childNodes[0]);
        titleSpan.classList.add('bg-danger', 'p-1');
        titleSpan.style.fontSize = '1rem';
        title.prepend(titleSpan);

        const arrow = document.createElement('span');
        arrow.classList.add('mx-2');
        arrow.innerText = '\u{22D9}';
        titleSpan.insertAdjacentElement('afterend', arrow);

        const newTitle = document.createElement('span');
        newTitle.classList.add('bg-primary', 'p-1');
        newTitle.innerText = found.title;
        title.append(newTitle);
      }
    }

    if (found.studio) {
      const studio_date = /** @type {HTMLHeadingElement} */ (sceneHeader.querySelector(':scope > h6'));
      const studioElement = studio_date.querySelector('a');

      const [studioId, studioName] = found.studio;
      const alreadyCorrectStudioId = studioId === parsePath(studioElement.href).ident;

      const newStudio = document.createElement('span');
      let title, colorClass, currentColorClass;
      if (!alreadyCorrectStudioId) {
        colorClass = 'bg-primary';
        currentColorClass = 'bg-danger';
        title = `<pending> Studio\n${studioName ? `${studioName} (${studioId})` : studioId}`;
        newStudio.innerHTML = `<a href="/studios/${studioId}">${escapeHTML(studioName)}</a> \u{22D8}`;
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
      studioElement.insertAdjacentElement('beforebegin', newStudio);
    }

    if (found.date) {
      const studio_date = /** @type {HTMLHeadingElement} */ (sceneHeader.querySelector(':scope > h6'));
      const dateNode = Array.from(studio_date.childNodes).slice(-1)[0];
      const separator = studio_date.querySelector('span.mx-1');

      const alreadyCorrectDate = found.date === dateNode.nodeValue;

      // convert date text node to element
      const dateElement = document.createElement('span');
      dateElement.append(dateNode);
      separator.insertAdjacentElement('afterend', dateElement);

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
      dateElement.insertAdjacentElement('afterend', newDate);
    }

    if (found.image) {
      /** @type {HTMLImageElement} */
      const img = (document.querySelector('.scene-photo > img'));
      const imgContainer = img.parentElement;

      // Enable CORS on the https://cdn.stashdb.org/* request
      img.crossOrigin = 'anonymous';

      const newImageBlob = getImageBlob(found.image);

      if (img.getAttribute('src')) {
        imageReady(img).then(async () => {
          const newImage = await compareImages(img, newImageBlob);
          imgContainer.classList.add('p-2');

          if (newImage === true) {
            imgContainer.style.backgroundColor = 'var(--pink)';
            imgContainer.title = `${makeAlreadyCorrectTitle('added')}\n\n${found.image}`;
            return;
          }

          imgContainer.classList.add('d-flex');
          imgContainer.title = `<pending>\n${found.image}`;

          const imgNewLink = makeLink(found.image, '');

          if (newImage instanceof Error) {
            imgContainer.style.backgroundColor = 'var(--purple)';
            imgContainer.title = 'error comparing image';
            console.error('[backlog] error comparing image', newImage);
            imgNewLink.innerText = found.image;
            imgNewLink.classList.add('p-1');
            imgNewLink.style.flex = '50%';

            imgContainer.appendChild(imgNewLink);
            return;
          }

          const currentImageContainer = document.createElement('div');
          setStyles(currentImageContainer, { borderRight: '.5rem solid var(--warning)', flex: '50%' });
          img.style.width = '100%';
          const cImgRes = makeImageResolution(img, 'left');
          currentImageContainer.append(cImgRes, img);

          imgContainer.appendChild(currentImageContainer);

          imgContainer.classList.add('bg-warning');

          const imgNew = document.createElement('img');
          imgNew.src = URL.createObjectURL(await newImageBlob);
          setStyles(imgNew, { width: '100%', height: 'auto' });

          imgNewLink.appendChild(imgNew);

          const newImageContainer = document.createElement('div');
          const isCurrentVertical = img.naturalHeight > img.naturalWidth;
          newImageContainer.style.flex = isCurrentVertical ? 'auto' : '50%';
          const imgRes = makeImageResolution(imgNew, 'right');
          newImageContainer.append(imgRes, imgNewLink);

          imgContainer.appendChild(newImageContainer);
        });

      } else {
        // missing image
        imgContainer.classList.add('bg-danger', 'p-2');
        imgContainer.style.transition = 'min-height 1s ease';
        imgContainer.title = `<MISSING>\n${found.image}`;

        const imgLink = imgContainer.appendChild(makeLink(found.image, ''));
        imgLink.appendChild(img);

        const onFailure = () => {
          setStyles(imgContainer, { minHeight: '0', textAlign: 'center', fontSize: '1.2em', fontWeight: '600' });
          imgLink.prepend(found.image);
          img.classList.add('d-none');
        };
        newImageBlob.then(
          (blob) => {
            const imgRes = makeImageResolution(img, 'right');
            imgContainer.prepend(imgRes);
            img.src = URL.createObjectURL(blob);
          },
          onFailure
        );
      }
    }

    if (found.performers || found.duration || found.director) {
      document.querySelector('.scene-info .scene-performers').classList.add('my-auto');
    }

    if (found.performers) {
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
        const fullName = nameParts.join(' ');
        return ({ uuid, fullName });
      };

      const formatName = (/** @type {PerformerEntry} */ entry) => {
        const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
        if (!entry.appearance) return entry.name + disambiguation;
        return entry.appearance + ` (${entry.name})` + disambiguation;
      };

      const nameElements = (/** @type {PerformerEntry} */ entry) => {
        const c = (/** @type {string} */ text, small=false) => {
          const el = document.createElement(small ? 'small' : 'span');
          if (small) el.classList.add('ml-1', 'text-small', 'text-muted');
          el.innerText = small ? `(${text})` : text;
          return el;
        };

        const { status, appearance, name, disambiguation } = entry;
        const namePart = c(name, !!appearance);
        const parts = /** @type {Array<HTMLElement | string>} */ ([]);
        if (status) parts.push(`[${entry.status}] `);
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
        }

        pa.insertAdjacentHTML('afterbegin', genderIcon(existingPerformers.length === 0));
        pa.append(...nameElements(entry));
        return pa;
      };

      const highlight = (/** @type {HTMLElement} */ e, /** @type {string} */ v) => {
        setStyles(e, { border: `6px solid var(--${v})`, borderRadius: '6px', padding: '.1rem .25rem' });
        e.classList.add('d-inline-block');
      };

      const scenePerformers = document.querySelector('.scene-info .scene-performers');
      const existingPerformers = (
        /** @type {HTMLAnchorElement[]} */
        (Array.from(scenePerformers.querySelectorAll(':scope > a.scene-performer')))
      );

      existingPerformers.forEach((performer) => {
        const { uuid, fullName } = parsePerformerAppearance(performer);
        const toRemove = remove.find((e) => e.id ? e.id === uuid : formatName(e) === fullName);
        const toAppend = append.find((e) => e.id ? e.id === uuid : formatName(e) === fullName);
        const toUpdate = update.find((e) => e.id === uuid);

        if (toRemove) {
          highlight(performer, 'danger');
          if (toRemove.status) {
            performer.children[1].prepend(`[${toRemove.status}] `);
            performer.title = `<pending>\n${toRemove.status}`;
            performer.style.color = 'var(--yellow)';
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
            performer.style.textDecoration = 'line-through';
            performer.title = `<pending>\nremoval`;
          }
          if (!toRemove.id) {
            performer.title += '\n[missing ID - matched by name]';
            performer.classList.add('bg-danger');
          }
          removeFrom(toRemove, remove);
        }

        if (toAppend) {
          const entryFullName = formatName(toAppend);
          if (fullName === entryFullName) {
            highlight(performer, 'warning');
            performer.title = makeAlreadyCorrectTitle('added');
            if (!toAppend.id) {
              performer.title += '\n[missing ID - matched by name]';
              performer.style.color = 'var(--yellow)';
            }
          } else {
            highlight(performer, 'primary');
            performer.title = `<already added>\nbut needs an update to\n${entryFullName}`;
          }
          removeFrom(toAppend, append);
        }

        if (toUpdate) {
          const entryFullName = formatName(toUpdate);
          if (fullName === entryFullName) {
            highlight(performer, 'warning');
            performer.title = makeAlreadyCorrectTitle('updated');
          } else {
            const arrow = document.createElement('span');
            arrow.classList.add('mx-1');
            arrow.innerText = '\u{22D9}';
            performer.appendChild(arrow);
            performer.append(...nameElements(toUpdate));
            highlight(performer, 'primary');
            performer.title = `<pending>\nupdate to\n${entryFullName}`;
          }
          removeFrom(toUpdate, update);
        }
      });

      append.forEach((entry) => {
        const pa = makePerformerAppearance(entry);
        highlight(pa, 'success');
        pa.title = `<pending>\naddition`;
        if (!entry.id) {
          if (entry.status === 'new') {
            pa.title += ' (performer needs to be created)';
          } else if (entry.status == 'c') {
            pa.title += ' (performer created, pending approval)';
          } else {
            pa.title += ' (missing performer ID)';
          }
          if (entry.status_url) {
            makeLink(entry.status_url, null, pa);
          }
        }
        scenePerformers.appendChild(pa);
      });

      remove.forEach((entry) => {
        console.warn('[backlog] entry to remove not found. already removed?', entry);
        const pa = makePerformerAppearance(entry);
        highlight(pa, 'warning');
        pa.style.color = 'var(--yellow)';
        pa.title = `performer-to-remove not found. already removed?`;
        scenePerformers.appendChild(pa);
      });

      update.forEach((entry) => {
        console.warn('[backlog] entry to update not found.', entry);
        const pa = makePerformerAppearance(entry);
        highlight(pa, 'warning');
        pa.style.color = 'var(--yellow)';
        pa.title = `performer-to-update is missing.`;
        scenePerformers.appendChild(pa);
      });
    }

    if (found.duration) {
      /** @type {HTMLDivElement | null} */
      let duration = (document.querySelector('.scene-info > .card-footer > div[title $= " seconds"]'));
      const foundDuration = Number(found.duration);
      const formattedDuration = formatDuration(foundDuration);
      if (!duration) {
        duration = document.createElement('div');
        duration.innerHTML = `${escapeHTML('<MISSING>')} Duration: <b>${formattedDuration}</b>`;
        duration.classList.add('bg-danger', 'p-1', 'my-auto');
        duration.title = `Duration is missing; ${foundDuration} seconds`;
        document.querySelector('.scene-info .scene-performers').insertAdjacentElement('afterend', duration);
      } else {
        const currentDuration = duration.title.match(/(\d+)/)[1];
        if (found.duration === currentDuration) {
          duration.classList.add('bg-warning', 'p-1', 'my-auto');
          duration.prepend('<already correct> ');
          duration.title = `${makeAlreadyCorrectTitle('correct')}; ${foundDuration} seconds`;
        } else {
          duration.classList.add('bg-primary', 'p-1', 'my-auto');
          duration.insertAdjacentText('beforeend', ` \u{22D9} ${formattedDuration}`);
          duration.title = `<pending> Duration: ${formattedDuration}; ${foundDuration} seconds`;
        }
      }
    }

    if (found.director) {
      /** @type {HTMLDivElement | null} */
      let director = (document.querySelector('.scene-info > .card-footer > div:last-of-type'));
      if (!director || !/^Director:/.test(director.innerText)) {
        director = document.createElement('div');
        director.innerHTML = `${escapeHTML('<MISSING>')} Director: <b>${found.director}</b>`;
        director.title = '<MISSING> Director';
        director.classList.add('ml-3', 'bg-danger', 'p-1', 'my-auto');
        document.querySelector('.scene-info > .card-footer').append(director);
      } else {
        const currentDirector = director.innerText.match(/^Director: (.+)$/)[1];
        if (found.director === currentDirector) {
          director.classList.add('bg-warning', 'p-1', 'my-auto');
          director.prepend('<already correct> ');
          director.title = makeAlreadyCorrectTitle('correct');
        } else {
          director.classList.add('bg-primary', 'p-1', 'my-auto');
          director.insertAdjacentText('beforeend', ` \u{22D9} ${found.director}`);
          director.title = `<pending> Director\n${found.director}`;
        }
      }
    }

    if (found.details) {
      /** @type {HTMLDivElement} */
      const desc = (document.querySelector('.scene-description > h4 + div'));
      const currentDetails = desc.innerText;
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
        desc.insertAdjacentElement('beforebegin', compareDiv);
        desc.classList.add('bg-danger', 'p-1');
        compareDiv.appendChild(desc);

        const buffer = document.createElement('div');
        buffer.classList.add('my-1');
        compareDiv.appendChild(buffer);

        const newDetails = document.createElement('div');
        newDetails.classList.add('bg-primary', 'p-1');
        newDetails.innerHTML = escapeHTML(found.details);
        compareDiv.appendChild(newDetails);
      }
    }

    if (found.url) {
      /** @type {HTMLAnchorElement} */
      const studioUrl = (document.querySelector('.scene-description > div:last-of-type > a'));
      const currentURL = studioUrl.innerText || studioUrl.getAttribute('href');
      if (!currentURL) {
        studioUrl.classList.add('bg-success', 'p-1');
        studioUrl.innerText = found.url;
        studioUrl.title = `<MISSING> Studio URL`;
      } else if (currentURL === found.url) {
        studioUrl.classList.add('bg-warning', 'p-1');
        studioUrl.title = makeAlreadyCorrectTitle('correct', 'Studio URL');
      } else {
        const compareSpan = document.createElement('span');
        compareSpan.title = '<pending> Studio URL';
        studioUrl.insertAdjacentElement('beforebegin', compareSpan);
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
    }

    if (found.fingerprints) {
      // Parse current
      /** @type {HTMLTableRowElement[]} */
      const fingerprintsTableRows = (Array.from(document.querySelectorAll('.scene-fingerprints > table tr')));
      const headers =
        /** @type {HTMLTableCellElement[]} */
        (Array.from(fingerprintsTableRows[0].children))
          .reduce((r, cell, cellIndex) => {
            if (cell.innerText === 'Algorithm') r.algorithm = cellIndex;
            else if (cell.innerText === 'Hash') r.hash = cellIndex;
            else if (cell.innerText === 'Duration') r.duration = cellIndex;
            else if (cell.innerText === 'Submissions') r.submissions = cellIndex;
            return r;
          }, /** @type {FingerprintsColumnIndices} */ ({}));
      const currentFingerprints = fingerprintsTableRows.slice(1).map((row) => {
        /** @type {HTMLTableCellElement[]} */
        const cells = (Array.from(row.children));
        return {
          row,
          algorithm: cells[headers.algorithm].innerText,
          hash: cells[headers.hash].innerText,
          duration: cells[headers.duration].innerText,
          submissions: cells[headers.submissions].innerText,
        };
      });

      // Compare
      const matches = found.fingerprints.filter((fp) => {
        const cfp = currentFingerprints
          .find(({ algorithm, hash }) => algorithm === fp.algorithm.toUpperCase() && hash === fp.hash);
        if (!cfp) return false;
        const { row } = cfp;
        row.classList.add('bg-warning');
        if (fp.correct_scene_id) {
          const html = ` | <a href="/scenes/${fp.correct_scene_id}"><b>correct scene</b></a>`;
          row.children[headers.submissions].insertAdjacentHTML('beforeend', html);
        }
        return true;
      }).length;
      const notFound = found.fingerprints.length - matches;

      if (matches || notFound) {
        const fpInfo = document.createElement('div');
        fpInfo.classList.add('float-right', 'my-2', 'd-flex', 'flex-column');

        const makeElement = (/** @type {string[]} */ ...content) => {
          const span = document.createElement('span');
          span.classList.add('d-flex', 'justify-content-between');
          content.forEach((c) => {
            const b = document.createElement('b');
            b.classList.add('ml-2', 'text-warning');
            b.innerText = c;
            span.appendChild(b);
          });
          return span;
        };

        if (matches) fpInfo.appendChild(makeElement('Reported incorrect fingerprints:', `${matches} ℹ`));
        if (notFound) fpInfo.appendChild(makeElement('Missing reported fingerprints:', `${notFound} ⚠`));
        document.querySelector('nav[role="tablist"]').insertAdjacentElement('beforebegin', fpInfo);
        // Hook to remove it
        window.addEventListener(`${eventPrefix}_locationchange`, () => fpInfo.remove(), { once: true });
      }
    }

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

    const found = await getDataFor('scenes', sceneId);
    if (!found) {
      console.debug('[backlog] not found', sceneId);
      return;
    }
    console.debug('[backlog] found', found);

    const StashDBContent = /** @type {HTMLDivElement} */ (document.querySelector('.StashDBContent'));
    StashDBContent.style.maxWidth = '1600px';
    // Hook to the global style
    window.addEventListener(`${eventPrefix}_locationchange`, () => {
      StashDBContent.style.maxWidth = '';
      if (StashDBContent.getAttribute('style') === '') StashDBContent.removeAttribute('style');
    }, { once: true });

    const sceneFormRow = /** @type {HTMLDivElement} */ (document.querySelector('.SceneForm > .row'));
    const sceneFormCol = /** @type {HTMLDivElement} */ (sceneFormRow.querySelector(':scope > div:first-child'));
    sceneFormCol.classList.replace('col-10', 'col-9');

    const pendingChangesContainer = document.createElement('div');
    pendingChangesContainer.classList.add('col-3', 'PendingChanges');
    const pendingChangesTitle = document.createElement('h3');
    pendingChangesTitle.innerText = 'Backlogged Changes';
    pendingChangesContainer.appendChild(pendingChangesTitle);
    const pendingChanges = document.createElement('dl');
    pendingChangesContainer.appendChild(pendingChanges);

    sceneFormRow.appendChild(pendingChangesContainer);

    /**
     * @param {string} text
     * @returns {HTMLSpanElement}
     */
    const createSelectAllSpan = (text) => {
      const span = document.createElement('span');
      span.innerText = text;
      span.style.userSelect = 'all';
      return span;
    };

    /**
     * @param {HTMLElement} field
     * @param {string} fieldName
     * @param {string} value
     */
    const settableField = (field, fieldName, value) => {
      /** @type {HTMLInputElement} */
      const fieldEl = sceneFormCol.querySelector(`*[name="${fieldName}"]`);
      if (!fieldEl) {
        console.error(`form field with name="${fieldName}" not found`);
        return;
      }
      const set = document.createElement('a');
      set.innerText = 'set field';
      setStyles(set, { marginLeft: '.5rem', color: 'var(--yellow)', cursor: 'pointer' });
      set.addEventListener('click', () => {
        fieldEl.value = value;
        fieldEl.dispatchEvent(new Event('input'));
      });
      field.innerText += ':';
      field.append(set);
    };

    const keySortOrder = [
      'title', 'date', 'duration',
      'performers', 'studio', 'url',
      'details', 'director', 'tags',
      'image', 'fingerprints',
    ];
    sortedKeys(found, keySortOrder).forEach((field) => {
      if (['contentHash'].includes(field)) return;

      const dt = document.createElement('dt');
      dt.innerText = field;
      pendingChanges.appendChild(dt);

      const dd = document.createElement('dd');
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
        dd.innerText = duration;
        dd.style.userSelect = 'all';
        settableField(dt, field, duration);
        return;
      }

      if (field === 'performers') {
        const performers = found[field];
        const ul = document.createElement('ul');
        ul.classList.add('p-0');
        sortedKeys(performers, ['update', 'remove', 'append']).forEach((action) => {
          performers[action].forEach((entry) => {
            const li = document.createElement('li');
            li.classList.add('d-flex', 'justify-content-between');

            const label = document.createElement('span');
            label.style.flex = '0.25 0 0';
            label.innerText = '[' + (action === 'append' ? 'add' : action) + ']';
            li.appendChild(label);

            const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
            let name = entry.name + disambiguation;
            const appearance = entry.appearance ? ` (as ${entry.appearance})` : '';

            const info = document.createElement('span');
            setStyles(info, { flex: '1', whiteSpace: 'pre-wrap' });

            if (!entry.id) {
              info.innerText = `<${entry.status}> ${name + appearance}`;
            } else if (action === 'update') {
              const a = makeLink(`/performers/${entry.id}`, name);
              a.target = '_blank';
              a.style.color = 'var(--teal)';
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
            } else {
              const a = makeLink(`/performers/${entry.id}`, name + appearance);
              a.target = '_blank';
              a.style.color = 'var(--teal)';
              info.appendChild(a);
              if (action === 'append') {
                const uuid = createSelectAllSpan(entry.id);
                uuid.style.fontSize = '.9rem';
                info.append(document.createElement('br'), uuid);
              }
              if (entry.status) {
                a.insertAdjacentText('beforebegin', `<${entry.status}> `);
              }
            }
            li.appendChild(info);

            ul.appendChild(li);
          });
        });
        dd.appendChild(ul);
        return;
      }

      if (field === 'studio') {
        const [studioId, studioName] = found[field];
        const a = makeLink(`/studios/${studioId}`, studioName);
        a.target = '_blank';
        a.style.color = 'var(--teal)';
        dd.append(a, document.createElement('br'), createSelectAllSpan(studioId));
        return;
      }

      if (field === 'url') {
        const url = found[field];
        dd.appendChild(makeLink(url));
        settableField(dt, 'studioURL', url);
        return;
      }

      if (field === 'details') {
        const details = found[field];
        dd.innerText = details;
        setStyles(dd, { whiteSpace: 'pre-line', userSelect: 'all' });
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
        const imgLink = makeLink(image, '');
        imgLink.style.color = 'var(--teal)';
        dd.appendChild(imgLink);
        const onSuccess = (/** @type {Blob} **/ blob) => {
          const img = document.createElement('img');
          setStyles(img, { maxHeight: '200px', border: '2px solid var(--teal)' });
          img.src = URL.createObjectURL(blob);
          imgLink.prepend(img);
        };
        const onFailure = () => imgLink.innerText = image;
        getImageBlob(image).then(onSuccess, onFailure);
        return;
      }

      if (field === 'fingerprints') {
        found[field].forEach((fp, index) => {
          if (index > 0) dd.insertAdjacentHTML('beforeend', '<br>');
          const fpElement = document.createElement('span');
          const fpHash = createSelectAllSpan(fp.hash);
          fpHash.style.marginLeft = '.5rem';
          fpElement.append(fp.algorithm.toUpperCase(), fpHash);
          if (fp.correct_scene_id) {
            const correctSceneLink = makeLink(`/scenes/${fp.correct_scene_id}`, 'correct scene');
            correctSceneLink.target = '_blank';
            correctSceneLink.style.color = 'var(--teal)';
            fpElement.append(' \u{22D9} ', correctSceneLink, ': ', createSelectAllSpan(fp.correct_scene_id));
          }
          dd.appendChild(fpElement);
        });
        return;
      }

      if (field === 'comments') {
        found[field].forEach((comment, index) => {
          if (index > 0) dd.insertAdjacentHTML('beforeend', '<br>');
          const commentElement = /^https?:/.test(comment) ? makeLink(comment) : document.createElement('span');
          if (commentElement instanceof HTMLAnchorElement) {
            commentElement.style.color = 'var(--teal)';
          }
          commentElement.innerText = comment;
          dd.appendChild(commentElement);
        });
        return;
      }

      if (field === 'lastUpdated') {
        dt.insertAdjacentHTML('beforebegin', '<hr class="mt-4" style="border-top-color: initial;">');
        dt.innerText = 'data last fetched at';
        dd.innerText = formatDate(found[field]);
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
    const performerInfo = /** @type {HTMLDivElement} */ (await elementReadyIn('.performer-info', 1000));
    if (!performerInfo) return;

    const markerDataset = performerInfo.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected, skipping');
      return;
    } else {
      markerDataset.backlogInjected = 'true';
    }

    const index = await getOrFetchDataIndex();
    if (!index) return;

    highlightSceneCards('performers', index);

    const found = index.performers[performerId];
    if (!found) return;

    const info = found.slice(1);

    /** @type {HTMLElement[]} */
    const highlightElements = [];

    /** @type {HTMLDivElement} */
    const header = (performerInfo.querySelector('.card-header'));
    if (!header.dataset.injectedBacklog) {
      header.dataset.injectedBacklog = 'true';

      header.addEventListener('mouseover', () => {
        highlightElements.forEach((el) => el.style.backgroundColor = '#8c2020');
      });
      header.addEventListener('mouseout', () => {
        highlightElements.forEach((el) => el.style.backgroundColor = '');
      });
    }

    if (info.includes('split')) {
      const toSplit = document.createElement('div');
      toSplit.classList.add('mb-1', 'p-1', 'font-weight-bold');
      toSplit.style.transition = 'background-color .5s';
      const a = makeLink(
        'https://docs.google.com/spreadsheets/d/1eiOC-wbqbaK8Zp32hjF8YmaKql_aH-yeGLmvHP1oBKQ/edit#gid=1067038397',
        'Performers To Split Up'
      );
      toSplit.append('This performer is listed on ', a, '.');
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '🔀';
      toSplit.prepend(emoji);
      performerInfo.prepend(toSplit);
      highlightElements.push(toSplit);
    }

    const foundData = await getDataFor('performers', performerId, index);
    if (!foundData) {
      console.debug('[backlog] not found', performerId);
      return;
    }
    console.debug('[backlog] found', foundData);

    const isMarkedForSplit = (/** @type {string} */ uuid) => {
      const indexEntry = index.performers[uuid];
      return indexEntry && indexEntry.includes('split');
    };

    if (foundData.duplicates) {
      const hasDuplicates = document.createElement('div');
      hasDuplicates.classList.add('mb-1', 'p-1', 'font-weight-bold');
      hasDuplicates.innerHTML = 'This performer has duplicates:';
      foundData.duplicates.forEach((dupId) => {
        hasDuplicates.insertAdjacentHTML('beforeend', '<br>');
        const a = makeLink(`/performers/${dupId}`, dupId);
        a.target = '_blank';
        a.classList.add('font-weight-normal');
        setStyles(a, { color: 'var(--teal)', marginLeft: '1.75rem' });
        hasDuplicates.append(a);

        if (isMarkedForSplit(dupId)) a.insertAdjacentText('afterend', ' 🔀 needs to be split up');
      });
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '♊';
      hasDuplicates.prepend(emoji);
      performerInfo.prepend(hasDuplicates);
      highlightElements.push(hasDuplicates);
    }

    if (foundData.duplicate_of) {
      const duplicateOf = document.createElement('div');
      duplicateOf.classList.add('mb-1', 'p-1', 'font-weight-bold');
      duplicateOf.innerText = 'This performer is a duplicate of: ';
      const a = makeLink(`/performers/${foundData.duplicate_of}`, foundData.duplicate_of);
      a.target = '_blank';
      a.classList.add('font-weight-normal');
      a.style.color = 'var(--teal)';
      duplicateOf.append(a);
      if (isMarkedForSplit(foundData.duplicate_of)) a.insertAdjacentText('afterend', ' 🔀 needs to be split up');
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '♊';
      duplicateOf.prepend(emoji);
      performerInfo.prepend(duplicateOf);
      highlightElements.push(duplicateOf);
    }

  } // iPerformerPage

  // =====

  /**
   * @param {AnyObject} object
   * @param {string[]} changes
   * @returns {string}
   */
  const getHighlightStyle = (object, changes) => {
    let color = 'var(--yellow)';
    if (object === 'scenes' && changes.length === 1 && changes[0] === 'fingerprints') {
      color = 'var(--cyan)';
    }
    return `0.4rem solid ${color}`;
  }

  /**
   * @param {AnyObject} [object]
   * @param {DataIndex | null} [index]
   */
  async function highlightSceneCards(object, index) {
    const selector = '.SceneCard > .card';
    if (!await elementReadyIn(selector, 2000)) {
      console.debug('[backlog] no scene cards found, skipping');
      return;
    }

    if (index === undefined) index = await getOrFetchDataIndex();
    if (!index) return;

    const highlight = async () => {
      /** @type {HTMLDivElement[]} */
      (Array.from(document.querySelectorAll(selector))).forEach((card) => {
        const sceneCard = /** @type {HTMLDivElement} */ (card.parentElement);
        const markerDataset = sceneCard.dataset;
        if (markerDataset.backlogInjected) return;
        else markerDataset.backlogInjected = 'true';

        const sceneId = parsePath(card.querySelector('a').href).ident;
        const found = index.scenes[sceneId];
        if (!found) return;
        const changes = found.slice(1);
        card.style.outline = getHighlightStyle('scenes', changes);
        sceneCard.title = `<pending> changes to:\n - ${changes.join('\n - ')}\n(click scene to view changes)`;
      });
    };

    highlight();

    if (object === 'performers') {
      const studioSelectorValue = document.querySelector(
        '.PerformerScenes > .CheckboxSelect > .react-select__control > .react-select__value-container'
      );
      new MutationObserver(async (mutations, observer) => {
        console.debug('[backlog] detected change in performers studios selector, re-highlighting scene cards');
        if (!await elementReadyIn(selector, 2000)) return;
        await highlight();
      }).observe(studioSelectorValue, { childList: true, subtree: true });
    }
  }

  async function highlightPerformerCards() {
    const selector = '.PerformerCard';
    if (!await elementReadyIn(selector, 2000)) {
      console.debug('[backlog] no performer cards found, skipping');
      return;
    }

    const index = await getOrFetchDataIndex();
    if (!index) return;

    /** @type {HTMLDivElement[]} */
    (Array.from(document.querySelectorAll(selector))).forEach((card) => {
      const markerDataset = card.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = 'true';

      const performerId = parsePath(card.querySelector('a').href).ident;
      const found = index.performers[performerId];
      if (!found) return;
      const changes = found.slice(1);
      card.style.outline = getHighlightStyle('performers', changes);
      const info = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
      card.title = info;
      /** @type {HTMLImageElement} */
      (card.querySelector('.PerformerCard-image > img')).title += `\n\n${info}`;
    });
  }

  async function highlightSearchResults() {
    const selector = 'a.SearchPage-scene, a.SearchPage-performer';
    if (!await elementReadyIn(selector, 2000)) {
      console.debug('[backlog] no scene/performer search results found, skipping');
      return;
    }

    const index = await getOrFetchDataIndex();
    if (!index) return;

    /** @type {HTMLAnchorElement[]} */
    (Array.from(document.querySelectorAll(selector))).forEach((cardLink) => {
      const markerDataset = cardLink.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = 'true';

      const { object, ident: uuid } = parsePath(cardLink.href);
      if (!isSupportedObject(object)) return;

      const found = index[object][uuid];
      if (!found) return;
      const changes = found.slice(1);

      if (changes) {
        const card = /** @type {HTMLDivElement} */ (cardLink.querySelector(':scope > .card'));
        card.style.outline = getHighlightStyle(object, changes);
        if (object === 'scenes') {
          cardLink.title = `<pending> changes to:\n - ${changes.join('\n - ')}\n(click scene to view changes)`;
        } else if (object === 'performers') {
          cardLink.title = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
        }
      }
    });
  }
}


// Based on: https://dirask.com/posts/JavaScript-on-location-changed-event-on-url-changed-event-DKeyZj
(function() {
  const { pushState, replaceState } = history;

  const eventPushState = new Event(`${eventPrefix}_pushstate`);
  const eventReplaceState = new Event(`${eventPrefix}_replacestate`);
  const eventLocationChange = new Event(`${eventPrefix}_locationchange`);

  history.pushState = function() {
    pushState.apply(history, /** @type {*} */ (arguments));
    window.dispatchEvent(eventPushState);
    window.dispatchEvent(eventLocationChange);
  }

  history.replaceState = function() {
    replaceState.apply(history, /** @type {*} */ (arguments));
    window.dispatchEvent(eventReplaceState);
    window.dispatchEvent(eventLocationChange);
  }

  window.addEventListener('popstate', function() {
    window.dispatchEvent(eventLocationChange);
  });
})();

// MIT Licensed
// Author: jwilson8767
// https://gist.github.com/jwilson8767/db379026efcbd932f64382db4b02853e
/**
 * Waits for an element satisfying selector to exist, then resolves promise with the element.
 * Useful for resolving race conditions.
 *
 * @param {string} selector
 * @returns {Promise<Element>}
 */
function elementReady(selector) {
  return new Promise((resolve, reject) => {
    let el = document.querySelector(selector);
    if (el) {resolve(el);}
    new MutationObserver((mutationRecords, observer) => {
      // Query for elements matching the specified selector
      Array.from(document.querySelectorAll(selector)).forEach((element) => {
        resolve(element);
        //Once we have resolved we don't need the observer anymore.
        observer.disconnect();
      });
    })
    .observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

inject();
