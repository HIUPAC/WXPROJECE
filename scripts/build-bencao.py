"""Build an attributed, offline directory and lossless volume text shards.

Usage: python scripts/build-bencao.py [snapshot-directory]
Requires opencc-python-reimplemented (t2s), or .codex/python-deps.
The source snapshot and source revision manifest are retained in docs.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.codex/python-deps'))
from opencc import OpenCC
CC = OpenCC('t2s')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf8')
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.codex/bencao-reference'
if not SOURCE.exists():
    SOURCE = ROOT / '.codex/bencao-reference'
    with zipfile.ZipFile(ROOT / 'docs/bencao-source-snapshot.zip') as archive:
        archive.extractall(SOURCE)
MANIFEST = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf8'))
MINI = ROOT / 'miniprogram'

glyphs = {}
for module in ['SKchar', 'SKchar2']:
    mapping = {}
    for match in re.finditer(r"\['(\d+)'\]\s*=\s*\{([^\n]+)\}", (SOURCE / ('raw/' + module + '.lua')).read_text(encoding='utf8')):
        key, value = match.groups()
        strings = re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', value)
        mapping[key] = ('〔異體字：' + strings[0] + '〕') if value.lstrip().startswith('nil') and strings else (strings[0] if strings else '〔缺字：' + module + ':' + key + '〕')
    glyphs[module.lower()] = mapping

def characters(text):
    return re.sub(r'\{\{(SKchar2?)\|(\d+)(?:\|[^{}]*)?\}\}', lambda m: glyphs[m[1].lower()].get(m[2], '〔缺字：' + m[1] + ':' + m[2] + '〕'), text, flags=re.I)

def template(value):
    fields = value.split('|', 1)
    name = fields[0].strip().lower()
    if name == 'sk anchor':
        return fields[1] if len(fields) > 1 else ''
    if name == 'sk notes':
        return '〔' + fields[1] + '〕' if len(fields) > 1 else ''
    if name in ['skqs header', 'skqs footer', 'pd-old', 'search', 'sk list']:
        return ''
    return '〔未辨模板：' + value.replace('|', '：') + '〕'

def plain(text):
    text = characters(text)
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    for _ in range(30):
        updated = re.sub(r'\{\{([^{}]+)\}\}', lambda m: template(m[1]), text)
        if updated == text:
            break
        text = updated
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', r'\1', text)
    lines = [line.strip(' \t　\r') for line in text.splitlines()]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()

# Normalize a small set of transcription variants solely for matching headings.
# The original title and text always remain available.
VARIANTS = str.maketrans({'𤣥': '玄', '䑕': '鼠', '鷄': '雞', '鶏': '雞', '覉': '羈', '蔴': '麻', '㦸': '戟', '脉': '脈', '邉': '邊', '舩': '船', '艸': '草', '菴': '庵', '宻': '密', '㓂': '寇', '逺': '遠', '囘': '回', '䕶': '護', '蔕': '蒂', '餹': '糖', '歩': '步', '戸': '戶', '峯': '峰', '䝉': '蒙', '𫎇': '蒙', '𬃷': '棗', '𤓰': '瓜', '㣲': '微', '㫁': '斷', '亷': '廉', '欵': '款', '麴': '麯', '蔾': '藜', '産': '產', '塜': '冢', '顚': '顛', '湼': '涅', '皷': '鼓', '羗': '羌', '鈆': '鉛', '栁': '柳', '葢': '蓋', '薫': '薰', '蘓': '蘇', '頺': '頹', '茰': '萸', '髪': '髮', '繋': '繫', '縁': '緣', '奬': '漿', '薇': '薇'})
def norm(name):
    return re.sub(r'[\s　]', '', CC.convert(name.translate(VARIANTS))).replace('﨑', '崎')

PART = re.compile(r'^(水|火|土|金石|草|穀|菜|果|木|服器|蟲|鱗|介|禽|獸|人)(?:之[一二三四五六七八九十]+)?\s+')
BAD = re.compile(r'^(?:右附方|互攷|互考|附註|附注|本草[綱纲]|本草[拾補補㑹]|名醫|神農|李氏|吳氏|唐本|海藥|開[寳寶]|嘉祐|圖經|食療|日華|用藥|藥性|四聲|宋|唐海藥)|[一二三四五六七八九十百千]+種$')
pages = sorted(MANIFEST['pages'], key=lambda page: (page['volume'], {'': 0, '上': 1, '下': 2}.get(page['part'][3:], 3)))
directory = []
page_data = {}
volume_audit = []
for page in pages:
    raw = (SOURCE / page['rawPath']).read_text(encoding='utf8')
    text = characters(raw)
    separators = [m.start() for m in re.finditer('欽定四庫全書', text)]
    is_directory = len(page['part']) == 3
    toc = text[:separators[1]] if len(separators) > 1 else text
    page_data[page['part']] = {'text': plain(raw), 'page': page}
    if not is_directory:
        continue
    department = ''
    category = ''
    mode = 'main'
    records = []
    for line in toc.splitlines():
        # The first water section starts on the last line of the preface.
        embedded = re.search(r'水之一[　\s]+天水', line)
        clean = plain(line[embedded.start():] if embedded else line)
        # Compare these three damaged directory headings with the source's
        # own total directory; keep the untouched heading in full text.
        if page['volume'] == 44 and re.match(r'^鱗之四〔', clean):
            category = '无鳞鱼类'
            mode = 'main'
            continue
        head = PART.match(clean)
        # Fire / earth volumes use an unnumbered section heading.
        if head:
            department = CC.convert(head[1]) + '部'
            rest = clean[head.end():].split('〔')[0]
            category = re.sub(r'[一二三四五六七八九十百千零〇]+種.*$', '', rest).strip()
            category = re.sub(r'共[一二三四五六七八九十百千零〇]+.*$', '', category)
            category = CC.convert(category or ('火类' if department == '火部' else '土类' if department == '土部' else '人类'))
            if category == '凡':
                category = {'火部': '火类', '土部': '土类', '人部': '人类'}.get(department, category)
            category = category.removesuffix('共')
            category = CC.convert(category.translate(VARIANTS))
            if page['volume'] == 45 and category == '龟鱼类':
                category = '龟鳖类'
            mode = 'main'
            continue
        if not category:
            continue
        if '有名未用' in clean and ('本經' in clean or '本经' in clean):
            mode = 'unapplied'
        if clean.startswith(('附録', '附錄')):
            mode = 'supplement'
            continue
        if clean.startswith(('神農本經', '神農本草經', '名醫别録', '本草拾遺', '海藥本草', '開寳本草', '圖經外類', '本草綱目')):
            continue
        # Split the actual source-note template rather than the rendered
        # bracket: rare medicine names themselves may contain a glyph note.
        name = plain(re.split(r'\{\{SK notes\s*\|', line, maxsplit=1, flags=re.I)[0]).strip()
        if not name or len(name) > 100 or BAD.search(name) or re.search(r'綱目[卷巻]', name) or name in ['三種', '雜草', '草之十一'] or name.startswith(('</', '--', '請根據', '已上卷')):
            continue
        # Only bare dictionary names or names followed by a source note.
        if re.search(r'[，。,<>|{}]', re.sub(r'〔.*?〕', '', name)):
            continue
        note = clean[len(name):]
        record = {'name': name, 'volume': page['volume'], 'department': department, 'category': category, 'entryType': mode, 'sourceNote': note, 'directoryPage': page['part']}
        records.append(record)
        directory.append(record)
    volume_audit.append({'volume': page['volume'], 'directoryEntries': len(records)})

duplicates = []
seen = set()
unique_directory = []
for entry in directory:
    key = (entry['volume'], entry['name'])
    if key in seen:
        duplicates.append({'volume': entry['volume'], 'name': entry['name']})
        continue
    seen.add(key)
    unique_directory.append(entry)
directory = unique_directory
unmatched = []
source_titles = []
rows = []
all_body_parts = {}
for page in pages:
    part = page['part']
    data = page_data[part]
    if len(part) == 3 and any(p['part'] == part + '上' for p in pages):
        continue
    raw = characters((SOURCE / page['rawPath']).read_text(encoding='utf8'))
    sep = [m.start() for m in re.finditer('欽定四庫全書', raw)]
    body_raw = raw[sep[1]:] if len(sep) > 1 else raw
    body = plain(body_raw)
    all_body_parts[part] = body
    # Anchor positions, including inline anchors, in the normalized source text.
    marker_raw = re.sub(r'\{\{SK anchor\|([^{}|]+)(?:\|[^{}]*)?\}\}', lambda m: '\ue000' + m[1] + '\ue001', body_raw)
    marked = plain(marker_raw)
    title_positions = []
    stripped = ''
    last = 0
    for match in re.finditer('\ue000([^\ue001]+)\ue001', marked):
        stripped += marked[last:match.start()]
        title_positions.append((norm(match[1]), len(stripped), match[1]))
        stripped += match[1]
        last = match.end()
    stripped += marked[last:]
    assert stripped == body, 'Marker stripping changed original text: ' + part
    offset = 0
    for line in body.splitlines(keepends=True):
        heading = re.split(r'〔|\s+|校正|釋名|正誤|脩治|修治|主治|氣味', line, maxsplit=1)[0]
        if heading:
            title_positions.append((norm(heading), offset, heading))
        offset += len(line)
    title_positions = sorted(set(title_positions), key=lambda record: record[1])
    data['positions'] = title_positions
    data['body'] = body

for entry in directory:
    part = entry['directoryPage']
    candidates = [part + '上', part + '下'] if part + '上' in all_body_parts else [part]
    positions = []
    wanted = norm(entry['name'])
    for candidate in candidates:
        data = page_data[candidate]
        matches = [(pos, title) for normalized, pos, title in data['positions'] if normalized == wanted]
        if not matches:
            # A substantial number of names are unanchored, including inline
            # paired entries in the historical '有名未用' directory.
            pattern = re.compile(r'(?:^|\n|〕)' + re.escape(entry['name']) + r'(?=〔|\n|$)')
            matches = [(m.start() + (1 if m[0].startswith(('\n', '〕')) else 0), entry['name']) for m in pattern.finditer(data['body'])]
        for pos, title in matches:
            positions.append((candidate, pos, title))
    if positions:
        # The first occurrence is the heading; later matches may be a part
        # within the same medicine or an author repeating its name.
        entry['part'], entry['start'], entry['bodyTitle'] = positions[0]
    else:
        entry['part'] = candidates[0]
        entry['start'] = None
        unmatched.append({k: entry[k] for k in ['name', 'volume', 'entryType']})

# Verified directory-to-body discrepancies in this particular transcription.
# These are matching corrections, not replacements of the original wording.
CORRECTIONS = {
 '5:霜水': '露水', '5:阿井水': '阿井泉', '5:車轍水': '車轍中水',
 '7:蜣螂轉丸': '蜣蜋轉丸', '7:蟻垤土': '蟻蛭土', '7:白瓷器': '瓷器', '7:香罏火': '香爐灰',
 '8:粉鉛': '粉錫', '8:鐵爇': '鐵落', '10:握雪礜石': '掘雪礜石', '10:越砥石': '越砥',
 '12:瑣陽': '鎖陽', '12:赤箭天麻': '赤箭', '13:柴胡': '茈胡', '13:獨活羌活': '獨活',
 '14:白芷香': '白芷', '14:莎根香附子': '莎草香附子', '14:薰草零陵香': '薰草', '14:假蘇荆芥': '假蘇',
 '15:鏨草': '鏨菜', '15:薇蓹': '薇衘', '15:青葙子': '青葙', '15:雞冠花': '雞冠', '15:漏蘆': '漏盧',
 '16:槌胡根': '搥胡根', '16:冬葵': '葵', '16:兔葵': '菟葵', '16:蛇䒽草': '蛇繭草', '16:蕕草': '蕕', '16:地蜈蚣': '地蜈蚣草',
 '17:常山蜀漆': '常山', '17:虎掌天南星': '虎掌', '17:茵蕷': '茵芋', '17:漏籃子': '漏藍子', '17:由跋': '由䟦',
 '18:蓬櫐': '蓬蘽', '18:伏雞子': '伏雞子根', '18:茜根': '茜草', '18:白蘞': '白斂', '18:鵞抱': '鵝抱', '18:白菟藿': '白兔藿',
 '19:白菖': '白昌', '20:景天': '景夭', '21:井中苔': '井中苔及萍藍', '21:石蘂': '石蕊', '21:地衣': '地衣草',
 '21:離婁草': '離樓草', '21:本甘草': '木甘草', '21:蒲隂實': '蒲陰實', '21:兊耳': '兊草', '21:英草': '英草華', '21:師絲': '師系',
 '21:蛇痕草': '蛇眼草', '21:白延草': '白筵草', '21:墓頭囘': '墓頭回',
 '23:芮草子': '芮草', '23:蒒草子': '蒒草', '23:薏苡': '薏苡仁', '25:米餻': '餻',
 '26:茼蒿': '同蒿', '26:水斳': '芒斳', '26:草䜴': '草豉', '27:蘩縷': '繁縷', '27:雞腸': '雞腸草', '27:蕺菜': '蕺', '27:秦狄藜': '秦荻藜',
 '28:壺盧': '壺蘆', '28:皁角蕈': '皂莢蕈', '30:山櫻桃': '山嬰桃', '30:榛子': '榛', '33:蕳子': '蕳',
 '34:柏': '栢', '34:沈香': '沉香', '34:蘆薈': '盧㑹', '35:柳': '桞', '35:烏桕木': '烏臼木', '35:枎栘': '扶栘', '35:榔榆': '樃榆', '35:椶櫚': '㯶櫚', '36:梔子': '巵子', '36:枸杞': '枸杞地骨皮', '37:天竹黄': '竹黄', '25:醤': '醬',
 '38:履屧鼻繩': '屐屧鼻繩', '38:靈牀鞋': '靈牀下鞋', '38:厯日': '歴日', '38:楤擔尖': '楤檐尖', '38:硏硃石槌': '硏硃石鎚', '38:縳豬繩': '縛豬繩', '38:牛牶': '牛鼻牶',
 '38:弓鞘': '刀鞘', '39:蠮蜂': '𧕪螉', '39:螳螂桑螵蛸': '螳蜋桑螵蛸', '40:牛蟲': '牛蝨', '41:天社蟲': '附錄天社蟲', '41:木蝱': '木䖟', '41:蜚蟲': '蜚蠊', '41:竹蟲': '竹蠧蟲', '42:豉蟲': '䜴蟲', '44:鰶魚': '鯔魚',
 '44:鱓魚': '鱓', '44:河豚魚': '河豚', '44:海蛇': '海䖳', '45:緑毛龜': '水龜', '45:能鼈': '能', '45:鱟': '鱟魚',
 '47:鵚𪃩': '鵚鶖', '47:鸂鶒': '鸂鷘', '48:鷴': '白鷴', '49:杜鵑': '杜䳌',
 '50:黄牛': '牛', '50:六畜爪甲蹄': '六畜毛蹄甲', '50:駱': '駝', '50:狗寳': '狗寶', '51:貛': '獾', '51:隱鼠': '隠䑕', '51:獮猴': '獼猴', '52:膝垢': '膝頭垢'
}
unmatched = []
for entry in directory:
    if entry['start'] is not None:
        continue
    target = norm(CORRECTIONS.get(str(entry['volume']) + ':' + entry['name'], entry['name']))
    if entry['volume'] == 38 and entry['name'].startswith(('弓弩〔異體字', '紡車〔異體字')):
        target = norm(entry['name'].split('〔')[0])
    part = entry['directoryPage']
    candidates = [part + '上', part + '下'] if part + '上' in all_body_parts else [part]
    matches = []
    for candidate in candidates:
        data = page_data[candidate]
        for normalized, pos, title in data['positions']:
            if normalized == target:
                matches.append((candidate, pos, title))
        # Paired, unanchored notes within a line: normalize each character
        # while retaining a mapping back to the original character offsets.
        if 'converted' not in data:
            converted = CC.convert(data['body'].translate(VARIANTS))
            offsets = range(len(converted))
            if len(converted) != len(data['body']):
                converted = ''
                offsets = []
                for pos, char in enumerate(data['body']):
                    replacement = CC.convert(char.translate(VARIANTS))
                    converted += replacement
                    offsets.extend([pos] * len(replacement))
            data['converted'], data['offsets'] = converted, offsets
        converted, offsets = data['converted'], data['offsets']
        for match in re.finditer(r'(?:^|\n|〕)' + re.escape(target) + r'(?=〔|\s|$)', converted):
            pos = match.start() + (1 if match[0].startswith(('\n', '〕')) else 0)
            matches.append((candidate, offsets[pos], data['body'][offsets[pos]:offsets[pos] + len(entry['name'])]))
    if matches:
        entry['part'], entry['start'], entry['bodyTitle'] = matches[0]
    else:
        unmatched.append({k: entry[k] for k in ['name', 'volume', 'entryType']})

# Add the named supplements whose directories only say '附录诸…'. The
# complete volume is retained independently of every extraction decision.
supplement_count = 0
for part, label in [('卷11', '附録諸石'), ('卷18下', '附録諸藤'), ('卷37', '附録諸木')]:
    data = page_data[part]
    body = data['body']
    heading_match = re.search(r'^' + label.replace('録', '[錄録]'), body, flags=re.M)
    if not heading_match:
        continue
    begin = heading_match.start()
    parent = next(entry for entry in reversed(directory) if entry['volume'] == data['page']['volume'])
    # Names precede top-level explanatory notes; nested editorial glyph
    # descriptions are not treated as medicine titles.
    depth = 0
    after = begin + len(label)
    for pos in range(after, len(body)):
        if body[pos] == '〔':
            if depth == 0:
                name = body[after:pos].strip()
                name = re.sub(r'^[一二三四五六七八九十百千]+種\s*', '', name)
                note_end = body.find('〕', pos)
                note = body[pos + 1:note_end]
                if 1 < len(name) <= 18 and '\n' not in name and not name.startswith(('釋名', '集解', '氣味', '主治', '發明', '附方', '本草')) and not any(entry['volume'] == parent['volume'] and norm(entry['name']) == norm(name) for entry in directory):
                    start = pos - len(name)
                    directory.append({'name': name, 'volume': parent['volume'], 'department': parent['department'], 'category': parent['category'], 'entryType': 'supplement', 'sourceNote': '', 'directoryPage': parent['directoryPage'], 'part': part, 'start': start, 'bodyTitle': name})
                    supplement_count += 1
            depth += 1
        elif body[pos] == '〕':
            depth = max(0, depth - 1)
            if depth == 0:
                after = pos + 1
    if part == '卷37':
        # This one title is interrupted by its pronunciation annotation:
        # 栒〔音荀〕核〔别录曰…〕. It is one entry, not two names.
        special = re.search(r'栒〔音荀〕核〔', body)
        if special:
            directory.append({'name': '栒核', 'volume': parent['volume'], 'department': parent['department'], 'category': parent['category'], 'entryType': 'supplement', 'sourceNote': '', 'directoryPage': parent['directoryPage'], 'part': part, 'start': special.start(), 'bodyTitle': '栒核'})
            supplement_count += 1

# Record body ranges in UTF-16 units, as used by JavaScript String.slice.
# Unmatched titles are kept and point to the complete source volume.
for part, body in all_body_parts.items():
    in_part = [entry for entry in directory if entry['part'] == part and entry['start'] is not None]
    starts = sorted(set(entry['start'] for entry in in_part))
    ends = {start: starts[i + 1] if i + 1 < len(starts) else len(body) for i, start in enumerate(starts)}
    for entry in in_part:
        start = entry['start']
        end = ends[start]
        entry['start16'] = len(body[:start].encode('utf-16-le')) // 2
        entry['end16'] = entry['start16'] + len(body[start:end].encode('utf-16-le')) // 2
        entry['bodySample'] = body[start:end]

audit = {'sourceTitle': MANIFEST['sourceTitle'], 'sourceUrl': MANIFEST['sourceUrl'], 'volumeCount': 48, 'directoryEntryCount': len(directory) - supplement_count, 'supplementEntries': supplement_count, 'entryCount': len(directory), 'departments': dict(Counter(entry['department'] for entry in directory)), 'types': dict(Counter(entry['entryType'] for entry in directory)), 'volumes': volume_audit, 'unmatched': unmatched, 'mergedDuplicateDirectoryTitles': duplicates}
(SOURCE / 'extraction-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf8')
(SOURCE / 'entries.json').write_text(json.dumps(directory, ensure_ascii=False), encoding='utf8')
print('Archive:', len(directory), 'entries;', len(unmatched), 'unmatched headings. See extraction-audit.json.')

def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

# The main package only includes a compact directory. Full original texts
# stay in asynchronous JS subpackages, each comfortably below 2 MiB.
packages = []
shard = {}
shard_bytes = 0
part_shards = {}
def write_shard():
    global shard, shard_bytes
    if not shard:
        return
    name = 'corpus' + str(len(packages) + 1).zfill(2)
    target = MINI / name
    target.mkdir(exist_ok=True)
    (target / 'data.js').write_text('// 李時珍《本草綱目》四庫全書本；Wikisource contributors, CC BY-SA.\nmodule.exports=' + dump(shard) + ';\n', encoding='utf8')
    # A tiny registered page also supports tools which reject empty packages.
    (target / 'entry.js').write_text('Page({});\n', encoding='utf8')
    (target / 'entry.json').write_text('{}\n', encoding='utf8')
    (target / 'entry.wxml').write_text('<view>本草纲目原文资料</view>\n', encoding='utf8')
    (target / 'entry.wxss').write_text('page{padding:32rpx;}\n', encoding='utf8')
    packages.append({'root': name, 'name': name, 'pages': ['entry']})
    for part in shard:
        part_shards[part] = name
    shard = {}
    shard_bytes = 0

for page in pages:
    part = page['part']
    text = page_data[part]['text']
    size = len(dump(text).encode('utf8')) + len(part.encode('utf8')) + 10
    if shard_bytes + size > 1400 * 1024:
        write_shard()
    shard[part] = text
    shard_bytes += size
write_shard()

departments = list(dict.fromkeys(entry['department'] for entry in directory))
categories = list(dict.fromkeys(entry['category'] for entry in directory))
page_index = []
for page in pages:
    part = page['part']
    full = page_data[part]['text']
    page['rawSha256'] = hashlib.sha256((SOURCE / page['rawPath']).read_bytes()).hexdigest()
    page['normalizedTextSha256'] = hashlib.sha256(full.encode('utf8')).hexdigest()
    page['normalizedTextCharacters'] = len(full)
    base_offset = full.rfind(all_body_parts[part]) if part in all_body_parts else 0
    assert base_offset >= 0, 'The full original text must contain the extracted body'
    base16 = len(full[:base_offset].encode('utf-16-le')) // 2
    page_index.append([part, page['volume'], page['revisionId'], part_shards[part], base16])
stable_ids = {'15:菊': ('h1', '菊花'), '30:橘': ('h2', '陈皮（橘）'), '36:枸杞': ('h3', '枸杞 / 地骨皮')}
for entry in directory:
    key = str(entry['volume']) + ':' + entry['name']
    ident, title = stable_ids.get(key, ('bc-' + hashlib.sha256(key.encode('utf8')).hexdigest()[:12], CC.convert(entry['name'])))
    aliases = []
    if entry.get('bodyTitle') and norm(entry['bodyTitle']) != norm(entry['name']):
        aliases.append(entry['bodyTitle'])
    aliases += [CC.convert(alias) for alias in aliases]
    # Explicit '即…' aliases in the directory and named appended entries.
    note = entry['sourceNote'].strip('〔〕')
    aliases += re.findall(r'即([^　\s，。〔〕]{1,15})', note)
    aliases += re.findall(r'附[録錄]([^〔\n]{1,18})', entry.get('bodySample', ''))
    aliases += re.findall(r'^([^〔〕\n]{1,14}?)(?:氣味|脩治|修治|主治)', entry.get('bodySample', ''), flags=re.M)
    aliases += re.findall(r'(?:本經|别[錄録]|唐本|綱目|開[寶寳]|嘉祐|圖經|拾遺|日華|食療|救荒)[　\s]+([^〔〕]{1,30})附', note)
    # The book explicitly places alternate historical names in '释名'.
    # Only text preceding a top-level citation note is treated as a name;
    # prose inside the note is never inferred into a medicine name.
    definition = re.search(r'^釋名([^\n]*)', entry.get('bodySample', ''), flags=re.M)
    if definition:
        text = definition[1]
        depth, after = 0, 0
        for pos, char in enumerate(text):
            if char == '〔':
                if depth == 0:
                    names = re.sub(r'^(?:一名|又名|子名|名)', '', text[after:pos].strip())
                    for alias in re.split(r'[　\s]+', names):
                        if alias and len(alias) < 14 and not re.search(r'[曰云，。；：]', alias):
                            aliases.append(alias)
                depth += 1
            elif char == '〕':
                depth = max(0, depth - 1)
                if depth == 0:
                    after = pos + 1
    if ident == 'h2':
        aliases += ['陈皮', '陳皮', '橘皮', '橘', '柑橘']
    if ident == 'h3':
        aliases += ['枸杞', '枸杞子', '地骨皮', '枸杞地骨皮']
    if ident == 'h1':
        aliases += ['菊花', '菊']
    # Modern common names supplied by the source itself or unambiguous
    # orthographic equivalents improve discovery without altering the text.
    modern = {'黄耆': ['黄芪'], '赤箭天麻': ['天麻', '赤箭'], '假蘇荆芥': ['荆芥'], '蘇': ['紫苏'], '梔子': ['栀子'], '漏蘆': ['漏芦'], '荆三稜': ['三棱'], '忍冬': ['金银花'], '蒒草子': ['蒒草'], '𤣥參': ['玄参'], '芎藭': ['川芎'], '芍藥': ['白芍药', '赤芍药'], '术': ['白术', '苍术']}
    aliases += modern.get(entry['name'], [])
    aliases += [CC.convert(alias) for alias in aliases]
    aliases = list(dict.fromkeys(alias.strip() for alias in aliases if alias.strip() and len(alias) < 36))
    status = 'matched' if entry['start'] is not None else ('source-gap' if '缺' in note else 'unlocated')
    rows.append([ident, title, entry['name'], entry['volume'], entry['part'], departments.index(entry['department']), categories.index(entry['category']), entry['entryType'], aliases, entry.get('start16', -1), entry.get('end16', -1), status])

assert len(set(row[0] for row in rows)) == len(rows), 'Duplicate source-derived IDs'
assert set(['h1', 'h2', 'h3']).issubset(row[0] for row in rows), 'Existing favorite IDs must be retained'
stats = {key: audit[key] for key in ['entryCount', 'directoryEntryCount', 'supplementEntries', 'volumeCount', 'types']}
stats.update({'departmentCount': len(departments), 'categoryCount': len(categories), 'sourceTitle': MANIFEST['sourceTitle'], 'sourceUrl': MANIFEST['sourceUrl'], 'fetchedAt': MANIFEST['fetchedAt'], 'rootRevisionId': MANIFEST['rootRevisionId'], 'unlocatedCount': len(unmatched), 'license': 'Wikisource contributors · CC BY-SA 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/'})
search_names = ''.join(row[1] + row[2] + ''.join(row[8]) for row in rows)
traditional = OpenCC('s2t').convert(search_names)
search_map = {char: CC.convert(char.translate(VARIANTS)) for char in sorted(set(search_names + traditional)) if CC.convert(char.translate(VARIANTS)) != char}
(MINI / 'data/archive-index.js').write_text('// Generated by scripts/build-bencao.py; see docs/BENCAO_SOURCES.md.\nmodule.exports=' + dump({'departments': departments, 'categories': categories, 'pages': page_index, 'rows': rows, 'stats': stats, 'searchMap': search_map}) + ';\n', encoding='utf8')
loaders = ',\n'.join('  ' + p['name'] + ': () => require.async(\'../' + p['root'] + '/data.js\')' for p in packages)
(MINI / 'data/archive-loaders.js').write_text('// Literal paths let WeChat detect cross-package async dependencies.\nconst loaders={\n' + loaders + '\n};\nmodule.exports={load(name){if(!loaders[name])return Promise.reject(new Error("Unknown archive package"));return loaders[name]();}};\n', encoding='utf8')
app_path = MINI / 'app.json'
app = json.loads(app_path.read_text(encoding='utf8'))
app['subPackages'] = packages
app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
(ROOT / 'docs/bencao-source-manifest.json').write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2), encoding='utf8')
(ROOT / 'docs/bencao-extraction-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf8')
with zipfile.ZipFile(ROOT / 'docs/bencao-source-snapshot.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(SOURCE / 'manifest.json', 'manifest.json')
    for file in sorted((SOURCE / 'raw').iterdir()):
        archive.write(file, 'raw/' + file.name)
print('Generated', len(packages), 'text packages; index bytes', (MINI / 'data/archive-index.js').stat().st_size)
