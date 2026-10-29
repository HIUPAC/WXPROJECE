const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const { catalog } = require('../miniprogram/data/catalog');
const subpackages = app.subPackages || app.subpackages || [];
const PACKAGE_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 20 * 1024 * 1024;
let checks = 0;
function ensure(condition, message) { if (!condition) throw new Error(message); checks++; }
function exists(relative) { return fs.existsSync(path.join(mini, relative.replace(/^\//, ''))); }
function matchPackRule(file, rule) {
  const value = String(rule.value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (rule.type === 'folder') return file === value || file.startsWith(value + '/');
  if (rule.type === 'file') return file === value;
  if (rule.type === 'suffix') return file.endsWith(value);
  if (rule.type === 'prefix') return file.startsWith(value);
  if (rule.type === 'regexp') return new RegExp(rule.value).test(file);
  throw new Error('Unsupported package rule type: ' + rule.type);
}
function isIgnored(file) {
  const options = project.packOptions || {};
  return (options.ignore || []).some(rule => matchPackRule(file, rule)) && !(options.include || []).some(rule => matchPackRule(file, rule));
}
function validatePage(page) {
  ensure(!page.startsWith('/') && !page.split('/').includes('..'), 'Page path must stay in the project: ' + page);
  ['js', 'json', 'wxml', 'wxss'].forEach(ext => {
    ensure(exists(page + '.' + ext), 'Missing page file: ' + page + '.' + ext);
    ensure(!isIgnored(page + '.' + ext), 'Registered page excluded from package: ' + page + '.' + ext);
  });
  validateConfig(page);
  validateEvents(page);
}
function validateEvents(base) {
  const file = path.join(mini, base + '.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require: createRequire(file), Page: value => { definition = value; }, Component: value => { definition = value; },
    module: { exports: {} }, getApp: () => ({ globalData: {} }), wx: {}, setTimeout, clearTimeout, console
  }, { filename: file });
  ensure(Boolean(definition), 'Missing Page/Component registration: ' + base);
  const handlers = definition.methods || definition;
  const template = fs.readFileSync(path.join(mini, base + '.wxml'), 'utf8');
  for (const match of template.matchAll(/(?:capture-)?(?:bind|catch):?[\w-]+="([A-Za-z_$][\w$]*)"/g)) {
    ensure(typeof handlers[match[1]] === 'function', base + ': missing event handler ' + match[1]);
  }
}
function validateConfig(base) {
  const config = JSON.parse(fs.readFileSync(path.join(mini, base + '.json'), 'utf8'));
  Object.entries(config.usingComponents || {}).forEach(([name, target]) => {
    const component = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
    ensure(exists(component + '.json'), base + ': missing component ' + name);
  });
}
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.name !== 'node_modules').flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const packageRoots = [];
subpackages.forEach(pack => {
  ensure(typeof pack.root === 'string' && Boolean(pack.root), 'A subpackage needs a root');
  const packageRoot = pack.root.replace(/\\/g, '/').replace(/\/+$/g, '');
  ensure(!packageRoot.startsWith('/') && !packageRoot.split('/').includes('..') && packageRoot !== '.', 'Invalid subpackage root: ' + pack.root);
  ensure(!packageRoots.some(known => known === packageRoot || known.startsWith(packageRoot + '/') || packageRoot.startsWith(known + '/')), 'Duplicate or nested subpackage root: ' + packageRoot);
  ensure(exists(packageRoot) && fs.statSync(path.join(mini, packageRoot)).isDirectory(), 'Missing subpackage directory: ' + packageRoot);
  ensure(Array.isArray(pack.pages), 'Subpackage pages must be an array: ' + packageRoot);
  packageRoots.push(packageRoot);
  pack.pages.forEach(page => validatePage(path.posix.join(packageRoot, page)));
  if (pack.entry) {
    const entry = path.posix.join(packageRoot, pack.entry);
    ensure(!pack.entry.startsWith('/') && !pack.entry.split('/').includes('..'), 'Invalid subpackage entry: ' + entry);
    ensure(exists(entry) && !isIgnored(entry), 'Missing or excluded subpackage entry: ' + entry);
  }
});
app.pages.forEach(page => {
  ensure(!packageRoots.some(packageRoot => page.startsWith(packageRoot + '/')), 'Main-package page is inside a subpackage: ' + page);
  validatePage(page);
});
app.tabBar.list.forEach(tab => {
  ensure(app.pages.includes(tab.pagePath), 'Unregistered tab: ' + tab.pagePath);
  [tab.iconPath, tab.selectedIconPath].forEach(file => { ensure(exists(file), 'Missing tab icon: ' + file); ensure(fs.statSync(path.join(mini, file)).size < 40960, 'Tab icon too large: ' + file); });
});
catalog.filter(item => Boolean(item.image)).forEach(item => {
  ensure(exists(item.image), 'Missing local content image: ' + item.image);
  ensure(!isIgnored(item.image.replace(/^\//, '')), 'Content image excluded from package: ' + item.image);
});
['app-icon', 'content-card', 'page-header'].forEach(name => {
  validateConfig('components/' + name + '/index');
  validateEvents('components/' + name + '/index');
});
const files = walk(mini);
files.filter(file => file.endsWith('.json')).forEach(file => { JSON.parse(fs.readFileSync(file, 'utf8')); checks++; });
files.concat(walk(path.join(root, 'tests')), walk(path.join(root, 'cloudfunctions'))).filter(file => file.endsWith('.js')).forEach(file => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  ensure(result.status === 0, 'JS syntax error: ' + file + '\n' + result.stderr);
});
const budgets = new Map([['main', 0], ...packageRoots.map(packageRoot => [packageRoot, 0])]);
let totalBytes = 0;
files.forEach(file => {
  const relative = path.relative(mini, file).replace(/\\/g, '/');
  if (isIgnored(relative)) return;
  const packageName = packageRoots.find(packageRoot => relative.startsWith(packageRoot + '/')) || 'main';
  const bytes = fs.statSync(file).size;
  budgets.set(packageName, budgets.get(packageName) + bytes);
  totalBytes += bytes;
});
budgets.forEach((bytes, packageName) => ensure(bytes < PACKAGE_LIMIT, `${packageName} source package is ${(bytes / 1024 / 1024).toFixed(2)} MiB; must remain below 2 MiB`));
ensure(totalBytes < TOTAL_LIMIT, `All source packages total ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; must remain below 20 MiB`);
console.log('Project validation passed: ' + checks + ' syntax, route, event, component, asset and package checks.');
console.log('Source package sizes: ' + [...budgets].map(([name, bytes]) => `${name} ${(bytes / 1024).toFixed(1)} KiB`).join(', ') + '; total ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MiB.');
