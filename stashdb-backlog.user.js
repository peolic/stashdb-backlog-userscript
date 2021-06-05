// ==UserScript==
// @name      StashDB Backlog
// @author    peolic
// @version   1.1.2
// @namespace https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @updateURL https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @grant     GM.setValue
// @grant     GM.getValue
// @grant     GM.deleteValue
// @grant     GM.openInTab
// @include   https://stashdb.org/*
// ==/UserScript==


async function inject() {
  const urlRegex = new RegExp(
    String.raw`(?:/([a-z]+)`
      + String.raw`(?:/([0-9a-f]{8}\b-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-\b[0-9a-f]{12})`
        + String.raw`(?:/([a-z]+)`
        + String.raw`)?`
      + String.raw`)?`
    + String.raw`)?`
  );

  /**
   * @typedef LocationData
   * @property {string | null} object
   * @property {string | null} uuid
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
      uuid: null,
      action: null,
    };

    if (!pathname) return result;

    const match = urlRegex.exec(pathname);
    if (!match || match.length === 0) return null;

    result.object = match[1] || null;
    result.uuid = match[2] || null;
    result.action = match[3] || null;

    return result;
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function dispatcher() {
    const loc = parsePath();
    if (!loc) {
      throw new Error('[backlog] Failed to parse location!');
    }

    await Promise.race([
      elementReady('.StashDBContent > .LoadingIndicator'),
      wait(100),
    ]);

    if (loc.object === 'scenes' && loc.uuid && !loc.action) {
      await iScenePage(loc.uuid);

    } else if (loc.object === 'scenes' && !loc.uuid && !loc.action) {
      await highlightSceneCards();

    } else if (['performers', 'studios', 'tags'].includes(loc.object) && loc.uuid && !loc.action) {
      await highlightSceneCards();

    // Home page
    } else if (!loc.object && !loc.uuid && !loc.action) {
      await highlightSceneCards();

    } else {
      console.debug(`[backlog] nothing to do for ${loc.object}/${loc.uuid}/${loc.action}.`);
    }
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
   * @param {string} url
   * @returns {Promise<{ [key: string]: any } | null>}
   */
  async function fetchJSON(url) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        referrerPolicy: 'same-origin',
      });
      const data = await response.json();
      return data;

    } catch (error) {
      console.error('[backlog] fetch error', error);
      return null;
    }
  }

  /**
   * @param {{ lastUpdated?: string }} storedObject
   * @param {number} maxTime in hours
   * @returns {boolean}
   */
  function shouldFetch(storedObject, maxTime) {
    if (!storedObject) return true;
    const { lastUpdated } = storedObject;
    if (!lastUpdated) return true;
    const cacheInvalidation = (new Date(lastUpdated).getTime()) + 1000 * 60 * 60 * maxTime;
    return new Date().getTime() >= cacheInvalidation;
  }

  const DATA_INDEX_KEY = 'stashdb_backlog_index';
  async function getDataIndex() {
    const storedDataIndex = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
    if (!storedDataIndex) {
      throw new Error("[backlog] invalid stored data");
    }
    if (shouldFetch(storedDataIndex, 1)) {
      const data = await fetchJSON('https://raw.githubusercontent.com/peolic/stashdb_backlog_data/main/index.json');
      if (data === null) {
        console.error('[backlog] index error');
        return null;
      }
      const action = !!data.lastUpdated ? 'updated' : 'fetched';
      data.lastUpdated = new Date().toISOString();
      await GM.setValue(DATA_INDEX_KEY, JSON.stringify(data));
      console.debug(`[backlog] index ${action}`);
      return data;
    } else {
      console.debug('[backlog] index stored');
      return storedDataIndex;
    }
  }

  const makeDataPath = (object, uuid) => `${object}s/${uuid.slice(0, 2)}/${uuid}.json`;
  const DATA_KEY = 'stashdb_backlog';

  async function getDataFor(object, uuid, index = undefined) {
    if (!index) index = await getDataIndex();
    if (!index) throw new Error("[backlog] failed to get index");

    const haystack = index[`${object}s`];
    const notFound = Array.isArray(haystack) ? haystack.indexOf(uuid) === -1 : haystack[uuid] === undefined;
    if (notFound) {
      return null;
    }

    const storedData = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    if (!storedData) {
      throw new Error("[backlog] invalid stored data");
    }

    const key = `${object}/${uuid}`;
    if (shouldFetch(storedData[key], 24)) {
      const data = await fetchJSON(`https://raw.githubusercontent.com/peolic/stashdb_backlog_data/main/${makeDataPath(object, uuid)}`);
      if (!data) {
        console.error(`[backlog] <${object} ${uuid}> data error`);
        return null;
      }
      const action = !!data.lastUpdated ? 'updated' : 'fetched';
      data.lastUpdated = new Date().toISOString();
      storedData[key] = data;
      await GM.setValue(DATA_KEY, JSON.stringify(storedData));
      console.debug(`[backlog] <${object} ${uuid}> data ${action}`);
      return data;
    } else {
      console.debug(`[backlog] <${object} ${uuid}> data stored`);
      return storedData[key];
    }
  }

  async function backlogClearCache() {
    await GM.deleteValue(DATA_INDEX_KEY);
    await GM.deleteValue(DATA_KEY);
    unsafeWindow.console.info('[backlog] stored data cleared');
  }
  unsafeWindow.backlogClearCache = exportFunction(backlogClearCache, unsafeWindow);

  async function backlogCacheReport() {
    const index = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
    unsafeWindow.console.info('index', index);
    const data = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    unsafeWindow.console.info('data', data);
  }
  unsafeWindow.backlogCacheReport = exportFunction(backlogCacheReport, unsafeWindow);

  async function getImage(url) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      referrerPolicy: 'same-origin',
    });
    const data = await response.blob();
    return URL.createObjectURL(data);
  }

  // =====

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

  async function iScenePage(sceneId) {
    await Promise.race([
      elementReady('.StashDBContent .scene-info'),
      wait(2000),
    ]);

    const sceneInfo = document.querySelector('.scene-info');
    if (!sceneInfo) {
      console.error('[backlog] scene info not found');
      return;
    }

    const markerDataset = sceneInfo.dataset;
    if (markerDataset.backlogInjected) {
      console.debug('[backlog] already injected, skipping');
      return;
    } else {
      markerDataset.backlogInjected = true;
    }

    const found = await getDataFor('scene', sceneId);
    if (!found) {
      console.debug('[backlog] not found', sceneId);
      return;
    }
    console.debug('[backlog] found', found);

    if (found.comments && found.comments.length > 0) {
      const header = document.querySelector('.scene-info > .card-header');
      const comments = document.createElement('div');
      comments.classList.add('bg-info');

      found.comments.forEach((comment, index) => {
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

      header.appendChild(comments);
    }

    if (found.title) {
      let title = document.querySelector('.scene-info h3');
      if (!title.innerText.trim()) {
        title.innerText = `<MISSING> ${found.title}`;
        title.classList.add('bg-danger', 'p-1');
      } else {
        title.classList.add('bg-warning', 'p-1');
        title.title = `<pending>\n${found.title}`;
      }
    }

    if (found.date || found.studio_id) {
      let studio_date = document.querySelector('.scene-info > .card-header > h6');
      let title = `<pending>`;
      let alreadyCorrectStudioId = false;
      if (found.studio_id) {
        alreadyCorrectStudioId = found.studio_id === parsePath(studio_date.querySelector('a').href).uuid;
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
          studio_date.innerHTML = escapeHTML('<already correct> \u{1F87A} ') + duration.innerHTML;
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
      let img = document.querySelector('.scene-photo > img');

      img.addEventListener('mouseover', () => img.style.cursor = 'pointer');
      img.addEventListener('mouseout', () => img.removeAttribute('style'));
      img.addEventListener('click', () => GM.openInTab(found.image, false));

      if (img.getAttribute('src')) {
        img.classList.add('bg-warning', 'p-2');
        img.title = `<pending>\n${found.image}`;
      } else {
        img.classList.add('bg-danger', 'p-2');
        img.title = `<MISSING>\n${found.image}`;
        // img.src = found.image;
        setTimeout(async () => img.src = await getImage(found.image), 0);
      }
    }

    if (found.performers) {
      const { remove, append, update } = found.performers;
      const removeFrom = (entry, from) => {
        const index = from.indexOf(entry);
        if (index === -1) console.error('[backlog] entry not found', entry, 'in', from);
        from.splice(index, 1);
      };

      const scenePerformers = document.querySelector('.scene-info .scene-performers');
      const existingPerformers = Array.from(scenePerformers.querySelectorAll(':scope > a.scene-performer'));

      existingPerformers.forEach((performer) => {
        const { uuid } = parsePath(performer.href);
        const toRemove = remove.find((e) => e.id === uuid) || null;
        const toAppend = append.find((e) => e.id === uuid) || null;
        const toUpdate = !update ? null : update.find((e) => e.id === uuid) || null;
        if (toRemove) {
          performer.classList.add('bg-danger', 'p-1');
          performer.style.textDecoration = 'line-through';
          performer.title = `<pending>\nremoval`;
          removeFrom(toRemove, remove);
        }
        if (toAppend) {
          performer.classList.add('bg-warning', 'p-1');
          performer.title = `<already added>\nshould mark the entry on the backlog sheet as completed`;
          removeFrom(toAppend, append);
        }
        if (toUpdate) {
          performer.classList.add('bg-primary', 'p-1');
          performer.title = `<pending>\nupdate to\n${toUpdate.name}${!toUpdate.appearance ? '' : ' (as ' + toUpdate.appearance + ')'}`;
          removeFrom(toUpdate, update);
        }
      });

      append.forEach((entry) => {
        const p = document.createElement('a');
        p.classList.add('scene-performer', 'bg-success', 'p-1');
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
        console.warning('[backlog] entry to remove not found. already removed?', entry);
      });
      if (update) {
        update.forEach((entry) => {
          console.warning('[backlog] entry to update not found.', entry);
        });
      }
    }

    if (found.duration) {
      let duration = document.querySelector('.scene-info > .card-footer > div[title $= " seconds"]');
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
      let desc = document.querySelector('.scene-description > h4 + div');
      if (!desc.innerText.trim()) {
        desc.innerText = `<MISSING> ${found.details}`;
        desc.classList.add('bg-danger');
      } else {
        desc.classList.add('bg-warning');
        desc.title = `<pending>\n${found.details}`;
      }
    }

    if (found.url) {
      let studio_url = document.querySelector('.scene-description > div:last-of-type > a');
      studio_url.classList.add('bg-warning');
      studio_url.title = `<pending>\n${found.url}`;
    }
  } // iScenePage

  // =====

  async function highlightSceneCards() {
    await Promise.race([
      elementReady('.SceneCard > .card'),
      wait(2000),
    ]);

    const cards = Array.from(document.querySelectorAll('.SceneCard > .card'));
    if (cards.length === 0) {
      console.debug('[backlog] no scene cards found, skipping');
      return;
    }

    const index = await getDataIndex();
    if (!index) return;

    cards.forEach((card) => {
      const markerDataset = card.parentElement.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = true;

      const sceneId = card.querySelector('a').href.replace(/.+\//, '');
      const found = Array.isArray(index.scenes) ? index.scenes.indexOf(sceneId) !== -1 : index.scenes[sceneId];
      if (!found) return;
      const changes = (typeof found === 'string') ? found.split(/,/g) : null;
      card.style.outline = '0.4rem solid var(--yellow)';
      if (changes) {
        card.parentElement.title = `<pending>\nchanges to:\n- ${changes.join('\n- ')}\n(click scene to view changes)`;
      } else {
        card.parentElement.title = `<pending>\n(click scene to view backlogged changes)`;
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
