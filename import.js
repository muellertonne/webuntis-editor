
const STORAGE_KEY = "webuntisTimetableData";

const chooseFile = document.getElementById("chooseFile");
const fileInput = document.getElementById("fileInput");
const status = document.getElementById("status");

function setStatus(message, success = false) {
    status.textContent = message;
    status.style.color = success ? "green" : "red";
}

chooseFile.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    chooseFile.disabled = true;
    setStatus("Importing...", true);

    try {
        const data = JSON.parse(await file.text());

        const isObject =
            data !== null &&
            typeof data === "object" &&
            !Array.isArray(data);

        const isEmptyReset =
            isObject && Object.keys(data).length === 0;

        const isValidTimetable =
            isObject &&
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

        setStatus(
            "Successfully imported timetable. Please reload your open web untis page for the changes to take affect.",
            true
        );


    } catch (error) {
        console.error("Import failed:", error);

        setStatus(
            "Import failed:\n" + error.message
        );
    }

    chooseFile.disabled = false;
    fileInput.value = "";
    close()
});
