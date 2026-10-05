#!/usr/bin/env node
/**
 * 用原 Node.js 项目的 encode 实现（server.js, commit 7a1352f）生成短码兼容向量，
 * 输出 backend/tests/Compat/expected_codes.php 供 PHPUnit 逐位断言。
 *
 * 重新生成：node backend/tools/gen-code-vectors.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

// === 原项目实现（原样复制自 server.js）===
const _alphabet = 'GS2w4R6789IbcdHEXhijWZAzopTrxPNq3sLMJalBVyQeDmY0nugtF5Uv1fkOCK';
const _base = _alphabet.length;
const encode = (id) => {
    let code = '';
    while (id > 0) {
        code = _alphabet.charAt(id % _base) + code;
        id = Math.floor(id / _base);
    }
    return code;
};
// === 原项目实现结束 ===

if (_alphabet.length !== 62 || new Set(_alphabet).size !== 62) {
    console.error('字母表校验失败：必须为 62 个不重复字符');
    process.exit(1);
}

// 覆盖任务书要求的 ID 与进位边界、大数边界（JS 安全整数上限 2^53-1）
const ids = [
    1, 2, 3, 10, 61, 62, 63, 64, 100, 101, 1000, 999999, 123456789,
    999999999999, Number.MAX_SAFE_INTEGER,
];

const vectors = {};
for (const id of ids) {
    vectors[id] = encode(id);
}

const entries = Object.entries(vectors)
    .map(([id, code]) => "    " + id + " => '" + code + "',")
    .join('\n');

const php = `<?php

/**
 * 短码兼容向量表 —— 由 backend/tools/gen-code-vectors.js（原 Node.js encode 实现）生成。
 * 请勿手工编辑；重新生成：node backend/tools/gen-code-vectors.js
 */

return [
${entries}
];
`;

const target = path.join(__dirname, '..', 'tests', 'Compat', 'expected_codes.php');
fs.writeFileSync(target, php);
console.log('已生成 ' + Object.keys(vectors).length + ' 条向量 → ' + target);
for (const [id, code] of Object.entries(vectors)) {
    console.log('  encode(' + id + ') = ' + code);
}
