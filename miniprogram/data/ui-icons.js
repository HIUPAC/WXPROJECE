// Original line icons: one 24px grid, 1.65px stroke, no external requests.
const shapes = {
  leaf: '<path d="M20 4c-8 0-15 3-15 10a6 6 0 0 0 6 6c7 0 9-8 9-16Z"/><path d="M4 21 16 9m-6 6v-5m3 2h5"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  pen: '<path d="m15 5 4 4M4 20l5-1L21 7l-4-4L5 15l-1 5Zm1-5 4 4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/>',
  heart: '<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 7l-1.3-1.4a5 5 0 0 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-1a8 6 0 0 1 16 0v1"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15m-8 4v7m4-7v7"/>',
  edit: '<path d="M11 4H4v16h16v-7M9 15l1-4 8-8 3 3-8 8-4 1Zm7-10 3 3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>'
};

function svgMarkup(name, color) {
  const shape = Object.prototype.hasOwnProperty.call(shapes, name) ? shapes[name] : shapes.leaf;
  const stroke = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : color === 'white' ? '#ffffff' : '#244b3b';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + shape + '</svg>';
}

function iconSource(name, color) { return 'data:image/svg+xml,' + encodeURIComponent(svgMarkup(name, color)); }
module.exports = { names: Object.keys(shapes), svgMarkup, iconSource };
