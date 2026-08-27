'use strict';
const {reindent0} = require('../compilerlib/reindent');

// Источник строк для dol_table_layout: стандартный OData 1С вместо SQL.
//
// Контракт с раскладкой ровно тот же, что у SQL-источника, поэтому вся
// таблица Dolibarr (колонки, фильтры, сортировка, пагинация, выбор полей)
// работает без единой правки: строки приходят объектами, и `$obj->Поле`
// читается так же, как из `$db->fetch_object()`.
//
// Три вещи, которые OData делает иначе:
//  * фильтр -- это строка $filter, а не куски SQL с natural_search();
//  * сортировка -- $orderby по ИМЕНИ свойства, а ключи колонок в Dolibarr
//    обязаны быть ASCII (GETPOST('sortfield','aZ09comma') вырезает кириллицу),
//    поэтому раскладка знает слаг, а карта слаг->свойство живёт в PHP;
//  * освобождать нечего -- результат уже в памяти.
class ODataTableRowSource {
    constructor(gen, {entity_set, field_map_var, select_fields, expand, count_total}) {
        this.gen = gen;
        this.entity_set = entity_set;
        this.field_map_var = field_map_var;
        this.select_fields = select_fields;
        this.expand = expand ?? [];
        this.count_total = count_total;
    }

    // Условия фильтра накапливаются в PHP-массиве и склеиваются в $filter.
    gen_search(sql_dot_name, search, fieldstosearchall, oo) {
        if (!search) {
            oo.add('page_set_param', '');
            oo.add('search_parameters', '');
            oo.add('update_sql_var_for_search', '');
            oo.add('purge_search_criteria', '');
            return;
        }
        const param = search.param ?? ('search_' + sql_dot_name);
        const phpvar = search.phpvar ?? `$${param}`;
        const property = search.odata_property ?? sql_dot_name;
        const type = search.odata_type ?? 'string';

        oo.addR('search_parameters', `
            ${phpvar} = GETPOST('${param}', 'alphanohtml');
        `);
        oo.addR('page_set_param', `
            if (${phpvar} !== '') {
                $param .= '&${param}='.urlencode(${phpvar});
            }
        `);
        oo.addR('purge_search_criteria', `
            ${phpvar} = '';
        `);
        // Значения экранирует odatatest_filter_*: одинарная кавычка в OData
        // удваивается, иначе строка поиска ломает весь запрос.
        const condition = {
            string: `odatatest_filter_substring('${property}', ${phpvar})`,
            guid: `odatatest_filter_guid('${property}', ${phpvar})`,
            boolean: `odatatest_filter_boolean('${property}', ${phpvar})`,
            date_from: `odatatest_filter_date('${property}', ${phpvar}, 'ge')`,
            date_to: `odatatest_filter_date('${property}', ${phpvar}, 'le')`,
        }[type];
        if (!condition) throw new Error(`unknown odata search type ${type} for ${sql_dot_name}`);
        oo.addR('update_sql_var_for_search', `
            if (${phpvar} !== '') {
                $odata_filters[] = ${condition};
            }
        `);
        if (search.searchall) {
            fieldstosearchall.push(`'${sql_dot_name}'=>"${search.searchall}"`);
        }
    }

    gen_fetch(oo, {res_var, num_var}) {
        const select = this.select_fields.join(',');
        oo.addR('page_head_view', `

            // Build and execute the OData request
            // --------------------------------------------------------------------
            $odata_filters = array();
            ${this.take_sql_only_region(oo, 'set_sql_var')}

            // Условия поиска приходят тем же именованным блоком, что и в
            // SQL-источнике: раскладка про разницу источников не знает.
            ${reindent0(oo.get('update_sql_var_for_search'), 3 * 4)}

            // Сортировка идёт по слагу колонки (кириллица не переживает
            // GETPOST('sortfield', 'aZ09comma')), поэтому имя свойства 1С
            // достаём из карты полей.
            $odata_sort_property = odatatest_sort_property(${this.field_map_var}, $sortfield);

            ${res_var} = odatatest_fetch_list(array(
                'entity_set' => '${this.entity_set}',
                'select' => '${select}',
                'expand' => array(${this.expand.map((name) => `'${name}'`).join(', ')}),
                'filters' => $odata_filters,
                'sort_property' => $odata_sort_property,
                'sort_order' => $sortorder,
                'limit' => $limit,
                'offset' => $offset,
                'count_total' => ${this.count_total ? 'true' : 'false'},
            ));

            $nbtotalofrecords = ${res_var}['total'];
            if ($limit && ($page * $limit) > $nbtotalofrecords) {
                $page = 0;
                $offset = 0;
            }
            ${num_var} = count(${res_var}['rows']);
        `);
    }

    // Интерпретатор dobaerp заводит SQL-именованные регионы для любой таблицы,
    // поэтому регион существует всегда и его надо ЗАБРАТЬ (иначе finalize
    // справедливо ругается "output ... is not taken"). Для OData он обязан
    // быть пустым: кусок SQL на такой странице -- ошибка конфигурации,
    // а не то, что можно тихо проглотить.
    take_sql_only_region(oo, name) {
        const text = oo.get(name);
        if (text.trim() !== '') {
            throw new Error(`odata row source: region ${name} must be empty, got: ${text.trim()}`);
        }
        return '';
    }

    gen_row_next({res_var, obj_var}) {
        return `${obj_var} = ${res_var}['rows'][$i];`;
    }

    // Результат уже в памяти: освобождать нечего.
    gen_free() {
        return '';
    }
}

module.exports.ODataTableRowSource = ODataTableRowSource;
