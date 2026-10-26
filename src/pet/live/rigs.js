'use strict';
/**
 * 活体引擎 · 角色骨架参数
 * 同一套骨骼引擎，靠这套「外形参数」适配 6 个内置角色：
 * 猫/狗有耳+尾+爪；抽象团是圆胖无四肢；三个拟人女孩有头发+手+腿。
 * 颜色仍由角色本身的 color/colorDeep/colorSoft 决定，保留辨识度。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LiveRigs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 通用默认值
  const base = {
    headR: 34, headDY: 0,
    bodyW: 38, bodyH: 48,
    ear: 'none', tail: false,
    arm: 'paw', leg: 'paw',
    snout: false, hair: false, cheeks: true,
    limbLen: 30, pawSize: 9, handSize: 8
  };

  const RIGS = {
    cat: Object.assign({}, base, { ear: 'cat', tail: true, arm: 'paw', leg: 'paw', snout: true, headR: 33 }),
    dog: Object.assign({}, base, { ear: 'dog', tail: true, arm: 'paw', leg: 'paw', snout: true, headR: 32, bodyW: 40, bodyH: 46 }),
    blob: Object.assign({}, base, { ear: 'none', tail: false, arm: 'stub', leg: 'none', snout: false, bodyW: 46, bodyH: 44, headR: 40, headDY: -6, cheeks: true }),
    xin: Object.assign({}, base, { ear: 'hair', tail: false, arm: 'hand', leg: 'human', snout: false, hair: true, headR: 30, bodyW: 30, bodyH: 50, limbLen: 34, handSize: 7 }),
    sweet: Object.assign({}, base, { ear: 'hair', tail: false, arm: 'hand', leg: 'human', snout: false, hair: true, headR: 31, bodyW: 31, bodyH: 49, limbLen: 33, handSize: 7 }),
    yu: Object.assign({}, base, { ear: 'hair', tail: false, arm: 'hand', leg: 'human', snout: false, hair: true, headR: 30, bodyW: 30, bodyH: 51, limbLen: 35, handSize: 7 })
  };

  function rig(id) {
    return RIGS[id] || RIGS.cat;
  }

  return { RIGS, rig, base };
});
