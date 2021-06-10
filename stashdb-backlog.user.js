// ==UserScript==
// @name      StashDB Backlog
// @author    peolic
// @version   1.12.0
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
      + String.raw`(?:/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w\d-]+)`
        + String.raw`(?:/([a-z]+)`
        + String.raw`)?`
      + String.raw`)?`
    + String.raw`)?`
  );

  /**
   * @typedef {'scenes' | 'performers' | 'studios' | 'tags' | 'categories' | 'edits' | 'users'} PluralObject
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

  async function dispatcher() {
    const loc = parsePath();
    if (!loc) {
      throw new Error('[backlog] Failed to parse location!');
    }

    await Promise.race([
      elementReady('.StashDBContent > .LoadingIndicator'),
      wait(100),
    ]);

    if (loc.object === 'scenes') {
      if (loc.ident) {
        // Scene page
        if (!loc.action) return await iScenePage(loc.ident);
        // Scene edit page
        // else if (loc.action === 'edit') return await iSceneEditPage(loc.ident);
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
      await highlightSceneCards(loc.object);
      return await iPerformerPage(loc.ident);
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
        console.error('[backlog] fetch bad response', response.status, body);
        return { error: true, status: response.status, body };
      }
      const data = await response.json();
      return data;

    } catch (error) {
      console.error('[backlog] fetch error', error);
      return null;
    }
  }

  /**
   * @param {DataObject} storedObject
   * @param {string | number} diff new content hash or max time in hours
   * @returns {boolean}
   */
  function shouldFetch(storedObject, diff) {
    if (!storedObject) return true;

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
   * @typedef {{ [uuid: string]: string }} PerformersIndex
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
    if (forceFetch || shouldFetch(storedDataIndex, 1)) {
      const data = await fetchJSON(`${BASE_URL}/index.json`);
      if (data === null || 'error' in data) {
        console.error('[backlog] index error', data);
        return null;
      }
      const dataIndex = /** @type {DataIndex} */ (data);

      // migration: convert comma-separated to array
      const scenesIndex = dataIndex.scenes;
      for (const sceneId in scenesIndex) {
        const oldValue = /** @type {string | string[]} */ (scenesIndex[sceneId]);
        if (typeof oldValue === 'string') {
          scenesIndex[sceneId] = [''].concat(...oldValue.split(/,/g));
        }
      }
      const action = storedDataIndex.lastUpdated ? 'updated' : 'fetched';
      dataIndex.lastUpdated = new Date().toISOString();
      //@ts-expect-error
      await GM.setValue(DATA_INDEX_KEY, JSON.stringify(dataIndex));
      console.debug(`[backlog] index ${action}`);
      return dataIndex;
    } else {
      console.debug('[backlog] stored index');
      return storedDataIndex;
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
    dataObject.contentHash = Array.isArray(indexEntry) ? indexEntry[0] : null;
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
    const contentHash = Array.isArray(indexEntry) ? indexEntry[0] : null;
    const key = makeObjectKey(object, uuid);
    if (shouldFetch(storedData[key], contentHash || '')) {
      return await _fetchObject(object, uuid, storedData, index);
    }

    console.debug(`[backlog] <${object} ${uuid}> stored data`);
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

    /** @type {SupportedObject} */
    const object = (pluralObject.slice(0, -1));

    if (!['scenes'].includes(pluralObject) || !uuid) {
      global.console.warn(`[backlog] invalid request: <${pluralObject} ${uuid}>`);
      return false;
    }

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

  const genderIcon = (fixStyle) => (
    '<svg'
    + (!fixStyle ? ' ' : ` style="${svgStyleFix}"`)
    + ' aria-hidden="true" focusable="false" data-prefix="fas" data-icon="venus-mars"'
    + ' class="svg-inline--fa fa-venus-mars fa-w-18 " role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">'
    + '<path fill="currentColor" d="M564 0h-79c-10.7 0-16 12.9-'
    + '8.5 20.5l16.9 16.9-48.7 48.7C422.5 72.1 396.2 64 368 64c-33.7 0-64.6 11.6-89.2 30.9 14 16.7 25 36 32.1 57.1 14.5-14.8 34.7-24'
    + ' 57.1-24 44.1 0 80 35.9 80 80s-35.9 80-80 80c-22.3 0-42.6-9.2-57.1-24-7.1 21.1-18 40.4-32.1 57.1 24.5 19.4 55.5 30.9 89.2 30.9'
    + ' 79.5 0 144-64.5 144-144 0-28.2-8.1-54.5-22.1-76.7l48.7-48.7 16.9 16.9c2.4 2.4 5.4 3.5 8.4 3.5 6.2 0 12.1-4.8 12.1-12V12c0-6.6'
    + '-5.4-12-12-12zM144 64C64.5 64 0 128.5 0 208c0 68.5 47.9 125.9 112 140.4V400H76c-6.6 0-12 5.4-12 12v40c0 6.6 5.4 12 12 12h36v36c0'
    + ' 6.6 5.4 12 12 12h40c6.6 0 12-5.4 12-12v-36h36c6.6 0 12-5.4 12-12v-40c0-6.6-5.4-12-12-12h-36v-51.6c64.1-14.6 112-71.9 112-140.4'
    + ' 0-79.5-64.5-144-144-144zm0 224c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"></path>'
    + '</svg>'
  );

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
    button.style.margin = '2px';
    button.classList.add('btn', 'btn-light', className);
    if (data) {
      const update = data.lastUpdated ? `\nLast updated: ${formatDate(data.lastUpdated)}` : '';
      button.title = `Refetch backlog data${update}`;
      button.innerText = '📥';
    } else {
      button.title = 'Fetch new backlog data';
      button.innerText = '🆕';
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
    await Promise.race([
      elementReady('.StashDBContent .scene-info'),
      wait(2000),
    ]);

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

    if (found.comments && found.comments.length > 0) {
      const comments = document.createElement('div');
      comments.classList.add('bg-info');

      /** @type {string[]} */
      (found.comments).forEach((comment, index) => {
        if (index > 0) comments.appendChild(document.createElement('br'));
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
      let title = /** @type {HTMLHeadingElement | null} */ (document.querySelector('.scene-info h3'));
      if (!title.innerText.trim()) {
        title.innerText = `<MISSING> ${found.title}`;
        title.classList.add('bg-danger', 'p-1');
      } else {
        title.classList.add('bg-warning', 'p-1');
        title.title = `<pending>\n${found.title}`;
      }
    }

    if (found.date || found.studio_id) {
      let studio_date = /** @type {HTMLHeadingElement | null} */ (sceneHeader.querySelector(':scope > h6'));
      let title = `<pending>`;
      let alreadyCorrectStudioId = false;
      if (found.studio_id) {
        alreadyCorrectStudioId = found.studio_id === parsePath(studio_date.querySelector('a').href).ident;
        title += `\nStudio ID: ${found.studio_id}`;
      }
      let alreadyCorrectDate = false;
      if (found.date) {
        alreadyCorrectDate = found.date === Array.from(studio_date.childNodes).slice(-1)[0].nodeValue.trim();
        title += `\nDate: ${found.date}`;
      }
      if (alreadyCorrectStudioId || alreadyCorrectDate) {
        studio_date.classList.add('bg-warning', 'p-1');
        if (alreadyCorrectDate) {
          studio_date.innerHTML = studio_date.innerHTML + escapeHTML(' \u{1F878} <already correct>');
        } else {
          studio_date.innerHTML = escapeHTML('<already correct> \u{1F87A} ') + studio_date.innerHTML;
        }
        studio_date.title = (
          [alreadyCorrectStudioId ? 'Studio ID' : null, alreadyCorrectDate ? 'Date' : null]
            .filter(Boolean).join(' and ')
          + ' already correct, should mark the entry on the backlog sheet as completed'
        );
      } else {
        studio_date.classList.add('bg-primary', 'p-1');
      }
      studio_date.title = title;
    }

    if (found.image) {
      let img = /** @type {HTMLImageElement} */ (document.querySelector('.scene-photo > img'));
      const imgContainer = img.parentElement;

      if (img.getAttribute('src')) {
        imgContainer.classList.add('bg-warning', 'p-2');
        imgContainer.title = `<pending>\n${found.image}`;
        const handleExistingImage = async () => {
          const newImage = await compareImages(img, found.image);
          if (newImage instanceof Error) {
            console.error('[backlog] error comparing image', newImage);
            return;
          }
          if (newImage === null) {
            imgContainer.classList.add('bg-primary');
            imgContainer.classList.remove('bg-warning');
            imgContainer.title = `<already added>\nshould mark the entry on the backlog sheet as completed\n\n${found.image}`;
          } else {
            imgContainer.classList.add('d-flex');

            const imgNew = document.createElement('img');
            if (img.naturalHeight < img.naturalWidth) {
              imgContainer.classList.add('flex-column');
              imgNew.style.width = '100%';
              imgNew.style.borderTop = '.5rem solid var(--warning)';
            } else {
              img.style.width = 'unset';
              imgNew.style.height = '50%';
              imgNew.style.borderLeft = '.5rem solid var(--warning)';
            }
            imgNew.src = newImage;

            const imgNewLink = document.createElement('a');
            imgNewLink.href = found.image;
            imgNewLink.target = '_blank';
            imgNewLink.rel = 'nofollow noopener noreferrer';
            imgNewLink.appendChild(imgNew);

            imgContainer.appendChild(imgNewLink);
          }
        };

        if (img.complete && img.naturalHeight !== 0) handleExistingImage();
        else img.addEventListener('load', handleExistingImage, { once: true });

      } else {
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
      const { remove, append, update } = found.performers;
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
        const toUpdate = !update ? null : update.find((e) => e.id === uuid) || null;
        if (toRemove) {
          highlight(performer, 'danger');
          performer.style.textDecoration = 'line-through';
          performer.title = `<pending>\nremoval`;
          removeFrom(toRemove, remove);
        }
        if (toAppend) {
          const entryFullName = formatName(toAppend);
          if (fullName === entryFullName) {
            highlight(performer, 'warning');
            performer.title = `<already added>\nshould mark the entry on the backlog sheet as completed`;
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
            performer.title = `<already updated>\nshould mark the entry on the backlog sheet as completed`;
          } else {
            highlight(performer, 'primary');
            performer.title = `<pending>\nupdate to\n${entryFullName}`;
          }
          removeFrom(toUpdate, update);
        }
      });

      append.forEach((entry) => {
        const p = document.createElement('a');
        p.classList.add('scene-performer');
        highlight(p, 'success');
        p.title = `<pending>\naddition`;
        if (entry.id) {
          p.href = `/performers/${entry.id}`;
        } else {
          p.title = `${p.title} (performer needs to be created)`;
        }
        const formattedName = (
          !entry.appearance
            ? `<span>${escapeHTML(entry.name)}</span>`
            : `<span>${escapeHTML(entry.appearance)}</span><small class="ml-1 text-small text-muted">(${escapeHTML(entry.name)})</small>`
        );
        const dsmbg = !entry.disambiguation ? '' : `<small class="ml-1 text-small text-muted">(${escapeHTML(entry.disambiguation)})</small>`;
        p.innerHTML = (
          genderIcon(existingPerformers.length === 0)
          + (entry.id ? '' : `[${escapeHTML(entry.status)}] `)
          + formattedName
          + dsmbg
        );
        scenePerformers.appendChild(p);
      });

      remove.forEach((entry) => {
        // FIXME: Make it a visible warning
        console.warn('[backlog] entry to remove not found. already removed?', entry);
      });
      if (update) {
        update.forEach((entry) => {
          // FIXME: Make it a visible warning
          console.warn('[backlog] entry to update not found.', entry);
        });
      }
    }

    if (found.duration) {
      /** @type {HTMLDivElement | null} */
      let duration = (document.querySelector('.scene-info > .card-footer > div[title $= " seconds"]'));
      const foundDuration = Number(found.duration);
      if (!duration) {
        duration = document.createElement('div');
        duration.innerHTML = (
          escapeHTML('<MISSING>')
          + ` Duration: <b>${formatDuration(foundDuration)} (${found.duration})</b>`
        );
        duration.classList.add('bg-danger', 'p-1');
        duration.title = 'Duration is missing';
        document.querySelector('.scene-info > .card-footer > *:first-child').insertAdjacentElement('afterend', duration);
      } else {
        if (found.duration == duration.title.match(/(\d+)/)[1]) {
          duration.classList.add('bg-warning', 'p-1');
          duration.innerHTML = escapeHTML('<already correct> ') + duration.innerHTML;
          duration.title = 'Duration already correct, should mark the entry on the backlog sheet as completed';
        } else {
          duration.classList.add('bg-primary', 'p-1');
          duration.innerHTML = (
            escapeHTML('<pending> ')
            + duration.innerHTML
            + ` => ${formatDuration(foundDuration)} (${found.duration})`
          );
        }
      }
    }

    if (found.details) {
      /** @type {HTMLDivElement} */
      let desc = (document.querySelector('.scene-description > h4 + div'));
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
      let studio_url = (document.querySelector('.scene-description > div:last-of-type > a'));
      studio_url.classList.add('bg-warning');
      studio_url.title = `<pending>\n${found.url}`;
    }

  } // iScenePage

  // =====

  /**
   * @param {string} sceneId
   */
  async function iSceneEditPage(sceneId) {
    const pageTitle = /** @type {HTMLHeadingElement} */ (await elementReady('h3'));

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

    const pendingChangesHTML = `
      <div
        class="PendingChanges"
        style="position: fixed; right: 100px; top: 80px; width: 400px; height: 600px;"
      >
        <h3>Pending Changes</h3>
        <dl></dl>
      </div>
    `;

    // pageTitle.insertAdjacentElement('afterend', pendingChanges);
    pageTitle.insertAdjacentHTML('afterend', pendingChangesHTML);
    const pendingChanges = await elementReady('.PendingChanges dl');

    Object.entries(found).forEach(([field, value]) => {

      const dt = document.createElement('dt');
      if (field === 'lastUpdated') {
        dt.innerText = 'data last fetched at';
      } else {
        dt.innerText = field;
      }
      pendingChanges.appendChild(dt);

      const dd = document.createElement('dd');
      if (field === 'performers') {
        const performers = Object.entries(value);
        dd.innerHTML = (
          '<ul class="p-0">'
          + performers.flatMap(([action, entries]) => {
            return entries.map(entry => {
              const label = '[' + (action === 'append' ? 'add' : action) + ']';
              const disambiguation = entry.disambiguation ? ` (${entry.disambiguation})` : '';
              let name = entry.name + disambiguation;
              if (entry.appearance) name += ` (as ${entry.appearance})`;
              return `<li class="d-flex justify-content-between">
                <span style="flex: 0.25 0 0;">${label}</span>
                ${
                  entry.id
                    ? `<span style="flex: 1">
                        <a href="/performers/${entry.id}" target="_blank">${escapeHTML(name)}</a>
                        ${action === 'append' ? `<br>${entry.id}` : ''}
                      </span>`
                    : `<span style="flex: 1">&lt;create&gt; ${escapeHTML(name)}</span>`
                }
              </li>`;
            });
          }).join('\n')
          + '</ul>'
        );
      } else if (field === 'comments') {
        dd.innerText = value.join('\n');
        dd.style.whiteSpace = 'pre-line';
      } else if (field === 'details') {
        dd.innerText = value;
        dd.style.whiteSpace = 'pre-line';
      } else if (field === 'lastUpdated') {
        dd.innerText = formatDate(value);
      } else {
        dd.innerText = value;
      }
      pendingChanges.appendChild(dd);
    });

  } // iSceneEditPage

  // =====

  /**
   * @param {string} performerId
   */
  async function iPerformerPage(performerId) {
    const performerInfo = /** @type {HTMLDivElement} */ (await elementReady('.performer-info'));

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

    const [, info] =
      Array.isArray(found)
        ? [found[0], found.slice(1)]
        : ['', found.split(/,/g)];
    if (info.includes('split')) {
      const toSplit = document.createElement('div');
      toSplit.classList.add('mb-1', 'font-weight-bold');
      toSplit.innerHTML = 'This performer is listed on <a>Performers To Split Up</a>.';
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

    // const foundData = await getDataFor('performer', performerId, index);
    // if (!foundData) {
    //   console.debug('[backlog] not found', performerId);
    //   return;
    // }
    // console.debug('[backlog] found', foundData);

  } // iPerformerPage

  // =====

  /**
   * @param {PluralObject | null} pluralObject
   */
  async function highlightSceneCards(pluralObject) {
    await Promise.race([
      elementReady('.SceneCard > .card'),
      wait(2000),
    ]);

    if (document.querySelectorAll('.SceneCard > .card').length === 0) {
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
        card.style.outline = '0.4rem solid var(--yellow)';
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
        await Promise.race([
          elementReady('.SceneCard > .card'),
          wait(2000),
        ]);
        await highlight();
      }).observe(studioSelectorValue, { childList: true, subtree: true });
    }
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
