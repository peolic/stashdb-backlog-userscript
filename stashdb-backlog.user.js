// ==UserScript==
// @name        StashDB Backlog
// @author      peolic
// @version     1.21.5
// @description Highlights backlogged changes to scenes, performers and other objects on StashDB.org
// @icon        https://cdn.discordapp.com/attachments/559159668912553989/841890253707149352/stash2.png
// @namespace   https://github.com/peolic
// @include     https://stashdb.org/*
// @grant       GM.setValue
// @grant       GM.getValue
// @grant       GM.deleteValue
// @grant       GM.xmlHttpRequest
// @grant       GM.registerMenuCommand
// @homepageURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7
// @downloadURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @updateURL   https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// ==/UserScript==

//@ts-check
/// <reference path="typings.d.ts" />

const dev = false;

const eventPrefix = 'stashdb_backlog';
const devUsername = 'peolic';

async function inject() {
  const ignoredContentKeys = ['contentHash', 'lastUpdated', 'comments'];
  const backlogSpreadsheet = 'https://docs.google.com/spreadsheets/d/1eiOC-wbqbaK8Zp32hjF8YmaKql_aH-yeGLmvHP1oBKQ';
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

  const getUser = async () => {
    /** @type {HTMLAnchorElement} */
    const profile = (await elementReadyIn('#root nav a[href^="/users/"]', 1000));
    if (!profile) return null;
    return profile.innerText;
  };

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

  let isDev = false;

  async function dispatcher() {
    const loc = parsePath();
    if (!loc) {
      throw new Error('[backlog] Failed to parse location!');
    }

    await elementReadyIn('.StashDBContent > .LoadingIndicator', 100);

    isDev = await getUser() === devUsername;

    setUpStatusDiv();
    setUpMenu();
    setUpInfo();

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

  window.addEventListener(`${eventPrefix}_locationchange`, dispatcher);

  setTimeout(dispatcher, 0);

  async function setUpStatusDiv() {
    if (document.querySelector('div#backlogStatus')) return;
    const statusDiv = document.createElement('div');
    statusDiv.id = 'backlogStatus';
    statusDiv.classList.add('mr-auto', 'd-none');
    const navLeft = await elementReadyIn('nav > :first-child', 1000);
    navLeft.after(statusDiv);

    window.addEventListener(`${eventPrefix}_locationchange`, () => setStatus(''));

    new MutationObserver(() => {
      statusDiv.classList.toggle('d-none', !statusDiv.innerText);
    }).observe(statusDiv, { childList: true, subtree: true });
  }

  /**
   * @param {string} text
   * @param {number} [resetAfter] in milliseconds
   */
  async function setStatus(text, resetAfter) {
    /** @type {HTMLDivElement} */
    const statusDiv = (document.querySelector('div#backlogStatus'));
    statusDiv.innerText = text;
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
        border: '.25rem solid #ccc',
        padding: '0.3rem',
        zIndex: '100',
        backgroundColor: 'var(--gray-dark)',
        display: 'none',
      });

      icon.addEventListener('click', async () => {
        if (info.style.display === 'none') {
          await updateInfo();
          info.style.display = '';
        } else {
          info.style.display = 'none';
        }
      });

      infoContainer.append(icon, info);

      const target = document.querySelector('#root nav');
      target.appendChild(infoContainer);
    }
  }

  async function updateInfo() {
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
    info.append(block('backlog index last updated:'));

    const index = await Cache.getStoredDataIndex();
    if (!index.lastUpdated) {
      info.append(block('?', 'd-inline-block'));
    } else {
      const { lastUpdated } = index;
      const ago = humanRelativeDate(new Date(lastUpdated));
      info.append(
        block(ago, 'd-inline-block', 'mr-1'),
        block(`(${formatDate(lastUpdated)})`, 'd-inline-block'),
      );
    }

    const storedData = await Cache.getStoredData();

    const cachedScenes = Object.keys(storedData.scenes).length;
    const totalScenes = Object.keys(index.scenes).length;

    const cachedPerformers = Object.keys(storedData.performers).length;
    const totalPerformers = Object.values(index.performers).filter(([hash]) => !!hash).length;

    info.append(
      block('cached scenes:', 'd-inline-block', 'mr-1'),
      block(`${cachedScenes} / ${totalScenes}`, 'd-inline-block'),
      block('cached performers:', 'd-inline-block', 'mr-1'),
      block(`${cachedPerformers} / ${totalPerformers}`, 'd-inline-block'),
    );

    if (isDev) {
      const button = document.createElement('span');
      button.innerText = 'Uncached/Outdated objects';
      setStyles(button, { display: 'inline-block', color: 'aqua', fontWeight: '700', cursor: 'pointer', });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.remove();
        getUncachedOutdatedObjects(info, index, storedData);
        return false;
      })
      info.append(button);
      return;
    }
  }

  /**
   * @param {HTMLDivElement} info
   * @param {DataIndex} index
   * @param {DataCache} storedData
   */
  function getUncachedOutdatedObjects(info, index, storedData) {
    let anyUncachedOrOutdated = false;
    /** @type {SupportedObject[]} */
    (['scenes', 'performers']).forEach((obj) => {
      const uncached = Object.entries(index[obj])
        .filter(([objId, [hash]]) => !!hash && (!Object.keys(storedData[obj]).includes(objId) || storedData[obj][objId].contentHash !== hash))
        .map(([objId, [hash]]) => {
          const outdated = storedData[obj][objId] && storedData[obj][objId].contentHash !== hash;
          const a = makeLink(`/${obj}/${objId}`, `${obj.slice(0, -1)}`, {
            display: 'inline-block',
            margin: '0 .2rem',
            color: outdated ? 'var(--orange)' : 'var(--teal)',
          });
          a.target = '_blank';
          return a;
        });
      if (uncached.length === 0) return;
      const hr = document.createElement('hr');
      hr.style.borderTopColor = '#fff';
      info.append(hr, ...uncached);
      anyUncachedOrOutdated = true;
    });

    if (anyUncachedOrOutdated) {
      /** @type {HTMLSpanElement} */
      const icon = info.parentElement.querySelector(':scope > span[title]');
      icon.innerText = '📙';
    }
  }

  async function _setUpMenu() {
    if (!isDev) return;
    //@ts-expect-error
    GM.registerMenuCommand('Refresh', async () => {
      const index = await getOrFetchDataIndex(true);
      if (index) setStatus('[backlog] index updated', 2500);
      else setStatus('[backlog] failed to get index');
    });
  }

  const setUpMenu = once(_setUpMenu);

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
   * @param {string} url
   * @param {XMLHttpRequestResponseType} responseType
   */
  async function request(url, responseType) {
    const response = await new Promise((resolve, reject) => {
      //@ts-expect-error
      GM.xmlHttpRequest({
        method: 'GET',
        url,
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
      throw error;
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
   * @param {boolean} [forceFetch=false]
   * @returns {Promise<DataIndex | null>}
   */
  async function getOrFetchDataIndex(forceFetch=false) {
    const storedDataIndex = await Cache.getStoredDataIndex();
    let shouldFetchIndex = shouldFetch(storedDataIndex, 1);
    try {
      if (!dev && !forceFetch && shouldFetchIndex) {
        // Only fetch if there really was an update
        setStatus(`[backlog] checking for updates`);
        const lastUpdated = await getDataIndexLastUpdatedDate();
        if (lastUpdated) {
          shouldFetchIndex = shouldFetch(storedDataIndex, lastUpdated);
          console.debug(
            `[backlog] data index lastest remote update: ${formatDate(lastUpdated)}`
            + ` - updating: ${shouldFetchIndex}`
          );

          // Store the last-checked timestamp as to not spam GitHub API
          storedDataIndex.lastChecked = new Date().toISOString();
          await Cache.setDataIndex(storedDataIndex);
        }
        setStatus('');
      }
    } catch (error) {
      setStatus(`[backlog] error:\n${error}`);
      console.error('[backlog] error trying to determine lastest data index update', error);
      shouldFetchIndex = shouldFetch(storedDataIndex, 2);
    }

    if (forceFetch || shouldFetchIndex) {
      setStatus(`[backlog] updating...`);
      const data = await fetchJSON(`${BASE_URL}/index.json`);
      if (data === null || 'error' in data) {
        setStatus(`[backlog] error`);
        console.error('[backlog] index error', data);
        return null;
      }
      setStatus('');
      const dataIndex = /** @type {DataIndex} */ (data);

      await applyDataIndexMigrations(dataIndex);

      const action = storedDataIndex.lastUpdated ? 'updated' : 'fetched';
      dataIndex.lastUpdated = dataIndex.lastChecked = new Date().toISOString();
      await Cache.setDataIndex(dataIndex);
      console.debug(`[backlog] index ${action}`);
      updateInfo();
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
          thisIndex[thisId] = oldValue = ['', ...oldValue.split(/,/g)];
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
      updateInfo();
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
      haystack[uuid] = [
        '',
        ...Object.keys(data).filter((k) => !ignoredContentKeys.includes(k)),
      ];
    }
    await Cache.setDataIndex(index);
    console.debug('[backlog] stored data index updated');
    updateInfo();
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
    if (!index) throw new Error('[backlog] failed to get index');

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
      setStatus(`[backlog] updating ${object.slice(0, -1)} data...`);
      try {
        return await _fetchObjectData(object, uuid, storedData, index);
      } finally {
        setStatus('');
      }
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
  unsafeWindow.backlogClearCache = exportFunction(() => isDev && backlogClearCache(unsafeWindow), unsafeWindow);

  // ===

  async function backlogRefetch(global = globalThis) {
    const { object, ident: uuid } = parsePath();

    const index = await getOrFetchDataIndex(true);
    if (!index) throw new Error('[backlog] failed to get index');

    if (!object) return false;

    if (!isSupportedObject(object) || !uuid) {
      global.console.warn(`[backlog] invalid request: <${object} ${uuid}>`);
      return false;
    }

    const storedData = await Cache.getStoredData();
    const data = await _fetchObjectData(object, uuid, storedData, index);
    if (data === null) {
      global.console.warn(`[backlog] <${object} ${uuid}> failed to refetch`);
      return false;
    }

    return true;
  }
  //@ts-expect-error
  unsafeWindow.backlogRefetch = exportFunction(() => isDev && backlogRefetch(unsafeWindow), unsafeWindow);

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
  function getImageBlob(url) {
    return request(url, 'blob');
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

    imageReady(img).then(
      () => imgRes.innerText = `${img.naturalWidth} x ${img.naturalHeight}`,
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
   * @param {string} sheetId
   * @param {string} query
   * @returns {string}
   */
  function backlogQuickViewURL(sheetId, query) {
    const search = new URLSearchParams({ gid: sheetId, tqx: 'out:html', tq: query }).toString();
    return `${backlogSpreadsheet}/gviz/tq?${search}`;
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

  /**
   * @param {Partial<CSSStyleDeclaration>} [style]
   * @returns {SVGSVGElement}
   */
  const performersIcon = (style) => {
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
    if (style) setStyles(svg, style);
    return svg;
  };

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
        setStatus('[backlog] reloading page...');
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

    if (isDev) {
      /** @type {HTMLDivElement} */
      const sceneButtons = (sceneInfo.querySelector(':scope > .card-header > .float-right'));
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

    const sceneFooter = /** @type {HTMLDivElement} */ (sceneInfo.querySelector(':scope > .card-footer'));
    if (found.performers || found.duration || found.director) {
      for (const el of sceneFooter.querySelectorAll(':scope > *')) {
        el.classList.add('my-auto');
      }
    }

    const makeAlreadyCorrectTitle = (/** @type {string} */ status='correct', /** @type {string} */ field='') =>
      `<already ${status}>${field ? ` ${field}`: ''}\nshould mark the entry on the backlog sheet as completed`;

    if (found.comments && found.comments.length > 0) {
      const comments = document.createElement('div');
      comments.classList.add('bg-info');

      found.comments.forEach((comment, index) => {
        if (index > 0) comments.append(document.createElement('br'));
        const commentElement = /^https?:/.test(comment) ? makeLink(comment) : document.createElement('span');
        commentElement.innerText = comment;
        comments.appendChild(commentElement);
      });

      sceneHeader.appendChild(comments);
    }

    if (found.duplicates || found.duplicate_of) {
      let container = document.querySelector('.StashDBContent > div.backlog');
      if (!container) {
        container = document.createElement('div');
        container.classList.add('backlog');
        sceneInfo.before(container);
        // Hook to remove it
        window.addEventListener(`${eventPrefix}_locationchange`, () => container.remove(), { once: true });
      }

      if (found.duplicates) {
        const hasDuplicates = document.createElement('div');
        hasDuplicates.classList.add('mb-1', 'p-1', 'font-weight-bold');
        hasDuplicates.innerHTML = 'This scene has duplicates:';
        found.duplicates.forEach((dupId) => {
          hasDuplicates.append(document.createElement('br'));
          const a = makeLink(`/scenes/${dupId}`, dupId, { color: 'var(--teal)', marginLeft: '1.75rem' });
          a.target = '_blank';
          a.classList.add('font-weight-normal');
          hasDuplicates.append(a);
        });
        const emoji = document.createElement('span');
        emoji.classList.add('mr-1');
        emoji.innerText = '♊';
        hasDuplicates.prepend(emoji);
        container.prepend(hasDuplicates);
      }

      if (found.duplicate_of) {
        const duplicateOf = document.createElement('div');
        duplicateOf.classList.add('mb-1', 'p-1', 'font-weight-bold');
        duplicateOf.innerText = 'This scene is a duplicate of: ';
        const a = makeLink(`/scenes/${found.duplicate_of}`, found.duplicate_of, { color: 'var(--teal)' });
        a.target = '_blank';
        a.classList.add('font-weight-normal');
        duplicateOf.append(a);
        const emoji = document.createElement('span');
        emoji.classList.add('mr-1');
        emoji.innerText = '♊';
        duplicateOf.prepend(emoji);
        container.prepend(duplicateOf);
      }
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
        titleSpan.after(arrow);

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
      const alreadyCorrectStudioId = studioId && studioId === parsePath(studioElement.href).ident;

      const newStudio = document.createElement('span');
      let title, colorClass, currentColorClass;
      if (!alreadyCorrectStudioId) {
        currentColorClass = 'bg-danger';
        if (studioId) {
          colorClass = 'bg-primary';
          title = `<pending> Studio\n${studioName ? `${studioName} (${studioId})` : studioId}`;
          newStudio.append(makeLink(`/studios/${studioId}`, studioName), ' \u{22D8}');
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
    }

    if (found.date) {
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
    }

    if (found.image) {
      /** @type {HTMLImageElement} */
      const img = (document.querySelector('.scene-photo > img'));
      const imgContainer = img.parentElement;

      // Enable CORS on the https://cdn.stashdb.org/* request
      img.crossOrigin = 'anonymous';

      const newImageBlob = getImageBlob(found.image);

      if (img.getAttribute('src')) {
        setStatus(`[backlog] fetching/comparing images...`);

        const onCurrentImageReady = async () => {
          const newImage = await compareImages(img, newImageBlob);
          imgContainer.classList.add('p-2');

          if (newImage === true) {
            imgContainer.style.backgroundColor = 'var(--pink)';
            imgContainer.title = `${makeAlreadyCorrectTitle('added')}\n\n${found.image}`;
            setStatus('');
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
            setStatus(`[backlog] error fetching/comparing images:\n${newImage}`);
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
          setStatus('');
        };

        /** @param {any} reason */
        const onCurrentImageFailed = async (reason) => {
          imgContainer.style.backgroundColor = 'var(--purple)';

          imgContainer.classList.add('p-2', 'd-flex');
          imgContainer.title = `error loading current image\n<pending>\n${found.image}`;

          const imgNewLink = makeLink(found.image, '');

          const imgNew = document.createElement('img');
          imgNew.src = URL.createObjectURL(await newImageBlob);
          setStyles(imgNew, { width: '100%', height: 'auto' });

          imgNewLink.appendChild(imgNew);

          const newImageContainer = document.createElement('div');
          newImageContainer.style.flex = 'auto';
          const imgRes = makeImageResolution(imgNew, 'right');
          newImageContainer.append(imgRes, imgNewLink);

          imgContainer.appendChild(newImageContainer);

          setStatus(`[backlog] error loading current image:\n${reason}`);
        };

        imageReady(img).then(
          onCurrentImageReady,
          onCurrentImageFailed,
        );

      } else {
        // missing image
        setStatus(`[backlog] fetching new image...`);

        imgContainer.classList.add('bg-danger', 'p-2');
        imgContainer.style.transition = 'min-height 1s ease';
        imgContainer.title = `<MISSING>\n${found.image}`;

        const imgLink = imgContainer.appendChild(makeLink(found.image, ''));
        imgLink.appendChild(img);

        /** @param {any} reason */
        const onFailure = (reason) => {
          setStyles(imgContainer, { minHeight: '0', textAlign: 'center', fontSize: '1.2em', fontWeight: '600' });
          imgLink.prepend(found.image);
          img.classList.add('d-none');
          setStatus(`[backlog] error fetching new image:\n${reason}`);
        };
        newImageBlob.then(
          (blob) => {
            const imgRes = makeImageResolution(img, 'right');
            imgContainer.prepend(imgRes);
            img.src = URL.createObjectURL(blob);
            setStatus('');
          },
          onFailure
        );
      }
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
          highlight(performer, '--danger');
          performer.classList.add('backlog-remove'); // Useful for new performers below
          if (toRemove.status) {
            performer.children[1].prepend(`[${toRemove.status}] `);
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
            highlight(performer, '--warning');
            performer.title = makeAlreadyCorrectTitle('added');
            if (!toAppend.id) {
              performer.title += '\n[missing ID - matched by name]';
              performer.style.color = 'var(--yellow)';
            }
          } else {
            highlight(performer, '--primary');
            performer.title = `<already added>\nbut needs an update to\n${entryFullName}`;
          }
          removeFrom(toAppend, append);
        }

        if (toUpdate) {
          const entryFullName = formatName(toUpdate);
          if (fullName === entryFullName) {
            highlight(performer, '--warning');
            performer.title = makeAlreadyCorrectTitle('updated');
          } else {
            const arrow = document.createElement('span');
            arrow.classList.add('mx-1');
            arrow.innerText = '\u{22D9}';
            performer.appendChild(arrow);
            performer.append(...nameElements(toUpdate));
            highlight(performer, '--primary');
            performer.title = `<pending>\nupdate to\n${entryFullName}`;
          }
          removeFrom(toUpdate, update);
        }
      });

      append.forEach((entry) => {
        const pa = makePerformerAppearance(entry);
        let hColor = '--success';
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
        highlight(pa, '--warning');
        pa.style.color = 'var(--yellow)';
        pa.title = `performer-to-remove not found. already removed?`;
        scenePerformers.appendChild(pa);
      });

      update.forEach((entry) => {
        console.warn('[backlog] entry to update not found.', entry);
        const expectedEntry = { ...entry, appearance: entry.old_appearance };
        const pa = makePerformerAppearance(expectedEntry);
        highlight(pa, '--warning');
        pa.style.color = 'var(--yellow)';
        pa.title = `performer-to-update is missing: ${formatName(expectedEntry)}.`;
        const arrow = document.createElement('span');
        arrow.classList.add('mx-1');
        arrow.innerText = '\u{22D9}';
        pa.append(arrow, ...nameElements(entry));
        scenePerformers.appendChild(pa);
      });
    }

    if (found.duration) {
      /** @type {HTMLDivElement | null} */
      let duration = (sceneFooter.querySelector(':scope > div[title $= " seconds"]'));
      const foundDuration = Number(found.duration);
      const formattedDuration = formatDuration(foundDuration);
      if (!duration) {
        const newDuration = document.createElement('b');
        newDuration.innerText = formattedDuration;
        duration = document.createElement('div');
        duration.append('<MISSING>', ' Duration: ', newDuration);
        duration.classList.add('bg-danger', 'p-1', 'my-auto');
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
    }

    if (found.director) {
      /** @type {HTMLDivElement | null} */
      let director = (sceneFooter.querySelector(':scope > div:last-of-type'));
      if (!director || !/^Director:/.test(director.innerText)) {
        const newDirector = document.createElement('b');
        newDirector.innerText = found.director;
        director = document.createElement('div');
        director.append('<MISSING>', ' Director: ', newDirector);
        director.title = '<MISSING> Director';
        director.classList.add('ml-3', 'bg-danger', 'p-1', 'my-auto');
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
          const correct = makeLink(`/scenes/${fp.correct_scene_id}`, 'correct scene', { fontWeight: 'bolder' });
          row.children[headers.submissions].append(' | ', correct);
        }
        return true;
      }).length;
      const notFound = found.fingerprints.length - matches;

      if (matches || notFound) {
        const fpInfo = document.createElement('div');
        fpInfo.classList.add('float-right', 'my-2', 'd-flex', 'flex-column');

        const backlogSheetId = '357846927'; // Fingerprints
        const quickViewLink = makeLink(
          backlogQuickViewURL(
            backlogSheetId,
            `select B,G,H,I,J,K where F="${sceneId}" label B "Done", H "Hash", I "✨Correct Scene ID"`,
          ),
          'quick view',
          { color: 'var(--teal)' },
        );
        const sheetLink = makeLink(
          `${backlogSpreadsheet}/edit#gid=${backlogSheetId}`,
          'Fingerprints backlog sheet',
          { color: 'var(--red)' },
        );

        const backlogInfo = document.createElement('span');
        backlogInfo.classList.add('text-right');
        backlogInfo.append(sheetLink, ' (', quickViewLink, ')');
        fpInfo.append(backlogInfo);

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
        document.querySelector('nav[role="tablist"]').before(fpInfo);
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

      if (field === 'duplicate_of' || field === 'duplicates') {
        const value = found[field];
        const values = Array.isArray(value) ? value : [value];
        dt.innerText = field.replace(/_/g, ' ');

        values.map((dupId, index) => {
          if (index > 0) dd.append(document.createElement('br'));
          const a = makeLink(`/scenes/${dupId}`, dupId, { color: 'var(--teal)' });
          a.target = '_blank';
          dd.append(a);
        });
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
              const a = makeLink(`/performers/${entry.id}`, name, { color: 'var(--teal)' });
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

              /** @type {HTMLInputElement} */
              const fieldEl = sceneFormCol.querySelector(`input[placeholder="${entry.name}"]`);
              if (fieldEl) {
                const set = document.createElement('a');
                set.innerText = 'set alias';
                setStyles(set, { marginLeft: '.5rem', color: 'var(--yellow)', cursor: 'pointer', fontWeight: '700' });
                set.addEventListener('click', () => {
                  fieldEl.value = entry.appearance || '';
                  fieldEl.dispatchEvent(new Event('input'));
                });
                a.after(set);
              }
            } else {
              const a = makeLink(`/performers/${entry.id}`, name + appearance, { color: 'var(--teal)' });
              a.target = '_blank';
              info.appendChild(a);
              if (action === 'append') {
                const uuid = createSelectAllSpan(entry.id);
                uuid.style.fontSize = '.9rem';
                info.append(document.createElement('br'), uuid);
              }
              if (entry.status) {
                a.before(`<${entry.status}> `);
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
        const a = makeLink(`/studios/${studioId}`, studioName, { color: 'var(--teal)' });
        a.target = '_blank';
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
        const imgLink = makeLink(image, '', { color: 'var(--teal)' });
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
          if (index > 0) dd.append(document.createElement('br'));
          const fpElement = document.createElement('span');
          const fpHash = createSelectAllSpan(fp.hash);
          fpHash.style.marginLeft = '.5rem';
          fpElement.append(fp.algorithm.toUpperCase(), fpHash);
          if (fp.correct_scene_id) {
            const correct = makeLink(`/scenes/${fp.correct_scene_id}`, 'correct scene', { color: 'var(--teal)' });
            correct.target = '_blank';
            fpElement.append(' \u{22D9} ', correct, ': ', createSelectAllSpan(fp.correct_scene_id));
          }
          dd.appendChild(fpElement);
        });
        return;
      }

      if (field === 'comments') {
        found[field].forEach((comment, index) => {
          if (index > 0) dd.append(document.createElement('br'));
          const commentElement =
            /^https?:/.test(comment)
              ? makeLink(comment, null, { color: 'var(--teal)' })
              : document.createElement('span');
          commentElement.innerText = comment;
          dd.appendChild(commentElement);
        });
        return;
      }

      if (field === 'lastUpdated') {
        const hr = document.createElement('span');
        hr.classList.add('mt-4');
        hr.style.borderTopColor = 'initial';
        dt.before(hr);
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
      highlightSceneCards('performers');
      return;
    } else {
      markerDataset.backlogInjected = 'true';
    }

    const index = await getOrFetchDataIndex();
    if (!index) return;

    highlightSceneCards('performers', index);

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

    // Performer scene changes based on cached data (could be out-of-date)
    await (async function () {
      const { scenes: storedScenes } = await Cache.getStoredData();
      /** @typedef {[sceneId: string, entry: PerformerEntry]} performerScene */
      /** @type {{ append: performerScene[], remove: performerScene[] }} */
      const performerScenes = { append: [], remove: [] };
      for (const [sceneId, scene] of Object.entries(storedScenes)) {
        if (!scene.performers) continue;
        const { append, remove } = scene.performers;
        const appendEntry = append.find(({ id }) => id === performerId);
        if (appendEntry) {
          performerScenes.append.push([sceneId, appendEntry]);
        }
        const removeEntry = remove.find(({ id }) => id === performerId);
        if (removeEntry) {
          const targetEntry = append.find(({ appearance, name }) => {
            if (appearance) return [appearance, name].includes(removeEntry.name);
            return name.split(/\b/)[0] === removeEntry.name.split(/\b/)[0];
          });
          performerScenes.remove.push([sceneId, targetEntry]);
        }
      }

      if (performerScenes.append.length === 0 && performerScenes.remove.length === 0) return;

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
      };
      const actionPrefix = {
        append: '\u{FF0B}', // ＋
        remove: '\u{FF0D}', // －
      };

      const sceneChanges = document.createElement('div');
      sceneChanges.classList.add('mb-1', 'p-1', 'font-weight-bold');
      sceneChanges.innerHTML = 'This performer has pending scene changes: (info may be outdated or incomplete)';
      for (const [actionStr, scenes] of Object.entries(performerScenes)) {
        if (scenes.length === 0) continue;
        const action = /** @type {'append' | 'remove'} */ (actionStr);
        const details = document.createElement('details');
        details.style.marginLeft = '1.5rem';
        const summary = document.createElement('summary');
        setStyles(summary, { color: 'tan', width: 'max-content' });
        summary.innerText = `${actionPrefix[action]} ${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
        details.append(summary);
        const sceneLinks = document.createElement('div');
        setStyles(sceneLinks, { marginLeft: '1.3rem', fontWeight: 'normal' });
        scenes
          .sort(([, a], [, b]) => pName[action](a).localeCompare(pName[action](b)))
          .forEach(([sceneId, entry], idx) => {
            if (idx > 0) sceneLinks.append(document.createElement('br'));
            const a = makeLink(`/scenes/${sceneId}`, sceneId, {
              color: 'var(--teal)',
              fontFamily: 'monospace',
              fontSize: '16px',
            });
            a.target = '_blank';
            sceneLinks.append(a);
            if (action === 'append') sceneLinks.append(` (as ${pName[action](entry)})`);
            if (action === 'remove' && entry) {
              const pLink = entry.id
                ? makeLink(`/performers/${entry.id}`, pName[action](entry), { color: 'var(--teal)' })
                : pName[action](entry);
              sceneLinks.append(' (target: ', pLink, ')');
            }
          });
        details.append(sceneLinks);
        sceneChanges.append(details);
      }
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '🎥';
      sceneChanges.prepend(emoji);
      performerInfo.prepend(sceneChanges);
      highlightElements.push(sceneChanges);
    })();

    const found = index.performers[performerId];
    if (!found) return;

    const info = found.slice(1);

    if (info.includes('split')) {
      const toSplit = document.createElement('div');
      toSplit.classList.add('mb-1', 'p-1', 'font-weight-bold');
      toSplit.style.transition = 'background-color .5s';

      const backlogSheetId = '1067038397'; // Performers To Split Up
      const quickViewLink = makeLink(
        backlogQuickViewURL(
          backlogSheetId,
          `select A,B,E,F,G,H,I,J,K,L,M,N,O,P where D="${performerId}" label A "Done", F "Notes"`,
        ),
        'quick view',
        { color: 'var(--teal)' },
      );
      const sheetLink = makeLink(
        `${backlogSpreadsheet}/edit#gid=${backlogSheetId}`,
        'Performers To Split Up',
        { color: 'var(--orange)' },
      );
      toSplit.append('This performer is listed on ', sheetLink, '. (', quickViewLink, ')');
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
        hasDuplicates.append(document.createElement('br'));
        const a = makeLink(`/performers/${dupId}`, dupId, { color: 'var(--teal)', marginLeft: '1.75rem' });
        a.target = '_blank';
        a.classList.add('font-weight-normal');
        hasDuplicates.append(a);

        if (isMarkedForSplit(dupId)) a.after(' 🔀 needs to be split up');
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
      const a = makeLink(`/performers/${foundData.duplicate_of}`, foundData.duplicate_of, { color: 'var(--teal)' });
      a.target = '_blank';
      a.classList.add('font-weight-normal');
      duplicateOf.append(a);
      if (isMarkedForSplit(foundData.duplicate_of)) a.after(' 🔀 needs to be split up');
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
    const style = '0.4rem solid';
    if (changes.length === 1) {
      if (changes[0] === 'duplicate_of' || changes[0] === 'duplicates') {
        return `${style} var(--indigo)`;
      }
      if (changes[0] === 'fingerprints') {
        return `${style} var(--cyan)`;
      }
    }
    return `${style} var(--yellow)`;
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

        sceneCardHighlightChanges(card, changes);
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
          sceneCardHighlightChanges(card, changes);
        } else if (object === 'performers') {
          cardLink.title = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
        }
      }
    });
  }

  /**
   * Field-specific scene card highlighting
   * @param {HTMLDivElement} card
   * @param {string[]} changes
   */
  function sceneCardHighlightChanges(card, changes) {
    if (!isDev) return;

    /** @type {HTMLDivElement | HTMLAnchorElement} */
    const parent = (card.parentElement);
    const isSearchCard = parent.classList.contains('SearchPage-scene');

    if (changes.includes('image')) {
      const imageColor = 'var(--primary)';
      /** @type {HTMLImageElement} */
      const img = card.querySelector(
        !isSearchCard
          ? '.SceneCard-image > img'
          : ':scope > img.SearchPage-scene-image'
      );
      if (img.getAttribute('src')) {
        if (!isSearchCard) {
          const marker = document.createElement('div');
          marker.style.borderTop = `0.4em solid ${imageColor}`;
          const footer = /** @type {HTMLDivElement} */ (card.querySelector('.card-footer'));
          card.insertBefore(marker, footer);
        } else {
          img.style.outline = `0.4em solid ${imageColor}`;
        }
      } else {
        img.style.backgroundColor = imageColor;
        if (isSearchCard) img.style.visibility = 'unset';
      }
    }

    const color = 'var(--yellow)';

    if (changes.includes('title')) {
      if (!isSearchCard) {
        /** @type {HTMLHeadingElement} */
        const title = card.querySelector('.SceneCard-title');
        if (title.textContent) {
          title.style.color = color;
        } else {
          setStyles(title, { backgroundColor: color, height: '1.2rem' });
        }
      } else {
        /** @type {HTMLHeadingElement} */
        const titleEl = card.querySelector('h5');
        /** @type {Text} */
        const titleNode = (titleEl.childNodes[0]);
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
          ? '.SceneCard-title + span'
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
        card.querySelector('a.SceneCard-image')
          .append(
            performersIcon({
              color,
              fontSize: '2em',
              position: 'absolute',
              left: '4px',
              bottom: '72px',
              filter: 'drop-shadow(3px 3px 2px rgba(0, 0, 0, .7))',
            })
          );
      } else {
        const icon = card.querySelector('div > svg[data-icon="users"]');
        const performers = icon ? icon.parentElement : document.createElement('div');
        performers.style.color = color;
        if (!icon) {
          performers.innerText = '???';
          performers.prepend(performersIcon());
          card.querySelector('h5 + div').append(performers);
        }
      }
    }
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
