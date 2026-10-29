// The shared header receives native page lifetimes, including switchTab and back.
// Keep content visible by default and cancel stale setData callbacks on hide.
function stop(page) {
  if (!page) return;
  page._uiMotionEpoch = (page._uiMotionEpoch || 0) + 1;
  if (page._uiMotionTimer) clearTimeout(page._uiMotionTimer);
  page._uiMotionTimer = null;
}

function enter(page) {
  if (!page || typeof page.setData !== 'function') return;
  stop(page);
  const epoch = page._uiMotionEpoch;
  page.setData({ uiPhase: '' }, () => {
    if (page._uiMotionEpoch !== epoch) return;
    page.setData({ uiPhase: 'ui-enter' });
    page._uiMotionTimer = setTimeout(() => {
      if (page._uiMotionEpoch !== epoch) return;
      page._uiMotionTimer = null;
      // Clear the transform to restore normal containing blocks for fixed controls.
      page.setData({ uiPhase: '' });
    }, 300);
  });
}

module.exports = { enter, stop };
