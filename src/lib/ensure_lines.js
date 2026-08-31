// [!] copy! merge back to shared lib!
'use strict';

const afs = require('fs').promises;

const LOG = 0;

function mk_re(s, f='') { // [!] move out
    if (!s) {
        return s;
    }
    if (s instanceof RegExp) {
        return s;
    }
    if (typeof s === 'string') {
        return new RegExp(s, f);
    }
    if (s instanceof Array) {
        //console.log('mk_re:', [s, f]);
        //if (s.length !== 2 || typeof s[0] !== 'string' || typeof s[1] !== 'string') throw new Error(`invalid args: ${JSON.stringify(s)}`);
        return new RegExp(s, f);
    }
    throw new Error(`invalid args: ${JSON.stringify(s)}`);
}

function pattern_match(pattern, string) {
    if (entry.equal) {
        if (string.indexOf(entry.equal.trim()) >= 0) {
            return true;
        }
    } else {
        const re = mk_re(entry.re);
        if (text.match(re)) {
            return true;
        }
    }
    return false;
}

function any_pattern_match(pattern, lines) {
    for (const line of lines) {
        if (pattern_match(pattern, line)) {
            return true;
        }
    }
    return false;
}

async function read_lines(fp) {
    let text;
    try {
        text = await afs.readFile(fp, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        text = '';
    }
    return text.trim().split('\n');
}

async function xxx_ensure_lines(fp, entries) { // [!] move out
    let text;
    try {
        text = await afs.readFile(fp, 'utf8');
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }

        text = '';
    }
    const additions = [];
    for (const entry of entries) {
        const re = entry.check_re instanceof RegExp ? entry.check_re : new RegExp(entry.check_re); // [!] use mk_re
        if (!text.match(re)) {
            additions.push(entry.append);
        }
    }
    if (additions.length > 0) {
        if (text.length > 0 && !text.endsWith('\n')) {
            text += '\n';
        }
        text += additions.join('\n') + '\n';
        await afs.writeFile(fp, text, 'utf8');
        console.log(`written ${fp}`); // [!] verbose?
    }
}

const defaults = {
    new_file_mode: 'CREATE', // CREATE | ERROR | IGNORE
    insert_at: 'END', // END | {'':'AFTER',text:''}
};

async function ensure_lines(fp, entries, opts={}) { // [!] move out
    const {dry_run,verbose} = opts;
    if(LOG)console.log('ensure_lines:', fp, entries, opts);
    const stats = {check_equal_catch: 0, check_re_catch: 0, deletions: 0};
    let text;
    if (!opts.new_file_mode) opts.new_file_mode = defaults.new_file_mode;
    if (!opts.insert_at) opts.insert_at = defaults.insert_at;
    try {
        text = await afs.readFile(fp, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        stats.file_not_existed = true;
        switch (opts.new_file_mode) {
        case 'CREATE':
            if (verbose) {
                console.log('file', fp, 'does not exists, treating as empty text');
            }
            text = '';
        break;
        case 'ERROR':
            throw error;
        break;
        case 'IGNORE':
            if (verbose) {
                console.log('file', fp, 'does not exists, ignoring replacements overall');
            }
            stats.file_not_existed = true;
            return stats;
        break;
        default:
            throw new Error(`internal error: bad mode ${opts.new_file_mode}`);
        }
    }
    if (opts.drop) {
        text = text.trim();
        if (text.endsWith(opts.drop)) {
            text = text.slice(0, -opts.drop.length);
            text += '\n';
            stats.dropped = true;
        }
    }
    const original_text = text;
    const additions = [];
    for (const entry of entries) {
        if (entry.check_equal) {
            if (text.trim().split('\n').indexOf(entry.check_equal.trim()) >= 0) {
                stats.check_equal_catch++;
                continue;
            }
        } else {
            const re = mk_re(entry.check_re, 'mg');
            if (text.match(re)) {
                stats.check_re_catch++;
                continue;
            }
        }
        if (entry.delete_re) {
            const delete_re = mk_re(entry.delete_re, 'mg');
            const text_ = text.replaceAll(delete_re, '');
            if (verbose) {
                console.log(fp + ':', 'delete', delete_re, text_ !== text ? 'DONE' : 'MISS');
            }
            if (text_ !== text) {
                stats.deletions++;
                text = text_;
            }
        }
        additions.push(entry.append);
        //if (text && !text.endsWith('\n')) text += '\n';
        //if (additions.length === 1) text += '\n';
        //text += entry.append;
        if (verbose) {
            if (dry_run) {
                console.log(fp + ':', 'will append', entry.append);
            } else {
                console.log(fp + ':', 'append', entry.append);
            }
        }
    }
    stats.additions = additions.length;
    if (!dry_run && opts.check_no_re) {
        for (const check_no_re_s of typeof opts.check_no_re == 'string' ? [opts.check_no_re] : opts.check_no_re) {
            const check_no_re = mk_re(check_no_re_s, 'mg');
            if (text.match(check_no_re)) {
                throw new Error(`${check_no_re_s} found in ${fp} after all replacements made`);
            }
        }
    }
    if (additions.length > 0) {
        if (!dry_run) {
            if (0 && (stats.dropped || stats.deletions)) {
                await afs.writeFile(fp, text);
            } else {
                if (opts.insert_at === 'END') {
                    const prefix = original_text && !original_text.endsWith('\n') ? '\n' : '';
                    //console.log('FP=',fp);
                    await afs.appendFile(fp, prefix + additions.join('\n') + '\n');
                } else if (opts.insert_at && opts.insert_at[''] === 'AFTER') {
                    const pos = text.indexOf(opts.insert_at.text);
                    if (pos < 0) {
                        throw new Error(`text ${opts.insert_at.text} not found for insert_at in ${text}`);
                    }
                    text = text.slice(0, pos + opts.insert_at.text.length) + '\n' + additions.join('\n') + '\n' + text.slice(pos + opts.insert_at.text.length);
                    await afs.writeFile(fp, text);
                } else {
                    throw new Error(`internal error: invalid insert at ${opts.insert_at}`);
                }
            }
            if (verbose) {
                console.log(fp + ':', `written with ${additions.length} additions`);
            }
        } else {
            if (verbose) {
                console.log(fp + ':', `will write with ${additions.length} additions`);
            }
            stats.addition_lines = additions;
        }
    }
    return stats;
}

module.exports.ensure_lines = ensure_lines;
