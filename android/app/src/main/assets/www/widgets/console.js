import { API, PANEL_HEADERS, PREVIEW, api, bridge, cfg, curPage, emo, h, haptic, idle, pages, t, toast, tp } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- app console
// Keys and a dial for the app in front on the PC. The agent says which profile matches the focused app (its label and
// key labels, never the app's name) and the phone sends back a profile id and a slot; the key combos stay on the PC.
// Dial turns are counted on the phone and sent as one request with a count, so a quick spin is a few requests at most.
const STEP_DEG = 24; // one dial click
const BUTTON_ICONS = [
  ['', 'Slot number'], ['⚔️', 'Attack'], ['🛡️', 'Defend'], ['🔥', 'Fire'],
  ['⚡', 'Lightning'], ['❄️', 'Frost'], ['🌿', 'Nature'], ['✨', 'Magic'],
  ['💚', 'Heal'], ['🎯', 'Target'], ['🐾', 'Pet'], ['🐎', 'Mount'],
  ['🎒', 'Bags'], ['🗺️', 'Map'], ['💬', 'Chat'], ['⭐', 'Favorite'],
];
const NUMPAD_AREAS = [
  '1 / 1', '1 / 2', '1 / 3', '1 / 4',
  '2 / 1', '2 / 2', '2 / 3', '2 / 4 / span 2',
  '3 / 1', '3 / 2', '3 / 3', '4 / 1', '4 / 2', '4 / 3',
  '4 / 4 / span 2', '5 / 1 / auto / span 2', '5 / 3',
];
const openFolders = new Map();
const spellQueues = new Map();
const MAX_QUEUED_SPELLS = 12;
const PETS_PER_PAGE = 8;

async function post(path) {
  const ctl = new AbortController();
  // longer than the longest action the agent accepts (AppConsole.MaxCombos): an aborted request would cut a macro short
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(API + path, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS, signal: ctl.signal });
    if (r.ok) return r;
    let error = 'HTTP ' + r.status;
    try { error = (await r.json()).error || error; } catch (_) {}
    throw new Error(error);
  } finally { clearTimeout(timer); }
}

