'use strict';

module.exports = {
  header: `<?php\n`,
  module_top_includes: `\ninclude_once DOL_DOCUMENT_ROOT.'/core/modules/DolibarrModules.class.php';\n`,
  top_menu_item_template: `
        $this->menu[$r++] = array(
            'fk_menu'=>'',
            'type'=>'top',
            'titre'=>'__menu_item_title__',
            'prefix' => img_picto('', $this->picto, 'class="paddingright pictofixedwidth valignmiddle"'),
            'mainmenu'=>'__module_name__',
            'leftmenu'=>'',
            'url'=>'/custom/__module_name__/__script_path__',
            'langs'=>'__module_name__@__module_name__',
            'position'=>1000 + $r,
            'enabled'=>'isModEnabled("__module_name__")',
            'perms'=>'1',
            'target'=>'',
            'user'=>2,
        );
`,
  left_menu_item_template: `
        $this->menu[$r++]=array(
             'fk_menu' =>'__menu_fkey__',
             'type' =>'left',
             'titre' =>'__menu_item_title__',
             'mainmenu' =>'__module_name__',
             'leftmenu' =>'__menu_key__',
             'url' =>'/custom/__module_name__/__script_path__',
             'langs' =>'__module_name__@__module_name__',
             'position' =>1000 + $r,
             'enabled' =>'$conf->__module_name__->enabled',
             'perms'=>'1',
             'target' =>'',
             'user' =>2,
        );
`,
  module_descriptor_class: `
class mod__ModuleName__ extends DolibarrModules {
    public function __construct($db) {
        global $langs, $conf;
        $this->db = $db;
        $this->numero = __numero__;
        $this->rights_class = '__module_abbr__';
        $this->family = "other";
        $this->module_position = '__position__';
        $this->name = preg_replace('/^mod/i', '', get_class($this));
        $this->description = '__short_description__';
        $this->descriptionlong = '__long_description__';
        $this->editor_name = 'Corum';
        $this->editor_url = '';
        $this->version = '__version__';
        $this->const_name = 'MAIN_MODULE_'.strtoupper($this->name);
        $this->picto = 'fa-file-o';
        $this->module_parts = array(
            'triggers' => 0,
            'css' => array('/custom/__module_name__/css/__module_name__.css.php'),
            'js' => array('/custom/__module_name__/js/__module_name__.js.php'),
            'hooks' => []
        );
        $this->dirs = array('/custom/__module_name__/temp');
        $this->config_page_url = array('setup.php@__module_name__');
        $this->hidden = false;
        $this->depends = array();
        $this->requiredby = array();
        $this->conflictwith = array();
        $this->langfiles = array('__module_name__@__module_name__');
        $this->phpmin = array(7, 0);
        $this->need_dolibarr_version = array(11, -3);
        $this->need_javascript_ajax = 0;
        $this->warnings_activation = array();
        $this->warnings_activation_ext = array();
        $this->const = array();
        if (!isset($conf->__module_name__) || !isset($conf->__module_name__->enabled)) {
            $conf->__module_name__ = new stdClass();
            $conf->__module_name__->enabled = 0;
        }
        $this->tabs = array();
        $this->dictionaries = array();
        $this->boxes = array();
        $this->cronjobs = array();
        $this->rights = array();__module_rights__
        $this->menu = array();
        $r = 0;
        __top_menu__
        __left_menu__
    }

    public function init($options = '') {
        $sql = array();
        return $this->_init($sql, $options);
    }

    public function remove($options='') {
        $sql = array();
        return $this->_remove($sql, $options);
    }
}
`,
};
