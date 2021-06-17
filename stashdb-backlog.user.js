// ==UserScript==
// @name      StashDB Backlog
// @author    peolic
// @version   1.16.2
// @namespace https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @updateURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @grant     GM.setValue
// @grant     GM.getValue
// @grant     GM.deleteValue
// @grant     GM.openInTab
// @include   https://stashdb.org/*
// ==/UserScript==

//@ts-check

const dev = false;

async function inject() {
  const BASE_URL =
    dev
      ? 'http://localhost:8000'
      : 'https://raw.githubusercontent.com/peolic/stashdb_backlog_data/main';

  const urlRegex = new RegExp(
    String.raw`(?:/([a-z]+)`
      + String.raw`(?:/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w\d.-]+)`
        + String.raw`(?:/([a-z]+)`
        + String.raw`)?`
      + String.raw`)?`
    + String.raw`)?`
  );

  /**
   * @typedef {'scenes' | 'performers' | 'studios' | 'tags' | 'categories' | 'edits' | 'users' | 'search'} PluralObject
   */
  /**
   * @typedef LocationData
   * @property {PluralObject | null} object
   * @property {string | null} ident
   * @property {string | null} action
   */
  /**
   * @param {string} [inputUrl]
   * @returns {LocationData}
   */
  const parsePath = (inputUrl=undefined) => {
    const { pathname } = inputUrl ? new URL(inputUrl) : window.location;

    const result = {
      object: null,
      ident: null,
      action: null,
    };

    if (!pathname) return result;

    const match = urlRegex.exec(pathname);
    if (!match || match.length === 0) return null;

    result.object = match[1] || null;
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

  /**
   * @param {string} selector
   * @param {number} [timeout] fail after, in milliseconds
   */
   const elementReadyIn = (selector, timeout = undefined) => {
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

    if (loc.object === 'scenes') {
      if (loc.ident) {
        // Scene page
        if (!loc.action) return await iScenePage(loc.ident);
        // Scene edit page
        else if (loc.action === 'edit') return await iSceneEditPage(loc.ident);
      } else {
        // Main scene cards list
        return await highlightSceneCards(loc.object);
      }
    }

    // Scene cards lists on Studio/Tag pages
    if (['studios', 'tags'].includes(loc.object) && loc.ident && !loc.action) {
      return await highlightSceneCards(loc.object);
    }

    if (loc.object === 'performers' && loc.ident && !loc.action) {
      await iPerformerPage(loc.ident);
      await highlightSceneCards(loc.object);
      return;
    }

    // Search results
    if (loc.object === 'search') {
      return await highlightSearchResults();
    }

    // Home page
    if (!loc.object && !loc.ident && !loc.action) {
      return await highlightSceneCards(loc.object);
    }

    const identAction = loc.ident ? `${loc.ident}/${loc.action}` : `${loc.action}`;
    console.debug(`[backlog] nothing to do for ${loc.object}/${identAction}.`);
  }

  let dispatchEnabled = true;

  window.addEventListener('locationchange', () => {
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
   * @typedef FetchError
   * @property {boolean} error
   * @property {number} status
   * @property {string | null} body
   */

  /**
   * @param {string} url
   * @returns {Promise<DataIndex | DataObject | FetchError | null>}
   */
  async function fetchJSON(url) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        referrerPolicy: 'same-origin',
      });
      if (!response.ok) {
        const body = await response.text();
        console.error('[backlog] fetch bad response', response.status, response.url);
        console.debug(body);
        return { error: true, status: response.status, body };
      }
      const data = await response.json();
      return data;

    } catch (error) {
      console.error('[backlog] fetch error', url, error);
      return null;
    }
  }

  /**
   * @param {DataObject} storedObject
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

  const DATA_INDEX_KEY = 'stashdb_backlog_index';

  /**
   * @typedef DataIndex
   * @property {ScenesIndex} scenes
   * @property {PerformersIndex} performers
   * @property {string} [lastUpdated]
   */
  /**
   * @typedef {{ [uuid: string]: string[] }} ScenesIndex
   */
  /**
   * @typedef {{ [uuid: string]: string[] }} PerformersIndex
   */
  /**
   * @param {boolean} [forceFetch=false]
   * @returns {Promise<DataIndex>}
   */
  async function getDataIndex(forceFetch=false) {
    //@ts-expect-error
    const storedDataIndex = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
    if (!storedDataIndex) {
      throw new Error("[backlog] invalid stored data");
    }
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
            //@ts-expect-error
            await GM.setValue(DATA_INDEX_KEY, JSON.stringify(storedDataIndex));
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

      applyDataIndexMigrations(dataIndex);

      const action = storedDataIndex.lastUpdated ? 'updated' : 'fetched';
      dataIndex.lastUpdated = new Date().toISOString();
      //@ts-expect-error
      await GM.setValue(DATA_INDEX_KEY, JSON.stringify(dataIndex));
      console.debug(`[backlog] index ${action}`);
      return dataIndex;
    } else {
      console.debug('[backlog] using stored index');
      return storedDataIndex;
    }
  }

  /**
   * Mutates `dataIndex`
   * @param {DataIndex | {
   *  scenes: { [uuid: string]: string },
   *  performers: { [uuid: string]: string }
   * }} dataIndex
   */
  function applyDataIndexMigrations(dataIndex) {
    console.debug('[backlog] migration: convert comma-separated to array');
    for (const key in dataIndex) {
      if (key === 'lastUpdated') continue;
      const thisIndex = dataIndex[/** @type {SupportedPluralObject} */ (key)];
      for (const thisId in thisIndex) {
        let oldValue = thisIndex[thisId];
        if (typeof oldValue === 'string') {
          thisIndex[thisId] = oldValue = [''].concat(...oldValue.split(/,/g));
        }
      }
    }
  }

  /** @typedef {'scene' | 'performer'} SupportedObject */
  /** @typedef {'scenes' | 'performers'} SupportedPluralObject */

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @returns {string}
   */
  const makeObjectKey = (object, uuid) => `${object}/${uuid}`;
  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @returns {string}
   */
  const makeDataUrl = (object, uuid) => `${BASE_URL}/${object}s/${uuid.slice(0, 2)}/${uuid}.json`;

  /**
   * @typedef {{ [field: string]: any } & { contentHash?: string, lastUpdated?: string }} DataObject
   */
  const DATA_KEY = 'stashdb_backlog';

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @param {{ [uuid: string]: DataObject}} storedData
   * @param {DataIndex} index
   * @returns {Promise<DataObject | null>}
   */
  const _fetchObject = async (object, uuid, storedData, index) => {
    const data = await fetchJSON(makeDataUrl(object, uuid));
    if (data && 'error' in data && data.status === 404) {
      // remove from data index
      const removedIndex = await _removeCachedIndexEntry(object, uuid, index);
      // remove from data
      const removedData = await _removeCachedObjectData(object, uuid, storedData);

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

    const haystack = index[/** @type {SupportedPluralObject} */ (`${object}s`)];
    const indexEntry = haystack[uuid];

    const action = storedData.lastUpdated ? 'updated' : 'fetched';
    const dataObject = /** @type {DataObject} */ (data);
    dataObject.contentHash = indexEntry[0];
    dataObject.lastUpdated = new Date().toISOString();
    storedData[makeObjectKey(object, uuid)] = dataObject;
    //@ts-expect-error
    await GM.setValue(DATA_KEY, JSON.stringify(storedData));
    console.debug(`[backlog] <${object} ${uuid}> data ${action}`);

    // add to data index if not present
    if (haystack[uuid] === undefined) {
      haystack[uuid] = [''].concat(
        Object.keys(data)
          .filter((k) => !['contentHash', 'lastUpdated', 'comments'].includes(k))
      );
    }
    //@ts-expect-error
    await GM.setValue(DATA_INDEX_KEY, JSON.stringify(index));
    console.debug('[backlog] stored data index updated');

    return dataObject;
  };

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @param {DataIndex} [storedIndex]
   * @returns {Promise<boolean>}
   */
  async function _removeCachedIndexEntry(object, uuid, storedIndex = undefined) {
    if (!storedIndex) {
      //@ts-expect-error
      storedIndex = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
      if (!storedIndex) return false;
    }

    const haystack = storedIndex[`${object}s`];

    let removed = false;
    if (haystack[uuid] !== undefined) {
      delete haystack[uuid];
      removed = true;
    }
    //@ts-expect-error
    await GM.setValue(DATA_INDEX_KEY, JSON.stringify(storedIndex));

    return removed;
  }

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @param {{ [uuid: string]: DataObject}} [storedData]
   * @returns {Promise<boolean>}
   */
  async function _removeCachedObjectData(object, uuid, storedData = undefined) {
    if (!storedData) {
      //@ts-expect-error
      storedData = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
      if (!storedData) return false;
    }

    const key = makeObjectKey(object, uuid);
    if (storedData[key]) {
      delete storedData[key];
      //@ts-expect-error
      await GM.setValue(DATA_KEY, JSON.stringify(storedData));
      return true;
    }

    return false;
  }

  /**
   * @param {SupportedObject} object
   * @param {string} uuid
   * @param {DataIndex} [index]
   * @returns {Promise<DataObject | null>}
   */
  async function getDataFor(object, uuid, index = undefined) {
    if (!index) index = await getDataIndex();
    if (!index) throw new Error("[backlog] failed to get index");

    const haystack = index[/** @type {SupportedPluralObject} */ (`${object}s`)];
    if (haystack[uuid] === undefined) {
      // Clear outdated
      if (await _removeCachedObjectData(object, uuid)) {
        console.debug(`[backlog] <${object} ${uuid}> cleared from cache (not found in index)`);
      }
      return null;
    }

    //@ts-expect-error
    const storedData = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    if (!storedData) {
      throw new Error("[backlog] invalid stored data");
    }

    const indexEntry = haystack[uuid];
    const contentHash = indexEntry[0];
    const key = makeObjectKey(object, uuid);

    // for performers, empty content hash = no file, usually
    if (object === 'performer' && contentHash === '' && !storedData[key]) {
      return null;
    }

    if (shouldFetch(storedData[key], contentHash)) {
      return await _fetchObject(object, uuid, storedData, index);
    }

    console.debug(`[backlog] <${object} ${uuid}> using stored data`);
    return storedData[key];
  }

  // ===

  async function backlogClearCache(global = globalThis) {
    //@ts-expect-error
    await GM.deleteValue(DATA_INDEX_KEY);
    //@ts-expect-error
    await GM.deleteValue(DATA_KEY);
    global.console.info('[backlog] stored data cleared');
  }
  //@ts-expect-error
  unsafeWindow.backlogClearCache = exportFunction(() => isDev() && backlogClearCache(unsafeWindow), unsafeWindow);

  // ===

  async function backlogRefetch(global = globalThis) {
    const { object: pluralObject, ident: uuid } = parsePath();

    //@ts-expect-error
    const storedData = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    if (!storedData) {
      throw new Error("[backlog] invalid stored data");
    }

    const index = await getDataIndex(true);
    if (!index) throw new Error("[backlog] failed to get index");

    if (!pluralObject) return false;

    if (!['scenes', 'performers'].includes(pluralObject) || !uuid) {
      global.console.warn(`[backlog] invalid request: <${pluralObject} ${uuid}>`);
      return false;
    }

    /** @type {SupportedObject} */
    const object = (pluralObject.slice(0, -1));

    const data = await _fetchObject(object, uuid, storedData, index);
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
    //@ts-expect-error
    const index = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
    global.console.info('index', index);
    //@ts-expect-error
    const data = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    global.console.info('data', data);
  }
  //@ts-expect-error
  unsafeWindow.backlogCacheReport = exportFunction(() => backlogCacheReport(unsafeWindow), unsafeWindow);

  // =====

  /**
   * @param {string} url Image URL
   * @param {boolean} [asData=false] As data URI or as a blob
   */
  async function getImage(url, asData=false) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      referrerPolicy: 'same-origin',
    });
    const data = await response.blob();
    if (!asData) {
      return URL.createObjectURL(data);
    }

    const reader = new FileReader();
    reader.readAsDataURL(data);
    return new Promise((resolve) => {
      reader.addEventListener('loadend', () => {
        resolve(reader.result);
      });
    });
  }

  /**
   * @param {HTMLImageElement} img
   * @param {string} newImageURL
   * @returns {Promise<string | null | Error>} New image data URI or null if the same image
   */
  async function compareImages(img, newImageURL) {
    try {
      // https://stackoverflow.com/a/62575556
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = img.naturalHeight;
      canvas.width = img.naturalWidth;
      context.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      const dataURI = canvas.toDataURL();
      const newDataURI = await getImage(newImageURL, true);
      return dataURI === newDataURI ? null : newDataURI;
    } catch (error) {
      return error;
    }
  }

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

  const genderIcon = (/** @type {boolean} */ fixStyle) => {
    const svg = document.createElement('svg');
    svg.outerHTML = (
      '<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="venus-mars"'
    + ' class="svg-inline--fa fa-venus-mars fa-w-18 " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">'
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
    if (fixStyle) svg.setAttribute('style', svgStyleFix);
    return svg;
  };

  /**
   * @param {DataObject | null} data
   * @param {Element} target Checks `target` for existence of button
   * @returns {HTMLButtonElement}
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
      button.style.backgroundColor = result ? 'yellow' : 'var(--gray-dark)';
      button.style.fontWeight = '800';
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

    const found = await getDataFor('scene', sceneId);

    if (isDev()) {
      const sceneButtons = document.querySelector('.scene-info > .card-header > .float-right');
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

      /** @type {string[]} */
      (found.comments).forEach((comment, index) => {
        if (index > 0) comments.insertAdjacentHTML('beforeend', '<br>');
        let commentElement;
        if (/https?:/.test(comment)) {
          commentElement = document.createElement('a');
          commentElement.href = comment;
          commentElement.target = '_blank';
          commentElement.rel = 'nofollow noopener noreferrer';
        } else {
          commentElement = document.createElement('span');
        }
        commentElement.innerText = comment;
        comments.appendChild(commentElement);
      });

      sceneHeader.appendChild(comments);
    }

    if (found.title) {
      /** @type {HTMLHeadingElement | null} */
      const title = (document.querySelector('.scene-info h3'));
      const currentTitle = title.innerText;
      if (!currentTitle) {
        title.classList.add('bg-danger', 'p-1');
        title.innerText = found.title;
        title.title = '<MISSING> Title';

        const status = document.createElement('span');
        status.classList.add('mr-2');
        status.style.fontSize = '1.25rem';
        status.innerText = '<MISSING> \u{1F87A}';
        title.insertAdjacentElement('afterbegin', status);
      } else if (currentTitle === found.title) {
        title.classList.add('bg-warning', 'p-1');
        title.title = makeAlreadyCorrectTitle('correct', 'Title');

        const status = document.createElement('span');
        status.classList.add('mr-2');
        status.style.fontSize = '1.25rem';
        status.innerText = '<already correct> \u{1F87A}';
        title.insertAdjacentElement('afterbegin', status);
      } else {
        title.title = `<pending> Title`;
        // convert title text node to element
        const titleSpan = document.createElement('span');
        titleSpan.append(title.childNodes[0]);
        titleSpan.classList.add('bg-danger', 'p-1');
        title.insertAdjacentElement('afterbegin', titleSpan);

        const arrow = document.createElement('span');
        arrow.classList.add('mx-2');
        arrow.style.fontSize = '1.25rem';
        arrow.innerText = '\u{1F87A}';
        titleSpan.insertAdjacentElement('afterend', arrow);

        const newTitle = document.createElement('span');
        newTitle.classList.add('bg-primary', 'p-1');
        newTitle.style.fontSize = '1.25rem';
        newTitle.innerText = found.title;
        title.insertAdjacentElement('beforeend', newTitle);
      }
    }

    if (found.date || found.studio) {
      const studio_date = /** @type {HTMLHeadingElement | null} */ (sceneHeader.querySelector(':scope > h6'));

      const studioElement = studio_date.querySelector('a');
      const dateNode = Array.from(studio_date.childNodes).slice(-1)[0];
      const separator = studio_date.querySelector('span.mx-1');

      if (found.studio) {
        const [studioId, studioName] = found.studio;
        const alreadyCorrectStudioId = studioId === parsePath(studioElement.href).ident;

        const newStudio = document.createElement('span');
        let title, colorClass, currentColorClass;
        if (!alreadyCorrectStudioId) {
          colorClass = 'bg-primary';
          currentColorClass = 'bg-danger';
          title = `<pending> Studio\n${studioName ? `${studioName} (${studioId})` : studioId}`;
          newStudio.innerHTML = `<a href="/studios/${studioId}">${escapeHTML(studioName)}</a> \u{1F878}`;
        } else {
          colorClass = 'bg-warning';
          currentColorClass = 'bg-warning';
          title = makeAlreadyCorrectTitle('correct', 'Studio');
          newStudio.innerText = '<already correct> \u{1F87A}';
        }

        newStudio.classList.add(colorClass, 'p-1');
        newStudio.title = title;
        studioElement.title = title;
        studioElement.classList.add(currentColorClass, 'p-1');
        studioElement.insertAdjacentElement('beforebegin', newStudio);
      }

      if (found.date) {
        const alreadyCorrectDate = found.date === dateNode.nodeValue.trim();

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
          newDate.innerText = `\u{1F87A} ${found.date}`;
        } else {
          colorClass = 'bg-warning';
          currentColorClass = 'bg-warning';
          title = makeAlreadyCorrectTitle('correct', 'Date');
          newDate.innerText = '\u{1F878} <already correct>';
        }

        newDate.classList.add(colorClass, 'p-1');
        newDate.title = title;
        dateElement.title = title;
        dateElement.classList.add('bg-danger', 'p-1');
        dateElement.insertAdjacentElement('afterend', newDate);
      }
    }

    if (found.image) {
      /** @type {HTMLImageElement} */
      const img = (document.querySelector('.scene-photo > img'));
      const imgContainer = img.parentElement;

      if (img.getAttribute('src')) {
        const handleExistingImage = async () => {
          const newImage = await compareImages(img, found.image);
          if (newImage instanceof Error) {
            imgContainer.classList.add('bg-danger', 'p-2');
            imgContainer.title = 'error comparing image';
            console.error('[backlog] error comparing image', newImage);
            return;
          }

          imgContainer.classList.add('bg-warning', 'p-2');
          imgContainer.title = `<pending>\n${found.image}`;
          if (newImage === null) {
            imgContainer.style.backgroundColor = 'var(--pink)';
            imgContainer.classList.remove('bg-warning');
            imgContainer.title = `${makeAlreadyCorrectTitle('added')}\n\n${found.image}`;
          } else {
            imgContainer.classList.add('d-flex');

            const imgNewLink = document.createElement('a');
            imgNewLink.href = found.image;
            imgNewLink.target = '_blank';
            imgNewLink.rel = 'nofollow noopener noreferrer';

            const imgNew = document.createElement('img');
            imgNew.src = newImage;

            // const isVertical = img.naturalHeight > img.naturalWidth;
            img.style.flex = '50%';
            imgNewLink.style.flex = '50%';
            imgNew.style.borderLeft = '.5rem solid var(--warning)';
            imgNew.style.width = '100%';
            imgNew.style.height = 'auto';

            imgNewLink.appendChild(imgNew);

            imgContainer.appendChild(imgNewLink);
          }
        };

        if (img.complete && img.naturalHeight !== 0) handleExistingImage();
        else img.addEventListener('load', handleExistingImage, { once: true });

      } else {
        // missing image
        imgContainer.classList.add('bg-danger', 'p-2');
        imgContainer.title = `<MISSING>\n${found.image}`;
        // img.src = found.image;
        imgContainer.addEventListener('mouseover', () => imgContainer.style.cursor = 'pointer');
        imgContainer.addEventListener('mouseout', () => imgContainer.removeAttribute('style'));
        //@ts-expect-error
        imgContainer.addEventListener('click', () => GM.openInTab(found.image, false));
        getImage(found.image).then((blobURL) => {
          img.src = blobURL;
        });
      }
    }

    if (found.performers) {
      const remove = Array.from(found.performers.remove); // shallow clone
      const append = Array.from(found.performers.append); // shallow clone
      const update = Array.from(found.performers.update || []); // shallow clone

      const removeFrom = (entry, from) => {
        const index = from.indexOf(entry);
        if (index === -1) console.error('[backlog] entry not found', entry, 'in', from);
        from.splice(index, 1);
      };

      const parsePerformerAppearance = (/** @type {HTMLAnchorElement} */ pa) => {
        const { ident: uuid } = parsePath(pa.href);
        const fullName = Array.from(pa.childNodes).slice(1).map((n) => n.textContent).join(' ');
        return { uuid, fullName };
      };

      const formatName = (entry) => {
        const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
        if (!entry.appearance) return entry.name + disambiguation;
        return entry.appearance + ` (${entry.name})` + disambiguation;
      };

      const makePerformerAppearance = (entry) => {
        const pa = document.createElement('a');
        pa.classList.add('scene-performer');
        if (entry.id) {
          pa.href = `/performers/${entry.id}`;
        }

        const formattedName =
          !entry.appearance
            ? `<span>${escapeHTML(entry.name)}</span>`
            : `<span>${escapeHTML(entry.appearance)}</span><small class="ml-1 text-small text-muted">(${escapeHTML(entry.name)})</small>`;
        const dsmbg =
          !entry.disambiguation
            ? ''
            : `<small class="ml-1 text-small text-muted">(${escapeHTML(entry.disambiguation)})</small>`;

        pa.insertAdjacentElement('beforeend', genderIcon(existingPerformers.length === 0));
        pa.insertAdjacentText('beforeend', entry.id ? '' : `[${entry.status}] `);
        pa.insertAdjacentHTML('beforeend', formattedName + dsmbg);
        return pa;
      };

      const highlight = (/** @type {HTMLElement} */ e, /** @type {string} */ v) => {
        // e.classList.add(`bg-${v}`, 'p-1');

        e.style.border = `6px solid var(--${v})`;
        e.style.borderRadius = '6px';
        e.style.padding = '.25rem';
      };

      const scenePerformers = document.querySelector('.scene-info .scene-performers');
      const existingPerformers = (
        /** @type {HTMLAnchorElement[]} */
        (Array.from(scenePerformers.querySelectorAll(':scope > a.scene-performer')))
      );

      existingPerformers.forEach((performer) => {
        const { uuid, fullName } = parsePerformerAppearance(performer);
        const toRemove = remove.find((e) => e.id === uuid) || null;
        const toAppend = append.find((e) => e.id === uuid) || null;
        const toUpdate = update.find((e) => e.id === uuid) || null;

        if (toRemove) {
          highlight(performer, 'danger');
          if (toRemove.status) {
            performer.children[1].insertAdjacentText('afterbegin', `[${toRemove.status}] `);
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
          removeFrom(toRemove, remove);
        }

        if (toAppend) {
          const entryFullName = formatName(toAppend);
          if (fullName === entryFullName) {
            highlight(performer, 'warning');
            performer.title = makeAlreadyCorrectTitle('added');
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
        duration.classList.add('bg-danger', 'p-1');
        duration.title = `Duration is missing; ${foundDuration} seconds`;
        document.querySelector('.scene-info .scene-performers').insertAdjacentElement('afterend', duration);
      } else {
        if (found.duration == duration.title.match(/(\d+)/)[1]) {
          duration.classList.add('bg-warning', 'p-1');
          duration.insertAdjacentText('afterbegin', '<already correct> ');
          duration.title = `${makeAlreadyCorrectTitle('correct')}; ${foundDuration} seconds`;
        } else {
          duration.classList.add('bg-primary', 'p-1');
          duration.insertAdjacentText('beforeend', ` \u{1F87A} ${formattedDuration}`);
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
        director.classList.add('ml-3', 'bg-danger', 'p-1');
        document.querySelector('.scene-info > .card-footer').insertAdjacentElement('beforeend', director);
      } else {
        if (found.director === director.innerText.match(/^Director: (.+)$/)[1]) {
          director.classList.add('bg-warning', 'p-1');
          director.insertAdjacentText('afterbegin', '<already correct> ');
          director.title = makeAlreadyCorrectTitle('correct');
        } else {
          director.classList.add('bg-primary', 'p-1');
          director.insertAdjacentText('beforeend', ` \u{1F87A} ${found.director}`);
          director.title = `<pending> Director\n${found.director}`;
        }

      }
    }

    if (found.details) {
      /** @type {HTMLDivElement} */
      const desc = (document.querySelector('.scene-description > h4 + div'));
      if (!desc.innerText.trim()) {
        desc.innerText = `<MISSING> ${found.details}`;
        desc.classList.add('bg-danger');
      } else {
        desc.classList.add('bg-warning');
        desc.title = `<pending>\n${found.details}`;
      }
    }

    if (found.url) {
      /** @type {HTMLAnchorElement} */
      const studio_url = (document.querySelector('.scene-description > div:last-of-type > a'));
      studio_url.classList.add('bg-warning');
      studio_url.title = `<pending>\n${found.url}`;
    }

    if (found.fingerprints) {
      // Parse current
      /** @type {HTMLTableRowElement[]} */
      const fingerprintsTableRows = (Array.from(document.querySelectorAll('.scene-fingerprints > table tr')));
      /** @type {{ algorithm?: number, hash?: number, duration?: number, submissions?: number }} */
      const headers = {};
      const currentFingerprints = fingerprintsTableRows.map((row, rowIndex) => {
        /** @type {HTMLTableCellElement[]} */
        const cells = (Array.from(row.children));

        if (rowIndex === 0) {
          cells.forEach((cell, cellIndex) => {
            if (cell.innerText === 'Algorithm') headers.algorithm = cellIndex;
            else if (cell.innerText === 'Hash') headers.hash = cellIndex;
            else if (cell.innerText === 'Duration') headers.duration = cellIndex;
            else if (cell.innerText === 'Submissions') headers.submissions = cellIndex;
          });
          return;
        }

        return {
          row,
          algorithm: cells[headers.algorithm].innerText,
          hash: cells[headers.hash].innerText,
          duration: cells[headers.duration].innerText,
          submissions: cells[headers.submissions].innerText,
        };
      }).slice(1);

      // Compare
      let matches = 0;
      let notFound = 0;
      /** @type {{ algorithm: string, hash: string, correct_scene_id: string | null }[]} */
      (found.fingerprints).forEach((fp) => {
        const cfp = currentFingerprints
          .find(({ algorithm, hash }) => algorithm === fp.algorithm.toUpperCase() && hash === fp.hash);
        if (!cfp) return notFound++;
        matches++;
        const { row } = cfp;
        row.classList.add('bg-warning');
        if (fp.correct_scene_id) {
          const html = ` | <a href="/scenes/${fp.correct_scene_id}"><b>correct scene</b></a>`;
          row.children[headers.submissions].insertAdjacentHTML('beforeend', html);
        }
      });

      if (matches || notFound) {
        const fpInfo = document.createElement('div');
        fpInfo.classList.add('float-right', 'my-2', 'd-flex', 'flex-column');

        const makeElement = (...content) => {
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
        window.addEventListener('locationchange', () => fpInfo.remove(), { once: true });
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

    const found = await getDataFor('scene', sceneId);
    if (!found) {
      console.debug('[backlog] not found', sceneId);
      return;
    }
    console.debug('[backlog] found', found);

    const StashDBContent = /** @type {HTMLDivElement} */ (document.querySelector('.StashDBContent'));
    StashDBContent.style.maxWidth = '1600px';
    // Hook to the global style
    window.addEventListener('locationchange', () => {
      StashDBContent.style.maxWidth = null;
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
     * @param {{ [key: string]: any }} obj
     * @param {string[]} keySortOrder
     * @returns {[string, any][]}
     */
    const sortedEntries = (obj, keySortOrder) =>
      Object.entries(obj)
        .sort(([aKey,], [bKey,]) => {
          const aPos = keySortOrder.indexOf(aKey);
          const bPos = keySortOrder.indexOf(bKey);
          if (bPos === -1) return -1;
          else if (aPos === -1) return 1;
          else if (aPos < bPos) return -1;
          else if (aPos > bPos) return 1;
          else return 0;
        });

    const keySortOrder = [
      'title', 'date', 'duration',
      'performers', 'studio', 'url',
      'details', 'director', 'tags',
      'image', 'fingerprints',
    ];
    sortedEntries(found, keySortOrder).forEach((entry) => {
      const [field, value] = entry;
      if (['contentHash'].includes(field)) return;

      const dt = document.createElement('dt');
      dt.innerText = field;
      pendingChanges.appendChild(dt);

      const dd = document.createElement('dd');
      pendingChanges.appendChild(dd);

      // title
      // date

      if (field === 'duration') {
        dd.innerText = value;
        dd.style.userSelect = 'all';
      }

      if (field === 'performers') {
        const ul = document.createElement('ul');
        ul.classList.add('p-0');
        sortedEntries(value, ['update', 'remove', 'append']).forEach((actionEntries) => {
          /** @type {[string, { [key: string]: any }[]]}  */
          const [action, entries] = (actionEntries);
          entries.forEach((entry) => {
            const li = document.createElement('li');
            li.classList.add('d-flex', 'justify-content-between');

            const label = document.createElement('span');
            label.style.flex = '0.25 0 0';
            label.innerText = '[' + (action === 'append' ? 'add' : action) + ']';
            li.appendChild(label);

            const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
            let name = entry.name + disambiguation;
            if (entry.appearance) name += ` (as ${entry.appearance})`;

            const info = document.createElement('span');
            info.style.flex = '1';

            if (!entry.id) {
              info.innerText = `<${entry.status}> ${name}`;
            } else {
              const a = document.createElement('a');
              a.href = `/performers/${entry.id}`;
              a.target = '_blank';
              a.innerText = name;
              a.style.color = 'var(--teal)';
              info.appendChild(a);
              if (action === 'append') {
                a.insertAdjacentHTML('afterend', `<br><span style="user-select: all">${entry.id}</span>`);
              }
              if (action === 'update' && entry.old_appearance) {
                const previous = `${entry.name} (as ${entry.old_appearance}) \u{1F87A} `;
                a.insertAdjacentText('beforebegin', previous);
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
        const [studioId, studioName] = value;
        const a = document.createElement('a');
        a.href = `/studios/${studioId}`;
        a.target = '_blank';
        a.innerText = studioName;
        a.style.color = 'var(--teal)';
        dd.appendChild(a);
        a.insertAdjacentHTML('afterend', `<br><span style="user-select: all">${studioId}</span>`);
        return;
      }

      if (field === 'url') {
        const a = document.createElement('a');
        a.innerText = value;
        a.href = value;
        a.target = '_blank';
        a.rel = 'nofollow noopener noreferrer';
        dd.appendChild(a);
        return;
      }

      if (field === 'details') {
        dd.innerText = value;
        dd.style.whiteSpace = 'pre-line';
        return;
      }

      // director
      // tags

      if (field === 'image') {
        const imgLink = document.createElement('a');
        // imgLink.innerText = value;
        imgLink.href = value;
        imgLink.target = '_blank';
        imgLink.rel = 'nofollow noopener noreferrer';
        dd.appendChild(imgLink);
        imgLink.insertAdjacentHTML('afterbegin', '<br>');
        const img = document.createElement('img');
        img.style.maxHeight = '200px';
        img.alt = value;
        img.style.border = '2px solid var(--teal)';
        imgLink.insertAdjacentElement('afterbegin', img);
        getImage(value)
          .then((blob) => img.src = blob);
        return;
      }

      if (field === 'fingerprints') {
        /** @type {{ [key: string]: string }[]} */
        (value).forEach((fp, index) => {
          if (index > 0) dd.insertAdjacentHTML('beforeend', '<br>');
          const fpElement = document.createElement('span');
          fpElement.innerText = `${fp.algorithm.toUpperCase()} ${fp.hash}`;
          if (fp.correct_scene_id) {
            const correctSceneLink = document.createElement('a');
            correctSceneLink.href = `/scenes/${fp.correct_scene_id}`;
            correctSceneLink.target = '_blank';
            correctSceneLink.innerText = 'correct scene';
            correctSceneLink.style.color = 'var(--teal)';
            const correctSceneId = `<span style="user-select: all">${fp.correct_scene_id}</span>`;
            const correctSceneHTML = ` \u{1F87A} ${correctSceneLink.outerHTML}: ${correctSceneId}`;
            fpElement.insertAdjacentHTML('beforeend', correctSceneHTML);
          }
          dd.appendChild(fpElement);
        });
        return;
      }

      if (field === 'comments') {
        /** @type {string[]} */
        (value).forEach((comment, index) => {
          if (index > 0) dd.insertAdjacentHTML('beforeend', '<br>');
          let commentElement;
          if (/https?:/.test(comment)) {
            commentElement = document.createElement('a');
            commentElement.href = comment;
            commentElement.target = '_blank';
            commentElement.rel = 'nofollow noopener noreferrer';
            commentElement.style.color = 'var(--teal)';
          } else {
            commentElement = document.createElement('span');
          }
          commentElement.innerText = comment;
          dd.appendChild(commentElement);
        });
        return;
      }

      if (field === 'lastUpdated') {
        dt.insertAdjacentHTML('beforebegin', '<hr class="mt-4" style="border-top-color: initial;">');
        dt.innerText = 'data last fetched at';
        dd.innerText = formatDate(value);
        return;
      }

      // unmatched
      dd.innerText = value;
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

    const index = await getDataIndex();
    if (!index) return;

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
        highlightElements.forEach((el) => el.style.backgroundColor = null);
      });
    }

    if (info.includes('split')) {
      const toSplit = document.createElement('div');
      toSplit.classList.add('mb-1', 'p-1', 'font-weight-bold');
      toSplit.style.transition = 'background-color .5s';
      toSplit.innerHTML = 'This performer is listed on <a>Performers To Split Up</a>.';
      highlightElements.push(toSplit);
      const a = toSplit.querySelector('a');
      a.href = 'https://docs.google.com/spreadsheets/d/1eiOC-wbqbaK8Zp32hjF8YmaKql_aH-yeGLmvHP1oBKQ/edit#gid=1067038397';
      a.target = '_blank';
      a.rel = 'nofollow noopener noreferrer';
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '🔀';
      toSplit.insertAdjacentElement('afterbegin', emoji);
      performerInfo.insertAdjacentElement('afterbegin', toSplit);
    }

    const foundData = await getDataFor('performer', performerId, index);
    if (!foundData) {
      console.debug('[backlog] not found', performerId);
      return;
    }
    console.debug('[backlog] found', foundData);

    if (foundData.duplicates) {
      const hasDuplicates = document.createElement('div');
      hasDuplicates.classList.add('mb-1', 'p-1', 'font-weight-bold');
      hasDuplicates.innerHTML = 'This performer has duplicates:';
      highlightElements.push(hasDuplicates);
      const isMarkedForSplit = (/** @type {string} */ uuid) => {
        const indexEntry = index.performers[uuid];
        return indexEntry && indexEntry.includes('split');
      }
      /** @type {string[]} */
      (foundData.duplicates).forEach((dupId) => {
        hasDuplicates.insertAdjacentHTML('beforeend', '<br>');
        const a = document.createElement('a');
        a.href = `/performers/${dupId}`;
        a.target = '_blank';
        a.innerText = dupId;
        a.classList.add('font-weight-normal');
        a.style.color = 'var(--teal)';
        a.style.marginLeft = '1.75rem';
        hasDuplicates.insertAdjacentElement('beforeend', a);

        if (isMarkedForSplit(dupId)) a.insertAdjacentText('afterend', ' 🔀 needs to be split up');
      });
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '♊';
      hasDuplicates.insertAdjacentElement('afterbegin', emoji);
      performerInfo.insertAdjacentElement('afterbegin', hasDuplicates);
    }

    if (foundData.duplicate_of) {
      const duplicateOf = document.createElement('div');
      duplicateOf.classList.add('mb-1', 'p-1', 'font-weight-bold');
      duplicateOf.innerText = 'This performer is a duplicate of: ';
      highlightElements.push(duplicateOf);
      const a = document.createElement('a');
      a.href = `/performers/${foundData.duplicate_of}`;
      a.target = '_blank';
      a.innerText = foundData.duplicate_of;
      a.classList.add('font-weight-normal');
      a.style.color = 'var(--teal)';
      duplicateOf.insertAdjacentElement('beforeend', a);
      const emoji = document.createElement('span');
      emoji.classList.add('mr-1');
      emoji.innerText = '♊';
      duplicateOf.insertAdjacentElement('afterbegin', emoji);
      performerInfo.insertAdjacentElement('afterbegin', duplicateOf);
    }

  } // iPerformerPage

  // =====

  /**
   * @param {PluralObject} pluralObject
   * @param {string[]} changes
   * @returns {string}
   */
  const getHighlightStyle = (pluralObject, changes) => {
    let color = 'var(--yellow)';
    if (pluralObject === 'scenes' && changes.length === 1 && changes[0] === 'fingerprints') {
      color = 'var(--cyan)';
    }
    return `0.4rem solid ${color}`;
  }

  /**
   * @param {PluralObject | null} pluralObject
   */
  async function highlightSceneCards(pluralObject) {
    if (!await elementReadyIn('.SceneCard > .card', 2000)) {
      console.debug('[backlog] no scene cards found, skipping');
      return;
    }

    const index = await getDataIndex();
    if (!index) return;

    const highlight = async () => {
      /** @type {HTMLDivElement[]} */
      (Array.from(document.querySelectorAll('.SceneCard > .card'))).forEach((card) => {
        const markerDataset = card.parentElement.dataset;
        if (markerDataset.backlogInjected) return;
        else markerDataset.backlogInjected = 'true';

        const sceneId = card.querySelector('a').href.replace(/.+\//, '');
        const found = index.scenes[sceneId];
        if (!found) return;
        const changes = found.slice(1);
        card.style.outline = getHighlightStyle('scenes', changes);
        card.parentElement.title = `<pending> changes to:\n - ${changes.join('\n - ')}\n(click scene to view changes)`;
      });
    };

    highlight();

    if (pluralObject === 'performers') {
      const studioSelectorValue = document.querySelector(
        '.PerformerScenes > .CheckboxSelect > .react-select__control > .react-select__value-container'
      );
      const observer = new MutationObserver(async (mutations, observer) => {
        console.debug('[backlog] detected change in performers studios selector, re-highlighting scene cards');
        if (!await elementReadyIn('.SceneCard > .card', 2000)) return;
        await highlight();
      }).observe(studioSelectorValue, { childList: true, subtree: true });
    }
  }

  async function highlightSearchResults() {
    if (!await elementReadyIn('a.SearchPage-scene, a.SearchPage-performer', 2000)) {
      console.debug('[backlog] no scene/performer search results found, skipping');
      return;
    }

    const index = await getDataIndex();
    if (!index) return;


    /** @type {HTMLAnchorElement[]} */
    (Array.from(document.querySelectorAll('a.SearchPage-scene, a.SearchPage-performer'))).forEach((cardLink) => {
      const markerDataset = cardLink.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = 'true';

      const { object: rawPluralObject, ident: uuid } = parsePath(cardLink.href);
      if (!['scenes', 'performers'].includes(rawPluralObject)) return;
      /** @type {SupportedPluralObject} */
      const pluralObject = (rawPluralObject);

      const found = index[pluralObject][uuid];
      if (!found) return;
      const changes = found.slice(1);

      if (changes) {
        const card = /** @type {HTMLDivElement} */ (cardLink.querySelector(':scope > .card'));
        card.style.outline = getHighlightStyle(pluralObject, changes);
        if (pluralObject === 'scenes') {
          cardLink.title = `<pending> changes to:\n - ${changes.join('\n - ')}\n(click scene to view changes)`;
        } else if (pluralObject === 'performers') {
          cardLink.title = `performer is listed for:\n - ${changes.join('\n - ')}\n(click performer for more info)`;
        }
      }
    });
  }
}


// Based on: https://dirask.com/posts/JavaScript-on-location-changed-event-on-url-changed-event-DKeyZj
(function() {
  const { pushState, replaceState } = history;

  const eventPushState = new Event('pushstate');
  const eventReplaceState = new Event('replacestate');
  const eventLocationChange = new Event('locationchange');

  history.pushState = function() {
    pushState.apply(history, arguments);
    window.dispatchEvent(eventPushState);
    window.dispatchEvent(eventLocationChange);
  }

  history.replaceState = function() {
    replaceState.apply(history, arguments);
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
