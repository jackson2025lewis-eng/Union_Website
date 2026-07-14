const API_URL = (window.location.origin === "null" || window.location.port === "5500")
    ? "http://localhost:3000"
    : window.location.origin;

async function handleResponse(response) {
    if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
            const errData = await response.json();
            if (errData && errData.error) {
                errMsg = errData.error;
            } else if (errData && errData.message) {
                errMsg = errData.message;
            }
        } catch (_) {}
        throw new Error(errMsg);
    }
    return await response.json();
}

export async function getRoutes() {
    try {
        const response = await fetch(`${API_URL}/routes`, {
            headers: {
                Accept: "application/json"
            }
        });
        const data = await handleResponse(response);
        return Array.isArray(data) ? data : [];
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}

export async function getRouteStops(routeId) {
    try {
        const response = await fetch(`${API_URL}/routes/${routeId}/stops`, {
            headers: {
                Accept: "application/json"
            }
        });
        return await handleResponse(response);
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}

export async function startTrip(routeId, tripType) {
    try {
        const response = await fetch(`${API_URL}/trips`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ route_id: routeId, trip_type: tripType })
        });
        return await handleResponse(response);
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}

export async function updateLiveLocation(tripId, latitude, longitude, speed) {
    try {
        const response = await fetch(`${API_URL}/trips/${tripId}/location`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ latitude, longitude, speed })
        });
        return await handleResponse(response);
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}

export async function getLiveLocation(routeId) {
    try {
        const response = await fetch(`${API_URL}/routes/${routeId}/live`, {
            headers: {
                Accept: "application/json"
            }
        });
        return await handleResponse(response);
    } catch (err) {
        throw new Error(`Fetch failed: ${err.message}`);
    }
}
