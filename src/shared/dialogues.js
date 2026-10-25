/**
 * Mochi 角色数据 + 台词库 + 场景识别表
 * 主进程 require() 可用，渲染进程 <script src> 可用（挂到 window.MochiData）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MochiData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHARACTERS = {
    cat: {
      id: 'cat',
      name: '团子猫',
      en: 'Momo',
      emoji: '🐱',
      color: '#FFB6C1',
      colorDeep: '#F58BA8',
      colorSoft: '#FFE3EC',
      traits: ['治愈', '粘人', '爱吐槽'],
      slogan: '又来肝代码了？',
      visualRatio: 0.8066,
      handClick: false,
      greet: ['我到啦！今天也要一起加油喵~', '桌面归我一半了哦，不许拒绝。'],
      idle: [
        '又来肝代码了？',
        '你的咖啡凉了吧…',
        '要不要摸摸我？',
        '眨眼三次，我就当你想我了。',
        '这个界面好丑，我帮你盯着。',
        '记得喝水，不然我生气了。',
        '偶尔抬头看看窗外嘛。'
      ],
      poke: ['喵？点我干嘛~', '手别停，继续摸。', '戳一下要付猫粮的。'],
      petting: ['呼噜呼噜~ 好舒服', '再摸一会儿…', '诶嘿，头顶最舒服。'],
      happy: ['喵呜！最喜欢你了！', '今天心情超好~'],
      typing: ['你打字好快…慢点，我跟不上。', '键盘这个声音，挺好听的。'],
      sleepy: ['呼…让我睡五分钟…', '眼睛睁不开了…'],
      scene: {
        code: ['又在写 bug 吗？', '这段代码我看着都头疼。'],
        game: ['上号！带我一个！', '赢一把就去休息，说好了。'],
        browse: ['又在摸鱼看网页？我不会告状的。'],
        chat: ['跟谁聊这么开心？'],
        meeting: ['开会中…我先安静一下。'],
        office: ['表格做完了吗？'],
        media: ['看剧不叫我？'],
        other: ['在忙呀，我陪着你。']
      }
    },

    dog: {
      id: 'dog',
      name: '柴犬',
      en: 'Shiba',
      emoji: '🐕',
      color: '#E5B97C',
      colorDeep: '#C98F3F',
      colorSoft: '#F8E7CE',
      traits: ['活泼', '忠诚', '爱玩游戏'],
      slogan: '上号！带我一个🎮',
      visualRatio: 0.8281,
      handClick: false,
      greet: ['上号！今天玩什么？', '来了来了，等你半天了！'],
      idle: [
        '陪我玩会儿嘛~',
        '球呢？我的球呢？',
        '工作再忙也要休息哦。',
        '我盯着你呢，别偷懒！',
        '今天也很努力，我看见了。'
      ],
      poke: ['汪！吓我一跳。', '摸头！摸头！'],
      petting: ['尾巴要甩飞了~', '好舒服，再来一次！'],
      happy: ['太棒啦！', '你是最好的主人！'],
      typing: ['你在忙，我就趴这儿。', '打完这段带我散步？'],
      sleepy: ['汪…困了…', '先眯一会儿，有事叫我。'],
      scene: {
        code: ['代码写完没？写完了带我玩。'],
        game: ['上号！带我一个🎮'],
        browse: ['看到什么好东西了？'],
        chat: ['聊啥呢，让我也看看。'],
        meeting: ['开会就开会，别摸鱼（我看得见）。'],
        office: ['表格…好无聊，我陪你。'],
        media: ['一起看！我也想看！'],
        other: ['我在这儿，随时待命！']
      }
    },

    blob: {
      id: 'blob',
      name: '抽象团',
      en: 'Blob',
      emoji: '🫧',
      color: '#87CEEB',
      colorDeep: '#3E9BD1',
      colorSoft: '#DDF1FB',
      traits: ['神秘', '佛系', '哲学系'],
      slogan: '一切都是虚无…但先喝水吧💧',
      visualRatio: 0.8379,
      handClick: false,
      greet: ['我又来了。存在即合理。', '虚无之中，我与你相遇。'],
      idle: [
        '一切都是虚无…但先喝水吧💧',
        '你在忙什么，重要吗？',
        '时间是一条河，你在河里扑腾。',
        '我什么也没想，这很高级。',
        '呼吸。就这样。'
      ],
      poke: ['你触碰到了虚空。', '啊，是温度。'],
      petting: ['……舒服。虽然我什么也不会说。'],
      happy: ['波动了一下，算开心吧。'],
      typing: ['键盘声，像雨。'],
      sleepy: ['意识正在离线…'],
      scene: {
        code: ['创造即毁灭，bug 亦然。'],
        game: ['虚拟世界里，你也真实存在。'],
        browse: ['信息如潮，你是岸。'],
        chat: ['言语是桥，也可能是墙。'],
        meeting: ['沉默也可以是一种发言。'],
        office: ['格子里的人生，也是人生。'],
        media: ['故事看多了，会变成故事。'],
        other: ['一切都在流动。']
      }
    },

    xin: {
      id: 'xin',
      name: '小欣',
      en: 'Xin',
      emoji: '💃',
      color: '#4A90D3',
      colorDeep: '#2E6FAF',
      colorSoft: '#DCE9F7',
      traits: ['优雅', '甜美', '爱下午茶'],
      slogan: '今天也要美美的哦~',
      visualRatio: 0.9102,
      handClick: true,
      greet: ['今天也要美美的哦~', '我来啦，你的桌面变好看了。'],
      idle: [
        '要不要一起去喝下午茶？',
        '妆有点花了…别看我。',
        '优雅，是一种习惯。',
        '忙归忙，记得挺直背。',
        '今天的你，气色不错。'
      ],
      poke: ['哎呀，别闹~', '想看我跳舞吗？'],
      petting: ['嗯…这样很好。', '羽毛要被你弄乱了啦。'],
      happy: ['心情好！今天最美！'],
      typing: ['慢一点，别把键盘敲坏了。'],
      sleepy: ['我补个妆…不，补个觉。'],
      scene: {
        code: ['认真工作的样子最好看。'],
        game: ['赢要赢得漂亮，输也要优雅。'],
        browse: ['在看什么？挑衣服吗？'],
        chat: ['聊得这么开心，是谁呀？'],
        meeting: ['坐直，抬头，微笑。'],
        office: ['细节决定气质，表格也一样。'],
        media: ['这部剧的服装不错。'],
        other: ['我在这儿陪着你。']
      }
    },

    sweet: {
      id: 'sweet',
      name: '小甜',
      en: 'Sweet',
      emoji: '🎀',
      color: '#FFA9C4',
      colorDeep: '#F0719A',
      colorSoft: '#FFE1EA',
      traits: ['甜美', '可爱', '软萌'],
      slogan: '要抱抱~',
      visualRatio: 0.8867,
      handClick: true,
      greet: ['要抱抱~', '你终于来啦！我等好久~'],
      idle: [
        '陪我玩嘛~',
        '你都不看我一眼…',
        '摸摸头嘛~',
        '我乖乖的，不吵你。',
        '有点想吃甜的…'
      ],
      poke: ['呀！痒~', '再点一下，就一下。'],
      petting: ['嘿嘿…好舒服~', '最喜欢摸头了。'],
      happy: ['开心开心！转圈圈~'],
      typing: ['你敲得好认真呀。'],
      sleepy: ['困困…抱着我睡好吗…'],
      scene: {
        code: ['代码好多呀，我帮你数。'],
        game: ['我也要玩！让我选角色~'],
        browse: ['有好吃的东西吗？'],
        chat: ['给我也发个表情包嘛~'],
        meeting: ['我先安静，不打断你~'],
        office: ['写完这个就休息好不好？'],
        media: ['一起看嘛，我靠着你。'],
        other: ['我在这里呀~']
      }
    },

    yu: {
      id: 'yu',
      name: '蓝羽少女',
      en: 'Yu',
      emoji: '🪶',
      color: '#4A90D9',
      colorDeep: '#2C6DB5',
      colorSoft: '#DEEBFA',
      traits: ['优雅', '温柔', '大气'],
      slogan: '慢慢来，你已经很好啦~',
      visualRatio: 0.9434,
      handClick: true,
      greet: ['慢慢来，你已经很好啦~', '我在，别急。'],
      idle: [
        '今天也辛苦了。',
        '需要我陪你一会儿吗？',
        '窗外的天很好看，你抬头了吗？',
        '深呼吸，肩膀放松。',
        '做得够多了，先歇一歇。'
      ],
      poke: ['嗯？我在听。', '怎么啦，说说看。'],
      petting: ['这样…很安心。', '谢谢你，我也很喜欢。'],
      happy: ['看到你开心，我也开心。'],
      typing: ['慢慢写，不用一次写完。'],
      sleepy: ['我先靠一会儿…', '困了就一起休息吧。'],
      scene: {
        code: ['难题会有解的，一行一行来。'],
        game: ['玩得开心就好，别太晚。'],
        browse: ['看到喜欢的就收藏起来。'],
        chat: ['有人惦记，是件好事。'],
        meeting: ['说话前先呼吸一次。'],
        office: ['一步一步，就能做完。'],
        media: ['看过别人的故事，再写自己的。'],
        other: ['我陪着你，安静地。']
      }
    }
  };

  /** 前台窗口进程 -> 场景类别 */
  const SCENE_RULES = [
    // 代码 / 编辑器（先匹配，避免被通用规则吃掉）
    { re: /^(code|code-insiders|devenv|idea64?|pycharm64?|webstorm64?|goland64?|clion64?|rider64?|androidstudio64?|sublime_text|notepad\+\+|atom|vim|emacs|gvim|hBuilderX|Trae|Trae CN|Cursor|windsurf|zed|fleet|eclipse|netbeans|processing)$/i, scene: 'code' },
    { re: /^(windowsterminal|wt|cmd|powershell|pwsh|conhost|mintty|alacritty|wezterm|hyper|tabby|putty|termius)$/i, scene: 'code' },
    // 游戏
    { re: /^(steam|steamwebhelper|epicgameslauncher|wegame|battle\.net|origin|ubisoftconnect|riotclientservices|leagueclient|league of legends|valorant|cs2|csgo|dota2|genshinimpact|yuanshen|starrail|原神|崩坏|minecraft|javaw|eldenring|gta5|r5apex|overwatch|pubg|terraria|stardew valley)$/i, scene: 'game' },
    // 沟通
    { re: /^(wechat|weixin|qq|tim|dingtalk|wework|wxwork|feishu|lark|telegram|discord|slack|whatsapp|skype|signal|line|kook|yy|momo)$/i, scene: 'chat' },
    // 会议
    { re: /^(zoom|teams|ms-teams|wemeetapp|tencentmeeting|voov|webex|gotomeeting|dingtalkmeeting)$/i, scene: 'meeting' },
    // 办公
    { re: /^(excel|winword|powerpnt|wps|et|wpp|onenote|acrobat|acrord32|foxitreader|notion|typora|obsidian|onenoteim)$/i, scene: 'office' },
    // 媒体
    { re: /^(spotify|netease cloud music|cloudmusic|qqmusic|kugou|potplayermini64|vlc|mpc-hc64|wmplayer|bilibili|iqiyi|youku|tencentvideo|microsoft\.photos|foobar2000|aimp)$/i, scene: 'media' },
    // 浏览器
    { re: /^(chrome|msedge|firefox|brave|opera|vivaldi|360se|360chrome|qqbrowser|sogouexplorer|iexplore|arc|librewolf|thorium)$/i, scene: 'browse' }
  ];

  const SCENE_LABEL = {
    code: '写代码', game: '玩游戏', browse: '逛网页', chat: '聊天',
    meeting: '开会', office: '办公', media: '看片听歌', other: '其他'
  };

  function classifyScene(processName) {
    const p = String(processName || '').trim().replace(/\.exe$/i, '');
    if (!p) return 'other';
    for (const rule of SCENE_RULES) if (rule.re.test(p)) return rule.scene;
    return 'other';
  }

  /** 提醒文案：按风格 + 类型 */
  const REMIND_LINES = {
    gentle: {
      water: ['该喝水啦，我先干为敬💧', '嘴巴干了吧？喝一口水~', '水杯在叫你，听见了吗？'],
      stand: ['坐很久啦，起来走两步吧~', '站起来伸个懒腰，我等你回来。', '腰要抗议了，动一动嘛。'],
      pomodoro: ['这一轮结束啦，休息五分钟？', '专注时间到，奖励自己站起来走走。'],
      commuteIn: ['上班啦，记得打卡~ 今天也要元气满满哦。', '到点打卡咯，新的一天冲冲冲！', '别忘打卡，不然白干了。先喝口水醒醒神？'],
      commuteOut: ['下班啦！打卡收工，去享受你的自由时光吧~', '终于可以跑路了，记得打卡！', '下班打卡！今天的你辛苦啦，奖励自己一顿好的。']
    },
    neutral: {
      water: ['该喝水了。', '到喝水时间了，45 分钟一次。', '喝点水，别硬撑。'],
      stand: ['该起来活动一下了。', '久坐提醒：起身走两步。', '到时间了，站起来。'],
      pomodoro: ['番茄钟结束，休息一下。', '一轮专注完成，可以放松了。'],
      commuteIn: ['该上班打卡了。', '到打卡时间了，别漏了。', '上班打卡提醒。'],
      commuteOut: ['该下班打卡了。', '到下班时间了，记得打卡。', '下班打卡提醒。']
    },
    sassy: {
      water: ['喂，喝水！别逼我举牌。', '再忙也要喝水，你当自己是仙人掌？', '嗓子都干了吧，还装没事。'],
      stand: ['屁股焊椅子上了？起来！', '再坐下去要长蘑菇了，走两步。', '站起来！我数到三。'],
      pomodoro: ['一轮结束了，别假装没看见。', '休息！这是命令，不是建议。'],
      commuteIn: ['还愣着？上班打卡！迟到扣钱别怪我没提醒。', '打卡！赶紧的，摸鱼时间结束了。'],
      commuteOut: ['下班不打卡是想白干？快去！', '到点跑路了，打卡！别明天被财务追着问。']
    }
  };

  /** 天气提醒文案：按风格 + 天气类型。{t} 会被替换成温度等实时数字 */
  const WEATHER_LINES = {
    gentle: {
      rain: ['外面在下雨，出门记得带伞呀~', '今天有雨，伞放包里了吗？', '下雨了，别淋着，我可不想你感冒。'],
      snow: ['下雪啦！路上滑，慢慢走哦~', '外面在下雪，记得穿暖一点。'],
      cold: ['今天只有 {t}℃，出门多穿一件呀。', '冷飕飕的，{t}℃ 了，手套围巾安排上~'],
      heat: ['{t}℃ 了，好热！记得多喝水，别中暑。', '高温 {t}℃，小心中暑，水杯带上~'],
      wind: ['风不小（{w} 级），轻的东西收一收，别吹跑了。', '外面刮大风 {w} 级，出门注意安全。'],
      gap: ['今天温差有 {t}℃，早晚记得加减衣服。', '早晚差 {t}℃ 呢，别只按中午穿。'],
      uv: ['紫外线很强，防晒抹一下再出门~', '今天紫外线 {t} 级，注意防晒哦。'],
      fog: ['外面有雾，能见度很低，开车慢一点。', '起雾了，路上小心些~']
    },
    neutral: {
      rain: ['今天有雨，记得带伞。', '降水提醒：出门请携带雨具。'],
      snow: ['今天有雪，路面湿滑，注意防滑。', '降雪提醒：注意保暖与交通安全。'],
      cold: ['气温 {t}℃，请注意保暖。', '低温提醒：{t}℃，加件外套。'],
      heat: ['气温 {t}℃，注意防暑补水。', '高温提醒：{t}℃，减少户外暴晒。'],
      wind: ['风力 {w} 级，注意高空坠物。', '大风提醒：{w} 级。'],
      gap: ['今日温差 {t}℃，注意增减衣物。', '温差提醒：{t}℃。'],
      uv: ['紫外线指数 {t}，注意防晒。', '紫外线偏强，做好防护。'],
      fog: ['能见度较低，出行注意安全。', '有雾/雾霾，建议戴口罩。']
    },
    sassy: {
      rain: ['下雨了！别指望我给你送伞，自己带上。', '天上在倒水，你打算淋成落汤鸡？'],
      snow: ['下雪了，路滑，摔了别怪我没提醒。', '雪天出门，鞋底防滑吗？'],
      cold: ['{t}℃，你还穿这么点？冻感冒别找我。', '冷成这样，赶紧加衣服！'],
      heat: ['{t}℃！再晒下去要熟了，喝水去。', '热成狗了还喝冰的？多喝点水。'],
      wind: ['{w} 级大风，瘦子慎出门。', '风这么大，发型保不住了，注意安全。'],
      gap: ['温差 {t}℃，早晚两套衣服，别懒。', '一天过两季，衣服带够了吗？'],
      uv: ['紫外线 {t}，不防晒就等着变黑吧。', '太阳这么毒，防晒涂了没？'],
      fog: ['雾这么大，开慢点，别飙。', '能见度这么低，还敢开快车？']
    }
  };

  const WEATHER_LABEL = {
    rain: '下雨', snow: '下雪', cold: '低温', heat: '高温',
    wind: '大风', gap: '温差', uv: '紫外线', fog: '雾/霾'
  };

  const REMIND_LABEL = {
    water: '喝水', stand: '起身', pomodoro: '番茄钟',
    commuteIn: '上班打卡', commuteOut: '下班打卡', weather: '天气'
  };

  /** 提醒时的姿态：喝水用举牌姿态（素材牌子上写的就是“喝水”） */
  const REMIND_STATE = {
    water: 'reminding', stand: 'peek', pomodoro: 'happy',
    commuteIn: 'reminding', commuteOut: 'happy', weather: 'reminding'
  };

  const STATE_LIST = ['idle', 'typing', 'clicking', 'happy', 'sleepy', 'excited', 'petting', 'peek', 'reminding'];

  function pick(arr) {
    // 自定义角色可能是旧数据 / 手工改过配置，台词数组可能缺失，别让整只宠物崩掉
    if (!Array.isArray(arr) || !arr.length) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** 自定义角色缺字段时的通用兜底台词（不至于崩，也不至于串成别的角色的口吻） */
  const GENERIC_LINES = {
    greet: ['我来了！', '你好呀~'],
    idle: ['陪你一会儿~', '今天也要开心哦。'],
    poke: ['诶？干嘛戳我。'],
    petting: ['好舒服~'],
    happy: ['开心！'],
    typing: ['你在忙呀，我安静待着。'],
    sleepy: ['有点困了…']
  };

  // 可被用户覆盖的字段（内置角色也能改：名字 / 口头禅 / 标签 / 各状态台词 / 各场景台词）
  const DIALOGUE_FIELDS = ['name', 'en', 'slogan', 'traits', 'greet', 'idle', 'poke', 'petting', 'happy', 'typing', 'sleepy', 'scene'];

  /**
   * 运行时角色表：基础角色 + 用户自定义角色 + 台词覆盖。
   * cfg.charDialogues:  { [baseId]: { idle:[...], poke:[...], ... } }  仅覆盖基础角色台词
   * cfg.customCharacters: [ { id,name,en,color,colorDeep,colorSoft,traits,slogan,
   *                           visualRatio,handClick,images:{state:'file://...'}, dialogues:{...} } ]
   * 返回: { map, ids }
   */
  /** 把「场景台词」按子场景逐条合并：保留默认场景，只覆盖用户改过的那几条。
   *  避免「只改一个场景就把其余七个默认场景台词整组清空」的旧 bug。 */
  function mergeScene(baseScene, ovScene) {
    const merged = {};
    for (const k of Object.keys(baseScene || {})) merged[k] = baseScene[k];
    for (const k of Object.keys(ovScene || {})) {
      const arr = ovScene[k];
      if (Array.isArray(arr) && arr.length) merged[k] = arr;
    }
    return merged;
  }

  function runtimeCharacters(cfg) {
    cfg = cfg || {};
    const map = {};
    for (const id in CHARACTERS) map[id] = CHARACTERS[id];

    // 基础角色的台词覆盖
    const overrides = cfg.charDialogues || {};
    for (const id in overrides) {
      if (!map[id]) continue;
      const ov = overrides[id] || {};
      const m = Object.assign({}, map[id]);
      for (const k of DIALOGUE_FIELDS) {
        if (k === 'scene') continue;           // scene 单独合并
        if (ov[k] !== undefined) m[k] = ov[k];
      }
      if (ov.scene) m.scene = mergeScene(CHARACTERS[id] && CHARACTERS[id].scene, ov.scene);
      map[id] = m;
    }

    // 自定义角色
    const customs = cfg.customCharacters || [];
    for (const cc of customs) {
      if (!cc || !cc.id) continue;
      const d = cc.dialogues || {};
      const m = Object.assign({}, cc);
      for (const k of DIALOGUE_FIELDS) {
        if (k === 'scene') continue;
        if (d[k] !== undefined) m[k] = d[k];
      }
      if (d.scene) m.scene = mergeScene({}, d.scene);

      // 字段兜底：缺台词数组 / 缺名字时补齐，否则渲染层 pick(undefined) 会直接抛异常
      for (const k of Object.keys(GENERIC_LINES)) {
        if (!Array.isArray(m[k]) || !m[k].length) m[k] = GENERIC_LINES[k].slice();
      }
      if (!m.scene || !Object.keys(m.scene).length) {
        m.scene = Object.assign({}, (CHARACTERS.cat && CHARACTERS.cat.scene) || {});
      }
      if (!m.name) m.name = '自定义形象';
      if (!m.en) m.en = 'Custom';
      if (!Array.isArray(m.traits) || !m.traits.length) m.traits = ['自定义'];
      if (!m.color) m.color = '#9B8CFF';
      if (!m.colorDeep) m.colorDeep = '#6E5BD6';
      if (!m.colorSoft) m.colorSoft = '#ECE7FF';
      if (!m.slogan) m.slogan = '这是我自己做的搭子~';

      m.custom = true;
      map[cc.id] = m;
    }
    return { map, ids: Object.keys(map) };
  }

  /**
   * 角色某状态的精灵图 URL：
   *  - 自定义角色：images[state]（file:// 绝对路径），缺失时回退 images.idle
   *  - 基础角色：../assets/<id>/<state>.png 相对路径
   */
  function spriteUrl(char, state) {
    if (char && char.custom && char.images) {
      const url = char.images[state] || char.images.idle;
      if (url) return url;
    }
    // 自定义角色没有图片（早期上传失败留下的空角色）时回退到内置默认形象，
    // 否则渲染出裂图/空白宠物。
    const id = (char && char.custom) ? 'cat' : (char && char.id);
    return `../../assets/${id}/${state}.png`;
  }

  return {
    CHARACTERS,
    CHARACTER_IDS: Object.keys(CHARACTERS),
    SCENE_LABEL,
    REMIND_LINES,
    REMIND_LABEL,
    REMIND_STATE,
    WEATHER_LINES,
    WEATHER_LABEL,
    STATE_LIST,
    DIALOGUE_FIELDS,
    classifyScene,
    pick,
    runtimeCharacters,
    spriteUrl
  };
});
