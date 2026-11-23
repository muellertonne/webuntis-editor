(() => {
    const EDITOR_CLASS = "wte-editor-enabled";
    const LESSON_TYPES = [
        ["normal", "Normal"],
        ["exam", "Exam"],
        ["extra", "Extra"],
        ["cancelled", "Cancelled"],
        ["cancelled-moved", "Cancelled - moved"],
        ["extra-moved", "Extra - moved"]
    ];

    let nativeStatusTemplates = null;

const NATIVE_STATUS_SELECTORS = {
    cancelled: ".cancelled-indicator",
    exam: ".exam-indicator",
    extra: ".additional-indicator",
    "cancelled-moved": ".moved-away-indicator",
    "extra-moved": ".moved-here-indicator"
};

function captureNativeStatusTemplates() {
    nativeStatusTemplates ||= {};

    for (const [type, selector] of Object.entries(
        NATIVE_STATUS_SELECTORS
    )) {
        if (nativeStatusTemplates[type]) continue;

        const sourceCard = [
            ...document.querySelectorAll(
                '.timetable-grid-card[data-testid^="timetable-grid-card-"] .lesson-card'
            )
        ].find(card => card.querySelector(selector));

        const sourceIndicator = sourceCard?.querySelector(selector);

        if (!sourceIndicator) continue;

        nativeStatusTemplates[type] = {
            indicator: (
                sourceIndicator.closest(".lesson-card-indicator")
                || sourceIndicator
            ).cloneNode(true)
        };
    }
}

    let editorEnabled = false;
    let updateScheduled = false;
    let updateRunning = false;
    let updateAgain = false;
    let timetableObserver = null;

    function getTimetable() {
        return document.querySelector('[data-testid="timetable-container"]');
    }

    function getTimetableYear() {
        const text = document.querySelector(
            '[data-testid="timetable-print-header-date"]'
        )?.textContent || "";

        const match = text.match(/\b(20\d{2})\b/);
        return match ? Number(match[1]) : new Date().getFullYear();
    }

    function getDateFromLabel(label) {
        const match = label.match(/(\d{1,2})\.(\d{1,2})\./);
        if (!match) return null;

        const day = match[1].padStart(2, "0");
        const month = match[2].padStart(2, "0");

        return `${getTimetableYear()}-${month}-${day}`;
    }

    function getColumnDate(column) {
        const label = column.querySelector(
            '[data-testid="timetable-grid-column-header-label-text"]'
        )?.textContent?.trim();

        return label ? getDateFromLabel(label) : null;
    }

    function getTimeMarkers() {
        return [...document.querySelectorAll(".timetable-grid-slot-time")]
            .map(element => {
                const time = element.querySelector(
                    ".timetable-grid-slot-time--time-value"
                )?.textContent?.trim();

                const top = Number.parseFloat(element.style.top);

                if (!time || !Number.isFinite(top)) return null;

                return { time, top };
            })
            .filter(Boolean)
            .sort((a, b) => a.top - b.top);
    }

    function getTimeAtTop(top) {
        const markers = getTimeMarkers();
        if (!markers.length) return "07:50";

        return markers.reduce((closest, marker) =>
            Math.abs(marker.top - top) < Math.abs(closest.top - top)
                ? marker
                : closest
        ).time;
    }

    function getTopForTime(time) {
        const markers = getTimeMarkers();
        if (!markers.length) return 9;

        const [hours, minutes] = time.split(":").map(Number);
        const target = hours * 60 + minutes;

        const closest = markers.reduce((best, marker) => {
            const [h, m] = marker.time.split(":").map(Number);
            const value = h * 60 + m;

            return Math.abs(value - target) < Math.abs(best.diff)
                ? { top: marker.top, diff: value - target }
                : best;
        }, { top: markers[0].top, diff: Infinity });

        return closest.top;
    }

    function getSlotForTime(time) {
        const top = getTopForTime(time);
        return Math.max(0, Math.round((top - 9) / 80));
    }

    function getValues(container, selector) {
        const element = container.querySelector(selector);
        if (!element) return [];

        return [...element.querySelectorAll('[data-testid="regular-resource"]')]
            .map(item => item.textContent.trim())
            .filter(Boolean);
    }

    function getLessonFromCard(card, date) {
        const lesson = card.querySelector(".lesson-card");
        if (!lesson) return null;

        const testId = card.getAttribute("data-testid") || "";
        if (!testId.startsWith("timetable-grid-card-")) return null;

        const originalId = testId.replace("timetable-grid-card-", "");
        const id = `original:${date}:${originalId}`;

        const top = Number.parseFloat(card.style.top) || 9;
        const height = Number.parseFloat(card.style.height) || 79;

        const colorBar = card.querySelector(
            '[data-testid="lesson-card-color-bar"]'
        );

        let type = "normal";

        if (lesson.querySelector(".moved-away-indicator")) {
            type = "cancelled-moved";
        } else if (lesson.querySelector(".moved-here-indicator")) {
            type = "extra-moved";
        } else if (lesson.classList.contains("cancelled")) {
            type = "cancelled";
        } else if (lesson.querySelector(".exam-indicator")) {
            type = "exam";
        } else if (lesson.querySelector(".additional-indicator")) {
            type = "extra";
        }

        return {
            id,
            originalId,
            date,
            startSlot: Math.max(0, Math.round((top - 9) / 80)),
            startTime: getTimeAtTop(top),
            durationSlots: Math.max(1, Math.round((height + 1) / 80)),
            teachers: getValues(card, '[data-testid="lesson-card-resources-with-change-teachers"]'),
            subject: getValues(card, '[data-testid="lesson-card-resources-with-change-subject"]').join(", "),
            rooms: getValues(card, '[data-testid="lesson-card-resources-with-change-rooms"]'),
            color: colorBar?.style.getPropertyValue("--color").trim() || "#4A90D9",
            type
        };
    }

    function setResourceElementValues(element, values, topElement = false) {
    if (!element) return;

    const list = Array.isArray(values)
        ? values
        : values
            ? [values]
            : [];

    const normalized = list
        .map(value => String(value).trim())
        .filter(Boolean);

    const current = [
        ...element.querySelectorAll('[data-testid="regular-resource"]')
    ].map(item => item.textContent.trim());

    if (JSON.stringify(current) === JSON.stringify(normalized)) {
        return;
    }

    element.replaceChildren();

    normalized.forEach((value, index) => {
        if (index > 0) {
            element.appendChild(document.createTextNode(", "));
        }

        const tag = document.createElement("span");
        tag.className = "lesson-card-regular-tag";

        if (topElement) {
            tag.classList.add("lesson-card-top-element");
        }

        tag.dataset.testid = "lesson-card-regular-tag";

        const resource = document.createElement("span");
        resource.dataset.testid = "regular-resource";
        resource.textContent = value;

        tag.appendChild(resource);
        element.appendChild(tag);
    });
}

function setResourceValues(container, selector, values, topElement = false) {
    const element = container.querySelector(selector);
    if (!element) return;

    setResourceElementValues(element, values, topElement);
}

function getSlotHeight() {
    const markers = getTimeMarkers();
    const positions = [...new Set(markers.map(marker => marker.top))];

    const differences = positions
        .slice(1)
        .map((top, index) => top - positions[index])
        .filter(value => value > 0);

    if (!differences.length) return 80;

    return differences.reduce((sum, value) => sum + value, 0)
        / differences.length;
}

function getTopForSlot(slot) {
    const markers = getTimeMarkers();
    const positions = [...new Set(markers.map(marker => marker.top))];

    const firstTop = positions[0] ?? 8;
    const slotHeight = getSlotHeight();

    return firstTop + slot * slotHeight + 1;
}

function clearNativeLessonStatus(lessonCard) {
    lessonCard.classList.remove("cancelled", "highlighted");
    lessonCard.style.removeProperty("background-color");

    lessonCard.querySelectorAll(
        ".cancelled-indicator, " +
        ".exam-indicator, " +
        ".additional-indicator, " +
        ".moved-here-indicator, " +
        ".moved-away-indicator"
    ).forEach(element => {
        const indicator = element.closest(".lesson-card-indicator")
            || element;

        indicator.remove();
    });
}

function applyNativeLessonStatus(lessonCard, type) {
    clearNativeLessonStatus(lessonCard);

    if (!type || type === "normal") return;

    const template = nativeStatusTemplates?.[type];

    if (!template?.indicator) {
        console.warn(
            `WebUntis Editor: Couldn't find a native indicator for "${type}"`
        );
        return;
    }

    const iconContainers = [
        ...lessonCard.querySelectorAll(".icon-placement-container")
    ];

    const targetContainer = iconContainers[0];

    if (targetContainer) {
        const indicator = template.indicator.cloneNode(true);
        setIndicatorIcon(indicator);

        targetContainer.appendChild(indicator);
    }

    const backgroundColors = {
        exam: "rgba(255, 214, 21, 0.157)",
        extra: "rgb(223, 246, 235)",
        "extra-moved": "rgb(223, 246, 235)",
        cancelled: "rgba(255, 64, 64, 0.137)",
        "cancelled-moved": "rgba(255, 64, 64, 0.137)"
    };

    const backgroundColor = backgroundColors[type];

    if (backgroundColor) {
        lessonCard.style.backgroundColor = backgroundColor;
    }

    if (type === "cancelled" || type === "cancelled-moved") {
        lessonCard.classList.add("cancelled", "highlighted");
    }
}

function renderLessonCard(card, lesson) {
    const lessonCard = card.querySelector(".lesson-card");
    if (!lessonCard) return;

    const top = getTopForSlot(lesson.startSlot);
    const height = lesson.durationSlots * getSlotHeight() - 1;

    card.style.top = `${top}px`;
    card.style.height = `${height}px`;

    // Die Klasse-Zeile stammt aus der Untis-Vorlage und gehört
    // nicht zu unseren eigenen Stunden.
    if (card.classList.contains("wte-custom-card")) {
        lessonCard.querySelector(
            '[data-testid="lesson-card-resources-with-change-klasse"]'
        )?.closest(".lesson-card-row")?.remove();
    }

    const colorBar = lessonCard.querySelector(
        '[data-testid="lesson-card-color-bar"]'
    );

    if (colorBar) {
        colorBar.style.setProperty(
            "--color",
            lesson.color || "#4A90D9"
        );
    }

    setResourceValues(
        lessonCard,
        '[data-testid="lesson-card-resources-with-change-teachers"]',
        lesson.teachers,
        true
    );

    setResourceValues(
        lessonCard,
        '[data-testid="lesson-card-resources-with-change-subject"]',
        lesson.subject
    );

    setResourceValues(
        lessonCard,
        '[data-testid="lesson-card-resources-with-change-rooms"]',
        lesson.rooms
    );

    lessonCard.dataset.wteType = lesson.type || "normal";

    applyNativeLessonStatus(lessonCard, lesson.type || "normal");
}

    function getNativeCardTemplate() {
    const cards = [
        ...document.querySelectorAll(
            '.timetable-grid-card[data-testid^="timetable-grid-card-"]'
        )
    ];

    if (!cards.length) return null;

    // Eine möglichst breite Karte als Vorlage bevorzugen.
    return cards.sort((a, b) =>
        b.getBoundingClientRect().width - a.getBoundingClientRect().width
    )[0];
}

function getNativeFreeDayLayer(column) {
    return column.querySelector(
        '.timetable-layer.holidays:not([data-wte-free-day]), ' +
        '[data-testid="timetable-layer--holiday"]:not([data-wte-free-day])'
    );
}

function setCardHiddenForFreeDay(card, free) {
    if (!Object.hasOwn(card.dataset, "wteOriginalDisplay")) {
        card.dataset.wteOriginalDisplay = card.style.display;
    }

    if (free) {
        card.style.display = "none";
        return;
    }

    if (card.dataset.wteDeleted === "true") {
        card.style.display = "none";
        return;
    }

    card.style.display = card.dataset.wteOriginalDisplay;
}

function getCustomCardGeometry(column, lesson) {
    const inner = column.querySelector(".timetable-grid--column-inner");
    if (!inner) return null;

    const innerRect = inner.getBoundingClientRect();
    const start = getTopForSlot(lesson.startSlot);
    const end = start + lesson.durationSlots * getSlotHeight() - 1;

    const occupied = [
        ...inner.querySelectorAll(
            '.timetable-grid-card'
        )
    ]
        .filter(card => {
            if (card.style.display === "none") return false;

            const cardTop = Number.parseFloat(card.style.top) || 0;
            const cardBottom = cardTop
                + (Number.parseFloat(card.style.height) || 0);

            return cardTop < end && cardBottom > start;
        })
        .map(card => {
            const rect = card.getBoundingClientRect();

            return {
                left: Math.max(0, rect.left - innerRect.left),
                right: Math.min(innerRect.width, rect.right - innerRect.left)
            };
        })
        .sort((a, b) => a.left - b.left);

    // Freie horizontale Bereiche zwischen bestehenden Karten suchen.
    const gaps = [];
    let cursor = 0;

    for (const range of occupied) {
        if (range.left > cursor) {
            gaps.push({
                left: cursor,
                width: range.left - cursor
            });
        }

        cursor = Math.max(cursor, range.right);
    }

    if (cursor < innerRect.width) {
        gaps.push({
            left: cursor,
            width: innerRect.width - cursor
        });
    }

    const largestGap = gaps
        .filter(gap => gap.width > 24)
        .sort((a, b) => b.width - a.width)[0];

    // Wenn kein freier Bereich existiert, wird die Karte über die
    // gesamte Spaltenbreite gelegt. Das ist besser als eine willkürliche
    // halbe Kartenbreite.
    const area = largestGap || {
        left: 0,
        width: innerRect.width
    };

    return {
        left: area.left,
        width: area.width,
        zIndex: Math.max(
            1,
            ...[...inner.querySelectorAll(".timetable-grid-card")]
                .map(card => Number.parseInt(card.style.zIndex, 10) || 1)
        ) + 1
    };
}

function applyColumnLayout(column, lessons) {
    const lessonsById = new Map(
        lessons.map(lesson => [lesson.id, lesson])
    );

    const entries = [];

    const cards = [
        ...column.querySelectorAll(".timetable-grid-card")
    ];

    for (const card of cards) {
        let id = null;

        if (card.classList.contains("wte-custom-card")) {
            id = card.dataset.wteLessonId;
        } else {
            try {
                const original = JSON.parse(
                    card.dataset.wteOriginalLesson || "{}"
                );

                id = original.id;
            } catch {
                continue;
            }
        }

        const lesson = lessonsById.get(id);
        if (!lesson) continue;

        const start = lesson.startSlot;
        const end = start + lesson.durationSlots;

        entries.push({
            card,
            lesson,
            start,
            end
        });
    }

    entries.sort((a, b) =>
        a.start - b.start || a.end - b.end
    );

    // Zuerst zusammenhängende Gruppen bilden.
    // Stunden gehören zur selben Gruppe, wenn sie direkt oder
    // indirekt zeitlich miteinander überlappen.
    const groups = [];
    let currentGroup = [];
    let groupEnd = -Infinity;

    for (const entry of entries) {
        if (currentGroup.length && entry.start >= groupEnd) {
            groups.push(currentGroup);
            currentGroup = [];
            groupEnd = -Infinity;
        }

        currentGroup.push(entry);
        groupEnd = Math.max(groupEnd, entry.end);
    }

    if (currentGroup.length) {
        groups.push(currentGroup);
    }

    for (const group of groups) {
        // Jede Gruppe erhält so viele Spalten wie tatsächlich
        // gleichzeitig benötigte Spalten.
        const laneEnds = [];

        for (const entry of group) {
            let lane = laneEnds.findIndex(
                end => end <= entry.start
            );

            if (lane === -1) {
                lane = laneEnds.length;
                laneEnds.push(entry.end);
            } else {
                laneEnds[lane] = entry.end;
            }

            entry.lane = lane;
        }

        const laneCount = Math.max(1, laneEnds.length);
        const width = 100 / laneCount;

        for (const entry of group) {
            const left = entry.lane * width;

            entry.card.style.left =
                `calc(${left.toFixed(4)}% + 1px)`;

            entry.card.style.width =
                `calc(${width.toFixed(4)}% - 1px)`;
        }
    }
}

function createCustomLessonCard(lesson, column) {
    const template = getNativeCardTemplate();

    if (!template) {
        console.warn(
            "WebUntis Editor: No original lesson for template found."
        );
        return null;
    }

    const card = template.cloneNode(true);

    card.classList.add("wte-custom-card");
    card.classList.remove("shadow");
    card.dataset.testid = "wte-custom-card";
    card.dataset.wteLessonId = lesson.id;

    const lessonCard = card.querySelector(".lesson-card");

    if (lessonCard) {
        lessonCard.classList.remove("clickable");
        lessonCard.removeAttribute("data-testid");

        lessonCard.querySelectorAll(".wte-lesson-actions").forEach(
            element => element.remove()
        );

        clearNativeLessonStatus(lessonCard);
    }

    card.removeAttribute("id");

    card.querySelector(
        '[data-testid="lesson-card-resources-with-change-klasse"]'
    )?.closest(".lesson-card-row")?.remove();

    renderLessonCard(card, lesson);

    return card;
}

function setIndicatorIcon(indicator) {
    const icon = indicator.querySelector(".untis-icon");
    if (!icon) return;

    const iconClass = [...icon.classList].find(className =>
        className.startsWith("untis-icon-")
    );

    if (!iconClass) {
        console.warn("WebUntis Editor: Couldn't find an Icon-classname", icon);
        return;
    }

    const iconName = iconClass.substring("untis-icon-".length);
    const expectedSrc = `/assets/icons/${iconName}.svg`;

    const existingImage = icon.querySelector("img");

    if (existingImage?.getAttribute("src") === expectedSrc) {
        return;
    }

    icon.replaceChildren();

    const image = document.createElement("img");
    image.src = expectedSrc;
    image.width = 16;
    image.height = 16;
    image.alt = "";
    image.style.display = "block";

    icon.appendChild(image);
}

    function setEditorEnabled(enabled) {
    editorEnabled = enabled;

    getTimetable()?.classList.toggle(
        EDITOR_CLASS,
        editorEnabled
    );

    scheduleUpdate();
}

    function addCreateButton() {
        const offset = document.querySelector(".timetable-grid-headers-offset");
        if (!offset || offset.querySelector(".wte-create-button")) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "wte-button wte-create-button";
        button.textContent = "+";
        button.title = "Add new lesson";
        button.setAttribute("aria-label", "Add new lesson");
        offset.appendChild(button);
    }

    function addLessonButtons(card, date) {
        const lessonCard = card.querySelector(".lesson-card");
        if (!lessonCard || lessonCard.querySelector(".wte-lesson-actions")) return;

        const testId = card.getAttribute("data-testid") || "";

        let id;

        if (card.classList.contains("wte-custom-card")) {
            id = card.dataset.wteLessonId;
        } else {
            if (!testId.startsWith("timetable-grid-card-")) return;

            id = `original:${date}:${testId.replace("timetable-grid-card-", "")}`;
        }

        const actions = document.createElement("div");
        actions.className = "wte-lesson-actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "wte-button wte-edit-button";
        edit.textContent = "✎";
        edit.title = "Edit lesson";
        edit.dataset.wteAction = "edit";
        edit.dataset.wteId = id;
        edit.dataset.wteDate = date;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "wte-button wte-delete-button";
        remove.textContent = "×";
        remove.title = "Delete lesson";
        remove.dataset.wteAction = "delete";
        remove.dataset.wteId = id;
        remove.dataset.wteDate = date;

        actions.append(edit, remove);
        lessonCard.appendChild(actions);
    }

    async function addDayButton(header, date, column) {
    if (!header || !date || !column) return;

    let button = header.querySelector(".wte-day-button");

    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "wte-button wte-day-button";
        header.appendChild(button);
    }

    const override = await TimetableData.getFreeDay(date);
    const isNativeFree = Boolean(getNativeFreeDayLayer(column));

    const isFree = override === false
        ? false
        : Boolean(override || isNativeFree);

    button.disabled = false;
    button.textContent = isFree ? "Set not free" : "Set free";

    button.title = isFree
        ? "Set as normal school day"
        : "Set as school-free day";

    button.dataset.wteAction = "toggle-day";
    button.dataset.wteDate = date;
}

    function renderFreeDayLayer(column, freeDay) {
    const selector =
        '.timetable-layer.holidays[data-wte-free-day="true"]';

    let layer = column.querySelector(selector);

    
    if (getNativeFreeDayLayer(column)) {
        layer?.remove();
        return;
    }

    if (!freeDay) {
        layer?.remove();
        return;
    }

    if (!layer) {
        const template = document.querySelector(
            '.timetable-layer.holidays[data-testid="timetable-layer--holiday"]:not([data-wte-free-day])'
        );

        if (template) {
            layer = template.cloneNode(true);
        } else {
            layer = document.createElement("div");
            layer.className = "timetable-layer holidays";

            const titleContainer = document.createElement("div");
            titleContainer.className = "timetable-layer-title";

            const iconContainer = document.createElement("span");
            iconContainer.className =
                "untis__timetabling_timetable__boarditem__icon " +
                "untis__timetabling_timetable__boarditem__lock";

            const icon = document.createElement("i");
            icon.className = "untis-icon untis-icon-lock";

            const image = document.createElement("img");
            image.src = "/assets/icons/lock.svg";
            image.width = 10;
            image.height = 10;
            image.alt = "";

            icon.appendChild(image);
            iconContainer.appendChild(icon);

            const title = document.createElement("span");
            title.className = "timetable-layer--text-title";

            titleContainer.append(iconContainer, title);

            const description = document.createElement("span");
            description.className = "timetable-layer--text";

            const secondDescription = document.createElement("span");
            secondDescription.className = "timetable-layer--text";

            layer.append(
                titleContainer,
                description,
                secondDescription
            );

            layer.style.top = "9px";
            layer.style.height = "calc(100% + 50px)";
            layer.style.left = "0px";
            layer.style.width = "calc(100% + 8px)";
        }

        layer.dataset.wteFreeDay = "true";
        layer.style.display = "";

        const inner = column.querySelector(
            ".timetable-grid--column-inner"
        );

        if (!inner) return;

        inner.appendChild(layer);
    }

    const title = layer.querySelector(".timetable-layer--text-title");
    const texts = layer.querySelectorAll(".timetable-layer--text");

    const titleText = freeDay.title || "Holiday";
    const descriptionText = freeDay.description || "";

    if (title && title.textContent !== titleText) {
        title.textContent = titleText;
    }

    if (texts[0] && texts[0].textContent !== descriptionText) {
        texts[0].textContent = descriptionText;
    }

    if (texts[1] && texts[1].textContent !== "") {
        texts[1].textContent = "";
    }

    if (layer.style.display === "none") {
        layer.style.display = "";
    }
}

    async function updateEditor() {
        captureNativeStatusTemplates()

        const timetable = getTimetable();
        if (!timetable) return;

        addCreateButton();

        const columns = [
            ...timetable.querySelectorAll(
                ".timetable-grid--column-container"
            )
        ];

        const headers = [
            ...timetable.querySelectorAll(
                ".timetable-grid-header-columns-container .column-header"
            )
        ];

        for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            const date = getColumnDate(column);

            if (!date) continue;

            const headerLabel = headers[i]?.querySelector(
                ".column-header-label"
            );

            if (headerLabel) {
                await addDayButton(headerLabel, date, column);
            }

            const originalCards = [
                ...column.querySelectorAll(
                    '.timetable-grid-card:not(.wte-custom-card)'
                )
            ].filter(card =>
                (card.dataset.testid || "").startsWith(
                    "timetable-grid-card-"
                )
            );

            const originalLessons = [];

            for (const card of originalCards) {
                if (!card.dataset.wteOriginalLesson) {
                    const original = getLessonFromCard(card, date);

                    if (original) {
                        card.dataset.wteOriginalLesson =
                            JSON.stringify(original);
                    }
                }

                try {
                    const original = JSON.parse(
                        card.dataset.wteOriginalLesson
                    );

                    originalLessons.push(original);
                } catch (error) {
                    console.error("Could not read original lesson:", error);
                }
            }

            const lessons = await TimetableData.getLessons(
                date,
                originalLessons
            );

            const lessonsById = new Map(
                lessons.map(lesson => [lesson.id, lesson])
            );

            for (const card of originalCards) {
                const original = JSON.parse(
                    card.dataset.wteOriginalLesson
                );

                const id = `original:${date}:${original.originalId}`;
                const lesson = lessonsById.get(id);

                if (!lesson) {
                    card.dataset.wteDeleted = "true";
                    card.style.display = "none";
                    continue;
                }

                card.dataset.wteDeleted = "false";
                setCardHiddenForFreeDay(card, false);

                renderLessonCard(card, lesson);
                addLessonButtons(card, date);
            }

            const customLessons = lessons.filter(
    lesson => lesson.kind === "custom"
);

const activeCustomIds = new Set(
    customLessons.map(lesson => lesson.id)
);

for (const card of [
    ...column.querySelectorAll('[data-testid="wte-custom-card"]')
]) {
    if (!activeCustomIds.has(card.dataset.wteLessonId)) {
        card.remove();
    }
}


for (const lesson of customLessons) {
    let card = [
        ...column.querySelectorAll('[data-testid="wte-custom-card"]')
    ].find(element =>
        element.dataset.wteLessonId === lesson.id
    );

    if (!card) {
        card = createCustomLessonCard(lesson, column);

        if (!card) continue;

        column.querySelector(".timetable-grid--column-inner")
            ?.appendChild(card);
    } else {
        renderLessonCard(card, lesson);
    }

    addLessonButtons(card, date);
}
applyColumnLayout(column, lessons)

const freeDay = await TimetableData.getFreeDay(date);
const nativeFreeDay = getNativeFreeDayLayer(column);

const isFree = freeDay === false
    ? false
    : Boolean(freeDay || nativeFreeDay);

if (nativeFreeDay) {
    nativeFreeDay.style.display = freeDay === false ? "none" : "";

    column.querySelector(
        '.timetable-layer.holidays[data-wte-free-day]'
    )?.remove();
} else {
    renderFreeDayLayer(
        column,
        freeDay && freeDay !== false ? freeDay : null
    );
}

const allCards = [
    ...column.querySelectorAll(".timetable-grid-card")
];

for (const card of allCards) {
    setCardHiddenForFreeDay(card, isFree);
}
    
        }
    }

    function scheduleUpdate() {
    if (updateRunning) {
        updateAgain = true;
        return;
    }

    if (updateScheduled) return;

    updateScheduled = true;

    requestAnimationFrame(async () => {
        updateScheduled = false;

        if (updateRunning) {
            updateAgain = true;
            return;
        }

        updateRunning = true;

        // Eigene DOM-Änderungen nicht beobachten.
        timetableObserver?.takeRecords();
        timetableObserver?.disconnect();

        try {
            await updateEditor();
        } catch (error) {
            console.error("WebUntis Editor update failed:", error);
        } finally {
            updateRunning = false;

            const timetable = getTimetable();

            if (timetable && timetableObserver) {
                timetableObserver.observe(timetable, {
                    childList: true,
                    subtree: true
                });
            }

            if (updateAgain) {
                updateAgain = false;
                scheduleUpdate();
            }
        }
    });
}

    function createField(labelText, name, type = "text") {
        const wrapper = document.createElement("label");
        wrapper.className = "wte-field";

        const label = document.createElement("span");
        label.textContent = labelText;

        const input = document.createElement("input");
        input.name = name;
        input.type = type;

        wrapper.append(label, input);
        return { wrapper, input };
    }

    function createSelect(labelText, name, options) {
        const wrapper = document.createElement("label");
        wrapper.className = "wte-field";

        const label = document.createElement("span");
        label.textContent = labelText;

        const select = document.createElement("select");
        select.name = name;

        for (const [value, text] of options) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        }

        wrapper.append(label, select);
        return { wrapper, input: select };
    }

    function showDialog(title, content, onSave) {
        document.querySelector(".wte-modal-backdrop")?.remove();

        const backdrop = document.createElement("div");
        backdrop.className = "wte-modal-backdrop";

        const modal = document.createElement("form");
        modal.className = "wte-modal";

        const heading = document.createElement("h2");
        heading.textContent = title;

        const body = document.createElement("div");
        body.className = "wte-modal-body";
        body.appendChild(content);

        const actions = document.createElement("div");
        actions.className = "wte-modal-actions";

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "wte-modal-cancel";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => backdrop.remove());

        const save = document.createElement("button");
        save.type = "submit";
        save.className = "wte-modal-save";
        save.textContent = "Save";

        actions.append(cancel, save);
        modal.append(heading, body, actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        backdrop.addEventListener("click", event => {
            if (event.target === backdrop) backdrop.remove();
        });

        modal.addEventListener("submit", async event => {
            event.preventDefault();

            save.disabled = true;
            save.textContent = "Saving...";

            try {
                await onSave(new FormData(modal));
                backdrop.remove();
                scheduleUpdate();
            } catch (error) {
                console.error("WebUntis Editor:", error);
                alert(error.message || "Save failed");
                save.disabled = false;
                save.textContent = "Save";
            }
        });

        return modal;
    }

    function openLessonDialog({ mode, date, id = null, lesson = null }) {
        const formContent = document.createElement("div");
        formContent.className = "wte-form-grid";

        const dateField = createField("Date", "date", "date");
        dateField.input.value = date || new Date().toISOString().slice(0, 10);
        formContent.appendChild(dateField.wrapper);

        const teachersField = createField("Teachers", "teachers");
        teachersField.input.placeholder = "Seperate multiple with a comma"
        formContent.appendChild(teachersField.wrapper);

        const subjectField = createField("Subject", "subject");
        formContent.appendChild(subjectField.wrapper);

        const roomsField = createField("Room", "rooms");
        roomsField.input.placeholder = "Seperate multiple with a comma";
        formContent.appendChild(roomsField.wrapper);

        const colorField = createField("Bar Color", "color", "color");
        formContent.appendChild(colorField.wrapper);

        const lengthField = createField("Length (Slots)", "durationSlots", "number");
        lengthField.input.min = "1";
        lengthField.input.step = "1";
        formContent.appendChild(lengthField.wrapper);

        const startField = createField("Start time", "startTime", "time");
        formContent.appendChild(startField.wrapper);

        const typeField = createSelect("Type", "type", LESSON_TYPES);
        formContent.appendChild(typeField.wrapper);

        const isOriginal = mode === "edit" && id?.startsWith("original:");
        dateField.input.disabled = isOriginal;

        teachersField.input.value = (lesson?.teachers || []).join(", ");
        subjectField.input.value = lesson?.subject || "";
        roomsField.input.value = (lesson?.rooms || []).join(", ");
        colorField.input.value = lesson?.color || "#4A90D9";
        lengthField.input.value = String(lesson?.durationSlots || 1);
        startField.input.value = lesson?.startTime || "07:50";
        const selectedType = LESSON_TYPES.some(
            ([value]) => value === lesson?.type
        ) ? lesson.type : "normal";

        typeField.input.value = selectedType;

        showDialog(
            mode === "edit" ? "Edit lesson" : "New Lesson",
            formContent,
            async values => {
                const selectedDate = values.get("date") || date;
                const startTime = values.get("startTime");
                const durationSlots = Number(values.get("durationSlots"));

                if (!selectedDate) throw new Error("Please select a date.");
                if (!startTime) throw new Error("Please select a start time.");
                if (!Number.isInteger(durationSlots) || durationSlots < 1) {
                    throw new Error("Length must be at least 1 slot");
                }

                const changes = {
                    startSlot: getSlotForTime(startTime),
                    startTime,
                    durationSlots,
                    subject: String(values.get("subject") || "").trim(),
                    teachers: String(values.get("teachers") || "")
                        .split(",").map(value => value.trim()).filter(Boolean),
                    rooms: String(values.get("rooms") || "")
                        .split(",").map(value => value.trim()).filter(Boolean),
                    color: values.get("color"),
                    type: values.get("type")
                };

                if (mode === "edit") {
                    await TimetableData.updateLesson(id, changes);
                } else {
                    await TimetableData.createLesson({
                        ...changes,
                        date: selectedDate
                    });
                }
            }
        );
    }

    async function openEditDialog(id, date) {
        const column = [
            ...document.querySelectorAll(
                ".timetable-grid--column-container"
            )
        ].find(element => getColumnDate(element) === date);

        if (!column) {
            alert("The timetable column wasn't found.");
            return;
        }

        const originalCards = [
            ...column.querySelectorAll(
                '.timetable-grid-card:not(.wte-custom-card)'
            )
        ];

        const originalLessons = originalCards
            .map(card => {
                try {
                    if (!card.dataset.wteOriginalLesson) {
                        const original = getLessonFromCard(card, date);
                        if (!original) return null;

                        card.dataset.wteOriginalLesson =
                            JSON.stringify(original);
                    }

                    return JSON.parse(card.dataset.wteOriginalLesson);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const lesson = await TimetableData.getLesson(
            id,
            date,
            originalLessons
        );

        if (!lesson) {
            alert("The lesson wasn't found.");
            return;
        }

        openLessonDialog({
            mode: "edit",
            id,
            date,
            lesson
        });
    }

    async function openFreeDayDialog(date) {
        const existing = await TimetableData.getFreeDay(date);
        const content = document.createElement("div");
        content.className = "wte-form-grid";

        const titleField = createField("Title", "title");
        titleField.input.value = existing?.title || "Holiday";

        const descriptionField = createField("Description", "description");

        descriptionField.input.placeholder = "Description of free day";
        descriptionField.input.value = existing?.description || "";

        content.append(titleField.wrapper, descriptionField.wrapper);

        showDialog(
            existing ? "Edit free day" : "Mark day as free",
            content,
            async values => {
                await TimetableData.setDayFree(
                    date,
                    true,
                    String(values.get("title") || "").trim(),
                    String(values.get("description") || "").trim()
                );
            }
        );
    }

    document.addEventListener("click", async event => {
        const target = event.target;

        if (!(target instanceof Element)) return;

        const button = target.closest(
            "[data-wte-action], .wte-create-button"
        );

        if (!button) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (button.classList.contains("wte-create-button")) {
            const firstColumn = document.querySelector(
                ".timetable-grid--column-container"
            );

            const date = firstColumn
                ? getColumnDate(firstColumn)
                : null;

            openLessonDialog({ mode: "new", date });
            return;
        }   

        const {
            wteAction: action,
            wteId: id,
            wteDate: date
        } = button.dataset;

        try {
            if (action === "edit") {
                await openEditDialog(id, date);

            } else if (action === "delete") {
                if (!confirm("Are you sure you want to delete this lesson?")) {
                    return;
                }

                await TimetableData.deleteLesson(id);
                scheduleUpdate();

            } else if (action === "toggle-day") {
    const column = [
        ...document.querySelectorAll(
            ".timetable-grid--column-container"
        )
    ].find(element => getColumnDate(element) === date);

    const override = await TimetableData.getFreeDay(date);
    const isNativeFree = Boolean(
        column && getNativeFreeDayLayer(column)
    );

    const isFree = override === false
        ? false
        : Boolean(override || isNativeFree);

    if (isFree) {
        if (!confirm("Set as normal school day?")) return;

        await TimetableData.setDayFree(date, false);
        scheduleUpdate();
    } else {
        await openFreeDayDialog(date);
    }
}
        } catch (error) {
            console.error("WebUntis Editor:", error);
            alert(error.message || "Error");
        }
    }, true);

    
    async function initialize() {
        await TimetableData.loadTimetable();

        const result = await chrome.storage.local.get("editorEnabled");
        setEditorEnabled(result.editorEnabled === true);

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.editorEnabled) {
                setEditorEnabled(changes.editorEnabled.newValue === true);
            }
        });

        let currentTimetable = null;

        function observeTimetable() {
            const timetable = getTimetable();

            if (!timetable || timetable === currentTimetable) {
                return;
            }

            currentTimetable = timetable;

            timetable.classList.toggle(EDITOR_CLASS, editorEnabled)

            timetableObserver?.disconnect();

            timetableObserver = new MutationObserver(() => scheduleUpdate());
            timetableObserver.observe(timetable, {
                childList: true,
                subtree: true
            });

            scheduleUpdate();
        }

    
        const pageObserver = new MutationObserver(observeTimetable);

        pageObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        observeTimetable();
    }

    initialize().catch(error => {
        console.error("WebUntis Editor initialization failed:", error);
    });
})()