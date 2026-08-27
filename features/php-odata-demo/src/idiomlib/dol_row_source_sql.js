'use strict';
const {reindent, reindent0} = require('../compilerlib/reindent');

// Источник строк для dol_table_layout: выборка из БД Dolibarr на SQL.
//
// Это ровно тот код, который до расшивки жил внутри dol_table_layout.js.
// Он вынесен дословно, без единого изменения генерируемого текста -- это
// проверяется побайтовым сравнением всего выхода WMS
// (features/php-odata-demo/scripts/check-dobaerp-sql-parity.js).
//
// Смысл расшивки: dol_table_layout отвечает за раскладку таблицы Dolibarr
// (колонки, фильтры, сортировка, пагинация), а откуда берутся строки --
// решает подставленный источник. Второй источник (1С OData) живёт рядом
// и не требует ни строчки SQL.
class SqlTableRowSource {
    constructor(gen) {
        this.gen = gen;
    }
    gen_search(sql_dot_name, search, fieldstosearchall, oo) {
        //console.log('_gen_search:', {sql_dot_name, search, fieldstosearchall});

        // skip
        oo.add('update_sql_var_for_search_2', '');
        if (!search) {
            oo.add('page_set_param', '');
            oo.add('search_parameters', '');
            oo.add('update_sql_var_for_search', '');
            oo.add('purge_search_criteria', '');
            return;
        }

        // augment
        const search_type = search.type ?? 'natural';
        if (typeof search.param === 'undefined') {
            search.param = 'search_' + sql_dot_name.split('.').slice(-1)[0];
        }
        if (typeof search.phpvar === 'undefined') {
            search.phpvar = `$${search.param}`;
        }

        // sql & param
        let check_;
        let getpost_trim;
        let getpost_type;
        switch (search_type) {
        case 'custom':
            check_ = search.check ? search.check.replaceAll('~', search.phpvar) : `!empty(${search.phpvar})`;
            getpost_type = search.getpost && search.getpost.type ? search.getpost.type : null;
            getpost_trim = false;
            oo.addR('update_sql_var_for_search', `
                ${reindent0(search.extra, 5*4)}
            `);
        break;
        case 'rowid':
            check_ = `${search.phpvar} > 0`;
            getpost_type = search.getpost && search.getpost.type ? search.getpost.type : 'int';
            getpost_trim = false;
            oo.addR('update_sql_var_for_search', `
                if (${check_}) {
                    $sql.= " AND ${sql_dot_name} = ".(int)${search.phpvar};
                }
            `);
        break;
        case 'natural':
            check_ = search.check ? search.check.replaceAll('~', search.phpvar) : `!empty(${search.phpvar})`;
            getpost_type = search.getpost && search.getpost.type ? search.getpost.type : null;
            getpost_trim = false;
            const extra_ = search.extra ? `, ${search.extra}` : '';
            oo.addR('update_sql_var_for_search', `
                if (${check_}) {
                    $sql .= natural_search('${sql_dot_name}', ${search.phpvar}${extra_});
                }
            `);
        break;
        case 'date':
            oo.addR('page_set_param', `
                if (${search.phpvar}_startday) {
                    $param .= '&${search.param}_startday='.urlencode(${search.phpvar}_startday);
                }
                if (${search.phpvar}_startmonth) {
                    $param .= '&${search.param}_startmonth='.urlencode(${search.phpvar}_startmonth);
                }
                if (${search.phpvar}_startyear) {
                    $param .= '&${search.param}_startyear='.urlencode(${search.phpvar}_startyear);
                }
                if (${search.phpvar}_endday) {
                    $param .= '&${search.param}_endday='.urlencode(${search.phpvar}_endday);
                }
                if (${search.phpvar}_endmonth) {
                    $param .= '&${search.param}_endmonth='.urlencode(${search.phpvar}_endmonth);
                }
                if (${search.phpvar}_endyear) {
                    $param .= '&${search.param}_endyear='.urlencode(${search.phpvar}_endyear);
                }
            `);
            oo.addR('search_parameters', `
                ${search.phpvar}_startday = GETPOST('${search.param}_startday', 'int');
                ${search.phpvar}_startmonth = GETPOST('${search.param}_startmonth', 'int');
                ${search.phpvar}_startyear = GETPOST('${search.param}_startyear', 'int');
                ${search.phpvar}_endday = GETPOST('${search.param}_endday', 'int');
                ${search.phpvar}_endmonth = GETPOST('${search.param}_endmonth', 'int');
                ${search.phpvar}_endyear = GETPOST('${search.param}_endyear', 'int');
                ${search.phpvar}_start = dol_mktime(0, 0, 0, GETPOST('${search.param}_startmonth', 'int'), GETPOST('${search.param}_startday', 'int'), GETPOST('${search.param}_startyear', 'int'), 'tzuserrel');
                ${search.phpvar}_end = dol_mktime(23, 59, 59, GETPOST('${search.param}_endmonth', 'int'), GETPOST('${search.param}_endday', 'int'), GETPOST('${search.param}_endyear', 'int'), 'tzuserrel');
            `);
            oo.addR('update_sql_var_for_search', `
                if (!empty(${search.phpvar}_start)) {
                    $sql .= " AND ${sql_dot_name} >= '" . $db->idate(${search.phpvar}_start) . "'";
                }
                if (!empty(${search.phpvar}_end)) {
                    $sql .= " AND ${sql_dot_name} <= '" . $db->idate(${search.phpvar}_end) . "'";
                }
            `);
        break;
        default:
            throw new Error(`invalid search type ${search_type}`);
        }

        // GETPOST
        if (search_type !== 'date') {
            const getpost_type_ = getpost_type !== null ? `, '${getpost_type}'` : '';
            let getpost_ = `GETPOST('${search.param}'${getpost_type_})`;
            if (getpost_trim) getpost_ = `trim(${getpost_})`;
            oo.addR('search_parameters', `
                ${search.phpvar} = ${getpost_};
            `);
        }

        // param
        if (search_type !== 'date') {
            oo.addR('page_set_param', `
                if (${check_}) {
                    $param .= '&${search.param}='.urlencode(${search.phpvar});
                }
            `);
        }

        // purge_search_criteria
        if (search_type === 'date') {
            oo.addR('purge_search_criteria', `
                ${search.phpvar}_startday = '';
                ${search.phpvar}_startmonth = '';
                ${search.phpvar}_startyear = '';
                ${search.phpvar}_start = '';
                ${search.phpvar}_end = '';
            `);
        } else {
            oo.addR('purge_search_criteria', `
                ${search.phpvar} = '';
            `);
        }

        // misc
        if (sql_dot_name && search.searchall) {
            fieldstosearchall.push(`'${sql_dot_name}'=>"${search.searchall}"`);
        }
    }
    // Выборка: собрать запрос, посчитать общее число строк и выполнить
    // его с limit/offset. Дословный перенос из dol_table_layout.
    gen_fetch(oo, {res_var, num_var, obj_var}) {
            oo.addR('page_head_view', `

                // Build and execute select
                // --------------------------------------------------------------------
                $tp = MAIN_DB_PREFIX;
                $sql_group_by = '';
                // (set_sql_var)
                ${reindent0(oo.get('set_sql_var'), 4*4)}
                // (update_sql_var_for_search)
                //$sql_group_by = preg_replace("/\\nGROUP BY .*$/msD", '', $sql);
                //$sql = preg_replace("/^.*\\nGROUP BY .*$/msD", '', $sql);
                ${reindent0(oo.get('update_sql_var_for_search'), 4*4)}
                $sql .= $sql_group_by;
                ${reindent0(oo.get('update_sql_var_for_search_2'), 4*4)}
                //print '<textarea rows=40 cols=120>'; print $sql; print '</textarea>';

                // count number of total rows
                $nbtotalofrecords = '';
                if (!getDolGlobalInt('MAIN_DISABLE_FULL_SCANLIST')) {
                    $sqlforcount = 'SELECT COUNT(*) as nbtotalofrecords FROM (' . $sql . ') nbtotalofrecordstmp';
                    ${res_var} = $db->query($sqlforcount);
                    if (${res_var}) {
                        $objforcount = $db->fetch_object(${res_var});
                        $nbtotalofrecords = $objforcount->nbtotalofrecords;
                    } else {
                        dol_print_error($db);
                    }
                    if (($page * $limit) > $nbtotalofrecords) { // if total resultset is smaller than the paging size (filtering), goto and load page 0
                        $page = 0;
                        $offset = 0;
                    }
                    $db->free(${res_var});
                }

                // Complete request and execute it with limit
                $sql .= $db->order($sortfield, $sortorder);
                if ($limit) {
                    $sql .= $db->plimit($limit + 1, $offset);
                }
                ${res_var} = $db->query($sql);
                if (!${res_var}) {
                    dol_print_error($db);
                    exit;
                }
                ${num_var} = $db->num_rows(${res_var});

                // Direct jump if only one record found
                /*[!]if (${num_var} == 1 && !empty($conf->global->MAIN_SEARCH_DIRECT_OPEN_IF_ONLY_ONE) && $sall) {
                    ${obj_var} = $db->fetch_object(${res_var});
                    $id = ${obj_var}->rowid;
                    header("Location: ".DOL_URL_ROOT.'/product/card.php?id='.$id);
                    exit;
                }*/

            `);
    }

    // Шаг цикла по результату выборки.
    gen_row_next({res_var, obj_var}) {
        return `${obj_var} = $db->fetch_object(${res_var});`;
    }

    // Освобождение результата после отрисовки таблицы.
    gen_free({res_var}) {
        return `$db->free(${res_var});`;
    }
}

module.exports.SqlTableRowSource = SqlTableRowSource;
