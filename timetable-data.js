(() => {
    const STORAGE_KEY = "webuntisTimetableData"

    let data = {
        version: 1,
        customLessons: [],
        overrides: {},
        deletedLessons: [],
        freeDays: {}
    }

    let loadPromise = null
    let writeQueue = Promise.resolve();

    function clone(value) {
        return JSON.parse(JSON.stringify(value))
    }

    async function loadTimetable() {
        if (loadPromise) return loadPromise

        loadPromise = (async () => {
            const result = await chrome.storage.local.get(STORAGE_KEY)
            const stored = result[STORAGE_KEY]

            if (stored && stored.version === 1) {
                data = {
                    version: 1,
                    customLessons: stored.customLessons || [],
                    overrides: stored.overrides || {},
                    deletedLessons: stored.deletedLessons || [],
                    freeDays: stored.freeDays || {}
                }
            }
        })()

        return loadPromise
    }

    async function saveTimetable() {
        await loadTimetable();

        writeQueue = writeQueue.then(() =>
            chrome.storage.local.set({
                [STORAGE_KEY]: clone(data)
            })
        );

        return writeQueue;
    }

    function generateId() {
        return `custom:${crypto.randomUUID()}`
    }

    function getOriginalId(date, originalId) {
        return `original:${date}:${originalId}`;
    }   

    function filterChanges(changes, allowDate = false) {
        const allowed = [
            "startTime",
            "startSlot",
            "durationSlots",
            "subject",
            "teachers",
            "rooms",
            "color",
            "type"
        ]

        if (allowDate)
            allowed.push("date")

        const result = {}

        for (const key of allowed)
            if (Object.hasOwn(changes, key))
                result[key] = changes[key]

        return result
    }

    async function createLesson(lessonData) {
        await loadTimetable()

        if (!lessonData.date)
            throw new Error("A lesson requires a date")

        if (!Number.isInteger(lessonData.startSlot) || lessonData.startSlot < 0)
            throw new Error("Invalid start-slot")

        if (!Number.isInteger(lessonData.durationSlots) || lessonData.durationSlots < 1)
            throw new Error("Invalid lesson time")

        const lesson = {
            id: generateId(),
            date: lessonData.date,
            startTime: lessonData.startTime || "07:50",
            startSlot: lessonData.startSlot,
            durationSlots: lessonData.durationSlots,
            subject: lessonData.subject || "",
            teachers: lessonData.teachers || [],
            rooms: lessonData.rooms || [],
            color: lessonData.color || "#4A90D9",
            type: lessonData.type || "normal"
        }

        data.customLessons.push(lesson)

        await saveTimetable()

        return clone(lesson)
    }

    async function updateLesson(id, changes) {
        await loadTimetable()

        if (id.startsWith("custom:")) {
            const lesson = data.customLessons.find(lesson => lesson.id === id)

            if (!lesson) throw new Error("Lesson not found")

            Object.assign(lesson, filterChanges(changes, true))
        } else if (id.startsWith("original:")) {
            const filtered = filterChanges(changes);

            data.overrides[id] = {
                ...data.overrides[id],
                ...filtered
            }
        } else throw new Error("Unknown lesson type")

        await saveTimetable()
    }

    async function deleteLesson(id) {
        await loadTimetable()

        if (id.startsWith("custom:")) {
            const index = data.customLessons.findIndex(lesson => lesson.id === id)

            if (index === -1) throw new Error("Lesson not found")

            data.customLessons.splice(index, 1)
        } else if (id.startsWith("original:")) {
            if (!data.deletedLessons.includes(id))
                data.deletedLessons.push(id)

            delete data.overrides[id]
        } else throw new Error("Unknown lesson type")

        await saveTimetable()
    }

    async function getLessons(date, originalLessons = []) {
        await loadTimetable();

        const deleted = new Set(data.deletedLessons);

        const originals = originalLessons
            .map(original => {
                const id = getOriginalId(date, original.originalId);

                if (deleted.has(id)) return null;

                return {
                    ...original,
                    ...data.overrides[id],
                    id,
                    date,
                    kind: "original"
                };
            })
            .filter(Boolean);

        const custom = data.customLessons
            .filter(lesson => lesson.date === date)
            .map(lesson => ({
                ...lesson,
                kind: "custom"
            }));

        return [...originals, ...custom]
            .sort((a, b) => a.startSlot - b.startSlot)
            .map(clone);
    }

    async function getLesson(id, date, originalLessons = []) {
        const lessons = await getLessons(date, originalLessons)

        return lessons.find(lesson => lesson.id === id) || null
    }

    async function setDayFree(date, free, title = "", description = "") {
    await loadTimetable();

    if (free) {
        data.freeDays[date] = { title, description };
    } else {
        data.freeDays[date] = false;
    }

    await saveTimetable();
}

async function isDayFree(date) {
    await loadTimetable();

    return Object.hasOwn(data.freeDays, date)
        && data.freeDays[date] !== false;
}

async function getFreeDay(date) {
    await loadTimetable();

    if (!Object.hasOwn(data.freeDays, date)) {
        return null;
    }

    return data.freeDays[date] === false
        ? false
        : clone(data.freeDays[date]);
}


    window.TimetableData = {
        loadTimetable,
        saveTimetable,
        createLesson,
        updateLesson,
        deleteLesson,
        getLessons,
        getLesson,
        setDayFree,
        isDayFree,
        getFreeDay
    }
})()