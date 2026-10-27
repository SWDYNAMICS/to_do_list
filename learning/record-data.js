// Storage vocabulary is separate from UI labels. Only v1 assigns archive to bookcase.
(() => {
    const VERSION = 2;
    const LOCATION = Object.freeze({ DESK: 'desk', BOOKCASE: 'bookcase' });
    const LABELS = Object.freeze({ [LOCATION.DESK]: '데스크', [LOCATION.BOOKCASE]: '북케이스' });
    const validLocation = value => Object.values(LOCATION).includes(value);
    const empty = () => ({ version: VERSION, records: [] });

    function read(data) {
        const legacyArray = Array.isArray(data);
        const source = legacyArray ? { version: 1, records: data } : data;
        if (!source || ![1, VERSION].includes(source.version) || !Array.isArray(source.records)) {
            throw new Error('지원하지 않는 기록 형식입니다. 최신 페이지로 새로고침해 주세요.');
        }
        const records = source.records.map(record => {
            if (!record || typeof record.title !== 'string' || typeof record.date !== 'string'
                || typeof record.content !== 'string') {
                throw new Error('읽을 수 없는 기록이 있습니다. 원본을 보호하기 위해 저장을 중단했습니다.');
            }
            let location = record.location;
            if (source.version === 1) {
                if (location === 'archive') location = LOCATION.BOOKCASE;
                else if (location == null) location = LOCATION.DESK;
            }
            if (!validLocation(location)) {
                throw new Error('지원하지 않는 보관 위치가 있습니다. 원본을 보호하기 위해 저장을 중단했습니다.');
            }
            // Preserve rich content, review state and any additional record fields.
            return { ...record, location };
        });
        return { ...source, version: VERSION, records };
    }

    function write(records, previous = empty()) {
        return read({ ...previous, version: VERSION, records });
    }

    window.TilRecordData = Object.freeze({ VERSION, LOCATION, LABELS, empty, read, write });
})();
