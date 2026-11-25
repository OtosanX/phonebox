(() => {
  const cols = 6;
  const maxRows = 200;
  function layout(widgets) {
    const occupied = [], pos = new Map();
    const free = ({ x, y, w, h }) => {
      for (let r = y; r < y + h; r++)
        for (let c = x; c < x + w; c++)
          if (occupied[r]?.[c]) return false;
      return true;
    };
    const place = (widget, rect) => {
      for (let r = rect.y; r < rect.y + rect.h; r++) {
        const row = occupied[r] || (occupied[r] = []);
        for (let c = rect.x; c < rect.x + rect.w; c++) row[c] = true;
      }
      pos.set(widget, rect);
    };
    for (const widget of widgets) {
      const rect = widget.portrait;
      if (rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) &&
          rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 &&
          rect.x + rect.w <= cols && rect.y + rect.h <= maxRows && free(rect))
        place(widget, rect);
    }
    for (const widget of [...widgets].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (pos.has(widget)) continue;
      const w = Math.max(1, Math.min(cols, widget.w || 1));
      const h = Math.max(1, widget.h || 1);
      search: for (let y = 0; y <= occupied.length; y++)
        for (let x = 0; x + w <= cols; x++) {
          const rect = { x, y, w, h };
          if (free(rect)) { place(widget, rect); break search; }
        }
    }
    return { cols, rows: Math.max(12, occupied.length), pos };
  }
  window.PhoneBoxPortrait = { cols, maxRows, layout };
})();
