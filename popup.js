const STORAGE_KEY = "webuntisTimetableData";

const enabled = document.getElementById("enabled");
const importButton = document.getElementById("import");
const exportButton = document.getElementById("export");
const resetButton = document.getElementById("reset");

const dialog = document.getElementById("dialog");
const dialogTitle = document.getElementById("dialogTitle");
const dialogMessage = document.getElementById("dialogMessage");
const dialogCancel = document.getElementById("dialogCancel");
const dialogConfirm = document.getElementById("dialogConfirm");

let dialogResolve = null;


function showDialog(title, message, confirmText = "OK", cancelText = null) {
    return new Promise(resolve => {
        dialogTitle.textContent = title;
        dialogMessage.textContent = message;
        dialogConfirm.textContent = confirmText;

        dialogCancel.hidden = cancelText === null;

        if (cancelText !== null) {
            dialogCancel.textContent = cancelText;
        }

        dialog.hidden = false;
        dialogResolve = resolve;
    });
}

function closeDialog(result) {
    if (dialog.hidden) return;

    dialog.hidden = true;

    if (dialogResolve) {
        const resolve = dialogResolve;
        dialogResolve = null;
        resolve(result);
    }
}

dialogConfirm.addEventListener("click", () => closeDialog(true));
dialogCancel.addEventListener("click", () => closeDialog(false));


chrome.storage.local.get(
    ["editorEnabled"],
    result => {
        enabled.checked = result.editorEnabled === true;
    }
);


enabled.addEventListener("change", async () => {
    try {
        await chrome.storage.local.set({
            editorEnabled: enabled.checked
        });
    } catch (error) {
        console.error(error);

        await showDialog(
            "Error",
            "Couldn't save setting"
        );
    }
});


async function updateWebUntisTab() {
    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    const tab = tabs[0];

    if (!tab?.id || !tab.url) {
        return false;
    }

    try {
        const url = new URL(tab.url);

        if (!url.hostname.endsWith("webuntis.com")) {
            return false;
        }

        await chrome.tabs.reload(tab.id);
        return true;
    } catch (error) {
        console.error("Could not reload WebUntis:", error);
        return false;
    }
}


importButton.addEventListener("click", async () => {
    try {
        await chrome.tabs.create({
            url: chrome.runtime.getURL("import.html")
        });
    } catch (error) {
        console.error("Could not open import page:", error);

        await showDialog(
            "Import failed",
            "The import page could not be opened"
        );
    }
});


fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());

        const isEmptyReset = Object.keys(data).length === 0;

        const isValidTimetable =
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            data.version === 1 &&
            Array.isArray(data.customLessons) &&
            typeof data.overrides === "object" &&
            data.overrides !== null &&
            !Array.isArray(data.overrides) &&
            Array.isArray(data.deletedLessons) &&
            typeof data.freeDays === "object" &&
            data.freeDays !== null &&
            !Array.isArray(data.freeDays);

        if (!isEmptyReset && !isValidTimetable) {
            throw new Error("Invalid timetable format");
        }

        await chrome.storage.local.set({
            [STORAGE_KEY]: data
        });

        await updateWebUntisTab();

        await showDialog(
            "Import successful",
            "Timetable has been imported."
        );

    } catch (error) {
        console.error("Import failed:", error);

        await showDialog(
            "Import failed",
            error.message
        );
    }

    fileInput.value = "";
});


exportButton.addEventListener("click", async () => {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);

        const data = JSON.stringify(
            result[STORAGE_KEY] ?? {},
            null,
            4
        );

        const blob = new Blob([data], {
            type: "application/json"
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = "webuntis-timetable.json";

        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

    } catch (error) {
        console.error("Export failed:", error);

        await showDialog(
            "Export failed",
            error.message
        );
    }
});


resetButton.addEventListener("click", async () => {
    const confirmed = await showDialog(
        "Reset all changes?",
        "This will revert everything you have done to the timetable. This cannot be undone.",
        "Reset",
        "Cancel"
    );

    if (!confirmed) return;

    try {
        await chrome.storage.local.set({
            [STORAGE_KEY]: {}
        });

        await updateWebUntisTab();

        await showDialog(
            "Reset successful",
            "All changes have been reset."
        );

    } catch (error) {
        console.error("Reset failed:", error);

        await showDialog(
            "Reset failed",
            error.message
        );
    }
});