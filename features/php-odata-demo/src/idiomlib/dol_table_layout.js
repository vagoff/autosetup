'use strict';
const {reindent, reindent0, ob_wrap} = require('../compilerlib/reindent');
const {SqlTableRowSource} = require('./dol_row_source_sql');

module.exports = (Super) => (class extends Super {
    // Выборка строк вынесена в подставляемый источник (SQL по умолчанию).
    // Меняется источник -- меняется только он, раскладка таблицы ниже общая.
    get_table_row_source() {
        if (typeof this._table_row_source !== 'undefined') {
            return this._table_row_source;
        }
        // Источник можно задать прямо в декларации страницы: значение --
        // фабрика (gen) => источник. Так страница на 1С OData не тащит за
        // собой ни строчки SQL, а страницы на БД ничего не замечают.
        const row_source_factory = this.env.ii && this.env.ii.val('row_source');
        if (row_source_factory) {
            return row_source_factory(this);
        }
        return new SqlTableRowSource(this);
    }
    set_table_row_source(row_source) {
        this._table_row_source = row_source;
    }
    _gen_search(sql_dot_name, search, fieldstosearchall, oo) {
        return this.get_table_row_source().gen_search(sql_dot_name, search, fieldstosearchall, oo);
    }
    gen_dol_table_layout(fields, main_entity_name=null) {
        const {ii,oo} = this.env;
        const res_var = oo.has('res_var') ? oo.get('res_var') : '$resql';
        const num_var = oo.has('num_var') ? oo.get('num_var') : '$num';
        const obj_var = oo.has('obj_var') ? oo.get('obj_var') : '$obj';

        const tis = []; // search inputs
        const ths = []; // table column headers
        const tds = []; // table cell values
        const fieldstosearchall = [] ;
        const arrayfields = [];

        if (this.fill_field_labels) {
            this.fill_field_labels(fields, main_entity_name, true);
        }

        // [!] hacks {{{
        this.setup_object_expr('table_element', 'null');
        this.use_param('id', 'int'); // [!] here?
        this.use_param('ref', 'alpha'); // [!] here?
        // [!] hacks }}}

        // [!] hacks {{{
        if (!oo.has('tr_beg_ths') && !oo.has('tr_end_ths')) {
            oo.addR('tr_beg_ths', `
                if (getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                    print '<td class="center"></td>';
                }
            `);
            oo.addR('tr_end_ths', `
                if (!getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                    print '<td class="center"></td>';
                }
            `);
        }
        if (!oo.has('tr_beg_tds') && !oo.has('tr_end_tds')) {
            oo.addR('tr_beg_tds', `
                if (getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                    print '<td class="center"></td>';
                }
            `);
            oo.addR('tr_end_tds', `
                if (!getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                    print '<td class="center"></td>';
                }
            `);
        }
        if (!oo.has('after_barre_liste')) {
            oo.addR('after_barre_liste', ``);
        }
        // [!] hacks }}}

        let field_num = 0;
        for (const [refname, field_info] of Object.entries(fields)) {
            field_num++;

            if (field_info.disabled) continue;

            // augment field_info
            /*if ((typeof field_info.ti_expr === 'undefined') !== (typeof field_info.search === 'undefined')) {
                delete field_info.search;
                field_info.ti_expr = `''`;
                //throw new Error(`search and ti_expr does not match for fiuld ${refname}`);
            }*/
            // [!] hacks {{{
            if (typeof field_info.ti_expr === 'undefined' && typeof field_info.search === 'undefined') field_info.ti_expr = `''`;
            if (typeof field_info.ti_expr === 'undefined' && typeof field_info.search !== 'undefined') field_info.ti_expr = `'???'`;
            if (typeof field_info.sortable === 'undefined') field_info.sortable = typeof field_info.sql_dot_name !== 'undefined';
            // [!] hacks }}}

            // destructure
            const {sql_dot_name, arrayfield, sortable, search, table_init, tr_init, ti_class, ti_align, tt_class, td_class, td_init, td_title, ti_expr, td_block} = field_info;

            if (typeof table_init !== 'undefined') {
                oo.addR('table_init', table_init);
            }

            if (typeof tr_init !== 'undefined') {
                oo.addR('tr_init', tr_init);
            }

            // search
            this._gen_search(sql_dot_name, search, fieldstosearchall, oo);

            //console.log('field', refname,{sql_dot_name, arrayfield, searchall, ti_class, td_class, ti_expr, td_block});
            if (field_info.hide_in_table) {
                continue;
            }

            if (arrayfield) {
                let arrayfield_ = arrayfield
                if (field_info.label) {
                    arrayfield_ = `array_merge(${arrayfield_}, array('label' => '${field_info.label}'))`;
                }
                arrayfields.push(`'${sql_dot_name ?? refname}'=>${arrayfield_}`);
                //console.log(refname, field_info.label);
            } else if (field_info.label) {
                arrayfields.push(`'${sql_dot_name ?? refname}'=>array('label'=>'${field_info.label}', 'checked'=>1,'enabled'=>1, 'visible'=>-1, 'position'=>${field_num*10})`);
            }

            if (typeof td_block === 'undefined') continue;
            //if (typeof td_block === 'undefined') throw new Error(`no td_block for ${refname}`);

            const ti_class_ = ti_class ? ` class="${ti_class}"` : '';
            const ti_align_ = ti_align ? ` align="${ti_align}"` : '';
            const ti_expr_ = ti_expr.trim().indexOf('\n') >= 0 ? reindent(ti_expr) : reindent(`
                print ${ti_expr.trim()};
            `);
            const key_name = sql_dot_name ?? refname;
            const ti = reindent(`
                // ti of ${refname}
                if (!empty($arrayfields['${key_name}']['checked'])) {
                    print '<td${ti_class_}${ti_align_}>';
                    ${reindent0(ti_expr_, 5*4)}
                    print '</td>';
                }
            `);
            const tt_class_ = tt_class ? `, '${tt_class} '` : '';
            const tt_body_ = sortable ? `print_liste_field_titre($arrayfields['${key_name}']['label'], $_SERVER["PHP_SELF"], "${key_name}", "", $param, "", $sortfield, $sortorder${tt_class_});` : `print '<td>' . $arrayfields['${key_name}']['label'] . '</td>';`;
            const th = reindent(`
                // th of ${refname}
                if (!empty($arrayfields['${key_name}']['checked'])) {
                    ${reindent0(tt_body_, 5*4)}
                    $totalarray['nbfield']++;
                }
            `);
            const td_class_ = !td_class ? '' : ` class="${td_class}"`;
            const td_title_ = !td_title ? '' : ` title="${td_title.trim().indexOf('\n') >= 0 ?
                `';\n${td_title}\nprint '` :
                `'.${td_title}.'`

            }"`;
            const td_block_ = td_block.trim().indexOf('\n') >= 0 ? reindent(td_block) : reindent(`
                print ${td_block.trim()};
            `);
            const td = reindent(`
                // td of ${refname}
                if (!empty($arrayfields['${key_name}']['checked'])) {
                    ${reindent0(td_init ?? '', 5*4)}
                    print '<td${td_class_}${td_title_}>';
                    ${reindent0(td_block_, 5*4)}
                    print "</td>\\n";
                    if (!$i) {
                        $totalarray['nbfield']++;
                    }
                }
            `);
            tis.push(ti);
            ths.push(th);
            tds.push(td);
        }

        const tis_ = reindent(`
            // Action column
            if (getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                print '<td class="liste_titre center" style="width:75px">';
                print getTitleFieldOfList($selectedfields, 2, $_SERVER["PHP_SELF"], "", '', '', 'style="display:inline"', $sortfield, $sortorder, 'center ');
                //$searchpicto = $form->showFilterButtons('left');
                $searchpicto = '<button type="submit" class="liste_titre button_search reposition" name="button_search_x" value="x"><span class="fa fa-search"></span></button>';
                $searchpicto .= '<button type="submit" class="liste_titre button_removefilter reposition" name="button_removefilter_x" value="x"><span class="fa fa-remove"></span></button>';
                print $searchpicto;
                print '</td>';
            }
            ${reindent0(tis.join('\n'), 3*4)}
            // Action column
            if (!getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN')) {
                print '<td class="liste_titre center" style="width:75px">';
                print getTitleFieldOfList($selectedfields, 2, $_SERVER["PHP_SELF"], "", '', '', 'style="display:inline"', $sortfield, $sortorder, 'center ');
                //$searchpicto = $form->showFilterButtons();
                $searchpicto = '<button type="submit" class="liste_titre button_search reposition" name="button_search_x" value="x"><span class="fa fa-search"></span></button>';
                $searchpicto .= '<button type="submit" class="liste_titre button_removefilter reposition" name="button_removefilter_x" value="x"><span class="fa fa-remove"></span></button>';
                print $searchpicto;
                print '</td>';
            }
        `);

        const ths_ = reindent(`
            ${reindent0(oo.get('tr_beg_ths'), 3*4)}
            ${reindent0(ths.join('\n'), 3*4)}
            ${reindent0(oo.get('tr_end_ths'), 3*4)}
        `);

        const tds_ = reindent(`
            ${reindent0(oo.get('tr_beg_tds'), 3*4)}

            ${reindent0(tds.join('\n'), 3*4)}

            // Extra fields
            include DOL_DOCUMENT_ROOT.'/core/tpl/extrafields_list_print_fields.tpl.php';

            ${reindent0(oo.get('tr_end_tds'), 3*4)}
        `);
        oo.addR('page_set_param', `
            if ($sortfield != '') $param .= '&sortfield=' . urlencode($sortfield);
            if ($sortorder != '') $param .= '&sortorder=' . urlencode($sortorder);
        `);
        oo.addR('page_top', `

            // Search parameters
            ${reindent0(oo.get('search_parameters'), 3*4)}

            //Show/hide child products
            if (isModEnabled('variants') && !empty($conf->global->PRODUIT_ATTRIBUTES_HIDECHILD)) {
                $show_childproducts = GETPOST('search_show_childproducts');
            } else {
                $show_childproducts = '';
            }

            // Load variable for pagination
            $limit = GETPOST('limit', 'int') ?GETPOST('limit', 'int') : $conf->liste_limit;
            $sortfield = GETPOST('sortfield', 'aZ09comma');
            $sortorder = GETPOST('sortorder', 'aZ09comma');
            $page = GETPOSTISSET('pageplusone') ? (GETPOST('pageplusone') - 1) : GETPOST("page", 'int');
            if (empty($page) || $page < 0 || GETPOST('button_search', 'alpha') || GETPOST('button_removefilter', 'alpha')) {
                // If $page is not defined, or '' or -1 or if we click on clear filters
                $page = 0;
            }
            $offset = $limit * $page;
            $pageprev = $page - 1;
            $pagenext = $page + 1;

            // sorting
            if (!$sortfield) {
                $sortfield = "${ii.str('default_sortfield')}";
            }
            if (!$sortorder) {
                $sortorder = "ASC";
            }

            // Initialize context for list
            $contextpage = GETPOST('contextpage', 'aZ');
            if ($contextpage) $contextpage = str_replace('_', '', basename(dirname(__FILE__)).basename(__FILE__, '.php'));

            // Initialize technical object to manage hooks. Note that conf->hooks_modules contains array of hooks
            ${reindent0(oo.get('table_init'), 3*4)}
            //[!]$hookmanager->initHooks(array('productservicelist'));

            if (empty($action)) {
                $action = 'list';
            }

            // List of fields to search into when doing a "search in all"
            $fieldstosearchall = array(
                ${reindent0(fieldstosearchall.join(',\n'), 4*4)}
            );

            // locals
            $alias_product_perentity = empty($conf->global->MAIN_PRODUCT_PERENTITY_SHARED) ? "p" : "ppe";

            // arrayfields
            $arrayfields = array(
                ${reindent0(arrayfields.join(',\n'), 4*4)}
            );

            // Extra fields
            include DOL_DOCUMENT_ROOT.'/core/tpl/extrafields_list_array_fields.tpl.php';

            //$object->fields = dol_sort_array($object->fields, 'position');
            $arrayfields = dol_sort_array($arrayfields, 'position');

        `);

        oo.addR('page_head_actions', `

            // fetch optionals attributes and labels
            if ($object->table_element) $extrafields->fetch_name_optionals_label($object->table_element);
            $search_array_options = $extrafields->getOptionalsFromPost($object->table_element, '', 'search_');

            /*
             * Actions
             */

            if (GETPOST('cancel', 'alpha')) {
                $action = 'list';
                $massaction = '';
            }
            if (!GETPOST('confirmmassaction', 'alpha') && $massaction != 'presend' && $massaction != 'confirm_presend') {
                $massaction = '';
            }
            ${reindent0(oo.get('actions'), 3*4)}

            // Selection of new fields
            include DOL_DOCUMENT_ROOT.'/core/actions_changeselectedfields.inc.php';

            // Purge search criteria
            if (GETPOST('button_removefilter_x', 'alpha') || GETPOST('button_removefilter.x', 'alpha') || GETPOST('button_removefilter', 'alpha')) { // All tests are required to be compatible with all browsers
                $sall = "";
                ${reindent0(oo.get('purge_search_criteria'), 4*4)}
            }

        `);

        oo.addR('page_head_init', `
            /*
             * View
             */

            $product_static = new Product($db);
            $warehouse_static = new Entrepot($db);
            $static_ws = new Workstation($db);
        `);

        this.get_table_row_source().gen_fetch(oo, {res_var, num_var, obj_var});

        this.use_param('optioncss', 'alpha');
        oo.addR('page_body', `

            // Displays product removal confirmation
            if (GETPOST('delprod')) {
                setEventMessages($langs->trans("ProductDeleted", GETPOST('delprod')), null, 'mesgs');
            }

            // Add $param from extra fields
            include DOL_DOCUMENT_ROOT.'/core/tpl/extrafields_list_search_param.tpl.php';

            $morehtml = '';
            // (table_header_morehtml)
            ${oo.has('table_header_morehtml') ? reindent0(ob_wrap('morehtml', oo.get('table_header_morehtml')), 3*4) : ''}

            $massactionbutton = '';
            // (set_mass_action_buttons)
            ${reindent0(oo.get('set_mass_action_buttons'), 3*4)}

            // (set_new_card_button)
            $newcardbutton = '';
            ${oo.has('set_new_card_button') ? reindent0(oo.get('set_new_card_button'), 3*4) : ''}
            //$newcardbutton .= dolGetButtonTitle($langs->trans('ViewList'), '', 'fa fa-bars imgforviewmode', $_SERVER["PHP_SELF"].'?mode=common'.preg_replace('/(&|\\?)*mode=[^&]+/', '', $param), '', ((empty($mode) || $mode == 'common') ? 2 : 1), array('morecss'=>'reposition'));
            //$newcardbutton .= dolGetButtonTitle($langs->trans('ViewKanban'), '', 'fa fa-th-list imgforviewmode', $_SERVER["PHP_SELF"].'?mode=kanban'.preg_replace('/(&|\\?)*mode=[^&]+/', '', $param), '', ($mode == 'kanban' ? 2 : 1), array('morecss'=>'reposition'));

            $params = array();

            print '<form id="searchFormList" action="'.$_SERVER["PHP_SELF"].'" method="POST" name="formulaire">';
            print '<input type="hidden" name="token" value="'.newToken().'">';
            print '<input type="hidden" name="formfilteraction" id="formfilteraction" value="list">';
            print '<input type="hidden" name="action" value="list">';
            print '<input type="hidden" name="sortfield" value="'.$sortfield.'">';
            print '<input type="hidden" name="sortorder" value="'.$sortorder.'">';
            ${reindent0(oo.get_reusable('page_hidden_params'), 3*4)}
            //print '<input type="hidden" name="page" value="'.$page.'">';

            $title = $langs->trans("${ii.str('table_title')}");
            $picto = 'product';

            // $morehtmlcenter = $massactionbutton
            // $morehtmlright = $newcardbutton
            $massactionbutton .= $morehtml;
            $morehtmlrightbeforearrow = '';
            print_barre_liste($title, $page, $_SERVER["PHP_SELF"], $param, $sortfield, $sortorder, $massactionbutton, ${num_var}, $nbtotalofrecords, $picto, 0, $newcardbutton, '', $limit, 0, 0, 1, $morehtmlrightbeforearrow); // $pagenavastextinput=1
            //print_barre_liste($titre, $page, $file, $options = '', $sortfield = '', $sortorder = '', $morehtmlcenter = '', $num = -1, $totalnboflines = '', $picto = 'generic', $pictoisfullpath = 0, $morehtmlright = '', $morecss = '', $limit = -1, $hideselectlimit = 0, $hidenavigation = 0, $pagenavastextinput = 0, $morehtmlrightbeforearrow = '')
            ${reindent0(oo.get('after_barre_liste'), 3*4)}

            $topicmail = "Information";
            $modelmail = "product";
            $objecttmp = new Product($db);
            $trackid = 'prod'.$object->id;
            include DOL_DOCUMENT_ROOT.'/core/tpl/massactions_pre.tpl.php';

            /*[!]if (!empty($catid)) {
                print "<div id='ways'>";
                $c = new Categorie($db);
                $ways = $c->print_all_ways(' &gt; ', 'product/list.php');
                print " &gt; ".$ways[0]."<br>\\n";
                print "</div><br>";
            }*/

            if ($sall) {
                $setupstring = '';
                foreach ($fieldstosearchall as $key => $val) {
                    $fieldstosearchall[$key] = $langs->trans($val);
                    $setupstring .= $key."=".$val.";";
                }
                print '<!-- Search done like if PRODUCT_QUICKSEARCH_ON_FIELDS = '.$setupstring.' -->'."\\n";
                print '<div class="divsearchfieldfilter">'.$langs->trans("FilterOnInto", $sall).join(', ', $fieldstosearchall).'</div>'."\\n";
            }

            // Filter on categories
            $moreforfilter = '';
            /*[!]if (isModEnabled('categorie') && $user->hasRight('categorie', 'read')) {
                $formcategory = new FormCategory($db);
                $moreforfilter .= $formcategory->getFilterBox(Categorie::TYPE_PRODUCT, $searchCategoryProductList, 'minwidth300', $searchCategoryProductOperator ? $searchCategoryProductOperator : 0);
            }*/

            //Show/hide child products. Hidden by default
            if (isModEnabled('variants') && !empty($conf->global->PRODUIT_ATTRIBUTES_HIDECHILD)) {
                $moreforfilter .= '<div class="divsearchfield">';
                $moreforfilter .= '<input type="checkbox" id="search_show_childproducts" name="search_show_childproducts"'.($show_childproducts ? 'checked="checked"' : '').'>';
                $moreforfilter .= ' <label for="search_show_childproducts">'.$langs->trans('ShowChildProducts').'</label>';
                $moreforfilter .= '</div>';
            }

            // (morefilter)
            ${reindent0(oo.get('morefilter'), 3*4)}

            if (!empty($moreforfilter)) {
                print '<div class="liste_titre liste_titre_bydiv centpercent">';
                print $moreforfilter;
                print '</div>';
            }

            $varpage = empty($contextpage) ? $_SERVER["PHP_SELF"] : $contextpage;
            $selectedfields = ($mode != 'kanban' ? $form->multiSelectArrayWithCheckbox('selectedfields', $arrayfields, $varpage, getDolGlobalString('MAIN_CHECKBOX_LEFT_COLUMN', '')) : ''); // This also change content of $arrayfields
            ${reindent0(oo.get('append_to_selectedfields'), 3*4)}

            print '<div class="div-table-responsive">';
            print '<table class="tagtable nobottomiftotal liste'.($moreforfilter ? " listwithfilterbefore" : "").'">'."\\n";

            // Fields title search
            // --------------------------------------------------------------------
            print '<tr class="liste_titre_filter">';
            ${reindent0(tis_, 3*4)}
            print '</tr>'."\\n";

            $totalarray = array();
            $totalarray['nbfield'] = 0;

            // Fields title label
            // --------------------------------------------------------------------
            print '<tr class="liste_titre">';
            ${reindent0(ths_, 3*4)}
            // Extra fields
            include DOL_DOCUMENT_ROOT.'/core/tpl/extrafields_list_search_title.tpl.php';
            print '</tr>'."\\n";

            // Loop on record
            // --------------------------------------------------------------------
            $i = 0;
            $savnbfield = $totalarray['nbfield'];
            $totalarray = array();
            $totalarray['nbfield'] = 0;
            $imaxinloop = ($limit ? min(${num_var}, $limit) : ${num_var});
            while ($i < $imaxinloop) {
                ${this.get_table_row_source().gen_row_next({res_var, obj_var})}
                if (empty(${obj_var})) {
                    break; // Should not happen
                }

                if ($mode == 'kanban') { // kanban
                } else {
                    // Show line of result
                    $j = 0;
                    // (tr_id_init)
                    ${reindent0(oo.get('tr_id_init'), 3*4)}
                    print '<tr data-rowid="'.$row_id.'" class="oddeven">';

                    // (tr_init)
                    ${reindent0(oo.get('tr_init'), 5*4)}

                    ${reindent0(tds_, 5*4)}

                    print '</tr>'."\\n";
                }

                $i++;
            }

            // If no record found
            if (${num_var} == 0) {
                $colspan = 1;
                foreach ($arrayfields as $key => $val) {
                    if (!empty($val['checked'])) {
                        $colspan++;
                    }
                }
                print '<tr><td colspan="'.$colspan.'"><span class="opacitymedium">'.$langs->trans("NoRecordFound").'</span></td></tr>';
            }

            ${this.get_table_row_source().gen_free({res_var})}

            print '</table>'."\\n";
            print '</div>'."\\n";

            print '</form>'."\\n";

            //print '<textarea rows=40 cols=120>' . $sql . '</textarea>';
        `);

    }
});
