const RU_QCODES = {
    й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', х: 'bracket_left', ъ: 'bracket_right',
    ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: 'semicolon', э: 'apostrophe',
    я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: 'comma', ю: 'dot', '.': 'slash',
};

const EN_QCODES = {
    ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz0123456789'.split('').map((character) => [character, character])),
    '-': 'minus', '=': 'equal', '[': 'bracket_left', ']': 'bracket_right', ';': 'semicolon', "'": 'apostrophe', ',': 'comma', '.': 'dot', '/': 'slash', '\\': 'backslash',
};

const SHIFTED_QCODES = {
    '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
    _: 'minus', '+': 'equal', '{': 'bracket_left', '}': 'bracket_right', ':': 'semicolon', '"': 'apostrophe', '<': 'comma', '>': 'dot', '?': 'slash', '|': 'backslash',
};

function key(data) {
    return [{ type: 'qcode', data }];
}

function shifted(data) {
    return [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data }];
}

export function encodeQmpTextKeys(text) {
    const events = [];
    for (const character of text) {
        if (character === '\r') continue;
        if (character === '\n') events.push(key('ret'));
        else if (character === ' ') events.push(key('spc'));
        else if (character in SHIFTED_QCODES) events.push(shifted(SHIFTED_QCODES[character]));
        else if (character in RU_QCODES) events.push(key(RU_QCODES[character]));
        else if (character.toLowerCase() in RU_QCODES && character !== character.toLowerCase()) events.push(shifted(RU_QCODES[character.toLowerCase()]));
        else if (character in EN_QCODES) events.push(key(EN_QCODES[character]));
        else if (/^[A-Z]$/u.test(character)) events.push(shifted(EN_QCODES[character.toLowerCase()]));
        else throw new Error(`cannot type character through QMP send-key: ${JSON.stringify(character)}`);
    }
    return events;
}
