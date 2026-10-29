// 本地学习内容。图片随小程序打包，详情页面无需远程图片域名。
const image = {
  flowers: '/images/botanical/flowers.jpg',
  orange: '/images/botanical/orange.jpg',
  berries: '/images/botanical/berries.jpg',
  garden: '/images/botanical/garden.jpg'
};

const legacyCatalog = [
  {
    id: 'c1',
    kind: 'course',
    title: '从一片叶子开始，认识本草',
    subtitle: '给初学者的本草观察课',
    category: '本草入门',
    minutes: 18,
    image: image.flowers,
    description: '不急着记住名字，先学会观察。用颜色、形态与纹理，为身边的植物建立一份属于自己的记录。',
    chapters: [
      {
        id: 'c1-1',
        title: '看见：建立观察习惯',
        body: '挑选一株可以安全接近的植物，记录观察日期、地点和周围环境。先用自己的语言描述，不必急于确定它的名字。不要采摘保护植物或进入禁止通行的区域。'
      },
      {
        id: 'c1-2',
        title: '记录：叶片与花朵的细节',
        body: '画下叶片轮廓，记录叶缘、叶脉、叶片排列和花朵颜色。拍摄整体与局部照片，并在画面旁标注尺寸参照。同一种植物在不同季节可能有不同外观。'
      },
      {
        id: 'c1-3',
        title: '整理：做一张观察卡',
        body: '把日期、照片、草图与观察要点整理在一起。将尚未核实的名称标为待确认，使用可靠的植物图鉴核对。观察记录用于学习，不能作为自行采食或用药的依据。'
      }
    ]
  },
  {
    id: 'c2',
    kind: 'course',
    title: '一枚香囊里的草木记忆',
    subtitle: '传统手作与纹样入门',
    category: '本草手作',
    minutes: 24,
    image: image.orange,
    description: '从选布、绘制纹样到缝合，认识传统香囊作为生活器物的文化与制作过程。',
    chapters: [
      {
        id: 'c2-1',
        title: '准备布料与工具',
        body: '准备棉布、针线、剪刀和纸样。第一次制作可用干净棉花填充，重点练习结构与缝合。使用针剪时注意安全，儿童需在成人陪同下操作。'
      },
      {
        id: 'c2-2',
        title: '绘制纹样与缝合',
        body: '在纸上画一个简单的方形或圆形纸样，留出缝份。布料正面相对缝合，预留返口后翻面。装入填充物，以藏针法收口，最后加上挂绳。'
      },
      {
        id: 'c2-3',
        title: '记录作品与心得',
        body: '给作品拍照，在学习笔记中记下布料、尺寸与改进点。香囊作为文化手作展示，不宣称任何治疗效果；对香气敏感的人可使用无香填充物。'
      }
    ]
  },
  {
    id: 'c3',
    kind: 'course',
    title: '把四季写进植物笔记',
    subtitle: '自然观察与笔记方法',
    category: '自然观察',
    minutes: 16,
    image: image.garden,
    description: '用一页简单的笔记记录季节、天气与植物变化，建立长期观察的节奏。',
    chapters: [
      {
        id: 'c3-1',
        title: '选择固定观察点',
        body: '选择容易到达的公园或花坛，以同一位置、同一视角持续记录。写下日期、天气、光照与植物外观，尊重场地规则。'
      },
      {
        id: 'c3-2',
        title: '用文字与图像整理',
        body: '每次记录一个新发现，结合照片与简短描述。把变化与猜测分开，不确定的内容留待核实。完成后写一段自己的学习总结。'
      }
    ]
  },
  ...[
    ['h1', '菊花', '花朵', image.flowers, '从花瓣、花心和干燥后的形态出发，认识本草记录中的菊花。', '观察花序的结构和颜色，比较照片中的完整花朵与干燥花材。记录来源，不要仅凭图片辨认野外植物。'],
    ['h2', '陈皮', '果实与果皮', image.orange, '一片果皮，记录着时间与日常生活的联系。', '观察果皮内外表面的颜色与纹理。以生活文化和材料观察为主题，记录形态与保存方式。'],
    ['h3', '枸杞', '果实与果皮', image.berries, '用颜色、大小和表面纹理认识常见的干燥果实。', '观察果实的外形、色泽与褶皱，记录样本来源和照片日期。图片与名称不构成鉴别、食用或用药指导。']
  ].map(([id, title, category, img, description, body]) => ({
    id,
    kind: 'herb',
    title,
    category,
    image: img,
    description,
    body,
    subtitle: '本草观察档案'
  })),
  {
    id: 'n1',
    kind: 'note',
    title: '今天，从认真观察一朵花开始',
    subtitle: '百草源编辑部 · 观察笔记',
    category: '精选笔记',
    image: image.flowers,
    description: '学习本草，也是一种重新注意日常的方式。',
    body: '把一朵花放在视线里，先不查名字。记下花瓣的形状、颜色，以及让你想停下来看的细节。\n\n一张观察笔记可以很简单：日期、地点、一张照片、三个关键词。写下确定的事实，也保留还没有答案的问题。\n\n观察不等于鉴别，更不等于用药。带着问题继续阅读可靠资料，是学习的一部分。'
  },
  {
    id: 'n2',
    kind: 'note',
    title: '留住一片陈皮的纹理',
    subtitle: '百草源编辑部 · 草木日常',
    category: '精选笔记',
    image: image.orange,
    description: '从生活中的小物件，开始自己的本草记录。',
    body: '颜色并不总是一个词就能说清。试着写下果皮从边缘到中心的颜色变化，再观察表面起伏。\n\n把照片与自己的文字放在一起，记录样本来源与日期。下一次观察时，回头比较这张记录，看看有没有新的发现。'
  },
  {
    id: 'r1',
    kind: 'route',
    title: '走进药园，读一读植物的名字',
    subtitle: '药园文化 · 自主观察',
    category: '寻药文化',
    image: image.garden,
    description: '把散步变成一场观察，从园内的植物标牌、环境与季节变化读起。',
    body: '出发前，查询当地植物园或药园的开放时间与参观规则。\n\n第一站：读标牌，记录中文名、学名与科属。\n第二站：看环境，注意植物周围的光照和土壤。\n第三站：做笔记，把照片与疑问整理在一起。\n\n这是一份自主参观方法，不提供预约或带队服务。请勿采摘、试吃或自行配药。'
  }
];

const expanded = require('./public-learning');
const catalog = expanded.courses.concat(legacyCatalog.filter(item => item.kind === 'herb'), expanded.notes, expanded.routes);

const kindLabels = {
  course: '免费课程',
  herb: '本草档案',
  note: '本草笔记',
  route: '寻药文化'
};

function findItem(kind, id) {
  return catalog.find((item) => item.kind === kind && item.id === id);
}

function itemPath(item) {
  if (!item || !findItem(item.kind, item.id)) return '';
  return '/pages/detail/index?kind=' + encodeURIComponent(item.kind) + '&id=' + encodeURIComponent(item.id);
}

// 搜索只读公共目录，不关联个人笔记或收藏。
function filterCatalog(kind = 'all', query = '') {
  const text = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  return catalog.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (!text) return true;
    const searchable = [item.title, item.subtitle, item.category, item.description, item.body]
      .concat((item.chapters || []).map((chapter) => chapter.title + ' ' + chapter.body))
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return searchable.indexOf(text) !== -1;
  });
}

module.exports = { catalog, kindLabels, findItem, itemPath, filterCatalog };
