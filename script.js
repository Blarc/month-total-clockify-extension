// Parameters
const extensionDivId = "clockify-month-extension"

// Define the XPath of the target element and the new HTML div to append
const targetXPath = "/html/body/app-root/default-layout/div[1]/main/div/tracker2/div/div/div/div/entry-group[1]/approval-header";

/**
 * Retrieves data from local storage for the given key and optionally returns a specific property.
 * @param {string} [property] (Optional) The specific property to retrieve from the stored object.
 * @returns {any | null} The retrieved value, or null if the key does not exist or an error occurs.
 */
function getFromUserInLocalStorage(property) {
    const key = "user";
    try {
        // Retrieve the data from local storage
        const storedData = localStorage.getItem(key);

        if (!storedData) {
            console.warn(`No data found in local storage under key: ${key}`);
            return null; // Return null if the key does not exist
        }

        // Parse the JSON string into an object
        const parsedData = JSON.parse(storedData);

        // If a property is specified, return it (if it exists)
        if (property) {
            if (parsedData && property in parsedData) {
                return parsedData[property];
            } else {
                console.warn(`Property "${property}" not found in data for key: ${key}`);
                return null;
            }
        }

        // Otherwise, return the entire parsed object
        return parsedData;
    } catch (error) {
        console.error(`Error retrieving data from local storage for key: ${key}`, error);
        return null; // Return null if there's any error
    }
}

/**
 * Appends an HTML string as a child of the target element.
 * @param {string} html - The HTML string to append.
 * @param {HTMLElement} targetElement - The target element to which the content will be appended.
 */
function addDiv(html, targetElement) {
    const divContainer = document.createElement("div");
    divContainer.innerHTML = html;
    if (!document.getElementById(extensionDivId)) {
        targetElement.insertBefore(divContainer, targetElement.childNodes[1]);
    }
}

/**
 * Observes the DOM for the appearance of an element at a given XPath and applies a callback.
 * @param {string} xpath - The XPath expression of the target element.
 * @param {Function} callback - The function to call when the target element is found.
 */
function waitForXPath(xpath, callback) {
    const observer = new MutationObserver(() => {
        if (location.href.includes("/tracker")) {
            const evaluator = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );

            const targetElement = evaluator.singleNodeValue;
            if (targetElement && !document.getElementById(extensionDivId)) {
                // observer.disconnect(); // Stop observing when the target element is found
                callback(targetElement);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true, // Observe the entire DOM tree
    });
}

/**
 * Gets the date range for the previous month.
 * @returns {{ start: string, end: string, monthName: string }} - The start, end, and name of the previous month.
 */
function getPreviousMonthRange() {
    const currentDate = new Date();
    const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const nextMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    const currentMonthEnd = new Date(nextMonthStart - 1);

    return {
        start: currentMonthStart.toISOString(),
        end: currentMonthEnd.toISOString(),
        monthName: currentMonthStart.toLocaleString("en-US", {month: "long"}).toLowerCase(),
    };
}

/**
 * Prepares the payload for the Clockify API request.
 * @param {string} startDate - The start date for the report.
 * @param {string} endDate - The end date for the report.
 * @returns {string} - The JSON payload for the API request.
 */
function createPayload(startDate, endDate) {
    return JSON.stringify({
        dateRangeStart: startDate,
        dateRangeEnd: endDate,
        sortOrder: "ASCENDING",
        description: "",
        rounding: false,
        withoutDescription: false,
        amounts: [],
        amountShown: "HIDE_AMOUNT",
        zoomLevel: "MONTH",
        userLocale: "en-GB",
        customFields: null,
        userCustomFields: null,
        kioskIds: [],
        users: {
            contains: "CONTAINS",
            ids: [getFromUserInLocalStorage("id")],
            status: "ACTIVE_WITH_PENDING",
            numberOfDeleted: 0,
        },
        userGroups: {
            contains: "CONTAINS",
            ids: [],
            status: "ACTIVE_WITH_PENDING",
            numberOfDeleted: 0,
        },
        summaryFilter: {
            sortColumn: "GROUP",
            groups: ["DATE", "PROJECT", "TIMEENTRY"],
            summaryChartType: "PROJECT",
        },
        exportType: "JSON",
    });
}

/**
 * Fetches the Clockify report and processes the result.
 * @param {HTMLElement} targetElement - The element to append the new div after fetching the report.
 */
async function fetchClockifyReport(targetElement) {
    const {start, end} = getPreviousMonthRange();
    const payload = createPayload(start, end);
    const url = `https://reports.api.clockify.me/workspaces/${getFromUserInLocalStorage("defaultWorkspace")}/reports/summary`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Auth-Token": localStorage.getItem("token")
            },
            body: payload,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        console.log(responseData)
        const offHours = await fetchTimeOffHours(start, end);
        console.log(offHours)

        const totalTimeSeconds = responseData.totals[0]?.totalTime ?? 0; // Default to 0 seconds if no data
        updateWeekTotalDiv(targetElement, totalTimeSeconds, offHours);
    } catch (error) {
        console.error("Error fetching Clockify report:", error.message);
        updateWeekTotalDiv(targetElement, "Unable to fetch data", 0);
    }
}

