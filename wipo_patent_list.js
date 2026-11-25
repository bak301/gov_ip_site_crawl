'use strict';

// Passed directly to page.evaluate, so this function must be self-contained.
function extractPatentListRecords(selector) {
    const text = (row, field) => (row.querySelector(field)?.textContent || '').replace(/\s+/g, ' ').trim();
    const list = (row, field) => {
        const values = [...row.querySelectorAll(`${field} li`)];
        return values.length ? values.map((item) => item.textContent.replace(/\s+/g, ' ').trim()).join(' | ') : text(row, field);
    };
    const records = new Map();
    for (const row of document.querySelectorAll(selector)) {
        const application = text(row, '.rs-AFNB_ORI');
        if (!/^(?:VN-)?[12]-\d{4}-\d{4,}$/i.test(application)) continue;
        const scope = row.closest('div.thumbnail') || row;
        const id = scope.querySelector('input[type="checkbox"][value^="VN"]')?.value
            || row.id || `VN${application.replace(/^VN-/i, '').replace(/-/g, '')}`;
        const gazette = list(row, '.rs-GZNB');
        const publication = list(row, '.rs-PBNB');
        records.set(application.replace(/^VN-/i, ''), [
            id, list(row, '.rs-TITL') || list(row, '.rs-TITL_LG1'), application, text(row, '.rs-AFDT'),
            publication, list(row, '.rs-PBDT'), text(row, '.rs-RENB'), text(row, '.rs-REDT'),
            list(row, '.rs-IPC_ORI') || list(row, '.rs-ICL'), list(row, '.rs-APNA'), list(row, '.rs-INNA'),
            text(row, '.rs-STLB_ORI') || text(row, '.rs-STLB'),
            list(row, '.rs-PCCT'), list(row, '.rs-PCNB'), list(row, '.rs-PCDT'),
            gazette, list(row, '.rs-ABST'), scope.querySelector('img.rs-DRAWING')?.getAttribute('src') || '',
            text(row, '.rs-APPL_SUBTYP') || text(row, '.APPL_SUBTYP-css'),
        ]);
    }
    return [...records.values()];
}

module.exports = { extractPatentListRecords };