W['app-console'] = {
  needs: ['tick'],
  create(box, { o, page, w }) {
    box.classList.add('ac');
    // which widget is asking: the agent checks this one's "Send keys" option, not another console's
    const wq = 'widget=' + encodeURIComponent(`${page.id}/${w.id}`);
    const folders = Array.isArray(o.folders) ? [...o.folders] : null;
    let folder = null;
    const fq = () => folder ? '&folder=' + encodeURIComponent(folder.id) : '';
    const title = h('div', 'ac-title');
    const back = h('button', 'ac-edit-toggle', tp('Home'));
    back.type = 'button';
    back.hidden = true;
    const edit = h('button', 'ac-edit-toggle', tp('Edit buttons'));
    edit.type = 'button';
    edit.hidden = !o.editProfile || o.control !== true;
    const canEdit = !edit.hidden;
    const navigationTiles = canEdit && folders?.some(entry => entry.role === 'wow-actions');
    if (navigationTiles && !spellQueues.has(wq))
      spellQueues.set(wq, { entries: [], number: 1, adding: false, sending: false });
    const queue = navigationTiles ? spellQueues.get(wq) : null;
    const choose = h('button', 'ac-edit-toggle', tp('Choose actions'));
    choose.type = 'button';
    choose.hidden = true;
    box.classList.toggle('ac-action-bar', canEdit);
    const previousPets = h('button', 'ac-edit-toggle', '‹');
    const nextPets = h('button', 'ac-edit-toggle', '›');
    previousPets.type = nextPets.type = 'button';
    previousPets.setAttribute('aria-label', tp('Previous'));
    nextPets.setAttribute('aria-label', tp('Next'));
    const petPageCount = h('span', 'ac-pet-page-count');
    petPageCount.setAttribute('aria-live', 'polite');
    const petPager = h('div', 'ac-pet-pager', nextPets, petPageCount, previousPets);
    petPager.hidden = true;
    let petPage = 0;
    const resetPetPage = () => { petPage = 0; petPager.hidden = true; };
    const stepPetPage = delta => {
      if (petPager.hidden || !viewState) return;
      petPage += delta;
      sig = '';
      haptic();
      render(viewState);
    };
    previousPets.onclick = () => stepPetPage(-1);
    nextPets.onclick = () => stepPetPage(1);
    const header = h('div', 'ac-head', back, title, choose, edit);
    const keys = h('div', 'ac-keys');
    const dock = h('div', 'ac-nav-dock');
    dock.hidden = true;
    const queueView = h('div', 'ac-spell-queue');
    let viewState = null;
    const knob = h('div', 'ac-knob');
    const dial = h('div', 'ac-dial', knob);
    const note = h('div', 'empty ac-note', t('w.loading'));
    const feedback = h('div', 'ac-feedback');
    feedback.hidden = true;
    const editor = h('div', 'ac-editor');
    editor.hidden = true;
    const closeEditor = () => {
      if (editor.contains(document.activeElement)) document.activeElement.blur();
      editor.hidden = true;
      bridge?.closePanelEditor?.();
    };
    box.append(header, keys, dock, dial, feedback, note, editor);

    let alive = true, polling = false, lastPoll = 0, profile = null, sig = '', missing = false;
    let lastStealth = null;
    let angle = 0, turned = 0, moved = 0, pending = 0, sending = false;
    const fail = (e) => { toast(e?.message || t('w.offline'), 'err'); sig = ''; lastPoll = 0; };
    const say = (text) => { note.textContent = text || ''; note.hidden = !text; };
    const tell = (text) => { feedback.textContent = text || ''; feedback.hidden = !text; };
    const fullKeypad = () => folder?.layout === 'numpad' && profile?.id === folder.id
      && profile.keys.length === NUMPAD_AREAS.length;
    let visibleTiles = [], arrangedColumns = 0;
    const fit = () => {
      if (!canEdit || !keys.clientWidth || !keys.clientHeight) return;
      const width = keys.clientWidth, height = keys.clientHeight;
      const keypad = fullKeypad();
      const pets = folder?.category === 'pet';
      const cols = keypad ? 4 : pets ? (width >= 420 && width >= height ? 4 : 2)
        : !folder && folders ? (width >= 600 ? 4 : 2) : (width >= 600 ? 6 : width >= 360 ? 3 : 2);
      const rows = keypad ? 5 : Math.max(1, Math.ceil(visibleTiles.length / cols));
      const balanced = navigationTiles && !keypad && visibleTiles.length > 0;
      keys.classList.toggle('ac-balanced-keys', Boolean(balanced));
      if (balanced && arrangedColumns !== cols) {
        const base = Math.floor(visibleTiles.length / rows);
        const extra = visibleTiles.length % rows;
        const lines = [];
        let index = 0;
        for (let i = 0; i < rows; i++) {
          const count = base + (i < extra ? 1 : 0);
          const line = h('div', 'ac-key-row', ...visibleTiles.slice(index, index + count));
          line.style.setProperty('--ac-row-cols', count);
          lines.push(line);
          index += count;
        }
        keys.replaceChildren(...lines);
        arrangedColumns = cols;
      }
      const max = keypad ? 112 : !folder && folders ? 160 : 128;
      const gap = 8;
      const available = Math.floor((height - gap * (rows - 1)) / rows);
      const row = Math.max(42, Math.min(max, available));
      keys.style.setProperty('--ac-cols', cols);
      keys.style.setProperty('--ac-row', row + 'px');
      keys.style.alignContent = row <= available ? 'center' : 'start';
    };
    const showTiles = tiles => {
      visibleTiles = tiles;
      arrangedColumns = 0;
      keys.replaceChildren(...tiles);
      fit();
    };
    const fitObserver = canEdit && typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    fitObserver?.observe(keys);
    const tile = (label, icon, fallback, iconId = 0) => {
      const art = h('span', 'ac-key-icon', icon ? emo(icon) : fallback);
      if (iconId) {
        const image = h('img', 'ac-wow-icon');
        image.alt = '';
        image.onload = () => art.replaceChildren(image);
        image.src = API + '/console/wow-icon?id=' + encodeURIComponent(iconId);
      }
      return h('button', 'ac-key', art, h('span', 'ac-key-label', label));
    };
    const folderTile = entry => {
      const button = tile(entry.label, entry.icon, '→');
      button.onclick = () => { haptic(); showFolder(entry); };
      return button;
    };
    const hasSpellQueue = () => Boolean(queue && (folder?.role === 'wow-actions' || folder?.parent
      && folders.some(entry => entry.id === folder.parent && entry.role === 'wow-actions')));
    const redrawQueue = () => {
      sig = '';
      if (viewState) render(viewState);
      else renderQueue();
    };
    const renderQueue = () => {
      if (!hasSpellQueue()) return;
      const mode = h('button', 'ac-edit-toggle ac-queue-control', tp(queue.adding ? 'Done' : 'Queue'));
      mode.type = 'button';
      mode.setAttribute('aria-pressed', String(queue.adding));
      mode.disabled = queue.sending;
      mode.onclick = () => { queue.adding = !queue.adding; redrawQueue(); };
      const list = h('div', 'ac-queue-list');
      list.replaceChildren(...queue.entries.map((entry, index) => {
        const label = '#' + (queue.number + index) + ' ' + entry.label;
        const remove = h('button', 'ac-queue-entry', label);
        remove.type = 'button';
        remove.title = tp('Remove') + ' ' + label;
        remove.setAttribute('aria-label', remove.title);
        remove.disabled = queue.sending;
        remove.onclick = () => {
          queue.entries.splice(index, 1);
          if (!queue.entries.length) queue.number = 1;
          renderQueue();
        };
        return remove;
      }));
      const items = [mode];
      if (queue.adding && !queue.entries.length) items.push(h('span', 'ac-queue-hint', tp('Tap spells')));
      if (queue.entries.length) {
        items.push(list);
        const first = queue.entries[0];
        const next = h('button', 'ac-edit-toggle ac-queue-control ac-queue-next',
          h('b', null, tp('Next') + ' #' + queue.number), h('span', null, first.label));
        next.type = 'button';
        next.setAttribute('aria-label', tp('Next') + ' #' + queue.number + ' · ' + first.label);
        next.disabled = queue.sending || (!PREVIEW && (viewState?.focused !== true || viewState?.elevated));
        next.onclick = async () => {
          if (queue.sending || queue.entries[0] !== first) return;
          queue.sending = true;
          renderQueue();
          try {
            if (!PREVIEW) await post(`/console/${encodeURIComponent(first.profile)}/k${first.slot}?${wq}&queuedSpell=${encodeURIComponent(first.id)}`);
            queue.entries.shift();
            queue.number = queue.entries.length ? queue.number + 1 : 1;
            queue.adding = false;
            lastPoll = 0;
          } catch (error) {
            if (alive) fail(error);
          } finally {
            queue.sending = false;
            if (alive) redrawQueue();
          }
        };
        items.push(next);
      }
      queueView.replaceChildren(...items);
    };
    const navigation = () => {
      const button = tile(tp('Home'), '🏠', '←');
      button.classList.add('ac-home-key');
      button.setAttribute('aria-label', tp('Home'));
      button.onclick = () => { haptic(); home(); };
      const parent = folder.parent && folders.find(entry => entry.id === folder.parent);
      const buttons = hasSpellQueue() ? [queueView, button] : [button];
      if (!parent) return buttons;
      const previous = tile(tp('Back'), '↩', '←');
      previous.setAttribute('aria-label', tp('Back'));
      previous.onclick = () => { haptic(); showFolder(parent); };
      return [previous, ...buttons];
    };
    const home = () => {
      if (!editor.hidden) closeEditor();
      resetPetPage();
      box.classList.remove('ac-pet-journal', 'ac-pet-nav-left');
      folder = null;
      viewState = null;
      if (queue) queue.adding = false;
      lastStealth = null;
      openFolders.delete(wq);
      box.classList.remove('ac-numpad');
      box.classList.remove('ac-docked-nav');
      dock.hidden = true;
      dock.replaceChildren();
      profile = null;
      sig = '';
      back.hidden = choose.hidden = edit.hidden = dial.hidden = true;
      say('');
      tell('');
      title.textContent = page.title || tp('App console');
      const buttons = folders.filter(entry => !entry.parent).map(folderTile);
      if (canEdit) {
        const add = tile(tp('New folder'), '➕', '+');
        add.onclick = () => {
          if (PREVIEW) { toast(tp('Use Action bar folders in Layout to edit the widget.')); return; }
          const name = h('input'), save = h('button', 'ac-key', tp('Create folder'));
          const cancel = h('button', 'ac-key', tp('Cancel')), status = h('div', 'ac-editor-status');
          name.maxLength = 24;
          name.required = true;
          cancel.type = 'button';
          cancel.onclick = closeEditor;
          const form = h('form', 'ac-editor-form', h('label', null, tp('Folder name'), name), save, cancel, status);
          form.onsubmit = async event => {
            event.preventDefault();
            save.disabled = cancel.disabled = true;
            try {
              const result = await post(`/console/folders?${wq}&label=${encodeURIComponent(name.value.trim())}`);
              folders.push(await result.json());
              closeEditor();
              home();
            } catch (e) { status.textContent = e.message; }
            finally { save.disabled = cancel.disabled = false; }
          };
          editor.replaceChildren(form);
          editor.hidden = false;
        };
        buttons.push(add);
      }
      showTiles(buttons);
    };
    const showFolder = entry => {
      if (!editor.hidden) closeEditor();
      resetPetPage();
      const pets = entry.category === 'pet';
      const docked = Boolean(navigationTiles || pets);
      box.classList.toggle('ac-pet-journal', pets);
      box.classList.toggle('ac-pet-nav-left', pets && o.petNavSide === 'left');
      folder = entry;
      viewState = null;
      openFolders.set(wq, entry.id);
      box.classList.toggle('ac-numpad', entry.layout === 'numpad');
      box.classList.toggle('ac-docked-nav', docked);
      dock.hidden = !docked;
      dock.replaceChildren(...(docked ? navigation() : []));
      if (pets) dock.prepend(petPager);
      if (queue && !hasSpellQueue()) queue.adding = false;
      renderQueue();
      title.textContent = entry.label;
      tell('');
      back.textContent = tp(entry.parent ? 'Back' : 'Home');
      back.hidden = docked;
      choose.hidden = !canEdit || PREVIEW || entry.role !== 'wow-actions';
      edit.hidden = !canEdit || entry.role === 'wow-inventory';
      sig = '';
      showTiles([]);
      lastPoll = 0;
      poll();
    };
    back.onclick = () => {
      haptic();
      const parent = folders?.find(entry => entry.id === folder?.parent);
      if (parent) showFolder(parent);
      else home();
    };

    choose.onclick = async () => {
      const current = folder;
      const query = wq + fq();
      const status = h('div', 'ac-editor-status', tp('Loading WoW actions…'));
      status.setAttribute('role', 'status');
      const cancel = h('button', 'ac-edit-toggle', tp('Cancel'));
      cancel.type = 'button';
      cancel.onclick = closeEditor;
      const save = h('button', 'ac-edit-toggle', tp('Save selection'));
      save.type = 'button';
      save.disabled = true;
      const search = h('input', 'ac-action-search');
      search.type = 'search';
      search.placeholder = tp('Find an action');
      search.setAttribute('aria-label', search.placeholder);
      search.disabled = true;
      const header = h('div', 'ac-action-picker-head',
        h('div', 'ac-editor-head', h('b', null, tp('Choose actions')), cancel, save), search, status);
      const menuBack = h('button', 'ac-edit-toggle', tp('All categories'));
      menuBack.type = 'button';
      menuBack.hidden = true;
      header.append(menuBack);
      const list = h('div', 'ac-action-checklist');
      editor.replaceChildren(header, list);
      editor.hidden = false;
      const active = () => alive && !editor.hidden && folder === current && editor.contains(status);
      try {
        const response = await fetch(API + '/console/action-selection?' + query, { cache: 'no-store', headers: PANEL_HEADERS });
        const book = await response.json();
        if (!active()) return;
        if (!response.ok) throw new Error(book.error);
        let pendingSave = false;
        let category = null;
        const groups = new Map([
          ['spell', 'Spells'], ['form', 'Form and stance abilities'], ['trinket', 'Trinkets'], ['item', 'Bag items'],
          ['poison', 'Poisons'], ['pet', 'Pets'], ['macro', 'WoW macros'],
        ]);
        const checked = book.actions.map(action => action.selected);
        const summary = () => book.character + ' · ' + book.className + ' · ' +
          checked.filter(Boolean).length + ' ' + tp('selected') +
          (book.unavailable ? ' · ' + book.unavailable + ' ' + tp('unavailable') : '');
        const rows = book.actions.map((action, index) => {
          const checkbox = h('input');
          checkbox.type = 'checkbox';
          checkbox.checked = checked[index];
          const group = action.forms?.length ? 'form' : action.kind;
          const names = (action.forms || []).map(form => book.forms[form]).filter(Boolean).join(', ');
          const label = h('span', null, action.name, ...(names ? [h('small', null, names)] : []));
          const row = h('label', 'ac-action-choice', checkbox);
          if (action.icon) {
            const image = h('img', 'ac-wow-icon');
            image.alt = '';
            image.loading = 'lazy';
            image.onerror = () => image.remove();
            image.src = API + '/console/wow-icon?id=' + encodeURIComponent(action.icon);
            row.append(image);
          }
          row.append(label);
          checkbox.onchange = () => { checked[index] = checkbox.checked; status.textContent = summary(); };
          return { group, row, name: (action.name + ' ' + names).toLowerCase(), checkbox };
        });
        const render = () => {
          const filter = search.value.trim().toLowerCase();
          menuBack.hidden = category === null;
          list.replaceChildren();
          for (const [group, label] of groups) {
            if (category !== null && group !== category) continue;
            const options = rows.filter(item => item.group === group && item.name.includes(filter));
            if (!options.length) continue;
            if (category === null && !filter) {
              const button = h('button', 'ac-action-category', h('span', null, tp(label)),
                h('span', 'ac-action-count', String(options.length)));
              button.type = 'button';
              button.onclick = () => { category = group; editor.scrollTop = 0; render(); };
              list.append(button);
            } else list.append(h('h4', null, tp(label)), ...options.map(item => item.row));
          }
          if (!list.children.length) list.append(h('p', 'ac-editor-status', tp('No matching actions.')));
        };
        menuBack.onclick = () => { category = null; search.value = ''; editor.scrollTop = 0; render(); };
        status.textContent = summary();
        search.oninput = render;
        search.disabled = save.disabled = false;
        render();
        save.onclick = async () => {
          if (pendingSave) return;
          pendingSave = true;
          save.disabled = cancel.disabled = search.disabled = true;
          rows.forEach(row => { row.checkbox.disabled = true; });
          try {
            const args = new URLSearchParams({ version: book.version, catalog: book.catalog,
              selection: checked.map(value => value ? '1' : '0').join('') });
            const result = await post('/console/action-selection?' + query + '&' + args);
            const saved = await result.json();
            if (!active()) return;
            folders.splice(0, folders.length, ...saved.folders);
            showFolder(folders.find(entry => entry.id === current.id) || current);
          } catch (error) {
            if (active()) status.textContent = error.message || tp('Could not save actions.');
          } finally {
            pendingSave = false;
            save.disabled = cancel.disabled = search.disabled = false;
            rows.forEach(row => { row.checkbox.disabled = false; });
          }
        };
      } catch (error) {
        if (active()) status.textContent = error.message || tp('WoW actions unavailable.');
      }
    };

    edit.onclick = async () => {
      if (PREVIEW && folders) { toast(tp('Use Action bar folders in Layout to edit the widget.')); return; }
      haptic();
      editor.hidden = false;
      const done = h('button', 'ac-key', tp('Done'));
      done.type = 'button';
      done.onclick = () => { closeEditor(); lastPoll = 0; };
      const heading = h('div', 'ac-editor-head', h('b', null, tp('Edit buttons')), done);
      const status = h('div', 'ac-editor-status', t('w.loading'));
      status.setAttribute('role', 'status');
      editor.replaceChildren(heading, status);
      try {
        const folderQuery = fq();
        const bindings = await api(`/console/bindings?${wq}${folderQuery}`);
        if (!alive || editor.hidden) return;
        const select = h('select'), symbol = h('select'), spells = h('select');
        const label = h('input'), bind = h('input');
        let linkedSpell = '', spellBook = null;
        const gameIcon = h('option', null, tp('Use WoW icon'));
        gameIcon.value = 'wow';
        label.maxLength = 24;
        bind.maxLength = 200;
        bind.autocapitalize = 'off';
        bind.spellcheck = false;
        const save = h('button', 'ac-key', tp('Save button'));
        save.type = 'submit';
        const pick = h('button', 'ac-key', tp('Load WoW actions'));
        pick.type = 'button';
        const spellField = h('label', null, tp('WoW action'), spells);
        spellField.hidden = true;
        const form = h('form', 'ac-editor-form',
          h('label', null, tp('Button'), select),
          ...(bindings.spellPicker ? [pick, spellField] : []),
          h('label', null, tp('Button name'), label),
          h('label', null, tp('WoW keybind'), bind),
          h('label', null, tp('Icon'), symbol), save);
        symbol.append(...BUTTON_ICONS.map(([icon, name]) => {
          const option = h('option', null, icon ? icon + ' ' + tp(name) : tp(name));
          option.value = icon;
          return option;
        }));
        symbol.prepend(gameIcon);
        const load = () => {
          const button = bindings.keys[select.selectedIndex];
          linkedSpell = button?.wowSpell || '';
          label.maxLength = linkedSpell ? 120 : 24;
          label.value = button?.label || '';
          bind.value = button?.keys || '';
          bind.placeholder = linkedSpell ? tp('Linked WoW action') : '';
          if (spellBook) spells.value = linkedSpell || '';
          gameIcon.hidden = !(bindings.wowIcons || linkedSpell);
          symbol.value = !gameIcon.hidden && button?.useWowIcon !== false ? 'wow' : button?.icon || '';
          if (symbol.selectedIndex < 0) symbol.value = '';
          save.disabled = select.selectedIndex < 0;
        };
        pick.onclick = async () => {
          pick.disabled = true;
          status.textContent = tp('Loading WoW actions…');
          try {
            const response = await fetch(API + `/console/spells?${wq}${folderQuery}`, { headers: PANEL_HEADERS, cache: 'no-store' });
            const book = await response.json();
            if (!response.ok) throw new Error(book.error);
            if (!alive || editor.hidden) return;
            spellBook = book;
            const first = h('option', null, tp('Choose an action'));
            first.value = '';
            const available = book.spells.filter(spell => folder?.form
              ? spell.forms?.includes(folder.form) : !spell.forms?.length);
            spells.replaceChildren(first, ...available.map(spell => {
              const option = h('option', null, spell.name);
              option.value = spell.id;
              return option;
            }));
            spells.value = linkedSpell;
            spellField.hidden = false;
            status.textContent = book.character + ' · ' + book.className +
              (book.unavailable ? ' · ' + book.unavailable + ' ' + tp('could not be assigned shortcuts') : '');
          } catch (error) {
            if (alive) status.textContent = error.message || tp('Spellbook unavailable.');
          } finally { pick.disabled = false; }
        };
        spells.onchange = () => {
          const spell = spellBook?.spells.find(entry => spells.value === entry.id);
          if (!spell) return;
          linkedSpell = spell.id;
          label.maxLength = 120;
          label.value = spell.name;
          bind.value = '';
          bind.placeholder = tp('Linked WoW action');
          gameIcon.hidden = false;
          symbol.value = 'wow';
        };
        bind.oninput = () => {
          if (!bind.value.trim()) return;
          linkedSpell = '';
          spells.value = '';
          bind.placeholder = '';
          label.maxLength = 24;
        };
        const populate = (selected = 0) => {
          const options = bindings.keys.map(button => h('option', null, button.label));
          if (bindings.keys.length < bindings.maxKeys) options.push(h('option', null, tp('Add button')));
          select.replaceChildren(...options);
          select.selectedIndex = selected;
          load();
        };
        select.onchange = load;
        form.onsubmit = async event => {
          event.preventDefault();
          const index = select.selectedIndex;
          const name = label.value.trim(), combo = bind.value.trim();
          const useWowIcon = symbol.value === 'wow';
          const icon = useWowIcon ? bindings.keys[index]?.icon || '' : symbol.value;
          const query = new URLSearchParams({ index, label: name, keys: combo, icon, version: bindings.version });
          if (linkedSpell) query.set('wowSpell', linkedSpell);
          if (!gameIcon.hidden || bindings.keys[index]?.useWowIcon != null) query.set('useWowIcon', String(useWowIcon));
          for (const field of [select, label, bind, symbol, save, pick, spells]) field.disabled = true;
          done.disabled = true;
          status.textContent = '';
          try {
            const response = await post(`/console/bindings?${wq}${folderQuery}&${query}`);
            bindings.version = (await response.json()).version;
            bindings.keys[index] = { label: name, keys: combo, icon, wowSpell: linkedSpell, useWowIcon };
            populate(index);
            status.textContent = tp('Saved');
            lastPoll = 0;
          } catch (e) {
            status.textContent = e.message;
          } finally {
            for (const field of [select, label, bind, symbol, save, done, pick, spells]) field.disabled = false;
          }
        };
        editor.insertBefore(form, status);
        status.textContent = bindings.spellPicker ? tp('Choose a synced WoW action or enter a shortcut.')
          : tp('Use the keybind assigned in WoW to your ability or macro.');
        populate();
      } catch (_) {
        if (alive) status.textContent = tp('Button settings are unavailable.');
      }
    };

    const render = (state) => {
      if (folder?.category === 'hunter-pet' && state?.hunter === false) {
        const parent = folders.find(entry => entry.id === folder.parent);
        if (parent) { showFolder(parent); return; }
      }
      viewState = state;
      // turns counted for one app never go to the next one's profile
      // and a touch that started on one app's dial never presses the next one's
      if ((state && state.profile && state.profile.id) !== (profile && profile.id)) { pending = 0; turned = 0; start = null; onKnob = false; }
      profile = state && state.profile;
      const s = JSON.stringify(state || null);
      if (s === sig) return;
      sig = s;
      const usable = !!(profile && state.control && state.focused !== false && !state.elevated && o.control === true);
      title.textContent = profile ? profile.label : edit.hidden ? '' : tp('App console');
      const currentFolder = folder;
      const adding = hasSpellQueue() && queue.adding;
      const children = currentFolder ? folders?.filter(entry => entry.parent === currentFolder.id
        && (entry.form !== 30 || state?.stealthed === true)
        && (entry.category !== 'hunter-pet' || state?.hunter === true)) || [] : [];
      const pets = state?.inventory && currentFolder?.category === 'pet';
      const labels = profile?.keys || [];
      const pagesOfPets = pets ? Math.ceil(labels.length / PETS_PER_PAGE) : 0;
      petPage = Math.max(0, Math.min(petPage, pagesOfPets - 1));
      petPager.hidden = pagesOfPets < 2;
      previousPets.disabled = petPage === 0;
      nextPets.disabled = petPage >= pagesOfPets - 1;
      petPageCount.textContent = String(petPage + 1);
      petPageCount.setAttribute('aria-label', `${petPage + 1} / ${pagesOfPets}`);
      const first = pets ? petPage * PETS_PER_PAGE : 0;
      const visibleLabels = pets ? labels.slice(first, first + PETS_PER_PAGE) : labels;
      const actionTiles = visibleLabels.map((label, index) => {
        const i = index + first;
        const b = canEdit ? tile(label, profile.icons?.[i] || (pets ? '🐾' : ''), String(i + 1), profile.iconIds?.[i])
          : h('button', 'ac-key', label);
        if (pets) b.title = label;
        if (fullKeypad()) b.style.gridArea = NUMPAD_AREAS[i];
        const queuedId = profile.queueIds?.[i];
        b.disabled = adding ? !queuedId || queue.sending || queue.entries.length >= MAX_QUEUED_SPELLS
          : !usable || profile.bound?.[i] === false || profile.available?.[i] === false;
        b.onclick = () => {
          haptic();
          if (adding) {
            if (queuedId && queue.entries.length < MAX_QUEUED_SPELLS) {
              queue.entries.push({ id: queuedId, profile: profile.id, slot: i, label });
              redrawQueue();
            }
            return;
          }
          const form = profile.opensForm?.[i];
          const submenu = form && folders?.find(entry => entry.form === form
            && entry.parent === (currentFolder?.parent || currentFolder?.id));
          const openForm = () => { if (alive && folder === currentFolder && submenu) showFolder(submenu); };
          if (PREVIEW && folder) {
            if (submenu) openForm();
            else toast(tp('Preview only · no key was sent'));
            return;
          }
          const item = profile.inventoryIds?.[i];
          const target = item ? `inventory?${wq}&inventoryItem=${encodeURIComponent(item)}` : `k${i}?${wq}`;
          post(`/console/${encodeURIComponent(profile.id)}/${target}`)
            .then(() => {
              if (form === 30) lastPoll = 0;
              else openForm();
            }).catch(fail);
        };
        return b;
      });
      const exit = state?.formExit;
      if (exit && currentFolder?.parent && profile) {
        const button = tile(tp(exit.name), '↩', '←', exit.icon);
        button.disabled = adding || !usable || !exit.available;
        button.onclick = () => {
          haptic();
          post(`/console/${encodeURIComponent(profile.id)}/leave-form?${wq}`).then(() => {
            if (!alive || folder !== currentFolder) return;
            if (currentFolder.form === 30 && lastStealth === true) { lastPoll = 0; return; }
            const destination = (exit.opensForm && folders.find(entry => entry.parent === currentFolder.parent
              && entry.form === exit.opensForm)) || folders.find(entry => entry.id === currentFolder.parent);
            if (destination) showFolder(destination);
          }).catch(fail);
        };
        actionTiles.push(button);
      }
      renderQueue();
      const d = profile && profile.dial;
      dial.hidden = !(usable && o.dial !== false && d && (d.left || d.right || d.press));
      box.classList.toggle('ac-has-dial', !dial.hidden);
      if (!state) say(t(missing ? 'w.console.unavailable' : 'w.offline'));
      else if (!state.supported) say(t('w.console.windowsOnly'));
      else if (!profile) say(t('w.console.noProfile'));
      else if (!state.control || o.control !== true) say(t('w.console.controlOff'));
      else say('');
      if (folder && state?.elevated) tell(tp('Windows blocks input to the administrator app in front.'));
      else if (folder && state?.focused === false) tell(tp(state.keypad ? 'Bring a Windows app to the front.' : 'Bring WoW to the front to use these buttons.'));
      else if (state?.inventory && !profile?.keys.length) tell(tp({
        pet: 'No synced Pet Journal companions. Run /pbspells in WoW to refresh.',
        'hunter-pet': 'Call your hunter pet and run /pbspells in WoW to refresh its commands.',
      }[folder?.category] || 'No synced items here. Run /pbspells in WoW to refresh your bags.'));
      else if (exit?.needsSync) tell(tp('Run /pbspells in WoW to enable Leave Stealth.'));
      else if (folder && profile?.keys.length && profile.bound?.every(value => !value)) tell(tp('Assign a keybind in Action bar folders.'));
      else if (folder && state?.keypad) tell(tp('Sends to the Windows app in front.'));
      else tell('');
      showTiles([...actionTiles, ...children.map(folderTile)]);
    };

    const poll = async () => {
      if (polling || folders && !folder) return;
      const requestedFolder = folder;
      polling = true; lastPoll = Date.now();
      try {
        if (PREVIEW && requestedFolder) {
          const needsLive = requestedFolder.role === 'wow-inventory'
            || folders?.some(entry => entry.parent === requestedFolder.id && entry.category === 'hunter-pet');
          const live = needsLive ? await api(`/console?${wq}${fq()}`).catch(() => null) : null;
          if (!alive || requestedFolder !== folder) return;
          if (requestedFolder.role === 'wow-inventory') {
            const bag = live?.profile || { id: requestedFolder.id, label: requestedFolder.label, keys: [] };
            render({ supported: true, control: true, focused: true, inventory: true,
              hunter: live?.hunter,
              profile: { ...bag, available: bag.keys.map(() => true) } });
            return;
          }
          const draft = cfg.console?.profiles?.find(p => p.id === requestedFolder.id);
          const buttons = (draft?.keys || []).filter(k => k.label?.trim() || k.keys?.trim());
          render({ supported: true, control: o.control === true, focused: true, keypad: requestedFolder.allApps === true,
            hunter: live?.hunter,
            profile: { id: requestedFolder.id, label: requestedFolder.label,
              keys: buttons.map(k => k.label?.trim() || k.keys?.trim()),
              queueIds: buttons.map(k => k.wowSpell && !/^(ITEM|TRINKET|POISON|PET|COMPANION|MACRO|EXIT):/.test(k.wowSpell) ? k.wowSpell : null),
              icons: buttons.map(k => k.icon), iconIds: buttons.map(k => k.useWowIcon === false ? 0 : k.wowIcon),
              opensForm: buttons.map(k => k.wowOpenForm || (k.wowSpell === 'ROGUE:Stealth' ? 30 : 0)),
              bound: buttons.map(k => Boolean(k.wowSpell || k.keys?.trim())) } });
          return;
        }
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        try {
          const r = await fetch(`${API}/console?${wq}${fq()}`, { cache: 'no-store', headers: PANEL_HEADERS, signal: ctl.signal });
          const state = r.ok ? await r.json() : null;
          if (!alive || requestedFolder !== folder) return;
          if (editor.hidden) {
            const previous = lastStealth;
            lastStealth = typeof state?.stealthed === 'boolean' ? state.stealthed : null;
            const root = folder?.role === 'wow-actions' ? folder
              : folders?.find(entry => entry.id === folder?.parent && entry.role === 'wow-actions');
            if (root && lastStealth === true && previous !== true && (folder === root || folder?.form === 1)) {
              const submenu = folders.find(entry => entry.parent === root.id && entry.form === 30);
              if (submenu) { showFolder(submenu); return; }
            } else if (root && lastStealth !== true && folder?.form === 30) {
              const cat = state?.formExit?.opensForm === 1
                ? folders.find(entry => entry.parent === root.id && entry.form === 1) : null;
              showFolder(cat || root);
              return;
            }
          }
          // 404: an older agent, or this page isn't one of this phone's pages in Settings › Phones
          missing = r.status === 404;
          render(state);
        } finally { clearTimeout(timer); }
      } catch (_) { if (alive && requestedFolder === folder) render(null); }
      finally { polling = false; if (folder && requestedFolder !== folder) poll(); }
    };

    // turns are sent one request at a time; what piles up meanwhile goes in the next one (at most 5 clicks each)
    const flush = () => {
      // nothing queued goes out once the widget is gone or out of sight
      if (!alive || !visible()) pending = 0;
      if (sending || !pending || !profile) return;
      const n = Math.max(-5, Math.min(5, pending));
      pending -= n;
      sending = true;
      post(`/console/${encodeURIComponent(profile.id)}/${n > 0 ? 'dial-right' : 'dial-left'}?times=${Math.abs(n)}&${wq}`)
        .catch((e) => { pending = 0; fail(e); })
        .then(() => { sending = false; flush(); });
    };

    let start = null, onKnob = false;
    // idle(): nobody can see the panel (screen off, another app in front, a hidden tab)
    const visible = () => !idle() && !document.body.classList.contains('night') && pages[curPage] === page && !box.closest('.stack-item:not(.active)');
    const at = (e) => { const r = dial.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    dial.onpointerdown = (e) => {
      const r = dial.getBoundingClientRect();
      onKnob = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < r.width * 0.32;
      start = at(e); turned = 0; moved = 0; try { dial.setPointerCapture(e.pointerId); } catch (_) {} };
    dial.onpointermove = (e) => {
      if (start === null) return;
      const now = at(e);
      // near the centre a tiny jitter is a big angle: it neither turns nor spoils a press there
      const r = dial.getBoundingClientRect();
      if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) < r.width * 0.2) { start = now; return; }
      let delta = now - start;
      if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
      start = now; angle += delta; turned += delta; moved += Math.abs(delta);
      knob.style.transform = `rotate(${angle}deg)`;
      while (Math.abs(turned) >= STEP_DEG) {
        const dir = turned > 0 ? 1 : -1;
        turned -= dir * STEP_DEG;
        if ((dir > 0 ? profile?.dial?.right : profile?.dial?.left)) { pending += dir; haptic(); }
      }
      flush();
    };
    dial.onpointerup = dial.onpointercancel = (e) => {
      // a press is a touch on the knob that hardly turned it
      const tap = start !== null && moved < 6 && e.type === 'pointerup' && onKnob;
      start = null;
      if (tap && profile?.dial?.press) { haptic(); post(`/console/${encodeURIComponent(profile.id)}/dial-press?${wq}`).catch(fail); }
    };

    if (folders) {
      const previous = folders.find(entry => entry.id === openFolders.get(wq));
      if (previous) showFolder(previous);
      else home();
    }
    return {
      update() {
        // neighbouring pages and hidden Smart Stack cards get ticks too; the focused app is asked about only while
        // this widget is actually showing
        if (!alive || !visible()) return;
        if (Date.now() - lastPoll > 1500) poll();
      },
      destroy() { alive = false; pending = 0; fitObserver?.disconnect(); },
    };
  },
};