/**
 * Prepares the payload for the Clockify API request.
 * @param {string} startDate - The start date for the report.
 * @param {string} endDate - The end date for the report.
 * @returns {string} - The JSON payload for the API request.
 */
function createFetchTimeOffDataPayload(startDate, endDate) {
    return JSON.stringify({
        page: 1,
        pageSize: 50,
        start: startDate,
        end: endDate,
        statuses: ["APPROVED"],
        users: [getFromUserInLocalStorage("id")]
    });
}

/**
 * Fetches time-off data from Clockify API for a specific date range
 * @returns {Promise<Number>} - Number of time off hours.
 */
async function fetchTimeOffHours() {
    const {start, end} = getPreviousMonthRange();
    const payload = createFetchTimeOffDataPayload(start, end);

    const url = `https://api.clockify.me/api/v1/workspaces/${getFromUserInLocalStorage("defaultWorkspace")}/time-off/requests`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Auth-Token": localStorage.getItem("token")
            },
            body: payload,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();

        // Calculate total time off hours from approved requests
        let totalTimeOffHours = 0;

        if (responseData.requests && Array.isArray(responseData.requests)) {
            responseData.requests.forEach(request => {
                // Only count approved time off requests
                if (request.status?.statusType === 'APPROVED') {
                    if (request.timeUnit === 'DAYS') {
                        // Convert days to hours (assuming 8 hours per day)
                        const days = request.balanceDiff || 0;
                        totalTimeOffHours += days * 8;
                    } else if (request.timeUnit === 'HOURS') {
                        // If time unit is already in hours
                        totalTimeOffHours += request.balanceDiff || 0;
                    }
                    // Handle half days if needed
                    else if (request.timeOffPeriod?.halfDay && request.timeOffPeriod?.halfDayHours) {
                        totalTimeOffHours += request.timeOffPeriod.halfDayHours;
                    }
                }
            });
        }
        return totalTimeOffHours;
    } catch (error) {
        console.error("Error fetching time-off data:", error);
        return 0;
    }
}


/**
 * Updates the content of the week total div.
 * @param {HTMLElement} targetElement - The target element where the week total div will be added.
 * @param {number} totalTimeSeconds - The total time seconds.
 * @param {number} offHours - The number of off time hours.
 */
