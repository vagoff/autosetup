'use strict';

const {write_file} = require('../utils/file_utils');
const {substitute} = require('../templatelib/double_unders_subst');
const {per_word, capitalize, uncapitalize} = require('../utils/string_utils');
const tpl = require('./dol_templates');

function prepare_substitutions(m_info) {
  const result = {...m_info};
  delete result.top_menu;
  delete result.left_menu;
  const snake_camel_module_name = m_info.module_name;
  Object.assign(result, {
    module_name: per_word(snake_camel_module_name, (w) => w.toLowerCase(), true),
    modulename: per_word(snake_camel_module_name, (w) => w.toLowerCase(), false),
    MODULE_NAME: per_word(snake_camel_module_name, capitalize, true),
    MODULENAME: per_word(snake_camel_module_name, capitalize, false),
    Module_Name: snake_camel_module_name,
    ModuleName: per_word(snake_camel_module_name, (w) => w, false),
    moduleName: per_word(snake_camel_module_name, (w, {is_first}) => is_first ? uncapitalize(w) : w, false),
  });
  result.module_abbr = result.modulename;
  // Права модуля Dolibarr. Пустой список -- поведение как было (WMS его не
  // объявляет и проверяет чужой модуль через restrictedArea), непустой --
  // строки llx_rights_def заводятся при активации модуля.
  result.module_rights = (m_info.rights ?? []).map((right, index) => `
        $this->rights[${index}] = array(
            $this->numero + ${index + 1},
            '${right.label}',
            0,
            0,
            '${right.code}',
        );`).join('');
  result.has_triggers = 0;
  return result;
}

async function write_module_descriptor_file(top, m_info) {
  const subst = prepare_substitutions(m_info);
  const top_menu = [];
  for (const [refname, mi] of Object.entries(m_info.top_menu || {})) {
    const mi_data = {
      ...subst,
      menu_item_title: mi.title,
      script_path: mi.url || `${refname}.php`,
    };
    top_menu.push(substitute(tpl.top_menu_item_template, mi_data));
  }

  const left_menu = [];
  function fill_left_menu(items, fk = '') {
    for (const [refname, mi] of Object.entries(items || {})) {
      const pfx = subst.modulename + '_';
      const mi_data = {
        ...subst,
        menu_item_title: mi.title,
        script_path: mi.url || `${refname}.php`,
        menu_key: pfx + (mi.left_key || refname),
        menu_fkey: `fk_mainmenu=${subst.module_name}${fk}`,
      };
      left_menu.push(substitute(tpl.left_menu_item_template, mi_data));
      fill_left_menu(mi.submenu || {}, `,fk_leftmenu=${mi_data.menu_key}`);
    }
  }
  fill_left_menu(m_info.left_menu);

  const text =
    tpl.header +
    tpl.module_top_includes +
    substitute(tpl.module_descriptor_class, {
      ...subst,
      top_menu: top_menu.join(''),
      left_menu: left_menu.join(''),
    });

  // Каталог модуля и имя класса-дескриптора выводятся из описания модуля,
  // а не зашиты: один и тот же генератор обслуживает любой custom-модуль.
  const module_dir = m_info.module_dir ?? `custom/${subst.modulename}`;
  await write_file(top, `${module_dir}/core/modules/mod${subst.Module_Name}.class.php`, text);
}

async function generate_module_class(site_dir, m_info) {
  await write_module_descriptor_file(site_dir, m_info);
}

async function generate_modwms_class(site_dir, {base_number, top_menu, left_menu}) {
  const m_info = {
    module_name: 'WMS',
    module_dir: 'custom/wms',
    numero: 510000 + base_number,
    position: 90 + base_number,
    version: '1.0',
    short_description: 'Складской учет',
    long_description: 'Складской учет',
    top_menu,
    left_menu,
  };
  await write_module_descriptor_file(site_dir, m_info);
}

module.exports.generate_modwms_class = generate_modwms_class;
module.exports.generate_module_class = generate_module_class;
