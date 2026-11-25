(function () {
  'use strict';
  var nav = document.getElementById('pages');
  var deck = document.getElementById('deck');
  var connection = document.getElementById('connection');
  var feedback = document.getElementById('feedback');
  var config, version, pageId, state, obs, mixer, gameFps, timer;
  var paused = false;
  var online = false;
  var pending = false;
  var sending = false;
  var api = '/agent/api/';
  var stateWidgets = ['stat', 'gauge', 'meters', 'gpu', 'volume', 'media'];
  var supported = stateWidgets.concat(['shortcuts', 'button', 'obs', 'audio-mixer']);
  var svgNamespace = 'http://www.w3.org/2000/svg';

  function request(path, method, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, api + path, true);
    xhr.setRequestHeader('X-PhoneBox-Panel', '1');
    xhr.timeout = method === 'GET' ? 8000 : 35000;
    xhr.onload = function () {
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (error) {}
      done(xhr.status >= 200 && xhr.status < 300 && (!data || data.ok !== false), data);
    };
    xhr.onerror = xhr.ontimeout = function () { done(false); };
    xhr.send();
  }

  function button(parent, label, handler, pressed) {
    var element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.onclick = handler;
    if (typeof pressed === 'boolean') element.setAttribute('aria-pressed', String(pressed));
    parent.appendChild(element);
    return element;
  }

  function action(parent, label, path, enabled, pressed) {
    var element = button(parent, label, function () {
      if (sending || !online || paused) return;
      sending = true;
      feedback.textContent = 'Sending…';
      request(path, 'POST', function (ok, result) {
        sending = false;
        feedback.textContent = ok ? '' : (result && result.error) || 'No confirmation from PC. Check before retrying.';
        poll();
      });
    }, pressed);
    element.className = 'key';
    element.disabled = !online || enabled === false;
    return element;
  }

  function metric(parent, label, value, wide) {
    var element = document.createElement('div');
    var name = document.createElement('span');
    var reading = document.createElement('strong');
    element.className = wide ? 'metric wide' : 'metric';
    name.className = 'metric-label';
    reading.className = 'metric-value';
    name.textContent = label;
    reading.textContent = value;
    element.appendChild(name);
    element.appendChild(reading);
    parent.appendChild(element);
  }

  function number(value, unit) {
    return typeof value === 'number' ? Math.round(value) + unit : '—';
  }

  function capacity(used, total) {
    return typeof used === 'number' && total > 0 ? used.toFixed(1) + ' / ' + total.toFixed(1) + ' GB' : '—';
  }

  function rate(bytes) {
    if (typeof bytes !== 'number') return '—';
    return bytes >= 125000 ? (bytes / 125000).toFixed(1) + ' Mb/s' : number(bytes / 125, ' kb/s');
  }

  function duration(seconds) {
    if (typeof seconds !== 'number') return '—';
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor(seconds / 3600) % 24;
    var minutes = Math.floor(seconds / 60) % 60;
    return (days ? days + 'd ' : '') + hours + 'h ' + minutes + 'm';
  }

  function isFps(widget) {
    return widget.type === 'push' && widget.options && widget.options.key === 'game-fps';
  }

  function graph(parent, title, points, unit, color) {
    var valid = Array.isArray(points) && points.slice(-60).filter(function (value) {
      return typeof value === 'number' && isFinite(value) && value > 0;
    });
    if (!valid || !valid.length) return;
    var label = title + ' · last ' + valid.length + ' samples';
    var card = document.createElement('section');
    card.className = 'metric wide game-chart';
    var name = document.createElement('span');
    name.className = 'metric-label';
    name.textContent = label;
    var reading = document.createElement('strong');
    reading.className = 'metric-value';
    reading.textContent = valid[valid.length - 1].toFixed(unit === ' ms' ? 1 : 0) + unit;
    card.appendChild(name);
    card.appendChild(reading);
    if (valid.length > 1) {
      var graph = document.createElementNS(svgNamespace, 'svg');
      graph.setAttribute('viewBox', '0 0 300 42');
      graph.setAttribute('preserveAspectRatio', 'none');
      graph.setAttribute('aria-label', label);
      var line = document.createElementNS(svgNamespace, 'polyline');
      var highest = Math.max.apply(null, valid) * 1.1;
      line.setAttribute('points', valid.map(function (value, index) {
        return (300 * index / (valid.length - 1)).toFixed(1) + ',' + (40 - 38 * value / highest).toFixed(1);
      }).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1.5');
      graph.appendChild(line);
      card.appendChild(graph);
    }
    parent.appendChild(card);
  }

  function shortcuts(parent, widget) {
    var options = widget.options || {};
    var ids = widget.type === 'button' && options.id ? [options.id] : options.ids || [];
    var items = config.shortcuts || [];
    if (ids.length) {
      items = ids.map(function (id) {
        return items.filter(function (item) { return item.id === id; })[0];
      }).filter(Boolean);
    }
    if (widget.type === 'button') items = items.slice(0, 1);
    items.forEach(function (item) {
      var path = 'run/' + encodeURIComponent(item.id);
      var key = action(parent, (item.icon ? item.icon + ' ' : '') + item.label, path);
      if (/^#[0-9a-f]{6}$/i.test(item.color || '')) key.style.borderColor = item.color;
    });
    if (!items.length) metric(parent, 'Shortcuts', 'Configure on PC');
  }

  function drawWidget(parent, widget) {
    var pc = (state && state.pc) || {};
    var gpu = pc.gpu || {};
    var audio = state && state.audio;
    var options = widget.options || {};
    var snapshot = obs && obs.snapshot;
    if (isFps(widget)) {
      if (gameFps && Array.isArray(gameFps.fps) && gameFps.fps.length) {
        graph(parent, 'Game FPS', gameFps.fps, ' FPS', '#71d2c2');
        graph(parent, 'Frame time', gameFps.frameMs, ' ms', '#87acf5');
      } else {
        metric(parent, 'Game FPS', 'Waiting for PC capture', true);
      }
    } else if (widget.type === 'shortcuts' || widget.type === 'button') {
      shortcuts(parent, widget);
    } else if (widget.type === 'stat' || widget.type === 'gauge') {
      var ping = state && state.ping;
      var metrics = {
        cpu: ['CPU', number(pc.cpu, '%')], gpu: ['GPU', number(gpu.util, '%')],
        ram: ['RAM', number(pc.ramTotalGb > 0 ? 100 * pc.ramUsedGb / pc.ramTotalGb : null, '%')],
        vram: ['VRAM', capacity(gpu.vramUsed, gpu.vramTotal)],
        net: ['Network', '↓ ' + rate(pc.netDownBps) + ' · ↑ ' + rate(pc.netUpBps)],
        ping: ['Ping', number(ping && ping.ms, ' ms')],
        cputemp: ['CPU temp', pc.cpuTemp == null && state && state.os === 'windows' ? 'Needs sensor feed' : number(pc.cpuTemp, ' °C')],
        gputemp: ['GPU temp', number(gpu.temp, ' °C')],
        hotspot: ['GPU hot spot', number(gpu.hotSpot, ' °C')], gpupower: ['GPU power', number(gpu.power, ' W')],
        gpuclock: ['GPU clock', number(gpu.clock, ' MHz')]
      };
      var reading = metrics[options.metric || 'cpu'];
      if (reading) metric(parent, reading[0], reading[1], options.metric === 'net');
    } else if (widget.type === 'meters') {
      metric(parent, 'RAM used', capacity(pc.ramUsedGb, pc.ramTotalGb));
      metric(parent, 'PC uptime', duration(pc.uptimeSec));
      (pc.disks || []).forEach(function (disk) {
        var free = Math.max(0, disk.totalGb - disk.usedGb);
        metric(parent, disk.name + ' free', number(free, ' GB') + ' / ' + number(disk.totalGb, ' GB'));
      });
    } else if (widget.type === 'gpu') {
      var index = Number(options.adapter) || 0;
      var adapter = (pc.gpus || [])[index] || (index === 0 ? pc.gpu : null);
      if (!adapter) {
        metric(parent, 'GPU details', 'Unavailable');
        return;
      }
      metric(parent, adapter.name || 'Graphics card', number(adapter.util, '%'), true);
      metric(parent, 'GPU temperature', number(adapter.temp, ' °C'));
      metric(parent, 'VRAM used', capacity(adapter.vramUsed, adapter.vramTotal));
      if (adapter.power != null) metric(parent, 'GPU power', number(adapter.power, ' W'));
      if (adapter.clock != null) metric(parent, 'GPU clock', number(adapter.clock, ' MHz'));
      if (adapter.fanRpm != null) metric(parent, 'GPU fan', number(adapter.fanRpm, ' RPM'));
      else if (adapter.fan != null) metric(parent, 'GPU fan', number(adapter.fan, '%'));
    } else if (widget.type === 'volume') {
      metric(parent, 'Volume', audio ? number(audio.volume, '%') : '—');
      action(parent, 'Volume −', 'volume?op=down', !!audio && audio.canControl);
      action(parent, 'Volume +', 'volume?op=up', !!audio && audio.canControl);
      action(parent, audio && audio.muted ? 'Unmute PC' : 'Mute PC', 'volume?op=mute', !!audio && audio.canControl);
    } else if (widget.type === 'audio-mixer') {
      if (!mixer || !mixer.sessions || !mixer.sessions.length) {
        metric(parent, 'Mixer', 'No active audio sessions');
        return;
      }
      mixer.sessions.forEach(function (session) {
        var path = 'controls/command/session?id=' + encodeURIComponent(session.id);
        metric(parent, session.name, number(session.volume, '%'));
        action(parent, '−5%', path + '&value=' + Math.max(0, session.volume - 5));
        action(parent, '+5%', path + '&value=' + Math.min(100, session.volume + 5));
        action(parent, session.muted ? 'Unmute' : 'Mute', path + '&muted=' + !session.muted, true, session.muted);
      });
    } else if (widget.type === 'media') {
      var media = state && state.media;
      var title = media && media.title;
      metric(parent, media && media.artist || 'Now playing', title || 'No active media');
      action(parent, 'Previous', 'media/prev');
      action(parent, media && media.playing ? 'Pause' : 'Play', 'media/playpause');
      action(parent, 'Next', 'media/next');
    } else if (widget.type === 'obs') {
      if (!snapshot || !snapshot.connected) {
        metric(parent, 'OBS', obs && obs.enabled ? 'Disconnected' : 'Configure on PC');
        return;
      }
      var enabled = obs.control === true && options.control === true;
      metric(parent, 'Active scene', snapshot.scene || '—');
      metric(parent, 'Streaming', snapshot.streaming ? 'Live' : 'Off');
      metric(parent, 'Recording', snapshot.recordPaused ? 'Paused' : snapshot.recording ? 'Recording' : 'Off');
      action(parent, snapshot.recording ? 'Stop recording' : 'Start recording', 'obs/record', enabled);
      action(parent, snapshot.streaming ? 'Stop stream' : 'Start stream', 'obs/stream', enabled);
      if (snapshot.micName) action(parent, snapshot.micMuted ? 'Unmute OBS mic' : 'Mute OBS mic', 'obs/mic', enabled);
      if (options.scenes !== false) (snapshot.scenes || []).forEach(function (scene) {
        action(parent, scene, 'obs/scene?scene=' + encodeURIComponent(scene), enabled, snapshot.scene === scene);
      });
    }
  }

  function pages() {
    return ((config && config.pages) || []).filter(function (page) {
      return page.enabled !== false && page.widgets.some(function (widget) {
        return isFps(widget) || supported.indexOf(widget.type) !== -1;
      });
    });
  }

  function current() {
    var available = pages();
    return available.filter(function (page) { return page.id === pageId; })[0] || available[0];
  }

  function render() {
    var selected = current();
    if (selected) pageId = selected.id;
    var layout = document.createElement('div');
    layout.className = 'tiles';
    if (selected) selected.widgets.forEach(function (widget) { drawWidget(layout, widget); });
    if (!layout.children.length) metric(layout, 'Deck', config ? 'Add supported widgets on PC' : 'Connect to PhoneBox');
    var signature = JSON.stringify([version, pageId, online, layout.innerHTML]);
    if (render.signature === signature) return;
    render.signature = signature;
    nav.textContent = '';
    pages().forEach(function (page) {
      button(nav, page.title, function () { pageId = page.id; obs = null; render(); poll(); }, page.id === pageId);
    });
    deck.textContent = '';
    deck.appendChild(layout);
  }

  function poll() {
    clearTimeout(timer);
    if (pending || paused || document.hidden) return;
    pending = true;
    function finish(ok) {
      pending = false;
      online = ok;
      connection.textContent = ok ? 'PC connected' : 'PC offline';
      render();
      if (!paused) timer = setTimeout(poll, ok ? 2500 : 5000);
    }
    request('config', 'GET', function (ok, envelope) {
      if (!ok || !envelope || !envelope.config) return finish(false);
      config = envelope.config;
      version = envelope.version;
      if (window.Android && window.__phoneboxKey) {
        var display = config.display || {};
        window.Android.setHomeScreen(window.__phoneboxKey, display.homeScreen === true);
        window.Android.setVolumeKeys(window.__phoneboxKey, display.volumeKeys !== false);
        var charge = config.charge;
        if (charge && typeof charge.reminders === 'boolean' && typeof window.Android.setBatteryReminders === 'function')
          window.Android.setBatteryReminders(window.__phoneboxKey, charge.reminders, charge.min, charge.max);
      }
      var selected = current();
      if (paused || !selected) return finish(true);
      var types = selected.widgets.map(function (widget) { return widget.type; });
      var paths = [];
      if (types.indexOf('obs') !== -1) paths.push('obs');
      if (types.some(function (type) { return stateWidgets.indexOf(type) !== -1; })) paths.push('state');
      if (types.indexOf('audio-mixer') !== -1) paths.push('controls/state');
      if (selected.widgets.some(isFps)) paths.push('push/game-fps');
      var remaining = paths.length;
      var allReady = true;
      if (!remaining) return finish(true);
      function store(path, ready, data) {
        if (path !== 'push/game-fps') allReady = allReady && ready;
        if (path === 'push/game-fps') gameFps = ready && data ? data.data : null;
        else if (path === 'obs') obs = ready ? data : null;
        else if (path === 'controls/state') mixer = ready && data ? data.audio : null;
        else state = ready ? data : null;
        remaining--;
        if (!remaining) finish(allReady);
      }
      paths.forEach(function (path) {
        request(path, 'GET', function (ready, data) { store(path, ready, data); });
      });
    });
  }

  window.onAppPause = function (value) { paused = value; poll(); };
  window.onAndroidKey = function (key) {
    var available = pages();
    for (var index = 0; index < available.length; index++) {
      if (available[index].id !== pageId) continue;
      var next = (index + available.length + (key === 'next' ? 1 : -1)) % available.length;
      pageId = available[next].id;
      obs = null;
      render();
      poll();
      break;
    }
  };
  document.addEventListener('visibilitychange', poll);
  poll();
})();
