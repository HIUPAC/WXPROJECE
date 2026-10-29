const theme = require('../../data/ui-theme');
const { iconSource } = require('../../data/ui-icons');

Component({
  properties: { name: { type: String, value: 'leaf' }, size: { type: Number, value: 20 }, color: { type: String, value: theme.primary } },
  data: { source: iconSource('leaf', theme.primary) },
  observers: {
    'name,color': function (name, color) {
      this.setData({ source: iconSource(name, String(color || theme.primary).toLowerCase()) });
    },
  },
});