function updateWeekTotalDiv(targetElement, totalTimeSeconds, offHours) {
    const updatedDivHTML = `
    <div id="${extensionDivId}" class="cl-d-flex cl-align-items-end cl-mt-2 cl-mt-lg-0 cl-justify-content-lg-end">
      <div class="cl-h6 cl-mb-0 cl-lh-1 cl-white-space-no-wrap ng-star-inserted">Month total:</div>
      <div class="cl-h2 cl-mb-0 cl-ml-2 cl-lh-1 ng-star-inserted">${formatSecondsToTime(totalTimeSeconds - offHours * 3600)} / ${getWorkingHoursForCurrentMonth() - offHours}:00 (${calculateWorkingHoursDifference(totalTimeSeconds / 3600)})</div>
    </div>`;
    addDiv(updatedDivHTML, targetElement);
}

/**
 * Converts a total time in seconds to the hh:mm format.
 * @param {number} totalSeconds - The total time in seconds.
 * @returns {string} - The formatted time as hh:mm.
 */
function formatSecondsToTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Calculate the total working hours in the current month.
 * @returns {number} - Total working hours (weekdays * 8 hours).
 */
function getWorkingHoursForCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // Current month (0-based index)

    // Get the number of weekdays in the current month
    const weekdays = getWeekdaysInMonth(year, month);

    // Assume 8 working hours per weekday
    return weekdays * 8;
}

/**
 * Get the number of weekdays in a month up to a specific date.
 * @param {number} year - The year (e.g., 2023).
 * @param {number} month - The month (0 for January, 1 for February, etc.).
 * @param {number} [upToDay] - The specific day in the month to count up to (optional).
 * @returns {number} - The number of weekdays up to the given day.
 */
function getWeekdaysInMonth(year, month, upToDay = null) {
    // Get the total number of days in the month
    const totalDays = upToDay || new Date(year, month + 1, 0).getDate();
    let weekdaysCount = 0;

    // Loop through all the days in the month up to the specified day
    for (let day = 1; day <= totalDays; day++) {
        const currentDay = new Date(year, month, day).getDay();
        // Increment if the day is a weekday (Monday–Friday)
        if (currentDay !== 0 && currentDay !== 6) {
            weekdaysCount++;
        }
    }

    return weekdaysCount;
}

/**
 * Calculate the difference between expected and actual working hours for the current month.
 * @param {number} actualHours - The current number of hours worked in the month.
 * @returns {string} - The difference.
 */
function calculateWorkingHoursDifference(actualHours) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // Current month (0-based index)
    const today = now.getDate(); // Current day of the month

    // Expected number of weekdays up to today in the current month
    const weekdaysUpToToday = getWeekdaysInMonth(year, month, today);

    // Each weekday is 8 hours of work
    const expectedHours = weekdaysUpToToday * 8;

    // Calculate the difference
    const hoursDifference = actualHours - expectedHours;

    // Format the result to HH:mm
    const formattedTime = formatHoursToHHmm(hoursDifference);

    // Determine the color based on the sign of the difference
    const color = hoursDifference < 0 ? "red" : "green";

    // Return styled HTML with the formatted time
    return `<span style="color: ${color};">${formattedTime}</span>`;


}

/**
 * Converts a time string in hh:mm format to a floating-point number of hours.
 * @param {string} timeString - The time string in hh:mm format.
 * @returns {number} - The total time in hours as a number.
 */
function convertTimeToHours(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours + minutes / 60;
}

/**
 * Converts a floating-point number of hours into HH:mm format.
 * @param {number} hours - The total hours as a number.
 * @returns {string} - The formatted time in HH:mm format.
 */
function formatHoursToHHmm(hours) {
    const totalMinutes = Math.round(Math.abs(hours) * 60); // Convert hours to total minutes
    const hh = Math.floor(totalMinutes / 60); // Extract hours
    const mm = totalMinutes % 60; // Extract remaining minutes

    // Format with sign for positive/negative difference
    const sign = hours < 0 ? "-" : "+";
    return `${sign}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Start observing for the target element and fetch the report when it appears
waitForXPath(targetXPath, fetchClockifyReport);
