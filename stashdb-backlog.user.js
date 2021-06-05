// ==UserScript==
// @name	StashDB Backlog
// @author	peolic
// @version	1.0.0
// @namespace	https://gist.github.com/peolic/e4713081f7ad063cd0e91f2482ac39a7/raw/stashdb-backlog.user.js
// @grant	GM.setValue
// @grant	GM.getValue
// @grant	GM.deleteValue
// @grant	GM.openInTab
// @include	https://stashdb.org/*
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

    if (!pathname)
      return result;

    const match = urlRegex.exec(pathname);
    if (!match || match.length === 0)
      return null;

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

  const DATA_INDEX_KEY = 'stashdb_backlog_index';
  async function getDataIndex() {
		const storedDataIndex = JSON.parse(await GM.getValue(DATA_INDEX_KEY, '{}'));
    if (!storedDataIndex) {
      throw new Error("[backlog] invalid stored data");
    }
    const { lastUpdated } = storedDataIndex;
    const cacheInvalidation = (new Date(lastUpdated).getTime()) + 1000 * 60 * 60 * 1;
    if (!lastUpdated || new Date().getTime() >= cacheInvalidation) {
      try {
        const response = await fetch('https://github.com/peolic/stashdb_backlog_data/raw/main/index.json');
        const data = await response.json();
        data.lastUpdated = new Date().toISOString();
        await GM.setValue(DATA_INDEX_KEY, JSON.stringify(data));
      	console.debug(`[backlog] index ${lastUpdated ? 'updated' : 'fetched'}`);
        return data;
      } catch (error) {
        console.error('[backlog] index error', error);
        return null;
      }
    } else {
      console.debug('[backlog] index stored');
			return storedDataIndex;
    }
  }
  
  const makeDataPath = (object, uuid) => `${object}s/${uuid.slice(0, 2)}/${uuid}.json`;
  const DATA_KEY = 'stashdb_backlog';

  async function getDataFor(object, uuid, index = undefined) {
    if (!index) {
    	index = (await getDataIndex()) || {};
    }
    
    if (index[`${object}s`].indexOf(uuid) === -1) {
      return null;
    }
    
		const storedData = JSON.parse(await GM.getValue(DATA_KEY, '{}'));
    if (!storedData) {
      throw new Error("[backlog] invalid stored data");
    }
    const key = `${object}/${uuid}`;
    const { lastUpdated } = storedData[key] || {};
    const cacheInvalidation = (new Date(lastUpdated).getTime()) + 1000 * 60 * 60 * 24;
    if (!lastUpdated || new Date().getTime() >= cacheInvalidation) {
      try {
        const response = await fetch(`https://github.com/peolic/stashdb_backlog_data/raw/main/${makeDataPath(object, uuid)}`);
        const data = await response.json();
        data.lastUpdated = new Date().toISOString();
        storedData[key] = data;
        await GM.setValue(DATA_KEY, JSON.stringify(storedData));
      	console.debug(`[backlog] <${object} ${uuid}> data ${lastUpdated ? 'updated' : 'fetched'}`);
        return data;
      } catch (error) {
        console.error(`[backlog] <${object} ${uuid}> data error`, error);
        return null;
      }
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
    
    if (found.date || found.studio) {
      let studio_date = document.querySelector('.scene-info > .card-header > h6');
      studio_date.classList.add('bg-warning', 'p-1');
      studio_date.title = `<pending>${found.studio ? '\nStudio: ' + found.studio : ''}${found.date ? '\nDate: ' + found.date : ''}`;
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
      	// img.src = found.image;
				img.src = await getImage(found.image);
      	img.title = `<MISSING>\n${found.image}`;
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
      		performer.classList.add('bg-danger', 'p-1');
      		performer.title = `<already added>`;
          removeFrom(toAppend, append);
        }
        if (toUpdate) {
      		performer.classList.add('bg-primary', 'p-1');
          performer.style.textDecoration = 'line-through';
      		performer.title = `<pending>\nupdate ${toUpdate.name}${!toUpdate.appearance ? '' : ' (as ' + toUpdate.appearance + ')'}`;
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
        		? `<span>${entry.name}</span>`
        		: `<span>${entry.appearance}</span><small class="ml-1 text-small text-muted">(${entry.name})</small>`
        );
        const dsmbg = !entry.disambiguation ? '' : `<small class="ml-1 text-small text-muted">(${entry.disambiguation})</small>`;
        p.innerHTML = (
          genderIcon(existingPerformers.length === 0)
          + (entry.id ? '' : `[${entry.status}] `)
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
      if (!duration) {
        duration = document.createElement('div');
        duration.innerHTML = `&lt;MISSING&gt; Duration: <b>${found.duration}</b>`;
      	duration.classList.add('bg-danger', 'p-1');
        document.querySelector('.scene-info > .card-footer > *:first-child').insertAdjacentElement('afterend', duration);
      } else {
      	duration.classList.add('bg-warning', 'p-1');
      	duration.innerHTML = duration.innerHTML + ` => &lt;pending&gt; ${found.duration}`;
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

    const index = (await getDataIndex()) || {};
    cards.forEach((card) => {
      const markerDataset = card.parentElement.dataset;
      if (markerDataset.backlogInjected) return;
      else markerDataset.backlogInjected = true;

      const sceneId = card.querySelector('a').href.replace(/.+\//, '');
      const found = index.scenes.indexOf(sceneId) !== -1;
      if (!found) return;
    	// const sceneData = await getDataFor('scene', sceneId, index);
      card.style.outline = '0.3rem solid var(--warning)';
			card.style.borderRadius = 'unset';
      // card.parentElement.title = `<pending>\n${JSON.stringify(sceneData, null, 2)}`;
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
